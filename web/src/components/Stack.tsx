import { useEffect, useState } from 'react';
import {
  Layers, Radio, Database, Cpu, ShieldCheck, Grid3x3, FileText, Webhook,
  CheckCircle2, RefreshCw, Copy, Download, Lock, KeyRound, Server, GitBranch, XOctagon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSSE } from '../hooks/useSSE';

type CallEntry = { ts: string; method: string; path: string; status: number; ms: number; ok: boolean; note?: string };
type StackData = {
  mode: { paypal: string; llm: string };
  webhook: { id: string | null; url: string | null; eventTypes: string[] };
  mandate: {
    version: number;
    limits: { perTxn: number; dailyTotal: number; currency: string };
    payeeAllowlist: string[];
    standing: { payee: string; payeeName?: string; amount: number; cadence: string } | null;
  } | null;
  counts: {
    auditRecords: number; eventsIngested: number; invoices: number; invoicesSent: number;
    payoutBatches: number; payoutBatchesSuccess: number;
    approvals: Record<string, number>; verifications: Record<string, number>;
  };
  ruleHits: { k: string; c: number }[];
  chain: { ok: boolean; count: number; brokenAt: number | null };
  paypalLog: CallEntry[];
  toolkit: { available: boolean; reason?: string; toolNames?: string[] };
  llmModel: string | null;
};

// The deterministic rule catalog — one line each, merged with live hit counts from /api/stack.
// Order = evaluation order: hard blocks first, nothing reaches them that could override.
const RULES: { id: string; code: string; kind: 'block' | 'gate' | 'allow' | 'stop'; text: string }[] = [
  { id: 'R-00', code: 'R_BLOCK_HALT', kind: 'stop', text: 'Global kill switch — while halted, every agent action and approval is frozen' },
  { id: 'R-02', code: 'R_BLOCK_PAYEE', kind: 'block', text: 'Payee not on the signed allowlist — blocked outright, no approval path exists' },
  { id: 'R-03', code: 'R_BLOCK_CURRENCY', kind: 'block', text: 'Foreign-currency money-out refused — mandate authorizes one currency' },
  { id: 'R-04', code: 'R_BLOCK_DAILY_CAP', kind: 'block', text: 'Daily cap would be exceeded — refused, not queued' },
  { id: 'R-05', code: 'R_STANDING_ALLOW', kind: 'allow', text: 'Standing-envelope match — executes autonomously, no human present (UC-08)' },
  { id: 'R-06', code: 'R_STANDING_DRIFT', kind: 'gate', text: 'Standing drift — proposed ≠ signed envelope, falls through to normal rules' },
  { id: 'R-07', code: 'R_ALLOW_INVOICE', kind: 'allow', text: 'Invoicing is money-in — no spend authority consumed' },
  { id: 'R-01', code: 'R_GATE_THRESHOLD', kind: 'gate', text: 'Amount over the per-transaction threshold — human approval required' },
  { id: 'R-08', code: 'R_GATE_VELOCITY', kind: 'gate', text: 'Velocity circuit breaker — ≥3 payouts in 10 minutes needs review' },
  { id: 'R-09', code: 'R_ALLOW_IN_BOUNDS', kind: 'allow', text: 'Under threshold + allowlisted — flows autonomously inside signed limits' },
];
const KIND_CLS: Record<string, string> = {
  stop: 'text-danger border-danger/40 bg-danger/10',
  block: 'text-danger border-danger/30 bg-danger/5',
  gate: 'text-amber-600 border-amber-500/30 bg-amber-500/5',
  allow: 'text-ok border-ok/30 bg-ok/5',
};

