// Official @paypal/agent-toolkit integration — READ-ONLY surface only.
// Governance rule: the toolkit's eyes (list/get invoices + disputes) may go straight
// to the model because they move no money; every money-moving operation still runs
// exclusively through the deterministic control plane (see controlPlane.ts).
// Loaded dynamically + guarded: the app runs fully without keys or without the package.

import { env } from '../env.js';

interface ToolkitState {
  available: boolean;
  reason?: string;
  tools: Record<string, unknown>;
  toolNames: string[];
}

let cached: ToolkitState | null = null;

export async function readOnlyToolkitTools(): Promise<Record<string, unknown>> {
  const state = await load();
  return state.tools;
}

export function toolkitStatus(): ToolkitState {
  return cached ?? { available: false, reason: 'not loaded (loads on first agent call)', tools: {}, toolNames: [] };
}

async function load(): Promise<ToolkitState> {
  if (cached) return cached;
  if (!env.paypal.clientId || !env.paypal.clientSecret) {
    cached = { available: false, reason: 'PAYPAL_CLIENT_ID/SECRET not set — toolkit activates in SANDBOX mode', tools: {}, toolNames: [] };
    return cached;
  }
  try {
    const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/ai-sdk');
    const toolkit = new PayPalAgentToolkit({
      clientId: env.paypal.clientId,
      clientSecret: env.paypal.clientSecret,
      configuration: {
        actions: {
          invoices: { list: true, get: true },
          disputes: { list: true, get: true },
        },
        context: { sandbox: true },
      },
    });
    const all = toolkit.getTools() as Record<string, unknown>;
    const tools = Object.fromEntries(Object.entries(all).filter(([name]) => /^(list|get)_/.test(name)));
    cached = { available: true, tools, toolNames: Object.keys(tools) };
    console.log(`[toolkit] official @paypal/agent-toolkit attached (read-only): ${cached.toolNames.join(', ')}`);
  } catch (e) {
    cached = { available: false, reason: String(e), tools: {}, toolNames: [] };
  }
  return cached;
}
