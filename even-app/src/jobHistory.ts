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
  return jobs.slice(0, HISTORY_LIST_MAX).map((job) => jobListLabel(job));
}

/** One row: HH:MM then 1–2 words so it fits the G2 list line. */
export function jobListLabel(job: JobView, _index = 0): string {
  const time = clockTime(job.createdAt);
  const words = jobListWords(job.answer || job.error || (job.status === 'error' ? 'Failed' : 'Job'));
  const line = time ? `${time}  ${words}` : words;
  return line.slice(0, HISTORY_ITEM_CHARS);
}

export function jobListWords(text: string): string {
  const tokens = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter((token) => token.length > 0);
  const picked = tokens.slice(0, 2);
  if (!picked.length) return 'Job';
  return picked.join(' ').slice(0, 28);
}

function clockTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
