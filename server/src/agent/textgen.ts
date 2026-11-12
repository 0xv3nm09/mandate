// The language writer. The model (when present) only ever writes language here:
// risk explanations, reminder drafts, mandate-diff proposals, audit answers.
// It never decides anything — every decision exists only in the policy engine.

import { env, llmMode } from '../env.js';
import type { Decision, ProposedAction } from '../types.js';

// ── Optional LLM (dynamically imported; the demo runs fully without it) ──────
let generate: ((system: string, prompt: string) => Promise<string | null>) | null = null;

async function loadLlm(): Promise<typeof generate> {
  if (generate !== null) return generate;
  try {
    if (env.llm.anthropicKey) {
      const [{ createAnthropic }, ai] = await Promise.all([import('@ai-sdk/anthropic'), import('ai')]);
      const anthropic = createAnthropic({ apiKey: env.llm.anthropicKey });
      generate = async (system, prompt) => {
        const { text } = await ai.generateText({
          model: anthropic(env.llm.model ?? 'claude-sonnet-4-5'),
          system,
          prompt,
          maxOutputTokens: 500,
        });
        return text;
      };
    } else if (env.llm.openaiKey) {
      const [{ createOpenAI }, ai] = await Promise.all([import('@ai-sdk/openai'), import('ai')]);
      const openai = createOpenAI({ apiKey: env.llm.openaiKey, ...(env.llm.baseUrl ? { baseURL: env.llm.baseUrl } : {}) });
      generate = async (system, prompt) => {
        const { text } = await ai.generateText({
          model: openai(env.llm.model ?? 'gpt-4o'),
          system,
          prompt,
          maxOutputTokens: 500,
        });
        return text;
      };
    }
  } catch {
    generate = null; // package missing → deterministic fallback
  }
  return generate;
}

export const llmAvailable = (): boolean => llmMode === 'LLM';

// ── FR-09: plain-language risk explanation for the approval card ─────────────
export async function riskExplanation(
  action: ProposedAction,
  decision: Decision,
  ctx: { dailySpent: number; perTxn: number; allowlisted: boolean }
): Promise<string> {
  const g = await loadLlm();
  const facts = `Facts (from deterministic policy engine — do not change them):
- proposed action: ${action.type} of $${action.amount} ${action.currency} to ${action.payee}${action.standing ? ' (claims standing mandate)' : ''}
- engine decision: ${decision.decision} (${decision.reasonCode}): ${decision.reasonText}
- policy hits: ${decision.policyHits.map((h) => `${h.rule} — ${h.detail}`).join('; ')}
- per-transaction threshold: $${ctx.perTxn}; allowlisted payee: ${ctx.allowlisted}; spent today: $${ctx.dailySpent}`;

  if (g) {
    const out = await g(
      'You write the risk summary shown to a human before they approve an agent money-out. One short paragraph, plain language, factual, no hedging, no markdown. You may recommend, but you can NEVER change the decision.',
      facts
    );
    if (out) return out.trim();
  }
  const mult = (action.amount / ctx.perTxn).toFixed(1);
  return [
    `The agent proposes a $${action.amount} ${action.type} to ${action.payee} — ${mult}× your $${ctx.perTxn} per-transaction threshold.`,
    ctx.allowlisted ? 'This payee is on your allowlist.' : 'This payee is NOT on your allowlist.',
    `Policy verdict: ${decision.decision} (${decision.reasonCode}). ${decision.policyHits.map((h) => h.detail).join('. ')}.`,
    `Approving executes the payout immediately; denying aborts it permanently. Both outcomes are written to the hash-chained audit log.`,
  ].join(' ');
}

