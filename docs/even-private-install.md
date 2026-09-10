# Private Even Hub install (G2)

Verified against Even Hub docs (2026): [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware), [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app), [Local Testing](https://hub.evenrealities.com/docs/test/local-testing), [Private Testing](https://hub.evenrealities.com/docs/test/private-testing), [Packaging](https://hub.evenrealities.com/docs/ship/packaging).

There is no public App Store-style install for an unpublished plugin.

**You do not need Scan QR to use Ask AI on your own G2.** Scan QR is only a live-reload trick for laptop development. For a real install, use **Private builds** (`.ehpk`) below.

## 1. Developer Mode (why Scan QR is missing)

There is **no** Settings toggle named Developer Mode.

Scan QR stays hidden until Even decides your **account** is a developer account:

1. In the **iPhone Even Realities app**, note the email you signed in with (Profile / Me).
2. On a computer, open [https://hub.evenrealities.com/login](https://hub.evenrealities.com/login).
3. Sign in with **that exact same email**. First web login is what flips Developer Mode on.
4. On iPhone: swipe the Even Realities app **out of the app switcher** (force quit), then open it again. Backgrounding is not enough.
5. Open the **Even Hub** tab (bottom of the phone app, not Settings, not the glasses home screen).
6. Look at the **top-right of that tab**. Scan QR and other dev tools appear there only after step 3–4.

If it is still missing:

- Phone and website are different accounts (Apple vs email, typo, second Even login).
- App was not force-quit after the **web** login.
- Even Realities iPhone app is old — update it from the App Store.
- You are looking in the wrong place (glasses menu / iOS Settings / Action Button). It is only on the **Even Hub** tab.

You can skip QR entirely: still log into the web hub (required for Private builds), then jump to section 6.

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
# VITE_API_BASE_URL=https://g2-vision-ai.onrender.com
# VITE_DEVICE_SECRET=same-as-G2_DEVICE_SECRET-on-Render
# VITE_MOCK_API=false
```

See [docs/glasses-config.md](glasses-config.md). These are Mac build variables, not Render.

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
