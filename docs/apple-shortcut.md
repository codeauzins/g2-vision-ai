# Apple Shortcut + Apple Watch

Primary path: **Watch or iPhone Shortcut asks Render to capture**. The Raspberry Pi takes five photos. Render sends all five to OpenAI. The Shortcut polls until the answer is ready and shows it on the Watch. The G2 HUD still updates via `GET /api/latest`.

The Shortcut does **not** call OpenAI and does **not** talk to the Pi on the LAN.

Replace `https://g2-vision-ai.onrender.com` if your URL differs. Use the same hex as `G2_DEVICE_SECRET`.

## Watch / Action Button: Pi burst (recommended)

On iPhone, Shortcuts → **+**. Name it **G2 Vision AI**.

### 1. Get Contents of URL — start capture

URL: `https://g2-vision-ai.onrender.com/api/capture`

- Method: **POST**
- Request Body: **Form**

| Key | Type | Value |
| --- | --- | --- |
| `token` | Text | `G2_DEVICE_SECRET` (hex only) |
| `mode` | Text | `general` |
| `device_id` | Text | `watch` |

### 2. Get Dictionary Value

From the **Get Contents of URL** result, get `jobId`.

If Shortcuts stores the response as text, add **Get Dictionary from Input** first.

### 3. Repeat 25 times

Inside the loop:

1. **Wait** 1.5 seconds.
2. **Get Contents of URL**  
   `https://g2-vision-ai.onrender.com/api/result/JOB_ID?token=YOUR_SECRET`  
   (use the `jobId` variable in the path)
3. Method: **GET**
4. **Get Dictionary Value** `status`
5. **If** status is `complete` → **Get Dictionary Value** `answer` → **Show Result** (Watch) → **Stop this Shortcut**
6. **If** status is `error` → **Get Dictionary Value** `error` → **Show Result** → **Stop this Shortcut**

25 × 1.5s ≈ 37s. The Pi burst plus OpenAI usually finishes sooner. If the Pi is offline, Render returns `Camera did not respond` after about 25s.

Add the Shortcut to **Apple Watch** (Watch app → Shortcuts) and optionally bind **Action Button** to it.

Pi install: [raspberry-pi.md](raspberry-pi.md).

## Optional: iPhone camera upload (old path)

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
