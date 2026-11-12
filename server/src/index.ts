import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { api } from './routes/api.js';
import { env } from './env.js';
import { ensureMandate } from './control-plane/mandate.js';
import { appendAudit } from './control-plane/audit.js';
import { reconcilePendingPayouts } from './controlPlane.js';
import { paypal } from './paypal/gateway.js';

const app = new Hono();

app.use('*', logger());
// CORS policy: same-origin by default (console served by this service; dev uses the
// Vite proxy). When ALLOWED_ORIGINS is set (comma-separated), those exact origins —
// e.g. the GitHub Pages deployment — may call the API. Never open-wide.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('origin');
  if (origin && allowedOrigins.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'Content-Type, x-mandate-token');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
  }
  await next();
});

app.route('/api', api);

// Serve the built web console (single-service deploy for Render)
app.use('*', serveStatic({ root: '../web/dist' }));
app.get('*', serveStatic({ path: '../web/dist/index.html' }));

const bootstrap = async () => {
  const mandate = await ensureMandate();
  console.log(`
  MANDATE — the trust layer for agentic money movement
  ─────────────────────────────────────────────────────
  PayPal gateway : ${paypal.mode}${paypal.mode === 'MOCK' ? '  (set PAYPAL_CLIENT_ID/SECRET for live sandbox)' : ''}
  Agent mode     : ${env.llm.anthropicKey || env.llm.openaiKey ? 'LLM (AI SDK tool loop)' : 'DETERMINISTIC (rule-based parser — set an LLM key for the AI SDK tool loop)'}
  Intent Mandate : v${mandate.version} signed — per-txn $${mandate.limits.perTxn}, daily cap $${mandate.limits.dailyTotal}
  → http://localhost:${env.port}
`);
  await ensurePaypalWebhook();
  if (paypal.mode === 'SANDBOX') {
    try {
      const n = await reconcilePendingPayouts();
      if (n) console.log(`  Payout reconcile : ${n} pending batch(es) settled from live PayPal status`);
    } catch { /* best-effort */ }
  }
};

// Events the ledger acts on: invoice payments (money-in) and payout settlements (money-out).
const WEBHOOK_EVENT_TYPES = [
  'INVOICING.INVOICE.PAID',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
];

/** Self-register the PayPal webhook when SANDBOX credentials and PUBLIC_BASE_URL are both set:
 *  real events then reach /api/paypal/webhook and pass verify-webhook-signature without any
 *  dashboard copy-paste. Best-effort — a failure never blocks boot. */
async function ensurePaypalWebhook(): Promise<void> {
  if (paypal.mode !== 'SANDBOX' || !env.publicBaseUrl || !paypal.ensureWebhook) return;
  const url = `${env.publicBaseUrl}/api/paypal/webhook`;
  try {
    const hook = await paypal.ensureWebhook(url, WEBHOOK_EVENT_TYPES);
    if (!hook) return;
    env.paypal.webhookId = hook.id;
    console.log(`  PayPal webhook : ${hook.created ? 'registered' : 'adopted'} ${hook.id} → ${url}`);
    if (hook.created) {
      appendAudit({
        kind: 'SYSTEM',
        payload: { event: `PayPal webhook self-registered (${hook.id}) → ${url} — ${WEBHOOK_EVENT_TYPES.length} event types` },
      });
    }
  } catch (e: unknown) {
    console.log(`  PayPal webhook : registration skipped — ${String(e).slice(0, 200)}`);
  }
}

serve({ fetch: app.fetch, port: env.port }, async () => {
  await bootstrap();
});
