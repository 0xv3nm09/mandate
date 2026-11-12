// PayPal gateway. One interface, two implementations:
//   SANDBOX — real REST calls to api-m.sandbox.paypal.com (OAuth-cached, retrying)
//   MOCK    — stateful fake with identical semantics that emits the same webhook events
// The control plane only ever sees the interface, so demo mode and live mode are the same code path.

import { env, paypalMode } from '../env.js';
import { db, now, uid } from '../db.js';
import { recordPaypalCall } from './journal.js';

export interface InvoiceInput {
  payee: string;
  payeeName?: string;
  amount: number;
  currency: string;
  memo: string;
  dueDate?: string;
  /** PayPal-Request-Id idempotency key (docs: "server stores keys for 1 hour") */
  requestId?: string;
}

export interface GatewayInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  /** set when a sandbox recipient override routed this invoice to a real test account */
  sandboxRecipient?: string;
}

export interface PaypalGateway {
  readonly mode: 'SANDBOX' | 'MOCK';
  createInvoice(input: InvoiceInput): Promise<GatewayInvoice>;
  sendInvoice(id: string): Promise<{ status: string; skipped?: string }>;
  remindInvoice(id: string, subject: string, note: string): Promise<{ status: string; skipped?: string }>;
  getInvoice(id: string): Promise<GatewayInvoice | null>;
  createPayout(input: {
    payee: string;
    amount: number;
    currency: string;
    note: string;
    idempotencyKey: string;
  }): Promise<{ batchId: string; status: string }>;
  getPayoutStatus(batchId: string): Promise<{ status: string }>;
  /** Verify a PayPal webhook's transmission signature (sandbox only). */
  verifyWebhook(input: {
    transmissionId: string;
    transmissionTime: string;
    certUrl: string;
    authAlgo: string;
    transmissionSig: string;
    webhookEvent: unknown;
  }): Promise<boolean>;
  /** Docs endpoint POST /v1/notifications/simulate-event (sandbox gateway only). */
  simulateEvent?(webhookId: string, eventType: string): Promise<unknown>;
  /** Configure PayPal's native BEFORE_DUE/AFTER_DUE auto reminders (best-effort, sandbox). */
  setupAutoReminders?(): Promise<unknown>;
  /** Adopt or create the app's webhook for `url` (sandbox gateway only) — boot-time self-registration. */
  ensureWebhook?(url: string, eventTypes: string[]): Promise<{ id: string; created: boolean } | null>;
}

