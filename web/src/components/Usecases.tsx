import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, AlertTriangle, ChevronDown, CircleDashed, FlaskConical, Play, RefreshCw, ShieldX, Timer,
} from 'lucide-react';
import { api, shortTime, type CatalogEntry, type RunRecord, type RunSummary, type TraceStep, type UsecaseResult } from '../lib/api';
import { StepDot } from './StatusPill';
import { useSSE } from '../hooks/useSSE';

const DECISION_CHIP: Record<string, string> = {
  ALLOW: 'bg-ok/12 text-ok border-ok/25',
  GATE: 'bg-amber/12 text-amber border-amber/25',
  BLOCK: 'bg-danger/12 text-danger border-danger/25',
  HALT: 'bg-danger/12 text-danger border-danger/25',
  SIGN: 'bg-accent/12 text-indigo-300 border-accent/25',
  VERIFY: 'bg-teal/12 text-teal border-teal/25',
};

const KIND_CHIP: Record<string, string> = {
  'money-in': 'text-teal border-teal/25 bg-teal/8',
  'money-out': 'text-amber border-amber/25 bg-amber/8',
  trust: 'text-teal border-teal/25 bg-teal/8',
  control: 'text-danger border-danger/25 bg-danger/8',
  policy: 'text-indigo-300 border-accent/25 bg-accent/8',
  verification: 'text-fuchsia-300 border-fuchsia-500/25 bg-fuchsia-500/8',
};

const OUTCOME_META: Record<string, { cls: string; icon: JSX.Element; label: string }> = {
  ok: { cls: 'bg-ok/15 text-ok border border-ok/30', icon: <CheckCircle2 size={12} />, label: 'ran · autonomous path held' },
  gate: { cls: 'bg-amber/15 text-amber border border-amber/30', icon: <AlertTriangle size={12} />, label: 'ran · gate engaged' },
  block: { cls: 'bg-danger/15 text-danger border border-danger/30', icon: <ShieldX size={12} />, label: 'ran · guardrail held' },
  error: { cls: 'bg-danger/20 text-danger border border-danger/40', icon: <AlertTriangle size={12} />, label: 'error' },
};

