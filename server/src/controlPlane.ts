// The control plane orchestrator. The ONLY path by which money moves.
// Agent proposes → evaluate() → ALLOW: execute + audit · GATE: explain + enqueue · BLOCK: refuse + audit.
// This file contains no model calls on the decision path; the LLM is only ever asked for language.

import { db, now, uid, getMeta, setMeta } from './db.js';
import { isoWeekTag } from './util.js';
import { evaluate } from './control-plane/policy.js';
import { ensureMandate } from './control-plane/mandate.js';
import { appendAudit, dailySpent, recentPayouts10m } from './control-plane/audit.js';
import { enqueueApproval, isHalted, publish, resolveApproval } from './control-plane/approvals.js';
import { paypal, onPaypalEvent } from './paypal/gateway.js';
import { riskExplanation } from './agent/textgen.js';
import type { Decision, ProposedAction } from './types.js';

// ── Action persistence ───────────────────────────────────────────────────────
export interface ActionRow {
  id: string; type: string; amount: number; currency: string; payee: string; payeeName: string | null;
  memo: string; decision: string | null; reasonCode: string | null; status: string;
  paypalRef: string | null; mandateVersion: number | null; source: string; standing: number;
  createdAt: string; updatedAt: string;
}

export function getAction(id: string): ActionRow | undefined {
  return db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow | undefined;
}
function updateAction(id: string, fields: Partial<ActionRow>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE actions SET ${sets}, updatedAt = ? WHERE id = ?`).run(
    ...Object.values(fields).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)), now(), id
  );
}

function saveAction(a: ProposedAction, source: string): ActionRow {
  const row: ActionRow = {
    id: uid(), type: a.type, amount: a.amount, currency: a.currency, payee: a.payee,
    payeeName: a.payeeName ?? null, memo: a.memo, decision: null, reasonCode: null,
    status: 'PROPOSED', paypalRef: null, mandateVersion: null, source,
    standing: a.standing ? 1 : 0, createdAt: now(), updatedAt: now(),
  };
  db.prepare(
    `INSERT INTO actions (id, type, amount, currency, payee, payeeName, memo, status, source, standing, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.type, row.amount, row.currency, row.payee, row.payeeName, row.memo, row.status, row.source, row.standing, row.createdAt, row.updatedAt);
  return row;
}

export interface HandleResult {
  actionId: string;
  decision: Decision | null;
  status: string;
  approvalId?: string;
  explanation?: string;
  execution?: { paypalRef: string; status: string } | null;
}

