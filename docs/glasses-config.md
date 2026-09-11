# Glasses app config (VITE_*) vs Render

These three variables are **not** entered in the Render dashboard.

Render already has the API. The Even Hub / glasses app is a **separate** program that you build on your Mac. Vite bakes `VITE_*` into that program at build time.

| Variable | Where | What it is |
| --- | --- | --- |
| `OPENAI_API_KEY` | **Render only** | Pays for vision. Never put this in the glasses app. |
| `G2_DEVICE_SECRET` | **Render** | Shared password so only you can upload/poll. |
| `VITE_API_BASE_URL` | **Mac** `even-app/.env.local` | Where the glasses poll. Yours is already `https://g2-vision-ai.onrender.com`. |
| `VITE_DEVICE_SECRET` | **Mac** `even-app/.env.local` | **Copy of** `G2_DEVICE_SECRET`. Same string, two places. |
| `VITE_MOCK_API` | **Mac** `even-app/.env.local` | `false` for real photos. `true` = fake demo text, ignores Render. |

## What you do

1. In Render → Environment, confirm `G2_DEVICE_SECRET` (and `OPENAI_API_KEY`) are set. Copy the secret.
2. On your Mac, edit `even-app/.env.local`:

```bash
VITE_API_BASE_URL=https://g2-vision-ai.onrender.com
VITE_DEVICE_SECRET=paste-the-render-secret-here
VITE_MOCK_API=false
```

3. Rebuild/pack the glasses app (`npm run pack`) so that secret is inside **Ask AI**. Changing Render env does not update an already-installed glasses app.

Ask AI starts on **Checking OpenAI key…**, then polls `/api/latest`. A stored previous job must show Ready or that answer, not stay on Checking. Invalid `OPENAI_API_KEY` still becomes a glasses error. `/health` does not perform the live key test.

You never paste `VITE_*` into Render.

## Disk `/var/data2`

Photos are stored as optimized JPEGs (not originals) under `G2_DATA_DIR/images` so you can review them on `/admin`. Increase `RESULT_TTL_SECONDS` if you want them to last longer than a week.
