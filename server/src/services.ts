// Domain services that compose the gateway + control plane + audit:
// reminders (UC-02), standing-mandate runs (UC-08), paid simulations, stats.

import { db, now, uid } from './db.js';
import { isoWeekTag } from './util.js';
import { paypal } from './paypal/gateway.js';
import { emitEvent } from './paypal/gateway.js';
import { appendAudit } from './control-plane/audit.js';
import { publish, isHalted } from './control-plane/approvals.js';
import { reminderDraft } from './agent/textgen.js';
import { handle } from './controlPlane.js';

export interface InvoiceRow {
  id: string; paypalId: string; invoiceNumber: string; payee: string; payeeName: string | null;
  amount: number; currency: string; memo: string; status: string; dueDate: string | null;
  remindersSent: number; lastReminderAt: string | null; createdAt: string; updatedAt: string;
}

export function listInvoices(): InvoiceRow[] {
  return db.prepare('SELECT * FROM invoices ORDER BY createdAt DESC LIMIT 100').all() as unknown as InvoiceRow[];
}

export function getInvoice(id: string): InvoiceRow | undefined {
  return db.prepare('SELECT * FROM invoices WHERE id = ? OR paypalId = ?').get(id, id) as unknown as InvoiceRow | undefined;
}

/** Find the invoice we should chase: by payee if given, else the most-overdue unpaid one. */
export function pickOverdue(payeeName?: string): InvoiceRow | undefined {
  const unpaid = listInvoices().filter((i) => i.status === 'SENT' || i.status === 'OVERDUE');
  if (payeeName) {
    const k = payeeName.toLowerCase();
    return unpaid.find((i) => i.payee.toLowerCase().includes(k) || (i.payeeName ?? '').toLowerCase().includes(k));
  }
  return unpaid.sort((a, b) => (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1)[0];
}

/** UC-02: draft (tone escalating) + send a reminder for an overdue invoice. Autonomous — money-in side. */
export async function sendReminder(invoiceId: string): Promise<{ invoice: InvoiceRow; subject: string; note: string; tone: string }> {
  const inv = getInvoice(invoiceId);
  if (!inv) throw new Error('unknown invoice');
  if (isHalted()) throw new Error('Global stop engaged — agent halted (FR-15)');

  const attempt = inv.remindersSent + 1;
  const draft = await reminderDraft(inv.payeeName ?? inv.payee, inv.amount, inv.currency, inv.memo, attempt);
  // Docs: PayPal allows only 2 reminders per invoice per day — a 422 there is the daily cap.
  let delivered = true;
  try {
    await paypal.remindInvoice(inv.paypalId, draft.subject, draft.note);
  } catch (e: unknown) {
    delivered = false;
    appendAudit({
      kind: 'SYSTEM',
      payload: { event: `Reminder #${attempt} for invoice ${inv.invoiceNumber} rejected by PayPal: ${String(e).slice(0, 160)}` },
    });
    publish('invoice.updated', { invoiceId: inv.paypalId, status: inv.status, reminderRejected: attempt });
  }
  if (delivered) {
    db.prepare('UPDATE invoices SET remindersSent = ?, lastReminderAt = ?, updatedAt = ? WHERE id = ?').run(
      attempt, now(), now(), inv.id
    );
    appendAudit({
      kind: 'EXECUTION',
      payload: {
        event: `Reminder #${attempt} (${draft.tone}) sent for invoice ${inv.invoiceNumber} → ${inv.payee}`,
        actionType: 'reminder', moneyOut: 0, amount: inv.amount, payee: inv.payee,
        invoiceNumber: inv.invoiceNumber, tone: draft.tone, subject: draft.subject,
      },
    });
    publish('invoice.updated', { invoiceId: inv.paypalId, status: inv.status, reminder: attempt });
    const fresh = getInvoice(inv.id)!;
    return { invoice: fresh, subject: draft.subject, note: draft.note, tone: draft.tone };
  }
  return {
    invoice: getInvoice(inv.id)!,
    subject: draft.subject,
    note: draft.note,
    tone: `${draft.tone} (rejected — PayPal daily reminder cap; try again tomorrow)`,
  };
}

/** Mark unpaid invoices past their due date as OVERDUE (the trigger UC-02 watches). */
export function sweepOverdue(): number {
  const today = now().slice(0, 10);
  const rows = db
    .prepare(`UPDATE invoices SET status = 'OVERDUE', updatedAt = ? WHERE status = 'SENT' AND dueDate IS NOT NULL AND dueDate < ?`)
    .run(now(), today);
  return Number(rows.changes);
}

/** UC-08: execute the standing weekly payout under the signed envelope (autonomous, no prompt). */
export async function runStandingPayout(source: 'chat' | 'usecase' = 'chat'): Promise<{
  ran: boolean; reason?: string; result?: Awaited<ReturnType<typeof handle>>;
}> {
  const { currentMandate } = await import('./control-plane/mandate.js');
  const mandate = currentMandate();
  if (!mandate?.standing) return { ran: false, reason: 'No standing mandate is currently signed.' };
  if (isHalted()) return { ran: false, reason: 'Global stop engaged — nothing runs while halted (FR-15).' };

  // Weekly idempotency: one authorized execution per ISO week (FR-13).
  const key = `standing:${mandate.standing.payee}:${isoWeekTag()}`;
  const done = db.prepare(`SELECT id FROM payouts WHERE idempotencyKey = ?`).get(key);
  if (done) return { ran: false, reason: `Standing payout for ${isoWeekTag()} already executed (idempotency key ${key}).` };

  const result = await handle(
    {
      type: 'payout',
      amount: mandate.standing.amount,
      currency: mandate.standing.currency,
      payee: mandate.standing.payee,
      payeeName: mandate.standing.payeeName,
      memo: `Standing weekly payout — ${mandate.standing.note}`,
      standing: true,
    },
    'standing'
  );
  return { ran: true, result };
}

function isoWeek(d: Date): string {
  return isoWeekTag(d);
}

/** Deterministic demo: simulate the buyer paying an invoice (fires the same webhook a real payer would). */
export function simulateInvoicePaid(payeeName?: string): { ok: boolean; invoice?: InvoiceRow; error?: string } {
  const inv = payeeName ? pickOverdue(payeeName) ?? getInvoiceByName(payeeName) : pickOverdue() ?? listInvoices().find((i) => i.status === 'SENT' || i.status === 'OVERDUE');
  if (!inv) return { ok: false, error: 'No sent invoice found to mark as paid.' };
  emitEvent({
    eventType: 'INVOICING.INVOICE.PAID',
    resourceId: inv.paypalId,
    summary: `Invoice ${inv.invoiceNumber} paid by ${inv.payee} (simulated buyer)`,
    payload: { invoice_id: inv.paypalId, amount: inv.amount, currency: inv.currency },
  });
  return { ok: true, invoice: getInvoice(inv.id) };
}

function getInvoiceByName(name: string): InvoiceRow | undefined {
  const k = name.toLowerCase();
  return listInvoices().find(
    (i) => i.payee.toLowerCase().includes(k) || (i.payeeName ?? '').toLowerCase().includes(k)
  );
}

export function stats() {
  const auditRow = db.prepare('SELECT COUNT(*) AS n FROM audit').get() as { n: number };
  const actions = db.prepare(`SELECT status, COUNT(*) AS n FROM actions GROUP BY status`).all() as { status: string; n: number }[];
  const by = (s: string) => actions.find((a) => a.status === s)?.n ?? 0;
  const spent = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(payload, '$.amount') AS REAL)),0) AS t FROM audit
       WHERE kind='EXECUTION' AND json_extract(payload,'$.moneyOut')=1`
    )
    .get() as { t: number };
  const inflow = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(payload, '$.amount') AS REAL)),0) AS t FROM audit
       WHERE kind='EXECUTION' AND json_extract(payload,'$.actionType')='invoice'`
    )
    .get() as { t: number };
  // Exact semantics: autonomous = executed WITHOUT a human approval (invoices + in-bounds/standing
  // money-out keyed governed:*/standing:*); human-approved = executions keyed approval:*;
  // gated = every action that passed through the approval queue (approved, denied, expired or pending).
  const autonomous = db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit WHERE kind='EXECUTION' AND
       (json_extract(payload,'$.idempotencyKey') IS NULL OR json_extract(payload,'$.idempotencyKey') NOT LIKE 'approval:%')`
    )
    .get() as { n: number };
  const humanApproved = db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit WHERE kind='EXECUTION' AND json_extract(payload,'$.idempotencyKey') LIKE 'approval:%'`
    )
    .get() as { n: number };
  const gated = db.prepare(`SELECT COUNT(*) AS n FROM approvals`).get() as { n: number };
  return {
    auditRecords: auditRow.n,
    governed: actions.reduce((s, a) => s + a.n, 0),
    allowed: autonomous.n,
    approved: humanApproved.n,
    gated: gated.n,
    blocked: by('BLOCKED') + by('HALTED'),
    moneyOut: Math.round(spent.t * 100) / 100,
    moneyIn: Math.round(inflow.t * 100) / 100,
    haltFlag: isHalted(),
  };
}

export { appendAudit, uid };
