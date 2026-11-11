import { useMemo, useRef, useState } from 'react';
import type { AgGridReact as AgGridReactType } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { Download, Search, ShieldCheck, ShieldX } from 'lucide-react';
import { api, shortHash, shortTime, type AuditRecord } from '../lib/api';
import { DecisionPill } from './StatusPill';
import { useSSE } from '../hooks/useSSE';

ModuleRegistry.registerModules([AllCommunityModule]);

export function AuditGrid() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; count: number; brokenAt: number | null } | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; counterfactual: string | null; receiptSeq: number | null } | null>(null);
  // 3.0 — grid ref + quick filter (AG Grid's own cross-column search)
  const gridRef = useRef<AgGridReactType>(null);
  const [quick, setQuick] = useState('');

  const load = () =>
    api<{ records: AuditRecord[]; verify: typeof verify }>('/audit?limit=300')
      .then((r) => {
        setRecords(r.records);
        setVerify(r.verify);
      })
      .catch(() => {});

  useMemo(load, []);
  useSSE((type) => {
    if (type !== 'ping' && type !== 'hello') load();
  });

  const ask = async () => {
    if (!question.trim()) return;
    setAnswer(null);
    const r = await api<typeof answer>('/audit/query', { method: 'POST', body: JSON.stringify({ question }) });
    setAnswer(r);
  };

  const exportReceipt = async (seq: number) => {
    const r = await api<Record<string, unknown>>(`/audit/${seq}/receipt`);
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mandate-receipt-${seq}.json`;
    a.click();
  };

  // 3.3 — AG Grid's own CSV export over the whole (filtered) ledger
  const exportLedgerCsv = () =>
    gridRef.current?.api.exportDataAsCsv({ fileName: `mandate-audit-${Date.now()}.csv` });

  // 3.4 — decision-tinted rows: BLOCK/GATE/ALLOW jump out at a glance
  const getRowStyle = (p: any) => {
    const d = p.data?.decision;
    if (d === 'BLOCK') return { background: 'rgba(239, 68, 68, 0.07)' };
    if (d === 'GATE') return { background: 'rgba(245, 158, 11, 0.07)' };
    if (d === 'ALLOW') return { background: 'rgba(34, 197, 94, 0.05)' };
    return undefined;
  };

  // ag-grid-react invokes cellRenderer functions as React components — they must return JSX, not DOM nodes
  const columnDefs = useMemo(
    () => [
      { headerName: '#', field: 'seq', width: 64, sort: 'desc' as const, filter: 'agNumberColumnFilter' },
      { headerName: 'Time', field: 'ts', width: 100, valueFormatter: (p: any) => shortTime(p.value), filter: false },
      { headerName: 'Kind', field: 'kind', width: 140, filter: 'agTextColumnFilter' },
      {
        headerName: 'Decision', field: 'decision', width: 190, filter: 'agTextColumnFilter',
        cellRenderer: (p: any) => {
          if (!p.value) return <>—</>;
          const cls =
            p.value === 'ALLOW' ? 'bg-ok/15 text-ok border-ok/30' : p.value === 'GATE' ? 'bg-amber/15 text-amber border-amber/30' : 'bg-danger/15 text-danger border-danger/30';
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className={`pill ${cls}`} style={{ borderWidth: 1 }}>{p.value}</span>
              <span className="mono-hash">{p.data?.payload?.reasonCode ?? ''}</span>
            </span>
          );
        },
      },
      { headerName: 'Event', flex: 1, valueGetter: (p: any) => p.data?.payload?.event ?? '', filter: 'agTextColumnFilter' },
      {
        // 3.5 — right-aligned currency with a real number filter
        headerName: 'Amount', width: 110, type: 'rightAligned', filter: 'agNumberColumnFilter',
        valueGetter: (p: any) => (p.data?.payload?.amount != null ? Number(p.data.payload.amount) : null),
        valueFormatter: (p: any) => (p.value != null ? `$${Number(p.value).toFixed(2)}` : ''),
      },
      { headerName: 'Payee', width: 170, valueGetter: (p: any) => p.data?.payload?.payee ?? '', filter: 'agTextColumnFilter' },
      {
        // 3.5 — full hash on hover
        headerName: 'Hash ✓', field: 'hash', width: 130, tooltipField: 'hash',
        cellRenderer: (p: any) => <span className="mono-hash">{shortHash(p.value, 8)}</span>,
      },
      {
        headerName: 'Receipt', width: 90, pinned: 'right' as const, filter: false, sortable: false,
        cellRenderer: (p: any) => (
          <button className="text-[11px] text-accent hover:underline" onClick={() => exportReceipt(p.data.seq)}>
            export
          </button>
        ),
      },
    ],
    []
  );

  // 3.1 — filtering on every column + floating filter row (Community features)
  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      floatingFilter: true,
    }),
    []
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted">Audit Log — append-only · hash-chained</h3>
        <div className="flex items-center gap-2">
          {/* 3.2 — AG Grid quick filter: narrows every column live as you type */}
          <input
            className="input h-8 w-56 px-2.5 font-mono text-xs"
            placeholder="quick filter… (payee, BLOCK, hash)"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
          />
          {/* 3.3 — one-click CSV export of the whole filtered ledger */}
          <button className="btn-ghost h-8 px-2.5 text-xs" onClick={exportLedgerCsv}>
            <Download size={12} /> Export CSV
          </button>
          {verify && (
            <span className={`pill ${verify.ok ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-danger/15 text-danger border border-danger/30'}`}>
              {verify.ok ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
              chain verified · {verify.count} records
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder='Interrogate the trail: "why was the payout to NewVendor blocked?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button className="btn-ghost" onClick={ask}>
          <Search size={14} /> Ask
        </button>
      </div>

      {answer && (
        <div className="card border-accent/40 bg-accent/5 p-3 text-[13px] animate-fadeUp">
          <p className="text-ink/90">{answer.answer}</p>
          {answer.counterfactual && <p className="mt-1 text-teal">↳ {answer.counterfactual}</p>}
          {answer.receiptSeq != null && (
            <button className="mono-hash mt-1 text-accent hover:underline" onClick={() => exportReceipt(answer.receiptSeq!)}>
              export signed receipt for #{answer.receiptSeq} <Download size={10} className="inline" />
            </button>
          )}
        </div>
      )}

      <div className="ag-theme-quartz min-h-[420px] flex-1 overflow-hidden rounded-xl2 border border-edge">
        <AgGridReact
          ref={gridRef}
          rowData={records}
          columnDefs={columnDefs as any}
          defaultColDef={defaultColDef}
          quickFilterText={quick}
          getRowStyle={getRowStyle}
          animateRows
          tooltipShowDelay={300}
          rowHeight={34}
          headerHeight={32}
          floatingFiltersHeight={30}
          pagination
          paginationPageSize={50}
        />
      </div>
    </div>
  );
}
