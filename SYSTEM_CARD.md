# Mandate — System Card

What the agent is, what it can never do, and how that is enforced. Written for judges and reviewers.

## Identity
Mandate is an autonomous finance agent for freelancers and micro-merchants. It drafts and sends PayPal
invoices, chases overdue payers with AI-written reminders, proposes payouts, verifies inbound claims
(the "Netflix check"), and answers questions about its own audit trail.

## Hard boundaries (enforced by code, not by prompt)
1. **No spending authority.** The agent can only *propose* money-out. `propose_payout` is an AI SDK tool
   with **no `execute`** — the model literally cannot trigger a transfer. All money-out runs through
   `controlPlane.ts → handle()` which calls the deterministic policy engine (`control-plane/policy.ts`,
   a pure function, zero I/O, zero model calls).
2. **The model never decides.** ALLOW / GATE / BLOCK comes from `evaluate()` against the signed Intent
   Mandate (JWS). The LLM only writes language: reminders, risk summaries, mandate drafts, audit answers.
3. **Human gates.** Money-out above the signed per-transaction threshold, standing-envelope drift, or
   velocity anomalies require a one-tap human approval. Hard rules (non-allowlisted payee, currency,
   daily cap) are **un-bypassable** — no approval path exists.
4. **Everything is audited.** Every decision, approval, execution, webhook, mandate signature and
   inbound verification is appended to a SHA-256 hash chain; each record carries a JWS; receipts are
   exportable and independently verifiable.
5. **Kill switch.** Global stop halts proposals, freezes approvals, refuses execution.

## Data & failure behavior
- Runs against PayPal **sandbox** by default; a stateful mock gateway with identical semantics is used
  when no credentials are configured (the trust layer is the same code path either way).
- PayPal 5xx/timeouts retry with backoff then queue — actions stay pending, never silently execute.
- Webhook events are deduped by id; sandbox deployments additionally verify transmission signatures.
- Payout idempotency keys (`approval:*`, `standing:*`, `governed:*`) make resubmission a no-op.

## Known limitations
- Single-operator (no multi-user auth yet); SQLite storage (Postgres swap documented); signing keys
  are HMAC secrets (production would use KMS); full-chain verify is O(n) (production anchors checkpoints).
- Sandbox recipient override (`PAYPAL_SANDBOX_RECIPIENT`) routes PayPal emails to a real test account;
  the ledger always records the logical payee alongside the override.
