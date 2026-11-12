import { useEffect, useState } from 'react';
import {
  Layers, Radio, Database, Cpu, ShieldCheck, Grid3x3, FileText, Webhook,
  CheckCircle2, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSSE } from '../hooks/useSSE';

type CallEntry = { ts: string; method: string; path: string; status: number; ms: number; ok: boolean; note?: string };
type StackData = {
  mode: { paypal: string; llm: string };
  webhook: { id: string | null; url: string | null; eventTypes: string[] };
  counts: {
    auditRecords: number; eventsIngested: number; invoices: number; invoicesSent: number;
    payoutBatches: number; payoutBatchesSuccess: number;
    approvals: Record<string, number>; verifications: Record<string, number>;
  };
  ruleHits: { k: string; c: number }[];
  chain: { ok: boolean; count: number; brokenAt: number | null };
  paypalLog: CallEntry[];
  toolkit: { available: boolean; reason?: string; toolNames?: string[] };
};

const timeOf = (iso: string) => iso.slice(11, 19);

function LogRow({ e }: { e: CallEntry }) {
  const ok = e.ok;
  return (
    <div className="flex items-center gap-2 border-b border-edge/40 py-1 last:border-0">
      <span className="w-[52px] shrink-0 text-muted/70">{timeOf(e.ts)}</span>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-ok' : e.status === 0 ? 'bg-amber-500' : 'bg-danger'}`} />
      <span className="w-16 shrink-0 font-semibold text-ink/80">{e.method === 'WEBHOOK' ? '⇄ WEBHOOK' : e.method}</span>
      <span className="min-w-0 flex-1 truncate text-ink/80" title={e.path}>{e.path}</span>
      <span className={`w-9 shrink-0 text-right font-semibold ${ok ? 'text-ok' : 'text-danger'}`}>{e.status || '—'}</span>
      <span className="w-14 shrink-0 text-right text-muted/70">{e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)}s` : `${e.ms}ms`}</span>
      <span className="hidden w-44 shrink-0 truncate text-muted/60 md:inline" title={e.note}>{e.note}</span>
    </div>
  );
}

function Panel({ icon, chip, title, sub, children }: {
  icon: React.ReactNode; chip: string; title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <section className="card card-gradient p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
        {title}
        <span className="ml-auto font-normal normal-case tracking-normal text-muted/60">{sub}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full border border-edge bg-raised px-2 py-0.5 text-[10px] font-medium text-muted">{children}</span>
);

const Stat = ({ label, value, tone = 'text-ink' }: { label: string; value: string | number; tone?: string }) => (
  <div className="rounded-lg border border-edge/60 bg-raised/60 px-2.5 py-1.5">
    <p className="text-[10px] uppercase tracking-wide text-muted/70">{label}</p>
    <p className={`font-display text-lg font-bold tabular-nums ${tone}`}>{value}</p>
  </div>
);

export function Stack() {
  const [data, setData] = useState<StackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<CallEntry[]>([]);
  const [connected, setConnected] = useState(false);

  const load = () => api<StackData>('/stack').then((d) => { setData(d); setLive(d.paypalLog); }).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);
  useSSE((type, dat) => {
    if (type === 'paypal.call') setLive((prev) => [dat as CallEntry, ...prev].slice(0, 80));
  });
  useEffect(() => {
    const es = new EventSource(`${location.origin}/api/approvals/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="card card-gradient p-6">
          <h1 className="font-display text-xl font-bold">Stack — live technical architecture</h1>
          <p className="mt-2 text-sm text-muted">
            This view needs the live backend (<code className="mono-hash">GET /api/stack</code>). On the
            read-only GitHub Pages snapshot it stays empty — run the stack locally or open the live
            deployment to see it{error ? ` (${error.slice(0, 140)})` : ''}.
          </p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="mx-auto max-w-7xl px-4 py-16 text-sm text-muted">loading the stack…</div>;
  }

  const c = data.counts;
  const approvals = c.approvals ?? {};
  const verifications = c.verifications ?? {};
  const totalRules = data.ruleHits.reduce((s, r) => s + r.c, 0);
  const maxHit = Math.max(1, ...data.ruleHits.map((r) => r.c));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Technical architecture</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">The stack, live</h1>
        <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${connected ? 'border-ok/40 bg-ok/10 text-ok' : 'border-edge bg-raised text-muted'}`}>
          <Radio size={11} className={connected ? 'animate-pulse-soft' : ''} /> {connected ? 'SSE live' : 'polling'}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Every number below is queried from the running system — the same process that executes the
        use cases. Nothing here is copy: refresh while a use case runs and watch the PayPal API log move.
      </p>

      {/* Live sandbox log */}
      <section className="card card-gradient mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-edge/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <Radio size={13} className="text-accent" />
          PayPal sandbox API log — real calls, as they happen
          <span className="ml-auto flex items-center gap-3 font-normal normal-case tracking-normal text-muted/60">
            <span className="mono-hash">GET /api/paypal/log</span>
            <button className="flex items-center gap-1 rounded-full border border-edge bg-raised px-2 py-0.5 hover:border-ink/40" onClick={load}>
              <RefreshCw size={10} /> refresh
            </button>
          </span>
        </div>
        <div className="max-h-[360px] overflow-y-auto bg-bg/50 px-4 py-2 font-mono text-[11px]">
          {live.length === 0 && <p className="py-6 text-center text-muted/60">no PayPal calls since boot — run a use case and watch this fill</p>}
          {live.map((e, i) => <LogRow key={`${e.ts}-${e.path}-${i}`} e={e} />)}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* PayPal rails */}
        <Panel icon={<Database size={14} />} chip="bg-accent/10 text-accent" title="PayPal rails" sub="docs/PAYPAL.md">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="invoices" value={c.invoices} />
            <Stat label="sent / delivered" value={`${c.invoicesSent}/${c.invoices}`} />
            <Stat label="payout batches" value={c.payoutBatches} />
            <Stat label="SUCCESS" value={c.payoutBatchesSuccess} tone="text-ok" />
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-edge/60 bg-raised/60 p-2.5">
            <Webhook size={14} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 text-[11px] leading-relaxed">
              <p className="font-semibold text-ink">webhook — self-registered at boot</p>
              {data.webhook.id ? (
                <>
                  <p className="mono-hash mt-0.5 truncate" title={data.webhook.url ?? ''}>{data.webhook.id} → {data.webhook.url}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {data.webhook.eventTypes.map((t) => <Chip key={t}>{t.replace('PAYMENT.', '').replace('INVOICING.', '')}</Chip>)}
                  </div>
                </>
              ) : (
                <p className="text-muted">not registered (set <code className="mono-hash">PUBLIC_BASE_URL</code> + sandbox keys; mock mode simulates events internally)</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>verifications:</span>
            <Chip>VERIFIED {verifications.VERIFIED ?? 0}</Chip>
            <Chip>SUSPICIOUS {verifications.SUSPICIOUS ?? 0}</Chip>
            <Chip>IMPOSTOR {verifications.IMPOSTOR ?? 0}</Chip>
            <a className="ml-auto flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/PAYPAL.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> every call, payload & real response
            </a>
          </div>
        </Panel>

        {/* AI core */}
        <Panel icon={<Cpu size={14} />} chip="bg-teal/10 text-teal" title="AI core" sub="docs/AI.md · docs/AGENT.md">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="agent mode" value={data.mode.llm === 'LLM' ? 'LLM' : 'deterministic'} />
            <Stat label="approved" value={approvals.APPROVED ?? 0} tone="text-ok" />
            <Stat label="denied" value={approvals.DENIED ?? 0} tone="text-danger" />
            <Stat label="pending" value={approvals.PENDING ?? 0} tone="text-amber-600" />
          </div>
          <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-ink/85">
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" /> tools are <b>propose-only</b> — <code className="mono-hash">propose_payout</code> ships with no <code className="mono-hash">execute</code>, so the model structurally cannot move money</li>
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" /> <b>0</b> money moved without first passing <code className="mono-hash">policy.evaluate()</code> — enforced by construction, asserted in CI</li>
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" /> the deterministic agent is the zero-key fallback: the trust layer never depends on a model</li>
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" /> official <code className="mono-hash">@paypal/agent-toolkit</code> attached read-only — {data.toolkit.available ? `attached (${data.toolkit.toolNames?.length} tools: eyes, never hands)` : 'activates on first agent call (eyes, never hands)'}</li>
          </ul>
        </Panel>

        {/* Trust layer */}
        <Panel icon={<ShieldCheck size={14} />} chip="bg-ok/10 text-ok" title="Deterministic trust layer" sub="docs/ARCHITECTURE.md">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="audit records" value={c.auditRecords} />
            <Stat label="webhook events ingested" value={c.eventsIngested} />
            <Stat label="chain" value={data.chain.ok ? 'verified' : 'BROKEN'} tone={data.chain.ok ? 'text-ok' : 'text-danger'} />
          </div>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">engine decisions by reason code — {totalRules} total</p>
          <div className="mt-1.5 space-y-1">
            {data.ruleHits.slice(0, 7).map((r) => (
              <div key={r.k} className="flex items-center gap-2 text-[11px]">
                <span className="w-40 shrink-0 font-mono text-ink/80">{r.k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge/70">
                  <div className="h-full rounded-full bg-accent/80" style={{ width: `${(r.c / maxHit) * 100}%` }} />
                </div>
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-muted">{r.c}</span>
              </div>
            ))}
            {data.ruleHits.length === 0 && <p className="text-[11px] text-muted/60">no decisions yet — run a use case</p>}
          </div>
        </Panel>

        {/* AG Grid */}
        <Panel icon={<Grid3x3 size={14} />} chip="bg-violet-500/10 text-accent" title="AG Grid — the inspection surface" sub="docs/AG-GRID.md">
          <p className="text-[12px] leading-relaxed text-ink/85">
            The audit ledger you see in the <b>Console</b> is AG Grid Community over this exact
            hash-chained data — <b>{c.auditRecords} rows</b> right now, fed by SSE:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip>floating filter row · 9 columns</Chip>
            <Chip>quick search</Chip>
            <Chip>CSV export of the filtered ledger</Chip>
            <Chip>decision-tinted rows</Chip>
            <Chip>per-row signed receipt export</Chip>
            <Chip>live SSE refresh</Chip>
            <Chip>DOM-virtualised ({c.auditRecords} rows, ~15 alive)</Chip>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <a className="flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/AG-GRID.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> full guide + screenshots
            </a>
            <span className="text-muted/50">·</span>
            <span>see it live: Console → Audit Log</span>
          </div>
        </Panel>
      </div>

      <p className="mt-4 flex items-center gap-2 text-[11px] text-muted/70">
        <Layers size={11} /> one endpoint powers this page: <code className="mono-hash">GET /api/stack</code> — counts, rule hits, chain status, webhook registration and the call journal from the running process.
      </p>
    </div>
  );
}
