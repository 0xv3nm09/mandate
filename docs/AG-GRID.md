# AG Grid in Mandate — the audit surface, in full

*How Mandate uses **AG Grid Community v34**: what the grids render, the operator workflows they
enable, the exact APIs used, and real screenshots from the running app. No Enterprise features —
everything here is Community (MIT).*

Primary grids: [`web/src/components/AuditGrid.tsx`](../web/src/components/AuditGrid.tsx) (audit
ledger) · [`web/src/components/Console.tsx`](../web/src/components/Console.tsx) → `InvoicesGrid`
(invoices) · theme: Quartz themed to the app via CSS variables in
[`web/src/index.css`](../web/src/index.css).

![Audit ledger in AG Grid — floating filter row, decision pills, receipt export column](screenshots/ag-audit-grid.png)

---

## 1. Why AG Grid is central here (not decoration)

Mandate's whole product is **accountability for money an AI agent moves**. The artifact that
delivers that is a **hash-chained audit ledger** — every proposal, decision, approval,
settlement, webhook and inbound-verification verdict, immutable and verifiable. That ledger is
**rendered in AG Grid**, and it is the operator's primary inspection surface (Console → Audit
Grid). When the agent is gated, blocked or questioned, the answer lives in the grid. So the grid
is not a demo table — it *is* the trust product's window into itself. That is the case for
"Best Use of AG Grid": meaningful, central, and non-trivial.

A second grid covers money-in: the **Invoices view** is also AG Grid (same filtering, quick
search, CSV export) — "built on AG Grid," not "dropped in."

## 2. The two grids

| Grid | Rows | Where | Purpose |
| --- | --- | --- | --- |
| **Audit ledger** | every audit record (decisions, executions, approvals, webhooks, verifications, mandate signatures) | Console → Audit Grid | Inspect and filter everything the agent did; export receipts |
| **Invoices** | agent-created PayPal invoices | Console → Invoices | Track money-in: status, reminders, PayPal refs |

![Invoices grid — same AG Grid treatment for money-in](screenshots/ag-invoices-grid.png)

## 3. What each feature is used for (operator workflows)

### Quick filter — "show me everything about this payee"

Type in the quick filter and every column narrows live:

![Quick filter BLOCK — only red-tinted block records remain](screenshots/ag-quick-filter-block.png)

**Operator workflow:** *"Show me only what was blocked."* One word — `BLOCK` — and the ledger
reduces to the guardrail's refusals, each row tinted red. Same trick answers *"everything for
sam@contractor.test"* or *"which records are VERIFICATION kind?"*

### Column filters + floating filter row

Every column carries its own filter with a **floating filter row** under the headers — filter
without opening a menu:

- `#` / `Amount` → **number filter** (e.g. `amount > 100`)
- `Decision` / `Kind` / `Payee` / `Event` → **text filter** (`contains BLOCK`, `starts WITH
  INV2`)
- `Time` → filter disabled (it duplicates `#` ordering)

### CSV export — take the audit with you

One button (`Export CSV`) calls AG Grid's `exportDataAsCsv` over the **currently filtered
ledger** — what you filtered is exactly what you export. Distinct from the per-row
**signed-JSON receipts** (those are cryptographic artifacts; the CSV is the analyst view).

### Decision-tinted rows

`getRowStyle` tints rows by decision: BLOCK red, GATE amber, ALLOW green — the guardrail's
shape is visible without reading a cell.

### Live SSE refresh

The grid subscribes to the approval/event stream: when a new decision lands (e.g. a use-case
run just blocked a payout), the row appears without a refresh. New decisions stream in while
you watch.

### Pinned receipt column + per-row export

The Receipt column stays pinned right while scrolling; each row exports its own **signed
mandate receipt** (JWS + chain context) — the per-record cryptographic counterpart to the CSV.

## 4. Reference — AG Grid APIs used (all Community)

| API / prop | Where | Notes |
| --- | --- | --- |
| `AgGridReact` + `AllCommunityModule` + `ModuleRegistry.registerModules` | both grids | v34 module registration |
| `ref` → `gridRef.current.api` | both grids | programmatic access for CSV export |
| `quickFilterText` | both grids | cross-column live search |
| `defaultColDef { sortable, resizable, filter: true, floatingFilter: true }` | both grids | filtering everywhere |
| `filter: 'agNumberColumnFilter'` / `'agTextColumnFilter'` / `false` | per column | right filter type per data shape |
| `getRowStyle` | audit grid | decision tinting |
| `cellRenderer` (React JSX) | Decision pills + reason codes, hash, receipt buttons, status pills | note: must return JSX, not DOM nodes |
| `valueGetter` / `valueFormatter` | Event, Amount, Payee, Time | pulls fields out of nested `payload`, formats currency/time |
| `pinned: 'right'` | Receipt column | export action always visible |
| `pagination` + `paginationPageSize` | both grids | 50 / 25 rows per page |
| `animateRows`, `tooltipShowDelay: 300`, `tooltipField` | both grids | polish; full hash on hover |
| `floatingFiltersHeight: 30`, `headerHeight: 32`, `rowHeight: 34` | both grids | compact ledger layout |
| Quartz theme via CSS variables | `web/src/index.css` | themed to the app (works in cream/orange light theme) |

## 5. How it was built (gotchas, from docs/FEEDBACK.md)

- **React cell renderers must return JSX** — returning DOM nodes crashes React (error #31,
  "Objects are not valid as a React child"). The AG Grid vanilla docs show DOM renderers; the
  React wrapper needs components.
- **Grid height**: AG Grid inside a `flex-1` container can compute a zero-height body viewport
  when the flex column also holds a floating-filter row — fixed heights (`h-[540px]` /
  `h-[460px]`) keep rows visible.
- **Theming**: Quartz CSS variables (`--ag-background-color`, `--ag-header-background-color`, …)
  match the app's surface/edge palette.

## 6. Showcase (half the prize is presentation)

In the demo video (10–15 s is enough, make it unmistakable):

- Type in the quick filter → rows narrow live.
- Open a column filter → `Decision = BLOCK` → only red-tinted blocks remain.
- Click **Export CSV** → the filtered audit downloads.
- Leave it running → a new row streams in via SSE as a use case fires.

In the Devpost "Tools / Built With" section, say it plainly:

> *Best Use of AG Grid — the hash-chained audit ledger (every governed money decision) is
> rendered in AG Grid Community: per-column filtering + floating filters, quick search, CSV
> export, decision-tinted rows, custom cell renderers (decision pills, signed-receipt export),
> pinned actions, and live SSE refresh. It's the operator's primary inspection surface, plus the
> invoices grid. AG Grid is how a user audits what the agent did.*

> Reminder: everything is **AG Grid Community** (MIT). No Enterprise-only features
> (master/detail, row grouping, status-bar aggregation, set filter, Excel export) — Community
> filtering + quick filter + CSV export + cell renderers + conditional styling is already a
> strong, clean "Best Use."
