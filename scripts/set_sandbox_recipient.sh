#!/usr/bin/env bash
# Set PAYPAL_SANDBOX_RECIPIENT (the sandbox PERSONAL account email invoices/payouts route to)
# across local .env AND the deployed VM, restart, and verify a real invoice send.
#
# Usage:
#   bash scripts/set_sandbox_recipient.sh 'sb-xxxxxxxx@personal.example.com' [user@vm-host]
#
# Find the email: developer.paypal.com → Sandbox → Accounts → the account of type
# "Personal" → its email address. It is a test recipient, not a secret — but it only
# works if it belongs to a real sandbox account (placeholder emails 422 USER_NOT_FOUND).
set -euo pipefail

EMAIL="${1:?usage: set_sandbox_recipient.sh 'sb-…@personal.example.com' [user@vm-host]}"
HOST="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

upsert() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

echo "→ local server/.env"
upsert "$ROOT/server/.env" PAYPAL_SANDBOX_RECIPIENT "$EMAIL"

if [ -n "$HOST" ]; then
  echo "→ VM $HOST"
  scp -q "$ROOT/server/.env" "$HOST:/opt/mandate/server/.env"
  ssh "$HOST" 'systemctl restart mandate; for i in $(seq 1 10); do sleep 2; c=$(curl -s -m 4 -o /dev/null -w "%{http_code}" http://localhost:8787/api/health); [ "$c" = "200" ] && break; done; echo "  service: $(systemctl is-active mandate) · health HTTP $c"'
  echo "→ verifying with a real invoice send (UC-01)…"
  TOKEN=$(ssh "$HOST" 'grep MANDATE_ADMIN_TOKEN /opt/mandate/server/.env | cut -d= -f2 | tr -d "\""')
  RES=$(ssh "$HOST" "curl -s -m 60 -X POST http://localhost:8787/api/usecases/UC-01/run -H 'x-mandate-token: $TOKEN' -H 'Content-Type: application/json' -d '{}'")
  echo "$RES" | node -e "
    let s=''; process.stdin.on('data', d => s += d).on('end', () => {
      const d = JSON.parse(s);
      console.log('  UC-01 outcome:', d.outcome, '|', (d.headline || '').slice(0, 120));
      const sent = (d.steps || []).some(st => /sent to/i.test(st.label + ' ' + st.detail));
      console.log(sent ? '  ✓ invoice SENT to the sandbox personal account' : '  ⚠ send still pending — check the headline above');
    });"
else
  echo "→ (no VM host given — local only; run again with the host to update the VM)"
fi
echo "✓ done — invoices now route to $EMAIL (the ledger still records the logical payee)"
