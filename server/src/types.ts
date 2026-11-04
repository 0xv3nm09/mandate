// Shared types for the Mandate control plane.
// The policy engine, mandate store and audit log are DETERMINISTIC — no LLM in this file's call paths.

export type ActionType = 'invoice' | 'payout' | 'refund';
export type DecisionKind = 'ALLOW' | 'GATE' | 'BLOCK';

export interface ProposedAction {
  type: ActionType;
  amount: number;
  currency: string; // ISO 4217
  payee: string;    // email or payee identifier
  payeeName?: string;
  memo: string;
  /** present when the action claims to run under the standing mandate (UC-08) */
  standing?: boolean;
}

export interface PolicyHit {
  rule: string;   // stable rule id, e.g. R-02
  detail: string; // human-readable
}

export interface Decision {
  decision: DecisionKind;
  reasonCode: string;
  reasonText: string;
  policyHits: PolicyHit[];
  mandateVersion: number;
}

export interface StandingMandate {
  payee: string;
  payeeName: string;
  amount: number;
  currency: string;
  cadence: 'weekly';
  note: string;
}

export interface IntentMandate {
  version: number;
  limits: { perTxn: number; dailyTotal: number; currency: string };
  payeeAllowlist: string[];
  standing: StandingMandate | null;
  issuedAt: string;
  /** human-readable restatement of the active rules (display only — the engine is code) */
  summary: string[];
}

export interface PolicyContext {
  dailySpent: number;
  recentPayouts10m: number;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
export type ActionStatus =
  | 'PROPOSED' | 'ALLOWED' | 'AWAIT_APPROVAL' | 'APPROVED' | 'DENIED'
  | 'BLOCKED' | 'HALTED' | 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'EXPIRED';

export type Verdict = 'VERIFIED' | 'SUSPICIOUS' | 'IMPOSTOR' | 'UNVERIFIED';

export interface VerificationCheck {
  name: string;
  pass: boolean | null; // null = informational
  detail: string;
}

export interface InboundClaim {
  brand: string;
  from: string;
  fromName?: string;
  amount: number;
  currency: string;
  memo: string;
  channel: 'email' | 'invoice' | 'message';
}

export interface VerificationResult {
  verdict: Verdict;
  reasonCode: string;
  reasonText: string;
  checks: VerificationCheck[];
}

export interface VerificationRecord extends VerificationResult {
  id: string;
  claim: InboundClaim;
  jws: string;
  createdAt: string;
}

export interface AuditRecord {
  seq: number;
  ts: string;
  kind: 'ACTION_DECISION' | 'EXECUTION' | 'APPROVAL' | 'MANDATE_SIGNED' | 'WEBHOOK' | 'SYSTEM' | 'VERIFICATION';
  actionId: string | null;
  decision: DecisionKind | null;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  signedJws: string;
}

export interface TraceStep {
  n: number;
  label: string;
  detail: string;
  status: 'ok' | 'gate' | 'block' | 'info' | 'error';
  data?: Record<string, unknown>;
}

export interface UsecaseResult {
  id: string;
  runId: string;
  title: string;
  outcome: 'ok' | 'gate' | 'block' | 'error';
  headline: string;
  steps: TraceStep[];
  auditSeqs: number[];
  ranAt: string;
  durationMs: number;
}

export interface RunSummary {
  runId: string;
  ucId: string;
  ucTitle: string;
  outcome: 'ok' | 'gate' | 'block' | 'error';
  headline: string;
  stepsCount: number;
  auditSeqs: number[];
  ranAt: string;
  durationMs: number;
}
