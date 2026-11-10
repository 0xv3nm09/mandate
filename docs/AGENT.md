# The agent — modes, tools, and real results

How Mandate's agent works in both modes, the exact tool contracts, and verbatim results from
live runs. Core rule first: **the agent proposes; the control plane disposes.** No tool the
model can call moves money out — structurally, not by prompt.

---

## 1. Two modes, one contract

| | **deterministic** (default, zero keys) | **LLM** (set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| --- | --- | --- |
| Parser | rule-based NL parser ([`agent/parser.ts`](../server/src/agent/parser.ts)) — intent + slots (payee, amount, memo) | Vercel AI SDK v5 tool loop (`generateText`, `stopWhen: stepCountIs(6)`) |
| Money-out | routed to `controlPlane.handle()` — never executed by the agent | same — `propose_payout` has **no `execute`**, so the model's call is returned as a proposal |
| Language | templates for reminders / risk summaries / answers | model-written (same facts, better prose) |
| Fallback | — | on any LLM failure the loop degrades to the deterministic parser; the money path is unaffected |

Mode is stamped on every reply (`mode: 'DETERMINISTIC' | 'LLM'`) and shown in the UI header
(`agent: deterministic` / `agent: LLM (AI SDK)`).

---

## 2. Tool contracts (LLM mode)

### `create_invoice` — executes inline (money-in, policy-ALLOWed by design)

```ts
inputSchema: { payeeEmail: string, payeeName?: string, amount: number, memo: string }
execute: → controlPlane.handle({ type: 'invoice', … })
returns:  { status: 'EXECUTED', decision: 'R_ALLOW_INVOICE', paypalRef: 'INV2-…' }
```

### `propose_payout` — NO execute; the call itself is the proposal

```ts
inputSchema: { receiver: string, receiverName?: string, amount: number, note: string }
// no execute → the SDK returns the tool-call to our loop → controlPlane.handle()
```

### `propose_mandate_change` — NO execute; human signs

```ts
inputSchema: { description: string, dailyTotal?: number, perTxn?: number,
               addPayee?: string, standingPayee?: string, standingAmount?: number }
```

Read-only PayPal eyes from the official toolkit are merged in (`list_invoices`,
`get_invoice`, `list_disputes`, `get_dispute`) — they carry no money.

System prompt (excerpt): *“you never have spending authority; for money-out you only call
`propose_payout`; the deterministic control plane decides ALLOW/GATE/BLOCK against the signed
Intent Mandate (v{n}, per-txn ${x}, daily ${y}, allowlist: …).”*

---

## 3. Deterministic parser — intents

| Intent | Example | Resulting action |
| --- | --- | --- |
| invoice | “Invoice Acme $1,200 for October design” | `{invoice, 1200, acme@client.test}` |
| payout | “Pay contractor Sam $500” | `{payout, 500, sam@contractor.test}` |
| reminder | “Chase Acme” | AI/template reminder on the overdue invoice |
| mandateChange | “Cap daily at $500” / “Pay Vita $300 weekly” | mandate diff → human sign (new JWS version) |
| runStanding | “Run standing” | standing envelope check → autonomous or drift-gate |
| simulatePaid | “simulate paid from Acme” | fires `INVOICING.INVOICE.PAID` |
| auditQuestion | “Why was anything blocked?” | audit Q&A + counterfactual + receipt |
| halt / resume | “stop all” / “resume” | kill switch |
| listInvoices | “invoices” | inventory |

Name → sandbox-email directory in `parser.ts` (`acme → acme@client.test`, `sam →
sam@contractor.test`, `vita → vita@va.test`; unknown names land at `*.unverified.test`, which
the policy engine then hard-blocks — see UC-04).

---

## 4. Verbatim agent results (from live runs)

**UC-01 — autonomous invoice** (`evidence/usecases/UC-01.json`):

> Parsed 「Invoice Acme $1,200 for October design」 → `{invoice, $1,200, acme@client.test, "October design"}`
> Engine: **ALLOW · R_ALLOW_INVOICE** — “invoicing is money-in — no spending authority consumed”
> PayPal: invoice `INV2-A8XV-ZMVP-3TV8-R95A` created → audit `#seq` committed.

**UC-03 — the gate** (`evidence/usecases/UC-03.json`):

> Agent: “I've proposed a $500 payout to Sam. The policy engine gated it: $500 is 5.0× your
> per-transaction threshold. I've written a risk summary — it's waiting in your approval inbox.”
> Engine: **GATE · R_GATE_THRESHOLD** · risk summary attached · one tap → batch `ZCWVF6MKS57FG`.

**UC-04 — the hard block** (`evidence/usecases/UC-04.json`):

> Agent: “The policy engine blocked that outright: newvendor@unverified.test is not on your
> allowlist. No prompt can override this — only a signed mandate change can.”
> Engine: **BLOCK · R_BLOCK_PAYEE** (rule R-02) — no approval path exists.

**Risk summary (written for the approval card)**:

> “The agent proposes a $500 payout to sam@contractor.test — 5.0× your $100 per-transaction
> threshold. This payee is on your allowlist. Policy verdict: GATE (R_GATE_THRESHOLD).
> Approving executes the payout immediately; denying aborts it permanently. Both outcomes are
> written to the hash-chained audit log.”

**Reminder drafts (tone escalates per attempt)**:

1. *friendly nudge* — “just a gentle nudge that the $850 invoice is due…”
2. *firm follow-up* — “now past due. Please settle at your earliest convenience…”
3. *final notice* — “final notice for the overdue invoice… escalate to collections.”

**Audit Q&A (UC-09)**:

> Q: “Why was the payout to NewVendor blocked?”
> A: Record #N: the payout of $800 was **BLOCKED** — payee not on your allowlist (R-02).
> Counterfactual: adding newvendor@… to your allowlist (a signed mandate change) would allow it.

---

## 5. Where the model is never allowed

- `policy.ts evaluate()` — pure function, zero model calls (the verdict)
- Idempotency keys, running totals (`dailySpent` is computed from the audit chain)
- Webhook verification, kill-switch enforcement, receipt signing

If the LLM hallucinates an amount or payee, the worst case is a **proposal** that the engine
then gates or blocks — it cannot move money. That is the whole product.
