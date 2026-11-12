// Agent facade: natural language in → governed actions out.
// LLM path (AI SDK tool loop) when a key exists; deterministic parser otherwise.
// Either way the agent can only PROPOSE — the control plane decides (see SYSTEM_CARD.md).

import { parse, emailFor, type ParsedIntent } from './parser.js';
import { handle, type HandleResult } from '../controlPlane.js';
import { mandateDraft, auditAnswer } from './textgen.js';
import { signMandate, ensureMandate } from '../control-plane/mandate.js';
import { setHalted } from '../control-plane/approvals.js';
import { appendAudit } from '../control-plane/audit.js';
import { listAudit } from '../control-plane/audit.js';
import { sendReminder, pickOverdue, runStandingPayout, simulateInvoicePaid, listInvoices, sweepOverdue } from '../services.js';
import { llmAvailable } from './textgen.js';

export interface AgentReply {
  reply: string;
  actions: (HandleResult & { kind: string })[];
  ui: Record<string, unknown>;
  mode: 'LLM' | 'DETERMINISTIC';
}

export async function chat(message: string): Promise<AgentReply> {
  if (llmAvailable()) {
    try {
      return await llmChat(message);
    } catch (e) {
      // degrade to the deterministic parser — the money path is unaffected (fail-case catalog)
      console.error('[agent] LLM path failed, using deterministic parser:', e);
    }
  }
  return parserChat(message);
}

