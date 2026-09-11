import { describe, expect, it } from 'vitest';
import {
  classifyFetchError,
  decidePoll,
  glassesErrorFromOpenAICheck,
  checkingScreen,
  nextIndex,
  prevIndex,
  processingScreen,
  shouldKeepHudOnPollError,
  waitingScreen,
} from '../src/state.js';
import type { JobView } from '../src/types.js';

const job = (patch: Partial<JobView>): JobView => ({
  jobId: 'job-1',
  status: 'complete',
  seq: 1,
  ...patch,
});

describe('result state', () => {
  it('starts in waiting', () => {
    const screen = waitingScreen();
    expect(screen.kind).toBe('waiting');
    expect(screen.body).toContain('Action Button');
    expect(screen.body).toContain('Ready');
  });

  it('does not show Ready until the OpenAI key check passes', () => {
    const checking = checkingScreen();
    expect(checking.body).toContain('Checking OpenAI');
    expect(checking.body).not.toContain('Ready');
    expect(glassesErrorFromOpenAICheck({ ok: false, code: 'openai_auth' })).toContain('OPENAI_API_KEY');
    expect(glassesErrorFromOpenAICheck({ ok: true })).toBe('');
  });

  it('shows processing copy', () => {
    const screen = processingScreen(3);
    expect(screen.body).toContain('Analyzing');
  });

  it('ignores the same completed job id', () => {
    expect(decidePoll('job-1:complete', job({ status: 'complete', answer: 'Hi' })).kind).toBe('same');
  });

  it('shows an error after the same job leaves processing', () => {
    const out = decidePoll(
      'job-1:processing',
      job({ status: 'error', error: 'AI could not analyze this photo.' }),
    );
    expect(out.kind).toBe('error');
  });

  it('treats a new processing job as processing', () => {
    const out = decidePoll('old', job({ jobId: 'job-2', status: 'processing' }));
    expect(out.kind).toBe('processing');
  });

  it('promotes a new complete answer', () => {
    const out = decidePoll('old', job({ jobId: 'job-2', answer: 'Done' }));
    expect(out.kind).toBe('complete');
  });

  it('maps empty store', () => {
    expect(decidePoll(undefined, null).kind).toBe('empty');
  });

  it('wraps page indexes', () => {
    expect(nextIndex(3, 4)).toBe(0);
    expect(prevIndex(0, 4)).toBe(3);
  });

  it('maps glasses-safe network errors', () => {
    expect(classifyFetchError(new Error('timeout'), 503)).toBe('Connection lost. Retrying…');
    expect(classifyFetchError(undefined, 401)).toBe('App authentication failed.');
    expect(classifyFetchError(new Error('Failed to fetch'))).toBe('Connection lost. Retrying…');
    expect(shouldKeepHudOnPollError('result', true)).toBe(true);
    expect(shouldKeepHudOnPollError('waiting', false)).toBe(false);
  });
});
