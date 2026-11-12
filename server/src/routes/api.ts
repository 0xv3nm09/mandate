// All HTTP routes (Hono). The web console + usecase runner talk to these.

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db, now, uid } from '../db.js';
import { chat } from '../agent/agent.js';
import { approveAndExecute, denyApproval, handlePaypalEvent, getAction } from '../controlPlane.js';
import { listAudit, verifyChain, exportReceipt, dailySpent } from '../control-plane/audit.js';
import {
  currentMandate, ensureMandate, signMandate, verifyMandateJws, listMandateVersions, currentMandateJws,
} from '../control-plane/mandate.js';
import {
  listApprovals, subscribe, isHalted, setHalted, publish,
} from '../control-plane/approvals.js';
import { listInvoices, stats, runStandingPayout, simulateInvoicePaid } from '../services.js';
import { usecaseCatalog, runUsecase } from '../usecases/runner.js';
import { paypalMode, llmMode, env } from '../env.js';
import { paypal } from '../paypal/gateway.js';
import { paypalLog, recordPaypalCall } from '../paypal/journal.js';
import { webhookInfo } from '../paypal/webhook-config.js';
import * as verifyModule from '../control-plane/verify.js';
import * as auditModule from '../control-plane/audit.js';
import * as toolkitModule from '../paypal/toolkit.js';
import type { IntentMandate } from '../types.js';

export const api = new Hono();

// ── Admin-token guard (deployment hardening) ─────────────────────────────────
// Set MANDATE_ADMIN_TOKEN to lock every state-changing route behind the
// `x-mandate-token` header (the web console prompts for it once and retries).
// Leave unset for local development. GETs stay open; the PayPal webhook is
// protected by signature verification instead.
api.use('*', async (c, next) => {
  const mutating = ['POST', 'PUT', 'DELETE'].includes(c.req.method);
  const isWebhook = c.req.method === 'POST' && /\/webhook$/.test(c.req.path);
  if (env.adminToken && mutating && !isWebhook && c.req.header('x-mandate-token') !== env.adminToken) {
    c.header('X-Mandate-Token-Required', '1');
    return c.json({ error: 'admin token required for this action' }, 401);
  }
  await next();
});

api.get('/health', (c) =>
  c.json({
    ok: true,
    mode: { paypal: paypalMode, llm: llmMode },
    halted: isHalted(),
    mandateVersion: currentMandate()?.version ?? null,
    dailySpent: dailySpent(),
    toolkit: toolkitModule.toolkitStatus().available ? { available: true, toolNames: toolkitModule.toolkitStatus().toolNames } : { available: false },
    ts: now(),
  })
);

// ── Agent chat ───────────────────────────────────────────────────────────────
api.post('/chat', async (c) => {
  const { message } = (await c.req.json()) as { message: string };
  if (!message?.trim()) return c.json({ error: 'empty message' }, 400);
  publish('agent.activity', { direction: 'user', text: message });
  const reply = await chat(message);
  publish('agent.activity', { direction: 'agent', text: reply.reply });
  return c.json(reply);
});

// ── Approvals (SSE + resolve) ────────────────────────────────────────────────
api.get('/approvals', (c) => {
  const rows = listApprovals() as { id: string; actionId: string; status: string; explanation: string; policyJson: string; createdAt: string; expiresAt: string; resolvedAt: string | null; resolvedBy: string | null }[];
  return c.json(rows.map((r) => {
    const a = getAction(r.actionId);
    return { ...r, action: a ? { type: a.type, amount: a.amount, currency: a.currency, payee: a.payee, payeeName: a.payeeName, memo: a.memo, status: a.status } : null };
  }));
});
api.post('/approvals/:id/approve', async (c) => {
  const res = await approveAndExecute(c.req.param('id'), 'operator');
  return c.json(res, res.status === 'EXECUTED' || res.status === 'DENIED' ? 200 : 409);
});
api.post('/approvals/:id/deny', (c) => c.json(denyApproval(c.req.param('id'), 'operator')));

