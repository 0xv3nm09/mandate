import { useMemo, useState } from 'react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { ShieldCheck, ShieldX, Download, Search } from 'lucide-react';
import { api, shortHash, shortTime, type AuditRecord } from '../lib/api';
import { DecisionPill } from './StatusPill';
import { useSSE } from '../hooks/useSSE';

ModuleRegistry.registerModules([AllCommunityModule]);

export function AuditGrid() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; count: number; brokenAt: number | null } | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; counterfactual: string | null; receiptSeq: number | null } | null>(null);

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

  // ag-grid-react invokes cellRenderer functions as React components — they must return JSX, not DOM nodes
  const columnDefs = useMemo(
    () => [
      { headerName: '#', field: 'seq', width: 64, sort: 'desc' as const },
      { headerName: 'Time', field: 'ts', width: 100, valueFormatter: (p: any) => shortTime(p.value) },
      { headerName: 'Kind', field: 'kind', width: 150 },
      {
        headerName: 'Decision', field: 'decision', width: 190,
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
      { headerName: 'Event', flex: 1, valueGetter: (p: any) => p.data?.payload?.event ?? '' },
      { headerName: 'Amount', width: 100, valueGetter: (p: any) => (p.data?.payload?.amount != null ? `$${p.data.payload.amount}` : '') },
      { headerName: 'Payee', width: 170, valueGetter: (p: any) => p.data?.payload?.payee ?? '' },
      {
        headerName: 'Hash ✓', field: 'hash', width: 130,
        cellRenderer: (p: any) => <span className="mono-hash">{shortHash(p.value, 8)}</span>,
      },
      {
        headerName: 'Receipt', width: 90, pinned: 'right' as const,
        cellRenderer: (p: any) => (
          <button className="text-[11px] text-accent hover:underline" onClick={() => exportReceipt(p.data.seq)}>
            export
          </button>
        ),
      },
    ],
    []
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted">Audit Log — append-only · hash-chained</h3>
        {verify && (
          <span className={`pill ${verify.ok ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-danger/15 text-danger border border-danger/30'}`}>
            {verify.ok ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
            chain verified · {verify.count} records
          </span>
        )}
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

      <div className="ag-theme-quartz h-full min-h-[420px] flex-1 overflow-hidden rounded-xl2 border border-edge">
        <AgGridReact
          rowData={records}
          columnDefs={columnDefs as any}
          defaultColDef={{ sortable: true, resizable: true }}
          rowHeight={34}
          headerHeight={32}
          pagination
          paginationPageSize={50}
        />
      </div>
    </div>
  );
}
