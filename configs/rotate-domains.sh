#!/bin/bash

# 1. Generate a random 8-character hex string (e.g., "a3f89b12")
RANDOM_PREFIX="app-$(openssl rand -hex 4)"
IP_ADDRESS="169.58.100.196"

# 2. Construct the new dynamic domain
NEW_DOMAIN="${RANDOM_PREFIX}.${IP_ADDRESS}.sslip.io"

echo "Generated new dynamic domain: $NEW_DOMAIN"

# 3. Update the JSON mapping file
cat <<JSON > /opt/postal/apps-map.json
{
  "microsoft": "$NEW_DOMAIN"
}
JSON

# 4. Rewrite the Caddyfile with the new dynamic domain
cat <<CADDY > /opt/postal/config/Caddyfile
# Central Static Domain
central.${IP_ADDRESS}.sslip.io {
    reverse_proxy 127.0.0.1:3005
}

# Dynamic Active Domain
$NEW_DOMAIN {
    root * /data/apps/microsoft/dist
    file_server
    try_files {path} /index.html
}
CADDY

# 5. Reload Caddy instantly to issue SSL and serve content
docker exec postal-caddy caddy reload --config /etc/caddy/Caddyfile
