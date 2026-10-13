#!/bin/bash

APPS_MAP="/opt/postal/apps-map.json"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

if [ -z "$1" ]; then
    echo "[$TIMESTAMP] ERROR: App name required. Usage: $0 <app_name>"
    exit 1
fi

APP_NAME="$1"

# Check if app exists in mapping
if ! jq -e ".$APP_NAME" "$APPS_MAP" > /dev/null 2>&1; then
    echo "[$TIMESTAMP] ERROR: App '$APP_NAME' not found in mapping."
    exit 1
fi

# Generate new domain
NEW_ID=$(openssl rand -hex 4)
NEW_DOMAIN="app-${NEW_ID}.169.58.100.196.sslip.io"

echo "[$TIMESTAMP] Rotating domain for app: $APP_NAME"
echo "[$TIMESTAMP] New domain: $NEW_DOMAIN"

# Update apps-map.json with the new domain (FIXED SYNTAX)
jq --arg app "$APP_NAME" --arg domain "$NEW_DOMAIN" '.[$app] = $domain' "$APPS_MAP" > /tmp/apps-map.json && mv /tmp/apps-map.json "$APPS_MAP"

# Update Caddy to serve the new domain
echo "[$TIMESTAMP] Updating Caddy configuration..."
/opt/postal/rotate-domains.sh

if [ $? -eq 0 ]; then
    echo "[$TIMESTAMP] Rotation successful."
else
    echo "[$TIMESTAMP] CRITICAL: Caddy update failed."
    exit 1
fi
