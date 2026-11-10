import { useEffect, useState } from 'react';
import {
  Database, FileSignature, Gauge, OctagonPause, Play, ReceiptText, RefreshCw, ScrollText, ShieldCheck, Sparkles,
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
  { id: 'audit', label: 'Audit Grid', icon: ScrollText },
  { id: 'mandate', label: 'Intent Mandate', icon: FileSignature },
  { id: 'invoices', label: 'Invoices', icon: ReceiptText },
] as const;

export function Console({ halted, onHaltChange }: { halted: boolean; onHaltChange: (h: boolean) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('audit');
  const [modes, setModes] = useState<{ paypal: string; llm: string } | null>(null);
  const [mandateVersion, setMandateVersion] = useState<number | null>(null);

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
          <button className={halted ? 'btn-teal' : 'btn-danger'} onClick={() => setHalt(!halted)}>
            {halted ? <><Play size={14} /> Resume agent</> : <><OctagonPause size={14} /> Global stop</>}
          </button>
        </div>
      </div>

      {/* main row — symmetric columns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-gradient flex h-[600px] flex-col p-4">
          <AgentConsole />
        </section>
        <section className="card card-gradient flex h-[600px] flex-col p-4">
          <ApprovalInbox />
        </section>
      </div>

      {/* lower tabs */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`btn px-3.5 py-1.5 text-[13px] ${tab === t.id ? 'bg-accent/15 text-indigo-200 border border-accent/40' : 'bg-raised text-muted border border-edge hover:text-ink'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
        <span className="mono-hash ml-auto hidden sm:inline">everything below reads the same live control-plane state</span>
      </div>

      <div className="card card-gradient min-h-[560px] p-4">
        {tab === 'audit' && <AuditGrid />}
        {tab === 'mandate' && <MandateEditor />}
        {tab === 'invoices' && <Invoices />}
      </div>
    </div>
  );
}

function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const load = () => api<{ invoices: Invoice[] }>('/invoices').then((r) => setInvoices(r.invoices));
  useSSE(() => {});
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-[13.5px] font-semibold">
          <ReceiptText size={14} className="text-muted" /> Invoices — agent-created on PayPal
        </h3>
        <button className="btn-ghost px-2.5 py-1 text-xs" onClick={load}><RefreshCw size={12} /> refresh</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {invoices.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted">No invoices yet — tell the agent: “Invoice Acme $1,200 for October design”.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="p-2 font-semibold">Invoice</th>
                <th className="p-2 font-semibold">Payee</th>
                <th className="p-2 font-semibold">Amount</th>
                <th className="p-2 font-semibold">Status</th>
                <th className="p-2 font-semibold">Reminders</th>
                <th className="p-2 font-semibold">PayPal ref</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-edge/60 hover:bg-raised/40">
                  <td className="p-2 font-semibold">{i.invoiceNumber}<span className="ml-2 text-slate-500">{i.memo}</span></td>
                  <td className="p-2 text-muted">{i.payeeName ?? i.payee}</td>
                  <td className="p-2 font-mono text-[12px]">{money(i.amount, i.currency)}</td>
                  <td className="p-2">
                    <StatusPill status={i.status} />
                    {i.status === 'CREATED' && (
                      <button
                        className="ml-2 text-[11px] text-accent hover:underline"
                        onClick={async () => {
                          await api(`/invoices/${i.id}/resend`, { method: 'POST' }).catch(() => {});
                          load();
                        }}
                        title="Attempt send again (needs PAYPAL_SANDBOX_RECIPIENT configured)"
                      >
                        resend
                      </button>
                    )}
                  </td>
                  <td className="p-2 text-muted">{i.remindersSent}</td>
                  <td className="p-2 mono-hash">{i.paypalId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
