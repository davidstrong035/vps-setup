#!/bin/bash

# Configuration Paths
DYNAMIC_CADDY_FILE="/opt/postal/config/dynamic_domains.caddy"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# Dynamic domain values
CENTRAL_DOMAIN="central.169.58.100.196.sslip.io"
DYNAMIC_APP_DOMAIN="app-0746b3db.169.58.100.196.sslip.io"

echo "[$TIMESTAMP] Updating dynamic domain configurations..."

# Generate the dynamic Caddy routes
cat << INNER_EOF > "$DYNAMIC_CADDY_FILE"
# Central Static Domain
$CENTRAL_DOMAIN {
    reverse_proxy 127.0.0.1:3005
}

# Dynamic Active Domain
$DYNAMIC_APP_DOMAIN {
    root * /data/apps/microsoft/dist
    file_server
    try_files {path} /index.html
}
INNER_EOF

# Reload Caddy container without downtime
if docker exec postal-caddy caddy reload --config /etc/caddy/Caddyfile > /dev/null 2>&1; then
    echo "[$TIMESTAMP] Dynamic domains updated and Caddy reloaded successfully."
else
    echo "[$TIMESTAMP] ERROR: Failed to reload Caddy." >&2
    exit 1
fi
