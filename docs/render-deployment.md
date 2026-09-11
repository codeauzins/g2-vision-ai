# Render deployment

Target: Render **Free** web service. Cold starts are expected.

Do not paste real API keys into git or into this file.

## 1. Sign into Render

Open [https://dashboard.render.com](https://dashboard.render.com) and sign in.

## 2. Connect GitHub

Connect the GitHub account `codeauzins` if Render has not already.

## 3. Choose the repository

Use **`codeauzins/g2-vision-ai`**.

You can either:

- **Blueprint**: New → Blueprint → select the repo (uses `render.yaml`), or
- **Web Service** manually with the settings below.

## 4. Create the web service

If creating by hand:

| Field | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Root directory | (leave empty — repo root) |
| Build command | `npm install && npm run build -w backend` |
| Start command | `npm run start -w backend` |
| Instance | Free |
| Health check path | `/health` |

`render.yaml` already sets Node 22, health path, and non-secret defaults.

## 5. Add environment variables

In the Render dashboard → Environment:

| Key | Value |
| --- | --- |
| `OPENAI_API_KEY` | your OpenAI secret key (required for real photos) |
| `G2_DEVICE_SECRET` | output of `openssl rand -hex 32` |
| `OPENAI_MODEL` | `gpt-4o-mini` unless you choose another vision-capable model |
| `G2_ADMIN_PASSWORD` | optional extra password for `https://YOUR-SERVICE.onrender.com/admin` |
| `RESULT_TTL_SECONDS` | `604800` (7 days of photo/answer history) |
| `MAX_UPLOAD_MB` | `8` |
| `IMAGE_MAX_EDGE` | `1600` |
| `IMAGE_JPEG_QUALITY` | `80` |

`PORT` is injected by Render. Do not hard-code it.

`OPENAI_API_KEY` and `G2_DEVICE_SECRET` are `sync: false` in `render.yaml`, so a Blueprint apply will prompt you to type them.

## 6. Deploy

Trigger the first deploy. Wait until the service is Live.

## 7. Find the URL

Copy the `https://….onrender.com` URL. Example shape: `https://g2-vision-ai.onrender.com`.

## 8. Test `/health`

```bash
curl https://YOUR-SERVICE.onrender.com/health
```

Expect:

```json
{"ok":true,"service":"g2-vision-ai","time":"..."}
```

The first call after idle may be slow (free-tier spin-up). Retry once.

Upload test (after you have a JPEG):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer YOUR_DEVICE_SECRET" \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg \
  https://YOUR-SERVICE.onrender.com/api/analyze
```

Then:

```bash
curl -sS -H "Authorization: Bearer YOUR_DEVICE_SECRET" \
  https://YOUR-SERVICE.onrender.com/api/latest
```

## 9. Put the URL into the Even app and Shortcut

1. Shortcut Get Contents of URL → `https://YOUR-SERVICE.onrender.com/api/analyze?mode=general&device_id=iphone`
2. `even-app/.env.local`:

```bash
VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com
VITE_DEVICE_SECRET=the-same-secret
VITE_MOCK_API=false
```

3. Network whitelist: Even Hub blocks fetch to origins not listed in `app.json`. Run from repo root:

```bash
VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com npm run pack
```

or edit `even-app/app.json` `permissions[0].whitelist` to that exact origin (no path, no wildcard).

4. Rebuild/sideload or private-install the app so the new env and whitelist ship.

## Cold start

Free instances sleep after idle. The next request pays a cold start (often 15–60s). The G2 app treats timeouts and 5xx as **Server waking up…** and keeps polling every 1.5s.

In-memory jobs die on restart. If you photograph during a deploy, take the photo again.

## Logs to look for

Structured logs (no image bytes, no full answer):

- `upload received` — size after optimize
- `openai started`
- `openai completed` — duration ms + character count
- `result ready`
