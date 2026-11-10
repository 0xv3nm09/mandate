#!/usr/bin/env python3
"""Render docs/RESULTS.md from the committed evidence bundle.

Usage: python3 scripts/render_results_md.py   (from the repo root)

Reads evidence/usecases/UC-*.json + evidence/*.json — the raw artifacts the
use-case suite writes on every live run — and produces the expected-vs-got
results document. No hand-edited numbers: if it's on this page, it's in the JSON.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EV = ROOT / "evidence"

EXPECTED = {
    "UC-01": ("Autonomous invoicing", "ok", "money-in runs with no approval path"),
    "UC-02": ("Autonomous chase", "ok", "AI-drafted reminder, tone escalates"),
    "UC-03": ("Gated payout (the money shot)", "gate", "over-threshold payout held for one human tap"),
    "UC-04": ("The guardrail", "block", "off-policy payout refused, no bypass"),
    "UC-05": ("Audit everything", "ok", "hash chain recomputes clean"),
    "UC-06": ("Global stop", "block", "kill switch refuses a live attempt"),
    "UC-07": ("Speak your policy", "ok", "NL mandate diff re-signed"),
    "UC-08": ("Standing payout autonomy", "ok", "in-bounds runs unattended; drift gates"),
    "UC-09": ("Interrogate the trail", "ok", "audit Q&A + signed receipt"),
    "UC-10": ("Impostor detection (Netflix check)", "block", "lookalike + outlier = IMPOSTOR"),
    "UC-11": ("Subscription guard", "ok", "real bill verifies; price hike flags"),
    "UC-12": ("Dispute evidence pack", "ok", "signed pack from live batch"),
}

OUTCOME_ICON = {"ok": "✅", "gate": "🟡", "block": "⛔", "error": "❌"}


def main() -> None:
    runs = []
    for p in sorted((EV / "usecases").glob("UC-*.json")):
        runs.append(json.loads(p.read_text()))

    stats = json.loads((EV / "stats.json").read_text())
    chain = json.loads((EV / "audit-chain.json").read_text())
    payouts = json.loads((EV / "paypal-payouts.json").read_text())
    verifs = json.loads((EV / "verifications.json").read_text())

    matched = sum(1 for r in runs if r["outcome"] == EXPECTED[r["id"]][1])
    lines = []
    w = lines.append
    w("# Results — 12-use-case suite, executed on the live PayPal sandbox")
    w("")
    w(f"_Rendered from the committed evidence bundle by `scripts/render_results_md.py` — "
      f"**{matched}/{len(runs)} expected outcomes matched**, every number below is machine-collected._")
    w("")
    w(f"Run date: `{runs[0]['ranAt'] if runs else '—'}` · audit chain: "
      f"**{chain['verify']['count']} records, verify={'ok' if chain['verify']['ok'] else 'BROKEN'}** · "
      f"governed actions: **{stats['governed']}** · money moved: **${stats['moneyIn']:,} in / ${stats['moneyOut']:,} out**")
    w("")
    w("## Expected vs got")
    w("")
    w("| UC | Use case | Expected | Got | Headline (verbatim from the run) |")
    w("| --- | --- | --- | --- | --- |")
    for r in runs:
        exp = EXPECTED[r["id"]]
        got = r["outcome"]
        mark = "✅" if got == exp[1] else "❌"
        w(f"| {r['id']} | {exp[0]} | {exp[1]} | {mark} {got} | {r['headline']} |")
    w("")
    w("## Real PayPal objects created by this sweep")
    w("")
    w("| Payout batch | Status | Amount | Payee (logical) | Idempotency key |")
    w("| --- | --- | --- | --- | --- |")
    for b in payouts["batches"]:
        w(f"| `{b['batchId']}` | **{b['status']}** | ${b['amount']:.0f} | {b['payee']} | `{b['idempotencyKey'][:44]}` |")
    w("")
    imp = [v for v in verifs if v["verdict"] == "IMPOSTOR"]
    if imp:
        v = imp[0]
        w(f"**Impostor caught:** claim “{v['claim']['brand']} ${v['claim']['amount']:.2f}” from `{v['claim']['from']}` → "
          f"**{v['verdict']}** ({v['reasonCode']}) — signed receipt `{v['id']}`.")
        w("")
    w("## Per-use-case traces (condensed)")
    w("")
    for r in runs:
        w(f"### {r['id']} · {EXPECTED[r['id']][0]}  {OUTCOME_ICON.get(r['outcome'], '')}")
        w("")
        w(f"**{r['headline']}**")
        w("")
        w(f"_{len(r['steps'])} steps · {r['durationMs']} ms · audit records: "
          f"{', '.join(f'#{s}' for s in r['auditSeqs'][:8]) or '—'}_")
        w("")
        for s in r["steps"]:
            icon = {"ok": "✅", "gate": "🟡", "block": "⛔", "error": "❌", "info": "·"}[s["status"]]
            w(f"- {icon} **{s['label']}** — {s['detail']}")
        w("")
    w("## Verdict mix")
    w("")
    mix: dict[str, int] = {}
    for r in runs:
        mix[r["outcome"]] = mix.get(r["outcome"], 0) + 1
    w("```")
    for k in ("ok", "gate", "block"):
        n = mix.get(k, 0)
        w(f"  {k:12} {'█' * (n * 4)}   {n}")
    w("```")
    w("")
    w("---")
    w("_Raw JSON for every run: [`evidence/usecases/`](../evidence/usecases/). Regenerate this page: "
      "`Usecases → Run all 12` → export → `python3 scripts/render_results_md.py`._")

    out = ROOT / "docs" / "RESULTS.md"
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out} ({matched}/{len(runs)} matched)")


if __name__ == "__main__":
    main()