api.get('/approvals/stream', (c) =>
  streamSSE(c, async (stream) => {
    let opened = true;
    const unsub = subscribe((e) => {
      if (!opened) return;
      stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) }).catch(() => {
        opened = false;
      });
    });
    stream.writeSSE({ event: 'hello', data: JSON.stringify({ ok: true, mode: { paypal: paypalMode, llm: llmMode } }) });
    // keepalive so proxies don't kill the stream
    const ka = setInterval(() => opened && stream.writeSSE({ event: 'ping', data: '"1"' }).catch(() => { opened = false; }), 15000);
    stream.onAbort(() => {
      opened = false;
      clearInterval(ka);
      unsub();
    });
    // hold the stream open until aborted
    while (opened) await new Promise((r) => setTimeout(r, 200));
  })
);

// ── Mandate (signed policy) ──────────────────────────────────────────────────
api.get('/mandate', async (c) => {
  const mandate = await ensureMandate();
  const versions = listMandateVersions().map((v) => ({ version: v.version, createdAt: v.createdAt, jws: v.jws.slice(0, 48) + '…' }));
  const jws = currentMandateJws();
  const signatureValid = jws ? !!(await verifyMandateJws(jws)) : false;
  return c.json({ mandate, versions, signatureValid, jws });
});

api.put('/mandate', async (c) => {
  // Human-authored change from the Mandate editor → validated + signed as a new version (FR-11/17)
  const body = (await c.req.json()) as { mandate: Partial<IntentMandate>; source?: string };
  const cur = await ensureMandate();
  const next = {
    limits: {
      perTxn: Number(body.mandate.limits?.perTxn ?? cur.limits.perTxn),
      dailyTotal: Number(body.mandate.limits?.dailyTotal ?? cur.limits.dailyTotal),
      currency: cur.limits.currency,
    },
    payeeAllowlist: Array.isArray(body.mandate.payeeAllowlist)
      ? body.mandate.payeeAllowlist.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      : cur.payeeAllowlist,
    standing: body.mandate.standing === null
      ? null
      : body.mandate.standing
        ? { payee: String(body.mandate.standing.payee), payeeName: String(body.mandate.standing.payeeName ?? body.mandate.standing.payee), amount: Number(body.mandate.standing.amount), currency: 'USD', cadence: 'weekly' as const, note: String(body.mandate.standing.note ?? 'Standing weekly payout') }
        : cur.standing,
    issuedAt: now(),
    summary: cur.summary,
  };
  if (next.limits.perTxn < 0 || next.limits.dailyTotal < 0) return c.json({ error: 'limits must be ≥ 0' }, 400);
  const signed = await signMandate(next, { source: body.source ?? 'operator editor (human sign)' });
  return c.json({ mandate: signed });
});

// ── Audit ────────────────────────────────────────────────────────────────────
api.get('/audit', (c) => c.json({ records: listAudit(Number(c.req.query('limit') ?? 200)), verify: verifyChain() }));
api.get('/audit/verify', (c) => c.json(verifyChain()));
api.get('/audit/:seq/receipt', (c) => {
  const receipt = exportReceipt(Number(c.req.param('seq')));
  return receipt ? c.json(receipt) : c.json({ error: 'no such record' }, 404);
});
api.post('/audit/query', async (c) => {
  const { question } = (await c.req.json()) as { question: string };
  const { auditAnswer } = await import('../agent/textgen.js');
  const mandate = await ensureMandate();
  const res = await auditAnswer(
    question ?? 'summarize the trail',
    listAudit(100).map((r) => ({ seq: r.seq, ts: r.ts, kind: r.kind, decision: r.decision, payload: r.payload })),
    { version: mandate.version, limits: mandate.limits, payeeAllowlist: mandate.payeeAllowlist }
  );
  return c.json(res);
});

