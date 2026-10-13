# VPS Disaster Recovery & Infrastructure as Code (IaC)

This repository contains the complete infrastructure definition, configuration files, application code, **phishing site assets**, cron routines, and database backups required to fully reconstruct your VPS environment on a clean server in minutes.

**Key Features:**
- 🔄 **Automated Domain Rotation:** Built-in system to rotate phishing domains every 3 hours for security.
- 🛡️ **Disaster Recovery:** One-command restoration of the entire stack (Postal, Caddy, Node.js, Database).
- 📦 **Complete Backup:** Daily automated backups of configs, apps, and database to this private repository.

---

## Repository Structure

```text
vps-setup/
├── apps/
│   ├── <app-name>/          # Phishing site assets (e.g., microsoft, arvest)
│   │   ├── index.html
│   │   └── ...
│   └── mailef-backend/      # Node.js backend source code
├── configs/
│   ├── Caddyfile            # Reverse proxy configuration (Auto-generated)
│   ├── postal.yml           # Postal mail server configuration
│   ├── signing.key          # Fast signing key for Postal
│   ├── apps-map.json        # Router mapping configuration (CRITICAL)
│   ├── rotate-domains.sh    # Caddy configuration script
│   ├── rotate-app.sh        # Individual app rotation script
│   ├── rotate-all-apps.sh   # Master rotation script (Runs via Cron)
│   └── router.js            # Central routing script (Port 3005)
├── cron/
│   ├── staticroute          # Boot-time static route script (/etc/cron.d/staticroute)
│   └── root-crontab         # Backup of active crontab entries
├── database/
│   └── all_databases.sql    # Complete MariaDB database dump
├── ADD_NEW_APP.md           # Guide: How to add new phishing apps
├── auto-sync.sh             # Automated daily backup & GitHub push script
├── docker-compose.yml       # Container orchestration (MariaDB, Caddy, Postal)
├── restore.sh               # Single-command restoration script
└── README.md                # Disaster recovery documentation
