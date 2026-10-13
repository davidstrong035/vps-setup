#!/bin/bash

CADDYFILE="/opt/postal/config/Caddyfile"
APPS_MAP="/opt/postal/apps-map.json"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

echo "[$TIMESTAMP] Updating Caddyfile domains..."

if [ ! -f "$APPS_MAP" ]; then
    echo "[$TIMESTAMP] ERROR: apps-map.json not found" >&2
    exit 1
fi

# Write the fixed part of the Caddyfile
cat << 'HEADER_EOF' > "$CADDYFILE"
api.maileff.space {
    reverse_proxy 127.0.0.1:4400
}

postal.maileff.space {
    reverse_proxy 127.0.0.1:5000
}

central.169.58.100.196.sslip.io {
    reverse_proxy 127.0.0.1:3005
}

HEADER_EOF

# Read apps-map.json and generate entries for each app
# Use a safe way to iterate that doesn't break jq
for app_name in $(jq -r 'keys[]' "$APPS_MAP"); do
    app_domain=$(jq -r --arg key "$app_name" '.[$key]' "$APPS_MAP")
    
    if [ -n "$app_name" ] && [ -n "$app_domain" ] && [ "$app_name" != "null" ] && [ "$app_domain" != "null" ]; then
        echo "[$TIMESTAMP] Configuring app: $app_name -> $app_domain"
        
        cat << APP_EOF >> "$CADDYFILE"
$app_domain {
    root * /data/apps/${app_name}
    file_server
    try_files {path} /index.html
}

APP_EOF
    fi
done

# Reload Caddy
if docker exec postal-caddy caddy reload --config /etc/caddy/Caddyfile > /dev/null 2>&1; then
    echo "[$TIMESTAMP] Caddy successfully reloaded with all configured apps."
else
    echo "[$TIMESTAMP] ERROR: Failed to reload Caddy." >&2
    exit 1
fi
