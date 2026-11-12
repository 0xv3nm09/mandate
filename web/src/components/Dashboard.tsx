import { useCallback, useEffect, useState } from 'react';
import {
  Activity, ArrowUpRight, BadgeCheck, BookOpen, ChevronDown, Clock, Database, Download, FileSignature, Gauge, Landmark, Lock,
  Mail, RefreshCw, ShieldCheck, Wallet, XCircle, Zap,
} from 'lucide-react';
import {
  api, money, shortHash, shortTime,
  type Approval, type AuditRecord, type Mandate, type RunRecord, type RunSummary, type Stats,
  type VerificationRecord, type Verdict,
} from '../lib/api';
import { DecisionPill, StepDot } from './StatusPill';
import { ApprovalInbox } from './ApprovalInbox';
import { useSSE } from '../hooks/useSSE';

interface Health {
  mode: { paypal: string; llm: string };
  mandateVersion: number;
  dailySpent: number;
  halted: boolean;
}

const OUTCOME_PILL: Record<string, string> = {
  ok: 'bg-ok/15 text-ok border border-ok/30',
  gate: 'bg-amber/15 text-amber border border-amber/30',
  block: 'bg-danger/15 text-danger border border-danger/30',
  error: 'bg-danger/20 text-danger border border-danger/40',
};

export const r0 = (row: { seq: number }) => row.seq;

const downloadJson = (data: unknown, name: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
};

const exportRunJson = async (runId: string) => {
  const full = await api<Record<string, unknown>>(`/runs/${runId}`);
  downloadJson(full, `${runId}.json`);
};

