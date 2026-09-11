# Local development

Requires Node 20+ (22 recommended). Python is not used.

## Install

```bash
cd g2-vision-ai
cp .env.example .env
# set G2_DEVICE_SECRET; set OPENAI_API_KEY only if you want live vision
npm install
```

`npm run dev` in the backend loads `.env` from the repo root or `backend/.env` via `process.loadEnvFile`.

## Commands

From the repo root:

```bash
npm run dev            # backend + even-app Vite together
npm run dev:backend
npm run dev:app
npm test
npm run lint
npm run typecheck
npm run build
npm run format
npm run simulate       # evenhub-simulator → http://localhost:5173
npm run pack           # sync whitelist, build even-app, write .ehpk
```

Backend workspace scripts: `npm run dev -w backend`, `npm test -w backend`, etc.

## Run the API

```bash
npm run dev:backend
# listens on http://127.0.0.1:8787
curl http://127.0.0.1:8787/health
# Admin UI (password = G2_ADMIN_PASSWORD or G2_DEVICE_SECRET):
# http://127.0.0.1:8787/admin
```

## Curl upload

Create a tiny JPEG if you do not have one:

```bash
# macOS
sips -s format jpeg /System/Library/Desktop\ Pictures/Solid\ Colors/Black.png --out /tmp/g2-test.jpg
```

Or any camera JPEG.

```bash
export SECRET=dev-secret-change-me   # must match G2_DEVICE_SECRET
curl -sS -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/tmp/g2-test.jpg \
  "http://127.0.0.1:8787/api/analyze?mode=general&device_id=dev"
```

Expect `{"ok":true,"jobId":"...","status":"processing"}`.

```bash
curl -sS -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:8787/api/latest
```

Multipart form (what a Form-style Shortcut sends):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $SECRET" \
  -F "image=@/tmp/g2-test.jpg;type=image/jpeg" \
  -F "mode=general" \
  -F "device_id=iphone" \
  http://127.0.0.1:8787/api/analyze
```

Without `OPENAI_API_KEY`, jobs complete with an OpenAI error payload. Tests never call OpenAI; they inject a mock `VisionClient`.

## Even app locally

```bash
cp even-app/.env.example even-app/.env.local
# VITE_MOCK_API=true  → 5-page demo, no backend
# or point VITE_API_BASE_URL at http://127.0.0.1:8787 and set VITE_DEVICE_SECRET
npm run dev:app
npm run simulate
```

QR onto real glasses (same Wi-Fi, Developer Mode on):

```bash
ipconfig getifaddr en0
npx evenhub qr --url "http://YOUR-LAN-IP:5173"
```

Local Testing skips some permission prompts. Packaged private installs enforce the `network` whitelist.

## Image pipeline

iPhone originals can be tens of megapixels. Before OpenAI, Sharp:

- auto-orients
- fits inside `IMAGE_MAX_EDGE` (default 1600) without upscaling
- JPEG quality `IMAGE_JPEG_QUALITY` (default 80)

That is enough for OCR of typical menus/signs and far smaller than a 48MP upload. Documented also in README privacy/speed sections.