export type PaypalEvent = {
  id: string;
  eventType: string; // INVOICING.INVOICE.PAID | PAYMENT.PAYOUTS.EVENT | ...
  resourceId?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

let eventHandler: ((e: PaypalEvent) => void) | null = null;
export function onPaypalEvent(h: (e: PaypalEvent) => void): void {
  eventHandler = h;
}
export function emitEvent(e: Omit<PaypalEvent, 'id'>): void {
  // Recording happens in the handler (handlePaypalEvent) so BOTH internal events and
  // real webhook deliveries land in `events` — dedupe works for every path.
  eventHandler?.({ ...e, id: uid() });
}

// ── SANDBOX (real REST) ──────────────────────────────────────────────────────
class SandboxGateway implements PaypalGateway {
  readonly mode = 'SANDBOX' as const;
  private token: { value: string; expiresAt: number } | null = null;

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const basic = Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString('base64');
    const res = await fetch(`${env.paypal.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown, attempt = 0, extraHeaders?: Record<string, string>): Promise<T> {
    const token = await this.accessToken();
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${env.paypal.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: unknown) {
      recordPaypalCall({ ts: now(), method, path, status: 0, ms: Date.now() - t0, ok: false, note: attempt ? `retry ${attempt}` : String(err).slice(0, 60) });
      throw err;
    }
    recordPaypalCall({ ts: now(), method, path, status: res.status, ms: Date.now() - t0, ok: res.ok, ...(attempt ? { note: `retry ${attempt}` } : {}) });
    // FR-14: 5xx/timeouts → retry with backoff; the caller never silently proceeds on failure
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      return this.call<T>(method, path, body, attempt + 1, extraHeaders);
    }
    if (!res.ok) throw new Error(`PayPal ${method} ${path} → ${res.status}: ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async createInvoice(input: InvoiceInput): Promise<GatewayInvoice> {
    // Docs: 201 returns the full invoice body when `Prefer: return=representation` is set;
    // without it some responses are HAL self-links — the invoice id is the last path segment of that href.
    // PayPal-Request-Id gives 1-hour idempotency on this POST (retry-safe create).
    // Sandbox note: send requires an existing sandbox personal account, so when
    // PAYPAL_SANDBOX_RECIPIENT is set we route there (the caller still records the logical payee).
    const recipient = env.paypal.invoiceRecipient ?? input.payee;
    const inv = await this.call<{ id?: string; href?: string }>('POST', '/v2/invoicing/invoices', {
      detail: {
        invoice_number: `MANDATE-${Date.now().toString(36).toUpperCase()}`,
        currency_code: input.currency,
        note: input.memo,
        terms_and_conditions: 'Generated by Mandate — governed by a signed Intent Mandate.',
      },
      invoicer: { business_name: env.paypal.invoicerName, email_address: env.paypal.invoicerEmail },
      primary_recipients: [{ billing_info: { email_address: recipient, name: input.payeeName ? { full_name: input.payeeName } : undefined } }],
      items: [{ name: input.memo || 'Services', quantity: '1', unit_amount: { currency_code: input.currency, value: input.amount.toFixed(2) } }],
    }, 0, {
      Prefer: 'return=representation',
      ...(input.requestId ? { 'PayPal-Request-Id': input.requestId } : {}),
    });
    const id = inv.id ?? inv.href?.split('/').filter(Boolean).pop() ?? '';
    return {
      id, invoiceNumber: id, status: 'DRAFT',
      ...(env.paypal.invoiceRecipient && recipient !== input.payee ? { sandboxRecipient: recipient } : {}),
    };
  }

  async sendInvoice(id: string): Promise<{ status: string; skipped?: string }> {
    // Sandbox fact: send 422s USER_NOT_FOUND unless the recipient is a real sandbox personal
    // account. Without PAYPAL_SANDBOX_RECIPIENT the invoice keeps a placeholder recipient —
    // skip the doomed call (keeps PayPal's API error log clean); the invoice stays DRAFT
    // and the caller records the honest CREATED state.
    if (!env.paypal.invoiceRecipient) {
      return { status: 'CREATED', skipped: 'no sandbox recipient configured (set PAYPAL_SANDBOX_RECIPIENT to deliver for real)' };
    }
    await this.call('POST', `/v2/invoicing/invoices/${id}/send`, {});
    return { status: 'SENT' };
  }

  async remindInvoice(id: string, subject: string, note: string): Promise<{ status: string; skipped?: string }> {
    // Docs: "API caller can send only 2 reminders in a day" — a 422 here is the daily cap,
    // not a code failure; the caller surfaces it honestly.
    // An invoice that was never delivered (no sandbox recipient → still DRAFT on PayPal)
    // rejects remind with 422 — skip instead of making the doomed call.
    if (!env.paypal.invoiceRecipient) {
      return { status: 'SKIPPED', skipped: 'invoice not delivered to PayPal (no sandbox recipient configured)' };
    }
    await this.call('POST', `/v2/invoicing/invoices/${id}/remind`, {
      subject,
      note,
      send_to_invoicer: false,
      send_to_recipient: true,
    });
    return { status: 'REMIND_SENT' };
  }

  async getInvoice(id: string): Promise<GatewayInvoice | null> {
    try {
      const inv = await this.call<{ id: string; number: string; status: string }>('GET', `/v2/invoicing/invoices/${id}`);
      return { id: inv.id, invoiceNumber: inv.number, status: inv.status };
    } catch {
      return null;
    }
  }

  async createPayout(input: {
    payee: string;
    amount: number;
    currency: string;
    note: string;
    idempotencyKey: string;
  }): Promise<{ batchId: string; status: string }> {
    // Sandbox: route to the configured personal test account (if set) so the batch settles on
    // PayPal — with a real sandbox recipient the items claim and funds actually move between
    // accounts; with placeholder payees they stay UNCLAIMED and only the sender is debited.
    // The ledger keeps the logical payee.
    const receiver = env.paypal.invoiceRecipient ?? input.payee;
    const res = await this.call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
      'POST',
      '/v1/payments/payouts',
      {
        sender_batch_header: {
          sender_batch_id: input.idempotencyKey, // idempotency (FR-13)
          email_subject: 'You have a payout from Mandate',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: { value: input.amount.toFixed(2), currency: input.currency },
            receiver,
            note: input.note,
          },
        ],
      }
    );
    return { batchId: res.batch_header.payout_batch_id, status: res.batch_header.batch_status };
  }

  async getPayoutStatus(batchId: string): Promise<{ status: string }> {
    const res = await this.call<{ batch_header: { batch_status: string } }>('GET', `/v1/payments/payouts/${batchId}`);
    return { status: res.batch_header.batch_status };
  }

  async verifyWebhook(input: {
    transmissionId: string;
    transmissionTime: string;
    certUrl: string;
    authAlgo: string;
    transmissionSig: string;
    webhookEvent: unknown;
  }): Promise<boolean> {
    if (!env.paypal.webhookId) return false;
    try {
      const res = await this.call<{ verification_status: string; debug_id?: string }>(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        {
          webhook_id: env.paypal.webhookId,
          transmission_id: input.transmissionId,
          transmission_time: input.transmissionTime,
          cert_url: input.certUrl,
          auth_algo: input.authAlgo,
          transmission_sig: input.transmissionSig,
          webhook_event: input.webhookEvent,
        }
      );
      const status = res.verification_status;
      if (status !== 'SUCCESS') {
        // Never swallow why: a trust product must show its verification decisions.
        console.log(`  PayPal webhook : signature verification ${status} (debug ${res.debug_id ?? '—'})`);
      }
      return status === 'SUCCESS';
    } catch (err: unknown) {
      console.log(`  PayPal webhook : signature verification error — ${String(err).slice(0, 200)}`);
      return false;
    }
  }

  /** Deterministic demo in LIVE sandbox mode: docs endpoint POST /v1/notifications/simulate-event. */
  async simulateEvent(webhookId: string, eventType: string): Promise<unknown> {
    return this.call('POST', '/v1/notifications/simulate-event', { webhook_id: webhookId, event_type: eventType });
  }

  async ensureWebhook(url: string, eventTypes: string[]): Promise<{ id: string; created: boolean } | null> {
    // Notifications v1: adopt a webhook already registered for this URL, else create one.
    // Runs at boot so real PayPal events (payout settlements, invoice payments) reach the
    // ledger with signature verification — PAYPAL_WEBHOOK_ID stops being a manual step.
    const list = await this.call<{ webhooks?: { id: string; url: string }[] }>('GET', '/v1/notifications/webhooks');
    const existing = (list.webhooks ?? []).find((h) => h.url === url);
    if (existing) return { id: existing.id, created: false };
    const created = await this.call<{ id: string }>('POST', '/v1/notifications/webhooks', {
      url,
      event_types: eventTypes.map((name) => ({ name })),
    });
    return { id: created.id, created: true };
  }

  /** Docs: POST /v2/invoicing/setup-reminders — configure PayPal's native BEFORE_DUE/AFTER_DUE reminders.
   *  Called best-effort once; failure (e.g. already configured → 422) is non-fatal. */
  async setupAutoReminders(): Promise<unknown> {
    return this.call('POST', '/v2/invoicing/setup-reminders', {
      configurations: [
        { type: 'BEFORE_DUE', interval: { unit: 'DAY', value: 2 }, repetition: 1, notification: { send_to_invoicer: false } },
        { type: 'AFTER_DUE', interval: { unit: 'DAY', value: 2 }, repetition: 2, notification: { send_to_invoicer: false } },
      ],
    });
  }
}

