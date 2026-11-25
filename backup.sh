#!/bin/bash
# backup.sh - Simple backup of custom content only.
# Run manually:  /root/vps-setup/backup.sh
# Runs via cron: 0 2 * * * /root/vps-setup/backup.sh

set -e

BACKUP_DIR="/opt/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/mass-mailer-backup-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "[$TIMESTAMP] Starting backup..."

# Backup only what can't be recreated
tar -czf "$BACKUP_FILE" \
    /opt/mass-mailer/rotation/ \
    /opt/mass-mailer/apps/ \
    /opt/postal/caddy-data/apps/ \
    2>/dev/null

echo "[$TIMESTAMP] Backup saved: $BACKUP_FILE"
echo "[$TIMESTAMP] Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Keep only the 7 most recent backups
ls -t "$BACKUP_DIR"/mass-mailer-backup-*.tar.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null

echo "[$TIMESTAMP] Done."