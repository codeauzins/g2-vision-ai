# G2 Vision AI

Watch / Action Button → Render → Raspberry Pi Camera Module 3 (5-frame burst) → OpenAI vision → Apple Watch + Even Realities G2 HUD.

The Shortcut does not take the photo. It asks Render to capture. The Pi polls Render, shoots five JPEGs, and uploads them. OpenAI reads all five frames and uses the most legible text. The Shortcut polls `GET /api/result/:jobId` for the Watch. The Even Hub app **Ask AI** still polls `GET /api/latest` for the glasses.

## Overview

This is a personal, private stack for one wearer:

1. iPhone Action Button runs an Apple Shortcut.
2. Shortcut takes a photo and POSTs it to your Render service.
3. Render resizes the image, calls the OpenAI **Responses** API with vision input, stores the answer (and a copy of the optimized photo) for the admin page, then continues.
4. The Even Hub app on the phone WebView polls `GET /api/latest` every 1.5s and draws the answer on the G2.

The OpenAI API key never leaves Render. The Shortcut and glasses app share only a bearer device secret.

## Architecture

```text
[Apple Watch / Action Button Shortcut]
        |  POST /api/capture
        v
[Render  Fastify]
        |  GET /api/pi/next (Pi polls)
        v
[Raspberry Pi 4 + Camera Module 3]
  5 JPEGs ~300ms apart → POST /api/pi/jobs/:id/frames
        |
        v
[Render → OpenAI Responses, 5 images]
        |                    |
        | GET /api/result    | GET /api/latest
        v                    v
[Apple Watch]         [Ask AI → G2 HUD]
```

V1 uses in-memory job storage. A Render free-tier restart or spin-down clears pending results. The store is behind a `ResultStore` interface so Redis/Postgres can replace it later.

## Quick Start

```bash
git clone https://github.com/codeauzins/g2-vision-ai.git
cd g2-vision-ai
cp .env.example .env          # fill G2_DEVICE_SECRET (and OPENAI_API_KEY for real analysis)
npm install
npm test
npm run dev                   # backend :8787 + Even app Vite :5173
```

Mock the glasses UI without OpenAI:

```bash
# even-app/.env.local
VITE_MOCK_API=true
npm run dev:app
npm run simulate              # Even Hub simulator → http://localhost:5173
```

## Backend