// ── MOCK (deterministic demo) ────────────────────────────────────────────────
export class MockGateway implements PaypalGateway {
  readonly mode = 'MOCK' as const;

  async createInvoice(input: InvoiceInput): Promise<GatewayInvoice> {
    const id = `INV2-MOCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const invoiceNumber = `MND-${Date.now().toString(36).toUpperCase()}`;
    return { id, invoiceNumber, status: 'DRAFT' };
  }

  async sendInvoice(id: string): Promise<{ status: string }> {
    return { status: 'SENT' };
  }

  async remindInvoice(id: string, subject: string, note: string): Promise<{ status: string }> {
    return { status: 'REMIND_SENT' };
  }

  async getInvoice(id: string): Promise<GatewayInvoice | null> {
    const row = db.prepare('SELECT status FROM invoices WHERE paypalId = ?').get(id) as { status: string } | undefined;
    return row ? { id, invoiceNumber: id, status: row.status } : null;
  }

  async createPayout(input: {
    payee: string;
    amount: number;
    currency: string;
    note: string;
    idempotencyKey: string;
  }): Promise<{ batchId: string; status: string }> {
    const batchId = `PBatch-MOCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // Simulate PayPal's async settlement: PENDING → SUCCESS, then emit the webhook we'd receive for real.
    setTimeout(() => {
      db.prepare('UPDATE payouts SET status = ?, updatedAt = ? WHERE batchId = ?').run('SUCCESS', now(), batchId);
      emitEvent({
        eventType: 'PAYMENT.PAYOUTS.EVENT',
        resourceId: batchId,
        summary: `Payout batch ${batchId} completed (mock settlement)`,
        payload: { batch_status: 'SUCCESS', amount: input.amount, currency: input.currency, receiver: input.payee },
      });
    }, 1200);
    return { batchId, status: 'PENDING' };
  }

  async getPayoutStatus(batchId: string): Promise<{ status: string }> {
    const row = db.prepare('SELECT status FROM payouts WHERE batchId = ?').get(batchId) as { status: string } | undefined;
    return { status: row?.status ?? 'UNKNOWN' };
  }

  async verifyWebhook(): Promise<boolean> {
    return true; // mock events originate inside Mandate itself
  }
}

export const paypal: PaypalGateway =
  paypalMode === 'SANDBOX' ? new SandboxGateway() : new MockGateway();
