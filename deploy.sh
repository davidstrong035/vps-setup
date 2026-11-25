#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CUSTOM_DIR="/opt/mass-mailer"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

DEFAULT_IP="91.229.239.152"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[$TIMESTAMP]${NC} $1"; }
warn()  { echo -e "${YELLOW}[$TIMESTAMP] WARNING:${NC} $1"; }
err()   { echo -e "${RED}[$TIMESTAMP] ERROR:${NC} $1"; }
# ─── Validate ────────────────────────────────────────────────
if [ -z "$1" ]; then
    DETECTED_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
    [ -z "$DETECTED_IP" ] && { err "No IP provided."; echo "Usage: $0 <VPS_IP>"; exit 1; }
    NEW_IP="$DETECTED_IP"
    info "Auto-detected IP: $NEW_IP"
else
    NEW_IP="$1"
fi

! echo "$NEW_IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' && { err "Invalid IP: $NEW_IP"; exit 1; }

info "Deploying for VPS IP: $NEW_IP"
command -v docker &>/dev/null || { err "Docker not found."; exit 1; }
docker ps | grep -q postal-caddy || { err "postal-caddy not running. Install Postal first."; exit 1; }
command -v pm2 &>/dev/null || { err "PM2 not found. Install PM2 first."; exit 1; }

# ─── Create structure ───────────────────────────────────────
info "Creating /opt/mass-mailer/ dir structure..."
mkdir -p "$CUSTOM_DIR"/{rotation,router,apps}
# ─── Update IP references ───────────────────────────────────
if [ "$NEW_IP" != "$DEFAULT_IP" ]; then
    info "Updating IP from $DEFAULT_IP -> $NEW_IP..."
    for f in apps-map.json rotate-domains.sh rotate-app.sh rotate-all-apps.sh; do
        sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/$f"
    done
fi

# ─── Copy rotation system ───────────────────────────────────
info "Copying rotation scripts and configs..."
cp "$REPO_DIR/configs/rotate-domains.sh" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/rotate-app.sh" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/rotate-all-apps.sh" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/apps-map.json" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/router.js" "$CUSTOM_DIR/router/"
chmod +x "$CUSTOM_DIR/rotation/"*.sh
# ─── Copy apps to mass-mailer AND caddy-data ───────────────
if [ -d "$REPO_DIR/apps" ]; then
    for app_dir in "$REPO_DIR/apps/"*/; do
        app_name=$(basename "$app_dir")
        if [ "$app_name" != "mailef-backend" ] && [ -d "$app_dir" ]; then
            info "Deploying app: $app_name"

            # Copy to mass-mailer (source of truth)
            rm -rf "$CUSTOM_DIR/apps/$app_name"
            cp -r "$app_dir" "$CUSTOM_DIR/apps/"

            # Copy directly to caddy-data (Caddy's Docker dir)
            # IMPORTANT: no symlinks - Docker cannot follow them
            rm -rf /opt/postal/caddy-data/apps/$app_name
            cp -r "$app_dir" /opt/postal/caddy-data/apps/
        fi
    done
else
    warn "No app directories found in $REPO_DIR/apps/"
fi

# ─── Generate Caddyfile & reload Caddy ─────────────────────
if [ -f "$CUSTOM_DIR/rotation/rotate-domains.sh" ]; then
    info "Generating Caddyfile and reloading Caddy..."
    if "$CUSTOM_DIR/rotation/rotate-domains.sh"; then
        info "Caddy reloaded successfully."
    else
        warn "rotate-domains.sh exited with non-zero status."
    fi
fi

# ─── Start PM2 services ────────────────────────────────────
info "Starting PM2 services..."

if [ -f "$CUSTOM_DIR/router/router.js" ]; then
    if pm2 list 2>/dev/null | grep -q central-router; then
        pm2 restart central-router
    else
        pm2 start "$CUSTOM_DIR/router/router.js" --name central-router
    fi
fi

if [ -d "$CUSTOM_DIR/mailef-backend/dist" ]; then
    cd "$CUSTOM_DIR/mailef-backend"
    [ -f "package.json" ] && npm install --production 2>/dev/null || true
    if pm2 list | grep -q mailer-backend; then
        pm2 restart mailer-backend
    else
        pm2 start dist/server.js --name mailer-backend
    fi
fi

# ─── Set up cron jobs ──────────────────────────────────────
info "Setting up cron jobs..."
crontab -l 2>/dev/null > /tmp/cron.tmp || true

grep -q "rotate-all-apps.sh" /tmp/cron.tmp 2>/dev/null || \
    echo "0 */3 * * * $CUSTOM_DIR/rotation/rotate-all-apps.sh >> /var/log/domain-rotation.log 2>&1" >> /tmp/cron.tmp

grep -q "backup.sh" /tmp/cron.tmp 2>/dev/null || \
    echo "0 2 * * * $CUSTOM_DIR/backup.sh >> /var/log/vps-backup.log 2>&1" >> /tmp/cron.tmp

crontab /tmp/cron.tmp
rm -f /tmp/cron.tmp

# ─── Save PM2 state & Done ─────────────────────────────────
pm2 save
echo ""
echo "Deployment complete for $NEW_IP"
echo "  - Rotation:  $CUSTOM_DIR/rotation/"
echo "  - Apps:      $CUSTOM_DIR/apps/"
echo "  - Caddy:     /opt/postal/caddy-data/apps/"
echo ""
echo "Check: pm2 list"
echo "Check: cat /opt/postal/config/Caddyfile"