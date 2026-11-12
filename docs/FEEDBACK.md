# Feedback — build retrospective

Build week was not friction-free. Every real issue we hit — PayPal API behavior, the official
toolkit, UI frameworks, infra — and how each one was resolved, is written up below. The
failures are documentation too: most of these ended up as product features or hardened paths
rather than patches.

## PayPal platform — issues faced and fixed

| # | Issue | Symptom | Fix | Where |
| --- | --- | --- | --- | --- |
| 1 | **Invoicing v2 create returns a HAL link, not an `id`** | `POST /v2/invoicing/invoices` responded with a bare self-link; our client read `body.id` → `undefined` → send hit `/invoices/undefined/send` (404) | Send `Prefer: return=representation` (docs: makes 201 return the full body) **and** parse both shapes — `id` or last path segment of `href` | [`paypal/gateway.ts`](../server/src/paypal/gateway.ts) `createInvoice` |
| 2 | **Invoice `send` 422 `USER_NOT_FOUND`** | Sandbox refuses to send invoices to synthetic emails (`acme@client.test`); only real sandbox personal accounts are valid recipients | `PAYPAL_SANDBOX_RECIPIENT` routing: invoices/payouts go to the configured test account while the ledger records the *logical* payee; failures degrade gracefully (status `CREATED` + a resend route), never fail the use case. Later hardened: with no recipient configured the send is skipped up front (#18) | `gateway.ts`, `routes/api.ts` |
| 3 | **Duplicate `sender_batch_id` 400 after a demo reset** | After wiping the local ledger, a same-week standing payout hit "Batch with given sender_batch_id already exists" — PayPal's idempotency window outlives our SQLite | Treat that exact 400 as an **idempotent no-op**: audit an `EXECUTION` with `moneyOut: 0` and `duplicateOf: <batch>`; every other gateway failure marks the action `FAILED` and surfaces (FR-14) | `controlPlane.ts` `executePayout` |
| 4 | **Sandbox payout batches settle asynchronously** | UC-12 (dispute pack) demanded `status=SUCCESS` from our DB and errored — real batches settle in minutes, not milliseconds | Poll the live batch (`GET /v1/payments/payouts/{id}`) and build the evidence pack from any state honestly; on one run the batch had genuinely settled `SUCCESS` | `usecases/runner.ts` UC-12 |
| 5 | **Reminders have a hard daily cap** | Docs: "API caller can send only 2 reminders in a day" — our escalating-reminder demo trips it | Catch the 422, audit it as `SYSTEM`, and surface "rejected — daily cap; try again tomorrow" instead of failing. Reminders for never-delivered invoices are held up front (#18) | `services.ts` `sendReminder` |
| 6 | **`PayPalAgentToolkit` constructor throws without context** | `new PayPalAgentToolkit({clientId, clientSecret, configuration})` → `TypeError: Cannot read properties of undefined (reading 'context')` | `configuration.context: { sandbox: true }` is required, not optional in practice — and we filter `getTools()` to `/^(list|get)_/` so the model only ever gets read-only eyes | `paypal/toolkit.ts` |
| 7 | **The toolkit exposes no Payouts tools** | Its surface is invoices/orders/disputes — money-out is not included | Payouts go through documented Payouts v1 REST directly — which is also the governance point: the agent never gets an executable money-movement tool at all | `gateway.ts`, `agent/agent.ts` |

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

## Framework / tooling friction

| # | Issue | Fix |
| --- | --- | --- |
| 13 | **`ag-grid-react` cell renderers that return DOM nodes crash React** (error #31: "Objects are not valid as a React child") — the AG Grid docs show DOM-based renderers, React wrappers need JSX | Renderers return JSX components ([`AuditGrid.tsx`](../web/src/components/AuditGrid.tsx)) |
| 14 | **Custom single-value Tailwind colors shadow the default palette** — `teal: '#14b8a6'` silently kills `from-teal-400`-style shade utilities (half our gradients vanished) | Define colors as `{ DEFAULT, 400, 500, 600 }` objects |
| 15 | **SSE streams die behind proxies** | 15-second keepalive ping on the approval stream (survives Render's proxy) |
| 16 | **Mermaid on GitHub is picky** — angle-bracket text in sequence messages is swallowed as HTML, pipes in node labels break parsing | Diagram set hardened (docs/ARCHITECTURE.md renders 12/12) |
| 23 | **AI SDK v5's OpenAI provider defaults to `/responses`** — OpenAI's newer endpoint, which OpenAI-compatible providers (Vultr Serverless Inference, Groq, Together…) don't serve: every LLM call 404'd even with valid auth | Call `openai.chat(model)` — the classic `/chat/completions` with tools; found the moment a third-party provider was wired (`OPENAI_BASE_URL`), logged with the provider's error body ([docs/AI.md §7](AI.md)) |
| 24 | **Invoice send `USER_NOT_FOUND` with a VALID recipient** — the missing user was the *invoicer*: a placeholder `merchant@mandate.demo` sender identity. Send resolves both parties; also caught an LLM-path gap (no money-in tool story) that hid behind it | UC-01's send 422ing across three recipient accounts until the sender was fixed | `PAYPAL_INVOICER_EMAIL` = the app's own business sandbox account; governed `send_reminder` tool + a system prompt that enumerates tools by side — the LLM suite then ran 12/12 ([PAYPAL.md §7 row 8](PAYPAL.md)) |

## Live deployment — issues faced on the Vultr VM

| # | Issue | Symptom | Fix |
| --- | --- | --- | --- |
| 17 | **Sandbox sender balance drained** | Repeated demo payouts emptied the business test account → `422 INSUFFICIENT_FUNDS` on `/v1/payments/payouts` | FR-14 did its job (execution marked `FAILED`, audited, nothing retried silently). Balance topped up in the developer dashboard — there is no funds API, and a test-card top-up through `/v2/checkout/orders` is refused with `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` (a payee-capability error raised at order create, before any card is evaluated). Next payouts settled `SUCCESS` |
| 18 | **Doomed calls polluted PayPal's API log** | Every invoice run without a real sandbox recipient produced a guaranteed 422 on `send` / `remind` — handled gracefully, but the developer dashboard's error count grew with each run | Check the precondition first: `sendInvoice` / `remindInvoice` return `{ status, skipped }` instead of calling PayPal, and the trace reads "drafted — delivery held" rather than claiming a send ([`paypal/gateway.ts`](../server/src/paypal/gateway.ts), [`services.ts`](../server/src/services.ts)) |
| 19 | **Caddy served its default site after first boot** | apt auto-starts Caddy with the stock `:80` Caddyfile during install, before the deploy script writes the sslip.io site block — HTTPS never came up and the hostname 404'd | Deploy scripts `restart` Caddy after writing the config (a `reload` raced the auto-start); the Let's Encrypt cert then issued via TLS-ALPN in seconds |
| 22 | **The deployed VM had no `MANDATE_ADMIN_TOKEN`** — every mutating route on the public URL was open (chat → payouts, approvals, resets) | `.env` audit of the live instance | token set; the console prompts once, remembers it and retries; the public demo's token is documented in the README "Live on Vultr" section — sandbox money, the guard demonstrates the pattern |

## What worked well

- **The dual gateway was the single best decision.** One interface, sandbox-REST and
  stateful-mock implementations — the demo cannot break for missing keys, and every trust-layer
  behavior is identical in both modes. Judges can run the whole control plane offline.
- **The evidence loop.** Every claim in the README is an artifact in `evidence/` regenerated
  from real runs — when UC-12 tripped on asynchronous settlement, it was caught because the
  suite re-runs against the live sandbox, not because someone read the code.
- **Pure-function policy engine.** Zero I/O, zero model calls — which made "the LLM never
  decides" verifiable by inspection rather than by promise.
- **Idempotency everywhere money moves.** Local keys + PayPal's own `sender_batch_id`
  semantics caught each other's blind spots (issue #3 is exactly that interaction).

## Known gaps — documented, not hidden

- Invoice **send** currently requires `PAYPAL_SANDBOX_RECIPIENT` to be configured (issue #2);
  until it is, UC-01 honestly records `CREATED` (a real PayPal draft) with a one-click resend.
- Single-operator product: no multi-user auth yet; SQLite storage (Postgres swap is
  documented); HMAC signing keys (production would use a KMS); full-chain verify is O(n)
  (production would anchor checkpoints).
