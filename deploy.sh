#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────
# deploy.sh — One-command deployment of custom Mass Mailer
# configs on top of a fresh Postal + PM2 installation.
#
# Usage:
#   ./deploy.sh <VPS_PUBLIC_IP>
#
# Example:
#   ./deploy.sh 91.229.239.152
#
# What it does:
#   1. Creates /opt/mass-mailer/ folder structure
#   2. Updates all IP references from default to your VPS IP
#   3. Copies rotation system, router, and app files
#   4. Symlinks apps so Caddy can serve them
#   5. Generates Caddyfile & reloads Caddy
#   6. Starts PM2 services (backend, verifier, router)
#   7. Installs cron jobs (domain rotation every 3h)
#   8. Saves PM2 process list
# ─────────────────────────────────────────────────────────────

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CUSTOM_DIR="/opt/mass-mailer"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[$TIMESTAMP]${NC} $1"; }
warn()  { echo -e "${YELLOW}[$TIMESTAMP] WARNING:${NC} $1"; }
err()   { echo -e "${RED}[$TIMESTAMP] ERROR:${NC} $1"; }

# ─── Step 0: Validate arguments & prerequisites ─────────────

if [ -z "$1" ]; then
    DETECTED_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$DETECTED_IP" ]; then
        err "No IP provided and auto-detection failed."
        echo "Usage: $0 <VPS_PUBLIC_IP>"
        echo "  e.g. $0 91.229.239.152"
        exit 1
    fi
    NEW_IP="$DETECTED_IP"
    info "Auto-detected IP: $NEW_IP"
else
    NEW_IP="$1"
fi

if ! echo "$NEW_IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    err "Invalid IP format: $NEW_IP"
    exit 1
fi

info "Deploying for VPS IP: $NEW_IP"

if ! command -v docker &>/dev/null; then
    err "Docker not found. Install Docker first."
    exit 1
fi

if ! docker ps | grep -q postal-caddy; then
    err "postal-caddy container not running. Install Postal first."
    exit 1
fi

if ! command -v pm2 &>/dev/null; then
    err "PM2 not found. Install PM2 first (npm install -g pm2)."
    exit 1
fi

# ─── Step 1: Create /opt/mass-mailer/ structure ─────────────

info "Creating /opt/mass-mailer/ directory structure..."
mkdir -p "$CUSTOM_DIR"/{caddy,rotation,router,apps,scripts}

# ─── Step 2: Update IP references ───────────────────────────

DEFAULT_IP="91.229.239.152"

if [ "$NEW_IP" != "$DEFAULT_IP" ]; then
    info "Updating IP from $DEFAULT_IP → $NEW_IP in config files..."
    sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/apps-map.json"
    sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/Caddyfile"
    sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/dynamic_domains.caddy"
    sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/rotate-domains.sh"
    sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/rotate-app.sh"
    sed -i "s/$DEFAULT_IP/$NEW_IP/g" "$REPO_DIR/configs/rotate-all-apps.sh"
    info "IP references updated."
else
    info "IP matches default ($DEFAULT_IP) — no substitution needed."
fi
# ─── Step 3: Copy rotation system ────────────────────────────

info "Copying rotation scripts and configs..."
cp "$REPO_DIR/configs/rotate-domains.sh" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/rotate-app.sh" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/rotate-all-apps.sh" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/apps-map.json" "$CUSTOM_DIR/rotation/"
cp "$REPO_DIR/configs/router.js" "$CUSTOM_DIR/router/"
chmod +x "$CUSTOM_DIR/rotation/"*.sh

# ─── Step 4: Copy app files ──────────────────────────────────

if [ -d "$REPO_DIR/apps" ]; then
    for app_dir in "$REPO_DIR/apps/"*/; do
        app_name=$(basename "$app_dir")
        if [ "$app_name" != "mailef-backend" ] && [ -d "$app_dir" ]; then
            info "Deploying app: $app_name"
            cp -r "$app_dir" "$CUSTOM_DIR/apps/"
        fi
    done
else
    warn "No app directories found in $REPO_DIR/apps/"
fi

# ─── Step 5: Symlink apps so Caddy can find them ─────────────

info "Creating symlinks for Caddy..."
mkdir -p /opt/postal/caddy-data/apps
SYMLINK_COUNT=0
for app_dir in "$CUSTOM_DIR/apps/"*/; do
    app_name=$(basename "$app_dir")
    if [ -d "$app_dir" ] && [ -n "$app_name" ]; then
        ln -sf "$app_dir" "/opt/postal/caddy-data/apps/$app_name"
        info "  Symlinked: /opt/postal/caddy-data/apps/$app_name"
        SYMLINK_COUNT=$((SYMLINK_COUNT + 1))
    fi
done

if [ "$SYMLINK_COUNT" -eq 0 ]; then
    warn "No apps were symlinked. Run rotate-domains.sh manually after adding apps."
