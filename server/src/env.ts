import 'dotenv/config';
import { fileURLToPath } from 'node:url';

function required(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  // fileURLToPath (not URL.pathname) — pathname percent-encodes spaces, which would
  // otherwise create a bogus "Paypal%20Hackathon" directory for the SQLite file.
  dbPath: process.env.DB_PATH ?? fileURLToPath(new URL('../../mandate.db', import.meta.url)),

  paypal: {
    clientId: required('PAYPAL_CLIENT_ID'),
    clientSecret: required('PAYPAL_CLIENT_SECRET'),
    base: process.env.PAYPAL_BASE ?? 'https://api-m.sandbox.paypal.com',
    webhookId: required('PAYPAL_WEBHOOK_ID'),
    /** Sandbox-only: PayPal requires recipients to be real sandbox personal accounts.
     *  Set to your sb-…@personal.example.com address; the ledger still records the logical payee. */
    invoiceRecipient: required('PAYPAL_SANDBOX_RECIPIENT'),
    /** Invoicer identity shown on real invoices (defaults to the demo merchant). */
    invoicerName: process.env.PAYPAL_INVOICER_NAME ?? 'Mandate Demo Merchant',
    invoicerEmail: process.env.PAYPAL_INVOICER_EMAIL ?? 'merchant@mandate.demo',
  },

  llm: {
    anthropicKey: required('ANTHROPIC_API_KEY'),
    openaiKey: required('OPENAI_API_KEY'),
    model: process.env.MANDATE_LLM_MODEL, // e.g. claude-sonnet-4-5 / gpt-4o
  },

  signingSecret: process.env.MANDATE_SIGNING_SECRET ?? 'dev-only-mandate-signing-secret-change-me',

  /** When set, all state-changing /api routes require the `x-mandate-token` header (public deploys). */
  adminToken: required('MANDATE_ADMIN_TOKEN'),

  /** This deployment's public origin (e.g. https://139-84-172-28.sslip.io). When set in SANDBOX
   *  mode, the server self-registers its PayPal webhook on boot — no dashboard copy-paste. */
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '') || undefined,
};

export const paypalMode: 'SANDBOX' | 'MOCK' =
  env.paypal.clientId && env.paypal.clientSecret ? 'SANDBOX' : 'MOCK';

export const llmMode: 'LLM' | 'DETERMINISTIC' =
  env.llm.anthropicKey || env.llm.openaiKey ? 'LLM' : 'DETERMINISTIC';
