# Apple Shortcut + Action Button

The Shortcut does two things only:

1. Take a photo.
2. Upload it to your Render backend.

It does **not** call OpenAI, format text, paginate, send iMessage, or show the answer. The answer appears on the G2 via the Even Hub app.

Replace `https://YOUR-SERVICE.onrender.com` with your real Render URL. Replace `YOUR_DEVICE_SECRET` with the same value as `G2_DEVICE_SECRET`.

## Create the Shortcut

On iPhone, open **Shortcuts** → **All Shortcuts** → **+**.

Name it **G2 Vision AI**.

Add these actions, in order.

### 1. Take Photo

- Search actions: **Take Photo**
- Camera: **Rear** (or Front if you prefer)
- Show Camera Preview: **On**
- If the action offers “Use Photo from Last Taken”, leave that off. You want a new capture every Action Button press.

Output of this action is a photo. iPhones often produce HEIC. OpenAI and this backend want JPEG.

### 2. Convert Image

- Search: **Convert Image**
- Image: **Shortcut Input** is wrong here — set it to the **Take Photo** result (tap the magic variable).
- Convert to: **JPEG**
- Quality: **Most** (or High). Do not pick Smallest if you care about tiny menu text; the server also resizes to a 1600px edge.

If Convert Image is missing on your iOS version, add **Adjust Date** is not a workaround — instead use **Encode Media** / check that Take Photo is set to capture JPEG in its options. On current iOS, Convert Image is the reliable path.

### 3. Get Contents of URL (do not use File if headers disappear)

Use **Form**, not File. Headers still work, and this backend accepts that format.

1. Add **Get Contents of URL**.
2. URL:

`https://g2-vision-ai.onrender.com/api/analyze`

3. Tap **Show More**.
4. Method: **POST**.
5. Request Body: **Form** (not File, not JSON).
6. Add these Form fields:

| Key | Type | Value |
| --- | --- | --- |
| `image` | File | the **Convert Image** result |
| `token` | Text | your `G2_DEVICE_SECRET` / `VITE_DEVICE_SECRET` (the hex only, no `Bearer`) |
| `mode` | Text | `general` |
| `device_id` | Text | `iphone` |

If you still prefer File body: Headers will be missing on some iOS versions. Put the secret in the URL instead:

`https://g2-vision-ai.onrender.com/api/analyze?mode=general&device_id=iphone&token=YOUR_SECRET`

Request Body: **File** → Convert Image result. No headers needed.

Do **not** add an OpenAI header.

### 4. Stop and Do Not Show the Result

Add **Stop this Shortcut** (or leave the Get Contents result unused). You do not want a giant JSON overlay while you look at the glasses.

If Get Contents fails, Shortcuts will show an error. That is useful while you debug the URL/secret.

## First-run checks

1. Deploy Render and confirm `https://YOUR-SERVICE.onrender.com/health` returns `{"ok":true,...}` in Safari.
2. Run the Shortcut once by tapping it in the Shortcuts app (not the Action Button yet).
3. Grant Camera and Local Network / network permission if asked.
4. On success you should see nothing important on the phone; on the glasses, **Ask AI** should leave Ready and show Analyzing, then the answer.

## Bind to the Action Button

1. iPhone **Settings**
2. **Action Button**
3. Swipe to **Shortcut**
4. Choose **G2 Vision AI**

Press the Action Button: Camera appears → shoot → Shortcut uploads → look at G2.

## Modes later

You can duplicate the Shortcut and change the query:

- `?mode=ocr`
- `?mode=translate`
- `?mode=explain`
- `?mode=short`

V1 default is `general`. You do not need extra Shortcuts to ship.

## If upload fails

| Message / behavior | Fix |
| --- | --- |
| Could not connect | Render URL wrong, or service sleeping — open `/health` in Safari first |
| 401 | Secret mismatch. On Form, `token` must be the hex only. If you used File, put `?token=` in the URL after Render has the latest deploy. |
| HEIC / unsupported_type | Convert Image to JPEG is missing or not wired to the photo |
| File too large | Convert Image quality too high on a 48MP shot — still should fit 8 MB after JPEG; if not, add **Resize Image** longest edge 1920 before upload |
| 202 JSON on screen | Remove any “Show Result” / “Quick Look” actions |

## What not to add

- OpenAI actions or API keys
- Split Text / Repeat for paging
- Send Message / Notification as the answer path
- Wait + Get Contents of the result URL (the glasses app polls `/api/latest` itself)