// ── FR-04: AI-drafted, tone-escalating reminders ─────────────────────────────
export async function reminderDraft(
  payeeName: string,
  amount: number,
  currency: string,
  memo: string,
  attempt: number
): Promise<{ subject: string; note: string; tone: string }> {
  const tones = ['friendly nudge', 'firm follow-up', 'final notice before escalation'];
  const tone = tones[Math.min(attempt - 1, tones.length - 1)];
  const g = await loadLmmMaybe();
  if (g) {
    const out = await g(
      `You draft invoice payment reminders for a freelancer. Tone: ${tone}. 2-3 sentences, professional, no markdown. Include the amount and the work description.`,
      `Invoice to ${payeeName}: $${amount} ${currency} for "${memo}". This is reminder attempt #${attempt}. Due date has passed.`
    );
    if (out) {
      return {
        subject: attempt === 1 ? `Friendly reminder: invoice for ${memo}` : attempt === 2 ? `Second notice: invoice for ${memo} is overdue` : `Final notice: invoice for ${memo}`,
        note: out.trim(),
        tone,
      };
    }
  }
  const notes = [
    `Hi ${payeeName} — just a gentle nudge that the $${amount} ${currency} invoice for "${memo}" is due. If it slipped your queue, no worries; here's the link again whenever you're ready.`,
    `Hi ${payeeName} — the $${amount} ${currency} invoice for "${memo}" is now past due. Please settle it at your earliest convenience, or let me know if there's an issue on your side.`,
    `Hi ${payeeName} — this is a final notice for the overdue $${amount} ${currency} invoice for "${memo}". Kindly settle immediately to avoid the account being escalated to collections.`,
  ];
  const subjects = [
    `Friendly reminder: invoice for ${memo}`,
    `Second notice: invoice for ${memo} is overdue`,
    `Final notice: invoice for ${memo}`,
  ];
  const i = Math.min(attempt - 1, 2);
  return { subject: subjects[i], note: notes[i], tone };
}
async function loadLmmMaybe() {
  return llmAvailable() ? (await loadLlm()) : null;
}

// ── UC-07: NL → mandate diff PROPOSAL (human reviews + signs) ────────────────
export interface MandatePatch {
  dailyTotal?: number;
  perTxn?: number;
  addPayee?: string;
  removePayee?: string;
  standing?: { payee: string; payeeName: string; amount: number; currency: string; cadence: 'weekly'; note: string };
  clearStanding?: boolean;
}