// ── The gate (FR-05): every money-out passes through handle() — no exceptions ──
export async function handle(action: ProposedAction, source: 'chat' | 'usecase' | 'standing' = 'chat'): Promise<HandleResult> {
  const mandate = await ensureMandate();

  // Global stop: the agent halts, nothing executes, nothing is approved (FR-15)
  if (isHalted()) {
    const row = saveAction(action, source);
    updateAction(row.id, { status: 'HALTED' });
    const decision: Decision = {
      decision: 'BLOCK',
      reasonCode: 'R_BLOCK_HALT',
      reasonText: 'Global stop is engaged — all agent action is frozen. Resume the agent to proceed.',
      policyHits: [{ rule: 'R-00', detail: 'Kill switch' }],
      mandateVersion: mandate.version,
    };
    updateAction(row.id, { decision: decision.decision, reasonCode: decision.reasonCode, mandateVersion: mandate.version });
    appendAudit({ kind: 'ACTION_DECISION', actionId: row.id, decision: 'BLOCK', payload: decisionPayload(row, action, decision) });
    publish('action.decision', { actionId: row.id, decision });
    return { actionId: row.id, decision, status: 'HALTED' };
  }

  const decision = evaluate(action, mandate, {
    dailySpent: dailySpent(),
    recentPayouts10m: recentPayouts10m(),
  });

  const row = saveAction(action, source);
  updateAction(row.id, { decision: decision.decision, reasonCode: decision.reasonCode, mandateVersion: mandate.version });

  appendAudit({
    kind: 'ACTION_DECISION',
    actionId: row.id,
    decision: decision.decision,
    payload: decisionPayload(row, action, decision),
  });

  if (action.type === 'invoice') {
    return handleInvoice(row, action, decision);
  }

  if (decision.decision === 'ALLOW') {
    // Idempotency (FR-13): standing-mandate runs use the per-week envelope key so a week's
    // authorized run executes exactly once; per-action proposals use the row key.
    const idemKey =
      action.standing && decision.reasonCode === 'R_STANDING_ALLOW'
        ? `standing:${action.payee}:${isoWeekTag()}`
        : `governed:${row.id}`;
    const execution = await executePayout(row.id, idemKey);
    return { actionId: row.id, decision, status: 'EXECUTED', execution };
  }

  if (decision.decision === 'GATE') {
    // The model writes the *explanation* only — the decision above is already final. (FR-09)
    const explanation = await riskExplanation(action, decision, {
      dailySpent: dailySpent(),
      perTxn: mandate.limits.perTxn,
      allowlisted: mandate.payeeAllowlist.some((p) => p.toLowerCase() === action.payee.toLowerCase()),
    });
    const approval = enqueueApproval(row.id, decision, explanation);
    updateAction(row.id, { status: 'AWAIT_APPROVAL' });
    publish('action.decision', { actionId: row.id, decision, approvalId: approval.id, explanation });
    return { actionId: row.id, decision, status: 'AWAIT_APPROVAL', approvalId: approval.id, explanation };
  }

  updateAction(row.id, { status: 'BLOCKED' });
  publish('action.decision', { actionId: row.id, decision });
  return { actionId: row.id, decision, status: 'BLOCKED' };
}

function decisionPayload(row: ActionRow, action: ProposedAction, decision: Decision) {
  return {
    event:
      decision.decision === 'ALLOW'
        ? `Policy ALLOW: ${action.type} $${action.amount} → ${action.payee}`
        : decision.decision === 'GATE'
          ? `Policy GATE: ${action.type} $${action.amount} → ${action.payee} awaits human approval`
          : `Policy BLOCK: ${action.type} $${action.amount} → ${action.payee} refused`,
    actionType: action.type,
    amount: action.amount,
    currency: action.currency,
    payee: action.payee,
    memo: action.memo,
    reasonCode: decision.reasonCode,
    reasonText: decision.reasonText,
    policyHits: decision.policyHits,
    mandateVersion: decision.mandateVersion,
  };
}

