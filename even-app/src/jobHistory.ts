import type { JobView } from './types.js';

/** Newest first. Complete answers and error jobs that have something to show. */
export function jobsForHistory(jobs: JobView[]): JobView[] {
  const byId = new Map<string, JobView>();
  for (const job of jobs) {
    if (!job?.jobId) continue;
    if (job.status === 'complete' && job.answer) byId.set(job.jobId, job);
    else if (job.status === 'error' && (job.error || job.errorCode)) byId.set(job.jobId, job);
  }
  return [...byId.values()].sort((a, b) => b.seq - a.seq);
}

export function mergeHistory(current: JobView[], incoming: JobView[]): JobView[] {
  return jobsForHistory([...incoming, ...current]);
}

export function olderHistoryIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, index) + 1);
}

export function newerHistoryIndex(index: number): number {
  return Math.max(0, index - 1);
}

export function historyTitle(base: string, index: number, total: number): string {
  if (total > 1 && index > 0) return `${base} ${index + 1}/${total}`;
  return base;
}
