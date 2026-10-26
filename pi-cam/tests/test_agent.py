import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from camera import BurstCamera  # noqa: E402
from config import PiConfig  # noqa: E402
import agent  # noqa: E402


def cfg(photo_dir: str) -> PiConfig:
    return PiConfig(
        api_base_url="https://g2-vision-ai.onrender.com",
        device_secret="secret",
        frames=5,
        interval_ms=50,
        width=2304,
        height=1296,
        shutter_us=2000,
        poll_ms=800,
        keep_photos=False,
        photo_dir=photo_dir,
        jpeg_quality=85,
    )


class BurstTests(unittest.TestCase):
    def test_burst_writes_five_timestamped_jpegs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            def fake_capture(path: str) -> None:
                Path(path).write_bytes(b"jpeg")

            cam = BurstCamera(cfg(tmp), capture_file=fake_capture)
            frames = cam.capture_burst("job-a", 5)
            self.assertEqual(len(frames), 5)
            self.assertEqual([f.index for f in frames], [1, 2, 3, 4, 5])
            for frame in frames:
                self.assertTrue(Path(frame.path).is_file())
                self.assertTrue(frame.captured_at.endswith("Z"))
            second = BurstCamera(cfg(tmp), capture_file=fake_capture)
            # overlapping lock is per instance; busy flag is instance-local

    def test_multipart_includes_all_frames(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            frames = []
            cam = BurstCamera(cfg(tmp), capture_file=lambda path: Path(path).write_bytes(b"JPEGDATA"))
            frames = cam.capture_burst("job-b", 5)
            body, content_type = agent._multipart(frames, {"timestamps": "[]"})
            self.assertIn("multipart/form-data", content_type)
            self.assertEqual(body.count(b"JPEGDATA"), 5)
            self.assertIn(b'name="frame"', body)

    def test_run_once_uploads_then_deletes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = cfg(tmp)
            cam = BurstCamera(settings, capture_file=lambda path: Path(path).write_bytes(b"x"))
            with patch.object(
                agent,
                "poll_next",
                return_value={"jobId": "11111111-1111-4111-8111-111111111111", "frames": 5},
            ), patch.object(agent, "upload_frames", return_value={"status": "processing"}) as upload:
                self.assertTrue(agent.run_once(settings, cam))
                upload.assert_called_once()
                job_id, frames = upload.call_args.args[1], upload.call_args.args[2]
                self.assertEqual(job_id, "11111111-1111-4111-8111-111111111111")
                self.assertEqual(len(frames), 5)
                for frame in frames:
                    self.assertFalse(os.path.exists(frame.path))

    def test_idle_poll_returns_false(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = cfg(tmp)
            cam = BurstCamera(settings, capture_file=lambda path: Path(path).write_bytes(b"x"))
            with patch.object(agent, "poll_next", return_value=None):
                self.assertFalse(agent.run_once(settings, cam))


if __name__ == "__main__":
    unittest.main()
