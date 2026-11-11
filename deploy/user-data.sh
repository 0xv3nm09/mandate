#!/bin/bash
# Vultr "User data" (cloud-init) — paste this into the Vultr VM-creation form
# (Advanced options → User data) and the VM self-installs everything on first boot:
# Node 24 + the app + systemd service + Caddy auto-HTTPS via sslip.io + firewall.
#
# NOTE: it clones github.com/0xv3nm09/mandate — flip the repo public first (you
# will for submission), or replace the clone URL with a read-only token URL:
#   https://<token>@github.com/0xv3nm09/mandate.git
#
# After first boot: https://<vm-ip-with-dashes>.sslip.io
# Then ssh in and fill /opt/mandate/server/.env with your PayPal sandbox keys:
#   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_SANDBOX_RECIPIENT
# and: systemctl restart mandate

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y curl git caddy ufw
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

mkdir -p /opt/mandate
cd /opt/mandate
if [ -d .git ]; then git pull; else git clone https://github.com/0xv3nm09/mandate.git .; fi
cd web && npm install --no-audit --no-fund && npm run build
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
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now mandate

IP=$(curl -s https://api.ipify.org || curl -s http://v4.ident.me)
HN=$(echo "$IP" | tr '.' '-')

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

cat > /etc/caddy/Caddyfile <<CADDY
$HN.sslip.io {
    reverse_proxy localhost:8787
}
CADDY
systemctl enable --now caddy && systemctl reload caddy || systemctl restart caddy

echo "LIVE → https://$HN.sslip.io  ·  fill /opt/mandate/server/.env with PayPal sandbox keys, then: systemctl restart mandate"
