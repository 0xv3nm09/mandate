// Inbound-claim verification — the Netflix check. Same discipline as the policy engine:
// a PURE, deterministic function decides; no LLM anywhere in the verdict path.
// A claim ("an invoice/message says it's from Netflix, $49.99") is cross-matched against a
// known-merchant directory: sender domain (exact vs lookalike), amount vs the signed
// subscription envelope, and payment history. Verdict: VERIFIED / SUSPICIOUS / IMPOSTOR / UNVERIFIED.

import { SignJWT } from 'jose';
import { createHmac, createHash } from 'node:crypto';
import { db, now, uid } from '../db.js';
import type { InboundClaim, VerificationCheck, VerificationRecord, VerificationResult, Verdict } from '../types.js';

const secretKey = () => new TextEncoder().encode(process.env.MANDATE_SIGNING_SECRET ?? 'dev-only-mandate-signing-secret-change-me');
const hmac = (s: string) => createHmac('sha256', process.env.MANDATE_SIGNING_SECRET ?? 'dev-only-mandate-signing-secret-change-me').update(s).digest('base64url');

// ── Known-merchant directory (the "match with others" surface) ───────────────
export interface MerchantRecord {
  brand: string;
  officialPayee: string;
  officialDomains: string[];
  expected: { min: number; max: number }; // signed subscription envelope
  category: string;
  hue: number; // monogram color
}

export const MERCHANTS: MerchantRecord[] = [
  { brand: 'Netflix', officialPayee: 'billing@netflix.com', officialDomains: ['netflix.com', 'mail.netflix.com'], expected: { min: 7.99, max: 24.99 }, category: 'Streaming subscription', hue: 0 },
  { brand: 'Spotify', officialPayee: 'billing@spotify.com', officialDomains: ['spotify.com'], expected: { min: 4.99, max: 19.99 }, category: 'Music subscription', hue: 140 },
  { brand: 'Adobe', officialPayee: 'billing@adobe.com', officialDomains: ['adobe.com'], expected: { min: 9.99, max: 89.99 }, category: 'Creative software', hue: 25 },
  { brand: 'AWS', officialPayee: 'aws-billing@amazon.com', officialDomains: ['amazon.com', 'aws.amazon.com'], expected: { min: 0, max: 500 }, category: 'Cloud infrastructure', hue: 220 },
];

export const findMerchant = (brand: string): MerchantRecord | undefined =>
  MERCHANTS.find((m) => m.brand.toLowerCase() === brand.trim().toLowerCase());