// ── Deterministic path (default demo mode) ───────────────────────────────────
export async function parserChat(message: string): Promise<AgentReply> {
  const intent: ParsedIntent = parse(message);
  const actions: (HandleResult & { kind: string })[] = [];
  let reply = '';
  const ui: Record<string, unknown> = {};

  switch (intent.kind) {
    case 'invoice': {
      const payee = emailFor(intent.payeeName);
      const res = await handle({ type: 'invoice', amount: intent.amount, currency: 'USD', payee: payee.email, payeeName: payee.name, memo: intent.memo }, 'chat');
      actions.push({ ...res, kind: 'invoice' });
      reply = res.decision?.decision === 'ALLOW'
        ? `Invoice created and sent to ${payee.name} (${payee.email}) for $${intent.amount} — "${intent.memo}". Autonomous: invoicing is money-in, so no approval was needed. Logged to the audit chain.`
        : `Policy verdict on the invoice: ${res.decision?.decision} — ${res.decision?.reasonText}`;
      break;
    }

    case 'payout': {
      const payee = emailFor(intent.payeeName);
      const res = await handle({ type: 'payout', amount: intent.amount, currency: 'USD', payee: payee.email, payeeName: payee.name, memo: intent.note, standing: intent.standing }, 'chat');
      actions.push({ ...res, kind: 'payout' });
      if (res.status === 'AWAIT_APPROVAL') {
        reply = `I've proposed a $${intent.amount} payout to ${payee.name}. The policy engine gated it: ${res.decision?.reasonText} I've written a risk summary — it's waiting in your approval inbox.`;
      } else if (res.status === 'BLOCKED') {
        reply = `The policy engine blocked that outright: ${res.decision?.reasonText} No prompt can override this — only a signed mandate change can.`;
      } else if (res.status === 'EXECUTED') {
        reply = `Executed autonomously: $${intent.amount} to ${payee.name} was within your signed limits (${res.decision?.reasonCode}). Payout batch ${res.execution?.paypalRef} is ${res.execution?.status}.`;
      } else if (res.status === 'HALTED') {
        reply = `Nothing moved — global stop is engaged. Resume the agent first.`;
      } else {
        reply = `Action result: ${res.status}. ${res.decision?.reasonText ?? ''}`;
      }
      break;
    }

    case 'reminder': {
      sweepOverdue();
      const inv = intent.payeeName ? pickOverdue(intent.payeeName) : pickOverdue();
      if (!inv) {
        reply = `No unpaid invoices found to chase. Everything sent so far is either paid or not yet due.`;
        break;
      }
      const r = await sendReminder(inv.id);
      reply = `Chased ${r.invoice.payeeName ?? r.invoice.payee}: "${r.subject}" — reminder #${r.invoice.remindersSent}, tone: ${r.tone}. ${r.delivered ? 'Autonomously drafted and sent; logged.' : 'Autonomously drafted and logged — delivery held (see audit).'}`;
      ui.reminder = { subject: r.subject, note: r.note, tone: r.tone, invoice: r.invoice.invoiceNumber, delivered: r.delivered };
      break;
    }

    case 'listInvoices': {
      const invs = listInvoices();
      ui.invoices = invs;
      reply = invs.length
        ? `You have ${invs.length} invoice(s). Latest: ${invs.slice(0, 3).map((i) => `${i.invoiceNumber} — $${i.amount} ${i.status}`).join('; ')}.`
        : `No invoices yet. Try: "Invoice Acme $1,200 for October design".`;
      break;
    }

    case 'auditQuestion': {
      const mandate = await ensureMandate();
      const a = await auditAnswer(
        intent.question,
        listAudit(100).map((r) => ({ seq: r.seq, ts: r.ts, kind: r.kind, decision: r.decision, payload: r.payload })),
        { version: mandate.version, limits: mandate.limits, payeeAllowlist: mandate.payeeAllowlist }
      );
      reply = a.answer + (a.counterfactual ? ` ${a.counterfactual}` : '');
      ui.auditAnswer = a;
      break;
    }

    case 'mandateChange': {
      const mandate = await ensureMandate();
      const draft = await mandateDraft(intent.text, emailFor);
      if (!draft) {
        reply = `I couldn't map that to a mandate change. Try: "cap daily at $1,000", "never pay anyone more than $50", "add sam@contractor.test to the allowlist", or "pay vita $300 weekly".`;
        break;
      }
      const next = {
        limits: {
          perTxn: draft.patch.perTxn ?? mandate.limits.perTxn,
          dailyTotal: draft.patch.dailyTotal ?? mandate.limits.dailyTotal,
          currency: mandate.limits.currency,
        },
        payeeAllowlist: draft.patch.addPayee
          ? [...new Set([...mandate.payeeAllowlist, draft.patch.addPayee])]
          : mandate.payeeAllowlist.filter((p) => p !== draft.patch.removePayee),
        standing: draft.patch.clearStanding ? null : draft.patch.standing
          ? { payee: draft.patch.standing.payee, payeeName: draft.patch.standing.payeeName, amount: draft.patch.standing.amount, currency: 'USD', cadence: 'weekly' as const, note: draft.patch.standing.note }
          : mandate.standing,
        issuedAt: new Date().toISOString(),
        summary: mandate.summary,
      };
      const signed = await signMandate(next, { source: 'agent-draft + human sign (UC-07)' });
      reply = `I drafted the mandate diff: ${draft.description}. It's signed as version ${signed.version} — the previous version remains verifiable in the audit chain. Authority stays with your signature, not with my reasoning.`;
      ui.mandate = signed;
      break;
    }

    case 'halt': {
      setHalted(true);
      appendAudit({ kind: 'SYSTEM', payload: { event: 'GLOBAL STOP engaged by operator — all agent action frozen (FR-15)' } });
      reply = `Global stop engaged. The agent is halted: new proposals are refused, queued approvals are frozen, and nothing executes until you resume.`;
      break;
    }

    case 'resume': {
      setHalted(false);
      appendAudit({ kind: 'SYSTEM', payload: { event: 'GLOBAL STOP lifted — agent resumed by operator' } });
      reply = `Agent resumed. Standing mandates and approvals will flow again under the same signed limits.`;
      break;
    }

    case 'runStanding': {
      const r = await runStandingPayout('chat');
      if (!r.ran) {
        reply = r.reason ?? 'Standing mandate could not run.';
      } else {
        const res = r.result!;
        actions.push({ ...res, kind: 'payout' });
        reply =
          res.status === 'EXECUTED'
            ? `Standing payout executed with no human prompt — the run matched the signed envelope ($${r.result?.decision?.policyHits[0]?.detail ?? ''}), so autonomy applied (UC-08). Audit marks it "auto-executed under standing mandate".`
            : `Standing run did not auto-execute — status ${res.status}: ${res.decision?.reasonText ?? ''}. Any drift from the envelope falls back to gate/block.`;
      }
      break;
    }

    case 'simulatePaid': {
      sweepOverdue();
      const r = simulateInvoicePaid(intent.payeeName);
      reply = r.ok
        ? `Simulated buyer payment received for ${r.invoice?.invoiceNumber} — webhook INVOICING.INVOICE.PAID processed, invoice now PAID.`
        : r.error ?? 'Could not simulate payment.';
      break;
    }

    case 'help': {
      reply = [
        `I'm your finance agent — I propose, Mandate disposes. Try:`,
        `• "Invoice Acme $1,200 for October design" — autonomous money-in`,
        `• "Chase Acme" then "simulate paid from Acme" — reminders + webhook demo`,
        `• "Pay contractor Sam $500" — gated money-out with AI risk summary`,
        `• "Pay NewVendor $800" — hard-blocked, watch the guardrail`,
        `• "Cap daily at $500" / "Pay Vita $300 weekly" — speak your policy (UC-07)`,
        `• "Run standing" — autonomous pre-authorized payout (UC-08)`,
        `• "Why was anything blocked?" — interrogate the audit trail (UC-09)`,
      ].join('\n');
      break;
    }
  }

  return { reply, actions, ui, mode: 'DETERMINISTIC' };
}

