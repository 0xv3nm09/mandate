# Deploy to Vultr — runbook (full stack on one VM, with HTTPS)

One Ubuntu VM runs the entire product — API + built console from a single Node process,
systemd-managed, behind **Caddy auto-HTTPS**. Target spend: a **$6–12/mo** Cloud Compute
instance from your credit. Everything except VM creation is scripted.

> **HTTPS fact first:** Let's Encrypt only issues certs for hostnames, not bare IPs. The
> path below gets a hostname for free via **sslip.io** — `203-0-113-10.sslip.io` resolves to
> your IP, which is enough for Caddy to auto-provision the cert. Own a domain? Same steps,
> nicer URL.

## 1. Create the VM (console, ~2 min)

my.vultr.com → **Deploy → Cloud Compute → Shared CPU** → Ubuntu 22.04/24.04 LTS → 1 vCPU /
1 GB+ ($6/mo) → add your SSH key → Deploy → note the IPv4.

### Option A — paste-and-forget (cloud-init user data)

At VM creation → **Advanced options → User data** → paste
[`deploy/user-data.sh`](../deploy/user-data.sh). First boot self-installs Node 24, the app,
systemd, Caddy + sslip.io HTTPS and the firewall. Needs the repo public (you'll flip it for
submission) or a token-prefixed clone URL in the script.

### Option B — one-command deploy from your machine (works with the private repo)

```bash
cd mandate
bash scripts/vultr_deploy.sh root@<VM-IP>
```

Pushes the current tree (code + console build inputs + your `server/.env` sandbox keys,
over SSH to your own VM), installs Node 24 + Caddy, systemd service, firewall — and prints:

```
LIVE → https://203-0-113-10.sslip.io
```

(Caddy fetches the Let's Encrypt cert on first request; ports **80 + 443** must be open —
the script opens them in ufw; also allow TCP 80/443 in the Vultr firewall group if you use one.)

## 2. Wire in the sandbox credentials

```bash
ssh root@<VM-IP>
vi /opt/mandate/server/.env    # PAYPAL_CLIENT_ID/SECRET, PAYPAL_SANDBOX_RECIPIENT,
                               # PAYPAL_INVOICER_NAME/EMAIL, MANDATE_SIGNING_SECRET,
                               # MANDATE_ADMIN_TOKEN (recommended on a public URL),
                               # PUBLIC_BASE_URL=https://<your-host>.sslip.io
systemctl restart mandate
```

`PUBLIC_BASE_URL` makes the server **self-register its PayPal webhook at boot**
(`/v1/notifications/webhooks` — adopt-or-create, six payout/invoice event types) and verify
every inbound event with `verify-webhook-signature`; boot-time reconciliation then settles any
payout rows a delivery missed from PayPal's live batch status. `PAYPAL_WEBHOOK_ID` becomes
optional. Full details: [docs/PAYPAL.md §4](PAYPAL.md).

## 3. Verify

```bash
curl https://<your-host>.sslip.io/api/health      # {"ok":true,"mode":{"paypal":"SANDBOX",…}}
curl https://<your-host>.sslip.io/api/audit/verify
open https://<your-host>.sslip.io/#usecases       # Run all 12 — real batches, real invoices
```

**PayPal webhooks** then work against the VM with zero dashboard steps: with `PUBLIC_BASE_URL`
set, boot self-registers the listener at `https://<your-host>.sslip.io/api/paypal/webhook`
(adopt-or-create — restarts never duplicate it) and every inbound event is signature-verified
and deduped. `simulate-event` remains a one-call demo trigger.

## 4. Pair the GitHub Pages snapshot site (optional)

Rebuild web with `VITE_API_BASE=https://<your-host>.sslip.io`, push, and set the VM's
`ALLOWED_ORIGINS=https://0xv3nm09.github.io` — the read-only Pages site turns into a live
remote-control for this VM (admin token still guards mutations).

## 5. Cost & teardown

- VM runs 24/7 off the $100 credit; destroy it after judging to stop billing.
- Ledger backup: `scp root@<VM-IP>:/opt/mandate/server/../mandate.db .` (one file — SQLite).
