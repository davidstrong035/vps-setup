# How to Add a New App to the Rotation System

Guide to add a new static site (e.g., "bank", "company") to the automated domain rotation.

**Prerequisites:**
- Root access to the VPS
- Built app files (HTML/JS/CSS) ready to deploy

---

## Step 1: Place App Files

App files live in our custom directory (not inside Postal's directory).

```bash
# Create the app folder
mkdir -p /opt/mass-mailer/apps/<appname>

# Copy your files there (index.html must be at the root)
cp -r /path/to/your/app/* /opt/mass-mailer/apps/<appname>/

# Symlink so Caddy can find it
ln -sf /opt/mass-mailer/apps/<appname> /opt/postal/caddy-data/apps/<appname>

# Verify
ls -la /opt/postal/caddy-data/apps/<appname>/
```

The `index.html` **must** be directly inside the app folder, not in a subfolder.

---

## Step 2: Register the App

Add the app to the rotation system:

```bash
APP_NAME="<appname>"
NEW_ID=$(openssl rand -hex 4)
NEW_DOMAIN="app-${NEW_ID}.<YOUR_VPS_IP>.sslip.io"

echo "Adding $APP_NAME to rotation system..."
jq --arg app "$APP_NAME" --arg domain "$NEW_DOMAIN" '.[$app] = $domain' /opt/mass-mailer/rotation/apps-map.json > /tmp/apps-map.json && mv /tmp/apps-map.json /opt/mass-mailer/rotation/apps-map.json

/opt/mass-mailer/rotation/rotate-domains.sh
echo "Done! $APP_NAME is now active."
```

---

## Step 3: Verify

```bash
# Check the mapping
cat /opt/mass-mailer/rotation/apps-map.json

# Test via central router
curl -I https://central.<YOUR_VPS_IP>.sslip.io/<appname>

# Test the new domain directly
curl -I https://app-<ID>.<YOUR_VPS_IP>.sslip.io
```

---

## Automatic Rotation

The cron job (`/opt/mass-mailer/rotation/rotate-all-apps.sh`) runs every 3 hours and automatically generates new domains. No further action needed.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "App mapping not found" | App name mismatch | Ensure name matches in `apps-map.json` and the URL |
| 404 on app domain | Missing `index.html` | Verify `index.html` is in the root of the app folder |
| Rotation not happening | Cron disabled | Check logs: `cat /var/log/domain-rotation.log` |