const PAYPAL_ENDPOINTS: { m: string; p: string; why: string; note: string }[] = [
  { m: 'POST', p: '/v1/oauth2/token', why: 'client-credentials token (cached, re-minted before expiry)', note: 'Basic auth' },
  { m: 'POST', p: '/v2/invoicing/invoices', why: 'create draft invoice (money-in)', note: 'Prefer: return=representation · PayPal-Request-Id' },
  { m: 'POST', p: '/v2/invoicing/invoices/{id}/send', why: 'deliver the invoice', note: 'skipped up front when no sandbox recipient is configured' },
  { m: 'POST', p: '/v2/invoicing/invoices/{id}/remind', why: 'AI-drafted escalating reminder', note: '2/day cap — surfaced honestly' },
  { m: 'POST', p: '/v1/payments/payouts', why: 'governed money-out', note: 'sender_batch_id = idempotency key (approval:/standing:/governed:)' },
  { m: 'GET', p: '/v1/payments/payouts/{id}', why: 'live batch status — UC-12 + boot reconciliation', note: 'never trusts the local cache alone' },
  { m: 'GET/POST', p: '/v1/notifications/webhooks', why: 'self-register the listener at boot (adopt-or-create)', note: 'event types verified against the live catalog' },
  { m: 'POST', p: '/v1/notifications/verify-webhook-signature', why: 'verify every inbound event before ingesting', note: '7-field schema exactly; failures logged with debug_id' },
  { m: 'POST', p: '/v1/notifications/simulate-event', why: 'signed sample event for deterministic demos', note: 'verify path exercised live (200)' },
  { m: 'GET', p: '/v2/invoicing/invoices · /v1/customer/disputes (toolkit)', why: 'read-only eyes via @paypal/agent-toolkit', note: 'list/get only — never moves money' },
];

const LAYERS: { icon: React.ReactNode; name: string; stack: string; role: string; detail: string }[] = [
  {
    icon: <Layers size={13} />, name: 'Console (UI)', stack: 'React 18 · Vite · TypeScript · Tailwind · AG Grid Community · SSE',
    role: 'operator surface — approve, inspect, export',
    detail: '5 pages: Home · Dashboard · Usecases · Console · Live Stack. Two AG Grids over live ledger data; token-guarded mutations; snapshot fallback for GitHub Pages.',
  },
  {
    icon: <Server size={13} />, name: 'API', stack: 'Hono · node:sqlite (WAL) · SSE bus',
    role: 'thin HTTP layer over the control plane',
    detail: '~40 routes, all reads open, mutations guarded by MANDATE_ADMIN_TOKEN, webhook protected by PayPal signature verification. GET /api/stack powers this page.',
  },
  {
    icon: <Cpu size={13} />, name: 'Agent', stack: 'AI SDK v5 tool loop · live LLM: kimi-k2-instruct on Vultr · deterministic parser · zod',
    role: 'proposes only — never executes',
    detail: 'Four governed tools: create_invoice / send_reminder run autonomously (money-in); propose_payout / propose_mandate_change are proposal-only — no execute callback, the model structurally cannot move money. Zero-key fallback agent keeps the trust layer model-independent.',
  },
  {
    icon: <ShieldCheck size={13} />, name: 'Control plane', stack: 'pure-function policy engine · approvals (10-min TTL) · hash-chained audit',
    role: 'the only path to money movement',
    detail: 'policy.evaluate(): no I/O, no LLM, no randomness. SHA-256 prev→hash chain + per-record JWS/HMAC receipts, exportable for examiners. Global kill switch.',
  },
  {
    icon: <Webhook size={13} />, name: 'PayPal integration', stack: 'REST (Invoicing v2 · Payouts v1 · Notifications v1) · @paypal/agent-toolkit (read-only)',
    role: 'SANDBOX live + MOCK twin behind one interface',
    detail: 'Idempotency everywhere money moves (approval:/standing:/governed: namespaces + sender_batch_id). Webhook self-registered at boot, signature-verified, reconciled from live status at boot.',
  },
  {
    icon: <Database size={13} />, name: 'Data & infra', stack: 'SQLite (10 tables) · systemd · Caddy auto-HTTPS · Vultr VM · GitHub Actions CI',
    role: 'one file holds the whole ledger',
    detail: 'Tables: mandates, actions, audit, approvals, invoices, payouts, events, runs, verifications, meta. CI: typecheck ×2, boot, hard-block probe, webhook-envelope regression, web build.',
  },
];