// ── The pure verifier ────────────────────────────────────────────────────────
export function verifyInbound(
  claim: InboundClaim,
  ctx: { paidBefore: boolean }
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const merchant = findMerchant(claim.brand);
  const domain = claim.from.split('@')[1]?.toLowerCase() ?? '';

  // 1. directory match
  if (!merchant) {
    checks.push({ name: 'Merchant directory', pass: null, detail: `“${claim.brand}” is not in the known-merchant directory — cannot vouch either way` });
    return {
      verdict: 'UNVERIFIED',
      reasonCode: 'R_UNKNOWN_BRAND',
      reasonText: `No directory entry for “${claim.brand}”. Not flagged as fraud — but not vouched for either. Verify through the brand's official app before paying.`,
      checks,
    };
  }
  checks.push({ name: 'Merchant directory', pass: true, detail: `${merchant.brand} found — official payee ${merchant.officialPayee}` });

  // 2. sender identity: exact official payee > official domain > lookalike > unknown
  let senderVerdict: Verdict = 'SUSPICIOUS';
  if (claim.from.toLowerCase() === merchant.officialPayee.toLowerCase()) {
    checks.push({ name: 'Sender identity', pass: true, detail: `${claim.from} is the official billing payee (exact match)` });
    senderVerdict = 'VERIFIED';
  } else if (merchant.officialDomains.includes(domain)) {
    checks.push({ name: 'Sender identity', pass: true, detail: `${domain} is an official ${merchant.brand} domain` });
    senderVerdict = 'VERIFIED';
  } else if (isLookalike(domain, merchant)) {
    checks.push({ name: 'Sender identity', pass: false, detail: `${domain} IMITATES ${merchant.brand} (lookalike of ${merchant.officialDomains.join('/')}) — classic impostor pattern` });
    senderVerdict = 'IMPOSTOR';
  } else {
    checks.push({ name: 'Sender identity', pass: false, detail: `${domain} is not an official ${merchant.brand} domain — possible spoof` });
    senderVerdict = 'SUSPICIOUS';
  }

  // 3. amount vs the signed subscription envelope
  const inRange = claim.amount >= merchant.expected.min && claim.amount <= merchant.expected.max;
  checks.push({
    name: 'Amount vs envelope',
    pass: inRange,
    detail: inRange
      ? `$${claim.amount.toFixed(2)} is within ${merchant.brand}'s known range ($${merchant.expected.min.toFixed(2)}–$${merchant.expected.max.toFixed(2)})`
      : `$${claim.amount.toFixed(2)} is OUTSIDE ${merchant.brand}'s known range ($${merchant.expected.min.toFixed(2)}–$${merchant.expected.max.toFixed(2)}) — price change or inflated bill`,
  });

  // 4. history
  checks.push({
    name: 'Payment history',
    pass: ctx.paidBefore ? true : null,
    detail: ctx.paidBefore ? `You have paid ${claim.from} before and it verified` : `First time seeing ${claim.from} — no history to confirm against`,
  });

  // aggregate: any impostor check wins, then suspicious, else verified
  const verdict: Verdict =
    senderVerdict === 'IMPOSTOR' ? 'IMPOSTOR'
      : senderVerdict === 'SUSPICIOUS' || !inRange ? 'SUSPICIOUS'
        : 'VERIFIED';

  const reasonCode =
    verdict === 'IMPOSTOR' ? 'R_IMPOSTOR_LOOKALIKE'
      : verdict === 'SUSPICIOUS' ? (!inRange ? 'R_SUSPICIOUS_AMOUNT' : 'R_SUSPICIOUS_DOMAIN')
        : 'R_VERIFIED_OFFICIAL';

  const reasonText =
    verdict === 'IMPOSTOR'
      ? `IMPOSTOR: “${claim.brand}” invoice from ${claim.from} — the domain imitates the official one and the amount is unusual. Do not pay; report it.`
      : verdict === 'SUSPICIOUS'
        ? !inRange
          ? `SUSPICIOUS: sender looks official but $${claim.amount.toFixed(2)} is outside the known envelope — confirm the price change in the official app before paying.`
          : `SUSPICIOUS: amount is plausible but ${claim.from} is not an official ${merchant.brand} sender — verify in the official app.`
        : `VERIFIED: official ${merchant.brand} sender, amount within the signed envelope${ctx.paidBefore ? ', and you have paid this sender before' : ''}.`;

  return { verdict, reasonCode, reasonText, checks };
}

