// Approval queue + SSE event bus. Gated actions wait here for a human decision;
// approvals expire; the global kill switch freezes resolution. (FR-07/10/15)

import { db, now, uid, getMeta, setMeta } from '../db.js';
import { appendAudit } from './audit.js';
import type { ApprovalStatus, Decision } from '../types.js';

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

// ── SSE bus ───────────────────────────────────────────────────────────────────
type BusEvent = { type: string; data: unknown; ts: string };
type Listener = (e: BusEvent) => void;
const listeners = new Set<Listener>();

export function publish(type: string, data: unknown): void {
  const e: BusEvent = { type, data, ts: now() };
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* a dead subscriber must never break the money path */
    }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ── Kill switch (FR-15) ──────────────────────────────────────────────────────
export function isHalted(): boolean {
  return getMeta('halted') === '1';
}
export function setHalted(halt: boolean): void {
  setMeta('halted', halt ? '1' : '0');
  publish('system.halt', { halted: halt });
}

// ── Queue ────────────────────────────────────────────────────────────────────
export interface ApprovalRow {
  id: string;
  actionId: string;
  status: ApprovalStatus;
  explanation: string;
  policyJson: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export function enqueueApproval(actionId: string, decision: Decision, explanation: string): ApprovalRow {
  const row: ApprovalRow = {
    id: uid(),
    actionId,
    status: 'PENDING',
    explanation,
    policyJson: JSON.stringify(decision),
    createdAt: now(),
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };
  db.prepare(
    'INSERT INTO approvals (id, actionId, status, explanation, policyJson, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(row.id, row.actionId, row.status, row.explanation, row.policyJson, row.createdAt, row.expiresAt);
  publish('approval.created', { approvalId: row.id, actionId });
  return row;
}

function expireStale(): void {
  const stale = db
    .prepare(`SELECT id, actionId FROM approvals WHERE status = 'PENDING' AND expiresAt < ?`)
    .all(now()) as { id: string; actionId: string }[];
  for (const s of stale) {
    db.prepare(`UPDATE approvals SET status = 'EXPIRED', resolvedAt = ?, resolvedBy = 'ttl' WHERE id = ?`).run(
      now(),
      s.id
    );
    db.prepare(`UPDATE actions SET status = 'EXPIRED', updatedAt = ? WHERE id = ?`).run(now(), s.actionId);
    publish('approval.resolved', { approvalId: s.id, actionId: s.actionId, status: 'EXPIRED' });
  }
}

export function listApprovals(status?: ApprovalStatus): ApprovalRow[] {
  expireStale();
  const rows = (
    status
      ? db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY createdAt DESC').all(status)
      : db.prepare('SELECT * FROM approvals ORDER BY createdAt DESC LIMIT 100').all()
  ) as unknown as ApprovalRow[];
  return rows;
}

export function getApproval(id: string): ApprovalRow | undefined {
  return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
}

export function resolveApproval(
  id: string,
  verdict: 'APPROVE' | 'DENY',
  by: string
): { ok: boolean; status?: ApprovalStatus; error?: string; approval?: ApprovalRow } {
  expireStale();
  const row = getApproval(id);
  if (!row) return { ok: false, error: 'unknown approval id' };
  if (row.status !== 'PENDING') return { ok: false, error: `already ${row.status}`, status: row.status };
  if (isHalted()) return { ok: false, error: 'global stop engaged — approvals are frozen (FR-15)' };

  const status: ApprovalStatus = verdict === 'APPROVE' ? 'APPROVED' : 'DENIED';
  db.prepare('UPDATE approvals SET status = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ?').run(
    status,
    now(),
    by,
    id
  );
  appendAudit({
    kind: 'APPROVAL',
    actionId: row.actionId,
    payload: {
      event: `Human ${verdict === 'APPROVE' ? 'approved' : 'denied'} gated action`,
      approvalId: id,
      verdict: status,
      by,
    },
  });
  publish('approval.resolved', { approvalId: id, actionId: row.actionId, status });
  return { ok: true, status, approval: { ...row, status, resolvedAt: now(), resolvedBy: by } };
}
