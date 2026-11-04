import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env.js';

mkdirSync(dirname(env.dbPath), { recursive: true });
export const db = new DatabaseSync(env.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS mandates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  jws TEXT NOT NULL,
  json TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  payee TEXT NOT NULL,
  payeeName TEXT,
  memo TEXT NOT NULL DEFAULT '',
  decision TEXT,
  reasonCode TEXT,
  status TEXT NOT NULL,
  paypalRef TEXT,
  mandateVersion INTEGER,
  source TEXT NOT NULL DEFAULT 'chat',
  standing INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  actionId TEXT,
  decision TEXT,
  payload TEXT NOT NULL,
  prevHash TEXT NOT NULL,
  hash TEXT NOT NULL,
  jws TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  actionId TEXT NOT NULL,
  status TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  policyJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  resolvedAt TEXT,
  resolvedBy TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  paypalId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL,
  payee TEXT NOT NULL,
  payeeName TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  dueDate TEXT,
  remindersSent INTEGER NOT NULL DEFAULT 0,
  lastReminderAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  actionId TEXT NOT NULL,
  batchId TEXT NOT NULL,
  status TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  payee TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  runId TEXT PRIMARY KEY,
  ucId TEXT NOT NULL,
  ucTitle TEXT NOT NULL,
  outcome TEXT NOT NULL,
  headline TEXT NOT NULL,
  stepsCount INTEGER NOT NULL,
  auditSeqs TEXT NOT NULL,
  trace TEXT NOT NULL,
  ranAt TEXT NOT NULL,
  durationMs INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  claim TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reasonCode TEXT NOT NULL,
  reasonText TEXT,
  checksJson TEXT NOT NULL,
  jws TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
