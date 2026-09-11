import type { JobView } from './types.js';

/** Native G2 list container: max 20 rows, 64 characters each. */
export const HISTORY_LIST_MAX = 20;
export const HISTORY_ITEM_CHARS = 64;

/** Newest first. Complete answers and error jobs that have something to show. */
export function jobsForHistory(jobs: JobView[]): JobView[] {
  const byId = new Map<string, JobView>();
  for (const job of jobs) {
    if (!job?.jobId) continue;
    if (job.status === 'complete' && job.answer) byId.set(job.jobId, job);
    else if (job.status === 'error' && (job.error || job.errorCode)) byId.set(job.jobId, job);
  }
  return [...byId.values()].sort((a, b) => b.seq - a.seq).slice(0, HISTORY_LIST_MAX);
}

export function mergeHistory(current: JobView[], incoming: JobView[]): JobView[] {
  return jobsForHistory([...incoming, ...current]);
}

export function historyTitle(base: string, index: number, total: number): string {
  if (total > 1 && index > 0) return `${base} ${index + 1}/${total}`;
  return base;
}

export function jobListLabels(jobs: JobView[]): string[] {
  return jobs.slice(0, HISTORY_LIST_MAX).map((job, index) => jobListLabel(job, index));
}

export function jobListLabel(job: JobView, index: number): string {
  const prefix = `${index + 1} `;
  const time = shortTime(job.createdAt);
  const snippet = (job.answer || job.error || 'Failed').replace(/\s+/g, ' ').trim();
  return `${prefix}${time}${snippet}`.slice(0, HISTORY_ITEM_CHARS);
}

function shortTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} `;
}
