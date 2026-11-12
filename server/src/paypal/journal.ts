// PayPal call journal — powers the live "sandbox log" on the Stack tab.
// Every real HTTP call the sandbox gateway makes (and every inbound webhook delivery)
// is recorded here, published on the SSE bus as `paypal.call`, and persisted to SQLite
// so the last calls survive restarts. Last N only — this is an operations surface,
// not an audit record (the hash-chained ledger stays the truth).

import { db, now } from '../db.js';
import { publish } from '../control-plane/approvals.js';

export type PaypalCallEntry = {
  ts: string;
  method: string; // GET | POST | WEBHOOK
  path: string;   // /v2/invoicing/invoices · /v1/payments/payouts · /api/paypal/webhook
  status: number; // HTTP status (0 = network error / timeout)
  ms: number;
  ok: boolean;
  note?: string;  // e.g. event type on webhook deliveries, retry marker
};

const RING: PaypalCallEntry[] = [];
const MAX = 120;

// Lazy schema + boot seed: the panel shows the last 8 calls immediately after a restart.
db.exec(`CREATE TABLE IF NOT EXISTS paypal_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  note TEXT
)`);
for (const r of db
  .prepare('SELECT ts, method, path, status, ms, ok, note FROM paypal_calls ORDER BY id DESC LIMIT 8')
  .all() as { ts: string; method: string; path: string; status: number; ms: number; ok: number; note: string | null }[]) {
  RING.push({ ts: r.ts, method: r.method, path: r.path, status: r.status, ms: r.ms, ok: !!r.ok, ...(r.note ? { note: r.note } : {}) });
}

export function recordPaypalCall(e: PaypalCallEntry): void {
  RING.unshift(e);
  if (RING.length > MAX) RING.length = MAX;
  db.prepare('INSERT INTO paypal_calls (ts, method, path, status, ms, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(e.ts, e.method, e.path, e.status, e.ms, e.ok ? 1 : 0, e.note ?? null);
  publish('paypal.call', e);
}

export function paypalLog(): PaypalCallEntry[] {
  return RING.slice(0, 80);
}
