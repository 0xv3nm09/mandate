// The webhook this deployment listens on: one source of truth for the boot-time
// self-registration (index.ts) and the Stack tab's "PayPal rails" panel.

import { env } from '../env.js';

export const WEBHOOK_EVENT_TYPES = [
  'INVOICING.INVOICE.PAID',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
];

export function webhookInfo(): { id: string | null; url: string | null; eventTypes: string[] } {
  return {
    // env.paypal.webhookId is set at runtime by boot-time self-registration — process.env
    // never sees it, so read the env object.
    id: env.paypal.webhookId || null,
    url: env.publicBaseUrl ? `${env.publicBaseUrl}/api/paypal/webhook` : null,
    eventTypes: WEBHOOK_EVENT_TYPES,
  };
}
