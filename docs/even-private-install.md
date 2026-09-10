# Private Even Hub install (G2)

Verified against Even Hub docs (2026): [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware), [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app), [Local Testing](https://hub.evenrealities.com/docs/test/local-testing), [Private Testing](https://hub.evenrealities.com/docs/test/private-testing), [Packaging](https://hub.evenrealities.com/docs/ship/packaging).

There is no public App Store-style install for an unpublished plugin. You use **Developer Mode**, then either **Scan QR** (dev server) or **Private builds** (`.ehpk`).

## 0. Hardware

- Even Realities G2 paired with the **Even Realities** iPhone app
- Glasses out of shipment mode, firmware current
- Account created **inside the phone app** (this is the canonical account)

## 1. Developer account / Developer Mode

There is **no in-app toggle** named “developer mode”. Signing into the web hub with the same account enables it.

1. On a computer, open [https://hub.evenrealities.com/login](https://hub.evenrealities.com/login)
2. Sign in with the **same** Even Realities account as the phone app
3. Force-quit the Even Realities iPhone app and reopen it
4. Open the **Even Hub** tab
5. A developer section appears at the top right, including **Scan QR**

If Scan QR is missing: wrong account, or the phone app was not fully restarted.

## 2. Tooling on your Mac

```bash
node -v    # 20+
npm install
# CLI + simulator are already even-app devDependencies; global install is optional:
# npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
```

SDK in this repo: `@evenrealities/even_hub_sdk` `^0.0.15` (`app.json` `min_sdk_version` `0.0.15`, edition `202601`).

## 3. Configure the backend URL

Even Hub `fetch()` requires the **exact origin** in `app.json` `permissions.network.whitelist`. Wildcards are not supported. CORS must also succeed (this backend enables CORS).

```bash
cp even-app/.env.example even-app/.env.local
# VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com
# VITE_DEVICE_SECRET=same-as-render
# VITE_MOCK_API=false
```

For QR daily development against a laptop API, whitelist will not include `http://192.168.x.x:8787` unless you add it. Easier: mock UI (`VITE_MOCK_API=true`) or deploy Render first and whitelist that HTTPS origin.

`npm run pack` runs `even-app/scripts/sync-whitelist.mjs` so the whitelist matches `VITE_API_BASE_URL`.

## 4. Local QR testing (fastest on-device loop)

Terminal 1:

```bash
npm run dev:app
```

Terminal 2:

```bash
ipconfig getifaddr en0
npx evenhub qr --url "http://YOUR-LAN-IP:5173"
```

Phone: Even Hub → **Scan QR** → point at the terminal.

Glasses should show **Ask AI / Ready**. Vite HMR updates the WebView; if a change does not appear, re-scan.

Phone and laptop must share a LAN without AP isolation. If the scan says it cannot connect, open `http://YOUR-LAN-IP:5173` in Safari on the phone. Details: [Network & Firewall](https://hub.evenrealities.com/docs/get-started/quickstart/hardware).

**Limits of QR / Local Testing:** no `.ehpk`, some permission prompts skipped, WebView dies when the phone locks. Fine for UI; not reviewer-parity.

## 5. Simulator (no glasses)

```bash
VITE_MOCK_API=true npm run dev:app
npm run simulate
```

576×288 green canvas. Tap / double-tap / swipe match temple events. Tap-then-long-press opens the contextual menu (SDK 0.0.14+ / simulator 0.9+).

## 6. Build a private `.ehpk`

From repo root, with `.env.local` set:

```bash
npm run pack
```

This builds Vite output to `even-app/dist` and runs:

```bash
evenhub pack app.json dist -o g2-vision-ai.ehpk
```

The file is gitignored. Official pack docs: `evenhub pack app.json dist -o myapp.ehpk`.

Icon: greyscale `even-app/public/icon.png` (24×24). Color icons are rejected at submission; keep this one grey.

## 7. Upload and install the private build

1. [hub.evenrealities.com](https://hub.evenrealities.com/login) → your project → **Private builds**
2. Upload `even-app/g2-vision-ai.ehpk`
3. iPhone Even Realities app → Even Hub (Developer Mode) → **Me → Apps → Private builds**
4. Tap **Install**
5. Launch **Ask AI** from the glasses home (not from the QR WebView)

`package_id` is `com.codeauzins.g2visionai`. If the portal says the id is taken, change it in `even-app/app.json` to another reverse-DNS name you control (lowercase, no hyphens).

## 8. Confirm it is running

HUD should say **Ready** / press Action Button. Double-tap must show the **system** exit confirmation (required by Even QA; the app uses `shutDownPageContainer(1)`).

Then run the Shortcut once. Glasses: Photo received → Analyzing → paged answer. Swipe down for page 2.

## Beta vs private

Private builds are tied to **your** account. Colleague installs and 5-minute lock survival use **Beta Testing**, not required for personal V1.

## If the glasses stay black

- `await waitForEvenAppBridge()` must run before any HUD call (already true in `even-app/src/main.ts`)
- Re-scan QR or reinstall the `.ehpk`
- Confirm Even App version meets the floor stamped at pack time (contextual menu needs Even App **2.2.9+**)
