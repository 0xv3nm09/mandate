#!/usr/bin/env bash
# Mandate — deploy the full stack to a Vultr VM over SSH.
# Usage: bash scripts/vultr_deploy.sh [user@]<vm-ip> [hostname]
#   hostname defaults to the sslip.io wildcard name derived from the IP
#   (e.g. 203-0-113-10.sslip.io) — Caddy auto-provisions the Let's Encrypt cert.
# Pushes the CURRENT working tree (server + built console), your server/.env
# (sandbox credentials travel to your own VM over SSH), systemd service,
# Caddy auto-HTTPS and the firewall. Runbook: docs/DEPLOY-VULTR.md
set -euo pipefail

HOST="${1:?usage: vultr_deploy.sh [user@]<vm-ip> [hostname]}"
IP="${HOST##*@}"
HOSTNAME_ARG="${2:-$(echo "$IP" | tr '.' '-')}.sslip.io"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ syncing Mandate to $HOST (https://$HOSTNAME_ARG)"

tar czf /tmp/mandate-src.tgz \
  --exclude=node_modules --exclude=.git --exclude='.env' \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
  --exclude='web/dist' \
  -C "$ROOT" .
scp -q /tmp/mandate-src.tgz "$HOST:/tmp/mandate-src.tgz"
[ -f "$ROOT/server/.env" ] && scp -q "$ROOT/server/.env" "$HOST:/opt/mandate/server/.env" || true

ssh "$HOST" 'bash -s' -- "$HOSTNAME_ARG" <<'REMOTE'
set -euo pipefail
HN="$1"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y curl git caddy ufw
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

mkdir -p /opt/mandate
tar xzf /tmp/mandate-src.tgz -C /opt/mandate
cd /opt/mandate/web && npm install --no-audit --no-fund && npm run build
cd ../server && npm install --no-audit --no-fund
[ -f server/.env ] || cp server/.env.example server/.env

cat > /etc/systemd/system/mandate.service <<'UNIT'
[Unit]
Description=Mandate — trust layer for agentic money movement
After=network.target
[Service]
WorkingDirectory=/opt/mandate/server
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
Environment=PORT=8787
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now mandate

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

cat > /etc/caddy/Caddyfile <<CADDY
$HN.sslip.io {
    reverse_proxy localhost:8787
}
CADDY
systemctl enable --now caddy && systemctl reload caddy || systemctl restart caddy

echo "LIVE → https://$HN.sslip.io"
REMOTE

echo "→ deployed: https://$HOSTNAME_ARG   (webhook: https://$HOSTNAME_ARG/api/paypal/webhook)"
echo "→ fill /opt/mandate/server/.env on the VM with your PayPal sandbox keys, then: systemctl restart mandate"
