// In-memory PayPal call journal — powers the live "sandbox log" on the Stack tab.
// Every real HTTP call the sandbox gateway makes (and every inbound webhook delivery)
// is recorded here and published on the SSE bus as `paypal.call`. Last N only — this
// is an operations surface, not an audit record (the hash-chained ledger stays the truth).

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

export function recordPaypalCall(e: PaypalCallEntry): void {
  RING.unshift(e);
  if (RING.length > MAX) RING.length = MAX;
  publish('paypal.call', e);
}

export function paypalLog(): PaypalCallEntry[] {
  return RING.slice(0, 80);
}
