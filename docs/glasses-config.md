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

You never paste `VITE_*` into Render.

## Disk `/var/data2`

Photos are still **not** saved (privacy). On Render, set `G2_DATA_DIR=/var/data2` so **answers** survive restarts as `/var/data2/jobs.json`. Redeploy after setting it (or pull the latest `main` which sets this in `render.yaml`).
