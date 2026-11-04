import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Bot, User, Terminal } from 'lucide-react';
import { api, type ChatReply } from '../lib/api';
import { DecisionPill, StatusPill } from './StatusPill';

interface Bubble {
  who: 'user' | 'agent';
  text: string;
  reply?: ChatReply;
}

const SUGGESTIONS = [
  'Invoice Acme $1,200 for October design',
  'Chase Acme',
  'Pay contractor Sam $500',
  'Pay NewVendor $800',
  'Cap daily at $600 and never pay anyone more than $75',
  'Run standing',
  'Why was anything blocked?',
];

export function AgentConsole() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      who: 'agent',
      text: "I'm your finance agent. I draft invoices, chase payers and propose payouts — but I never have spending authority: every money-out is decided by the deterministic control plane against your signed Intent Mandate. Try a suggestion below.",
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles, thinking]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || thinking) return;
    setInput('');
    setBubbles((b) => [...b, { who: 'user', text: msg }]);
    setThinking(true);
    try {
      const reply = await api<ChatReply>('/chat', { method: 'POST', body: JSON.stringify({ message: msg }) });
      setBubbles((b) => [...b, { who: 'agent', text: reply.reply, reply }]);
    } catch (e: any) {
      setBubbles((b) => [...b, { who: 'agent', text: `⚠ ${e.message ?? 'request failed'}` }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge/60 pb-2.5">
        <span className="text-muted"><Sparkles size={14} /></span>
        <h3 className="font-display text-[13.5px] font-semibold">Agent Console</h3>
        <span className="pill bg-raised text-slate-400 border border-edge">proposes only · never executes money-out</span>
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto rounded-xl2 border border-edge bg-surface/60 p-3">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex gap-2.5 ${b.who === 'user' ? 'justify-end' : ''}`}>
            {b.who === 'agent' && (
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                <Bot size={15} />
              </span>
            )}
            <div className={`max-w-[85%] space-y-2 ${b.who === 'user' ? 'order-first' : ''}`}>
              <div
                className={`whitespace-pre-wrap rounded-xl2 px-3.5 py-2.5 text-[13px] leading-relaxed ${
                  b.who === 'user' ? 'bg-accent text-white' : 'border border-edge bg-raised text-ink/90'
                }`}
              >
                {b.text}
              </div>
              {b.reply?.actions?.map((a, j) => (
                <div key={j} className="card px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill bg-raised text-slate-300 border border-edge">{a.kind}</span>
                    <DecisionPill decision={a.decision?.decision} code={a.decision?.reasonCode} />
                    <StatusPill status={a.status} />
                    {a.execution && (
                      <span className="mono-hash">paypal · {a.execution.paypalRef} · {a.execution.status}</span>
                    )}
                  </div>
                  {a.decision && (
                    <ul className="mt-2 space-y-0.5">
                      {a.decision.policyHits.map((h, k) => (
                        <li key={k} className="mono-hash">{h.rule} — {h.detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            {b.who === 'user' && (
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal/20 text-teal">
                <User size={15} />
              </span>
            )}
          </div>
        ))}
        {thinking && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Bot size={15} className="text-accent" />
            <span className="animate-pulse-soft">agent is working through the control plane…</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            className="rounded-full border border-edge bg-raised px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/60 hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          className="input flex-1"
          placeholder='e.g. "Invoice Acme $1,200 for October design" or "Pay contractor Sam $500"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={thinking}
        />
        <button className="btn-primary" disabled={thinking || !input.trim()}>
          <Send size={14} /> Send
        </button>
      </form>
    </div>
  );
}

export function SystemLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="card mono-hash max-h-32 overflow-y-auto p-2">
      {lines.map((l, i) => (
        <p key={i} className="flex items-center gap-1"><Terminal size={10} /> {l}</p>
      ))}
    </div>
  );
}
