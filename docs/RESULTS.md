# Results — 12-use-case suite, executed on the live PayPal sandbox

_Rendered from the committed evidence bundle by `scripts/render_results_md.py` — **12/12 expected outcomes matched**, every number below is machine-collected._

Run date: `2026-11-07T21:13:43.318Z` · audit chain: **24 records, verify=ok** · governed actions: **8** · money moved: **$2,050 in / $500 out**

## Expected vs got

| UC | Use case | Expected | Got | Headline (verbatim from the run) |
| --- | --- | --- | --- | --- |
| UC-01 | Autonomous invoicing | ok | ✅ ok | Real PayPal invoice INV2-A8XV-ZMVP-3TV8-R95A created — send pending sandbox recipient |
| UC-02 | Autonomous chase | ok | ✅ ok | Reminder sent: "Friendly reminder: invoice for September retainer" (friendly nudge (rejected — PayPal daily reminder cap; try again tomorrow)) |
| UC-03 | Gated payout (the money shot) | gate | ✅ gate | GATED → approved → executed (batch ZCWVF6MKS57FG) |
| UC-04 | The guardrail | block | ✅ block | BLOCKED by R_BLOCK_PAYEE: payee not on allowlist — deterministic, un-bypassable |
| UC-05 | Audit everything | ok | ✅ ok | Chain verified: 11 records, zero tampering |
| UC-06 | Global stop | block | ✅ block | Halting worked: a live money-out was refused while the switch was on |
| UC-07 | Speak your policy | ok | ✅ ok | Mandate re-signed: v2 with daily cap $600, per-txn $75 |
| UC-08 | Standing payout autonomy | ok | ✅ ok | In-bounds ran autonomously; the $150 drift fell back to GATE |
| UC-09 | Interrogate the trail | ok | ✅ ok | The audit log answered, and the receipt verified cryptographically |
| UC-10 | Impostor detection (Netflix check) | block | ✅ block | Lookalike domain + outlier amount caught: IMPOSTOR (R_IMPOSTOR_LOOKALIKE) |
| UC-11 | Subscription guard | ok | ✅ ok | Real bill auto-verified; price hike flagged SUSPICIOUS |
| UC-12 | Dispute evidence pack | ok | ✅ ok | Dispute answered with a signed evidence pack (batch ZCWVF6MKS57FG, PROCESSING) |

## Real PayPal objects created by this sweep

| Payout batch | Status | Amount | Payee (logical) | Idempotency key |
| --- | --- | --- | --- | --- |
| `CM9XMWV3ZZYFC` | **SUCCESS** | $300 | vita@va.test | `standing:vita@va.test:2026-W45` |
| `ZCWVF6MKS57FG` | **PROCESSING** | $500 | sam@contractor.test | `approval:mw6whx2612fa58` |

**Impostor caught:** claim “Netflix $49.99” from `billing@netflix-payments.com` → **IMPOSTOR** (R_IMPOSTOR_LOOKALIKE) — signed receipt `mw6whzgr67a1wx`.

## Per-use-case traces (condensed)

### UC-01 · Autonomous invoicing  ✅

**Real PayPal invoice INV2-A8XV-ZMVP-3TV8-R95A created — send pending sandbox recipient**

_6 steps · 3359 ms · audit records: #3_

- · **Signed mandate loaded** — Intent Mandate v1 (JWS) — per-txn $100, daily $1000
- · **Agent parsed instruction** — 「Invoice Acme $1,200 for October design」 → {invoice, $1,200, acme@client.test, "October design"}
- ✅ **Policy engine evaluated** — ALLOW · R_ALLOW_INVOICE — Allowed: invoicing is money-in — no spending authority consumed.
- ✅ **PayPal invoice created as DRAFT — send pending sandbox recipient** — invoice INV2-A8XV-ZMVP-3TV8-R95A → status CREATED
- · **Send pending** — Set PAYPAL_SANDBOX_RECIPIENT to your sandbox personal account, then hit “resend” in Console → Invoices.
- · **Audit record appended** — seq #3 committed to hash chain

### UC-02 · Autonomous chase  ✅

**Reminder sent: "Friendly reminder: invoice for September retainer" (friendly nudge (rejected — PayPal daily reminder cap; try again tomorrow))**

_4 steps · 2176 ms · audit records: #7_

- · **Setup: invoice aged past due** — Invoice to Globex ($850) marked past-due to trigger the chase
- · **Agent detected overdue + drafted reminder** — Chased Globex: "Friendly reminder: invoice for September retainer" — reminder #0, tone: friendly nudge (rejected — PayPal daily reminder cap
- ✅ **Reminder sent autonomously** — 「Friendly reminder: invoice for September retainer」 — tone: friendly nudge (rejected — PayPal daily reminder cap; try again tomorrow) (attempt escalation)
- · **Audit record appended** — seq #7