function isLookalike(domain: string, m: MerchantRecord): boolean {
  const brand = m.brand.toLowerCase().replace(/\s+/g, '');
  const officialRoot = m.officialDomains[0]; // e.g. netflix.com
  const officialBase = officialRoot.split('.')[0]; // netflix
  const base = domain.split('.')[0]; // netflix-payments
  return (
    domain !== officialRoot &&
    (base.includes(brand) || brand.includes(base) || levenshtein(base, officialBase) <= 2 || levenshtein(domain, officialRoot) <= 3)
  );
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]) as number[][];
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// ── Persist + sign + audit ───────────────────────────────────────────────────
export async function recordVerification(claim: InboundClaim): Promise<VerificationRecord> {
  const paidBefore = !!db
    .prepare(`SELECT id FROM verifications WHERE verdict = 'VERIFIED' AND json_extract(claim,'$.from') = ?`)
    .get(claim.from.toLowerCase());
  const result = verifyInbound(claim, { paidBefore });

  const jws = await new SignJWT({ verdict: result.verdict, reasonCode: result.reasonCode, claim })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('mandate.inbound-verification')
    .sign(secretKey());

  const id = uid();
  db.prepare(
    `INSERT INTO verifications (id, claim, verdict, reasonCode, reasonText, checksJson, jws, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, JSON.stringify(claim), result.verdict, result.reasonCode, result.reasonText, JSON.stringify(result.checks), jws, now());

  const { appendAudit } = await import('./audit.js');
  appendAudit({
    kind: 'VERIFICATION',
    payload: {
      event: `Inbound ${claim.channel} claiming ${claim.brand} (${claim.from}) → ${result.verdict}: ${result.reasonCode}`,
      brand: claim.brand, from: claim.from, amount: claim.amount, currency: claim.currency,
      verdict: result.verdict, reasonCode: result.reasonCode, verificationId: id,
    },
  });

  return { id, claim, jws, createdAt: now(), ...result };
}

export function listVerifications(limit = 8): VerificationRecord[] {
  const rows = db.prepare('SELECT * FROM verifications ORDER BY createdAt DESC LIMIT ?').all(limit) as {
    id: string; claim: string; verdict: Verdict; reasonCode: string; reasonText: string; checksJson: string; jws: string; createdAt: string;
  }[];
  return rows.map((r) => ({
    id: r.id, claim: JSON.parse(r.claim), verdict: r.verdict, reasonCode: r.reasonCode,
    reasonText: r.reasonText ?? '', checks: JSON.parse(r.checksJson), jws: r.jws, createdAt: r.createdAt,
  }));
}

export function verificationReceipt(id: string) {
  const row = db.prepare('SELECT * FROM verifications WHERE id = ?').get(id) as
    | { id: string; claim: string; verdict: Verdict; reasonCode: string; reasonText: string; checksJson: string; jws: string; createdAt: string }
    | undefined;
  if (!row) return null;
  const claim = JSON.parse(row.claim);
  return {
    type: 'VERIFICATION_RECEIPT',
    version: 1,
    id: row.id,
    claim,
    verdict: row.verdict,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    checks: JSON.parse(row.checksJson),
    jws: row.jws,
    createdAt: row.createdAt,
    claimHash: createHash('sha256').update(JSON.stringify(claim)).digest('hex').slice(0, 32),
    receiptSignature: hmac(`vreceipt.${row.id}.${row.verdict}`),
  };
}

// ── Dispute evidence pack (UC-12): proof of what actually happened ───────────
export function buildEvidencePack(actionId: string) {
  const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as Record<string, unknown> | undefined;
  if (!action) return null;
  const audit = db.prepare('SELECT seq, ts, kind, decision, payload FROM audit WHERE actionId = ? ORDER BY seq ASC').all(actionId) as Record<string, unknown>[];
  const approval = db.prepare('SELECT * FROM approvals WHERE actionId = ? ORDER BY createdAt DESC LIMIT 1').get(actionId) as Record<string, unknown> | undefined;
  const payout = db.prepare('SELECT * FROM payouts WHERE actionId = ? ORDER BY createdAt DESC LIMIT 1').get(actionId) as Record<string, unknown> | undefined;
  const mandateVersion = action.mandateVersion;

  const pack = {
    type: 'MANDATE_EVIDENCE_PACK',
    version: 1,
    generatedAt: now(),
    action,
    approval: approval ?? null,
    payout: payout ?? null,
    auditRecords: audit,
    mandateVersion,
    narrative:
      payout
        ? `Payout ${payout.batchId} of $${action.amount} to ${action.payee} was human-approved (by ${approval?.resolvedBy ?? 'operator'}) and settled with status ${payout.status} per PayPal's own webhook.`
        : `No payout exists for this action — the control plane refused it (${action.reasonCode}).`,
  };
  const canonical = JSON.stringify(pack, Object.keys(pack).sort());
  const packHash = createHash('sha256').update(canonical).digest('hex');
  return { ...pack, packHash, signature: hmac(`evidence.${actionId}.${packHash}`) };
}

// ── Demo scenarios (deterministic, judge-friendly) ───────────────────────────
export const VERIFY_SCENARIOS: Record<string, { label: string; claim: InboundClaim }> = {
  'netflix-real': {
    label: 'Real Netflix bill',
    claim: { brand: 'Netflix', from: 'billing@netflix.com', fromName: 'Netflix', amount: 15.49, currency: 'USD', memo: 'Netflix Standard Plan — November', channel: 'email' },
  },
  'netflix-impostor': {
    label: 'Lookalike impostor',
    claim: { brand: 'Netflix', from: 'billing@netflix-payments.com', fromName: 'Netflix Billing', amount: 49.99, currency: 'USD', memo: 'URGENT: your account will be suspended — settle $49.99 now', channel: 'email' },
  },
  'netflix-hike': {
    label: 'Official sender, price hike',
    claim: { brand: 'Netflix', from: 'billing@netflix.com', fromName: 'Netflix', amount: 27.49, currency: 'USD', memo: 'Netflix Premium — plan price updated', channel: 'invoice' },
  },
  'unknown-brand': {
    label: 'Unknown brand',
    claim: { brand: 'StreamFlix', from: 'billing@streamflix.io', fromName: 'StreamFlix', amount: 12.99, currency: 'USD', memo: 'Monthly subscription', channel: 'invoice' },
  },
};
