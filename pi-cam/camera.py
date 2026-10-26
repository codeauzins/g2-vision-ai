from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Callable

from config import PiConfig


@dataclass(frozen=True)
class Frame:
    index: int
    path: str
    captured_at: str
    elapsed_ms: int


class CameraBusyError(RuntimeError):
    pass


class BurstCamera:
    def __init__(self, cfg: PiConfig, capture_file: Callable[..., None] | None = None):
        self.cfg = cfg
        self._busy = False
        self._picam = None
        self._capture_file = capture_file

    def start(self) -> None:
        if self._capture_file is not None:
            return
        try:
            from libcamera import controls
            from picamera2 import Picamera2
        except ImportError as err:
            raise RuntimeError(
                "Picamera2 is not installed. On Raspberry Pi OS: sudo apt install -y python3-picamera2"
            ) from err
        picam = Picamera2()
        still = picam.create_still_configuration(
            main={"size": (self.cfg.width, self.cfg.height), "format": "RGB888"}
        )
        picam.configure(still)
        picam.options["quality"] = self.cfg.jpeg_quality
        picam.set_controls(
            {
                "AfMode": controls.AfModeEnum.Continuous,
                "ExposureTime": self.cfg.shutter_us,
            }
        )
        picam.start()
        time.sleep(0.6)
        self._picam = picam

    def close(self) -> None:
        if self._picam is not None:
            try:
                self._picam.stop()
                self._picam.close()
            finally:
                self._picam = None

    def capture_burst(self, job_id: str, frames: int | None = None) -> list[Frame]:
        if self._busy:
            raise CameraBusyError("A capture is already running")
        self._busy = True
        count = frames or self.cfg.frames
        os.makedirs(self.cfg.photo_dir, exist_ok=True)
        out: list[Frame] = []
        try:
            for index in range(count):
                started = time.monotonic()
                path = os.path.join(self.cfg.photo_dir, f"{job_id}-{index + 1}.jpg")
                self._snap(path)
                captured_at = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
                elapsed_ms = int((time.monotonic() - started) * 1000)
                out.append(Frame(index=index + 1, path=path, captured_at=captured_at, elapsed_ms=elapsed_ms))
                remaining = self.cfg.interval_ms / 1000 - (time.monotonic() - started)
                if remaining > 0 and index + 1 < count:
                    time.sleep(remaining)
            return out
        except Exception:
            self._cleanup(out)
            raise
        finally:
            self._busy = False

    def _snap(self, path: str) -> None:
        if self._capture_file is not None:
            self._capture_file(path)
            return
        if self._picam is None:
            raise RuntimeError("Camera is not started")
        self._picam.capture_file(path)

    def _cleanup(self, frames: list[Frame]) -> None:
        if self.cfg.keep_photos:
            return
        for frame in frames:
            try:
                os.remove(frame.path)
            except OSError:
                pass