// ── Invoices / payouts / standing / stats ───────────────────────────────────
api.get('/invoices', (c) => c.json({ invoices: listInvoices() }));
/** Complete a DRAFT invoice's send once the sandbox recipient is configured (USER_NOT_FOUND recovery). */
api.post('/invoices/:id/resend', async (c) => {
  const id = c.req.param('id');
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? OR paypalId = ?').get(id, id) as
    | { id: string; paypalId: string; invoiceNumber: string; payee: string; status: string }
    | undefined;
  if (!inv) return c.json({ error: 'no such invoice' }, 404);
  if (inv.status === 'SENT' || inv.status === 'PAID' || inv.status === 'OVERDUE') return c.json({ ok: true, status: inv.status });
  try {
    const r = await paypal.sendInvoice(inv.paypalId);
    if (r.status !== 'SENT') return c.json({ ok: false, error: r.skipped ?? 'send unavailable' }, 422);
    db.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE id = ?').run('SENT', now(), inv.id);
    publish('invoice.updated', { invoiceId: inv.paypalId, status: 'SENT' });
    return c.json({ ok: true, status: 'SENT' });
  } catch (e: unknown) {
    return c.json({ ok: false, error: String(e).slice(0, 300) }, 422);
  }
});
api.get('/stats', (c) => c.json(stats()));
api.post('/standing/run', async (c) => c.json(await runStandingPayout('chat')));
api.post('/simulate/paid', async (c) => {
  const { payeeName } = (await c.req.json().catch(() => ({}))) as { payeeName?: string };
  return c.json(simulateInvoicePaid(payeeName));
});
api.post('/system/halt', async (c) => {
  const { halted } = (await c.req.json()) as { halted: boolean };
  setHalted(!!halted);
  return c.json({ halted: isHalted() });
});

// ── PayPal webhook ingestion ─────────────────────────────────────────────────
api.post('/paypal/webhook', async (c) => {
  const t0 = Date.now();
  const raw = await c.req.text();
  let body: { id?: string; event_type?: string; resource_id?: string; summary?: string; resource?: Record<string, unknown> };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  // Sandbox hardening: with PAYPAL_WEBHOOK_ID configured, verify the transmission
  // signature against PayPal's verify-webhook-signature endpoint and reject anything
  // unverified. All events are additionally deduped by id (replay-safe).
  if (paypalMode === 'SANDBOX' && env.paypal.webhookId) {
    const ok = await paypal.verifyWebhook({
      transmissionId: c.req.header('paypal-transmission-id') ?? '',
      transmissionTime: c.req.header('paypal-transmission-time') ?? '',
      certUrl: c.req.header('paypal-cert-url') ?? '',
      authAlgo: c.req.header('paypal-auth-algo') ?? '',
      transmissionSig: c.req.header('paypal-transmission-sig') ?? '',
      webhookEvent: JSON.parse(raw),
    });
    if (!ok) {
      recordPaypalCall({ ts: now(), method: 'WEBHOOK', path: '/api/paypal/webhook', status: 403, ms: Date.now() - t0, ok: false, note: `${body.event_type ?? '?'} — signature rejected` });
      return c.json({ error: 'webhook signature verification failed' }, 403);
    }
  }

  recordPaypalCall({ ts: now(), method: 'WEBHOOK', path: '/api/paypal/webhook', status: 200, ms: Date.now() - t0, ok: true, note: `${body.event_type ?? '?'} verified` });

  handlePaypalEvent({
    id: body.id ?? uid(),
    eventType: body.event_type ?? 'UNKNOWN',
    resourceId: body.resource_id,
    summary: body.summary,
    payload: body.resource as Record<string, unknown> | undefined,
  });
  return c.json({ ok: true });
});

// ── Stack tab: live sandbox log + one read-only bundle of live system facts ──
api.get('/paypal/log', (c) => c.json({ log: paypalLog() }));

api.get('/stack', (c) => {
  const one = (sql: string): number => (db.prepare(sql).get() as { c: number } | undefined)?.c ?? 0;
  const group = (sql: string): Record<string, number> =>
    Object.fromEntries((db.prepare(sql).all() as { k: string; c: number }[]).map((r) => [r.k ?? '—', r.c]));
  return c.json({
    mode: { paypal: paypalMode, llm: llmMode },
    webhook: webhookInfo(),
    mandate: (() => {
      const m = currentMandate();
      return m ? {
        version: m.version,
        limits: m.limits,
        payeeAllowlist: m.payeeAllowlist,
        standing: m.standing ?? null,
      } : null;
    })(),
    counts: {
      auditRecords: one('SELECT COUNT(*) c FROM audit'),
      eventsIngested: one('SELECT COUNT(*) c FROM events'),
      invoices: one('SELECT COUNT(*) c FROM invoices'),
      invoicesSent: one("SELECT COUNT(*) c FROM invoices WHERE status IN ('SENT','OVERDUE','PAID')"),
      payoutBatches: one('SELECT COUNT(*) c FROM payouts'),
      payoutBatchesSuccess: one("SELECT COUNT(*) c FROM payouts WHERE status = 'SUCCESS'"),
      approvals: group("SELECT status k, COUNT(*) c FROM approvals GROUP BY status"),
      verifications: group("SELECT verdict k, COUNT(*) c FROM verifications GROUP BY verdict"),
    },
    ruleHits: (db.prepare(
      "SELECT json_extract(payload,'$.reasonCode') k, COUNT(*) c FROM audit WHERE kind = 'ACTION_DECISION' AND json_extract(payload,'$.reasonCode') IS NOT NULL GROUP BY k ORDER BY c DESC"
    ).all() as { k: string; c: number }[]),
    chain: verifyChain(),
    paypalLog: paypalLog(),
    toolkit: toolkitModule.toolkitStatus(),
    // which brain is actually running, for the Stack page's AI panel
    llmModel: llmMode === 'LLM' ? env.llm.model ?? 'gpt-4o' : null,
  });
});