// ── LLM path: AI SDK v5 tool loop with governed tools (propose-not-execute) ──
// create_invoice EXECUTES inline (money-in, ALLOW by policy). propose_payout /
// propose_mandate_change have NO execute: the SDK returns the tool-call as a
// proposal, which we route through the control plane.

async function llmChat(message: string): Promise<AgentReply> {
  const { env } = await import('../env.js');
  const ai = await import('ai');
  const { z } = await import('zod');

  let model: Parameters<typeof ai.generateText>[0]['model'];
  if (env.llm.anthropicKey) {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    model = createAnthropic({ apiKey: env.llm.anthropicKey })(env.llm.model ?? 'claude-sonnet-4-5');
  } else {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({ apiKey: env.llm.openaiKey!, ...(env.llm.baseUrl ? { baseURL: env.llm.baseUrl } : {}) });
    // .chat() = classic /chat/completions with tools — what OpenAI-compatible providers
    // (Vultr Serverless Inference, Groq, Together, …) implement; the SDK default (...)
    // would call OpenAI's newer /responses endpoint, which third parties don't serve.
    model = openai.chat(env.llm.model ?? 'gpt-4o');
  }

  const mandate = await ensureMandate();

  // Official @paypal/agent-toolkit read-only tools (list/get invoices + disputes).
  // They move no money, so the model may call them directly; everything money-moving
  // stays behind the governed tools below.
  const { readOnlyToolkitTools } = await import('../paypal/toolkit.js');
  const toolkitTools = (await readOnlyToolkitTools()) as Record<string, ReturnType<typeof ai.tool>>;

  const tools = {
    ...toolkitTools,
    create_invoice: ai.tool({
      description: 'Create and send a PayPal invoice (money-IN, low risk). Runs autonomously after a policy ALLOW check.',
      inputSchema: z.object({ payeeEmail: z.string(), payeeName: z.string().optional(), amount: z.number(), memo: z.string() }),
      execute: async (a) => {
        const res = await handle({ type: 'invoice', amount: a.amount, currency: 'USD', payee: a.payeeEmail, payeeName: a.payeeName, memo: a.memo }, 'chat');
        return { status: res.status, decision: res.decision?.reasonCode ?? null, paypalRef: res.execution?.paypalRef ?? null };
      },
    }),
    propose_payout: ai.tool({
      description: 'Propose sending money OUT via PayPal payout. Requires policy evaluation; may gate for human approval.',
      inputSchema: z.object({ receiver: z.string(), receiverName: z.string().optional(), amount: z.number(), note: z.string() }),
      // NO execute → the model's call becomes a PROPOSAL the control plane handles
    }),
    propose_mandate_change: ai.tool({
      description: 'Propose a change to the signed Intent Mandate (limits, allowlist, standing weekly payout). Human must sign.',
      inputSchema: z.object({
        description: z.string(),
        dailyTotal: z.number().optional(),
        perTxn: z.number().optional(),
        addPayee: z.string().optional(),
        standingPayee: z.string().optional(),
        standingAmount: z.number().optional(),
      }),
      // NO execute → proposal, not execution
    }),
  };

  const { steps, text } = await ai.generateText({
    model,
    system: [
      'You are Mandate, an autonomous finance agent for a freelancer.',
      'You can create/send invoices autonomously, but you NEVER have spending authority:',
      'for money-out you only call propose_payout; the deterministic control plane decides ALLOW/GATE/BLOCK against the signed Intent Mandate.',
      `Active mandate v${mandate.version}: per-txn $${mandate.limits.perTxn}, daily cap $${mandate.limits.dailyTotal}, allowlist: ${mandate.payeeAllowlist.join(', ')}.`,
      'Be concise. Explain what you did and what the control plane decided.',
    ].join(' '),
    prompt: message,
    tools,
    stopWhen: ai.stepCountIs(6),
  });

  const actions: (HandleResult & { kind: string })[] = [];
  const proposals = steps.flatMap((s) => s.toolCalls).filter((c) => c.toolName !== 'create_invoice');
  for (const p of proposals) {
    if (p.toolName === 'propose_payout') {
      const input = p.input as { receiver: string; receiverName?: string; amount: number; note: string };
      const res = await handle({ type: 'payout', amount: input.amount, currency: 'USD', payee: input.receiver, payeeName: input.receiverName, memo: input.note }, 'chat');
      actions.push({ ...res, kind: 'payout' });
    }
    if (p.toolName === 'propose_mandate_change') {
      const input = p.input as { dailyTotal?: number; perTxn?: number; addPayee?: string; standingPayee?: string; standingAmount?: number };
      const next = {
        limits: { perTxn: input.perTxn ?? mandate.limits.perTxn, dailyTotal: input.dailyTotal ?? mandate.limits.dailyTotal, currency: mandate.limits.currency },
        payeeAllowlist: input.addPayee ? [...new Set([...mandate.payeeAllowlist, input.addPayee])] : mandate.payeeAllowlist,
        standing: input.standingPayee && input.standingAmount
          ? { payee: input.standingPayee, payeeName: input.standingPayee, amount: input.standingAmount, currency: 'USD', cadence: 'weekly' as const, note: 'Standing weekly payout (LLM-drafted, human-signed)' }
          : mandate.standing,
        issuedAt: new Date().toISOString(),
        summary: mandate.summary,
      };
      const signed = await signMandate(next, { source: 'agent-draft (LLM) + human sign (UC-07)' });
      actions.push({ actionId: `mandate:v${signed.version}`, decision: null, status: 'SIGNED', kind: 'mandate' });
    }
  }

  // The model can reply without emitting ANY tool call (open models are
  // non-deterministic). Scripted use-case runners require an action — degrade to the
  // deterministic parser for this message rather than crash (chat() catches the throw).
  // A create_invoice tool call executed inside the tool also counts as action taken.
  if (actions.length === 0 && steps.flatMap((s) => s.toolCalls).length === 0) {
    throw new Error('LLM produced no governed action — degrading to deterministic parser');
  }

  // The model's closing text can be terse ("Done.") — always surface the control-plane
  // facts (gate/decision/status) so the operator never loses the verdict in chat.
  const summary = actions
    .map((a) => {
      const d = a.decision;
      const ref = a.execution?.paypalRef ? ` (batch ${a.execution.paypalRef})` : '';
      if (a.status === 'AWAIT_APPROVAL') return `Gated — human approval required (${d?.reasonCode ?? 'policy'}). ${d?.reasonText ?? ''}`.trim();
      if (a.status === 'EXECUTED') return `Executed${ref} — decision ${d?.reasonCode ?? 'n/a'}.`;
      if (a.status === 'BLOCKED' || a.status === 'DENIED') return `Blocked — ${d?.reasonText ?? d?.reasonCode ?? 'policy refusal'}`;
      if (a.status === 'SIGNED') return `Mandate re-signed (${a.actionId}).`;
      return null;
    })
    .filter(Boolean)
    .join(' ');
  const reply = [text?.trim(), summary].filter(Boolean).join(' — ');

  return { reply: reply || 'Done.', actions, ui: {}, mode: 'LLM' };
}
