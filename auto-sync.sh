#!/bin/bash

# Configuration
REPO_DIR="/root/vps-setup"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

cd "$REPO_DIR" || exit

echo "[$TIMESTAMP] Starting automated VPS state backup..."

# 1. Update configurations and scripts
cp -r /opt/postal/config/* "$REPO_DIR/configs/" 2>/dev/null
cp /opt/postal/apps-map.json "$REPO_DIR/configs/" 2>/dev/null
cp /opt/postal/rotate-domains.sh "$REPO_DIR/configs/" 2>/dev/null
cp /opt/postal/router.js "$REPO_DIR/configs/" 2>/dev/null

# 2. Update cron files
cp /etc/cron.d/staticroute "$REPO_DIR/cron/" 2>/dev/null
crontab -l > "$REPO_DIR/cron/root-crontab" 2>/dev/null

# 3. Dump fresh MariaDB database
docker exec postal-mariadb mariadb-dump -u root -ppostal --all-databases > "$REPO_DIR/database/all_databases.sql" 2>/dev/null

# 4. Check for changes and push to GitHub
git add .

# Only commit and push if there are actual changes
if ! git diff-index --quiet HEAD --; then
    git commit -m "Automated backup: $TIMESTAMP"
    git push origin main
    echo "[$TIMESTAMP] Changes pushed to GitHub successfully."
else
    echo "[$TIMESTAMP] No changes detected. Backup up to date."
fi
