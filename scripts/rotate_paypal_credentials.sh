#!/usr/bin/env bash
# Rotate PayPal REST credentials across local .env AND the deployed VM in one step.
#
# Usage:
#   bash scripts/rotate_paypal_credentials.sh '<NEW_CLIENT_ID>' '<NEW_SECRET>' [user@vm-host]
#
# Generate the new secret first (developer.paypal.com → Apps & Credentials → Sandbox →
# your app → Generate) — PayPal revokes the old secret the moment you do, so run this
# immediately after. The values are passed as arguments and are never echoed or committed.
set -euo pipefail

NEW_ID="${1:?usage: rotate_paypal_credentials.sh '<NEW_CLIENT_ID>' '<NEW_SECRET>' [user@vm-host]}"
NEW_SECRET="${2:?usage: rotate_paypal_credentials.sh '<NEW_CLIENT_ID>' '<NEW_SECRET>' [user@vm-host]}"
HOST="${3:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

upsert() { # upsert <file> <KEY> <VALUE>
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

oauth_ok() { # oauth_ok <id> <secret> → prints "ok" or "bad"
  node -e "
    const [id, s] = process.argv.slice(1);
    fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + s).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }).then(r => { console.log(r.status === 200 ? 'ok' : 'bad'); process.exit(r.status === 200 ? 0 : 1); }).catch(() => { console.log('bad'); process.exit(1); });
  " "$NEW_ID" "$NEW_SECRET"
}

echo -n "→ new credentials live OAuth probe (before touching any file): "
OAUTH=$(oauth_ok "$NEW_ID" "$NEW_SECRET" || true)
echo "$OAUTH"
if [ "$OAUTH" != "ok" ]; then
  echo "  ✗ PayPal rejected the new credentials — nothing was changed; check for a typo."
  exit 1
fi

echo "→ local server/.env"
upsert "$ROOT/server/.env" PAYPAL_CLIENT_ID "$NEW_ID"
upsert "$ROOT/server/.env" PAYPAL_CLIENT_SECRET "$NEW_SECRET"

if [ -n "$HOST" ]; then
  echo "→ VM $HOST"
  scp -q "$ROOT/server/.env" "$HOST:/opt/mandate/server/.env"
  ssh "$HOST" 'systemctl restart mandate; for i in $(seq 1 10); do sleep 2; c=$(curl -s -m 4 -o /dev/null -w "%{http_code}" http://localhost:8787/api/health); [ "$c" = "200" ] && break; done; echo "  service: $(systemctl is-active mandate) · health HTTP $c"; curl -s http://localhost:8787/api/health'
else
  echo "→ (no VM host given — local only; run again with the host to update the VM)"
fi

echo "✓ rotation complete (secret stored only in the two .env files, both gitignored)"
