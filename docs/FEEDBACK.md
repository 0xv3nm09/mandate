# Feedback — build retrospective

Build week was not friction-free. Every real issue we hit — PayPal API behavior, the official
toolkit, UI frameworks, infra — and how each one was resolved, is written up below. The
failures are documentation too: most of these ended up as product features or hardened paths
rather than patches.

## PayPal platform — issues faced and fixed

| # | Issue | Symptom | Fix | Where |
| --- | --- | --- | --- | --- |
| 1 | **Invoicing v2 create returns a HAL link, not an `id`** | `POST /v2/invoicing/invoices` responded with a bare self-link; our client read `body.id` → `undefined` → send hit `/invoices/undefined/send` (404) | Send `Prefer: return=representation` (docs: makes 201 return the full body) **and** parse both shapes — `id` or last path segment of `href` | [`paypal/gateway.ts`](../server/src/paypal/gateway.ts) `createInvoice` |
| 2 | **Invoice `send` 422 `USER_NOT_FOUND`** | Sandbox refuses to send invoices to synthetic emails (`acme@client.test`); only real sandbox personal accounts are valid recipients | `PAYPAL_SANDBOX_RECIPIENT` routing: invoices/payouts go to the configured test account while the ledger records the *logical* payee; failures degrade gracefully (status `CREATED` + a resend route), never fail the use case | `gateway.ts`, `routes/api.ts` |
| 3 | **Duplicate `sender_batch_id` 400 after a demo reset** | After wiping the local ledger, a same-week standing payout hit "Batch with given sender_batch_id already exists" — PayPal's idempotency window outlives our SQLite | Treat that exact 400 as an **idempotent no-op**: audit an `EXECUTION` with `moneyOut: 0` and `duplicateOf: <batch>`; every other gateway failure marks the action `FAILED` and surfaces (FR-14) | `controlPlane.ts` `executePayout` |
| 4 | **Sandbox payout batches settle asynchronously** | UC-12 (dispute pack) demanded `status=SUCCESS` from our DB and errored — real batches settle in minutes, not milliseconds | Poll the live batch (`GET /v1/payments/payouts/{id}`) and build the evidence pack from any state honestly; on one run the batch had genuinely settled `SUCCESS` | `usecases/runner.ts` UC-12 |
| 5 | **Reminders have a hard daily cap** | Docs: "API caller can send only 2 reminders in a day" — our escalating-reminder demo trips it | Catch the 422, audit it as `SYSTEM`, and surface "rejected — daily cap; try again tomorrow" instead of failing | `services.ts` `sendReminder` |
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

## Framework / tooling friction

| # | Issue | Fix |
| --- | --- | --- |
| 13 | **`ag-grid-react` cell renderers that return DOM nodes crash React** (error #31: "Objects are not valid as a React child") — the AG Grid docs show DOM-based renderers, React wrappers need JSX | Renderers return JSX components ([`AuditGrid.tsx`](../web/src/components/AuditGrid.tsx)) |
| 14 | **Custom single-value Tailwind colors shadow the default palette** — `teal: '#14b8a6'` silently kills `from-teal-400`-style shade utilities (half our gradients vanished) | Define colors as `{ DEFAULT, 400, 500, 600 }` objects |
| 15 | **SSE streams die behind proxies** | 15-second keepalive ping on the approval stream (survives Render's proxy) |
| 16 | **Mermaid on GitHub is picky** — angle-bracket text in sequence messages is swallowed as HTML, pipes in node labels break parsing | Diagram set hardened (docs/diagrams.md renders 12/12) |

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
