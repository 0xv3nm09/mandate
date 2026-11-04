// Deterministic NL parser — the agent's fallback intelligence when no LLM key is configured.
// Same contract as the LLM loop: it can only PROPOSE; the control plane still decides everything.

export type ParsedIntent =
  | { kind: 'invoice'; payeeName: string; amount: number; memo: string }
  | { kind: 'payout'; payeeName: string; amount: number; note: string; standing: boolean }
  | { kind: 'reminder'; payeeName?: string }
  | { kind: 'listInvoices' }
  | { kind: 'auditQuestion'; question: string }
  | { kind: 'mandateChange'; text: string }
  | { kind: 'halt' }
  | { kind: 'resume' }
  | { kind: 'runStanding' }
  | { kind: 'simulatePaid'; payeeName?: string }
  | { kind: 'help' };

const AMT = String.raw`\$?\s*([\d][\d,]*(?:\.\d{1,2})?)`;

export function parse(text: string): ParsedIntent {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (/^(help|what can you do|commands)\b/i.test(lower)) return { kind: 'help' };

  if (/(stop all|halt|kill switch|emergency stop|freeze all)/i.test(lower)) return { kind: 'halt' };
  if (/(resume|unhalt|unfreeze|start again)/i.test(lower)) return { kind: 'resume' };
  if (/(run|execute)\s+(the\s+)?standing/i.test(lower) || /run now/i.test(lower)) return { kind: 'runStanding' };
  if (/simulate\s+(?:invoice\s+)?paid/i.test(lower)) {
    const name = t.match(/(?:paid|payment)\s+(?:from|by)\s+([A-Za-z][\w .&'-]*)/i)?.[1]?.trim();
    return { kind: 'simulatePaid', payeeName: name };
  }

  // UC-07 style: "cap daily at $1,000, never pay anyone new more than $50, pay vita $300 weekly"
  if (/(cap daily|daily cap|per[- ]transaction|per[- ]txn|allowlist|allow .+@|add .+@|pay .+ every week|pay .+ weekly|never pay anyone)/i.test(lower)) {
    return { kind: 'mandateChange', text: t };
  }

  if (/(why|what would|explain|audit|who did|how many|show me the trail)/i.test(lower) && !/invoice/i.test(lower)) {
    return { kind: 'auditQuestion', question: t };
  }

  // "Invoice Acme $1,200 for October design" / "bill acme 500 for logo work"
  const inv =
    t.match(new RegExp(String.raw`(?:invoice|bill|charge)\s+(?:the\s+)?(?:client\s+)?([A-Za-z][\w .&'-]*?)\s+(?:for\s+)?${AMT}(?:\s*(?:usd|dollars))?(?:\s+for\s+(.+))?$`, 'i')) ??
    t.match(new RegExp(String.raw`(?:invoice|bill|charge)\s+([A-Za-z][\w .&'-]*?)\s+(?:for|worth)\s+${AMT}(?:\s*(?:usd|dollars))?(?:\s+for\s+(.+))?$`, 'i'));
  if (inv) {
    const payeeName = inv[1].trim().replace(/\s+for$/, '');
    const amount = Number(inv[2].replace(/,/g, ''));
    const memoText = (inv[3] ?? 'Professional services').trim();
    return { kind: 'invoice', payeeName, amount, memo: memoText };
  }

  // "Pay contractor Sam $500" / "send $300 to vita"
  const pay1 = t.match(new RegExp(String.raw`pay\s+(?:the\s+)?(?:contractor\s+|freelancer\s+|va\s+|vendor\s+|invoice\s+)?([A-Za-z][\w .&'-]*?)\s+${AMT}`, 'i'));
  const pay2 = t.match(new RegExp(String.raw`send\s+${AMT}\s+(?:usd\s+)?to\s+([A-Za-z][\w .&'-]*)`, 'i'));
  if (pay1 || pay2) {
    const payeeName = (pay1 ? pay1[1] : pay2![2]).trim().replace(/\s+\$.*$/, '');
    const amount = Number((pay1 ? pay1[2] : pay2![1]).replace(/,/g, ''));
    const standing = /standing|weekly|recurring/i.test(lower);
    return { kind: 'payout', payeeName, amount, note: t, standing };
  }

  if (/(remind|chase|nudge|follow up|overdue|late payer)/i.test(lower)) {
    const name = t.match(/(?:remind|chase|nudge|follow up with)\s+(?:the\s+)?([A-Za-z][\w .&'-]*)/i)?.[1]?.trim();
    return { kind: 'reminder', payeeName: name };
  }

  if (/invoices?|money in|what.*sent|show.*billing/i.test(lower)) return { kind: 'listInvoices' };

  return { kind: 'help' };
}

/** Contact directory: friendly names → sandbox-style payee emails. Unknown names land at *.unverified.test. */
const CONTACTS: Record<string, { email: string; name: string }> = {
  acme: { email: 'acme@client.test', name: 'Acme Corp' },
  'acme corp': { email: 'acme@client.test', name: 'Acme Corp' },
  sam: { email: 'sam@contractor.test', name: 'Sam Rivera' },
  vita: { email: 'vita@va.test', name: 'Vita (VA)' },
  globex: { email: 'billing@globex.test', name: 'Globex' },
};

export function emailFor(name: string): { email: string; name: string } {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (CONTACTS[key]) return CONTACTS[key];
  const slug = key.replace(/[^a-z0-9]+/g, '');
  const known = Object.entries(CONTACTS).find(([k]) => k.includes(key) || key.includes(k));
  if (known) return known[1];
  return { email: `${slug || 'payee'}@unverified.test`, name: name.trim() };
}
