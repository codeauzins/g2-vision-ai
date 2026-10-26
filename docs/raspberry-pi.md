# Raspberry Pi camera — first-time setup

You only need SSH. Do **not** install a local backend on the Pi. The Pi only captures photos and uploads them to Render.

This Mac cannot reach `wildcam.local` (no route). Run the commands below **in your own terminal** while the Pi is on the same Wi-Fi (or the iPhone hotspot).

```text
Watch Shortcut → Render → Pi polls → 5 photos → Render → OpenAI → Watch + G2
```

## 1. SSH in

```bash
ssh pi@wildcam.local
```

If `.local` fails:

```bash
ping wildcam.local
hostname -I
```

Then `ssh pi@THAT_IP`.

## 2. Camera check (you already did this)

```bash
rpicam-hello --list-cameras
```

You want `imx708`. If that works, continue.

## 3. Install packages and clone the app

Paste this as `pi` (not root):

```bash
sudo apt update
sudo apt install -y git python3-picamera2 python3-libcamera
cd ~
git clone https://github.com/codeauzins/g2-vision-ai.git
cd ~/g2-vision-ai
git pull
cd pi-cam
python3 -m unittest discover -s tests -v
```

The unit tests do not need the camera. They should pass.

## 4. Secret file (same token as Render)

On the Pi:

```bash
sudo cp ~/g2-vision-ai/pi-cam/g2-pi-cam.env.example /etc/g2-pi-cam.env
sudo chmod 600 /etc/g2-pi-cam.env
sudo nano /etc/g2-pi-cam.env
```

Set:

- `G2_API_BASE_URL=https://g2-vision-ai.onrender.com`
- `G2_DEVICE_SECRET=` the **same** hex as Render `G2_DEVICE_SECRET` / `VITE_DEVICE_SECRET` (no `Bearer`, no quotes)

Save: Ctrl+O, Enter, Ctrl+X.

If the clone is not `/home/pi/g2-vision-ai`, edit those two paths in `g2-pi-cam.service` before copying it.

## 5. Start on boot

```bash
sudo cp ~/g2-vision-ai/pi-cam/g2-pi-cam.service /etc/systemd/system/g2-pi-cam.service
sudo systemctl daemon-reload
sudo systemctl enable --now g2-pi-cam
sudo journalctl -u g2-pi-cam -f
```

You should see a line like `g2-pi-cam polling https://g2-vision-ai.onrender.com`. Ctrl+C leaves the log; the service keeps running.

If it says Picamera2 is missing, the `apt install python3-picamera2` step failed.

## 6. Render must be updated first

The Pi calls `/api/capture` helpers that are on `main`. After you `git pull` / this commit is on GitHub, wait until Render finishes deploying. Until then the Pi will log `HTTP 404 /api/pi/next`.

On Render, keep `G2_DEVICE_SECRET` identical to `/etc/g2-pi-cam.env`.

## 7. Shortcut (iPhone / Watch)

Do **not** Take Photo. The Shortcut only starts a job:

1. POST `https://g2-vision-ai.onrender.com/api/capture` form fields `token`, `mode=general`, `device_id=watch`
2. Poll GET `https://g2-vision-ai.onrender.com/api/result/JOB_ID?token=YOUR_SECRET` until `status` is `complete` or `error`
3. Show `answer` on the Watch

Full taps: [apple-shortcut.md](apple-shortcut.md).

## Settings

| Env | Default | Meaning |
| --- | --- | --- |
| `G2_PI_FRAMES` | 5 | Photos per press |
| `G2_PI_INTERVAL_MS` | 300 | Target gap |
| `G2_PI_WIDTH` × height | 2304 × 1296 | Use 4608 × 2592 only if text is unreadable |
| `G2_PI_SHUTTER_US` | 2000 | 1/500 s |
| `G2_PI_POLL_MS` | 800 | How often the Pi asks Render |

Photos are deleted after upload unless `G2_PI_KEEP_PHOTOS=1`.
