import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/api';

/** Subscribe to the approval/event SSE stream with graceful polling fallback. */
export function useSSE(onEvent: (type: string, data: any) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/approvals/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const types = [
      'hello', 'approval.created', 'approval.resolved', 'action.decision',
      'invoice.updated', 'payout.updated', 'agent.activity', 'system.halt', 'system.reset',
    ];
    const listeners: [string, (e: MessageEvent) => void][] = types.map((t) => [
      t,
      (e: MessageEvent) => {
        try {
          handler.current(t, JSON.parse(e.data));
        } catch {
          handler.current(t, e.data);
        }
      },
    ]);
    for (const [t, l] of listeners) es.addEventListener(t, l);
    return () => {
      for (const [t, l] of listeners) es.removeEventListener(t, l);
      es.close();
    };
  }, []);

  return { connected };
}
