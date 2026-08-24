#!/bin/bash
set -e

echo "[1/6] Installing Core System Dependencies..."
apt-get update
apt-get install -y curl git ufw jq docker.io docker-compose-plugin

# Node.js & PM2 Setup
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    npm install -g pm2
fi

echo "[2/6] Restoring System Configurations & Cron..."
mkdir -p /opt/postal /opt/mailef-backend
cp -r configs/* /opt/postal/
cp cron/staticroute /etc/cron.d/staticroute 2>/dev/null || true
crontab cron/root-crontab 2>/dev/null || true

echo "[3/6] Restoring Application Files..."
if [ -d "apps/mailef-backend" ]; then
    cp -r apps/mailef-backend/* /opt/mailef-backend/
    (cd /opt/mailef-backend && npm install --production)
fi

echo "[4/6] Configuring Firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25/tcp
ufw allow 587/tcp
ufw --force enable

echo "[5/6] Starting Containers & Restoring MariaDB Dump..."
docker compose up -d

echo "Waiting for MariaDB to start..."
until docker exec postal-mariadb mariadb-admin ping -u root -ppostal --silent; do
    sleep 2
done

docker exec -i postal-mariadb mariadb -u root -ppostal < database/all_databases.sql

echo "[6/6] Restoring PM2 Services..."
cd /opt/mailef-backend && pm2 start dist/server.js --name mailer-backend
cd /opt/postal && pm2 start router.js --name central-router
pm2 save
pm2 startup systemd -u root --hp /root

echo "=== VPS Restoration Complete! ==="