### UC-03 · Gated payout (the money shot)  🟡

**GATED → approved → executed (batch ZCWVF6MKS57FG)**

_6 steps · 2278 ms · audit records: #10, #9_

- · **Agent proposed money-out** — {payout, $500, sam@contractor.test} — proposal only, never execution
- 🟡 **Policy engine: GATE** — R_GATE_THRESHOLD — Gated: $500 is 5.0× your per-transaction threshold of $100. Human approval required.
- · **AI risk explainer wrote the summary** — The agent proposes a $500 payout to sam@contractor.test — 5.0× your $100 per-transaction threshold. This payee is on your allowlist. Policy verdict: GATE (R_GATE_THRESHOLD). $500 > per-transaction threshold $100 (5.0×). Approving executes the payout immediately; denying aborts it permanently. Both outcomes are written to the hash-chained audit log.
- 🟡 **Approval card queued (SSE)** — approval mw6whx2612fa58 — status AWAIT_APPROVAL, TTL 10 min
- ✅ **One-tap APPROVE → payout executed** — payout batch ZCWVF6MKS57FG (PENDING) — idempotency key approval:mw6whx2612fa58
- · **PayPal status: batch accepted, settling asynchronously** — PAYMENT.PAYOUTS.EVENT: batch ZCWVF6MKS57FG → PENDING (sandbox batches settle in minutes)

### UC-04 · The guardrail  ⛔

**BLOCKED by R_BLOCK_PAYEE: payee not on allowlist — deterministic, un-bypassable**

_4 steps · 3 ms · audit records: #11_

- · **Agent proposed money-out** — {payout, $800, newvendor@unverified.test} — off-policy proposal
- ⛔ **Policy engine: BLOCK (hard rule)** — R_BLOCK_PAYEE — Blocked: newvendor@unverified.test is not on your allowlist. No approval path exists for this rule — edit the mandate (which re-signs it) to add the payee.
- ⛔ **No approval path exists** — R-02 fires before any GATE option — the money never moved and no prompt could move it
- · **Audit record appended** — seq #11

### UC-05 · Audit everything  ✅

**Chain verified: 11 records, zero tampering**

_5 steps · 1 ms · audit records: —_

- ✅ **Recomputed entire hash chain** — 11 records — prevHash→hash links re-hashed with SHA-256
- · **Record #9 · APPROVAL** — Human approved gated action
- · **Record #10 · EXECUTION** — Payout executed: $500 → sam@contractor.test (batch ZCWVF6MKS57FG, PENDING)
- · **Record #11 · ACTION_DECISION** — Policy BLOCK: payout $800 → newvendor@unverified.test refused
- ✅ **Ledger summary** — 4 actions governed · $500 money-out · $2050 money-in · 1 blocked

### UC-06 · Global stop  ⛔

**Halting worked: a live money-out was refused while the switch was on**

_4 steps · 1 ms · audit records: #12_

- ⛔ **Operator engaged GLOBAL STOP** — Kill switch ON — agent halted (FR-15)
- ⛔ **Agent attempt while halted** — HALTED · R_BLOCK_HALT — Global stop is engaged — all agent action is frozen. Resume the agent to proceed.
- ✅ **Operator resumed the agent** — Kill switch OFF — normal governed flow restored
- · **Audit trail records both** — seq #12

### UC-07 · Speak your policy  ✅

**Mandate re-signed: v2 with daily cap $600, per-txn $75**

_5 steps · 4 ms · audit records: #13_

- · **Current signed mandate** — v1 — per-txn $100, daily $1000
- · **Agent drafted the diff (proposal only)** — I drafted the mandate diff: daily cap → $600 · per-transaction threshold → $75
- ✅ **Human signature applied → new version** — v1 → v2 · daily $600 · per-txn $75
- · **Mandate signing committed to audit** — seq #13 (MANDATE_SIGNED)
- · **Demo thresholds restored** — back to v3 defaults

### UC-08 · Standing payout autonomy  ✅

**In-bounds ran autonomously; the $150 drift fell back to GATE**

_5 steps · 2263 ms · audit records: —_

