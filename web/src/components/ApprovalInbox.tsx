import { useCallback, useEffect, useState } from 'react';
import { Inbox, ShieldAlert, ThumbsUp, ThumbsDown, Timer, User } from 'lucide-react';
import { api, money, type Approval, type Decision } from '../lib/api';
import { DecisionPill } from './StatusPill';
import { useSSE } from '../hooks/useSSE';

interface JoinedApproval extends Approval {
  action: { type: string; amount: number; currency: string; payee: string; payeeName: string | null; memo: string; status: string } | null;
}

export function ApprovalInbox() {
  const [approvals, setApprovals] = useState<JoinedApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    api<JoinedApproval[]>('/approvals').then(setApprovals).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  useSSE((type) => {
    if (type.startsWith('approval') || type === 'action.decision' || type === 'system.halt') load();
  });

  const pending = approvals.filter((a) => a.status === 'PENDING');
  const resolved = approvals.filter((a) => a.status !== 'PENDING').slice(0, 6);

  const act = async (id: string, kind: 'approve' | 'deny') => {
    setBusy(id);
    try {
      const res = await api<{ status?: string; error?: string }>(`/approvals/${id}/${kind}`, { method: 'POST' });
      setFlash(
        kind === 'approve'
          ? res.status === 'EXECUTED'
            ? 'Approved — payout executed and logged to the chain'
            : `Approval result: ${res.error ?? res.status}`
          : 'Denied — action aborted, never executed, logged'
      );
      setTimeout(() => setFlash(null), 3500);
    } catch (e: any) {
      setFlash(e.message?.slice(0, 140) ?? 'failed');
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge/60 pb-2.5">
        <span className="text-muted"><Inbox size={14} /></span>
        <h3 className="font-display text-[13.5px] font-semibold">Approval Inbox</h3>
        {pending.length > 0 ? (
          <span className="pill bg-amber/15 text-amber border border-amber/30 animate-pulse-soft ml-auto">{pending.length} waiting</span>
        ) : (
          <span className="mono-hash ml-auto">clear</span>
        )}
      </div>

      {flash && (
        <div className="card border-teal/40 bg-teal/10 px-3 py-2 text-xs text-teal animate-fadeUp">{flash}</div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {pending.length === 0 && (
          <div className="card flex items-center gap-3 px-4 py-6 text-sm text-muted">
            <ShieldAlert size={18} className="text-slate-500" />
            Nothing needs you right now. Gated money-out lands here with an AI risk summary.
          </div>
        )}
        {pending.map((a) => (
          <ApprovalCard key={a.id} a={a} busy={busy === a.id} onApprove={() => act(a.id, 'approve')} onDeny={() => act(a.id, 'deny')} />
        ))}
        {resolved.length > 0 && (
          <>
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recently resolved</p>
            {resolved.map((a) => {
              const d = JSON.parse(a.policyJson || '{}') as Decision;
              return (
                <div key={a.id} className="card px-4 py-3 opacity-70">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{a.status}</span>
                    <DecisionPill decision={d.decision} code={d.reasonCode} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">{d.reasonText}</p>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  a, busy, onApprove, onDeny,
}: { a: JoinedApproval; busy: boolean; onApprove: () => void; onDeny: () => void }) {
  const d = JSON.parse(a.policyJson || '{}') as Decision;
  const hits = d.policyHits ?? [];
  const secsLeft = Math.max(0, Math.floor((new Date(a.expiresAt).getTime() - Date.now()) / 1000));
  return (
    <div className="card border-amber/40 border-l-2 border-l-amber p-4 animate-fadeUp">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber">Human gate — action required</p>
          <h4 className="mt-1 font-display text-lg font-semibold text-teal">
            {a.action ? money(a.action.amount, a.action.currency) : '?'} payout
          </h4>
        </div>
        <DecisionPill decision={d.decision} code={d.reasonCode} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
        <span className="flex items-center gap-1.5 truncate"><User size={12} /> {a.action?.payeeName ?? a.action?.payee ?? a.actionId}</span>
        <span className="flex items-center gap-1.5"><Timer size={12} /> expires in {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}</span>
      </div>
      {a.action?.memo && <p className="mt-1 truncate text-[11px] text-slate-500">memo: “{a.action.memo}”</p>}

      <div className="mt-3 rounded-lg border border-edge bg-raised p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Why the agent wants this (AI summary)</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink/90">{a.explanation}</p>
      </div>

      <div className="mt-3 space-y-1">
        {hits.map((h, i) => (
          <p key={i} className="mono-hash">policy · {h.rule} — {h.detail}</p>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button className="btn-teal flex-1" disabled={busy} onClick={onApprove}>
          <ThumbsUp size={14} /> Approve & execute
        </button>
        <button className="btn-danger flex-1" disabled={busy} onClick={onDeny}>
          <ThumbsDown size={14} /> Deny
        </button>
      </div>
    </div>
  );
}
