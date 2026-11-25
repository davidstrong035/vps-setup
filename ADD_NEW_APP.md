# How to Add a New App to the Rotation System

Guide to add a new static site (e.g., "bank", "company") to the automated domain rotation.

**Prerequisites:**
- Root access to the VPS
- Built app files (HTML/JS/CSS) ready to deploy

---

## Step 1: Place App Files

Files go into **both** the mass-mailer directory (source of truth) and caddy-data (for Caddy).
**Do not use symlinks** — the Docker container can't follow them.

```bash
# Create the app folder in mass-mailer (source of truth)
mkdir -p /opt/mass-mailer/apps/<appname>

# Copy your files there (index.html must be at the root)
cp -r /path/to/your/app/* /opt/mass-mailer/apps/<appname>/

# Copy directly to caddy-data (Caddy's Docker container reads from here)
mkdir -p /opt/postal/caddy-data/apps/<appname>
cp -r /path/to/your/app/* /opt/postal/caddy-data/apps/<appname>/

# Verify
ls -la /opt/mass-mailer/apps/<appname>/
ls -la /opt/postal/caddy-data/apps/<appname>/
```

**Important:** `index.html` must be at the **root** of the app folder, not in a subfolder.
- If your build outputs to `dist/`, move files up:
  ```bash
  cp -r dist/* . && rm -rf dist
  ```

**Troubleshooting:** If assets return 404 (JS/CSS), check that the `assets/` folder was copied:
```bash
ls -la /opt/postal/caddy-data/apps/<appname>/assets/
```

---

## Step 2: Register the App in the Rotation System

```bash
APP_NAME="<appname>"
NEW_ID=$(openssl rand -hex 4)
VPS_IP=$(jq -r '.[] | split(".")[1:] | join(".")' /opt/mass-mailer/rotation/apps-map.json | head -1)
NEW_DOMAIN="app-${NEW_ID}.${VPS_IP}"

echo "Adding $APP_NAME to rotation system..."
jq --arg app "$APP_NAME" --arg domain "$NEW_DOMAIN" \
  '.[$app] = $domain' /opt/mass-mailer/rotation/apps-map.json \
  > /tmp/apps-map.json && mv /tmp/apps-map.json /opt/mass-mailer/rotation/apps-map.json

/opt/mass-mailer/rotation/rotate-domains.sh
echo "Done! $APP_NAME is now active."
```

---

## Step 3: Verify

```bash
# Check the mapping
cat /opt/mass-mailer/rotation/apps-map.json

# Test the new domain directly
curl -I https://<NEW_DOMAIN>

# Check assets load (JS/CSS)
curl -s -o /dev/null -w "%{http_code}" https://<NEW_DOMAIN>/assets/index-*.js
```

---

## Step 4: Commit to the local repo

```bash
# On your local machine, copy the new app into the repo
cp -r /path/to/app/ vps-setup/apps/<appname>/

# Commit and push
git add .
git commit -m "Add $APP_NAME app"
git push
```

---

## Automatic Rotation

The cron job (`/opt/mass-mailer/rotation/rotate-all-apps.sh`) runs every 3 hours and
automatically generates new domains. No further action needed.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "App mapping not found" | App name mismatch | Ensure name matches in `apps-map.json` and the URL |
| 404 on app domain | Missing `index.html` | Verify `index.html` is at the root of the app folder |
| Site loads but assets 404 | Symlink or missing `assets/` | Copy directly to caddy-data, don't symlink |
| Rotation not happening | Cron disabled | Check: `cat /var/log/domain-rotation.log` |