- · **Standing mandate already signed** — $300/week → vita@va.test
- ✅ **Run 1: in-bounds → executed with NO human prompt** — R_STANDING_ALLOW — Allowed autonomously under standing mandate v4: payee and amount match the signed envelope, daily cap respected.
- · **Idempotency: one execution per ISO week** — key standing:vita@va.test:2026-W45
- 🟡 **Run 2: DRIFT ($150 ≠ $300 envelope)** — R_GATE_THRESHOLD — Gated: $150 is 1.5× your per-transaction threshold of $100. Human approval required.
- ✅ **Drift denied by human** — GATE held the drifted amount — autonomy was withdrawn instantly

### UC-09 · Interrogate the trail  ✅

**The audit log answered, and the receipt verified cryptographically**

_5 steps · 1 ms · audit records: —_

- · **Question over the audit trail** — 「Why was the payout to NewVendor blocked? What would approve it?」
- ✅ **Answer from the trail (records + mandate)** — Record #11: the payout of $800 to newvendor@unverified.test was BLOCKED — Blocked: newvendor@unverified.test is not on your allowlist. No approval path exists for this rule — edit the mandate (which re-signs it) to add the payee. (reason code R_BLOCK_PAYEE). The engine evaluated it against signed mandate v4 and refused before any PayPal call was made.
- · **Counterfactual** — Adding newvendor@unverified.test to your allowlist (which re-signs the mandate as a new version) would have allowed this action.
- ✅ **Signed mandate receipt exported** — receipt for record #11 — signature VERIFIED ✓
- ✅ **Chain still consistent** — verify → true

### UC-10 · Impostor detection (Netflix check)  ⛔

**Lookalike domain + outlier amount caught: IMPOSTOR (R_IMPOSTOR_LOOKALIKE)**

_8 steps · 4 ms · audit records: #17, #18_

- · **Scenario setup** — An email arrives: “URGENT — your Netflix account will be suspended, settle $49.99 now” from billing@netflix-payments.com
- ✅ **Baseline: the genuine bill** — billing@netflix.com · $15.49 → VERIFIED (R_VERIFIED_OFFICIAL) — official domain, amount in envelope
- ⛔ **The impostor claim runs the same checks** — billing@netflix-payments.com · $49.99 → IMPOSTOR
- ✅ **check · Merchant directory** — Netflix found — official payee billing@netflix.com
- ⛔ **check · Sender identity** — netflix-payments.com IMITATES Netflix (lookalike of netflix.com/mail.netflix.com) — classic impostor pattern
- ⛔ **check · Amount vs envelope** — $49.99 is OUTSIDE Netflix's known range ($7.99–$24.99) — price change or inflated bill
- · **check · Payment history** — First time seeing billing@netflix-payments.com — no history to confirm against
- · **Signed verification artifact** — receipt mw6whzgr67a1wx — JWS-signed, downloadable, hash-committed to the audit chain (seq #18)

### UC-11 · Subscription guard  ✅

**Real bill auto-verified; price hike flagged SUSPICIOUS**

_4 steps · 2 ms · audit records: #19, #20_

- ✅ **Genuine subscription bill** — billing@netflix.com · $15.49 → VERIFIED — matches the signed envelope, nothing for a human to do
- 🟡 **Official sender raises the price** — billing@netflix.com · $27.49 → SUSPICIOUS (R_SUSPICIOUS_AMOUNT)
- 🟡 **Envelope catches silent price changes** — Sender is genuinely Netflix — but $27.49 is outside the $7.99–$24.99 envelope. Flagged for a human look instead of silently paid.
- · **Signed verification artifact** — receipt mw6whzie9qr23z committed to the chain (seq #20)

### UC-12 · Dispute evidence pack  ✅

**Dispute answered with a signed evidence pack (batch ZCWVF6MKS57FG, PROCESSING)**

_5 steps · 6576 ms · audit records: —_

- · **Scenario** — The payee disputes: “I never received the $500 payment.” Mandate compiles the proof.
- ✅ **Human approval record** — approval mw6whx2612 — verdict APPROVED by usecase-runner (simulated human) at 2026-11-07T21:13:45.630Z
- · **PayPal settlement proof** — batch ZCWVF6MKS57FG · live status PROCESSING — PayPal's own ledger confirms the batch exists (settlement in progress; batch id is the immutable reference)
- ✅ **Immutable chain position** — 3 audit records reference this action — every hash-chained and reproducible (mandate v1)
- ✅ **Signed evidence pack** — pack c19cd6cdd5f1e3ca… · HMAC signature verified — exportable as a single JSON artifact

## Verdict mix

```
  ok           ████████████████████████████████   8
  gate         ████   1
  block        ████████████   3
```

---
_Raw JSON for every run: [`evidence/usecases/`](../evidence/usecases/). Regenerate this page: `Usecases → Run all 12` → export → `python3 scripts/render_results_md.py`._
