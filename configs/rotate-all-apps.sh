cat > /opt/postal/rotate-all-apps.sh << 'EOF'
#!/bin/bash

APPS_MAP="/opt/postal/apps-map.json"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

echo "[$TIMESTAMP] Starting rotation for ALL apps..."

if [ ! -f "$APPS_MAP" ]; then
    echo "[$TIMESTAMP] ERROR: apps-map.json not found" >&2
    exit 1
fi

# Get list of all app names
APP_NAMES=$(jq -r 'keys[]' "$APPS_MAP")

if [ -z "$APP_NAMES" ]; then
    echo "[$TIMESTAMP] No apps found in mapping. Nothing to rotate."
    exit 0
fi

# Create a temporary file for updates
TEMP_MAP=$(mktemp)
cp "$APPS_MAP" "$TEMP_MAP"

# Loop through each app and generate a new domain
for app_name in $APP_NAMES; do
    if [ -n "$app_name" ]; then
        NEW_ID=$(openssl rand -hex 4)
        NEW_DOMAIN="app-${NEW_ID}.169.58.100.196.sslip.io"
        
        echo "[$TIMESTAMP] Rotating $app_name -> $NEW_DOMAIN"
        
        # Update the temporary map file
        jq --arg app "$app_name" --arg domain "$NEW_DOMAIN' '.[$app] = $domain' "$TEMP_MAP" > "${TEMP_MAP}.tmp" && mv "${TEMP_MAP}.tmp" "$TEMP_MAP"
    fi
done

# Replace the real mapping file with the updated one
mv "$TEMP_MAP" "$APPS_MAP"

echo "[$TIMESTAMP] All app mappings updated. Updating Caddy..."

# Run the Caddy update script (the fixed version we created earlier)
/opt/postal/rotate-domains.sh

if [ $? -eq 0 ]; then
    echo "[$TIMESTAMP] SUCCESS: All domains rotated and Caddy updated."
else
    echo "[$TIMESTAMP] CRITICAL: Caddy update failed after rotation. Manual intervention required."
    exit 1
fi
EOF
chmod +x /opt/postal/rotate-all-apps.sh