const SECURITY: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <KeyRound size={13} />, title: 'Verifiable intent (AP2)', text: 'The agent’s authority is a signed Intent Mandate (JWS): per-txn + daily limits, payee allowlist, standing envelope. Every change is re-signed as a new version and appended to the chain — authority is always verifiable, never inferred from a prompt.' },
  { icon: <XOctagon size={13} />, title: 'Deterministic hard blocks', text: 'Non-allowlisted payee, wrong currency, over-cap: refused outright with no approval path. The engine is a pure function — no model, no I/O, no randomness sits on the decision path.' },
  { icon: <Lock size={13} />, title: 'Human gate with expiry', text: 'Risky money-out is held for one-tap approval with an AI-written risk summary; approvals expire after 10 minutes and can be denied. The kill switch freezes everything instantly.' },
  { icon: <GitBranch size={13} />, title: 'Tamper-evident audit', text: 'Every decision, execution, approval and webhook lands in a SHA-256 hash-chained ledger — recompute-verified on every request — with signed (JWS/HMAC) receipts an examiner can check independently.' },
  { icon: <Webhook size={13} />, title: 'Verified ingress only', text: 'Webhooks must pass PayPal’s verify-webhook-signature; event ids are recorded before processing (replay-safe); the mutation surface requires the admin token; CORS is allow-listed.' },
  { icon: <Database size={13} />, title: 'Data minimisation', text: 'No card data ever touches the system (card rails are not enabled or used). Stored: payee email, amounts, decisions, hashes. Money is sandbox-only. No third-party certifications are claimed — the controls above are the implementation, in code you can read.' },
];

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
    <section className="card card-gradient flex flex-col p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
        {title}
        <span className="ml-auto font-normal normal-case tracking-normal text-muted/60">{sub}</span>
      </div>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full border border-edge bg-raised px-2 py-0.5 text-[10px] font-medium text-muted">{children}</span>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded border border-edge bg-raised px-1 py-[1px] font-mono text-[11px] text-ink/80">{children}</code>
);

const Stat = ({ label, value, tone = 'text-ink' }: { label: string; value: string | number; tone?: string }) => (
  <div className="min-h-[54px] rounded-lg border border-edge/60 bg-raised/60 px-2.5 py-1.5">
    <p className="truncate text-[10px] uppercase tracking-wide text-muted/70">{label}</p>
    <p className={`font-display text-lg font-bold tabular-nums ${tone}`}>{value}</p>
  </div>
);

const Caption = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted/70">{children}</p>
);

const Foot = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-edge/40 pt-2.5 text-[11px] text-muted">{children}</div>
);