export async function mandateDraft(text: string, emailFor: (name: string) => { email: string; name: string }): Promise<{ patch: MandatePatch; description: string } | null> {
  const lower = text.toLowerCase();
  const patch: MandatePatch = {};
  let touched = false;

  const daily = lower.match(/(?:cap|limit)\s+(?:the\s+)?daily\s+(?:spend|total|out)?\s*(?:at|to)\s*\$?\s*([\d,]+)/);
  if (daily) {
    patch.dailyTotal = num(daily[1]);
    touched = true;
  }
  const perTxn = lower.match(/(?:per[- ]transaction|per[- ]txn|single payment)\s+(?:limit|cap)?\s*(?:at|to)?\s*\$?\s*([\d,]+)/) ?? lower.match(/(?:never|don'?t)\s+pay\s+(?:anyone|anybody)?\s*(?:more than|over|above)\s*\$?\s*([\d,]+)/);
  if (perTxn) {
    patch.perTxn = num(perTxn[1]);
    touched = true;
  }
  const add = text.match(/add\s+([A-Za-z][\w .&'-]*?)(?:\s+(?:to|on)\s+(?:the\s+)?allowlist|@[\w.]+)/i);
  const emailInText = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g);
  if (emailInText && /allow|add/i.test(text)) {
    patch.addPayee = emailInText[0];
    touched = true;
  } else if (add) {
    patch.addPayee = emailFor(add[1].trim()).email;
    touched = true;
  }
  const remove = text.match(/remove\s+([\w.+-]+@[\w.-]+)/i);
  if (remove) {
    patch.removePayee = remove[1];
    touched = true;
  }
  const standing = lower.match(/pay\s+(?:my\s+)?(?:va|assistant|contractor|freelancer)?\s*([a-z][\w .&'-]*?)\s+\$?\s*([\d,]+(?:\.\d{1,2})?)\s+(?:every|each|per)?\s*week(?:ly)?/);
  if (standing) {
    const c = emailFor(standing[1].trim());
    patch.standing = {
      payee: c.email, payeeName: c.name, amount: num(standing[2]), currency: 'USD', cadence: 'weekly',
      note: `Standing weekly payout authorized by human signature (v+1)`,
    };
    touched = true;
  }

  if (!touched) return null;
  const parts: string[] = [];
  if (patch.dailyTotal !== undefined) parts.push(`daily cap → $${patch.dailyTotal}`);
  if (patch.perTxn !== undefined) parts.push(`per-transaction threshold → $${patch.perTxn}`);
  if (patch.addPayee) parts.push(`allowlist + ${patch.addPayee}`);
  if (patch.removePayee) parts.push(`allowlist − ${patch.removePayee}`);
  if (patch.standing) parts.push(`standing mandate: $${patch.standing.amount}/week → ${patch.standing.payee}`);
  return { patch, description: parts.join(' · ') };
}

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}

// ── UC-09: interrogate the audit trail (+ counterfactual) ────────────────────
export async function auditAnswer(
  question: string,
  records: { seq: number; ts: string; kind: string; decision: string | null; payload: Record<string, unknown> }[],
  mandate: { version: number; limits: { perTxn: number; dailyTotal: number }; payeeAllowlist: string[] }
): Promise<{ answer: string; relatedSeqs: number[]; receiptSeq: number | null; counterfactual: string | null }> {
  const lower = question.toLowerCase();
  const blocked = records.filter((r) => r.decision === 'BLOCK');
  const payeeMatch = records.filter((r) => {
    const p = String((r.payload as Record<string, unknown>).payee ?? '');
    return p && lower.includes(p.split('@')[0].toLowerCase());
  });
  const relevant = payeeMatch.length ? payeeMatch : (lower.includes('block') ? blocked : records.slice(0, 5));
  const seqs = relevant.map((r) => r.seq);
  const firstBlock = relevant.find((r) => r.decision === 'BLOCK');

  let receiptSeq: number | null = null;
  let counterfactual: string | null = null;
  let answer: string;

  const g = await loadLmmMaybe();
  if (g) {
    const out = await g(
      'You answer questions about an agent money-movement audit log. Be factual, cite record numbers, and when something was blocked explain exactly which policy rule fired and what signed mandate change would allow it. 2-4 sentences.',
      `Question: ${question}\nMandate v${mandate.version}: perTxn=$${mandate.limits.perTxn}, dailyTotal=$${mandate.limits.dailyTotal}, allowlist=${mandate.payeeAllowlist.join(', ')}\nRecords: ${JSON.stringify(relevant.slice(0, 8))}`
    );
    if (out) answer = out.trim();
    else answer = template();
  } else {
    answer = template();
  }

  if (firstBlock) {
    receiptSeq = firstBlock.seq;
    const payee = String(firstBlock.payload.payee ?? 'this payee');
    const code = String(firstBlock.payload.reasonCode ?? '');
    counterfactual =
      code === 'R_BLOCK_PAYEE'
        ? `Adding ${payee} to your allowlist (which re-signs the mandate as a new version) would have allowed this action.`
        : code === 'R_BLOCK_DAILY_CAP'
          ? `Raising your daily cap above $${mandate.limits.dailyTotal} (a signed mandate change) would have allowed it.`
          : `A corresponding signed mandate change (new version) would be required to allow this action.`;
  }

  return { answer, relatedSeqs: seqs, receiptSeq, counterfactual };

  function template(): string {
    if (firstBlock) {
      return `Record #${firstBlock.seq}: the ${String(firstBlock.payload.actionType)} of $${String(firstBlock.payload.amount)} to ${String(firstBlock.payload.payee)} was BLOCKED — ${String(firstBlock.payload.reasonText ?? '')} (reason code ${String(firstBlock.payload.reasonCode)}). The engine evaluated it against signed mandate v${mandate.version} and refused before any PayPal call was made.`;
    }
    if (relevant.length) {
      return `I found ${relevant.length} matching record(s): ${relevant.slice(0, 3).map((r) => `#${r.seq} ${r.kind} — ${String(r.payload.event ?? '')}`).join('; ')}.`;
    }
    return `No audit records match that question yet. Run a use case or chat with the agent first.`;
  }
}
