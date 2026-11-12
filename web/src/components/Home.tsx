import { useEffect, useState } from 'react';
import {
  ArrowRight, BellRing, CheckCircle2, Database, FileSignature, FileText, GitBranch, Lock, Scale,
  ShieldCheck, Sparkles, TrendingUp, Wallet, Webhook, XCircle, Zap, KeyRound, Fingerprint, OctagonPause, Repeat, Link2, Eye, Flame, Rocket, Trophy,
  CircleDollarSign, Gauge, MessageSquareText,
} from 'lucide-react';
import { api, money, shortTime, type Stats, type RunSummary } from '../lib/api';

interface Health {
  mode: { paypal: string; llm: string };
  mandateVersion: number;
  halted: boolean;
}

export function Home({ go }: { go: (page: 'dashboard' | 'console' | 'usecases') => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [dailyCap, setDailyCap] = useState<number | null>(null);
  const [stack, setStack] = useState<{ llmModel: string | null; counts: { eventsIngested: number } } | null>(null);

  useEffect(() => {
    const load = () => {
      api<Stats>('/stats').then(setStats).catch(() => {});
      api<Health>('/health').then(setHealth).catch(() => {});
      api<RunSummary[]>('/runs').then(setRuns).catch(() => {});
      api<{ mandate: { limits: { dailyTotal: number } } }>('/mandate')
        .then((r) => setDailyCap(r.mandate.limits.dailyTotal))
        .catch(() => {});
      api<{ llmModel: string | null; counts: { eventsIngested: number } }>('/stack')
        .then(setStack)
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <Hero go={go} stats={stats} health={health} runs={runs} cap={dailyCap} stack={stack} />
      <LiveProof stats={stats} />
      <InvestorValue />
      <ForWhom />
      <HowItWorks />
      <Security />
      <UseCaseStrip go={go} runs={runs} />
      <Worth />
      <Values />
      <Stack />
      <FinalCta go={go} />
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
type GoTo = (p: 'dashboard' | 'console' | 'usecases') => void;

function Hero({ go, stats, health, runs, cap, stack }: { go: GoTo; stats: Stats | null; health: Health | null; runs: RunSummary[]; cap: number | null; stack: { llmModel: string | null; counts: { eventsIngested: number } } | null }) {
  const clean = runs.filter((r) => r.outcome !== 'error').length;
  return (
    <section className="relative mt-6 overflow-hidden rounded-2xl border border-edge bg-raised shadow-card">
      {/* top ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-ink px-6 py-2.5 text-bg">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
          <span className="h-2 w-2 animate-pulseSoft rounded-full bg-accent" /> Live demo · PayPal sandbox · aligned with AP2
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-0.5 text-[11px] font-bold text-white"><Trophy size={12} /> PayPal AI Hackathon 2026</span>
      </div>

      <div className="grid gap-10 p-6 md:p-10 lg:grid-cols-[1.15fr_1fr]">
        {/* left: the pitch */}
        <div>
          <p className="kicker">The trust layer for agentic money</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.02] tracking-tight md:text-[3.6rem]">
            <span className="text-accent">AI proposes.</span><br />Code authorizes.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted md:text-lg">
            A PayPal-native finance agent that invoices, chases and pays out <b className="text-ink">on its own</b> — yet can never
            move a dollar on its own. Every payment clears a <b className="text-ink">signed policy</b>; anything risky waits for
            <b className="text-ink"> your one tap</b>.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[12px] font-bold text-bg"><KeyRound size={13} /> AI holds 0 PayPal keys</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-ok bg-ok/10 px-3 py-1 text-[12px] font-bold text-ok"><Flame size={13} /> 12 real use cases</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-accent px-3 py-1 text-[12px] font-bold text-accent-bright"><Rocket size={13} /> $8B → $1.5T market</span>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button className="btn-primary h-12 px-6 text-[15px]" onClick={() => go('usecases')}>
              See it run live <ArrowRight size={16} />
            </button>
            <button className="btn-ghost h-12 px-6 text-[15px]" onClick={() => go('dashboard')}>
              Open the dashboard
            </button>
          </div>
        </div>

        {/* right: live decision panel */}
        <div className="rounded-xl2 border border-edge bg-surface p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Every command → policy engine → verdict</p>
            <span className="rounded-full bg-ok/15 px-2 py-0.5 font-mono text-[10px] font-bold text-ok">LIVE</span>
          </div>
          <VerdictStrip />
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-edge pt-4 text-center">
            {[
              { v: stats ? money(stats.moneyIn) : '…', k: 'money in' },
              { v: stats ? money(stats.moneyOut) : '…', k: cap ? `paid out · ${money(cap)} cap` : 'paid out' },
              { v: stats ? `${stats.blocked}` : '…', k: 'blocked outright', hot: true },
            ].map((x) => (
              <div key={x.k}>
                <p className={`font-display text-2xl font-bold ${x.hot ? 'text-danger' : 'text-ink'}`}>{x.v}</p>
                <p className="text-[11px] leading-tight text-muted">{x.k}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 border-t border-edge pt-3 text-center">
            {[
              `governed ${stats?.governed ?? '…'}`,
              `gated ${stats?.gated ?? '…'} → approved ${stats?.approved ?? '…'}`,
              `hard blocks ${stats?.blocked ?? '…'}`,
              `webhook events verified ${stack?.counts.eventsIngested ?? '…'}`,
              ...(stack?.llmModel ? [`LLM: ${stack.llmModel} · Vultr`] : []),
            ].map((c) => (
              <span key={c} className="rounded-full border border-edge bg-raised px-2 py-0.5 font-mono text-[10px] text-muted">{c}</span>
            ))}
          </div>
          <p className="mt-4 text-center font-mono text-[10.5px] text-muted">
            <span className="font-bold text-ok">● live</span> · mandate v{health?.mandateVersion ?? '…'} · JWS · audit {stats?.auditRecords ?? '…'} records ✓{runs.length ? ` · ${clean}/${runs.length} runs clean` : ''} · refreshes every 5s
          </p>
        </div>
      </div>

      {/* capability row — 12 things it actually does, every one backed by a rule or a live use case */}
      <div className="border-t border-edge">
        {[
          [
            { icon: <FileText size={15} />, label: 'Draft & send invoices' },
            { icon: <BellRing size={15} />, label: 'Chase late payers' },
            { icon: <Wallet size={15} />, label: 'Governed payouts' },
            { icon: <ShieldCheck size={15} />, label: 'The “Netflix” check' },
            { icon: <FileSignature size={15} />, label: 'Signed policy' },
            { icon: <Database size={15} />, label: 'Hash-chained audit' },
          ],
          [
            { icon: <Repeat size={15} />, label: 'Standing mandates' },
            { icon: <TrendingUp size={15} />, label: 'Drift detection' },
            { icon: <CircleDollarSign size={15} />, label: 'Daily spend cap' },
            { icon: <Gauge size={15} />, label: 'Velocity breaker' },
            { icon: <OctagonPause size={15} />, label: 'Kill switch' },
            { icon: <MessageSquareText size={15} />, label: 'Plain-English policy edits' },
          ],
        ].map((row, i) => (
          <div key={i} className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 ${i ? 'border-t border-edge' : ''}`}>
            {row.map((t) => (
              <span key={t.label} className="flex items-center justify-center gap-2 border-edge px-3 py-3.5 text-[13px] font-semibold text-ink [&:not(:last-child)]:border-r">
                <span className="text-accent">{t.icon}</span> {t.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function VerdictStrip() {
  const rows = [
    { text: '“Invoice Acme $1,200”', note: 'money-in · runs autonomously', verdict: 'ALLOW', cls: 'text-ok border-ok/40 bg-ok/10', bar: 'from-ok/20', edge: 'border-l-ok' },
    { text: '“Pay Sam $500”', note: '5× the signed threshold', verdict: 'GATE', cls: 'text-amber border-amber/40 bg-amber/10', bar: 'from-amber/20', edge: 'border-l-amber' },
    { text: '“Pay NewVendor $800”', note: 'payee not on the allowlist', verdict: 'BLOCK', cls: 'text-danger border-danger/40 bg-danger/10', bar: 'from-danger/20', edge: 'border-l-danger' },
  ];
  return (
    <div className="mt-4">
      <div className="grid gap-2.5">
        {rows.map((r) => (
          <div
            key={r.verdict}
            className={`grid h-14 grid-cols-[1fr_92px] items-center gap-3 rounded-xl2 border border-edge/60 border-l-2 bg-gradient-to-r ${r.bar} to-transparent px-4 text-left shadow-raised ${r.edge}`}
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-[12px] text-ink/90">{r.text}</span>
              <span className="block truncate text-[10.5px] text-slate-500">{r.note}</span>
            </span>
            <span className={`pill justify-center border font-mono ${r.cls}`}>{r.verdict}</span>
          </div>
        ))}
      </div>
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
        <div key={c.label} className="card card-gradient flex min-h-[118px] flex-col p-4 transition-colors hover:border-edge">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.chip}`}>{c.icon}</span>
            {c.label}
          </div>
          <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
          <p className="mt-auto line-clamp-2 pt-1 text-[11px] leading-snug text-slate-500">{c.note}</p>
        </div>
      ))}
    </section>
  );
}

// ── About ────────────────────────────────────────────────────────────────────
function ForWhom() {
  const pains = [
    {
      icon: <FileText size={18} className="text-teal" />, chip: 'bg-teal/15 ring-1 ring-teal/30',
      pain: 'The work shipped. The invoice didn’t.',
      fix: 'Say “invoice Acme $1,200 for October design” — Mandate drafts and sends it on PayPal, then tracks it to paid.',
    },
    {
      icon: <BellRing size={18} className="text-indigo-300" />, chip: 'bg-accent/15 ring-1 ring-accent/30',
      pain: 'Chasing late payers is awkward, so you put it off.',
      fix: 'It watches due dates and sends the reminders for you — polite first, firmer each retry, in your voice.',
    },
    {
      icon: <Lock size={18} className="text-fuchsia-300" />, chip: 'bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30',
      pain: 'You’d never hand an AI your real money.',
      fix: 'So it never holds the keys. It can only propose — your signed policy and one tap decide what actually moves.',
    },
  ];
  return (
    <Section title="Built for the person who’d rather not do money admin" kicker="Who it’s for" accent="text-teal">
      <p className="-mt-2 mb-5 max-w-2xl text-sm leading-relaxed text-muted">
        For freelancers, solo merchants and small teams who live on PayPal — the people who do their own billing and
        can’t afford a finance hire, or a payment mistake.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {pains.map((p) => (
          <div key={p.pain} className="card card-gradient p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-edge">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${p.chip}`}>{p.icon}</span>
            <p className="mt-3 font-display text-[15px] font-semibold leading-snug">{p.pain}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.fix}</p>
          </div>
        ))}
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
    <Section title="Why this matters now" kicker="The worth of the idea" accent="text-accent-bright">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="card card-gradient p-6">
          <h3 className="font-display text-xl font-semibold">Agentic commerce is exploding — trust is the missing rail</h3>
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

// ── Investor value — the numbers ─────────────────────────────────────────────
function InvestorValue() {
  const bars = [
    { y: '2026', v: '$8B', h: 6, solid: true },
    { y: '2027', v: '', h: 14, solid: false },
    { y: '2028', v: '', h: 30, solid: false },
    { y: '2029', v: '', h: 58, solid: false },
    { y: '2030', v: '$1.5T', h: 100, solid: true },
  ];
  return (
    <section className="mt-14 overflow-hidden rounded-2xl bg-ink p-8 text-bg shadow-card md:p-10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="kicker !text-accent">The opportunity · for investors &amp; judges</span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-white">~190× in 4 years</span>
      </div>
      <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold leading-tight md:text-4xl">
        Agents will move <span className="text-accent">$1.5 trillion</span> by 2030. Nobody guards it on PayPal.
      </h2>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex h-48 items-end gap-3">
            {bars.map((b) => (
              <div key={b.y} className="flex flex-1 flex-col items-center justify-end gap-2 h-full">
                {b.v && <span className="font-display text-lg font-bold text-accent">{b.v}</span>}
                <div className={`w-full rounded-t-md ${b.solid ? 'bg-accent' : 'bg-[repeating-linear-gradient(135deg,rgba(242,238,229,0.25)_0_6px,rgba(242,238,229,0.08)_6px_12px)]'}`} style={{ height: `${b.h}%` }} />
                <span className="font-mono text-[11px] text-bg/60">{b.y}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] text-bg/50">agentic commerce value · 2026 &amp; 2030 (Juniper) · 2027–29 implied constant growth (~3.7×/yr)</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { big: '$8.5M', small: 'Skyfire raised — agent payments, crypto rails' },
            { big: '$5M', small: 'Nekuda raised — Visa & Amex Ventures, card rails' },
            { big: '$20M+', small: 'raised by agent-payment guardrail startups' },
            { big: '$0', small: 'spent guarding PayPal — that’s Mandate', hot: true },
          ].map((c) => (
            <div key={c.big} className={`rounded-xl2 p-4 ${c.hot ? 'bg-accent text-white' : 'border border-bg/15 bg-bg/5'}`}>
              <p className="font-display text-3xl font-bold">{c.big}</p>
              <p className={`mt-1 text-[12px] leading-snug ${c.hot ? 'text-white/90' : 'text-bg/65'}`}>{c.small}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-8 grid gap-3 border-t border-bg/15 pt-6 sm:grid-cols-3">
        {[
          { k: 'Business model', v: 'Fee per governed transaction + policy tiers per seat' },
          { k: 'Who pays', v: 'Freelancers, solo merchants & small teams already on PayPal' },
          { k: 'Moat', v: 'Closed loop: invoice → collect → pay out → reconcile, signed end to end' },
        ].map((m) => (
          <div key={m.k}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">{m.k}</p>
            <p className="mt-1 text-sm text-bg/85">{m.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Security ─────────────────────────────────────────────────────────────────
function Security() {
  const items = [
    { icon: <KeyRound size={18} />, t: 'AI holds zero keys', b: 'The model never sees PayPal credentials. It can only propose — it cannot pay.', tag: 'NO KEYS' },
    { icon: <FileSignature size={18} />, t: 'Signed policy (JWS)', b: 'Your limits live in a signed Intent Mandate. Change one byte and every check fails closed.', tag: 'SIGNED' },
    { icon: <Link2 size={18} />, t: 'Hash-chained audit', b: 'Every decision is SHA-256 chained to the last. Tampering breaks the chain instantly.', tag: 'TAMPER-PROOF' },
    { icon: <Repeat size={18} />, t: 'No double pay', b: 'Every payout carries a unique key, so a retry can never send money twice.', tag: 'IDEMPOTENT' },
    { icon: <Fingerprint size={18} />, t: 'Impostor check', b: 'Fake “Netflix” bills are caught by sender domain, amount envelope and history.', tag: 'VERIFIED' },
    { icon: <OctagonPause size={18} />, t: 'Global kill switch', b: 'One tap freezes every proposal and payout — and restores exactly where it was.', tag: 'HALT' },
  ];
  return (
    <section className="mt-14 rounded-2xl border-2 border-accent/30 bg-raised p-8 shadow-card md:p-10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="kicker">Security · the main value</span>
        <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-[11px] font-bold text-ok">10 hard rules · R-00…R-09</span>
        <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-[11px] font-bold text-danger">0 bypasses</span>
      </div>
      <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">
        A prompt can be ignored. <span className="text-accent">A gate cannot.</span>
      </h2>
      <p className="mt-2 max-w-2xl text-muted">Six guarantees stand between the agent and your money.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <div key={i.t} className="rounded-xl2 border border-edge bg-surface p-5 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12 text-accent">{i.icon}</span>
              <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-bg">{i.tag}</span>
            </div>
            <p className="mt-4 font-display text-lg font-bold">{i.t}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{i.b}</p>
          </div>
        ))}
      </div>
    </section>
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
    <Section title="Where authority lives" kicker="How it works" accent="text-accent-bright">
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
function UseCaseStrip({ go, runs }: { go: GoTo; runs: RunSummary[] }) {
  // map each strip row to its recorded use case so the strip shows LIVE outcomes
  const cases = [
    { t: '“Invoice Acme $1,200 for October design”', uc: 'UC-01', r: 'sent autonomously — money-in', c: 'text-ok' },
    { t: '“Chase Acme”', uc: 'UC-02', r: 'AI reminder, tone escalates each retry', c: 'text-teal' },
    { t: '“Pay contractor Sam $500”', uc: 'UC-03', r: 'GATE → AI risk summary → one tap → paid + logged', c: 'text-amber' },
    { t: '“Pay NewVendor $800”', uc: 'UC-04', r: 'BLOCKED — payee not on the signed allowlist', c: 'text-danger' },
    { t: '“Pay Vita $300 weekly”', uc: 'UC-08', r: 'signed once, runs unattended while in-bounds', c: 'text-teal' },
  ];
  const latestByUc = new Map(runs.map((r) => [r.ucId, r]));
  return (
    <Section title="Real use cases. Real engine. Real traces." kicker="Use cases — not mockups" accent="text-teal">
      <div className="card card-gradient divide-y divide-edge/60">
        {cases.map((c) => {
          const live = latestByUc.get(c.uc);
          return (
            <div key={c.t} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-raised/40">
              <p className="font-mono text-[13px] text-ink/90">{c.t}</p>
              {live ? (
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className={`pill ${live.outcome === 'ok' ? 'bg-ok/15 text-ok border border-ok/30' : live.outcome === 'gate' ? 'bg-amber/15 text-amber border border-amber/30' : live.outcome === 'block' ? 'bg-danger/15 text-danger border border-danger/30' : 'bg-danger/20 text-danger border border-danger/40'}`}>
                    {live.outcome.toUpperCase()} · {shortTime(live.ranAt)} · {live.durationMs}ms
                  </span>
                  <span className="hidden text-muted md:inline">→ <span className={c.c}>{c.r}</span></span>
                </span>
              ) : (
                <span className="ml-auto text-xs text-muted">→ <span className={c.c}>{c.r}</span></span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center font-mono text-[10.5px] text-slate-500">
        {runs.length > 0
          ? `pills above are the recorded outcomes of the last live run of each command · ${runs.length} runs in the ledger`
          : 'run the suite once and this strip fills with the recorded outcomes'}
      </p>
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
