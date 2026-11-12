# Feedback — the complete build retrospective

Build week was not friction-free. This document is the full record: **31 numbered issues** across
PayPal platform behavior, our own product bugs, framework friction, and the live deployment — plus
the build timeline, the decisions that held up, what worked, and the gaps we chose to document
instead of hide. The failures are documentation too: most of them ended up as product features or
hardened paths rather than patches.

**How to read it:** sections are grouped by where the issue came from; numbers are unique across
the whole document (so "issue #21" means the same thing everywhere). Every fix names the file it
lives in. Nothing here is aspirational — if it's listed as fixed, it shipped and was verified
against the live sandbox or CI.

---

## The build, in five phases

| Phase | When | What happened |
| --- | --- | --- |
| **1 — Control plane first** | Oct 28–30 | The deterministic policy engine (`policy.ts`, R-00…R-09), hash-chained audit, approvals with TTL, and the stateful **mock PayPal gateway** were built before any real PayPal call existed — so the trust layer could be tested offline from day one |
| **2 — PayPal sandbox live** | Oct 31 – Nov 4 | Real REST wired behind the same interface: Invoicing v2, Payouts v1, webhooks, the official agent-toolkit (read-only). First real invoice created, first payout batch executed |
| **3 — Product surfaces** | Nov 4–10 | Home, Dashboard, Usecases (12 scripted end-to-end runs), Console — both AG Grids, SSE live updates, evidence bundle, deep docs, GitHub repo (history scrubbed of everything non-product) |
| **4 — Deployment** | Nov 11–12 | Read-only GitHub Pages snapshot mode; full stack on a Vultr VM with Caddy auto-HTTPS; webhook self-registration at boot; PayPal Sandbox API log surfaced live in the UI |
| **5 — LLM live** | Nov 12 | The agent's LLM moved to **Vultr Serverless Inference** (`kimi-k2-instruct`) on the same credits as the VM — tool-calling verified, measured, and the deterministic fallback proven by a real provider rejection. The full 12-suite ran green in LLM mode |

---

## PayPal platform — issues faced and fixed

