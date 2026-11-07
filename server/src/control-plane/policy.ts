// The deterministic policy engine. Pure function: no I/O, no LLM, no randomness.
// Code owns the facts; the model only writes language. (See SYSTEM_CARD.md)

import type { Decision, IntentMandate, PolicyContext, PolicyHit, ProposedAction } from '../types.js';

const isMoneyOut = (t: ProposedAction['type']) => t === 'payout' || t === 'refund';

export function evaluate(
  action: ProposedAction,
  mandate: IntentMandate,
  ctx: PolicyContext
): Decision {
  const hits: PolicyHit[] = [];
  const mk = (
    decision: Decision['decision'],
    reasonCode: string,
    reasonText: string
  ): Decision => ({
    decision,
    reasonCode,
    reasonText,
    policyHits: hits,
    mandateVersion: mandate.version,
  });

  const allowlisted = mandate.payeeAllowlist.some(
    (p) => p.toLowerCase() === action.payee.toLowerCase()
  );

  // ── Hard BLOCK rules first (no approval option can override these) ─────────
  if (isMoneyOut(action.type) && !allowlisted) {
    hits.push({
      rule: 'R-02',
      detail: `Payee ${action.payee} is not on the signed allowlist (${mandate.payeeAllowlist.length} payees)`,
    });
    return mk(
      'BLOCK',
      'R_BLOCK_PAYEE',
      `Blocked: ${action.payee} is not on your allowlist. No approval path exists for this rule — edit the mandate (which re-signs it) to add the payee.`
    );
  }

  if (isMoneyOut(action.type) && action.currency !== mandate.limits.currency) {
    hits.push({
      rule: 'R-03',
      detail: `Currency ${action.currency} ≠ mandate currency ${mandate.limits.currency}`,
    });
    return mk('BLOCK', 'R_BLOCK_CURRENCY', `Blocked: mandate only authorizes ${mandate.limits.currency} money-out.`);
  }

  if (isMoneyOut(action.type) && ctx.dailySpent + action.amount > mandate.limits.dailyTotal) {
    hits.push({
      rule: 'R-04',
      detail: `Daily cap: spent $${ctx.dailySpent} + $${action.amount} > $${mandate.limits.dailyTotal}`,
    });
    return mk(
      'BLOCK',
      'R_BLOCK_DAILY_CAP',
      `Blocked: daily cap of $${mandate.limits.dailyTotal} would be exceeded ($${ctx.dailySpent} already moved today).`
    );
  }

  // ── Standing-mandate path (UC-08): in-bounds → autonomous; drift → fall through ──
  if (action.standing && isMoneyOut(action.type)) {
    const s = mandate.standing;
    if (
      s &&
      s.payee.toLowerCase() === action.payee.toLowerCase() &&
      s.amount === action.amount &&
      s.currency === action.currency
    ) {
      hits.push({ rule: 'R-05', detail: `Matches standing mandate envelope: $${s.amount} → ${s.payee}, ${s.cadence}` });
      return mk(
        'ALLOW',
        'R_STANDING_ALLOW',
        `Allowed autonomously under standing mandate v${mandate.version}: payee and amount match the signed envelope, daily cap respected.`
      );
    }
    hits.push({
      rule: 'R-06',
      detail: `Standing-mandate drift: proposed $${action.amount} → ${action.payee}, envelope is $${s?.amount} → ${s?.payee}`,
    });
    // drift: fall through to the normal (per-transaction) rules below
  }

  // ── Money-in is low-risk by design ─────────────────────────────────────────
  if (action.type === 'invoice') {
    hits.push({ rule: 'R-07', detail: 'Invoicing moves money IN; no spend authority required' });
    return mk('ALLOW', 'R_ALLOW_INVOICE', 'Allowed: invoicing is money-in — no spending authority consumed.');
  }

  // ── Risk-proportional money-out: under threshold + allowlisted → autonomous ──
  if (isMoneyOut(action.type) && action.amount > mandate.limits.perTxn) {
    hits.push({
      rule: 'R-01',
      detail: `$${action.amount} > per-transaction threshold $${mandate.limits.perTxn} (${(action.amount / mandate.limits.perTxn).toFixed(1)}×)`,
    });
    return mk(
      'GATE',
      'R_GATE_THRESHOLD',
      `Gated: $${action.amount} is ${(action.amount / mandate.limits.perTxn).toFixed(1)}× your per-transaction threshold of $${mandate.limits.perTxn}. Human approval required.`
    );
  }

  if (isMoneyOut(action.type) && ctx.recentPayouts10m >= 3) {
    hits.push({
      rule: 'R-08',
      detail: `Velocity breaker: ${ctx.recentPayouts10m} payouts in the last 10 minutes`,
    });
    return mk('GATE', 'R_GATE_VELOCITY', 'Gated: unusual payout velocity (circuit breaker) — review required.');
  }

  hits.push({
    rule: 'R-09',
    detail: `Under threshold ($${action.amount} ≤ $${mandate.limits.perTxn}), payee allowlisted`,
  });
  return mk(
    'ALLOW',
    'R_ALLOW_IN_BOUNDS',
    `Allowed autonomously: $${action.amount} to an allowlisted payee is within your signed limits.`
  );
}
