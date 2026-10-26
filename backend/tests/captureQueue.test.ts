import { describe, expect, it } from 'vitest';
import { CaptureQueue, clampFrameCount } from '../src/captureQueue.js';

describe('capture queue', () => {
  it('clamps frame counts', () => {
    expect(clampFrameCount('5')).toBe(5);
    expect(clampFrameCount(0)).toBe(1);
    expect(clampFrameCount(99, 5, 5)).toBe(5);
    expect(clampFrameCount('nope', 5)).toBe(5);
  });

  it('hands the oldest job to the Pi and requeues a stale claim', () => {
    const q = new CaptureQueue();
    q.enqueue({ jobId: 'a', frames: 5, mode: 'general', createdAt: 1_000 });
    q.enqueue({ jobId: 'b', frames: 5, mode: 'ocr', createdAt: 1_100 });
    const first = q.claim(1_200, 40_000);
    expect(first?.jobId).toBe('a');
    expect(q.claim(1_300, 40_000)?.jobId).toBe('b');
    const reclaimed = q.claim(50_000, 40_000);
    expect(reclaimed?.jobId).toBe('a');
  });

  it('marks unclaimed jobs stale after waitMs', () => {
    const q = new CaptureQueue();
    q.enqueue({ jobId: 'late', frames: 5, mode: 'general', createdAt: 1_000 });
    expect(q.stale(2_000, 25_000, 70_000)).toHaveLength(0);
    expect(q.stale(30_000, 25_000, 70_000)[0]?.jobId).toBe('late');
  });
});
