# VPS Disaster Recovery & Infrastructure as Code (IaC)

This repository contains the complete infrastructure definition, configuration files, application code, cron routines, and database backups required to fully reconstruct your VPS environment on a clean server in minutes.

---

## Repository Structure

```text
vps-setup/
├── apps/
│   └── mailef-backend/     # Node.js backend source code
├── configs/
│   ├── Caddyfile           # Reverse proxy configuration
│   ├── postal.yml          # Postal mail server configuration
│   ├── signing.key         # Fast signing key for Postal
│   ├── apps-map.json       # Router mapping configuration
│   ├── rotate-domains.sh   # Domain rotation script
│   └── router.js           # Central routing script
├── cron/
│   ├── staticroute         # Boot-time static route script (/etc/cron.d/staticroute)
│   └── root-crontab       # Backup of active crontab entries
├── database/
│   └── all_databases.sql  # Complete MariaDB database dump
├── auto-sync.sh            # Automated daily backup & GitHub push script
├── docker-compose.yml      # Container orchestration (MariaDB, Caddy, Postal)
├── restore.sh              # Single-command restoration script
└── README.md               # Disaster recovery documentation
```

---

## Complete Restoration Guide (New VPS)

### Step 1: Provision & Access Your Fresh VPS
1. Purchase/spin up a fresh Ubuntu or Debian server with root access.
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

*(Replace `<USERNAME>` and `<PAT_TOKEN>` with your GitHub credentials).*

### Step 3: Execute the Automated Restore
Run the master restoration script:

```bash
chmod +x restore.sh
./restore.sh
```

---

## What `restore.sh` Does Automatically

1. **Installs System Dependencies:** Updates `apt` repositories and installs `curl`, `git`, `ufw`, `jq`, Docker, Node.js, and PM2.
2. **Restores Configurations:** Copies Postal configs to `/opt/postal/` and boot routines to `/etc/cron.d/staticroute`.
3. **Restores Applications:** Deploys `mailer-backend` to `/opt/mailef-backend/` and installs production dependencies (`npm install --production`).
4. **Configures Firewall (UFW):** Sets default deny rules for incoming traffic and enables required ports:
   - `22/tcp` (OpenSSH)
   - `80/tcp` & `443/tcp` (Web / SSL certificates)
   - `25/tcp` & `587/tcp` (SMTP & Submission)
5. **Boots Docker Stack:** Starts MariaDB, Caddy, and Postal containers via `docker-compose.yml`.
6. **Restores Database:** Waits for MariaDB to become active and imports `database/all_databases.sql`.
7. **Launches PM2 Applications:** Starts `mailer-backend` and `central-router`, saves process list (`pm2 save`), and enables systemd auto-start on boot.

---

## Verification & Health Checks

After `restore.sh` finishes execution, verify system integrity using these commands:

### 1. Verify Docker Services
```bash
docker ps -a
```
*Expected Output:* Three containers (`postal-mariadb`, `postal-caddy`, `postal`) showing status **Up**.

### 2. Verify PM2 Services
```bash
pm2 list
```
*Expected Output:* `mailer-backend` and `central-router` showing status **online**.

### 3. Verify Firewall Configuration
```bash
ufw status verbose
```
*Expected Output:* Status `active` with ports 22, 80, 443, 25, and 587 allowed.

---

## Automated Backup System (`auto-sync.sh`)

This setup includes an automated daily backup script that extracts latest configurations, dumps MariaDB state, and commits changes back to GitHub.

### Manual Backup Run
To trigger an immediate state sync:
```bash
/root/vps-setup/auto-sync.sh
```

### Cron Schedule
The backup job is configured in root's crontab to execute every night at 2:00 AM:
```cron
0 2 * * * /bin/bash /root/vps-setup/auto-sync.sh >> /var/log/vps-backup.log 2>&1
```

### Inspecting Backup Logs
Check execution output or troubleshoot issues:
```bash
cat /var/log/vps-backup.log
```
