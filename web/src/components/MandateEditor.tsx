import { useEffect, useState } from 'react';
import { FileSignature, Plus, X, KeyRound, ShieldCheck } from 'lucide-react';
import { api, type Mandate } from '../lib/api';

export function MandateEditor() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [versions, setVersions] = useState<{ version: number; createdAt: string; jws: string }[]>([]);
  const [sigValid, setSigValid] = useState(false);
  const [newPayee, setNewPayee] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = () =>
    api<{ mandate: Mandate; versions: typeof versions; signatureValid: boolean }>('/mandate').then((r) => {
      setMandate(r.mandate);
      setVersions(r.versions);
      setSigValid(r.signatureValid);
    });

  useEffect(() => {
    load();
  }, []);

  if (!mandate) return <p className="text-sm text-muted">loading mandate…</p>;

  const patch = (p: Partial<Mandate>) => setMandate({ ...mandate, ...p });

  const sign = async () => {
    setSaving(true);
    try {
      const r = await api<{ mandate: Mandate }>('/mandate', { method: 'PUT', body: JSON.stringify({ mandate, source: 'operator editor (human sign)' }) });
      setMandate(r.mandate);
      setSaved(`Signed as Intent Mandate v${r.mandate.version} — previous versions remain in the audit chain`);
      setTimeout(() => setSaved(null), 4000);
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto pr-1 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted">
              <FileSignature size={15} className="text-accent" /> Intent Mandate
            </h3>
            <span className="pill bg-accent/15 text-indigo-300 border border-accent/30">
              <KeyRound size={12} /> v{mandate.version} · JWS signed {sigValid && <ShieldCheck size={11} />}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            Your policy, cryptographically signed. The engine checks every action against THIS document — the agent's reasoning is never the authorization.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="text-xs text-muted">
              Per-transaction threshold (USD) — money-out above this is GATED
              <input
                className="input mt-1"
                type="number"
                min={0}
                value={mandate.limits.perTxn}
                onChange={(e) => patch({ limits: { ...mandate.limits, perTxn: Number(e.target.value) } })}
              />
            </label>
            <label className="text-xs text-muted">
              Daily total cap (USD) — exceeding this is BLOCKED
              <input
                className="input mt-1"
                type="number"
                min={0}
                value={mandate.limits.dailyTotal}
                onChange={(e) => patch({ limits: { ...mandate.limits, dailyTotal: Number(e.target.value) } })}
              />
            </label>
          </div>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Payee allowlist (anyone else is BLOCKED)</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mandate.payeeAllowlist.map((p) => (
              <span key={p} className="pill bg-ok/10 text-ok border border-ok/25">
                {p}
                <button
                  className="opacity-60 hover:opacity-100"
                  onClick={() => patch({ payeeAllowlist: mandate.payeeAllowlist.filter((x) => x !== p) })}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input flex-1" placeholder="payee@sandbox.test" value={newPayee} onChange={(e) => setNewPayee(e.target.value)} />
            <button
              className="btn-ghost"
              onClick={() => {
                if (newPayee.includes('@')) {
                  patch({ payeeAllowlist: [...new Set([...mandate.payeeAllowlist, newPayee.trim().toLowerCase()])] });
                  setNewPayee('');
                }
              }}
            >
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-edge bg-raised p-3 text-xs text-muted">
            <p className="font-semibold text-ink/80">Standing mandate (pre-authorized recurring money-out)</p>
            {mandate.standing ? (
              <p className="mt-1">
                ${mandate.standing.amount} / week → <span className="text-teal">{mandate.standing.payee}</span> ({mandate.standing.payeeName}) — executes unattended while in-bounds; any drift gates.
                <button className="ml-2 text-danger hover:underline" onClick={() => patch({ standing: null })}>remove</button>
              </p>
            ) : (
              <p className="mt-1">None signed. Tell the agent “pay Vita $300 weekly” or set one after signing a version that includes it.</p>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" disabled={saving} onClick={sign}>
              <FileSignature size={14} /> {saving ? 'Signing…' : 'Review & sign as new version'}
            </button>
            {saved && <span className="text-xs text-teal animate-fadeUp">{saved}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">What the engine enforces</h4>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-muted">
            <li>• Hard BLOCK first: non-allowlisted payee · foreign currency · daily-cap breach</li>
            <li>• GATE next: over threshold · standing-envelope drift · velocity breaker</li>
            <li>• ALLOW: invoices (money-in) · in-bounds allowlisted money-out · matching standing runs</li>
            <li>• Running totals computed from the audit chain — never from the model</li>
          </ul>
        </div>
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Version history</h4>
          <div className="mt-2 space-y-2">
            {versions.map((v) => (
              <div key={v.version} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-ink/90">v{v.version}</span>
                <span className="mono-hash truncate" title={v.jws}>{v.jws.slice(0, 22)}…</span>
                <span className="text-slate-500">{new Date(v.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
