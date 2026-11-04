# Mandate — the trust layer for agentic money movement

**Mandate** is a PayPal-native autonomous finance agent that *invoices, collects, and pays out on its own* — wrapped in a deterministic approval gate that makes **every dollar it moves accountable**. Low-risk money-in flows autonomously; risky money-out is checked against a signed policy (an **Intent Mandate**), explained by an AI risk summary, and held for one-tap human approval. Everything lands in a SHA-256 **hash-chained audit log**.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) · aligned with **AP2** (Google's Agent Payments Protocol, backed by PayPal): *"verifiable intent, not inferred action — an agent's reasoning is never the authorization; a signed mandate is."*

## The 30-second architecture

```
You (operator) ──► AI Agent ──PROPOSES──► Control Plane ──ALLOW──► PayPal (sandbox)
 (React)          (LLM or        │         (deterministic:  │
                   rule-based)   │          policy engine ·  ├─GATE──► approval inbox → one-tap approve/deny
                                 │          signed mandate ·  │
                                 └─never────┘ approval queue ·  └─BLOCK──► refused + logged, no bypass
                                            hash-chained audit)
```

**Code owns the facts; the model only writes language.** No LLM call sits anywhere on the decision path — a hallucination can't move money.

## Quick start (zero external keys needed)

```bash
# 1. server (Node ≥ 24 — uses the built-in node:sqlite)
cd server
npm install
npm run dev          # → http://localhost:8787 (serves the web app too)

# 2. web (only if you want to develop the UI with HMR)
cd ../web
npm install
npm run dev          # → http://localhost:5173 (proxies /api to :8787)
```

That's it — with no env vars the app runs in **full demo mode**: a stateful `MockPayPal` gateway (identical semantics to the real REST client, including webhook events) and a deterministic NL parser drive the exact same control plane as live mode.

Then open **http://localhost:8787** and either:
- hit **Usecases → “Run all 9 sequentially”** — every scenario executes end-to-end through the real engine and renders the actual trace, or
- chat with the agent in the **Console** (suggestion chips included).

### Live PayPal sandbox (optional)

1. Create sandbox business + personal accounts at [developer.paypal.com](https://developer.paypal.com/).
2. Copy `server/.env.example` → `server/.env`, fill `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (+ `PAYPAL_WEBHOOK_ID` after adding a webhook pointing at `POST /api/paypal/webhook`).
3. Restart the server — the health pill switches to `SANDBOX` and all money movement goes through `api-m.sandbox.paypal.com`.

### LLM mode (optional)

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) to upgrade the agent from the deterministic parser to a Vercel AI SDK tool loop. Either way the agent can only **propose** — the control plane decides.

## Try these in the Console

| Say | What happens |
|---|---|
| “Invoice Acme $1,200 for October design” | Invoice created + sent autonomously (money-in) |
| “Chase Acme” | AI-drafted reminder, tone escalates per attempt |
| “simulate paid from Acme” | Fires the real `INVOICING.INVOICE.PAID` webhook path |
| “Pay contractor Sam $500” | **GATE** → AI risk summary → approve in the inbox → payout executed |
| “Pay NewVendor $800” | **BLOCKED** — payee not on the signed allowlist; no approval exists |
| “Cap daily at $500” / “Pay Vita $300 weekly” | Agent drafts the mandate diff → **you sign** a new version (UC-07) |
| “Run standing” | Pre-authorized weekly payout runs with **no human in the loop**; drift → gate (UC-08) |
| “Why was anything blocked?” | Interrogate the hash-chained trail + counterfactual + signed receipt (UC-09) |

## Trust-layer guarantees (the scored part)

- **Deterministic policy engine** (`server/src/control-plane/policy.ts`) — pure function; ALLOW / GATE / BLOCK with reason codes; hard blocks (unknown payee, currency, daily cap) are un-bypassable by approval.
- **Signed Intent Mandate** (`mandate.ts`) — your policy is a JWS (via `jose`); every edit creates a new signed version; every decision records the version it used.
- **Hash-chained audit** (`audit.ts`) — each record commits to the previous hash; `GET /api/audit/verify` recomputes the whole chain; receipts are exportable + independently verifiable.
- **Idempotent money-out** — every payout carries a unique idempotency key (approval id / standing-week); resubmission can never double-pay.
- **Failure-safe** — PayPal 5xx/timeouts retry with backoff then queue; actions stay PENDING, never silently execute; webhook events are deduped.
- **Kill switch** — global stop halts proposals, freezes approvals, refuses execution (FR-15).

## Stack

React 18 · Vite · TypeScript · Tailwind · AG Grid (community) · Hono · Vercel AI SDK (optional) · `jose` · `node:sqlite` · PayPal REST (Invoicing, Payouts, Webhooks) · SSE.

## Repo layout

```
server/src/
  control-plane/   policy.ts (pure engine) · mandate.ts (JWS) · audit.ts (hash chain) · approvals.ts (queue+SSE)
  paypal/          gateway.ts (SANDBOX + MOCK behind one interface)
  agent/           parser.ts (deterministic NL) · textgen.ts (language-only LLM) · agent.ts (facade)
  usecases/        runner.ts (UC-01…UC-09 end-to-end with traces)
  routes/api.ts    all HTTP routes
web/src/components/  Home · Console · AgentConsole · ApprovalInbox · AuditGrid · MandateEditor · Usecases
```

## Deploy

### Render (full app: API + console, recommended for judges)

`render.yaml` is included — push the repo → Render → New → Blueprint. The web service builds the console, serves it and the API from one origin.

### GitHub Pages (static console, like a demo site)

The build is portable (`base: './'`, hash routing — no server rewrites needed):

```bash
cd web
VITE_API_BASE=https://your-mandate.onrender.com npm run build   # point the static site at the backend
```

Then publish the repo to GitHub and enable **Pages → Deploy from branch → root**. The root `index.html` stub redirects visitors into `web/dist/index.html` carrying the hash (e.g. `…/mandate/#usecases`). On the backend, set `ALLOWED_ORIGINS=https://<user>.github.io` so the Pages origin may call the API (admin token still guards mutations).

## Notes

- Demo money only — sandbox/mock; no real funds move. Mandate is an independent hackathon project, not affiliated with or endorsed by PayPal.

## Hackathon rules compliance (judge checklist)

- **Meaningful PayPal use** — three layers: (1) the official [`@paypal/agent-toolkit`](https://developer.paypal.com/ai-tools/toolkit) attached read-only (list/get invoices + disputes — `GET /api/paypal/toolkit` shows status); (2) documented PayPal REST used directly for everything money-moving — Invoicing v2 (create/send/remind), Payouts v1 with `sender_batch_id` idempotency, `verify-webhook-signature`, `simulate-event` — all sandbox-first per PayPal's quickstart; (3) PayPal's own best practices implemented: env-var secrets, system-prompt agent control, human oversight where judgment matters, error handling.
- **Meaningful AI use** — Vercel AI SDK v5 tool loop (a PayPal-supported framework) with governed tools (`propose_payout` has no `execute`, by design), LLM-written risk explanations / reminders / mandate drafts, NL audit interrogation (UC-09), and a deterministic fallback agent so the trust layer never depends on a model.
- **Functional demo** — hosted URL (Render blueprint included) or copy-paste repo run steps: `cd server && npm i && npm run dev`.
- **Open source + license** — MIT at repo root; make it visible in the GitHub About/sidebar.
- **Video (<3 min, YouTube)** — script in the build workbook §14; no third-party trademarks presented as ours (see footer disclaimer).

MIT licensed.