| # | Issue | Symptom | Fix | Where |
| --- | --- | --- | --- | --- |
| 1 | **Invoicing v2 create returns a HAL link, not an `id`** | `POST /v2/invoicing/invoices` responded with a bare self-link; our client read `body.id` → `undefined` → send hit `/invoices/undefined/send` (404) | Send `Prefer: return=representation` (docs: makes 201 return the full body) **and** parse both shapes — `id` or last path segment of `href` | [`paypal/gateway.ts`](../server/src/paypal/gateway.ts) `createInvoice` |
| 2 | **Invoice `send` 422 `USER_NOT_FOUND`** | Sandbox refuses to send invoices to synthetic emails (`acme@client.test`); only real sandbox personal accounts are valid recipients | `PAYPAL_SANDBOX_RECIPIENT` routing: invoices/payouts go to the configured test account while the ledger records the *logical* payee; failures degrade gracefully (status `CREATED` + a resend route), never fail the use case. Later hardened: with no recipient configured the send is skipped up front (#18) | `gateway.ts`, `routes/api.ts` |
| 3 | **Duplicate `sender_batch_id` 400 after a demo reset** | After wiping the local ledger, a same-week standing payout hit "Batch with given sender_batch_id already exists" — PayPal's idempotency window outlives our SQLite | Treat that exact 400 as an **idempotent no-op**: audit an `EXECUTION` with `moneyOut: 0` and `duplicateOf: <batch>`; every other gateway failure marks the action `FAILED` and surfaces (FR-14) | `controlPlane.ts` `executePayout` |
| 4 | **Sandbox payout batches settle asynchronously** | UC-12 (dispute pack) demanded `status=SUCCESS` from our DB and errored — real batches settle in minutes, not milliseconds | Poll the live batch (`GET /v1/payments/payouts/{id}`) and build the evidence pack from any state honestly; on one run the batch had genuinely settled `SUCCESS` | `usecases/runner.ts` UC-12 |
| 5 | **Reminders have a hard daily cap** | Docs: "API caller can send only 2 reminders in a day" — our escalating-reminder demo trips it | Catch the 422, audit it as `SYSTEM`, and surface the rejection honestly instead of failing. Reminders for never-delivered invoices are held up front (#18) | `services.ts` `sendReminder` |
| 6 | **`PayPalAgentToolkit` constructor throws without context** | `new PayPalAgentToolkit({clientId, clientSecret, configuration})` → `TypeError: Cannot read properties of undefined (reading 'context')` | `configuration.context: { sandbox: true }` is required, not optional in practice — and we filter `getTools()` to `/^(list|get)_/` so the model only ever gets read-only eyes | `paypal/toolkit.ts` |
| 7 | **The toolkit exposes no Payouts tools** | Its surface is invoices/orders/disputes — money-out is not included | Payouts go through documented Payouts v1 REST directly — which is also the governance point: the agent never gets an executable money-movement tool at all | `gateway.ts`, `agent/agent.ts` |
| 30 | **AE-country sandbox recipient → invoice send `USER_NOT_FOUND`, even with valid accounts** | The invoice was fully correct, invoicer and recipient both real sandbox accounts — but the recipient account was created under `AE`, a region PayPal Invoicing does not support in sandbox. Send refused with `USER_NOT_FOUND` regardless | Create a **US** personal sandbox account as the recipient; send returned `200` and the invoice delivered end-to-end | `developer.paypal.com` → Sandbox → Accounts (region matters more than account existence) |

## Product bugs found by our own audit loop

| # | Bug | Found by | Fix |
| --- | --- | --- | --- |
| 8 | **Standing-payout weekly idempotency was a no-op** — the pre-check queried a key the executor never wrote, so "one run per week" didn't hold | external code review | The per-week key (`standing:<payee>:<isoWeek>`) now flows into `executePayout` as the `sender_batch_id`; the DB pre-check matches reality |
| 9 | **Lookalike-domain detector compared the wrong label** — `netflix-payments.com` was split so `com` got compared to `netflix` | UC-10 returned SUSPICIOUS instead of IMPOSTOR | Compare base labels (`netflix-payments` vs `netflix`) with containment + edit-distance ≤ 2 |
| 10 | **Open CORS on all `/api/*`** — plus no auth on state-changing routes | review | CORS removed (same-origin + Vite proxy); optional `MANDATE_ADMIN_TOKEN` guards every mutating route; webhook protected by signature verification instead |
| 11 | **Stats overstated autonomy** — "executed autonomously" counted human-approved payouts | review | Semantics made exact: autonomous = executions with no `approval:*` idempotency key; the gate count comes from the approvals table |
| 12 | **SQLite path percent-encoded** — `new URL(...).pathname` turned "Paypal Hackathon" into `Paypal%20Hackathon`, silently creating a bogus directory | DB inspection | `fileURLToPath`; the stray directory was migrated then removed |
| 20 | **`verify-webhook-signature` had never actually run** — the request carried an undocumented `transfer_type` field, so PayPal rejected every verification call and every real webhook was refused (403); the failures were swallowed silently | first real delivery on the deployed VM — PayPal kept retrying, every attempt 403 | field removed; failures now logged with PayPal's `debug_id`; proven with a signed `simulate-event` delivery → `200` ([PAYPAL §4.3](PAYPAL.md)) |
| 21 | **Webhook handlers assumed their own internal event shape** — they read a top-level `resource_id` that PayPal's envelope doesn't have (the invoice id lives at `resource.id`), read `tx_status` where PayPal sends `transaction_status` (an item event could fabricate a batch `SUCCESS`), and never recorded real event ids for dedupe | envelope shapes inspected from signed sandbox deliveries ([`evidence/webhooks.json`](../evidence/webhooks.json)) | handlers normalized per event family (batch vs item vs invoice); item events never invent a batch status; every accepted event is recorded before processing; shapes locked by [`scripts/ci_webhook_envelopes.mjs`](../scripts/ci_webhook_envelopes.mjs) on every CI push |
| 25 | **LLM replies with no tool call crashed scripted use-case runners (HTTP 500)** — runners read `actions[0].decision`; on the LLM path a model reply without any tool call left `actions` empty | running the 12-suite in full LLM mode | `llmChat` throws when the model emits zero tool calls → `chat()` degrades to the deterministic parser for that message; runners additionally tolerate an empty `actions` array with a clear error step |
| 26 | **`create_invoice`'s tool result was a trimmed shape** — `{ status, decision: reasonCode, paypalRef }` while runners read the full `.decision` / `.execution` objects, so LLM-mode invoice runs crashed *after* the invoice was really created | same suite run | the tool returns the full `HandleResult` (`{ ...res, kind: 'invoice' }`) and `llmChat` surfaces executed tool results into `actions[]` — runners see the identical shape in both brain modes |

## Framework / tooling friction

| # | Issue | Fix |
| --- | --- | --- |
| 13 | **`ag-grid-react` cell renderers that return DOM nodes crash React** (error #31: "Objects are not valid as a React child") — the AG Grid docs show DOM-based renderers, React wrappers need JSX | Renderers return JSX components ([`AuditGrid.tsx`](../web/src/components/AuditGrid.tsx)) |
| 14 | **Custom single-value Tailwind colors shadow the default palette** — `teal: '#14b8a6'` silently kills `from-teal-400`-style shade utilities (half our gradients vanished) | Define colors as `{ DEFAULT, 400, 500, 600 }` objects |
| 15 | **SSE streams die behind proxies** | 15-second keepalive ping on the approval stream (survives Render's proxy) |
| 16 | **Mermaid on GitHub is picky** — angle-bracket text in sequence messages is swallowed as HTML, pipes in node labels break parsing | Diagram set hardened (docs/ARCHITECTURE.md renders 12/12) |
| 23 | **AI SDK v5's OpenAI provider defaults to `/responses`** — OpenAI's newer endpoint, which OpenAI-compatible providers (Vultr Serverless Inference, Groq, Together…) don't serve: every LLM call 404'd even with valid auth | Call `openai.chat(model)` — the classic `/chat/completions` with tools; found the moment a third-party provider was wired (`OPENAI_BASE_URL`), logged with the provider's error body ([docs/AI.md §7](AI.md)) |
| 27 | **AI SDK v5 `TypedToolResult` exposes tool output as `output`, not `result`** — our tool-result scans (create_invoice → `actions[]`, send_reminder → `ui.reminder`) read `undefined` until checked against the installed `ai@5.0.282` type definitions | scans read `step.toolResults[].output`; verified against the shipped `.d.ts`, not assumed |
| 28 | **AG Grid viewport squeezed to 0 px** — `flex-1` on the grid wrapper plus the floating-filter row collapsed `ag-body-viewport` (rows in the DOM, zero pixels visible) | explicit heights (`h-[540px]` audit, `h-[460px]` invoices) instead of flex-squeeze |

## Live deployment — issues faced on the Vultr VM

| # | Issue | Symptom | Fix |
| --- | --- | --- | --- |
| 17 | **Sandbox sender balance drained** | Repeated demo payouts emptied the business test account → `422 INSUFFICIENT_FUNDS` on `/v1/payments/payouts` | FR-14 did its job (execution marked `FAILED`, audited, nothing retried silently). Balance topped up in the developer dashboard — there is no funds API, and a test-card top-up through `/v2/checkout/orders` is refused with `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` (a payee-capability error raised at order create, before any card is evaluated). Next payouts settled `SUCCESS` |
| 18 | **Doomed calls polluted PayPal's API log** | Every invoice run without a real sandbox recipient produced a guaranteed 422 on `send` / `remind` — handled gracefully, but the developer dashboard's error count grew with each run | Check the precondition first: `sendInvoice` / `remindInvoice` return `{ status, skipped }` instead of calling PayPal, and the trace reads "drafted — delivery held" rather than claiming a send ([`paypal/gateway.ts`](../server/src/paypal/gateway.ts), [`services.ts`](../server/src/services.ts)) |
| 19 | **Caddy served its default site after first boot** | apt auto-starts Caddy with the stock `:80` Caddyfile during install, before the deploy script writes the sslip.io site block — HTTPS never came up and the hostname 404'd | Deploy scripts `restart` Caddy after writing the config (a `reload` raced the auto-start); the Let's Encrypt cert then issued via TLS-ALPN in seconds |
| 22 | **The deployed VM had no `MANDATE_ADMIN_TOKEN`** — every mutating route on the public URL was open (chat → payouts, approvals, resets) | `.env` audit of the live instance | token set; the console prompts once, remembers it and retries; the public demo's token is documented in the README "See it two ways" section — sandbox money, the guard demonstrates the pattern |
| 24 | **Invoice send `USER_NOT_FOUND` with a valid recipient — the missing user was the *invoicer*** | A placeholder sender identity (`merchant@mandate.demo`): send resolves **both** parties, and a fake sender is a missing user too | `PAYPAL_INVOICER_EMAIL` set to the app's own business sandbox account; the very next send returned `SENT` ([PAYPAL.md error-catalog row 8](PAYPAL.md)) |
| 25 | **Deploying `server/.env` from the laptop overwrote VM-only env vars** — the scp of the local `.env` silently wiped the Vultr Inference keys (and briefly took LLM mode offline) | health flipped to `deterministic` after a deploy | VM env files are edited in place (`sed`) or merged; never whole-file copied. Config is per-machine by design |
| 29 | **Remind on a never-delivered invoice is a deterministic 422** — the demo's overdue hack can mark a locally-`OVERDUE` invoice that PayPal still holds as DRAFT; the reminder call can never succeed | the live API log showed repeated `remind → 422` on the same invoice | `sendReminder` checks the **live** invoice status before calling (a DRAFT is held up front with the true reason), and rejection texts quote PayPal verbatim instead of guessing "daily cap" |
| 31 | **The API-log panel emptied on every service restart** — the in-memory call journal died with the process, so the Stack page's "sandbox log" showed one lonely boot row | operator report after a restart | the journal persists to SQLite (`paypal_calls`) and the ring re-seeds with the last 8 entries at boot — history survives restarts, verified |

## What worked well

- **The dual gateway was the single best decision.** One interface, sandbox-REST and
  stateful-mock implementations — the demo cannot break for missing keys, and every trust-layer
  behavior is identical in both modes. Judges can run the whole control plane offline.
- **The evidence loop.** Every claim in the README is an artifact in `evidence/` regenerated
  from real runs — when UC-12 tripped on asynchronous settlement, it was caught because the
  suite re-runs against the live sandbox, not because someone read the code.
- **Pure-function policy engine.** Zero I/O, zero model calls — which made "the LLM never
  decides" verifiable by inspection rather than by promise. It also made the **LLM mode swappable**:
  pointing the agent at a different provider was a one-variable change, because the model was never
  trusted with anything but language.
- **Idempotency everywhere money moves.** Local keys + PayPal's own `sender_batch_id`
  semantics caught each other's blind spots (issue #3 is exactly that interaction).
- **CI as a regression harness, not a linter.** The workflow boots the server and attacks it:
  UC-04 must block, the chain must verify, and the real PayPal webhook envelope shapes are replayed
  every push ([`scripts/ci_webhook_envelopes.mjs`](../scripts/ci_webhook_envelopes.mjs)). Issues #20,
  #21 and #25 are exactly the class of bug that harness now catches.
- **The whole stack on one cloud bill.** App, database, HTTPS, and now the LLM (Vultr Serverless
  Inference) run on the same Vultr credits — measured, not claimed: gated payout 4.2 s, policy
  interrogation 2.3 s ([docs/AI.md §7](AI.md)).
- **Honest surfaces beat polished ones.** The live API log shows 4xx rows when PayPal refuses
  something, traces say "delivery held" when a reminder can't be sent, and `UNCLAIMED` payout items
  are explained in place. Judges can trust the green rows because the red ones are visible.

## Known gaps — documented, not hidden

- Invoice **send** requires a real sandbox recipient (`PAYPAL_SANDBOX_RECIPIENT`) — without it,
  UC-01 records `CREATED` with a one-click resend, and reminders are held with an accurate reason (#18).
- **Recipient region matters:** sandbox accounts in unsupported regions (our first recipient was
  `AE`) reject send with `USER_NOT_FOUND` even though the account exists (#30). A US personal
  account delivers end-to-end.
- **Payout items read `UNCLAIMED`** — payees are placeholder addresses, so batches settle `SUCCESS`
  sender-side while no account receives the funds. `SUCCESS` here means "batch processed"; the
  ledger records item outcomes separately.
- Single-operator product: no multi-user auth yet; SQLite storage (Postgres swap is
  documented); HMAC signing keys (production would use a KMS); full-chain verify is O(n)
  (production would anchor checkpoints).
- The **reminder daily cap (2/invoice/day) is PayPal-side** — repeated demo runs surface it
  honestly rather than working around it.
- The public demo's **admin token is intentionally published** (README): sandbox money, and the
  guard demonstrates the pattern. Production deployments generate their own and never publish it.

---

## The numbers, at time of writing

Measured on the live deployment, refreshed continuously — treat [docs/RESULTS.md](RESULTS.md) and
[`evidence/`](../evidence/) as the source of truth, not this table:

| Metric | Value |
| --- | --- |
| 12-use-case suite | **12/12 expected outcomes matched**, in both gateway modes — and in full LLM mode |
| Audit chain | 200+ records, `verify.ok = true` on every request |
| Money moved (sender-side) | ~$25.5k invoiced (money-in) · ~$4k paid out across settled batches |
| Guardrails | 16+ hard blocks · 25 gates → 10 human approvals · 0 off-policy executions |
| Webhook events | self-registered, signature-verified, deduped, reconciled |
| Known issues fixed / open | **31 fixed** (this document) / 0 open |

---

*Regenerate the numbers anytime: run the app, `Usecases → "Run all 12 sequentially"`, then
`GET /api/stats`, `GET /api/runs` and `GET /api/audit/verify`; the `evidence/` bundle is captured
from exactly that.*
