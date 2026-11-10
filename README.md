# Mandate — the trust layer for agentic money movement

[![CI](https://github.com/0xv3nm09/mandate/actions/workflows/ci.yml/badge.svg)](https://github.com/0xv3nm09/mandate/actions/workflows/ci.yml)
![use-case suite](https://img.shields.io/badge/use%E2%80%91case%20suite-12%2F12-brightgreen)
![audit chain](https://img.shields.io/badge/audit%20chain-verified%20%C2%B7%2024%20records-success)
![policy violations executed](https://img.shields.io/badge/off%E2%80%91policy%20money%E2%80%91out%20executed-0-success)
![license](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="docs/media/main-paypal.png" alt="Mandate poster: a PayPal-native AI agent that earns, verifies and pays under human-signed limits — agent proposals flow through a deterministic policy engine (ALLOW / GATE / BLOCK), human one-tap approval, PayPal sandbox execution, and a hash-chained audit trail" width="620">
</p>

**Mandate** is a PayPal-native autonomous finance agent that *invoices, collects, and pays out on its own* — wrapped in a deterministic approval gate that makes **every dollar it moves accountable**. Low-risk money-in flows autonomously; risky money-out is checked against a signed policy (an **Intent Mandate**), explained by an AI risk summary, and held for one-tap human approval. Everything lands in a SHA-256 **hash-chained audit log** — and inbound invoices claiming to be from "Netflix" get stamped **VERIFIED** or **IMPOSTOR** by a known-merchant directory check.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) · aligned with **AP2** (Google's Agent Payments Protocol, backed by PayPal): *"verifiable intent, not inferred action — an agent's reasoning is never the authorization; a signed mandate is."*

**Docs:** [PayPal calls](docs/PAYPAL.md) (every endpoint, payload, real response) ·
[Results](docs/RESULTS.md) (12/12 expected-vs-got, rendered from evidence) ·
[Agent](docs/AGENT.md) (modes, tools, verbatim results) ·
[Evidence map](docs/EVIDENCE.md) (criteria → proof, 60-second tour) ·
[Architecture & flows](docs/ARCHITECTURE.md) (12 annotated diagrams) · [Build feedback](docs/FEEDBACK.md)
(every issue faced and its fix) · [System card](SYSTEM_CARD.md) (agent boundaries) ·
[Evidence bundle](evidence/) (raw live-sandbox artifacts)

## PayPal platform surface

| PayPal capability | How Mandate uses it |
| --- | --- |
| **Invoicing v2** | Create (with `Prefer: return=representation` + `PayPal-Request-Id` idempotency) → send → AI-drafted escalating reminders, plus PayPal's **native auto-reminders** configured via `setup-reminders` |
| **Payouts v1** | All money-out executes as idempotent batches (`sender_batch_id` = approval/standing keys); live batch status polled; PayPal-side duplicate detection honored as a no-op |
| **Webhooks** | `verify-webhook-signature` on every inbound event + dedupe by id; `simulate-event` for deterministic live demos |
| **Agent Toolkit** | Official `@paypal/agent-toolkit` attached **read-only** (list/get invoices + disputes) — the agent gets eyes, never hands |
| **AI** | Vercel AI SDK v5 governed tool loop — `propose_payout` ships with **no `execute`**, so the model structurally cannot move money; a deterministic agent is the zero-key fallback |

## For judges — run it in 60 seconds

Zero keys needed. The bundled mock gateway implements PayPal's exact semantics (stateful invoices, idempotent payouts, webhook events), so the entire trust layer runs offline:

```bash
git clone https://github.com/0xv3nm09/mandate && cd mandate/server
npm install && npm run dev        # Node ≥ 24 → http://localhost:8787
```

Then open **Usecases → "Run all 12 sequentially"** — every trace is a real control-plane decision. To exercise the **live PayPal sandbox REST** instead, create free credentials at [developer.paypal.com](https://developer.paypal.com), copy `.env.example` → `.env`, set `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (plus `PAYPAL_SANDBOX_RECIPIENT` = your sandbox personal account email so invoices/payouts route to a real test account), restart — the health pill flips to `SANDBOX` and all money movement hits `api-m.sandbox.paypal.com`.

**Built during the Submission Period:** the entire project was created from Oct 28, 2026 onward (see commit history) — first commit is the scaffold, latest commits are live-sandbox evidence.

## The 30-second architecture

```mermaid
flowchart LR
  U["Operator<br/>console + approval inbox"] --> A["AI Agent<br/>proposes only"]
  A -- "proposal" --> CP["Control Plane<br/>deterministic: policy engine ·<br/>signed mandate · audit chain"]
  CP -- "ALLOW" --> PP["PayPal Sandbox<br/>Invoicing · Payouts"]
  CP -- "GATE" --> INBOX["Human gate<br/>AI risk summary · one tap"]
  CP -- "BLOCK" --> REF["Refused + audited<br/>no bypass"]
  INBOX -- "approve" --> CP
```

**The trust boundary sits between the control plane and PayPal**: money leaves the account only after a policy pass (plus a human approval when gated). The agent holds no PayPal credentials for money movement. **Code owns the facts; the model only writes language** — no LLM call sits anywhere on the decision path, so a hallucination can't move money.

**Full architecture set** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), each diagram annotated with what it proves: system zones · policy decision flowchart · gated-payout and standing-payout sequences · inbound-verification flow · dispute evidence pack sequence · action lifecycle state machine · invoice lifecycle · audit hash-chain construction · data model (ER) · deployment architecture · evidence workflow.

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
- hit **Usecases → “Run all 12 sequentially”** — every scenario executes end-to-end through the real engine and renders the actual trace, or
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

## Results — 12-use-case suite, executed live on the PayPal sandbox (Nov 2026)

**12/12 use cases pass**, machine-collected from the running app (`Usecases → Run all 12`) —
every trace below is a committed artifact in [`evidence/usecases/`](evidence/usecases/), and
the same suite runs in CI (mock gateway) on every push.

| outcome | cases | what that means |
| --- | --- | --- |
| **autonomous path held** | 8 | money-in, mandate re-signing, standing payouts, impostor/subscription checks, audit interrogation, dispute packs — all with zero or bounded human involvement |
| **gate engaged** | 1 | the $500 payout stopped for a human tap, AI risk summary attached, then executed on a real batch |
| **guardrail held** | 3 | off-policy payout blocked with no approval path · kill switch refused a live attempt · "Netflix" impostor stamped IMPOSTOR |

```
verdict mix (live sweep, 12 use cases)

  Autonomous      ████████████████████████████   8   invoice · chase · standing · verify · dispute
  Gate engaged    ████   1   $500 payout → human tap → executed
  Guardrail held  ████████████   3   hard block · kill switch · impostor catch
```

Real money-movement on the live sandbox is committed: payout batch **`CM9XMWV3ZZYFC` settled
to `SUCCESS`** and invoice drafts created against `api-m.sandbox.paypal.com`
([`evidence/paypal-payouts.json`](evidence/paypal-payouts.json)). The one documented gap —
invoice **send** needs `PAYPAL_SANDBOX_RECIPIENT` configured — is written up, not hidden:
[known gaps](docs/FEEDBACK.md#known-gaps--documented-not-hidden).

**At a glance**

- ✅ **Deterministic policy engine** — pure function, zero LLM on the decision path; CI asserts the hard block holds
- ✅ **Signed Intent Mandate** — versioned JWS policy; every decision records the version it used
- ✅ **Hash-chained audit** — 24 records recomputed clean; receipts exportable and independently verifiable
- ✅ **Idempotent money-out** — local keys + PayPal `sender_batch_id`; duplicate-after-reset is a no-op, double-pay is structurally impossible
- ✅ **Official agent-toolkit attached read-only** — the agent can look, never touch
- ✅ **12/12 live suite** — 0 off-policy executions on any attack-shaped case
- ⚠️ **1 documented gap** — invoice send + payout settlement need the sandbox recipient env (honest `CREATED` status + one-click resend until set)

## Trust-layer guarantees (the scored part)

- **Deterministic policy engine** (`server/src/control-plane/policy.ts`) — pure function; ALLOW / GATE / BLOCK with reason codes; hard blocks (unknown payee, currency, daily cap) are un-bypassable by approval.
- **Signed Intent Mandate** (`mandate.ts`) — your policy is a JWS (via `jose`); every edit creates a new signed version; every decision records the version it used.
- **Hash-chained audit** (`audit.ts`) — each record commits to the previous hash; `GET /api/audit/verify` recomputes the whole chain; receipts are exportable + independently verifiable.
- **Idempotent money-out** — every payout carries a unique idempotency key (approval id / standing-week); resubmission can never double-pay.
- **Failure-safe** — PayPal 5xx/timeouts retry with backoff then queue; actions stay PENDING, never silently execute; webhook events are deduped.
- **Kill switch** — global stop halts proposals, freezes approvals, refuses execution (FR-15).

## Stack

React 18 · Vite · TypeScript · Tailwind · AG Grid (community) · Hono · Vercel AI SDK (optional) · `jose` · `node:sqlite` · PayPal REST (Invoicing, Payouts, Webhooks) · SSE.

**AG Grid (sponsor tool) usage:** the hash-chained audit ledger is rendered in AG Grid Community — column sorting/resizing, pagination, pinned receipt-export column, live refresh on SSE events. It is the primary inspection surface for every decision the engine makes (Console → Audit Grid), plus the Invoices table. See `evidence/audit-chain.json` for the data it renders.

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
- **Video (<3 min, YouTube)** — demonstrates the app end-to-end on the sandbox; no third-party trademarks presented as ours (see footer disclaimer).

## Feedback

Build week was not friction-free. Every issue we hit on the PayPal API (HAL-link invoice
responses, `USER_NOT_FOUND` on send, the `sender_batch_id` duplicate 400, the reminder daily
cap), the official toolkit, React/AG Grid/Tailwind, and infra — and how each was resolved —
is written up in [`docs/FEEDBACK.md`](docs/FEEDBACK.md), together with what worked well and
the bugs our own audit loop caught. Feedback matters; the failures are documentation too.

## Documentation map

| Document | What it covers |
| --- | --- |
| [`docs/PAYPAL.md`](docs/PAYPAL.md) | **Every PayPal call** — auth, Invoicing v2, Payouts v1, webhooks, toolkit: literal payloads, real responses, idempotency namespaces, the full error catalog with handling. |
| [`docs/RESULTS.md`](docs/RESULTS.md) | **Live results** — expected-vs-got table (12/12), real PayPal objects, condensed per-UC traces, verdict mix; rendered from evidence by `scripts/render_results_md.py`. |
| [`docs/AGENT.md`](docs/AGENT.md) | **The agent** — both modes, tool contracts (propose-not-execute), parser intents, verbatim results from live runs, and where the model is never allowed. |
| [`docs/EVIDENCE.md`](docs/EVIDENCE.md) | **Criteria → proof map** — each judging criterion mapped to runnable commands and committed artifacts, trust guarantees → evidence, deliverable status, 60-second tour. |
| [`docs/FEEDBACK.md`](docs/FEEDBACK.md) | **Build retrospective** — 16 issues faced and fixed (PayPal API behavior, toolkit, frameworks, infra), what worked well, known gaps documented not hidden. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **12 annotated Mermaid diagrams** — zones + trust boundary, policy decision flow, gated/standing payout + evidence-pack sequences, inbound verification flow, action & invoice lifecycles, hash chain, data model, deployment, evidence workflow — each with a "what it tells you" note. | |
| [`SYSTEM_CARD.md`](SYSTEM_CARD.md) | **System card** — agent identity, the five hard boundaries (no execute on money-out tools, model never decides, human gates, hash-chained audit, kill switch), data behavior, limitations. |
| [`evidence/README.md`](evidence/README.md) | **Evidence bundle guide** — what each JSON artifact proves and how to verify it independently (recompute hashes, check JWS receipts, query PayPal for batch ids). |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | All bundled open-source components and licenses. |
| [`render.yaml`](render.yaml) | Render blueprint — one service, API + console same-origin, env slots documented inline. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | CI — typechecks both packages, boots the server, asserts the hard block + chain verification, builds the web app. |

MIT licensed.
