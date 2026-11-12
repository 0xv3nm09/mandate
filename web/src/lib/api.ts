// Shared API types (mirror of server/src/types.ts, client-side subset)

export type DecisionKind = 'ALLOW' | 'GATE' | 'BLOCK';

export interface Decision {
  decision: DecisionKind;
  reasonCode: string;
  reasonText: string;
  policyHits: { rule: string; detail: string }[];
  mandateVersion: number;
}

export interface Approval {
  id: string;
  actionId: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  explanation: string;
  policyJson: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface AuditRecord {
  seq: number;
  ts: string;
  kind: string;
  actionId: string | null;
  decision: DecisionKind | null;
  payload: Record<string, any>;
  prevHash: string;
  hash: string;
  signedJws: string;
}

export interface Mandate {
  version: number;
  limits: { perTxn: number; dailyTotal: number; currency: string };
  payeeAllowlist: string[];
  standing: { payee: string; payeeName: string; amount: number; currency: string; cadence: string; note: string } | null;
  issuedAt: string;
  summary: string[];
}

export interface Invoice {
  id: string; paypalId: string; invoiceNumber: string; payee: string; payeeName: string | null;
  amount: number; currency: string; memo: string; status: string; dueDate: string | null;
  remindersSent: number; lastReminderAt: string | null; createdAt: string; updatedAt: string;
}

export interface ChatReply {
  reply: string;
  actions: { actionId: string; kind: string; status: string; decision: Decision | null; approvalId?: string; explanation?: string; execution?: { paypalRef: string; status: string } | null }[];
  ui: Record<string, any>;
  mode: 'LLM' | 'DETERMINISTIC';
}

export interface TraceStep {
  n: number;
  label: string;
  detail: string;
  status: 'ok' | 'gate' | 'block' | 'info' | 'error';
  data?: Record<string, any>;
}

export interface UsecaseResult {
  id: string;
  runId?: string;
  title: string;
  outcome: 'ok' | 'gate' | 'block' | 'error';
  headline: string;
  steps: TraceStep[];
  auditSeqs: number[];
  ranAt: string;
  durationMs: number;
}

export interface CatalogEntry {
  id: string;
  title: string;
  headline: string;
  outcome: string;
  frs: string[];
  decisions: string[];
  detail: string;
  kind: string;
}

export type Verdict = 'VERIFIED' | 'SUSPICIOUS' | 'IMPOSTOR' | 'UNVERIFIED';

export interface VerificationCheck {
  name: string;
  pass: boolean | null;
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

export interface VerificationRecord {
  id: string;
  claim: InboundClaim;
  verdict: Verdict;
  reasonCode: string;
  reasonText: string;
  checks: VerificationCheck[];
  jws: string;
  createdAt: string;
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

export interface RunRecord extends RunSummary {
  steps: TraceStep[];
}

export interface Stats {
  auditRecords: number;
  governed: number;
  /** executions with no human approval (invoices + in-bounds/standing money-out) */
  allowed: number;
  /** executions that happened only after a human tap */
  approved: number;
  /** actions that passed through the approval queue (gated, approved, denied, expired) */
  gated: number;
  blocked: number;
  moneyOut: number;
  moneyIn: number;
  haltFlag: boolean;
}

// API base: same-origin by default; when the web build is hosted statically
// (e.g. GitHub Pages), set VITE_API_BASE to the backend URL at build time.
// With no backend reachable, GETs fall back to the committed read-only snapshot
// (web/public/demo/mandate-snapshot.json) — the airlock-style Pages site.
export const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? '';

let snapshotData: any = null;
let snapshotReady = false;
export let snapshotMode = false;
const snapshotListeners: (() => void)[] = [];
export function isSnapshotMode() {
  return snapshotMode;
}
export function onSnapshotMode(cb: () => void) {
  snapshotListeners.push(cb);
  if (snapshotMode) cb();
}
const forceSnapshot = new URLSearchParams(location.search).has('snapshot') || location.hostname.endsWith('github.io');
if (forceSnapshot) { loadSnapshot(); }

async function loadSnapshot(): Promise<any> {
  if (snapshotReady) return snapshotData;
  const res = await fetch(`${import.meta.env.BASE_URL}demo/mandate-snapshot.json`);
  snapshotData = await res.json();
  snapshotReady = true;
  snapshotMode = true;
  snapshotListeners.forEach((cb) => cb());
  return snapshotData;
}

function fromSnapshot(path: string, snap: any): unknown | undefined {
  const p = path.split('?')[0];
  const exact: Record<string, string> = {
    '/runs': 'runs', '/stats': 'stats', '/mandate': 'mandate', '/verifications': 'verifications',
    '/audit': 'audit', '/approvals': 'approvals', '/invoices': 'invoices', '/health': 'health',
    '/usecases': 'catalog',
  };
  if (exact[p]) return snap[exact[p]];
  if (p.startsWith('/runs/')) return snap.runsFull?.[p.slice('/runs/'.length)];
  const receipt = p.match(/^\/audit\/(\d+)\/receipt$/);
  if (receipt) return snap.receipts?.[receipt[1]];
  if (p === '/paypal/toolkit') return { available: false, reason: 'read-only snapshot' };
  return undefined;
}

export async function api<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const isGet = !init?.method || init.method === 'GET';
  const token = localStorage.getItem('mandate_token') ?? '';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-mandate-token': token } : {}),
      },
      ...init,
    });
  } catch (netErr) {
    // Static host with no backend: serve reads from the committed snapshot.
    if (isGet) {
      const snap = await loadSnapshot();
      const v = fromSnapshot(path, snap);
      if (v !== undefined) return v as T;
    }
    throw netErr instanceof Error ? netErr : new Error('network error');
  }
  // Static host 404 (GitHub Pages serves an HTML 404 page for /api/*): same fallback.
  const ct = res.headers.get('content-type') ?? '';
  if (isGet && (res.status === 404 || ct.includes('text/html'))) {
    const snap = await loadSnapshot();
    const v = fromSnapshot(path, snap);
    if (v !== undefined) return v as T;
  }
  // Locked deployments (MANDATE_ADMIN_TOKEN set): prompt once, remember, retry.
  // Public demo builds embed the demo token (VITE_DEMO_TOKEN) so the prompt arrives
  // pre-filled — the guard is experienced, not fought with.
  if (res.status === 401 && res.headers.get('X-Mandate-Token-Required') && !retried) {
    const demoToken = (import.meta.env.VITE_DEMO_TOKEN as string | undefined) ?? '';
    const t = window.prompt(
      `This Mandate deployment requires the admin token${demoToken ? ' — public demo instance, token pre-filled:' : ' — the public demo instance publishes its token in the repo README ("See it two ways"):'}`,
      demoToken,
    );
    if (t != null && t.trim()) {
      localStorage.setItem('mandate_token', t.trim());
      return api<T>(path, init, true);
    }
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Mutating calls are impossible on the read-only snapshot — surfaces a clear message.
export function assertNotSnapshot(): void {
  if (snapshotMode) throw new Error('read-only snapshot (GitHub Pages) — run the app locally or on the hosted backend to execute use cases');
}

export const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

export const shortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour12: false });

export const shortHash = (h: string, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : '—');
