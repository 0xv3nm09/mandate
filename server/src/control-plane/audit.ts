// Append-only, hash-chained audit log. Each record commits to the previous record's hash
// and carries its own JWS — tampering anywhere is detectable (FR-12). Receipts are exportable (FR-19).

import { createHash, createHmac } from 'node:crypto';
import { db, now, getMeta, setMeta } from '../db.js';
import { canonicalJson } from './mandate.js';
import type { AuditRecord, DecisionKind } from '../types.js';

const GENESIS = '0'.repeat(64);
const secret = () => process.env.MANDATE_SIGNING_SECRET ?? 'dev-only-mandate-signing-secret-change-me';

function hmac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function computeHash(seq: number, ts: string, kind: string, payload: string, prevHash: string): string {
  return createHash('sha256').update(`${prevHash}|${seq}|${ts}|${kind}|${payload}`).digest('hex');
}

export function appendAudit(input: {
  kind: AuditRecord['kind'];
  payload: Record<string, unknown>;
  actionId?: string | null;
  decision?: DecisionKind | null;
}): AuditRecord {
  const ts = now();
  const payloadJson = canonicalJson(input.payload);
  const last = db.prepare('SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string }
    | undefined;
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS;
  const hash = computeHash(seq, ts, input.kind, payloadJson, prevHash);
  const signedJws = `capped.${Buffer.from(JSON.stringify({ seq, ts, kind: input.kind, hash })).toString('base64url')}.${hmac(`${seq}.${ts}.${input.kind}.${hash}`)}`;

  db.prepare(
    'INSERT INTO audit (seq, ts, kind, actionId, decision, payload, prevHash, hash, jws) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(seq, ts, input.kind, input.actionId ?? null, input.decision ?? null, payloadJson, prevHash, hash, signedJws);

  return {
    seq,
    ts,
    kind: input.kind,
    actionId: input.actionId ?? null,
    decision: input.decision ?? null,
    payload: input.payload,
    prevHash,
    hash,
    signedJws,
  };
}

export function listAudit(limit = 200): AuditRecord[] {
  const rows = db
    .prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?')
    .all(limit) as Record<string, string | number | null>[];
  return rows.map(rowToRecord);
}

function rowToRecord(r: Record<string, string | number | null>): AuditRecord {
  return {
    seq: Number(r.seq),
    ts: String(r.ts),
    kind: String(r.kind) as AuditRecord['kind'],
    actionId: r.actionId == null ? null : String(r.actionId),
    decision: r.decision == null ? null : (String(r.decision) as DecisionKind),
    payload: JSON.parse(String(r.payload)),
    prevHash: String(r.prevHash),
    hash: String(r.hash),
    signedJws: String(r.jws),
  };
}

export function verifyChain(): { ok: boolean; count: number; brokenAt: number | null } {
  const rows = db.prepare('SELECT * FROM audit ORDER BY seq ASC').all() as Record<
    string,
    string | number | null
  >[];
  let prevHash = GENESIS;
  for (const r of rows) {
    const payloadJson = String(r.payload);
    const expected = computeHash(Number(r.seq), String(r.ts), String(r.kind), payloadJson, prevHash);
    if (r.prevHash !== prevHash || r.hash !== expected) {
      return { ok: false, count: rows.length, brokenAt: Number(r.seq) };
    }
    prevHash = String(r.hash);
  }
  return { ok: true, count: rows.length, brokenAt: null };
}

export function getRecord(seq: number): AuditRecord | undefined {
  const row = db.prepare('SELECT * FROM audit WHERE seq = ?').get(seq) as
    | Record<string, string | number | null>
    | undefined;
  return row ? rowToRecord(row) : undefined;
}

/** Signed mandate receipt for one record (FR-19) — a compact, verifiable artifact. */
export function exportReceipt(seq: number) {
  const rec = getRecord(seq);
  if (!rec) return null;
  return {
    type: 'MANDATE_RECEIPT',
    version: 1,
    issuedAt: now(),
    record: rec,
    chain: { prevHash: rec.prevHash, hash: rec.hash },
    // standalone HMAC over the record so the receipt verifies even detached from the log
    receiptSignature: hmac(`receipt.${rec.seq}.${rec.hash}`),
  };
}

export function verifyReceipt(receipt: { record: AuditRecord; receiptSignature: string }): boolean {
  const rec = receipt.record;
  return (
    hmac(`receipt.${rec.seq}.${rec.hash}`) === receipt.receiptSignature &&
    rec.hash === computeHash(rec.seq, rec.ts, rec.kind, canonicalJson(rec.payload), rec.prevHash)
  );
}

/** Money-out dollars moved today — owned by the engine, NEVER by the LLM. */
export function dailySpent(): number {
  const day = now().slice(0, 10);
  const clauses = ["kind = 'EXECUTION'", "json_extract(payload, '$.moneyOut') = 1", "ts LIKE ?"];
  const params: string[] = [`${day}%`];
  // operator reset (demo): only count executions since the reset marker when it is from today
  const resetAt = getMeta('cap_reset_at');
  if (resetAt && resetAt.slice(0, 10) === day) {
    clauses.push('ts >= ?');
    params.push(resetAt);
  }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(payload, '$.amount') AS REAL)), 0) AS total
       FROM audit WHERE ${clauses.join(' AND ')}`
    )
    .get(...params) as { total: number };
  return Math.round(row.total * 100) / 100;
}

/** Demo utility: zero the daily-cap counter (audited, does not touch history). */
export function resetDailyCap(): string {
  const ts = now();
  setMeta('cap_reset_at', ts);
  appendAudit({
    kind: 'SYSTEM',
    payload: { event: 'Daily-cap counter reset by operator (demo) — money-out counter back to $0 for today', resetAt: ts },
  });
  return ts;
}

export function recentPayouts10m(): number {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit
       WHERE kind = 'EXECUTION' AND ts >= ? AND json_extract(payload, '$.actionType') = 'payout'`
    )
    .get(since) as { n: number };
  return row.n;
}