export function Dashboard({ go }: { go: (page: 'console' | 'usecases') => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [ledger, setLedger] = useState<AuditRecord[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; count: number } | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);

  const load = useCallback(() => {
    api<Stats>('/stats').then(setStats).catch(() => {});
    api<Health>('/health').then(setHealth).catch(() => {});
    api<{ mandate: Mandate }>('/mandate').then((r) => setMandate(r.mandate)).catch(() => {});
    api<Approval[]>('/approvals').then(setApprovals).catch(() => {});
    api<{ records: AuditRecord[]; verify: { ok: boolean; count: number } }>('/audit?limit=9')
      .then((r) => { setLedger(r.records); setChain(r.verify); })
      .catch(() => {});
    api<RunSummary[]>('/runs').then(setRuns).catch(() => {});
    api<VerificationRecord[]>('/verifications?limit=6').then(setVerifications).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);
  useSSE((type) => {
    if (type !== 'ping' && type !== 'hello') load();
  });

  const simulate = async (scenario: string) => {
    await api('/verify/simulate', { method: 'POST', body: JSON.stringify({ scenario }) }).catch(() => {});
    api<VerificationRecord[]>('/verifications?limit=6').then(setVerifications).catch(() => {});
  };

  const pending = approvals.filter((a) => a.status === 'PENDING');
  const cap = mandate?.limits.dailyTotal ?? 0;
  const spent = health?.dailySpent ?? 0;
  const spentPct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="kicker flex items-center gap-2"><Gauge size={14} /> Operator overview</p>
          <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill bg-raised text-slate-300 border border-edge">PayPal: <b>{health?.mode.paypal ?? '…'}</b></span>
          <span className="pill bg-raised text-slate-300 border border-edge">agent: <b>{health?.mode.llm === 'LLM' ? 'LLM (AI SDK)' : 'deterministic'}</b></span>
          {chain && (
            <span className={`pill ${chain.ok ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-danger/15 text-danger border border-danger/30'}`}>
              <ShieldCheck size={12} /> chain {chain.ok ? 'verified' : 'BROKEN'} · {chain.count}
            </span>
          )}
          <span className="relative">
            <button className="btn-ghost" onClick={() => setDocsOpen(!docsOpen)}>
              <BookOpen size={13} /> UI / docs reference <ChevronDown size={12} className={`transition-transform ${docsOpen ? 'rotate-180' : ''}`} />
            </button>
            {docsOpen && (
              <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl2 border border-edge bg-surface p-2 shadow-card">
                <p className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">product docs (on GitHub)</p>
                {[
                  ['docs/PAYPAL.md', 'Every PayPal call, payload & real response'],
                  ['docs/RESULTS.md', '12/12 expected-vs-got + benchmarks'],
                  ['docs/AGENT.md', 'Agent modes, tools, verbatim results'],
                  ['docs/AI.md', 'AI architecture, module map, benchmarks'],
                  ['docs/AG-GRID.md', 'AG Grid usage + this UI explained'],
                  ['docs/ARCHITECTURE.md', '12 annotated system diagrams'],
                  ['docs/EVIDENCE.md', 'Judging criteria → proof map'],
                  ['docs/FEEDBACK.md', '19 issues faced and fixed'],
                ].map(([path, label]) => (
                  <a
                    key={path}
                    href={`https://github.com/0xv3nm09/mandate/blob/main/${path}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
                  >
                    <span>{label}</span>
                    <ArrowUpRight size={12} className="text-slate-500" />
                  </a>
                ))}
                <p className="px-2 pb-1 pt-1 font-mono text-[10px] text-slate-500">evidence/README.md — how to verify every artifact</p>
              </div>
            )}
          </span>
          <button className="btn-ghost" onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          icon={<Wallet size={15} />} chip="bg-accent/15 text-indigo-300 ring-1 ring-accent/30"
          label="Spent today" value={money(spent)} sub={cap ? `of ${money(cap)} daily cap` : '—'}
          meter={{ pct: spentPct, cls: spentPct >= 90 ? 'bg-danger' : spentPct >= 60 ? 'bg-amber' : 'bg-gradient-to-r from-teal to-accent' }}
          action={{
            label: 'reset cap',
            onClick: async () => {
              await api('/system/reset-cap', { method: 'POST' }).catch(() => {});
              const h = await api<Health>('/health'); setHealth(h);
            },
          }}
        />
        <KpiTile
          icon={<Lock size={15} />} chip="bg-amber/15 text-amber ring-1 ring-amber/30"
          label="Pending approvals" value={String(pending.length)}
          sub={pending.length ? `${pending.length} money-out waiting on you` : 'nothing needs you'}
          onClick={() => go('console')}
        />
        <KpiTile
          icon={<Zap size={15} />} chip="bg-teal/15 text-teal ring-1 ring-teal/30"
          label="Autonomous executions" value={stats ? String(stats.allowed) : '—'}
          sub="invoices + in-bounds money-out, no human"
        />
        <KpiTile
          icon={<BadgeCheck size={15} />} chip="bg-ok/15 text-ok ring-1 ring-ok/30"
          label="Intent Mandate" value={mandate ? `v${mandate.version}` : '—'}
          sub="signed · JWS verified · immutable"
          onClick={() => go('console')}
        />
      </div>

      {/* KPI row 2 — the counts that prove the trust layer */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Actions governed" value={stats?.governed} icon={<Activity size={13} />} cls="text-indigo-300" />
        <MiniStat label="Passed human gate" value={stats?.gated} icon={<Lock size={13} />} cls="text-amber" note={stats?.approved ? [stats.approved, 'by tap'].join(' ') : undefined} />
        <MiniStat label="Blocked outright" value={stats?.blocked} icon={<XCircle size={13} />} cls="text-danger" />
        <MiniStat label="Money in / out" value={undefined} icon={<Landmark size={13} />} cls="text-teal"
          note={<span>{money(stats?.moneyIn ?? 0)} <span className="text-slate-500">in</span> · {money(stats?.moneyOut ?? 0)} <span className="text-slate-500">out</span></span>} />
      </div>

      {/* main grid — symmetric equal columns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {/* Active mandate */}
          <section className="card card-gradient">
            <CardHead icon={<FileSignature size={14} />} title="Active Intent Mandate" tag={mandate ? `v${mandate.version} · JWS` : ''} />
            {mandate ? (
              <div className="px-5 py-3">
                <MandRow label="Per-transaction threshold" value={money(mandate.limits.perTxn)} hint="money-out above → GATE" />
                <MandRow label="Daily cap" value={money(mandate.limits.dailyTotal)} hint="exceeding → BLOCK" />
                <MandRow
                  label="Payee allowlist" chips={mandate.payeeAllowlist}
                  hint={`${mandate.payeeAllowlist.length} payees · others → BLOCK`}
                />
                <MandRow
                  label="Standing envelope"
                  value={mandate.standing ? `${money(mandate.standing.amount)}/week → ${mandate.standing.payee}` : 'none signed'}
                  hint={mandate.standing ? 'autonomous while in-bounds' : 'say “pay Vita $300 weekly”'}
                  hot={!!mandate.standing}
                />
                <div className="mt-3 flex items-center justify-between rounded-lg border border-teal/25 bg-teal/10 px-3 py-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-teal"><ShieldCheck size={13} /> signed & immutable · every check runs against this document</span>
                  <button className="text-[11px] text-indigo-300 hover:underline" onClick={() => go('console')}>edit & re-sign <ArrowUpRight size={10} className="inline" /></button>
                </div>
              </div>
            ) : <p className="px-5 py-6 text-sm text-muted">loading…</p>}
          </section>

          {/* Recorded runs */}
          <section className="card card-gradient">
            <CardHead
              icon={<Database size={14} />} title="Recorded runs" tag={`${runs.length} recorded`}
              right={
                <span className="flex items-center gap-2">
                  <button
                    className="text-[11px] text-accent hover:underline disabled:opacity-40"
                    disabled={suiteRunning}
                    onClick={async () => {
                      setSuiteRunning(true);
                      try {
                        for (const id of ['UC-01','UC-02','UC-03','UC-04','UC-05','UC-06','UC-07','UC-08','UC-09','UC-10','UC-11','UC-12']) {
                          await api(`/usecases/${id}/run`, { method: 'POST' });
                        }
                        api<RunSummary[]>('/runs').then(setRuns).catch(() => {});
                      } finally { setSuiteRunning(false); }
                    }}
                  >
                    {suiteRunning ? 'running…' : 'run suite'}
                  </button>
                  <button className="text-[11px] text-accent hover:underline" onClick={() => go('usecases')}>open →</button>
                </span>
              }
            />
            <div className="divide-y divide-edge/60">
              {runs.length === 0 && (
                <p className="px-5 py-6 text-sm text-muted">
                  No runs recorded yet — every use-case execution is logged here with its real trace.{' '}
                  <button className="text-accent hover:underline" onClick={() => go('usecases')}>Run the 12-suite →</button>
                </p>
              )}
              {runs.slice(0, 6).map((r) => <RunRow key={r.runId} run={r} />)}
            </div>
          </section>

          {/* Inbound verification — the Netflix check */}
          <section className="card card-gradient">
            <CardHead
              icon={<Mail size={14} />} title="Inbound verification" tag="known-merchant directory"
              right={<button className="text-[11px] text-accent hover:underline" onClick={() => go('usecases')}>UC-10 · UC-11 →</button>}
            />
            <div className="px-4 py-3">
              <p className="mb-3 text-[11.5px] leading-relaxed text-muted">
                Invoices and messages claiming to be from a service are cross-matched against the directory — sender
                domain, amount envelope, history — before you trust a dollar of money-in.
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {[
                  ['netflix-real', 'Real Netflix bill'],
                  ['netflix-impostor', 'Lookalike impostor'],
                  ['netflix-hike', 'Price hike'],
                  ['unknown-brand', 'Unknown brand'],
                ].map(([s, label]) => (
                  <button key={s} className="rounded-full border border-edge bg-raised px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/60 hover:text-ink" onClick={() => simulate(s)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {verifications.length === 0 && (
                  <p className="text-xs text-muted sm:col-span-2">No inbound claims yet — fire a scenario above or run UC-10.</p>
                )}
                {verifications.map((v) => <ClaimCard key={v.id} v={v} />)}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          {/* Approval inbox (live, functional) */}
          <section className="card card-gradient flex h-[430px] flex-col p-4">
            <ApprovalInbox />
          </section>

          {/* Live ledger */}
          <section className="card card-gradient">
            <CardHead
              icon={<Database size={14} />} title="Live ledger" tag="hash-chained ✓"
              right={<button className="text-[11px] text-accent hover:underline" onClick={() => go('console')}>open audit grid →</button>}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[10.5px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Time</th>
                    <th className="px-2 py-2 font-semibold">Event</th>
                    <th className="px-2 py-2 text-right font-semibold">Amount</th>
                    <th className="px-2 py-2 font-semibold">Decision</th>
                    <th className="px-4 py-2 font-semibold">Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No records yet — run a use case or chat with the agent.</td></tr>
                  )}
                  {ledger.map((r) => (
                    <tr key={r.seq} className="border-t border-edge/50 hover:bg-raised/40">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-slate-400">{shortTime(r.ts)}</td>
                      <td className="max-w-[260px] px-2 py-2">
                        <span className="block truncate text-ink/90">{String(r.payload.event ?? r.kind)}</span>
                        <span className="mono-hash">{r.kind} · #{r.seq}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[11.5px]">
                        {r.payload.amount != null ? money(Number(r.payload.amount)) : '—'}
                      </td>
                      <td className="px-2 py-2"><DecisionPill decision={r.decision} /></td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10.5px] text-teal">
                        <button
                          className="hover:underline"
                          title="Download the signed receipt JSON for this record"
                          onClick={async () => {
                            const receipt = await api<Record<string, unknown>>(`/audit/${r.seq}/receipt`);
                            const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `mandate-receipt-${r.seq}.json`;
                            a.click();
                          }}
                        >{shortHash(r.hash, 6)} ⤓</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────
function KpiTile({
  icon, chip, label, value, sub, meter, onClick, action,
}: {
  icon: React.ReactNode; chip: string; label: string; value: string; sub?: string;
  meter?: { pct: number; cls: string }; onClick?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`card card-gradient p-4 ${onClick ? 'cursor-pointer transition-colors hover:border-edge' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
        {label}
      </div>
      <p className="mt-2.5 font-display text-2xl font-bold tabular-nums">{value}</p>
      {meter && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-edge">
          <div className={`h-full rounded-full ${meter.cls}`} style={{ width: `${meter.pct}%` }} />
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between">
        {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : <span />}
        {action && (
          <button
            className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-accent"
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon, cls, note }: { label: string; value?: number; icon: React.ReactNode; cls: string; note?: React.ReactNode }) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised ${cls}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="font-display text-lg font-bold tabular-nums">
          {value ?? '—'}
          {note ? <span className="ml-1.5 font-sans text-[11px] font-medium text-muted">{note}</span> : null}
        </p>
      </div>
    </div>
  );
}

function CardHead({ icon, title, tag, right }: { icon: React.ReactNode; title: string; tag?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-edge/60 px-5 py-3">
      <span className="text-muted">{icon}</span>
      <h3 className="font-display text-[13.5px] font-semibold">{title}</h3>
      {tag && <span className="mono-hash ml-1">{tag}</span>}
      <span className="ml-auto">{right}</span>
    </div>
  );
}

function MandRow({ label, value, chips, hint, hot }: { label: string; value?: string; chips?: string[]; hint?: string; hot?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-edge/60 py-2.5 last:border-b-0">
      <span className="text-[12.5px] text-muted">{label}</span>
      {chips ? (
        <span className="flex max-w-[60%] flex-wrap justify-end gap-1.5">
          {chips.map((c) => <span key={c} className="mono-hash rounded-md border border-edge bg-raised px-1.5 py-0.5">{c}</span>)}
        </span>
      ) : (
        <span className={`text-[13px] font-semibold ${hot ? 'text-teal' : ''}`}>{value}</span>
      )}
      {hint && <span className="mono-hash w-full text-right lg:w-auto">{hint}</span>}
    </div>
  );
}

const VERDICT_STAMP: Record<Verdict, { cls: string; label: string }> = {
  VERIFIED: { cls: 'border-ok/60 text-ok bg-ok/10', label: 'VERIFIED ✓' },
  SUSPICIOUS: { cls: 'border-amber/60 text-amber bg-amber/10', label: 'SUSPICIOUS ⚠' },
  IMPOSTOR: { cls: 'border-danger/70 text-danger bg-danger/10', label: 'IMPOSTOR ✗' },
  UNVERIFIED: { cls: 'border-slate-500/60 text-slate-400 bg-slate-500/10', label: 'UNVERIFIED' },
};

/** Receipt-style "picture" of an inbound claim with the verdict stamped on it. */
function ClaimCard({ v }: { v: VerificationRecord }) {
  const stamp = VERDICT_STAMP[v.verdict];
  const brand = v.claim.brand || v.claim.from;
  return (
    <div className="relative overflow-hidden rounded-xl2 border border-edge bg-gradient-to-b from-raised/70 to-surface p-3.5 shadow-raised">
      {/* perforated receipt edge */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[repeating-linear-gradient(90deg,transparent,transparent_5px,rgba(20,20,20,0.08)_5px,rgba(20,20,20,0.08)_10px)]" />
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold text-white"
          style={{ background: `linear-gradient(135deg, hsl(${hueFor(brand)} 70% 55%), hsl(${(hueFor(brand) + 40) % 360} 70% 45%))` }}
        >
          {brand.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[13.5px] font-semibold">{brand}</p>
          <p className="mono-hash truncate">{v.claim.from}</p>
          <p className="mt-0.5 truncate text-[10.5px] text-slate-500">{v.claim.memo || `${v.claim.channel} · ${shortTime(v.createdAt)}`}</p>
        </div>
        <p className="shrink-0 font-mono text-[15px] font-bold tabular-nums text-ink">
          ${v.claim.amount.toFixed(2)}
          <span className="ml-0.5 text-[9px] font-normal text-slate-500">{v.claim.currency}</span>
        </p>
      </div>
      <p className={`mt-2.5 line-clamp-2 pr-24 text-[11px] leading-snug ${v.verdict === 'IMPOSTOR' ? 'text-danger/90' : v.verdict === 'SUSPICIOUS' ? 'text-amber/90' : v.verdict === 'VERIFIED' ? 'text-teal/90' : 'text-slate-400'}`}>
        {v.reasonText}
      </p>
      {/* the stamp */}
      <div className={`absolute right-2 top-[4.4rem] rotate-6 rounded-md border-2 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide backdrop-blur-sm ${stamp.cls}`}>
        {stamp.label}
      </div>
      <p className="mono-hash mt-2 border-t border-dashed border-edge/70 pt-1.5">receipt {v.id.slice(0, 8)} · signed · {shortHash(v.jws.replace(/^[^.]+\.[^.]+\./, ''), 6)} ✓</p>
    </div>
  );
}

function hueFor(brand: string): number {
  let h = 0;
  for (const ch of brand) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function RunRow({ run }: { run: RunSummary }) {  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<RunRecord | null>(null);
  const toggle = () => {
    if (!open && !trace) api<RunRecord>(`/runs/${run.runId}`).then(setTrace).catch(() => {});
    setOpen(!open);
  };
  return (
    <div>
      <div className="flex items-center gap-3 px-5 py-2.5 hover:bg-raised/30">
        <span className="mono-hash w-14 shrink-0 rounded-md border border-edge bg-raised px-1 py-0.5 text-center">{run.ucId}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{run.ucTitle}</p>
          <p className="truncate text-[11px] text-muted">{run.headline}</p>
        </div>
        <span className="hidden mono-hash sm:inline"><Clock size={10} className="mr-1 inline" />{shortTime(run.ranAt)}</span>
        <span className={`pill shrink-0 ${OUTCOME_PILL[run.outcome]}`}>{run.outcome.toUpperCase()}</span>
        <button
          className="flex shrink-0 items-center gap-1 rounded-md border border-edge bg-raised px-1.5 py-0.5 text-[10.5px] text-muted hover:border-accent/50 hover:text-ink"
          title="Download this run's full JSON trace"
          onClick={async () => exportRunJson(run.runId)}
        >
          <Download size={10} /> JSON
        </button>
        <button className="flex items-center gap-0.5 text-[11px] text-muted hover:text-ink" onClick={toggle}>
          {run.stepsCount} steps
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && trace && (
        <ol className="space-y-2 border-t border-edge/50 bg-bg/40 px-5 py-3">
          {trace.steps.map((s) => (
            <li key={s.n} className="flex gap-2.5">
              <StepDot status={s.status} />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink/95">{s.label}</p>
                <p className={`text-[11px] leading-snug ${s.status === 'block' ? 'text-danger/90' : s.status === 'gate' ? 'text-amber/90' : s.status === 'ok' ? 'text-teal/90' : 'text-muted'}`}>{s.detail}</p>
              </div>
            </li>
          ))}
          <li className="mono-hash pt-1">audit records: {trace.auditSeqs.map((s) => `#${s}`).join(', ')} · {trace.durationMs}ms</li>
        </ol>
      )}
    </div>
  );
}
