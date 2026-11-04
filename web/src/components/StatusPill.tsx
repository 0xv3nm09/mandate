import { ShieldAlert, ShieldCheck, ShieldX, Clock } from 'lucide-react';

export function DecisionPill({ decision, code }: { decision?: string | null; code?: string | null }) {
  if (!decision) return <span className="pill bg-slate-700/40 text-slate-300">—</span>;
  const map: Record<string, { cls: string; icon: JSX.Element }> = {
    ALLOW: { cls: 'bg-ok/15 text-ok border border-ok/30', icon: <ShieldCheck size={12} /> },
    GATE: { cls: 'bg-amber/15 text-amber border border-amber/30', icon: <ShieldAlert size={12} /> },
    BLOCK: { cls: 'bg-danger/15 text-danger border border-danger/30', icon: <ShieldX size={12} /> },
  };
  const m = map[decision] ?? { cls: 'bg-slate-700/40 text-slate-300', icon: null };
  return (
    <span className={`pill ${m.cls}`}>
      {m.icon}
      {decision}
      {code ? <span className="opacity-70 font-normal">· {code}</span> : null}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    EXECUTED: 'bg-ok/15 text-ok border border-ok/30',
    SENT: 'bg-ok/15 text-ok border border-ok/30',
    PAID: 'bg-teal/15 text-teal border border-teal/30',
    AWAIT_APPROVAL: 'bg-amber/15 text-amber border border-amber/30',
    PENDING: 'bg-amber/15 text-amber border border-amber/30',
    APPROVED: 'bg-accent/15 text-indigo-300 border border-accent/30',
    BLOCKED: 'bg-danger/15 text-danger border border-danger/30',
    DENIED: 'bg-danger/15 text-danger border border-danger/30',
    HALTED: 'bg-danger/15 text-danger border border-danger/30',
    OVERDUE: 'bg-amber/15 text-amber border border-amber/30',
    PROPOSED: 'bg-slate-700/40 text-slate-300',
  };
  return <span className={`pill ${map[status] ?? 'bg-slate-700/40 text-slate-300'}`}>{status.replace('_', ' ')}</span>;
}

export function StepDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok: 'bg-ok',
    gate: 'bg-amber',
    block: 'bg-danger',
    error: 'bg-danger',
    info: 'bg-slate-500',
  };
  return <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${map[status] ?? 'bg-slate-500'}`} />;
}

export function ModeBadge({ label, mode, ok }: { label: string; mode: string; ok?: boolean }) {
  return (
    <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-edge bg-raised px-2.5 py-1 text-[11px] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-ok animate-pulse-soft' : 'bg-teal'}`} />
      {label}: <span className="text-ink font-semibold">{mode}</span>
    </span>
  );
}

export function PendingDot() {
  return <Clock size={13} className="text-amber" />;
}
