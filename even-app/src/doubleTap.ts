/**
 * Native SDK double press is OsEventTypeList.DOUBLE_CLICK_EVENT (G2 or R1).
 * A software window still classifies two CLICK_EVENTs so a missing native
 * double-press cannot page-turn, and bounce cannot toggle twice.
 */
export const DOUBLE_TAP_WINDOW_MS = 350;
export const TAP_BOUNCE_MS = 90;

export type DoubleTapAction =
  | { action: 'wait'; token: number }
  | { action: 'toggle' }
  | { action: 'single' }
  | { action: 'ignore' };

export function createDoubleTapGuard(options?: { windowMs?: number; bounceMs?: number }) {
  const windowMs = options?.windowMs ?? DOUBLE_TAP_WINDOW_MS;
  const bounceMs = options?.bounceMs ?? TAP_BOUNCE_MS;
  let pendingClickAt: number | undefined;
  let lastToggleAt = Number.NEGATIVE_INFINITY;
  let generation = 0;

  return {
    windowMs,
    bounceMs,
    onClick(now: number): DoubleTapAction {
      if (now - lastToggleAt < bounceMs) return { action: 'ignore' };
      if (pendingClickAt != null && now - pendingClickAt <= windowMs) {
        pendingClickAt = undefined;
        generation += 1;
        lastToggleAt = now;
        return { action: 'toggle' };
      }
      pendingClickAt = now;
      generation += 1;
      return { action: 'wait', token: generation };
    },
    onNativeDouble(now: number): DoubleTapAction {
      if (now - lastToggleAt < bounceMs) return { action: 'ignore' };
      pendingClickAt = undefined;
      generation += 1;
      lastToggleAt = now;
      return { action: 'toggle' };
    },
    onWaitElapsed(token: number, now: number): DoubleTapAction {
      if (token !== generation || pendingClickAt == null) return { action: 'ignore' };
      if (now - pendingClickAt < windowMs) return { action: 'ignore' };
      pendingClickAt = undefined;
      return { action: 'single' };
    },
  };
}
