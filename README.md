# G2 Vision AI

Action Button photo → Render backend → OpenAI vision → Even Realities G2 HUD.

Press the iPhone Action Button, take a photo, look at the glasses. The Apple Shortcut only captures and uploads. Analysis and formatting happen on the server. The Even Hub app **Ask AI** polls for the latest result and paginates long answers across the 576×288 G2 display.

## Overview

This is a personal, private stack for one wearer:

1. iPhone Action Button runs an Apple Shortcut.
2. Shortcut takes a photo and POSTs it to your Render service.
3. Render resizes the image, calls the OpenAI **Responses** API with vision input, stores the answer in memory with a TTL, then deletes the image bytes.
4. The Even Hub app on the phone WebView polls `GET /api/latest` every 1.5s and draws the answer on the G2.

The OpenAI API key never leaves Render. The Shortcut and glasses app share only a bearer device secret.

## Architecture

```text
[iPhone Action Button]
        |
        v
[Apple Shortcut]
  Take Photo → Convert to JPEG → POST /api/analyze
        |
        |  HTTPS + Bearer G2_DEVICE_SECRET
        v
[Render backend  Node/Fastify]
  optimize image → OpenAI Responses vision → memory job store
        ^
        |  GET /api/latest  (poll 1–2s)
        |
[Even Hub app "Ask AI"]
        |
        v
[Even Realities G2  576×288 HUD, paged text]
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
| GET | `/health` | no | Render health check |
| POST | `/api/analyze` | Bearer | Upload image, start job (202) |
| GET | `/api/result/:jobId` | Bearer | Job status / answer |
| GET | `/api/latest` | Bearer | Newest job (or `{ result: null }`) |

`POST /api/analyze` accepts:

- `multipart/form-data` with file field `image` (also `photo`, `file`)
- raw body `Content-Type: image/jpeg` (Shortcuts-friendly)
- optional `mode`, `question`, `device_id` as form fields or query string

Modes: `general` (default), `ocr`, `translate`, `explain`, `short`.

Images are resized so the longest edge is 1600px and re-encoded as JPEG quality 80, then discarded after the OpenAI call. HEIC is rejected on purpose — convert to JPEG in Shortcuts.

## Even Hub App

Package: `even-app`, SDK `@evenrealities/even_hub_sdk` (0.0.15).

UI states: **Ready**, **Analyzing…**, **result pages**, **short glasses errors**.

Gestures (official event types):

- Temple / ring swipe down → next page
- Swipe up → previous page
- Tap → next page (on a result) or retry
- Double-tap → system exit confirmation (`shutDownPageContainer(1)`)
- Tap then long-press → contextual menu: Refresh, Previous Page, Next Page, Clear, Short Answer

Build-time env (`even-app/.env.local`): `VITE_API_BASE_URL`, `VITE_DEVICE_SECRET`, `VITE_MOCK_API`. After you know the Render URL, put the same origin in `app.json` `network.whitelist` (or run `npm run pack`, which syncs it).

Private install: [docs/even-private-install.md](docs/even-private-install.md). Pagination: [docs/g2-pagination.md](docs/g2-pagination.md).

## Apple Shortcut

The Shortcut must **only** take a photo and upload it. Do not call OpenAI, split text, or send iMessage. Step-by-step: [docs/apple-shortcut.md](docs/apple-shortcut.md).

Action Button: Settings → Action Button → Shortcut → **G2 Vision AI**.

## Render

Free web service, Node 22, health `/health`. Blueprint: `render.yaml`. Walkthrough: [docs/render-deployment.md](docs/render-deployment.md).

Cold start: the first request after idle can take tens of seconds. The glasses app shows **Server waking up…** and keeps polling.

## Environment Variables

| Name | Where | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Render only | Never in git, Shortcut, or the Even app |
| `OPENAI_MODEL` | Render | Default `gpt-4o-mini` |
| `G2_DEVICE_SECRET` | Render + Shortcut + `VITE_DEVICE_SECRET` | Long random bearer token |
| `PORT` | Render | Provided automatically |
| `RESULT_TTL_SECONDS` | Render | Default 3600 |
| `MAX_UPLOAD_MB` | Render | Default 8 |
| `IMAGE_MAX_EDGE` | Render | Default 1600 |
| `IMAGE_JPEG_QUALITY` | Render | Default 80 |
| `VITE_API_BASE_URL` | Even app build | `https://YOUR-SERVICE.onrender.com` |
| `VITE_DEVICE_SECRET` | Even app build | Same as `G2_DEVICE_SECRET` |
| `VITE_MOCK_API` | Even app build | `true` for demo pages |

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
| Glasses stay on Ready | URL not in `app.json` whitelist, CORS, or app not rebuilt | Sync whitelist, redeploy, pack |
| Server waking up… | Render free spin-down | Wait; polling continues |
| Same answer never updates | Deduped `jobId` | Take a new photo, or menu → Refresh |
| Blank HUD | Bridge not awaited | App already awaits `waitForEvenAppBridge()` |
| Memory empty after deploy | In-memory store | Expected on restart; take another photo |

## Security

- `OPENAI_API_KEY` exists only as a Render env var.
- Photos are optimized in RAM, sent to OpenAI, then buffers are zeroed. No disk archive.
- Logs record job ids, byte sizes, timings — not image bytes, not full answers.
- Results expire (`RESULT_TTL_SECONDS`).
- Auth is a single personal bearer token (timing-safe compare). This is a one-user V1, not multi-tenant.

## Privacy

Default behavior: no photo persistence, automatic image deletion after analysis, TTL on answers, no OpenAI key on device. Render may still receive the image in transit to OpenAI under [OpenAI's API data usage](https://developers.openai.com/api/docs/guides/images-vision).

## Project Structure

```text
backend/          Fastify API, OpenAI Responses vision, tests
even-app/         Even Hub Vite app, pagination, HUD
docs/             Shortcut, Render, local, G2 install, references
render.yaml       Render Blueprint
.env.example      All env names, no secrets
```

## Future (not in V1)

G2 voice question, conversation history, follow-ups, custom prompts, web search, per-user accounts, Redis, WebSockets/push, photo history. The job store and analysis modes are extension points only.

Official sources: [docs/references.md](docs/references.md).
