from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def _bool(name: str, default: bool = False) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class PiConfig:
    api_base_url: str
    device_secret: str
    frames: int
    interval_ms: int
    width: int
    height: int
    shutter_us: int
    poll_ms: int
    keep_photos: bool
    photo_dir: str
    jpeg_quality: int

    @classmethod
    def from_env(cls) -> "PiConfig":
        base = (os.environ.get("G2_API_BASE_URL") or "https://g2-vision-ai.onrender.com").rstrip("/")
        secret = (os.environ.get("G2_DEVICE_SECRET") or "").strip()
        if not secret:
            raise SystemExit("G2_DEVICE_SECRET is required")
        return cls(
            api_base_url=base,
            device_secret=secret,
            frames=max(1, min(5, _int("G2_PI_FRAMES", 5))),
            interval_ms=max(50, _int("G2_PI_INTERVAL_MS", 300)),
            width=_int("G2_PI_WIDTH", 2304),
            height=_int("G2_PI_HEIGHT", 1296),
            shutter_us=_int("G2_PI_SHUTTER_US", 2000),
            poll_ms=max(250, _int("G2_PI_POLL_MS", 800)),
            keep_photos=_bool("G2_PI_KEEP_PHOTOS", False),
            photo_dir=os.environ.get("G2_PI_PHOTO_DIR") or "/tmp/g2-pi-cam",
            jpeg_quality=max(50, min(95, _int("G2_PI_JPEG_QUALITY", 70))),
        )
