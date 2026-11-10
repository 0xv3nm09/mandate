# Evidence map — criteria → proof

Every judging criterion below maps to a runnable command or a committed artifact. The raw
machine-collected bundle lives in [`evidence/`](../evidence/) and is regenerated from real
live-sandbox runs by the use-case suite (`Usecases → Run all 12`). Nothing on this page is a
claim without a pointer.

## 60-second tour

```bash
git clone https://github.com/0xv3nm09/mandate && cd mandate/server
npm install && npm run dev          # Node ≥ 24 — zero keys, mock gateway
# → http://localhost:8787  ·  Usecases tab → “Run all 12 sequentially”
```

Watch for: UC-03 (gated payout → one-tap approve → real batch), UC-04 (hard block, no
approval path), UC-10 (the Netflix impostor stamp). Then verify the chain yourself:
`curl localhost:8787/api/audit/verify` → `{"ok":true,...}`.

## Judging criteria → evidence

| Criterion | What we show | Evidence |
| --- | --- | --- |
| **Technological Implementation** — thorough, skilled use of PayPal + AI; working, non-trivial | Three-layer PayPal integration: official agent-toolkit (read-only) + documented REST (Invoicing v2 create/send/remind, Payouts v1 with `sender_batch_id` idempotency, webhook signature verification, `simulate-event`) + native auto-reminders. AI: Vercel AI SDK v5 governed tool loop (`propose_payout` has **no execute** — the model cannot move money), LLM-written risk summaries/reminders, deterministic fallback agent so the trust layer never depends on a model. | [`evidence/paypal-toolkit.json`](../evidence/paypal-toolkit.json) · [`evidence/paypal-payouts.json`](../evidence/paypal-payouts.json) (real batches incl. one settled `SUCCESS`) · [`docs/FEEDBACK.md`](FEEDBACK.md) items 1–7 (the API realities we handled) · [`SYSTEM_CARD.md`](../SYSTEM_CARD.md) |
| **Design** — complete, coherent product experience | Four designed surfaces (Home pitch → Dashboard ops → Usecases proof → Console operations), live-data everywhere (recorded outcomes on the landing page, KPIs from the audit chain), AG Grid audit ledger with exportable signed receipts, approval inbox with AI risk summaries + TTL. | [`docs/media/`](media/) — poster + animated governed-payout explainer in the README; run the app for the live surfaces |
| **Potential Impact** — real problem, real audience, solution addresses it | Agentic commerce is funded and growing, but no guardrail layer serves PayPal's own core audience (freelancers/micro-merchants). Mandate closes the loop: invoice → collect → verify inbound → pay out → dispute, every step governed. | README "Why this matters now" · UC-10/11 (inbound fraud) · UC-12 (disputes) |
| **Innovation/Idea** — creative, novel, differs from existing | Deterministic control plane where the agent *proposes only* (AP2's "verifiable intent" implemented); risk-proportional autonomy incl. pre-authorized standing envelopes that gate on drift; hash-chained interrogable audit with signed receipts; known-merchant impostor detection. | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) · [`evidence/verification-receipt-impostor.json`](../evidence/verification-receipt-impostor.json) |
| **Presentation** — video demonstrates it working end-to-end | Demo GIF on the README shows the four surfaces live; 12/12 recorded suite with full traces committed; every trace inspectable in the UI and in `evidence/usecases/`. | README GIF · [`evidence/runs-summary.json`](../evidence/runs-summary.json) |

## Trust-layer guarantees → proof

| Guarantee | Proof |
| --- | --- |
| No LLM on the decision path | `server/src/control-plane/policy.ts` — pure function, zero I/O; CI boots the server and asserts UC-04 blocks |
| Hard blocks are un-bypassable | UC-04 trace: no approval path exists for non-allowlisted payees ([`evidence/usecases/UC-04.json`](../evidence/usecases/UC-04.json)) |
| Money-out is idempotent | `approval:` / `standing:` / `governed:` keys + PayPal `sender_batch_id`; duplicate-after-reset is a no-op (FEEDBACK #3) |
| Audit is tamper-evident | `GET /api/audit/verify` recomputes every SHA-256 link → [`evidence/audit-chain.json`](../evidence/audit-chain.json) `verify.ok = true` |
| Receipts are independently verifiable | [`evidence/verification-receipt-impostor.json`](../evidence/verification-receipt-impostor.json) · [`evidence/evidence-pack-signed.json`](../evidence/evidence-pack-signed.json) (packHash + HMAC) |
| Kill switch works | UC-06: a live payout attempt refused while halted |

## Deliverable status

- ✅ App runs from a clean clone in under a minute (CI does exactly this on every push)
- ✅ Live PayPal sandbox verified: OAuth, invoice create, payout batches (one settled `SUCCESS`), toolkit attached
- ⚠️ Invoice *send* + payout *settlement* additionally need `PAYPAL_SANDBOX_RECIPIENT` configured (documented; UC-01 degrades honestly to `CREATED`)
- ✅ Open source (MIT) · third-party notices · system card · diagrams · evidence bundle