// ── Inbound verification (the Netflix check, FR-21) ──────────────────────────
api.post('/verify/inbound', async (c) => {
  const body = (await c.req.json()) as { brand: string; from: string; fromName?: string; amount: number; currency?: string; memo?: string; channel?: 'email' | 'invoice' | 'message' };
  if (!body.brand || !body.from || typeof body.amount !== 'number') return c.json({ error: 'brand, from, amount required' }, 400);
  const { recordVerification } = await import('../control-plane/verify.js');
  const rec = await recordVerification({
    brand: body.brand, from: body.from, fromName: body.fromName, amount: body.amount,
    currency: body.currency ?? 'USD', memo: body.memo ?? '', channel: body.channel ?? 'email',
  });
  publish('verification.created', { id: rec.id, verdict: rec.verdict });
  return c.json(rec);
});
api.post('/verify/simulate', async (c) => {
  const { scenario } = (await c.req.json()) as { scenario: string };
  const { recordVerification, VERIFY_SCENARIOS } = await import('../control-plane/verify.js');
  const preset = VERIFY_SCENARIOS[scenario];
  if (!preset) return c.json({ error: `unknown scenario; try ${Object.keys(VERIFY_SCENARIOS).join(', ')}` }, 400);
  const rec = await recordVerification(preset.claim);
  publish('verification.created', { id: rec.id, verdict: rec.verdict });
  return c.json(rec);
});
api.get('/verifications', (c) => c.json(verifyModule.listVerifications(Number(c.req.query('limit') ?? 8))));

api.get('/verifications/:id/receipt', (c) => {
  const r = verifyModule.verificationReceipt(c.req.param('id'));
  return r ? c.json(r) : c.json({ error: 'no such verification' }, 404);
});

// ── Dispute evidence packs (FR-22) ───────────────────────────────────────────
api.get('/evidence/:actionId', (c) => {
  const { buildEvidencePack } = verifyModule;
  const pack = buildEvidencePack(c.req.param('actionId'));
  return pack ? c.json(pack) : c.json({ error: 'no such action' }, 404);
});

// ── PayPal toolkit status + sandbox simulate-event ───────────────────────────
api.get('/paypal/toolkit', async (c) => {
  await toolkitModule.readOnlyToolkitTools(); // trigger the (guarded) load
  return c.json({ mode: paypalMode, ...toolkitModule.toolkitStatus() });
});

api.post('/paypal/simulate-event', async (c) => {
  const { eventType } = (await c.req.json()) as { eventType?: string };
  if (paypalMode !== 'SANDBOX') {
    return c.json({ error: 'sandbox-only: set PAYPAL_CLIENT_ID/SECRET, or use POST /api/simulate/paid in mock mode' }, 400);
  }
  if (!env.paypal.webhookId) {
    return c.json({ error: 'PAYPAL_WEBHOOK_ID not set — create a webhook in the developer dashboard first' }, 400);
  }
  const { paypal } = await import('../paypal/gateway.js');
  const gw = paypal as typeof paypal & { simulateEvent?: (id: string, t: string) => Promise<unknown> };
  if (!gw.simulateEvent) return c.json({ error: 'simulate-event only available on the sandbox gateway' }, 400);
  const res = await gw.simulateEvent(env.paypal.webhookId, eventType ?? 'INVOICING.INVOICE.PAID');
  return c.json({ ok: true, res });
});

