# AG Grid in Mandate — usage, dev guide, and how to showcase it

*Two things in one doc: (1) **how Mandate uses AG Grid** — the case for "Best Use of AG Grid"; (2) a **developer guide** to level it up, with copy-paste code. All AG Grid **Community** (free) — no Enterprise features, no licence question.*

Primary grid: [`web/src/components/AuditGrid.tsx`](../web/src/components/AuditGrid.tsx) · version: `ag-grid-community` / `ag-grid-react` **v34** · theme: Quartz (themed to the app via CSS variables in [`web/src/index.css`](../web/src/index.css)).

---

## 1. Why AG Grid here (the meaningful, central use)

Mandate's whole product is **accountability for money an AI agent moves**. The artifact that delivers that is a **hash-chained audit ledger** — every proposal, decision, approval, settlement and webhook, immutable and verifiable. That ledger is **rendered in AG Grid**, and it is the operator's primary inspection surface (Console → Audit Grid). So the grid isn't decoration or a demo table — it *is* the trust product's window into itself. Meaningful + central, which is what a sponsor judge rewards.

## 2. What Mandate uses today

| AG Grid feature | Where | What it does |
|---|---|---|
| `AgGridReact` + `AllCommunityModule` | `AuditGrid.tsx` | The ledger grid |
| Custom **cell renderers** (JSX) | Decision, Hash, Receipt columns | Decision pill + reason code, shortened hash, per-row signed-receipt export button |
| **valueGetter** over nested data | Event / Amount / Payee | Pulls fields out of each record's `payload` object |
| **valueFormatter** | Time column | Formats the ISO timestamp |
| **Pinned column** | Receipt (`pinned: 'right'`) | Keeps the export action visible while scrolling |
| **Sorting** (default desc on `#`) + resizable | all columns | Sort/resize |
| **Pagination** | grid | 50 rows/page |
| **Live refresh** | SSE hook | New decisions stream into the grid in real time |

That's a genuine, non-trivial use. The guide below turns it from "a good table" into "a data grid," which is the bar for the prize.

---

## 3. Developer guide — level it up (AG Grid Community only)

> Edit one file, `web/src/components/AuditGrid.tsx`. Each block is additive. After editing, `cd web && npm run build` (or `npm run dev`).

### 3.0 Add a grid ref (needed for export/quick-filter)
```tsx
import { useMemo, useRef, useState } from 'react';
import type { AgGridReact as AgGridReactType } from 'ag-grid-react';
// ...
const gridRef = useRef<AgGridReactType>(null);
const [quick, setQuick] = useState('');
```
…and on the grid element: `<AgGridReact ref={gridRef} quickFilterText={quick} … />`

### 3.1 Column filtering + floating filters  *(the #1 data-grid feature — you have none today)*
```tsx
const defaultColDef = useMemo(() => ({
  sortable: true,
  resizable: true,
  filter: true,            // text filter on every column
  floatingFilter: true,    // inline filter row under the headers
}), []);
```
Then on specific columns, the right filter type:
```tsx
{ headerName: 'Amount', filter: 'agNumberColumnFilter', /* …valueGetter… */ },
{ headerName: 'Decision', field: 'decision', filter: 'agTextColumnFilter', /* …renderer… */ },
```
Now a judge can filter to `Decision = BLOCK` or `Amount > 100` from the UI.

### 3.2 Quick search across all columns
```tsx
<input
  className="input flex-1"
  placeholder="Quick filter the ledger… (payee, decision, hash, event)"
  value={quick}
  onChange={(e) => setQuick(e.target.value)}
/>
```
`quickFilterText={quick}` on the grid (from 3.0) does the rest — AG Grid filters every row live. (Keep your existing NL "interrogate" box; they're different — this filters, that reasons.)

### 3.3 Built-in CSV export  *(uses AG Grid's own export API — on-brand "export your audit")*
```tsx
const exportLedgerCsv = () =>
  gridRef.current?.api.exportDataAsCsv({ fileName: `mandate-audit-${Date.now()}.csv` });
// button:
<button className="btn-ghost" onClick={exportLedgerCsv}><Download size={14}/> Export CSV</button>
```
This is distinct from your per-row JSON receipt export — it shows the grid's own data-export feature over the whole, filtered ledger.

### 3.4 Conditional row styling by decision  *(visual + meaningful — see the guardrail at a glance)*
```tsx
const getRowStyle = (p: any) => {
  const d = p.data?.decision;
  if (d === 'BLOCK') return { background: 'rgba(239,68,68,0.06)' };
  if (d === 'GATE')  return { background: 'rgba(245,158,11,0.06)' };
  if (d === 'ALLOW') return { background: 'rgba(34,197,94,0.05)' };
  return undefined;
};
// grid prop: getRowStyle={getRowStyle}
```
Or per-cell via `cellClassRules` on the Decision column. Either way, BLOCK rows jump out — which is the whole point of an audit view.

### 3.5 Polish (cheap, high-perceived-quality)
```tsx
// on <AgGridReact …>:
animateRows
tooltipShowDelay={300}
// Hash column: full hash on hover
{ headerName: 'Hash ✓', field: 'hash', tooltipField: 'hash', /* …renderer… */ },
// Amount: right-aligned currency
{ headerName: 'Amount', type: 'rightAligned',
  valueGetter: (p:any)=>p.data?.payload?.amount ?? null,
  valueFormatter: (p:any)=> p.value!=null ? `$${Number(p.value).toFixed(2)}` : '' },
```

### 3.6 Tier 2 — a second grid (the differentiator)
The Console **Invoices** view (`web/src/components/Console.tsx → Invoices()`) is a plain HTML `<table>`. Convert it to an `AgGridReact` (columns: invoice #, payee, amount, status pill, reminders, PayPal ref) with the same filtering/export. Two grids across money-in **and** the audit reads as "built on AG Grid," not "dropped one in" — a real edge for "Best Use."

---

## 4. How to showcase it (half the prize is presentation)

**In the video (10–15s is enough, but make it unmistakable):**
- Type in the quick filter → rows narrow live.
- Open a column filter → pick `Decision = BLOCK` → only blocks remain, tinted red.
- Click **Export CSV** → a file downloads.
- Leave it running → a new row streams in via SSE as a use case fires.

**In the Devpost "Tools" / "Built With" section, say it plainly:**
> *Best Use of AG Grid — the hash-chained audit ledger (every governed money decision) is rendered in AG Grid Community: per-column filtering + floating filters, quick search, CSV export, decision-tinted rows, custom cell renderers (decision pills, signed-receipt export), pinned actions, and live SSE refresh. It's the operator's primary inspection surface, plus the invoices grid. AG Grid is how a user audits what the agent did.*

Sponsor judges skim for their tool — make it central, make it move, name it.

---

## 5. Where to link / share this

- **README** — the "Stack → AG Grid (sponsor tool) usage" section links here (added). That's the canonical in-repo pointer.
- **Devpost submission** — in the "Tools" field, link this doc on the public repo: `https://github.com/0xv3nm09/mandate/blob/main/docs/AG-GRID.md`.
- **Video description** — drop the same link so the AG Grid judge can jump straight to it.

> Reminder: everything here is **AG Grid Community** (MIT). Do **not** add or claim Enterprise-only features (master/detail, row grouping, status-bar aggregation, set filter, Excel export) — Community filtering + quick filter + CSV export + cell renderers + conditional styling is already a strong, clean "Best Use."