const Dot = () => <span className="text-muted/50">·</span>;

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
            This view needs the live backend (<Code>GET /api/stack</Code>). On the
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
  const hits = Object.fromEntries(data.ruleHits.map((r) => [r.k, r.c]));
  const totalRules = data.ruleHits.reduce((s, r) => s + r.c, 0);
  const maxHit = Math.max(1, ...data.ruleHits.map((r) => r.c));
  const m = data.mandate;

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
          <span className="ml-auto flex items-center gap-2 font-normal normal-case tracking-normal text-muted/60">
            <span className="mono-hash hidden sm:inline">GET /api/paypal/log</span>
            <button
              className="flex items-center gap-1 rounded-full border border-edge bg-raised px-2 py-0.5 hover:border-ink/40"
              title="Copy the current journal as JSON"
              onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(live, null, 2)); }}
            >
              <Copy size={10} /> copy
            </button>
            <button
              className="flex items-center gap-1 rounded-full border border-edge bg-raised px-2 py-0.5 hover:border-ink/40"
              title="Download the current journal as JSON"
              onClick={() => {
                const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), source: 'GET /api/paypal/log', entries: live }, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `mandate-paypal-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download size={10} /> json
            </button>
            <button className="flex items-center gap-1 rounded-full border border-edge bg-raised px-2 py-0.5 hover:border-ink/40" onClick={load}>
              <RefreshCw size={10} /> refresh
            </button>
          </span>
        </div>
        <div className="max-h-[320px] overflow-y-auto bg-bg/50 px-4 py-2 font-mono text-[11px]">
          {live.length === 0 && <p className="py-6 text-center text-muted/60">no PayPal calls since boot — run a use case and watch this fill</p>}
          {live.map((e, i) => <LogRow key={`${e.ts}-${e.path}-${i}`} e={e} />)}
        </div>
      </section>

      {/* The complete stack, layer by layer */}
      <section className="card card-gradient mt-4 p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent"><Layers size={14} /></span>
          The complete stack — layer by layer
          <span className="ml-auto font-normal normal-case tracking-normal text-muted/60">docs/ARCHITECTURE.md · docs/AI.md</span>
        </div>
        <div className="mt-3 space-y-2">
          {LAYERS.map((l) => (
            <div key={l.name} className="rounded-xl2 border border-edge/60 bg-raised/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/10 text-accent">{l.icon}</span>
                <p className="font-display text-sm font-bold">{l.name}</p>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted/70">— {l.role}</span>
                <span className="ml-auto flex flex-wrap gap-1">{l.stack.split(' · ').map((t) => <Chip key={t}>{t}</Chip>)}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{l.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Security, guardrails & compliance */}
      <section className="card card-gradient mt-4 p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ok/10 text-ok"><Lock size={14} /></span>
          Security · guardrails · compliance — what stands between an LLM and money
          <span className="ml-auto font-normal normal-case tracking-normal text-muted/60">SYSTEM_CARD.md · AP2-aligned</span>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {m ? (
          <div className="rounded-xl2 border border-edge/70 bg-raised/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink"><Lock size={12} className="text-accent" /> The signed mandate — v{m.version}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">JWS-signed; every edit re-signs as a new version and appends to the chain. This document is the agent's entire authority:</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <Stat label="per txn" value={`$${m.limits.perTxn}`} />
              <Stat label="daily cap" value={`$${m.limits.dailyTotal}`} />
              <Stat label="currency" value={m.limits.currency} />
            </div>
            <div className="mt-2"><Caption>payee allowlist — money-out to anyone else is impossible</Caption></div>
            <div className="mt-1 flex flex-wrap gap-1">{(m.payeeAllowlist ?? []).map((p) => <Chip key={p}>{p}</Chip>)}</div>
            {m.standing && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">standing envelope: <b className="text-ink">${m.standing.amount} {m.standing.cadence} → {m.standing.payee}</b> — in-bounds runs with no human; any drift gates instantly</p>
            )}
          </div>
          ) : (
          <div className="rounded-xl2 border border-edge/70 bg-raised/60 p-3">
            <p className="text-[11px] text-muted">signed mandate not loaded yet — it appears after the first boot initialises it.</p>
          </div>
          )}
          <div className="rounded-xl2 border border-edge/70 bg-raised/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink"><ShieldCheck size={12} className="text-accent" /> The rules — evaluated in order, hits from live ledger</p>
            <div className="mt-2 space-y-1">
              {RULES.map((r) => {
                const n = hits[r.code] ?? 0;
                return (
                  <div key={r.id} className={`flex items-start gap-2 rounded-lg border px-2 py-1 text-[11px] ${KIND_CLS[r.kind]}`}>
                    <span className="w-9 shrink-0 font-mono font-bold">{r.id}</span>
                    <span className="min-w-0 flex-1 leading-snug text-ink/85">{r.text}</span>
                    <span className="w-7 shrink-0 text-right font-semibold tabular-nums">{n}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-muted/70">{totalRules} decisions recorded — counts are queried from the hash-chained ledger, not asserted.</p>
          </div>
          <div className="rounded-xl2 border border-edge/70 bg-raised/60 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink"><KeyRound size={12} className="text-accent" /> Money-bank posture</p>
            <div className="mt-2 space-y-2">
              {SECURITY.map((s) => (
                <div key={s.title} className="flex gap-2">
                  <span className="mt-0.5 shrink-0 text-accent">{s.icon}</span>
                  <p className="text-[11px] leading-relaxed text-ink/85"><b>{s.title}.</b> {s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PayPal endpoints */}
      <section className="card card-gradient mt-4 p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal/10 text-teal"><Webhook size={14} /></span>
          Every PayPal call — endpoint, purpose, hardening
          <span className="ml-auto font-normal normal-case tracking-normal text-muted/60">docs/PAYPAL.md has the literal payloads & responses</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-edge text-muted/70">
                <th className="py-1.5 pr-3 font-semibold uppercase tracking-wide">Method</th>
                <th className="py-1.5 pr-3 font-semibold uppercase tracking-wide">Endpoint</th>
                <th className="py-1.5 pr-3 font-semibold uppercase tracking-wide">Why</th>
                <th className="py-1.5 font-semibold uppercase tracking-wide">Hardening</th>
              </tr>
            </thead>
            <tbody>
              {PAYPAL_ENDPOINTS.map((r) => (
                <tr key={r.p + r.m} className="border-b border-edge/40 last:border-0">
                  <td className="py-1.5 pr-3 font-mono font-semibold text-ink/80">{r.m}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink/80">{r.p}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.why}</td>
                  <td className="py-1.5 text-muted/80">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PayPal surface — live capability map */}
      <section className="card card-gradient mt-4 p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal/10 text-teal"><Webhook size={14} /></span>
          PayPal surface — live capability map
          <span className="ml-auto font-normal normal-case tracking-normal text-muted/60">calls counted from the journal window above</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-edge text-muted/70">
                <th className="py-1.5 pr-3 font-semibold uppercase tracking-wide">Capability</th>
                <th className="py-1.5 pr-3 font-semibold uppercase tracking-wide">Hardening</th>
                <th className="py-1.5 pr-3 text-right font-semibold uppercase tracking-wide">Calls (window)</th>
                <th className="py-1.5 text-right font-semibold uppercase tracking-wide">Last status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { n: 'OAuth 2.0 token', re: /oauth2\/token/, m: 'POST', h: 'cached · re-minted ~60 s before expiry' },
                { n: 'Invoicing — create', re: /invoices$/, m: 'POST', h: 'Prefer: return=representation · PayPal-Request-Id' },
                { n: 'Invoicing — send', re: /\/send$/, m: 'POST', h: 'skipped up front when no sandbox recipient' },
                { n: 'Invoicing — live status read', re: /invoices\/[A-Z0-9-]+$/, m: 'GET', h: 'remind pre-check — drafts are held, never a doomed 422' },
                { n: 'Invoicing — remind', re: /\/remind$/, m: 'POST', h: '2/day cap surfaced verbatim' },
                { n: 'Native setup-reminders', re: /setup-reminders/, m: 'POST', h: "PayPal's own dunning engine, configured once, audited" },
                { n: 'Payouts — create', re: /payments\/payouts$/, m: 'POST', h: 'sender_batch_id = idempotency key (approval:/standing:/governed:)' },
                { n: 'Payouts — status', re: /payments\/payouts\/[A-Z0-9]+$/, m: 'GET', h: 'UC-12 + boot reconciliation' },
                { n: 'Webhooks — adopt/register', re: /notifications\/webhooks$/, m: 'GET/POST', h: 'adopt-or-create at boot · event types from the live catalog' },
                { n: 'Webhooks — signature verify', re: /verify-webhook-signature/, m: 'POST', h: '7-field schema · failures logged with debug_id' },
                { n: 'Webhooks — simulate', re: /simulate-event/, m: 'POST', h: 'genuinely signed sample delivery' },
              ].map((cap) => {
                const rows = live.filter((e) => e.path.match(cap.re) && e.method.startsWith(cap.m.split('/')[0]));
                const last = rows[0];
                return (
                  <tr key={cap.n} className="border-b border-edge/40 last:border-0">
                    <td className="py-1.5 pr-3 text-ink/85">{cap.n}</td>
                    <td className="py-1.5 pr-3 text-muted/80">{cap.h}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink/80">{rows.length || '—'}</td>
                    <td className={`py-1.5 text-right ${last ? (last.ok ? 'text-ok' : 'text-danger') : 'text-muted/50'}`}>{last ? `${last.status} · ${last.ms}ms` : 'no calls in window'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted/70">Counts cover the in-memory journal window (last 120 calls, persisted across restarts) — the full history lives in the hash-chained ledger.</p>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* PayPal rails */}
        <Panel icon={<Database size={14} />} chip="bg-accent/10 text-accent" title="PayPal rails — live totals" sub="docs/PAYPAL.md">
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
                <p className="text-muted">not registered (set <Code>PUBLIC_BASE_URL</Code> + sandbox keys; mock mode simulates events internally)</p>
              )}
            </div>
          </div>
          <Foot>
            <span className="font-semibold uppercase tracking-wide text-muted/70">verifications:</span>
            <Chip>VERIFIED {verifications.VERIFIED ?? 0}</Chip>
            <Chip>SUSPICIOUS {verifications.SUSPICIOUS ?? 0}</Chip>
            <Chip>IMPOSTOR {verifications.IMPOSTOR ?? 0}</Chip>
            <a className="ml-auto flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/PAYPAL.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> every call, payload & real response
            </a>
          </Foot>
        </Panel>

        {/* AI core */}
        <Panel icon={<Cpu size={14} />} chip="bg-teal/10 text-teal" title="AI core" sub="docs/AI.md · docs/AGENT.md">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="agent mode" value={data.mode.llm === 'LLM' ? 'LLM' : 'deterministic'} />
            <Stat label="approved" value={approvals.APPROVED ?? 0} tone="text-ok" />
            <Stat label="denied" value={approvals.DENIED ?? 0} tone="text-danger" />
            <Stat label="pending" value={approvals.PENDING ?? 0} tone="text-amber-600" />
          </div>
          {data.mode.llm === 'LLM' && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className="font-semibold uppercase tracking-wide text-muted/70">live model:</span>
              <Chip>{data.llmModel ?? 'gpt-4o'}</Chip>
              <Chip>Vultr Serverless Inference</Chip>
              <Chip>2.3–4.2 s measured</Chip>
            </div>
          )}
          <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-ink/85">
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-[3px] shrink-0 text-ok" />
              <span><b>Propose-only tools.</b> <Code>propose_payout</Code> ships with no <Code>execute</Code> — the model structurally cannot move money.</span></li>
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-[3px] shrink-0 text-ok" />
              <span><b>Zero unguarded money.</b> nothing moves without first passing <Code>policy.evaluate()</Code> — enforced by construction, asserted in CI.</span></li>
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-[3px] shrink-0 text-ok" />
              <span><b>Model-independent trust.</b> the deterministic agent is the zero-key fallback — no decision ever waits on a model.</span></li>
            <li className="flex gap-2"><CheckCircle2 size={13} className="mt-[3px] shrink-0 text-ok" />
              <span><b>Read-only eyes.</b> official <Code>@paypal/agent-toolkit</Code> — {data.toolkit.available ? `attached (${data.toolkit.toolNames?.length} list/get tools)` : 'activates on first agent call'}; it can look, never touch.</span></li>
          </ul>
          <div className="mt-3"><Caption>the governed tool set — what the model may call, by side</Caption></div>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <tbody>
                {[
                  ['create_invoice', 'money-in · autonomous', 'runs after a policy ALLOW check — full HandleResult into actions[]'],
                  ['send_reminder', 'money-in · autonomous', 'tone-escalating chase of the most-overdue invoice; drafts held up front'],
                  ['propose_payout', 'proposal-only', 'NO execute — the control plane evaluates and gates'],
                  ['propose_mandate_change', 'proposal-only', 'NO execute — the human signs (or denies) the drafted diff'],
                  ['toolkit list/get ×4', 'read-only', 'invoices + disputes — eyes, never hands'],
                ].map(([t, side, note]) => (
                  <tr key={t} className="border-b border-edge/40 last:border-0">
                    <td className="py-1 pr-2 font-mono font-semibold text-ink/80">{t}</td>
                    <td className={`py-1 pr-2 whitespace-nowrap ${side.startsWith('proposal') ? 'text-amber-600' : 'text-ok'}`}>{side}</td>
                    <td className="py-1 text-muted/80">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Foot>
            <a className="flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/AI.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> AI architecture & benchmarks (§7 = live Vultr captures)
            </a>
            <Dot />
            <a className="flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/AGENT.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> agent modes & verbatim results
            </a>
          </Foot>
        </Panel>

        {/* Trust layer */}
        <Panel icon={<ShieldCheck size={14} />} chip="bg-ok/10 text-ok" title="Deterministic trust layer" sub="docs/ARCHITECTURE.md">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="audit records" value={c.auditRecords} />
            <Stat label="webhook events ingested" value={c.eventsIngested} />
            <Stat label="chain" value={data.chain.ok ? 'verified' : 'BROKEN'} tone={data.chain.ok ? 'text-ok' : 'text-danger'} />
          </div>
          <div className="mt-3"><Caption>engine decisions by reason code — {totalRules} total</Caption></div>
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
          <Foot>
            <a className="flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> 12 annotated diagrams + data model
            </a>
            <Dot />
            <span>receipts exportable per audit row</span>
          </Foot>
        </Panel>

        {/* AG Grid */}
        <Panel icon={<Grid3x3 size={14} />} chip="bg-violet-500/10 text-accent" title="AG Grid — the inspection surface (sponsor)" sub="docs/AG-GRID.md">
          <p className="text-[12px] leading-relaxed text-ink/85">
            The audit ledger in the <b>Console</b> is AG Grid Community over this exact
            hash-chained data — <b>{c.auditRecords} audit rows</b> and <b>{c.invoices} invoices</b>
            right now, fed by SSE: settlements, gates and new decisions stream into the grid as they happen.
          </p>
          <div className="mt-3"><Caption>grid features in this build</Caption></div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip>floating filter row · 9 columns</Chip>
            <Chip>quick search</Chip>
            <Chip>CSV export of the filtered ledger</Chip>
            <Chip>decision-tinted rows</Chip>
            <Chip>per-row signed receipt export</Chip>
            <Chip>live SSE refresh</Chip>
            <Chip>DOM-virtualised ({c.auditRecords} rows, ~15 alive)</Chip>
          </div>
          <Foot>
            <a className="flex items-center gap-1 text-accent hover:underline" href="https://github.com/0xv3nm09/mandate/blob/main/docs/AG-GRID.md" target="_blank" rel="noreferrer">
              <FileText size={11} /> full guide + screenshots
            </a>
            <Dot />
            <span>see it live: Console → Audit Log</span>
          </Foot>
        </Panel>
      </div>

      <p className="mt-4 flex items-center gap-2 text-[11px] text-muted/70">
        <Layers size={11} /> one endpoint powers this page: <Code>GET /api/stack</Code> — mandate terms, counts, rule hits, chain status, webhook registration and the call journal from the running process.
      </p>
    </div>
  );
}
