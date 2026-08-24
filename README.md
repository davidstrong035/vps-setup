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
