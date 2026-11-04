// Intent Mandate: the user's policy as a signed JWT (JWS, HS256 via `jose`).
// Editing always creates a NEW signed version — the mandate is immutable per version. (FR-11)

import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { db, now } from '../db.js';
import type { IntentMandate } from '../types.js';

const key = () => new TextEncoder().encode(process.env.MANDATE_SIGNING_SECRET ?? 'dev-only-mandate-signing-secret-change-me');

export const DEFAULT_MANDATE: Omit<IntentMandate, 'version'> = {
  limits: { perTxn: 100, dailyTotal: 1000, currency: 'USD' },
  payeeAllowlist: ['sam@contractor.test', 'vita@va.test', 'acme@client.test'],
  standing: null,
  issuedAt: now(),
  summary: [
    'Invoices (money-in) flow autonomously.',
    'Payouts/refunds to allowlisted payees under $100 per transaction flow autonomously.',
    'Money-out over $100, or any payout that drifts from a standing envelope, is gated for one-tap human approval.',
    'Payouts to anyone NOT on the allowlist, over the $1,000 daily cap, or in a foreign currency are blocked outright.',
  ],
};

export async function signMandate(policy: Omit<IntentMandate, 'version'>, meta: { source: string }): Promise<IntentMandate> {
  const version = currentMandate()?.version ?? 0;
  const mandate: IntentMandate = { ...policy, version: version + 1 };
  const jws = await new SignJWT({ ...mandate })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('mandate.control-plane')
    .setSubject(`intent-mandate:v${mandate.version}`)
    .sign(key());

  db.prepare('INSERT INTO mandates (version, jws, json, createdAt) VALUES (?, ?, ?, ?)').run(
    mandate.version,
    jws,
    JSON.stringify(mandate),
    now()
  );

  const { appendAudit } = await import('./audit.js');
  appendAudit({
    kind: 'MANDATE_SIGNED',
    payload: {
      event: `Intent Mandate v${mandate.version} signed (${meta.source})`,
      version: mandate.version,
      limits: mandate.limits,
      payeeAllowlist: mandate.payeeAllowlist,
      standing: mandate.standing,
      policyHash: createHash('sha256').update(JSON.stringify(mandate)).digest('hex').slice(0, 16),
    },
  });
  return mandate;
}

export function currentMandate(): IntentMandate | null {
  const row = db.prepare('SELECT json, jws FROM mandates ORDER BY version DESC LIMIT 1').get() as
    | { json: string; jws: string }
    | undefined;
  return row ? (JSON.parse(row.json) as IntentMandate) : null;
}

export function currentMandateJws(): string | null {
  const row = db.prepare('SELECT jws FROM mandates ORDER BY version DESC LIMIT 1').get() as
    | { jws: string }
    | undefined;
  return row?.jws ?? null;
}

export async function ensureMandate(): Promise<IntentMandate> {
  return currentMandate() ?? (await signMandate(DEFAULT_MANDATE, { source: 'bootstrap' }));
}

/** Verify a stored JWS — used for receipts and for proving the active mandate is authentic. */
export async function verifyMandateJws(jws: string): Promise<IntentMandate> {
  const { payload } = await jwtVerify(jws, key());
  return payload as unknown as IntentMandate;
}

export function listMandateVersions(): { version: number; createdAt: string; jws: string }[] {
  return db
    .prepare('SELECT version, createdAt, jws FROM mandates ORDER BY version DESC')
    .all() as { version: number; createdAt: string; jws: string }[];
}

export const canonicalJson = (o: unknown): string =>
  JSON.stringify(o, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
