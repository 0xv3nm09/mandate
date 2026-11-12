# Mandate — Architecture & flow diagrams

Twelve diagrams of the shipped system — every node, route and rule id matches the code as it
runs (not a design mockup). GitHub renders Mermaid natively, so each block below is live.

**How to read this page:** each diagram is followed by a short _What it tells you_ note —
the one thing the diagram proves and where to look. Deeper prose lives in
[SYSTEM_CARD.md](../SYSTEM_CARD.md) (agent boundaries), [PAYPAL.md](PAYPAL.md) (every PayPal
call), [RESULTS.md](RESULTS.md) (live numbers) and [evidence/](../evidence/) (raw artifacts).

**Contents:** 1. [System zones](#1-system-zones--where-authority-lives) ·
2. [Policy flow](#2-policy-engine-decision-flow--policyts-evaluate) ·
3. [Gated payout](#3-sequence--the-gated-payout-uc03-the-money-shot) ·
4. [Standing payout](#4-sequence--standing-payout-autonomous-when-in-bounds-gates-on-drift-uc08) ·
5. [Inbound verification](#5-flow--inbound-claim-verification-the-netflix-check-uc1011) ·
6. [Evidence pack](#6-sequence--dispute-evidence-pack-uc12) ·
7. [Action lifecycle](#7-action-lifecycle-state-machine) ·
8. [Invoice lifecycle](#8-invoice-lifecycle-money-in-uc0102) ·
9. [Audit chain](#9-audit-hash-chain--how-tampering-is-detectable) ·
10. [Data model](#10-data-model-sqlite--nodesqlite-zero-native-deps) ·
11. [Deployment](#11-deployment-architecture) ·
12. [Evidence workflow](#12-workflow--how-a-use-case-run-becomes-dashboard-evidence)

---

## 1. System zones — where authority lives

**What it tells you:** Mandate is four zones with one hard rule — PayPal credentials for money movement exist **only** in zone 4, and the only path into zone 4 runs through the deterministic control plane (zone 3). The AI agent (zone 2) has *no* PayPal credentials at all: it can draw up a proposal, and that is all. This single picture is the whole security argument — everything else on this page is a zoom-in.

```mermaid
flowchart LR
  subgraph Z1["ZONE 1 · Operator"]
    U["React console<br/>Dashboard · Agent chat · Approval inbox<br/>Vite · Tailwind · AG Grid"]
  end
  subgraph Z2["ZONE 2 · AI Agent (language only)"]
    A["Vercel AI SDK v5 tool loop<br/>create_invoice (executes · money-in)<br/>propose_payout (NO execute)<br/>+ official @paypal/agent-toolkit read-only<br/>(list/get invoices, disputes)"]
  end
  subgraph Z3["ZONE 3 · Control Plane (deterministic — no LLM)"]
    P["policy.ts · evaluate()<br/>pure function · R-00…R-09"]
    M["mandate.ts<br/>signed Intent Mandate (JWS, versioned)"]
    Q["approvals.ts<br/>queue + SSE + TTL + kill-switch freeze"]
    L["audit.ts<br/>SHA-256 hash chain + JWS receipts"]
    V["verify.ts<br/>inbound claims + evidence packs"]
  end
  subgraph Z4["ZONE 4 · PayPal Sandbox"]
    PP["Invoicing v2 (create/send/remind)<br/>Payouts v1 (idempotent batches)<br/>Webhooks (verify + simulate-event)"]
  end

  U -- "NL instruction / one-tap approve" --> A
  A -- "proposal (type, amount, payee) — never executes" --> P
  P -- "reads v(n)" --> M
  P -- "ALLOW → executePayout (idempotency key)" --> PP
  P -- "GATE → AI risk summary → enqueue" --> Q
  Q -- "SSE approval card" --> U
  U -- "APPROVE / DENY (one tap)" --> Q
  Q -- "approved → executePayout" --> PP
  PP -- "webhooks: INVOICE.PAID · PAYOUTS.EVENT" --> L
  P -- "append (every decision + execution)" --> L
  V -- "inbound claims → verdict + JWS receipt" --> L
  L -- "verifyChain / exportReceipt" --> U

  classDef z1 fill:#1e293b,stroke:#6366f1,color:#e2e8f0
  classDef z2 fill:#1e293b,stroke:#f59e0b,color:#e2e8f0
  classDef z3 fill:#0f2a24,stroke:#14b8a6,color:#e2e8f0
  classDef z4 fill:#1a1a1a,stroke:#64748b,color:#cbd5e1
  class U z1
  class A z2
  class P,M,Q,L,V z3
  class PP z4
```

**The trust boundary (●) sits between zones 3 and 4**: PayPal calls for money-out are reachable *only* from the control plane, and only after a policy pass (plus a human approval when gated). The agent holds no PayPal credentials for money movement.

---

## 2. Policy engine decision flow — `policy.ts evaluate()`

**What it tells you:** the exact order the engine checks a proposal, and why order matters. Hard BLOCKs (payee, currency, daily cap) are evaluated **first** — so no approval, prompt or reasoning can reach them. Standing envelopes are matched before thresholds so a pre-authorized run never trips its own limit. Read it top-to-bottom as: *can I refuse instantly? → is this pre-signed? → does a human need to see it? → otherwise, run it.*

Pure function. Input: `ProposedAction` + signed `IntentMandate` + engine-owned counters (dailySpent, recent payouts). Output: `ALLOW | GATE | BLOCK` with reason codes.

```mermaid
flowchart TD
  A["ProposedAction<br/>{type, amount, currency, payee}"] --> H{"Global stop?<br/>(approvals.ts isHalted)"}
  H -- "yes" --> HX["BLOCK · R_BLOCK_HALT<br/>action frozen (FR-15)"]
  H -- "no" --> MO{"Money-out?<br/>(payout / refund)"}
  MO -- "no → invoice" --> INV["ALLOW · R_ALLOW_INVOICE<br/>money-in needs no spend authority"]
  MO -- "yes" --> AL{"Payee on signed<br/>allowlist?"}
  AL -- "no" --> B1["BLOCK · R_BLOCK_PAYEE<br/>(R-02, un-bypassable)"]
  AL -- "yes" --> CU{"currency ==<br/>mandate currency?"}
  CU -- "no" --> B2["BLOCK · R_BLOCK_CURRENCY"]
  CU -- "yes" --> CAP{"dailySpent + amount<br/>above dailyTotal?"}
  CAP -- "yes" --> B3["BLOCK · R_BLOCK_DAILY_CAP<br/>(running total from audit chain)"]
  CAP -- "no" --> ST{"Claims standing envelope?<br/>(payee + amount + currency match)"}
  ST -- "match" --> SA["ALLOW · R_STANDING_ALLOW<br/>autonomous, no human present"]
  ST -- "drift" --> TX{"amount above<br/>perTxn threshold?"}
  TX -- "yes" --> G1["GATE · R_GATE_THRESHOLD<br/>human approval required"]
  TX -- "no" --> VEL{"3+ payouts<br/>within 10 min?"}
  VEL -- "yes" --> G2["GATE · R_GATE_VELOCITY<br/>circuit breaker (R-08)"]
  VEL -- "no" --> OK["ALLOW · R_ALLOW_IN_BOUNDS"]
```

Gate ≠ block: a GATE queues an approval card (AI-written risk summary attached) with a 10-minute TTL. A BLOCK has **no approval path** — only a signed mandate change (new version) can alter the rules.

---

## 3. Sequence — the gated payout (UC-03, the money shot)

**What it tells you:** the full life of the $500 payout, from a plain-English sentence to a real PayPal batch. Follow the audit chain on the right — a record is committed at every decision point (proposal verdict, human approval, execution, settlement), so the finished payout has a complete, independently verifiable paper trail. The DENY path skips everything after the approval card.

```mermaid
sequenceDiagram
  actor Op as Operator
  participant Ag as Agent (Z2)
  participant CP as Control Plane (Z3)
  participant PE as Policy Engine (pure)
  participant AU as Audit chain
  participant PP as PayPal Payouts (Z4)

  Op->>Ag: "Pay contractor Sam $500"
  Ag->>CP: propose {payout, $500, sam@contractor.test}
  CP->>PE: evaluate(action, mandate v(n), counters)
  PE-->>CP: GATE · R_GATE_THRESHOLD ($500 = 5× $100)
  CP->>AU: append ACTION_DECISION (GATE)
  CP->>Ag: request risk summary (language only)
  Ag-->>CP: risk summary (5x per-txn limit, payee allowlisted, current spend)
  CP-->>Op: SSE approval card (facts + explanation + TTL 10 min)
  Op->>CP: APPROVE (one tap)
  CP->>AU: append APPROVAL (verdict, by operator)
  CP->>PP: POST /v1/payments/payouts<br/>sender_batch_id = approval:id  (idempotency key)
  PP-->>CP: 201 · payout_batch_id (PENDING)
  CP->>AU: append EXECUTION (moneyOut: 1)
  PP-->>CP: batch settles → SUCCESS (sandbox: minutes)
  CP->>AU: append WEBHOOK / status record
  CP-->>Op: SSE payout.updated → live ledger + dashboard
```

A **DENY** at the approval step skips everything after the card: action → DENIED, audited, never executed. Re-submission is a no-op — the idempotency key `approval:<id>` is already stored.

---

## 4. Sequence — standing payout: autonomous when in-bounds, gates on drift (UC-08)

**What it tells you:** how autonomy without abdication works. The human signs the envelope *once* ($300/week → vita@va.test); from then on the engine's idempotency guard + envelope check run the payout unattended. The moment any parameter drifts ($150 instead of $300), the same mandate that granted autonomy withdraws it — no re-prompting, no new rules.

```mermaid
sequenceDiagram
  actor Op as Operator
  participant CP as Control Plane
  participant PE as Policy Engine
  participant PP as PayPal

  Op->>CP: "Pay Vita $300 weekly" (UC-07 style)
  CP->>CP: mandate re-signed (v+1) with standing envelope<br/>$300/week → vita@va.test
  Note over CP: Later — "Run standing" (no human present)
  CP->>CP: idempotency guard: standing:payee:ISO-week
  CP->>PE: evaluate({payout, $300, standing: true})
  PE-->>CP: ALLOW · R_STANDING_ALLOW (envelope matched)
  CP->>PP: POST /v1/payments/payouts<br/>sender_batch_id = standing:vita@va.test:week  (idempotency key)
  PP-->>CP: batch created → settles SUCCESS
  Note over CP,PP: Same mandate, different day — drift probe
  CP->>PE: evaluate({payout, $150, standing: true})
  PE-->>CP: envelope mismatch → fall through → GATE (R_GATE_THRESHOLD)
  CP-->>Op: approval card — autonomy withdrawn instantly
```

The signed envelope moves the human to **authorization time, not execution time** — the answer to "you can't put a human in the hot path."

---

## 5. Flow — inbound claim verification (the Netflix check, UC-10/11)

**What it tells you:** how an inbound "Netflix" claim is judged without trusting its branding. Four independent checks run in order — directory, sender domain (exact vs lookalike), amount envelope, payment history — and the worst flag wins. A lookalike domain plus an inflated amount is an IMPOSTOR; a genuine price hike from the real domain is only SUSPICIOUS. The verdict is signed and committed like any other record.

```mermaid
flowchart TD
  IN["Inbound claim<br/>'Netflix · $49.99 · billing@netflix-payments.com'"] --> DIR{"Brand in known-merchant<br/>directory?"}
  DIR -- "no" --> UNV["UNVERIFIED · R_UNKNOWN_BRAND<br/>(not fraud — not vouched either)"]
  DIR -- "yes (Netflix)" --> DOM{"Sender domain check"}
  DOM -- "== officialPayee" --> P1["pass: exact official billing payee"]
  DOM -- "in officialDomains" --> P2["pass: official domain"]
  DOM -- "lookalike<br/>(base label contains brand,<br/>edit distance <= 2)" --> IMP["IMPOSTOR · R_IMPOSTOR_LOOKALIKE"]
  DOM -- "unknown domain" --> SUS1["flag: possible spoof"]
  IN --> AMT{"Amount within signed<br/>envelope $7.99–$24.99?"}
  AMT -- "no" --> SUS2["flag: R_SUSPICIOUS_AMOUNT<br/>(price change or inflated bill)"]
  AMT -- "yes" --> P3["pass: within envelope"]
  IN --> HIST{"Paid this sender<br/>before (verified)?"}
  HIST -- "yes" --> P4["pass: history confirms"]
  HIST -- "no" --> P5["info: first contact — no history"]
  IMP --> V1["verdict = IMPOSTOR"]
  SUS1 --> V2{"any impostor flag?"}
  SUS2 --> V2
  P1 --> V2
  P2 --> V2
  P3 --> V2
  P4 --> V2
  P5 --> V2
  V2 -- "no flags" --> VOK["VERIFIED · R_VERIFIED_OFFICIAL<br/>+ JWS receipt + audit VERIFICATION record"]
  V2 -- "suspicious only" --> VSU["SUSPICIOUS · R_SUSPICIOUS_DOMAIN / _AMOUNT"]
  V1 --> OUT["Stamp receipt (VERIFIED ✓ / SUSPICIOUS ⚠ / IMPOSTOR ✗)<br/>commit to hash chain · Dashboard receipt card"]
  VOK --> OUT
  VSU --> OUT
```

Same checks, both directions: UC-10 catches the impostor; UC-11 shows the genuine bill verifying silently and an official-sender **price hike** flagged rather than silently paid.

---

## 6. Sequence — dispute evidence pack (UC-12)

**What it tells you:** what happens when a payee disputes a payment. Instead of an argument, Mandate compiles a single signed artifact — the human approval record, the PayPal batch id with its **live** status (polled, since sandbox batches settle asynchronously), and the audit-chain position. The packHash + HMAC make the pack independently verifiable.

```mermaid
sequenceDiagram
  actor Payee as Payee ("I never got paid")
  participant CP as Control Plane
  participant PP as PayPal
  participant AU as Audit chain

  Payee->>CP: dispute claim
  CP->>AU: load action + approval record + audit records
  CP->>PP: GET /v1/payments/payouts/{batchId} (live status poll)
  PP-->>CP: batch status (PENDING → SUCCESS)
  CP->>CP: compile pack = {action, approval, payout,<br/>audit records, mandateVersion, narrative}
  CP->>CP: packHash = SHA-256(canonical pack)<br/>signature = HMAC(packHash)
  CP-->>Payee: signed evidence pack (single JSON artifact)<br/>"approved by operator, batch id + live status attached,<br/>chain position seq — hash-verified"
```

The dispute is answered with **PayPal's own ledger + the immutable chain**, not an argument.

---

## 7. Action lifecycle state machine

**What it tells you:** every state an action can be in, and the only transitions between them. Two details to notice: resubmission of an EXECUTED action is a self-loop (idempotency — it can never double-pay), and HALTED is reachable from anywhere while the kill switch is on. DENIED and EXPIRED actions are terminal — they can never execute later.

```mermaid
stateDiagram-v2
  [*] --> PROPOSED: agent proposes (chat / usecase / standing)
  PROPOSED --> HALTED: global stop engaged
  PROPOSED --> EXECUTED: ALLOW → executePayout OK (money-in or in-bounds)
  PROPOSED --> AWAIT_APPROVAL: GATE → approval card queued (TTL 10 min)
  PROPOSED --> BLOCKED: hard rule fired (payee / currency / cap)
  AWAIT_APPROVAL --> EXECUTED: human APPROVE → idempotent payout
  AWAIT_APPROVAL --> DENIED: human DENY → aborted, audited
  AWAIT_APPROVAL --> EXPIRED: TTL 10 min elapsed → never executes
  AWAIT_APPROVAL --> HALTED: kill switch freezes resolution
  EXECUTED --> EXECUTED: resubmission = no-op (idempotency key)
  HALTED --> PROPOSED: operator resumes agent
  EXECUTED --> [*]: audit EXECUTION record committed
  BLOCKED --> [*]: audit ACTION_DECISION (BLOCK) committed
  DENIED --> [*]: audit APPROVAL (DENY) committed
```

---

## 8. Invoice lifecycle (money-in, UC-01/02)

**What it tells you:** the money-in loop the agent runs unattended — create, send, sweep overdue, chase with escalating AI reminders (PayPal allows 2 reminders/invoice/day), plus PayPal's own native auto-reminders configured once at bootstrap. The CREATED → resend path is the honest handling of the sandbox's send restriction.

```mermaid
flowchart TD
  NL["NL instruction<br/>'Invoice Acme $1,200 for October design'"] --> PE["Policy: ALLOW (money-in)<br/>R_ALLOW_INVOICE"]
  PE --> CREATE["POST /v2/invoicing/invoices<br/>Prefer: return=representation<br/>PayPal-Request-Id: mandate-invoice-<actionId>"]
  CREATE --> SEND{"POST …/send"}
  SEND -- "202" --> SENT["status = SENT<br/>audit EXECUTION (moneyOut: 0)"]
  SEND -- "422 USER_NOT_FOUND<br/>(sandbox recipient)" --> CREATED["status = CREATED (real PayPal DRAFT)<br/>audit notes pending send → 'resend' in Console"]
  SENT --> SWEEP["sweepOverdue(): dueDate < today → OVERDUE"]
  CREATED --> RESEND["POST /api/invoices/:id/resend"]
  RESEND --> SENT
  SENT --> CHASE["'Chase Acme' → AI-drafted reminder<br/>tone escalates per attempt (docs: max 2/day)"]
  SENT --> NATIVE["one-time: POST /v2/invoicing/setup-reminders<br/>PayPal NATIVE BEFORE_DUE/AFTER_DUE reminders"]
  CHASE --> PAID["webhook INVOICING.INVOICE.PAID<br/>(or simulate-event) → status PAID"]
  PAID --> AUDIT["audit WEBHOOK record + SSE → dashboard"]
```

---

## 9. Audit hash chain — how tampering is detectable

**What it tells you:** why the audit log is tamper-*evident*, not just stored. Each record hashes the previous record's hash into its own, so changing any historical record breaks every hash after it — `verifyChain()` recomputes all links and pins the exact break point. Money-out totals are computed from this chain, never from the model's memory.

```mermaid
flowchart LR
  R0["#1 · genesis<br/>prevHash = 0…0"] --> R1["#2<br/>prevHash = h1"]
  R1 --> R2["#3<br/>prevHash = h2"]
  R2 --> R3["#n<br/>prevHash = h(n-1)"]

  K["record hash =<br/>SHA-256(prevHash · seq · ts · kind · canonical JSON)"] --> R2
  S["each record also carries<br/>a JWS (HMAC) over {seq, ts, kind, hash}"] --> R2

  V["verifyChain():<br/>recompute every link O(n)<br/>any mismatch → brokenAt = seq"] --> R3
  RC["exportReceipt(seq):<br/>record + chain context +<br/>standalone HMAC receipt signature"] --> R3
```

Kinds appended: `ACTION_DECISION` · `EXECUTION` · `APPROVAL` · `MANDATE_SIGNED` · `WEBHOOK` · `VERIFICATION` · `SYSTEM`. Money-out totals ("spent today") are computed **from this chain** — never from the model.

---

## 10. Data model (SQLite — `node:sqlite`, zero native deps)

**What it tells you:** the entire persistent state of the product — nine tables, no more. Actions are the spine; approvals, payouts and invoices hang off them; the audit chain is append-only and rebuildable. Note there is no session or credential table: the kill switch and policy live in the signed mandate, not in server memory.

```mermaid
erDiagram
  mandates ||--o{ audit : "MANDATE_SIGNED"
  actions ||--o{ audit : "ACTION_DECISION / EXECUTION"
  actions ||--o| approvals : "gated by"
  actions ||--o| payouts : "executed as"
  actions ||--o| invoices : "money-in"
  invoices ||--o{ audit : "reminder / webhook events"
  payouts ||--o{ audit : "status webhooks"
  verifications ||--o{ audit : "VERIFICATION records"
  runs {
    string runId PK
    string ucId
    string outcome
    int stepsCount
    string trace
  }
  verifications {
    string id PK
    string claim
    string verdict
    string reasonCode
    string jws
  }
  actions {
    string id PK
    string type
    real amount
    string payee
    string status
    string reasonCode
    string paypalRef
  }
  audit {
    int seq PK
    string prevHash
    string hash
    string jws
    string kind
  }
  approvals {
    string id PK
    string actionId FK
    string status
    string explanation
    string expiresAt
  }
  payouts {
    string batchId
    string actionId FK
    string idempotencyKey
    string status
  }
  invoices {
    string id PK
    string paypalId
    string status
    int remindersSent
  }
  mandates {
    int version
    string jws
    string json
  }
```

`meta` (key/value) holds the kill-switch flag and one-time bootstrap markers. Every table is rebuildable from the audit chain except credential-derived artifacts.

---

## 11. Deployment architecture

**What it tells you:** how this ships. One build (relative assets) runs at localhost, on Render (API + console same-origin — the full product), on a Vultr VM with Caddy auto-HTTPS (the live deployment: `https://139-84-172-28.sslip.io`), and on GitHub Pages (static console pointed at a hosted API). Cross-origin access is allow-listed and admin-token-guarded; nothing is open-wide. The webhook listener needs no dashboard step: with `PUBLIC_BASE_URL` set, the server self-registers it at boot and reconciles anything a delivery missed.

```mermaid
flowchart LR
  DEV["Local dev<br/>tsx watch :8787 + Vite :5173 (proxy)"] --> BUILD["vite build (base './')<br/>relative assets — one build, any host"]
  BUILD --> RENDER["Render web service<br/>serves API + console same-origin<br/>render.yaml blueprint · env secrets"]
  BUILD --> VM["Vultr VM (live)<br/>systemd mandate.service + Caddy HTTPS<br/>PUBLIC_BASE_URL → self-registered webhook"]
  BUILD --> GHP["GitHub Pages (static console)<br/>root index.html stub → web/dist/<br/>VITE_API_BASE → Render URL"]
  RENDER -- "health-check /api/health" --> USERS["Judges / operators"]
  VM -- "https://139-84-172-28.sslip.io" --> USERS
  GHP -- "cross-origin API (ALLOWED_ORIGINS<br/>+ x-mandate-token)" --> USERS
  VM -- "sandbox REST" --> PP["api-m.sandbox.paypal.com"]
  RENDER -- "sandbox REST" --> PP
  VM -- "boot: register webhook" --> PP
  PP -- "signed events → POST /api/paypal/webhook<br/>(verify + record + dedupe)" --> VM
  PP -- "live batch status at boot<br/>(reconcile misses)" --> VM
```

Security posture: no open CORS (allow-listed origins only), `MANDATE_ADMIN_TOKEN` guards every mutating route, `.env` gitignored, secrets scanned before every push.

---

## 12. Workflow — how a use-case run becomes dashboard evidence

**What it tells you:** why the numbers in RESULTS.md are trustworthy. A use-case run is not a script that prints a verdict — it drives the real pipeline, collects the trace, commits it to the runs table, and the same artifacts land on the Dashboard, in the Usecases UI and in `evidence/` for the repo. One source of truth, three views.

```mermaid
flowchart LR
  U["Usecases tab → Run (or Run all 12)"] --> R["POST /api/usecases/:id/run"]
  R --> RU["usecases/runner.ts<br/>drives the real pipeline step by step"]
  RU --> CP["agent parse → policy → approvals → gateway → audit"]
  CP --> T["TraceStep[] collected<br/>(labels, verdicts, reason codes, hashes)"]
  T --> DB["runs table (latest 40)"]
  T --> RES["UsecaseResult JSON"]
  DB --> DASH["Dashboard · Recorded runs<br/>expandable traces"]
  RES --> UI["Usecases card · metadata grid<br/>FRs · decisions · audit recs · last run"]
  RES --> EV["evidence/*.json<br/>committed raw artifacts"]
```

The Usecases tab and the Dashboard read the same recorded truth — the traces are the engine's real decisions, never canned copy.