Node.js 22+, TypeScript, Fastify. See [docs/local-development.md](docs/local-development.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | no | Render health check (does not call OpenAI) |
| GET | `/api/openai` | Bearer | Live OpenAI API key test (cached 30s) |
| POST | `/api/capture` | Bearer | Watch/Shortcut: queue a Pi 5-frame burst (202) |
| GET | `/api/pi/next` | Bearer | Pi claims the next capture job |
| POST | `/api/pi/jobs/:jobId/frames` | Bearer | Pi uploads JPEG frames, then OpenAI runs |
| POST | `/api/analyze` | Bearer | Optional: upload one iPhone image, start job (202) |
| GET | `/api/result/:jobId` | Bearer | Job status / answer |
| GET | `/api/latest` | Bearer | Newest job (or `{ result: null }`) |
| GET | `/api/history` | Bearer | Last 20 complete/error jobs for the glasses |
| GET | `/admin` | cookie | Password page: Logs, Test Pi capture, prompt editor, photo history |
| POST | `/admin/capture` | cookie | Queue a 5-frame Pi burst (same as Watch `/api/capture`) |
| GET | `/admin/logs` | cookie | HTML fragment of recent HUD/server events |
| POST | `/api/hud` | Bearer | Glasses HUD line for admin Logs |

Open the admin UI at `https://g2-vision-ai.onrender.com/admin`. Password is `G2_ADMIN_PASSWORD`, or `G2_DEVICE_SECRET` if that is unset. Use **Test Pi capture** to queue a 5-frame burst without the Watch Shortcut. The **Logs** section lists glasses HUD lines (Checking OpenAI key…, Ready, Analyzing…) and server events with timestamps. Edit the OpenAI system prompt on the same page; the next photo uses it. Previous photos and answers are listed below, with **Delete** / **Delete all jobs**.

`POST /api/analyze` accepts:

- `multipart/form-data` with file field `image` (also `photo`, `file`)
- raw body `Content-Type: image/jpeg` (Shortcuts-friendly)
- optional `mode`, `question`, `device_id` as form fields or query string

Modes: `general` (default), `ocr`, `translate`, `explain`, `short`.

Images are resized so the longest edge is 1600px and re-encoded as JPEG quality 80. A copy is kept for the admin history (under `G2_DATA_DIR/images`). HEIC is rejected on purpose — convert to JPEG in Shortcuts.

## Even Hub App

Package: `even-app`, SDK `@evenrealities/even_hub_sdk` (0.0.15).

UI states: **Checking OpenAI key…**, **Ready** (after the backend answers `/api/latest`; a failed key test still shows an error), **Analyzing…**, **result pages**, **short glasses errors**.

Gestures (official `OsEventTypeList`; R1 ring and G2 temples share the same event types):

- Temple / ring swipe down → next page
- Swipe up → previous page
- Tap → next page (on a result) or retry (after the double-tap window)
- **Quick Blank:** R1 / temple **double tap** → blank the HUD; double tap again → restore. A new Ask AI result wakes the HUD on page 1. Polling does not stop.
- **Job history:** R1 **long press** opens the Jobs list (scroll, **tap** a row). Long press from an answer returns to Jobs. Double tap leaves the list. Contextual menu → **Jobs**.
- Tap then long-press → contextual menu: Refresh, Previous Page, Next Page, Clear, Short Answer, **Exit** (`shutDownPageContainer(1)`)

There is **no** SDK display-off API. Quick Blank is an empty text container (black pixels are off). See [docs/g2-pagination.md](docs/g2-pagination.md#quick-blank).

Build-time env (`even-app/.env.local`): `VITE_API_BASE_URL`, `VITE_DEVICE_SECRET`, `VITE_MOCK_API`. These are **not** Render env vars. See [docs/glasses-config.md](docs/glasses-config.md).

Private install: [docs/even-private-install.md](docs/even-private-install.md). Pagination: [docs/g2-pagination.md](docs/g2-pagination.md).

## Apple Shortcut

Watch/Action Button: POST `/api/capture`, then poll `/api/result/:jobId` until `complete`. Do not call OpenAI. Steps: [docs/apple-shortcut.md](docs/apple-shortcut.md). Pi setup: [docs/raspberry-pi.md](docs/raspberry-pi.md).

Action Button: Settings → Action Button → Shortcut → **G2 Vision AI**.

## Render

Paid web service, Node 22, health `/health`. Blueprint: `render.yaml`. Walkthrough: [docs/render-deployment.md](docs/render-deployment.md).

Cold start is not expected on a paid Render instance. The glasses app keeps the last answer if a poll request times out.

## Environment Variables

| Name | Where | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Render only | Never in git, Shortcut, or the Even app |
| `OPENAI_MODEL` | Render | Default `gpt-4o-mini` |
| `G2_DEVICE_SECRET` | Render + Shortcut + `VITE_DEVICE_SECRET` | Long random bearer token |
| `G2_ADMIN_PASSWORD` | Render | Password for `/admin`. If unset, `G2_DEVICE_SECRET` is used |
| `G2_DATA_DIR` | Render | `/var/data2` — answers, prompt settings, and optimized photos |
| `PORT` | Render | Provided automatically |
| `RESULT_TTL_SECONDS` | Render | `0` keeps jobs forever (delete from `/admin`). Set a number of seconds only if you want auto-expiry |
| `MAX_UPLOAD_MB` | Render | Default 8 |
| `IMAGE_MAX_EDGE` | Render | Default 1600 |
| `IMAGE_JPEG_QUALITY` | Render | Default 80 |
| `VITE_API_BASE_URL` | Mac (`even-app/.env.local`) | Default `https://g2-vision-ai.onrender.com` — not a Render env var |
| `VITE_DEVICE_SECRET` | Mac (`even-app/.env.local`) | Same as `G2_DEVICE_SECRET` — not a Render env var |
| `VITE_MOCK_API` | Mac (`even-app/.env.local`) | `true` for demo pages |

Generate a secret:

```bash
openssl rand -hex 32
```

## Testing

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Backend tests mock OpenAI (`VisionClient`). They do not spend API credits.

## Private G2 installation

1. Create an Even Realities account in the phone app.
2. Sign in at [hub.evenrealities.com/login](https://hub.evenrealities.com/login) with the **same** account (this enables Developer Mode).
3. Force-quit and reopen the Even Realities app → Even Hub tab → Scan QR / Private builds.
4. Daily loop: Vite + `evenhub qr --url http://<LAN-IP>:5173`.
5. Packaged loop: `npm run pack` → upload `.ehpk` → Me → Apps → Private builds → Install.

Full procedure: [docs/even-private-install.md](docs/even-private-install.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Shortcut fails immediately | HEIC body | Convert Image to JPEG in the Shortcut |
| 401 from `/api/analyze` | Secret mismatch | Same `G2_DEVICE_SECRET` on Render, Shortcut, app |
| Glasses stay on Checking OpenAI | Install Ask AI b-09; a stored job no longer skips painting Ready |
| Glasses stay on Ready | URL not in `app.json` whitelist, CORS, or app not rebuilt | Sync whitelist, redeploy, pack |
| Answer replaced by Server waking up… | Poll timeout overwrote the HUD | Install Ask AI b-07; poll errors no longer replace a shown answer |
| Same answer never updates | Deduped `jobId` | Take a new photo, or menu → Refresh |
| Blank HUD | Bridge not awaited | App already awaits `waitForEvenAppBridge()` |
| Memory empty after deploy | No persistent disk | Mount a Render disk at `G2_DATA_DIR` (`/var/data2`); jobs are kept until you delete them in `/admin` |

## Security

- `OPENAI_API_KEY` exists only as a Render env var and is never shown on `/admin`.
- Optimized JPEGs and answers stay on the Render disk until you delete them in `/admin`.
- `/admin` is cookie-gated (`G2_ADMIN_PASSWORD` or `G2_DEVICE_SECRET`).
- Logs record job ids, byte sizes, timings — not image bytes, not full answers.
- `RESULT_TTL_SECONDS=0` (default) does not auto-delete jobs.
- Auth is a single personal bearer token (timing-safe compare). This is a one-user V1, not multi-tenant.

## Privacy

Default behavior: optimized JPEGs and answers stay on the Render disk for `/admin` until you delete them. The OpenAI key is never on the glasses or Shortcut. Render still sends photos to OpenAI under [OpenAI's API data usage](https://developers.openai.com/api/docs/guides/images-vision).

## Project Structure

```text
backend/          Fastify API, OpenAI Responses vision, tests
even-app/         Even Hub Vite app, pagination, HUD
docs/             Shortcut, Render, local, G2 install, references
render.yaml       Render Blueprint
.env.example      All env names, no secrets
```

## Future (not in V1)

G2 voice question, conversation history, follow-ups, web search, per-user accounts, Redis, WebSockets/push.

Official sources: [docs/references.md](docs/references.md).
