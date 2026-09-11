import type { JobView, PollOutcome, ScreenKind } from './types.js';
import { compactAnswer, formatHudPage, paginate } from './pagination.js';

export const TITLE = 'A-AI';

export function classifyFetchError(err: unknown, status?: number): string {
  if (status === 401 || status === 403) return 'App authentication failed.';
  if (status === 429) return 'Too many requests. Waiting…';
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/timeout|timed out|abort/i.test(message) || (status && status >= 500)) {
    return 'Connection lost. Retrying…';
  }
  if (/failed to fetch|network|offline|load failed/i.test(message)) {
    return 'Connection lost. Retrying…';
  }
  return 'Connection lost. Retrying…';
}

/** Poll blips must not wipe an answer already on the HUD. */
export function shouldKeepHudOnPollError(kind: ScreenKind, hasAnswer: boolean): boolean {
  if (hasAnswer) return true;
  return kind === 'result' || kind === 'processing';
}

/** A stored job must not leave the launch HUD on Checking OpenAI key… */
export function shouldApplySameJob(kind: ScreenKind): boolean {
  return kind === 'checking';
}

export function glassesErrorFromJob(job: JobView): string {
  if (job.errorCode === 'openai_timeout') return 'AI timed out. Try another photo.';
  if (job.errorCode === 'openai_auth') return 'OpenAI key rejected. Check Render OPENAI_API_KEY.';
  if (job.error) return job.error;
  return 'AI could not analyze this photo.';
}

export function displayKey(job: JobView): string {
  return `${job.jobId}:${job.status}`;
}

export function decidePoll(lastKey: string | undefined, job: JobView | null): PollOutcome {
  if (!job) return { kind: 'empty' };
  if (displayKey(job) === lastKey) return { kind: 'same', job };
  if (job.status === 'processing') return { kind: 'processing', job };
  if (job.status === 'error') return { kind: 'error', job };
  if (job.status === 'complete' && job.answer) return { kind: 'complete', job };
  return { kind: 'error', job: { ...job, error: 'Malformed result' } };
}

/** First HUD line for admin Logs (no page-turn spam). */
export function hudLogMessage(kind: ScreenKind, body: string): string {
  if (kind === 'result') return 'Answer shown';
  if (kind === 'processing') return 'Analyzing…';
  const first = body.split('\n')[0]?.trim();
  return first || kind;
}

export function glassesErrorFromOpenAICheck(check: {
  ok: boolean;
  code?: string;
  error?: string;
  openaiKeySet?: boolean;
}): string {
  if (check.ok) return '';
  if (!check.openaiKeySet || check.code === 'openai_auth') {
    return 'OpenAI key rejected. Check Render OPENAI_API_KEY.';
  }
  return check.error || 'OpenAI key check failed.';
}

export function checkingScreen(): {
  kind: ScreenKind;
  title: string;
  body: string;
  pages: string[];
  pageIndex: number;
} {
  const body = 'Checking OpenAI key…';
  return { kind: 'checking', title: TITLE, body, pages: [body], pageIndex: 0 };
}

export function waitingScreen(): {
  kind: ScreenKind;
  title: string;
  body: string;
  pages: string[];
  pageIndex: number;
} {
  const body = 'Ready\nPress iPhone Action Button and take a photo.';
  return { kind: 'waiting', title: TITLE, body, pages: [body], pageIndex: 0 };
}

export function processingScreen(tick = 0): {
  kind: ScreenKind;
  title: string;
  body: string;
  pages: string[];
  pageIndex: number;
} {
  const bar = progressBar(tick);
  const body = `Photo received\nAnalyzing...\n${bar}`;
  return { kind: 'processing', title: TITLE, body, pages: [body], pageIndex: 0 };
}

export function resultScreen(
  answer: string,
  pageIndex: number,
  compact: boolean,
  title = TITLE,
): {
  kind: ScreenKind;
  title: string;
  body: string;
  pages: string[];
  pageIndex: number;
} {
  const source = compact ? compactAnswer(answer) : answer;
  const { pages } = paginate(source);
  const index = clamp(pageIndex, 0, pages.length - 1);
  return {
    kind: 'result',
    title,
    body: pages[index] ?? '',
    pages,
    pageIndex: index,
  };
}

export function errorScreen(message: string, title = TITLE): {
  kind: ScreenKind;
  title: string;
  body: string;
  pages: string[];
  pageIndex: number;
} {
  const body = `${message}\n\nTap to retry. Menu → Exit to leave.`;
  return { kind: 'error', title, body, pages: [body], pageIndex: 0 };
}

export function renderScreen(kind: ScreenKind, title: string, body: string, index: number, total: number): string {
  if (kind === 'waiting' || kind === 'checking') {
    return formatHudPage(title, body, 0, 1);
  }
  return formatHudPage(title, body, index, Math.max(1, total));
}

export function nextIndex(index: number, total: number): number {
  if (total <= 1) return 0;
  return (index + 1) % total;
}

export function prevIndex(index: number, total: number): number {
  if (total <= 1) return 0;
  return (index - 1 + total) % total;
}

function progressBar(tick: number): string {
  const width = 8;
  const filled = (tick % (width + 1));
  return `${'━'.repeat(filled)}${'─'.repeat(width - filled)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
