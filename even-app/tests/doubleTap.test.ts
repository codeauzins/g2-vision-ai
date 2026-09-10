import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_WINDOW_MS, createDoubleTapGuard } from '../src/doubleTap.js';

describe('double tap guard', () => {
  it('does not treat a single tap as blank', () => {
    const guard = createDoubleTapGuard();
    const first = guard.onClick(1000);
    expect(first.action).toBe('wait');
    const token = first.action === 'wait' ? first.token : -1;
    expect(guard.onWaitElapsed(token, 1000 + DOUBLE_TAP_WINDOW_MS + 1).action).toBe('single');
  });

  it('toggles on two taps inside the window', () => {
    const guard = createDoubleTapGuard({ windowMs: 350 });
    expect(guard.onClick(0).action).toBe('wait');
    expect(guard.onClick(300).action).toBe('toggle');
  });

  it('does not toggle taps outside the window', () => {
    const guard = createDoubleTapGuard({ windowMs: 350 });
    const first = guard.onClick(0);
    expect(first.action).toBe('wait');
    const token = first.action === 'wait' ? first.token : -1;
    expect(guard.onWaitElapsed(token, 351).action).toBe('single');
    expect(guard.onClick(400).action).toBe('wait');
  });

  it('uses native DOUBLE_CLICK_EVENT as a toggle', () => {
    const guard = createDoubleTapGuard();
    expect(guard.onNativeDouble(10).action).toBe('toggle');
  });

  it('ignores bounce after a toggle', () => {
    const guard = createDoubleTapGuard({ bounceMs: 90 });
    expect(guard.onNativeDouble(0).action).toBe('toggle');
    expect(guard.onNativeDouble(50).action).toBe('ignore');
    expect(guard.onClick(60).action).toBe('ignore');
  });

  it('cancels a pending single tap when native double arrives', () => {
    const guard = createDoubleTapGuard({ windowMs: 350 });
    const first = guard.onClick(0);
    expect(first.action).toBe('wait');
    expect(guard.onNativeDouble(80).action).toBe('toggle');
    const token = first.action === 'wait' ? first.token : -1;
    expect(guard.onWaitElapsed(token, 350).action).toBe('ignore');
  });
});