// ── Static snapshot export (GitHub Pages read-only site) ─────────────────────
api.get('/snapshot', async (c) => {
  const runsRows = db.prepare('SELECT * FROM runs ORDER BY ranAt DESC LIMIT 40').all() as Record<string, unknown>[];
  const runsFull: Record<string, unknown> = {};
  const runs = runsRows.map((r) => {
    const steps = JSON.parse(String(r.trace));
    const item = {
      runId: r.runId, ucId: r.ucId, ucTitle: r.ucTitle, outcome: r.outcome, headline: r.headline,
      steps, auditSeqs: JSON.parse(String(r.auditSeqs)), ranAt: r.ranAt, durationMs: r.durationMs,
    };
    runsFull[String(r.runId)] = item;
    return { ...item, steps: undefined, stepsCount: Number(r.stepsCount) };
  });
  const receipts: Record<string, unknown> = {};
  for (const rec of listAudit(100)) {
    const rc = exportReceipt(rec.seq);
    if (rc) receipts[String(rec.seq)] = rc;
  }
  const mandate_ = currentMandate();
  return c.json({
    generatedAt: now(),
    readonly: true,
    health: { ok: true, mode: { paypal: 'SNAPSHOT', llm: llmMode }, mandateVersion: mandate_?.version ?? null, halted: isHalted() },
    stats: stats(),
    mandate: mandate_,
    catalog: usecaseCatalog(),
    runs, runsFull,
    verifications: verifyModule.listVerifications(10),
    receipts,
    audit: { records: listAudit(100), verify: verifyChain() },
    approvals: listApprovals(),
    invoices: listInvoices(),
  });
});

// ── Usecases (FR-20) ─────────────────────────────────────────────────────────
api.get('/usecases', (c) => c.json({ catalog: usecaseCatalog() }));
api.post('/usecases/:id/run', async (c) => {
  const id = c.req.param('id');
  try {
    return c.json(await runUsecase(id));
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ── Recorded runs (Dashboard feed — every real execution, newest first) ─────
api.get('/runs', (c) => {
  const rows = db
    .prepare(
      `SELECT runId, ucId, ucTitle, outcome, headline, stepsCount, auditSeqs, ranAt, durationMs
       FROM runs ORDER BY ranAt DESC LIMIT 40`
    )
    .all() as { runId: string; ucId: string; ucTitle: string; outcome: string; headline: string; stepsCount: number; auditSeqs: string; ranAt: string; durationMs: number }[];
  return c.json(
    rows.map((r) => ({ ...r, outcome: r.outcome as 'ok' | 'gate' | 'block' | 'error', auditSeqs: JSON.parse(r.auditSeqs) as number[] }))
  );
});
api.get('/runs/:runId', (c) => {
  const row = db.prepare('SELECT * FROM runs WHERE runId = ?').get(c.req.param('runId')) as
    | { runId: string; ucId: string; ucTitle: string; outcome: string; headline: string; stepsCount: number; auditSeqs: string; trace: string; ranAt: string; durationMs: number }
    | undefined;
  if (!row) return c.json({ error: 'no such run' }, 404);
  return c.json({
    runId: row.runId, ucId: row.ucId, ucTitle: row.ucTitle, outcome: row.outcome, headline: row.headline,
    stepsCount: row.stepsCount, auditSeqs: JSON.parse(row.auditSeqs), steps: JSON.parse(row.trace),
    ranAt: row.ranAt, durationMs: row.durationMs,
  });
});

// ── Demo hygiene ─────────────────────────────────────────────────────────────
/** Demo utility: zero the daily-cap counter (audited). */
api.post('/system/reset-cap', (c) => {
  const resetDailyCap = auditModule.resetDailyCap;
  return c.json({ ok: true, resetAt: resetDailyCap(), note: 'money-out counter back to $0 for today' });
});

api.post('/system/reset', (c) => {
  for (const t of ['actions', 'audit', 'approvals', 'invoices', 'payouts', 'events', 'mandates', 'runs', 'verifications', 'meta']) {
    db.exec(`DELETE FROM ${t}`);
  }
  void ensureMandate();
  publish('system.reset', { ok: true });
  return c.json({ ok: true });
});
