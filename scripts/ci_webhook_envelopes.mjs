#!/usr/bin/env node
// Regression test for PayPal webhook envelopes — runs against a booted server (mock gateway).
// Usage: node scripts/ci_webhook_envelopes.mjs [baseUrl]   (default http://localhost:8787)
//
// Every shape below was taken from a real signed sandbox delivery (evidence/webhooks.json):
// PayPal's envelope has NO top-level resource_id, batch and item payout events keep the batch
// id in different places, and delivery order is not guaranteed. Each of those bit us once.
const BASE = process.argv[2] ?? 'http://localhost:8787';
const token = process.env.MANDATE_ADMIN_TOKEN;
const hdr = { 'Content-Type': 'application/json', ...(token ? { 'x-mandate-token': token } : {}) };
const j = async (path, body) => {
  const r = await fetch(BASE + path, body ? { method: 'POST', headers: hdr, body: JSON.stringify(body) } : { headers: hdr });
  return r.json();
};
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const run = Date.now().toString(36);
const webhookRecords = async () => (await j('/api/audit?limit=200')).records.filter((r) => r.kind === 'WEBHOOK');
const hook = (id, event_type, resource) => j('/api/paypal/webhook', { id: `WH-CI-${run}-${id}`, event_type, resource });

// ── invoices: the id lives at resource.id (observed) or resource.invoice.id (v2 envelope) ──
await j('/api/chat', { message: 'Invoice Acme $180 for sprint work' });
await j('/api/chat', { message: 'Invoice Globex $240 for the monthly retainer' });
const [invB, invA] = (await j('/api/invoices')).invoices; // newest first
check('two invoices created', Boolean(invA?.paypalId && invB?.paypalId));

await hook('inv-a', 'INVOICING.INVOICE.PAID', { id: invA.paypalId, status: 'PAID' });
await hook('inv-b', 'INVOICING.INVOICE.PAID', { invoice: { id: invB.paypalId, status: 'PAID' } });
const invoices = (await j('/api/invoices')).invoices;
check('INVOICE.PAID with resource.id marks the invoice PAID', invoices.find((i) => i.paypalId === invA.paypalId)?.status === 'PAID');
check('INVOICE.PAID with resource.invoice.id marks the invoice PAID', invoices.find((i) => i.paypalId === invB.paypalId)?.status === 'PAID');

const before = (await webhookRecords()).length;
await hook('inv-a', 'INVOICING.INVOICE.PAID', { id: invA.paypalId, status: 'PAID' }); // same event id
check('replayed event id is deduped', (await webhookRecords()).length === before);

// ── payouts: item events never invent a batch status; only FAILED changes the row ──
const batchOf = async (message) => ((await j('/api/chat', { message })).reply.match(/batch ([\w-]+)/) ?? [])[1];
const b1 = await batchOf('Pay Vita $25 for errands');
const b2 = await batchOf('Pay contractor Sam $30 for edits');
check('two autonomous payouts executed', Boolean(b1 && b2), `${b1} ${b2}`);

// item event first, batch event second — the order PayPal used on batch 7CB7GVMMZTRL8
await hook('item-1', 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED', { payout_batch_id: b1, payout_item_id: 'ITEM-CI-1', transaction_status: 'UNCLAIMED' });
await hook('batch-1', 'PAYMENT.PAYOUTSBATCH.SUCCESS', { batch_header: { payout_batch_id: b1, batch_status: 'SUCCESS' } });
await hook('item-2', 'PAYMENT.PAYOUTS-ITEM.FAILED', { payout_batch_id: b2, payout_item_id: 'ITEM-CI-2', transaction_status: 'FAILED' });

const recs = await webhookRecords();
const find = (type, batch) => recs.find((r) => r.payload.eventType === type && r.payload.resourceId === batch)?.payload;
const unclaimed = find('PAYMENT.PAYOUTS-ITEM.UNCLAIMED', b1);
check('ITEM.UNCLAIMED is audited with itemStatus', unclaimed?.itemStatus === 'UNCLAIMED');
check('ITEM.UNCLAIMED does not fabricate a batch status', unclaimed !== undefined && unclaimed.status === undefined);
check('PAYOUTSBATCH.SUCCESS sets the batch status', find('PAYMENT.PAYOUTSBATCH.SUCCESS', b1)?.status === 'SUCCESS');
const itemFailed = find('PAYMENT.PAYOUTS-ITEM.FAILED', b2);
check('ITEM.FAILED marks the payout FAILED', itemFailed?.status === 'FAILED' && itemFailed?.itemStatus === 'FAILED');

check('audit chain still verifies', (await j('/api/audit/verify')).ok === true);

if (failed) { console.error(`\n${failed} webhook envelope check(s) failed`); process.exit(1); }
console.log('\nwebhook envelopes: all checks passed');
