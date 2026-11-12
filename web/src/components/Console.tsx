import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgGridReact as AgGridReactType } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

ModuleRegistry.registerModules([AllCommunityModule]);
import {
  Database, Download, FileSignature, FlaskConical, Gauge, OctagonPause, Play, ReceiptText, RefreshCw, ScrollText, ShieldCheck, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { AgentConsole } from './AgentConsole';
import { ApprovalInbox } from './ApprovalInbox';
import { AuditGrid } from './AuditGrid';
import { MandateEditor } from './MandateEditor';
import { StatusPill } from './StatusPill';
import { useSSE } from '../hooks/useSSE';
import { money, type Invoice } from '../lib/api';

const TABS = [
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'mandate', label: 'Intent Mandate', icon: FileSignature },
  { id: 'invoices', label: 'Invoices', icon: ReceiptText },
] as const;

export function Console({ halted, onHaltChange }: { halted: boolean; onHaltChange: (h: boolean) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('audit');
  const [modes, setModes] = useState<{ paypal: string; llm: string } | null>(null);
  const [mandateVersion, setMandateVersion] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api<{ halted: boolean; mode: { paypal: string; llm: string }; mandateVersion: number }>('/health')
      .then((h) => {
        setModes(h.mode);
        setMandateVersion(h.mandateVersion);
      })
      .catch(() => {});
  }, []);

  const setHalt = async (h: boolean) => {
    await api('/system/halt', { method: 'POST', body: JSON.stringify({ halted: h }) });
    onHaltChange(h);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      {/* toolbar — same pattern as the Dashboard */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="kicker flex items-center gap-2"><Sparkles size={14} /> Operator console</p>
          <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight">Console</h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted">
            Instruct the agent in natural language; it can only <b className="text-ink/80">propose</b> — the control
            plane decides, and gated money-out waits for your tap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {modes && (
            <>
              <span className="pill bg-raised text-slate-300 border border-edge">PayPal: <b>{modes.paypal}</b></span>
              <span className="pill bg-raised text-slate-300 border border-edge">agent: <b>{modes.llm === 'LLM' ? 'LLM (AI SDK)' : 'deterministic'}</b></span>
            </>
          )}
          {mandateVersion != null && (
            <span className="pill bg-accent/15 text-indigo-300 border border-accent/30">
              <ShieldCheck size={12} /> mandate v{mandateVersion}
            </span>
          )}
          <button
            className="btn-primary"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                for (const id of ['UC-01','UC-02','UC-03','UC-04','UC-05','UC-06','UC-07','UC-08','UC-09','UC-10','UC-11','UC-12']) {
                  await api(`/usecases/${id}/run`, { method: 'POST' });
                }
              } finally { setRunning(false); }
            }}
            title="Execute the full 12-use-case suite live (sandbox)"
          >
            {running ? <><RefreshCw size={14} className="animate-spin" /> Running…</> : <><FlaskConical size={14} /> Run use cases</>}
          </button>
          <button className={halted ? 'btn-teal' : 'btn-danger'} onClick={() => setHalt(!halted)}>
            {halted ? <><Play size={14} /> Resume agent</> : <><OctagonPause size={14} /> Global stop</>}
          </button>
        </div>
      </div>

      {/* audit ledger + lower tabs — on top, so the hash-chained record is the first thing an operator sees */}
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`btn px-3.5 py-1.5 text-[13px] ${tab === t.id ? 'bg-accent/15 text-indigo-200 border border-accent/40' : 'bg-raised text-muted border border-edge hover:text-ink'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
        <span className="mono-hash ml-auto hidden sm:inline">everything here reads the same live control-plane state</span>
      </div>

      <div className="card card-gradient min-h-[560px] p-4">
        {tab === 'audit' && <AuditGrid />}
        {tab === 'mandate' && <MandateEditor />}
        {tab === 'invoices' && <InvoicesGrid />}
      </div>

      {/* main row — symmetric columns */}
      <div className="grid gap-4 pt-4 lg:grid-cols-2">
        <section className="card card-gradient flex h-[600px] flex-col p-4">
          <AgentConsole />
        </section>
        <section className="card card-gradient flex h-[600px] flex-col p-4">
          <ApprovalInbox />
        </section>
      </div>
    </div>
  );
}

function InvoicesGrid() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const gridRef = useRef<AgGridReactType>(null);
  const [quick, setQuick] = useState('');
  const load = () => api<{ invoices: Invoice[] }>('/invoices').then((r) => setInvoices(r.invoices));
  useSSE(() => {});
  useEffect(() => { load(); }, []);

  const columnDefs = useMemo(
    () => [
      { headerName: 'Invoice #', field: 'invoiceNumber', width: 150, filter: 'agTextColumnFilter' },
      { headerName: 'Memo', field: 'memo', flex: 1, filter: 'agTextColumnFilter' },
      { headerName: 'Payee', width: 170, valueGetter: (p: any) => p.data?.payeeName ?? p.data?.payee, filter: 'agTextColumnFilter' },
      {
        headerName: 'Amount', width: 110, type: 'rightAligned', filter: 'agNumberColumnFilter',
        valueGetter: (p: any) => p.data?.amount ?? null,
        valueFormatter: (p: any) => (p.value != null ? money(p.value, p.data.currency) : ''),
      },
      {
        headerName: 'Status', field: 'status', width: 120, filter: 'agTextColumnFilter',
        cellRenderer: (p: any) => <StatusPill status={p.value} />,
      },
      { headerName: 'Reminders', field: 'remindersSent', width: 110, filter: 'agNumberColumnFilter' },
      {
        headerName: 'PayPal ref', width: 190, filter: false,
        cellRenderer: (p: any) => <span className="mono-hash">{p.value}</span>,
      },
    ],
    []
  );

  const defaultColDef = useMemo(
    () => ({ sortable: true, resizable: true, filter: true, floatingFilter: true }),
    []
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted">
          <ReceiptText size={14} /> Invoices — agent-created on PayPal
        </h3>
        <div className="flex items-center gap-2">
          <input
            className="input h-8 w-56 px-2.5 font-mono text-xs"
            placeholder="quick filter… (payee, SENT, INV2)"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
          />
          <button
            className="btn-ghost h-8 px-2.5 text-xs"
            onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: `mandate-invoices-${Date.now()}.csv` })}
          >
            <Download size={12} /> Export CSV
          </button>
          <button className="btn-ghost h-8 px-2.5 text-xs" onClick={load}><RefreshCw size={12} /> refresh</button>
        </div>
      </div>
      <div className="ag-theme-quartz h-[460px] overflow-hidden rounded-xl2 border border-edge">
        <AgGridReact
          ref={gridRef}
          rowData={invoices}
          columnDefs={columnDefs as any}
          defaultColDef={defaultColDef}
          quickFilterText={quick}
          animateRows
          tooltipShowDelay={300}
          rowHeight={34}
          headerHeight={32}
          floatingFiltersHeight={30}
          pagination
          paginationPageSize={25}
        />
      </div>
      {invoices.length === 0 && (
        <p className="pb-2 text-center text-sm text-muted">No invoices yet — tell the agent: “Invoice Acme $1,200 for October design”.</p>
      )}
    </div>
  );
}
