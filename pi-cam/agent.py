#!/usr/bin/env python3
"""Outbound-only Raspberry Pi camera agent for g2-vision-ai on Render."""

from __future__ import annotations

import json
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from camera import BurstCamera, CameraBusyError, Frame
from config import PiConfig


def _short(text: str, limit: int = 160) -> str:
    one = " ".join(text.split())
    if "<html" in one.lower() or one.lstrip().startswith("<!"):
        return "HTML error page"
    return one[:limit]


def _request(
    cfg: PiConfig,
    method: str,
    path: str,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {cfg.device_secret}",
        "Accept": "application/json",
    }
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(
        f"{cfg.api_base_url}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code} {path}: {_short(body)}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Network error {path}: {err.reason}") from err
    except (TimeoutError, socket.timeout) as err:
        raise RuntimeError(f"Timeout {path}") from err


def _retry(fn, attempts: int = 4, delay: float = 2.0):
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as err:
            last = err
            print(f"retry {i + 1}/{attempts}: {err}", flush=True)
            time.sleep(delay * (i + 1))
    assert last is not None
    raise last


def poll_next(cfg: PiConfig) -> dict[str, Any] | None:
    payload = _request(cfg, "GET", "/api/pi/next", timeout=20)
    job = payload.get("job")
    return job if isinstance(job, dict) else None


def _multipart(frames: list[Frame], extra: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----g2picam{int(time.time() * 1000)}"
    chunks: list[bytes] = []
    for key, value in extra.items():
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    for frame in frames:
        with open(frame.path, "rb") as fh:
            jpeg = fh.read()
        header = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="frame"; filename="frame-{frame.index}.jpg"\r\n'
            f"Content-Type: image/jpeg\r\n\r\n"
        ).encode("utf-8")
        chunks.append(header + jpeg + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def upload_frames(cfg: PiConfig, job_id: str, frames: list[Frame]) -> dict[str, Any]:
    extra = {
        "timestamps": json.dumps(
            [{"index": f.index, "capturedAt": f.captured_at, "elapsedMs": f.elapsed_ms} for f in frames]
        )
    }
    body, content_type = _multipart(frames, extra)
    print(f"uploading {job_id} bytes={len(body)}", flush=True)
    return _retry(
        lambda: _request(
            cfg,
            "POST",
            f"/api/pi/jobs/{job_id}/frames",
            data=body,
            content_type=content_type,
            timeout=120,
        ),
        attempts=4,
        delay=3,
    )


def delete_frames(cfg: PiConfig, frames: list[Frame]) -> None:
    if cfg.keep_photos:
        return
    import os

    for frame in frames:
        try:
            os.remove(frame.path)
        except OSError:
            pass


def run_once(cfg: PiConfig, camera: BurstCamera) -> bool:
    job = poll_next(cfg)
    if not job:
        return False
    job_id = str(job.get("jobId") or "")
    frames_wanted = int(job.get("frames") or cfg.frames)
    if not job_id:
        return False
    print(f"claimed {job_id} frames={frames_wanted}", flush=True)
    captured = camera.capture_burst(job_id, frames_wanted)
    try:
        result = upload_frames(cfg, job_id, captured)
        print(f"uploaded {job_id} status={result.get('status')}", flush=True)
    finally:
        delete_frames(cfg, captured)
    return True


def main() -> int:
    cfg = PiConfig.from_env()
    camera = BurstCamera(cfg)
    print(f"g2-pi-cam polling {cfg.api_base_url} frames={cfg.frames} {cfg.width}x{cfg.height}", flush=True)
    try:
        camera.start()
    except Exception as err:
        print(f"camera start failed: {err}", file=sys.stderr, flush=True)
        return 1
    try:
        while True:
            try:
                run_once(cfg, camera)
            except CameraBusyError:
                print("capture already running; skipping", flush=True)
            except Exception as err:
                msg = str(err)
                print(f"loop error: {_short(msg)}", file=sys.stderr, flush=True)
                extra = 4 if "name resolution" in msg.lower() or "timeout" in msg.lower() else 0
                time.sleep(extra)
            time.sleep(cfg.poll_ms / 1000)
    except KeyboardInterrupt:
        return 0
    finally:
        camera.close()


if __name__ == "__main__":
    raise SystemExit(main())
