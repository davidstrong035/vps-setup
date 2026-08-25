#!/bin/bash

CADDYFILE="/opt/postal/config/Caddyfile"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# Dynamic domain values (Update these variables as needed by your rotation logic)
CENTRAL_DOMAIN="central.169.58.100.196.sslip.io"
DYNAMIC_APP_DOMAIN="app-0746b3db.169.58.100.196.sslip.io"

echo "[$TIMESTAMP] Updating Caddyfile domains..."

# Overwrite Caddyfile in place to maintain the Docker inode
cat << INNER_EOF > "$CADDYFILE"
api.maileff.space {
    reverse_proxy 127.0.0.1:4400
}

postal.maileff.space {
    reverse_proxy 127.0.0.1:5000
}

$CENTRAL_DOMAIN {
    reverse_proxy 127.0.0.1:3005
}

$DYNAMIC_APP_DOMAIN {
    root * /data/apps/microsoft/dist
    file_server
    try_files {path} /index.html
}
INNER_EOF

# Reload Caddy container safely
if docker exec postal-caddy caddy reload --config /etc/caddy/Caddyfile > /dev/null 2>&1; then
    echo "[$TIMESTAMP] Caddy successfully reloaded with all 4 domains."
else
    echo "[$TIMESTAMP] ERROR: Failed to reload Caddy." >&2
    exit 1
fi
