import { useEffect, useState } from 'react';
import {
  ArrowRight, Bot, CheckCircle2, FileSignature, Fingerprint, GitBranch, Lock, Scale,
  ShieldCheck, Sparkles, TrendingUp, Webhook, XCircle, Zap,
} from 'lucide-react';
import { api, money, type Stats } from '../lib/api';

interface Health {
  mode: { paypal: string; llm: string };
  mandateVersion: number;
  halted: boolean;
}

export function Home({ go }: { go: (page: 'dashboard' | 'console' | 'usecases') => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const load = () => {
      api<Stats>('/stats').then(setStats).catch(() => {});
      api<Health>('/health').then(setHealth).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <Hero go={go} stats={stats} health={health} />
      <LiveProof stats={stats} />
      <WhatItIs />
      <Worth />
      <Values />
      <HowItWorks />
      <UseCaseStrip go={go} />
      <Stack />
      <FinalCta go={go} />
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
type GoTo = (p: 'dashboard' | 'console' | 'usecases') => void;

function Hero({ go, stats, health }: { go: GoTo; stats: Stats | null; health: Health | null }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-edge/60 bg-surface/60 px-6 py-14 text-center shadow-card md:px-12 md:py-20">
      {/* aurora */}
      <div className="pointer-events-none absolute -top-36 left-1/2 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px] animate-drift" />
      <div className="pointer-events-none absolute -bottom-44 -left-28 h-80 w-[26rem] rounded-full bg-teal/20 blur-[110px] animate-drift-slow" />
      <div className="pointer-events-none absolute -right-28 top-6 h-72 w-[24rem] rounded-full bg-fuchsia-500/15 blur-[100px] animate-drift" />
      <div className="pointer-events-none absolute inset-0 bg-grid-dots bg-[size:26px_26px] [mask-image:radial-gradient(60rem_30rem_at_50%_0%,black_30%,transparent_75%)]" />
            <div className="relative">
        <p className="mx-auto flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-indigo-200">
          <Sparkles size={12} className="text-teal" />
          Built on PayPal sandbox · aligned with AP2
        </p>
        <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight md:text-6xl">
          AI agents can move money now.
          <span className="block text-aurora drop-shadow-[0_0_28px_rgba(139,92,246,0.35)]">
            Mandate makes every dollar accountable.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted md:text-lg">
          <b className="text-ink/90">Mandate</b> is a PayPal-native finance agent that invoices, collects and pays out
          <b className="text-ink/90"> on its own</b> — wrapped in a <b className="text-ink/90">deterministic trust layer</b>.
          Money-in flows autonomously; risky money-out is checked against a <b className="text-ink/90">signed Intent Mandate</b>,
          explained by an <b className="text-ink/90">AI risk summary</b>, and held at a <b className="text-ink/90">one-tap human gate</b>.
          Every decision lands in an <b className="text-ink/90">immutable, hash-chained audit log</b> — tamper-evident, exportable, and yours to interrogate.
        </p>
        <p className="mx-auto mt-3 max-w-2xl font-display text-sm text-teal">
          “Verifiable intent, not inferred action” — the principle of AP2, the payments standard PayPal backs.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button className="btn-primary px-6 py-3 text-base" onClick={() => go('usecases')}>
            See it run — 12 live use cases <ArrowRight size={16} />
          </button>
          <button className="btn-ghost px-6 py-3 text-base hover:border-teal/50" onClick={() => go('dashboard')}>
            Open the live dashboard
          </button>
        </div>
        <VerdictStrip />
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] text-slate-500">
          <span>paypal-gateway: <b className="text-slate-300">{health?.mode.paypal ?? '…'}</b></span>
          <span>agent: <b className="text-slate-300">{health?.mode.llm === 'LLM' ? 'llm/ai-sdk' : 'deterministic'}</b></span>
          <span>intent-mandate: <b className="text-slate-300">v{health?.mandateVersion ?? '…'} · JWS</b></span>
          {stats && <span>audit-chain: <b className="text-slate-300">{stats.auditRecords} records ✓</b></span>}
        </div>
      </div>
    </section>
  );
}

// The money-shot as a static, glanceable diagram: propose → engine → verdict.
function VerdictStrip() {
  const rows = [
    { text: '“Invoice Acme $1,200”', verdict: 'ALLOW', note: 'money-in · autonomous', cls: 'text-ok border-ok/30 bg-ok/10', bar: 'from-ok/25', edge: 'border-l-ok' },
    { text: '“Pay Sam $500”', verdict: 'GATE', note: '5× threshold · human taps once', cls: 'text-amber border-amber/30 bg-amber/10', bar: 'from-amber/25', edge: 'border-l-amber' },
    { text: '“Pay NewVendor $800”', verdict: 'BLOCK', note: 'not on allowlist · no bypass', cls: 'text-danger border-danger/30 bg-danger/10', bar: 'from-danger/25', edge: 'border-l-danger' },
  ];
  return (
    <div className="mx-auto mt-9 grid max-w-2xl gap-2">
      {rows.map((r) => (
        <div
          key={r.verdict}
          className={`flex items-center gap-3 rounded-xl2 border border-edge/60 border-l-2 ${r.edge} bg-gradient-to-r ${r.bar} to-transparent px-4 py-2.5 text-left shadow-raised`}
        >
          <span className="font-mono text-[11px] text-ink/85 sm:text-[12px]">{r.text}</span>
          <ArrowRight size={12} className="hidden text-slate-500 sm:inline" />
          <span className="hidden flex-1 font-mono text-[11px] text-slate-500 md:inline">policy-engine.evaluate()</span>
          <span className={`pill ml-auto border ${r.cls}`}>
            {r.verdict} <span className="font-normal opacity-75">· {r.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Live stats (real numbers from the audit chain) ───────────────────────────
function LiveProof({ stats }: { stats: Stats | null }) {
  const cards = [
    { icon: <Scale size={16} />, label: 'Actions governed', value: stats ? String(stats.governed) : '—', note: 'every proposal hit the policy engine', chip: 'bg-accent/15 text-indigo-300 ring-1 ring-accent/30', num: 'text-indigo-200' },
    { icon: <Zap size={16} />, label: 'Executed autonomously', value: stats ? String(stats.allowed) : '—', note: 'no human involved — invoices + in-bounds money-out', chip: 'bg-teal/15 text-teal ring-1 ring-teal/30', num: 'text-teal' },
    { icon: <Lock size={16} />, label: 'Passed the human gate', value: stats ? String(stats.gated) : '—', note: `gated by policy${stats?.approved ? ` · ${stats.approved} approved by tap` : ''}`, chip: 'bg-amber/15 text-amber ring-1 ring-amber/30', num: 'text-amber' },
    { icon: <XCircle size={16} />, label: 'Blocked outright', value: stats ? String(stats.blocked) : '—', note: 'hard rules — no bypass exists', chip: 'bg-danger/15 text-danger ring-1 ring-danger/30', num: 'text-danger' },
    { icon: <ShieldCheck size={16} />, label: 'Audit chain', value: stats ? `${stats.auditRecords} ✓` : '—', note: 'hash-chained, tamper-evident', chip: 'bg-ok/15 text-ok ring-1 ring-ok/30', num: 'text-ok' },
  ];
  return (
    <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
      {cards.map((c) => (
        <div key={c.label} className="card card-gradient p-4 transition-colors hover:border-edge">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.chip}`}>{c.icon}</span>
            {c.label}
          </div>
          <p className={`mt-2.5 font-display text-2xl font-bold ${c.num}`}>{c.value}</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{c.note}</p>
        </div>
      ))}
    </section>
  );
}

// ── About ────────────────────────────────────────────────────────────────────
function WhatItIs() {
  return (
    <Section title="What Mandate is" kicker="About">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card card-gradient p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-edge">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/15 ring-1 ring-teal/30"><Bot size={20} className="text-teal" /></span>
          <h3 className="mt-3 font-display text-lg font-semibold">An agent that does real back-office work</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Natural language in, PayPal operations out: it creates and sends invoices, notices overdue payers and chases
            them with escalating reminders, and executes payouts — including fully unattended, pre-authorized recurring ones.
          </p>
        </div>
        <div className="card card-gradient p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-edge">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-accent/30"><Scale size={20} className="text-indigo-300" /></span>
          <h3 className="mt-3 font-display text-lg font-semibold">A trust layer that owns the decisions</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The agent can only <i>propose</i>. A deterministic policy engine checks every action against a signed Intent
            Mandate — caps, allowlists, thresholds — and returns ALLOW, GATE or BLOCK. No model call sits in that path,
            so no hallucination can move money.
          </p>
        </div>
        <div className="card card-gradient p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-edge">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30"><Fingerprint size={20} className="text-fuchsia-300" /></span>
          <h3 className="mt-3 font-display text-lg font-semibold">A trail you can verify and interrogate</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Every decision, approval and settlement is appended to a SHA-256 hash-chained log — tampering is detectable
            and receipts are cryptographically signed. Ask it in plain English why something was blocked; get the answer
            and the exact mandate change that would allow it.
          </p>
        </div>
      </div>
    </Section>
  );
}

// ── Values (product principles) ──────────────────────────────────────────────
function Values() {
  const items = [
    {
      icon: <GitBranch size={16} className="text-indigo-300" />,
      chip: 'bg-accent/15 ring-1 ring-accent/30',
      title: 'Code decides, not the model',
      body: 'The LLM writes language — drafts, explanations. The policy engine owns every allow/deny. A prompt can be ignored; a deterministic gate cannot.',
    },
    {
      icon: <TrendingUp size={16} className="text-teal" />,
      chip: 'bg-teal/15 ring-1 ring-teal/30',
      title: 'Risk-proportional autonomy',
      body: 'A $1,200 invoice needs nobody. A $500 payout needs one tap. A $300 pre-authorized weekly payout needs nobody, forever, while it stays in-bounds. Autonomy scales with trust, not zero or one.',
    },
    {
      icon: <FileSignature size={16} className="text-fuchsia-300" />,
      chip: 'bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30',
      title: 'Verifiable intent',
      body: 'Your policy is a signed JWT — an Intent Mandate. Every evaluation records the mandate version it used. Authorization is a signature, never the agent’s reasoning.',
    },
    {
      icon: <Webhook size={16} className="text-amber" />,
      chip: 'bg-amber/15 ring-1 ring-amber/30',
      title: 'The human signs, then steps away',
      body: 'We move people from execution time to authorization time: pre-sign the envelope and the agent runs unattended — the instant anything drifts, it gates again.',
    },
  ];
  return (
    <Section title="What we believe" kicker="Values" accent="text-teal">
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((v) => (
          <div key={v.title} className="card card-gradient flex gap-4 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-edge">
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${v.chip}`}>{v.icon}</span>
            <div>
              <h3 className="font-display font-semibold">{v.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{v.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Worth of the idea ────────────────────────────────────────────────────────
function Worth() {
  return (
    <Section title="Why this matters now" kicker="The worth of the idea" accent="text-fuchsia-300">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="card card-gradient p-6">
          <h3 className="font-display text-xl font-semibold">Agentic commerce is exploding — trust is the missing rail</h3>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Stat big="~$8B" small="agentic commerce value, 2026 (Juniper)" cls="text-indigo-300" />
            <Stat big="$1.5T" small="projected by 2030 — ~190× growth" cls="text-aurora" />
            <Stat big="$20M+" small="recent funding into agent-payment guardrails" cls="text-amber" />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            The money is converging on one question: <b className="text-ink/80">who authorizes an agent to spend?</b>
            {' '}Nekuda ($5M, Visa & Amex Ventures), Skyfire ($8.5M) and Ant International ($1.2B) are all building identity
            and guardrails for autonomous payments — but on crypto and card rails.{' '}
            <b className="text-ink/80">Not one of them supports PayPal.</b>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Mandate claims the open lane: PayPal-native guardrails for the operators PayPal actually serves — freelancers,
            solo merchants, small teams — and a closed loop (invoice → collect → pay out → reconcile) that the
            middleware-only players don't have. The monetization is native: a fee per governed transaction, policy tiers per seat.
          </p>
        </div>
        <div className="card card-gradient p-6">
          <h3 className="font-display text-lg font-semibold">Aligned with the standard, not against it</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Google's Agent Payments Protocol (AP2) — backed by 60+ partners including <b className="text-ink/80">PayPal</b> —
            makes a signed <i>Mandate</i> its core primitive: an agent's reasoning is never the authorization; a signed
            mandate is. That is literally this product's architecture.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-teal" /> Signed Intent Mandate = AP2's mandate primitive, applied to back-office money ops</li>
            <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-teal" /> Signed receipts per action = AP2's customer-facing artifact pattern</li>
            <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-teal" /> Payee constraints + replay protection enforced where AP2 reference impls leave them open</li>
          </ul>
          <p className="mt-4 rounded-lg border border-teal/25 bg-teal/10 p-3 font-display text-sm text-teal">
            “AP2-style verifiable intent, brought to PayPal money operations.”
          </p>
        </div>
      </div>
    </Section>
  );
}

function Stat({ big, small, cls = 'text-ink' }: { big: string; small: string; cls?: string }) {
  return (
    <div className="rounded-xl2 border border-edge/70 bg-raised/60 p-3 text-center shadow-raised">
      <p className={`font-display text-2xl font-bold ${cls}`}>{big}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{small}</p>
    </div>
  );
}

// ── How it works (the four zones) ────────────────────────────────────────────
function HowItWorks() {
  const zones = [
    { n: '1', title: 'Operator', body: 'Console + approval inbox. You instruct in natural language and tap approve — nothing else is required of you.', cls: 'border-l-accent', badge: 'bg-gradient-to-br from-indigo-400 to-indigo-600' },
    { n: '2', title: 'AI Agent', body: 'Parses intent, drafts language, PROPOSES actions. Holds no keys, no authority, no direct PayPal access for money-out.', cls: 'border-l-amber', badge: 'bg-gradient-to-br from-amber-400 to-orange-500' },
    { n: '3', title: 'Control Plane', body: 'Pure deterministic code: signed mandate + policy engine + approval queue + hash-chained audit. No LLM inside — ever.', cls: 'border-l-teal', badge: 'bg-gradient-to-br from-teal-400 to-teal-600' },
    { n: '4', title: 'PayPal', body: 'Invoicing & Payouts REST in the sandbox, webhooks for status. Money only ever leaves after a policy pass (and an approval if gated).', cls: 'border-l-slate-500', badge: 'bg-gradient-to-br from-slate-400 to-slate-600' },
  ];
  return (
    <Section title="Where authority lives" kicker="How it works" accent="text-violet-300">
      <div className="grid gap-3 md:grid-cols-4">
        {zones.map((z) => (
          <div key={z.n} className={`card card-gradient border-l-4 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-edge ${z.cls}`}>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg font-display text-sm font-bold text-white shadow-raised ${z.badge}`}>{z.n}</span>
            <h3 className="mt-3 font-display font-semibold">{z.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{z.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        The trust boundary (●) sits between zones 3 and 4: money leaves the account only after the engine says yes.
      </p>
    </Section>
  );
}

// ── Use case strip ───────────────────────────────────────────────────────────
function UseCaseStrip({ go }: { go: GoTo }) {
  const cases = [
    { t: '“Invoice Acme $1,200 for October design”', r: 'sent autonomously — money-in', c: 'text-ok' },
    { t: '“Chase Acme”', r: 'AI reminder, tone escalates each retry', c: 'text-teal' },
    { t: '“Pay contractor Sam $500”', r: 'GATE → AI risk summary → one tap → paid + logged', c: 'text-amber' },
    { t: '“Pay NewVendor $800”', r: 'BLOCKED — payee not on the signed allowlist', c: 'text-danger' },
    { t: '“Pay Vita $300 weekly”', r: 'signed once, runs unattended while in-bounds', c: 'text-teal' },
  ];
  return (
    <Section title="Say it, watch it, verify it" kicker="Use cases" accent="text-teal">
      <div className="card card-gradient divide-y divide-edge/60">
        {cases.map((c) => (
          <div key={c.t} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-raised/40">
            <p className="font-mono text-[13px] text-ink/90">{c.t}</p>
            <span className="ml-auto text-xs text-muted">→ <span className={c.c}>{c.r}</span></span>
          </div>
        ))}
      </div>
      <div className="mt-4 text-center">
        <button className="btn-primary" onClick={() => go('usecases')}>
          Run all twelve live — real engine, real traces <ArrowRight size={15} />
        </button>
      </div>
    </Section>
  );
}

// ── Stack ────────────────────────────────────────────────────────────────────
function Stack() {
  const chips = [
    'React + Vite + TS', 'Tailwind', 'AG Grid', 'Hono', 'Vercel AI SDK', 'PayPal REST (Invoicing · Payouts · Webhooks)',
    'jose (JWS)', 'node:sqlite', 'SSE', 'SHA-256 hash chain',
  ];
  return (
    <Section title="Built for the judges' checklist" kicker="Stack & integrity">
      <div className="card p-6">
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-full border border-edge bg-raised px-3 py-1 text-xs text-muted">{c}</span>
          ))}
        </div>
        <div className="mt-5 grid gap-3 text-sm text-muted md:grid-cols-3">
          <p><b className="text-ink/85">Idempotent money-out.</b> Every payout carries a unique key (approval id / standing-week) — resubmission can never double-pay.</p>
          <p><b className="text-ink/85">Failure-safe.</b> PayPal 5xx/timeouts retry then queue — an action stays pending, never silently executes. Webhook events are signature-checked and deduped.</p>
          <p><b className="text-ink/85">Kill switch.</b> Global stop halts proposals, freezes approvals, and refuses execution — then restores exactly where it was.</p>
        </div>
      </div>
    </Section>
  );
}

function FinalCta({ go }: { go: GoTo }) {
  return (
    <section className="relative mt-12 overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-surface to-teal/15 p-10 text-center shadow-card">
      <div className="pointer-events-none absolute -top-24 left-1/3 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-fuchsia-500/20 blur-[100px] animate-drift" />
      <div className="pointer-events-none absolute -bottom-28 right-0 h-56 w-80 rounded-full bg-teal/20 blur-[90px] animate-drift-slow" />
      <div className="relative">
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
          We didn't build an agent that spends your money.
          <span className="block text-aurora">We built the layer that lets you trust one that does.</span>
        </h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button className="btn-primary px-6 py-3" onClick={() => go('usecases')}>Run the proof</button>
          <button className="btn-ghost px-6 py-3 hover:border-teal/50" onClick={() => go('dashboard')}>Open the dashboard</button>
        </div>
        <p className="mt-4 font-mono text-xs text-slate-400">
          sandbox money only · {money(0)} real dollars were harmed in the making of this demo
        </p>
      </div>
    </section>
  );
}

function Section({ title, kicker, accent = 'text-accent-bright', children }: { title: string; kicker: string; accent?: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <p className={`kicker ${accent}`}>{kicker}</p>
      <h2 className="mt-2 mb-5 font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
      {children}
    </section>
  );
}