export function Usecases() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [results, setResults] = useState<Record<string, UsecaseResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runOrder, setRunOrder] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const loadCatalog = useCallback(() => {
    api<{ catalog: CatalogEntry[] }>('/usecases').then((r) => setCatalog(r.catalog));
  }, []);
  useEffect(loadCatalog, [loadCatalog]);
  useSSE(() => {});

  // Seed cards from the server's recorded runs so a fresh page shows real history
  // (live results from this session always take precedence).
  useEffect(() => {
    api<RunSummary[]>('/runs').then((runs) => {
      const seeded: Record<string, UsecaseResult> = {};
      const order: string[] = [];
      for (const r of runs) {
        if (!seeded[r.ucId]) {
          seeded[r.ucId] = {
            id: r.ucId, runId: r.runId, title: r.ucTitle, outcome: r.outcome, headline: r.headline,
            steps: [], auditSeqs: r.auditSeqs, ranAt: r.ranAt, durationMs: r.durationMs,
          };
          order.push(r.ucId);
        }
      }
      setResults((x) => ({ ...seeded, ...x }));
      setRunOrder((o) => [...o, ...order.filter((k) => !o.includes(k))]);
    }).catch(() => {});
  }, []);

  const toggle = async (id: string) => {
    const willOpen = !open[id];
    setOpen((o) => ({ ...o, [id]: willOpen }));
    const r = results[id];
    // summary seeded from /api/runs has no steps — fetch the full recorded trace
    if (willOpen && r && r.steps.length === 0 && r.runId) {
      try {
        const full = await api<RunRecord>(`/runs/${r.runId}`);
        setResults((x) => ({ ...x, [id]: { ...x[id], steps: full.steps } }));
      } catch { /* leave the headline visible */ }
    }
  };

  const run = async (id: string) => {
    setRunning(id);
    setOpen((o) => ({ ...o, [id]: true }));
    const t0 = Date.now();
    try {
      const r = await api<UsecaseResult>(`/usecases/${id}/run`, { method: 'POST' });
      setResults((x) => ({ ...x, [id]: r }));
      setRunOrder((o) => [id, ...o.filter((k) => k !== id)]);
    } catch (e: any) {
      setResults((x) => ({
        ...x,
        [id]: { id, outcome: 'error', title: id, headline: e.message, steps: [], auditSeqs: [], ranAt: new Date().toISOString(), durationMs: Date.now() - t0 },
      }));
      setRunOrder((o) => [id, ...o.filter((k) => k !== id)]);
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    for (const c of catalog) await run(c.id); // sequential: each UC builds on real state
  };

  const ranCount = Object.keys(results).length;
  const outcomeCounts = Object.values(results).reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      {/* toolbar */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker flex items-center gap-2"><FlaskConical size={14} /> Proof, not promises</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">
            Use cases — <span className="text-aurora">run for real</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Every scenario executes end-to-end through the actual pipeline — agent parse → deterministic policy
            engine → approval gate → PayPal gateway → hash-chained audit. Traces are the engine's real decisions,
            and every run is recorded to the dashboard.
          </p>
        </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <button className="btn-primary" onClick={runAll} disabled={!!running}>
                <Play size={14} /> Run all {catalog.length || 12} sequentially
              </button>
            <button
              className="btn-ghost"
              onClick={async () => {
                await api('/system/reset', { method: 'POST' });
                setResults({});
                setRunOrder([]);
              }}
            >
              <RefreshCw size={14} /> Reset demo state
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="pill bg-raised border border-edge">{ranCount}/{catalog.length || 12} run</span>
            {Object.entries(outcomeCounts).map(([k, v]) => (
              <span key={k} className={`pill ${OUTCOME_META[k]?.cls ?? 'bg-raised border border-edge'}`}>
                {v} {k}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* cards — Vultr-style dense resources */}
      <div className="grid gap-2.5">
        {[...catalog].sort((a, b) => {
          const ia = runOrder.indexOf(a.id), ib = runOrder.indexOf(b.id);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.id.localeCompare(b.id);
        }).map((c) => {
          const r = results[c.id];
          return (
            <UsecaseCard
              key={c.id}
              entry={c}
              result={r}
              running={running === c.id}
              open={!!open[c.id]}
              onToggle={() => toggle(c.id)}
              onRun={() => run(c.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function UsecaseCard({
  entry, result, running, open, onToggle, onRun,
}: {
  entry: CatalogEntry;
  result?: UsecaseResult;
  running: boolean;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
}) {
  const status = running ? 'running' : result ? result.outcome : 'idle';
  const border =
    status === 'running' ? 'border-accent/60 shadow-glow' :
    result?.outcome === 'ok' ? 'border-ok/35' :
    result?.outcome === 'gate' ? 'border-amber/35' :
    result?.outcome === 'block' ? 'border-danger/35' :
    result?.outcome === 'error' ? 'border-danger/60' : 'border-edge';

  return (
    <div className={`card card-gradient ${border} overflow-hidden transition-all duration-200`}>
      {/* header row */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="mono-hash shrink-0 rounded-md border border-edge bg-raised px-2 py-1 font-semibold">{entry.id}</span>
        <span className={`pill hidden shrink-0 sm:inline-flex border ${KIND_CHIP[entry.kind] ?? 'bg-raised text-slate-400 border-edge'}`}>{entry.kind}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[15px] font-semibold leading-tight">{entry.title}</h3>
          <p className="truncate text-xs text-muted">{entry.detail}</p>
        </div>
        <StatusBadge status={status} result={result} />
        <button className="btn-primary shrink-0 px-3.5 py-1.5 text-[13px]" onClick={onRun} disabled={running}>
          {running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? 'Running…' : result ? 'Re-run' : 'Run'}
        </button>
        {result && (
          <button className="flex items-center gap-1 text-[11px] text-muted hover:text-ink" onClick={onToggle}>
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            trace
          </button>
        )}
      </div>

      {/* metadata strip — Vultr-style key/value grid */}
      <div className="grid grid-cols-2 gap-px border-t border-edge/60 bg-edge/40 md:grid-cols-4">
        <MetaCell label="Requirements" value={<span className="mono-hash">{entry.frs.join(' · ')}</span>} />
        <MetaCell
          label="Engine decisions"
          value={
            <span className="flex flex-wrap gap-1">
              {entry.decisions.map((d) => (
                <span key={d} className={`pill border ${DECISION_CHIP[d] ?? 'bg-raised text-slate-400 border-edge'}`}>{d}</span>
              ))}
            </span>
          }
        />
        <MetaCell
          label="Audit records"
          value={result?.auditSeqs.length
            ? <span className="mono-hash">#{result.auditSeqs.join(', #')}</span>
            : <span className="text-slate-500">— on run</span>}
        />
        <MetaCell
          label="Last run"
          value={result
            ? <span className="mono-hash flex items-center gap-1"><Timer size={10} /> {shortTime(result.ranAt)} · {result.durationMs}ms</span>
            : <span className="text-slate-500">not run yet</span>}
        />
      </div>

      {/* trace */}
      {open && result && (
        <div className="border-t border-edge/60 bg-bg/40 px-5 py-4">
          <p className="mb-3 text-[12px] font-semibold text-ink/80">{result.headline}</p>
          <ol className="space-y-2.5">
            {result.steps.map((s: TraceStep) => (
              <li key={s.n} className="grid grid-cols-[14px_1fr] gap-2.5">
                <div className="flex flex-col items-center pt-1">
                  <StepDot status={s.status} />
                  {s.n < result.steps.length && <span className="mt-1 w-px flex-1 bg-edge/70" />}
                </div>
                <div className="min-w-0 pb-0.5">
                  <p className="text-[12.5px] font-semibold text-ink/95">
                    <span className="mr-1.5 font-mono text-slate-500">{String(s.n).padStart(2, '0')}</span>
                    {s.label}
                  </p>
                  <p className={`mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed ${
                    s.status === 'block' ? 'text-danger/90' : s.status === 'gate' ? 'text-amber/90' : s.status === 'ok' ? 'text-teal/90' : 'text-muted'
                  }`}>{s.detail}</p>
                  {(s.data?.decision || s.data?.hash) && (
                    <p className="mono-hash mt-1">
                      {s.data?.decision && <>verdict {String(s.data.decision.decision)} · {String(s.data.decision.reasonCode)} · mandate v{String(s.data.decision.mandateVersion ?? '?')}</>}
                      {s.data?.hash && <> · hash {String(s.data.hash)}</>}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {result.auditSeqs.length > 0 && (
            <p className="mono-hash mt-3 border-t border-edge/60 pt-2.5">
              audit records written by this run: #{result.auditSeqs.join(', #')} · {result.durationMs}ms
              {result.runId ? ` · run ${result.runId}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-1 min-h-[20px] text-[12px]">{value}</div>
    </div>
  );
}

function StatusBadge({ status, result }: { status: string; result?: UsecaseResult }) {
  if (status === 'idle')
    return (
      <span className="pill shrink-0 bg-raised text-slate-400 border border-edge">
        <CircleDashed size={12} /> not run
      </span>
    );
  if (status === 'running')
    return (
      <span className="pill shrink-0 bg-accent/15 text-indigo-300 border border-accent/30">
        <RefreshCw size={12} className="animate-spin" /> executing
      </span>
    );
  const m = OUTCOME_META[result!.outcome] ?? OUTCOME_META.ok;
  return (
    <span className={`pill shrink-0 ${m.cls}`} title={result?.headline}>
      {m.icon} {m.label}
    </span>
  );
}
