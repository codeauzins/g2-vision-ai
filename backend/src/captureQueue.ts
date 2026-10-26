export type CaptureTicket = {
  jobId: string;
  frames: number;
  mode: string;
  question?: string;
  createdAt: number;
  claimedAt?: number;
};

export class CaptureQueue {
  private pending: CaptureTicket[] = [];
  private claimed = new Map<string, CaptureTicket>();

  enqueue(ticket: CaptureTicket): void {
    this.remove(ticket.jobId);
    this.pending.push(ticket);
  }

  claim(now: number, staleClaimMs: number): CaptureTicket | null {
    const stale = [...this.claimed.values()]
      .filter((ticket) => ticket.claimedAt && now - ticket.claimedAt > staleClaimMs)
      .sort((a, b) => (a.claimedAt ?? 0) - (b.claimedAt ?? 0));
    for (const ticket of stale) {
      this.claimed.delete(ticket.jobId);
      ticket.claimedAt = undefined;
    }
    this.pending = [...stale, ...this.pending];
    const next = this.pending.shift();
    if (!next) return null;
    next.claimedAt = now;
    this.claimed.set(next.jobId, next);
    return { ...next };
  }

  getClaimed(jobId: string): CaptureTicket | undefined {
    const ticket = this.claimed.get(jobId);
    return ticket ? { ...ticket } : undefined;
  }

  finish(jobId: string): void {
    this.remove(jobId);
  }

  remove(jobId: string): void {
    this.claimed.delete(jobId);
    this.pending = this.pending.filter((ticket) => ticket.jobId !== jobId);
  }

  stale(now: number, waitMs: number, maxMs: number): CaptureTicket[] {
    const out: CaptureTicket[] = [];
    for (const ticket of this.pending) {
      if (now - ticket.createdAt >= waitMs) out.push(ticket);
    }
    for (const ticket of this.claimed.values()) {
      if (now - ticket.createdAt >= maxMs) out.push(ticket);
    }
    return out;
  }
}

export function clampFrameCount(value: unknown, fallback = 5, max = 5): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}