// ── Money-in: invoices (autonomous) ──────────────────────────────────────────
async function handleInvoice(row: ActionRow, action: ProposedAction, decision: Decision): Promise<HandleResult> {
  const inv = await paypal.createInvoice({
    payee: action.payee, payeeName: action.payeeName, amount: action.amount, currency: action.currency, memo: action.memo,
    requestId: `mandate-invoice-${row.id}`, // PayPal-Request-Id: 1-hour idempotency on retry (docs)
  });
  // Send may 422 (USER_NOT_FOUND) when the recipient isn't a real sandbox account — the invoice
  // still exists on PayPal as DRAFT. Record honestly; POST /api/invoices/:id/resend completes it.
  // The gateway skips the call entirely when no sandbox recipient is configured (status CREATED + reason).
  let sendStatus = 'SENT';
  let sendNote: string | undefined;
  try {
    const sent = await paypal.sendInvoice(inv.id);
    if (sent.status !== 'SENT') {
      sendStatus = sent.status;
      sendNote = sent.skipped;
    }
  } catch (e: unknown) {
    sendStatus = 'CREATED';
    sendNote = String(e).slice(0, 300);
  }
  maybeSetupNativeAutoReminders(inv.id);
  db.prepare(
    `INSERT INTO invoices (id, paypalId, invoiceNumber, payee, payeeName, amount, currency, memo, status, dueDate, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, inv.id, inv.invoiceNumber, action.payee, action.payeeName ?? null, action.amount, action.currency, action.memo, sendStatus, dueDateFor(), row.createdAt, now());

  updateAction(row.id, { status: 'EXECUTED', paypalRef: inv.id });
  appendAudit({
    kind: 'EXECUTION',
    actionId: row.id,
    payload: {
      event: sendStatus === 'SENT'
        ? `Invoice ${inv.invoiceNumber} created and sent to ${action.payee} ($${action.amount})`
        : `Invoice ${inv.invoiceNumber} created on PayPal as DRAFT — send pending recipient fix ($${action.amount})`,
      actionType: 'invoice', moneyOut: 0, amount: action.amount, currency: action.currency,
      payee: action.payee, paypalRef: inv.id, invoiceNumber: inv.invoiceNumber,
      sendStatus, ...(sendNote ? { sendError: sendNote } : {}),
      ...(inv.sandboxRecipient ? { sandboxRecipient: inv.sandboxRecipient, note: 'sandbox override: routed to the configured sandbox personal account' } : {}),
    },
  });
  publish('invoice.updated', { actionId: row.id, invoiceId: inv.id, status: sendStatus });
  return { actionId: row.id, decision, status: 'EXECUTED', execution: { paypalRef: inv.id, status: sendStatus } };
}

/** Best-effort one-time: configure PayPal's NATIVE invoice auto reminders alongside our AI reminders
 *  (docs: POST /v2/invoicing/setup-reminders). Failure (422 already-configured, endpoint absence) is non-fatal. */
function maybeSetupNativeAutoReminders(invoiceId: string): void {
  if (getMeta('native-auto-reminders') === '1') return;
  const gw = paypal as typeof paypal & { setupAutoReminders?: () => Promise<unknown> };
  if (!gw.setupAutoReminders) return;
  setMeta('native-auto-reminders', '1');
  gw.setupAutoReminders()
    .then(() => {
      appendAudit({
        kind: 'SYSTEM',
        payload: { event: `PayPal native auto reminders configured (BEFORE_DUE 2d ×1, AFTER_DUE 2d ×2) — reference invoice ${invoiceId}` },
      });
    })
    .catch((e: unknown) => {
      appendAudit({
        kind: 'SYSTEM',
        payload: { event: `PayPal native auto reminder setup skipped: ${String(e).slice(0, 180)}` },
      });
    });
}

function dueDateFor(): string {
  const d = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Money-out execution: idempotent payout (FR-13) ──────────────────────────
export async function executePayout(actionId: string, idempotencyKey: string): Promise<{ paypalRef: string; status: string } | null> {
  const row = getAction(actionId);
  if (!row) throw new Error('unknown action');
  if (row.status === 'EXECUTED') return { paypalRef: row.paypalRef ?? '', status: 'ALREADY_EXECUTED' }; // idempotent re-submit

  updateAction(actionId, { status: 'EXECUTING' });
  let res: { batchId: string; status: string };
  try {
    res = await paypal.createPayout({
      payee: row.payee, amount: row.amount, currency: row.currency, note: row.memo || 'Mandate governed payout', idempotencyKey,
    });
  } catch (e: unknown) {
    const msg = String(e);
    // PayPal-side idempotency: a duplicate sender_batch_id within PayPal's retention window
    // (e.g. after a local reset) means the batch already exists — treat as a no-op, never a failure.
    if (msg.includes('already exists')) {
      const m = msg.match(/payouts\/([A-Z0-9]+)/);
      const existingId = m ? m[1] : null;
      updateAction(actionId, { status: 'EXECUTED', paypalRef: existingId });
      db.prepare(
        `INSERT INTO payouts (id, actionId, batchId, status, amount, currency, payee, idempotencyKey, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uid(), actionId, existingId ?? 'duplicate', 'SUCCESS', row.amount, row.currency, row.payee, idempotencyKey, now(), now());
      appendAudit({
        kind: 'EXECUTION',
        actionId,
        payload: {
          event: `Payout idempotent no-op: PayPal reports sender_batch_id already exists${existingId ? ` (batch ${existingId})` : ''} — no double-pay`,
          actionType: row.type, moneyOut: 0, amount: row.amount, currency: row.currency,
          payee: row.payee, paypalRef: existingId, idempotencyKey, duplicateOf: existingId,
        },
      });
      publish('payout.updated', { actionId, batchId: existingId, status: 'ALREADY_EXISTS' });
      return { paypalRef: existingId ?? 'duplicate', status: 'ALREADY_EXISTS' };
    }
    // Any other gateway failure: mark FAILED and surface — never silently execute (FR-14).
    updateAction(actionId, { status: 'FAILED' });
    appendAudit({
      kind: 'SYSTEM',
      actionId,
      payload: { event: `Payout execution failed: ${msg.slice(0, 220)}`, actionType: row.type, payee: row.payee },
    });
    publish('payout.updated', { actionId, status: 'FAILED' });
    throw e;
  }
  db.prepare(
    `INSERT INTO payouts (id, actionId, batchId, status, amount, currency, payee, idempotencyKey, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid(), actionId, res.batchId, res.status, row.amount, row.currency, row.payee, idempotencyKey, now(), now());

  updateAction(actionId, { status: 'EXECUTED', paypalRef: res.batchId });
  appendAudit({
    kind: 'EXECUTION',
    actionId,
    payload: {
      event: `Payout executed: $${row.amount} → ${row.payee} (batch ${res.batchId}, ${res.status})`,
      actionType: row.type, moneyOut: 1, amount: row.amount, currency: row.currency,
      payee: row.payee, paypalRef: res.batchId, idempotencyKey,
    },
  });
  publish('payout.updated', { actionId, batchId: res.batchId, status: res.status });
  return { paypalRef: res.batchId, status: res.status };
}

// ── Approval resolution → execution (FR-10) ─────────────────────────────────
export async function approveAndExecute(approvalId: string, by: string): Promise<HandleResult> {
  const res = resolveApproval(approvalId, 'APPROVE', by);
  if (!res.ok) return { actionId: '', decision: null, status: res.error ?? 'ERROR' };
  const approval = res.approval!;
  const execution = await executePayout(approval.actionId, `approval:${approvalId}`);
  return { actionId: approval.actionId, decision: null, status: 'EXECUTED', execution };
}

export function denyApproval(approvalId: string, by: string): HandleResult {
  const res = resolveApproval(approvalId, 'DENY', by);
  if (!res.ok) return { actionId: '', decision: null, status: res.error ?? 'ERROR' };
  const approval = res.approval!;
  updateAction(approval.actionId, { status: 'DENIED' });
  return { actionId: approval.actionId, decision: null, status: 'DENIED' };
}

// ── Webhook ingestion (FR-03): verified in sandbox; deduped by event id ──────
// Event names verified against GET /v1/notifications/webhooks-event-types (sandbox, Nov 12 2026):
// batch-level PAYMENT.PAYOUTSBATCH.{PROCESSING,SUCCESS,DENIED}, item-level PAYMENT.PAYOUTS-ITEM.*,
// and INVOICING.INVOICE.PAID. PAYMENT.PAYOUTS.EVENT is the internal synthetic name (settle paths).
export function handlePaypalEvent(e: { id: string; eventType: string; resourceId?: string; summary?: string; payload?: Record<string, unknown> }): void {
  const dup = db.prepare('SELECT id FROM events WHERE id = ?').get(e.id);
  if (dup) return; // replay/dedupe by event id
  db.prepare('INSERT INTO events (id, type, payload, ts) VALUES (?, ?, ?, ?)').run(e.id, e.eventType, JSON.stringify(e), now());
  // Normalize payout events: batch id and status live in different places per event family.
  // Batch events carry the authoritative batch status. Item events describe one recipient's
  // outcome — they never invent a batch status; only FAILED changes the row (money did not move).
  let payoutBatchId: string | undefined = e.resourceId;
  let payoutStatus: string | undefined;
  let itemStatus: string | undefined;
  if (e.eventType === 'PAYMENT.PAYOUTS.EVENT') {
    payoutStatus = (e.payload?.batch_status as string) ?? 'SUCCESS';
  } else if (e.eventType.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const header = e.payload?.batch_header as { payout_batch_id?: string; batch_status?: string } | undefined;
    payoutBatchId = header?.payout_batch_id;
    payoutStatus = header?.batch_status;
  } else if (e.eventType.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    payoutBatchId = e.payload?.payout_batch_id as string | undefined;
    itemStatus = (e.payload?.transaction_status as string | undefined) ?? e.eventType.replace('PAYMENT.PAYOUTS-ITEM.', '');
    if (itemStatus === 'FAILED') payoutStatus = 'FAILED';
  }

  if (payoutBatchId && (payoutStatus || itemStatus)) {
    const payout = db.prepare('SELECT actionId, status FROM payouts WHERE batchId = ?').get(payoutBatchId) as
      | { actionId: string; status: string }
      | undefined;
    if (payout) {
      if (payoutStatus) {
        db.prepare('UPDATE payouts SET status = ?, updatedAt = ? WHERE batchId = ?').run(payoutStatus, now(), payoutBatchId);
      }
      const itemId = e.payload?.payout_item_id ? ` (${String(e.payload.payout_item_id)})` : '';
      appendAudit({
        kind: 'WEBHOOK',
        actionId: payout.actionId,
        payload: {
          event: itemStatus
            ? `PayPal webhook: payout batch ${payoutBatchId} — item ${itemStatus}${itemId}`
            : `PayPal webhook: payout batch ${payoutBatchId} → ${payoutStatus}`,
          eventType: e.eventType, resourceId: payoutBatchId,
          ...(payoutStatus ? { status: payoutStatus } : {}),
          ...(itemStatus ? { itemStatus } : {}),
        },
      });
      publish('payout.updated', { actionId: payout.actionId, batchId: payoutBatchId, status: payoutStatus ?? payout.status, ...(itemStatus ? { itemStatus } : {}) });
    }
  }

  if (e.eventType === 'INVOICING.INVOICE.PAID') {
    // PayPal's envelope has no top-level resource_id: the invoice id is at resource.id (observed on
    // a signed delivery) or resource.invoice.id (v2 envelope shape, handled defensively). Internal
    // events pass resourceId directly.
    const invoiceId = e.resourceId
      ?? (e.payload?.id as string | undefined)
      ?? (e.payload?.invoice as { id?: string } | undefined)?.id;
    const inv = invoiceId
      ? (db.prepare('SELECT id FROM invoices WHERE paypalId = ?').get(invoiceId) as { id: string } | undefined)
      : undefined;
    if (inv && invoiceId) {
      db.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE paypalId = ?').run('PAID', now(), invoiceId);
      appendAudit({
        kind: 'WEBHOOK',
        payload: { event: `PayPal webhook: invoice ${invoiceId} PAID`, eventType: e.eventType, resourceId: invoiceId },
      });
      publish('invoice.updated', { invoiceId, status: 'PAID' });
    }
  }
}

onPaypalEvent(handlePaypalEvent);

/** Safety net behind webhooks: batches registered before the webhook existed, deliveries lost to
 *  downtime or rejection, and any future gap are settled here from PayPal's live batch status.
 *  Webhooks are the fast path; this is the correctness backstop (runs at boot, SANDBOX only). */
export async function reconcilePendingPayouts(): Promise<number> {
  const rows = db
    .prepare("SELECT batchId, actionId, status FROM payouts WHERE status IN ('PENDING', 'PROCESSING')")
    .all() as { batchId: string; actionId: string; status: string }[];
  let n = 0;
  for (const r of rows) {
    try {
      const live = await paypal.getPayoutStatus(r.batchId);
      if (live.status && live.status !== r.status) {
        db.prepare('UPDATE payouts SET status = ?, updatedAt = ? WHERE batchId = ?').run(live.status, now(), r.batchId);
        appendAudit({
          kind: 'SYSTEM',
          actionId: r.actionId,
          payload: { event: `Reconciled payout batch ${r.batchId}: ${r.status} → ${live.status} (live PayPal status — no verified webhook recorded for this batch)`, resourceId: r.batchId, status: live.status },
        });
        publish('payout.updated', { actionId: r.actionId, batchId: r.batchId, status: live.status });
        n++;
      }
    } catch {
      // transient — left for the next pass; never fabricates a status
    }
  }
  return n;
}
