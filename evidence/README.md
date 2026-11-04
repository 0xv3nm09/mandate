# Evidence — real artifacts from live PayPal sandbox runs

Every file here is a raw export from a real execution of the 12-use-case suite
(`POST /api/usecases/:id/run`) against PayPal's sandbox API — no hand-edited data.
Regenerate any time: Usecases tab → "Run all 12" → reset + re-export.

| File | What it proves |
|---|---|
| `usecases/UC-01…UC-12.json` | Full execution traces: every policy decision (ALLOW/GATE/BLOCK + reason codes), policy hits, PayPal refs, audit seqs. UC-03 shows the human gate → approve → payout; UC-04 the hard block; UC-10 the Netflix impostor catch; UC-12 the signed evidence pack. |
| `paypal-payouts.json` | Real payout batches created via `POST /v1/payments/payouts` — includes `CM9XMWV3ZZYFC` which **settled to SUCCESS on live PayPal** (funds moved between sandbox accounts). |
| `verifications.json` | Inbound-claim verdicts (the "Netflix check"): VERIFIED / SUSPICIOUS / IMPOSTOR with per-check details (directory, sender domain, amount envelope, history). |
| `verification-receipt-impostor.json` | The signed (JWS) receipt for the caught impostor — independently verifiable. |
| `audit-chain.json` | The full hash-chained audit ledger (SHA-256 prev→hash links) plus the recompute result `verify: ok`. |
| `evidence-pack-signed.json` | UC-12's dispute artifact: human approval record + PayPal batch + audit chain position + `packHash` + HMAC signature. |
| `mandate.json` | The signed Intent Mandate (JWS): limits, allowlist, standing envelope, version history. |
| `stats.json`, `health.json`, `paypal-toolkit.json`, `runs-summary.json` | System snapshot: governance counts, gateway mode (SANDBOX), official toolkit tools attached, recorded-run summaries. |

**How to verify independently:**
- Hash chain: recompute `sha256(prevHash|seq|ts|kind|payload)` per record in `audit-chain.json`.
- Verification receipts: check the JWS signature against the repo's documented HMAC scheme (`control-plane/verify.ts`).
- PayPal side: any `batchId` in `paypal-payouts.json` can be fetched with `GET /v1/payments/payouts/{id}` using the sandbox credentials.
