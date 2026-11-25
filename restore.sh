#!/bin/bash
set -e

# restore.sh - Restore custom content to a fresh VPS.
# Run this AFTER install.sh and deploy.sh have completed.
#
# Usage:
#   ./restore.sh /path/to/mass-mailer-backup-XXXX.tar.gz

if [ -z "$1" ]; then
    echo "Usage: $0 <backup-tarball>"
    echo "  e.g. $0 /opt/backups/mass-mailer-backup-2026-11-24.tar.gz"
    exit 1
fi

BACKUP_FILE="$1"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

if [ ! -f "$BACKUP_FILE" ]; then
    echo "[$TIMESTAMP] ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "[$TIMESTAMP] Restoring from: $BACKUP_FILE"

# ─── Step 1: Restore rotation system ───────────────────────
echo "[$TIMESTAMP] Restoring rotation scripts and apps-map.json..."
mkdir -p /opt/mass-mailer/rotation
tar -xzf "$BACKUP_FILE" -C / \
    --strip-components=3 \
    "opt/mass-mailer/rotation/"
chmod +x /opt/mass-mailer/rotation/*.sh

# ─── Step 2: Restore app files to mass-mailer ──────────────
echo "[$TIMESTAMP] Restoring app files to /opt/mass-mailer/apps/..."
rm -rf /opt/mass-mailer/apps
tar -xzf "$BACKUP_FILE" -C / \
    --strip-components=3 \
    "opt/mass-mailer/apps/"

# ─── Step 3: Restore app files to caddy-data ───────────────
echo "[$TIMESTAMP] Restoring app files to /opt/postal/caddy-data/apps/..."
rm -rf /opt/postal/caddy-data/apps
tar -xzf "$BACKUP_FILE" -C / \
    --strip-components=4 \
    "opt/postal/caddy-data/apps/"

# ─── Step 4: Regenerate Caddyfile & reload ─────────────────
echo "[$TIMESTAMP] Regenerating Caddyfile and reloading Caddy..."
if [ -f /opt/mass-mailer/rotation/rotate-domains.sh ]; then
    /opt/mass-mailer/rotation/rotate-domains.sh
    echo "[$TIMESTAMP] Caddy reloaded."
fi

# ─── Step 5: Restore cron jobs ─────────────────────────────
echo "[$TIMESTAMP] Restoring cron jobs..."
crontab -l 2>/dev/null | grep -q "rotate-all-apps.sh" || {
    (crontab -l 2>/dev/null; echo "0 */3 * * * /opt/mass-mailer/rotation/rotate-all-apps.sh >> /var/log/domain-rotation.log 2>&1") | crontab -
}
crontab -l 2>/dev/null | grep -q "backup.sh" || {
    (crontab -l 2>/dev/null; echo "0 2 * * * /opt/mass-mailer/rotation/backup.sh >> /var/log/vps-backup.log 2>&1") | crontab -
}

echo ""
echo "[$TIMESTAMP] Restore complete!"
echo "  - Rotation:  /opt/mass-mailer/rotation/"
echo "  - Apps:      /opt/mass-mailer/apps/"
echo "  - Caddy:     /opt/postal/caddy-data/apps/"
echo ""
echo "Verify: curl -I https://app-<ID>.sslip.io"