fi

# ─── Step 6: Generate Caddyfile & reload Caddy ───────────────

if [ -f "$CUSTOM_DIR/rotation/rotate-domains.sh" ] && [ "$SYMLINK_COUNT" -gt 0 ]; then
    info "Generating Caddyfile and reloading Caddy..."
    if "$CUSTOM_DIR/rotation/rotate-domains.sh"; then
        info "Caddyfile generated and Caddy reloaded successfully."
    else
        warn "rotate-domains.sh exited with non-zero status. Check logs."
    fi
else
    warn "Skipping Caddy reload — no apps to configure."
fi

# ─── Step 7: Start PM2 services ──────────────────────────────

info "Starting PM2 services..."

# Backend
if [ -d "$CUSTOM_DIR/mailef-backend" ] && [ -f "$CUSTOM_DIR/mailef-backend/ecosystem.config.js" ]; then
    info "Starting backend from $CUSTOM_DIR/mailef-backend..."
    cd "$CUSTOM_DIR/mailef-backend"
    if pm2 list 2>/dev/null | grep -q mailer-backend; then
        pm2 restart mailer-backend
    else
        pm2 start ecosystem.config.js
    fi
elif [ -d "$CUSTOM_DIR/mailef-backend" ] && [ -f "$CUSTOM_DIR/mailef-backend/dist/server.js" ]; then
    info "Starting backend from $CUSTOM_DIR/mailef-backend..."
    cd "$CUSTOM_DIR/mailef-backend"
    if [ -f "package.json" ]; then
        npm install --production 2>/dev/null || true
    fi
    if pm2 list 2>/dev/null | grep -q mailer-backend; then
        pm2 restart mailer-backend
    else
        pm2 start dist/server.js --name mailer-backend
    fi
else
    warn "Backend not found at $CUSTOM_DIR/mailef-backend/. Skipping."
fi

# Verifier
if [ -d "$CUSTOM_DIR/email-verifier" ] && [ -f "$CUSTOM_DIR/email-verifier/dist/index.js" ]; then
    info "Starting verifier from $CUSTOM_DIR/email-verifier..."
    cd "$CUSTOM_DIR/email-verifier"
    if [ -f "package.json" ]; then
        npm install --production 2>/dev/null || true
    fi
    if pm2 list 2>/dev/null | grep -q mailcleansing-verifier; then
        pm2 restart mailcleansing-verifier
    else
        pm2 start dist/index.js --name mailcleansing-verifier
    fi
else
    warn "Verifier not found at $CUSTOM_DIR/email-verifier/. Skipping."
fi

# Central Router
if [ -f "$CUSTOM_DIR/router/router.js" ]; then
    info "Starting central router..."
    if pm2 list 2>/dev/null | grep -q central-router; then
        pm2 restart central-router
    else
        pm2 start "$CUSTOM_DIR/router/router.js" --name central-router
    fi
else
    warn "Router not found at $CUSTOM_DIR/router/router.js. Skipping."
fi

# ─── Step 8: Set up cron jobs ────────────────────────────────

info "Setting up cron jobs..."
crontab -l 2>/dev/null > /tmp/cron.tmp || true

if ! grep -q "rotate-all-apps.sh" /tmp/cron.tmp 2>/dev/null; then
    echo "0 */3 * * * $CUSTOM_DIR/rotation/rotate-all-apps.sh >> /var/log/domain-rotation.log 2>&1" >> /tmp/cron.tmp
    info "  Added: Domain rotation (every 3 hours)"
fi

if ! grep -q "auto-sync.sh" /tmp/cron.tmp 2>/dev/null; then
    echo "0 2 * * * $REPO_DIR/auto-sync.sh >> /var/log/vps-backup.log 2>&1" >> /tmp/cron.tmp
    info "  Added: Daily backup (2:00 AM)"
fi

crontab /tmp/cron.tmp
rm /tmp/cron.tmp
info "Cron jobs installed."

# ─── Step 9: Save PM2 state ──────────────────────────────────

info "Saving PM2 process list..."
pm2 save

# ─── Step 10: Summary ────────────────────────────────────────

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  ${GREEN} Deployment Complete! ${NC}                               │"
echo "├─────────────────────────────────────────────────────────────┤"
echo "│  VPS IP:        $NEW_IP                  │"
echo "│  Custom dir:    $CUSTOM_DIR              │"
echo "│  Repo dir:      $REPO_DIR                 │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
echo "Quick checks to run manually:"
echo ""
echo "  1. PM2 status:         pm2 list"
echo "  2. Caddy Caddyfile:    cat /opt/postal/config/Caddyfile"
echo "  3. Test central route: curl -I http://central.$NEW_IP.sslip.io/arvest"
echo "  4. Test app page:      curl -I https://app-*.$NEW_IP.sslip.io"
echo "  5. Test API:           curl -I https://api.maileff.space"
echo ""
echo "Done."