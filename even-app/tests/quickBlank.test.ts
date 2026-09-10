import { describe, expect, it } from 'vitest';
import { decidePoll, resultScreen, waitingScreen } from '../src/state.js';
import {
  BLANK_HUD_CONTENT,
  applyPollWhileBlank,
  enterBlank,
  hudContentFor,
  leaveBlank,
  toggleBlank,
} from '../src/quickBlank.js';
import type { BlankSession } from '../src/quickBlank.js';
import type { JobView } from '../src/types.js';

const longAnswer = 'Page one stays here. '.repeat(40);

function resultSession(pageIndex = 2): BlankSession {
  const screen = {
    ...resultScreen(longAnswer, pageIndex, false),
    jobId: 'job-old',
    seq: 1,
  };
  return {
    isDisplayBlank: false,
    screen,
    currentAnswer: longAnswer,
    compact: false,
    restorePageIndex: 0,
  };
}

function job(patch: Partial<JobView>): JobView {
  return {
    jobId: 'job-new',
    status: 'complete',
    seq: 2,
    answer: 'Fresh answer from OpenAI.',
    ...patch,
  };
}

describe('quick blank', () => {
  it('double tap enters blank mode', () => {
    const next = toggleBlank(resultSession(2));
    expect(next.isDisplayBlank).toBe(true);
    expect(next.restorePageIndex).toBe(2);
    expect(next.currentAnswer).toBe(longAnswer);
    expect(hudContentFor(next, 'Ask AI')).toBe(BLANK_HUD_CONTENT);
  });

  it('double tap again restores the previous page', () => {
    const blanked = enterBlank(resultSession(2));
    const restored = leaveBlank(blanked);
    expect(restored.isDisplayBlank).toBe(false);
    expect(restored.screen.kind).toBe('result');
    expect(restored.screen.pageIndex).toBe(2);
    expect(restored.currentAnswer).toBe(longAnswer);
    expect(hudContentFor(restored, 'visible')).toBe('visible');
  });

  it('new complete result leaves blank and starts at page 1', () => {
    const blanked = enterBlank(resultSession(2));
    const decision = decidePoll('job-old:complete', job({ status: 'complete' }));
    expect(decision.kind).toBe('complete');
    const applied = applyPollWhileBlank(blanked, decision);
    expect(applied.continuePolling).toBe(true);
    expect(applied.session.isDisplayBlank).toBe(false);
    expect(applied.session.screen.pageIndex).toBe(0);
    expect(applied.session.currentAnswer).toBe('Fresh answer from OpenAI.');
    expect(applied.paint).toBe('hud');
  });

  it('keeps polling and prior page while a processing job is tracked', () => {
    const blanked = enterBlank(resultSession(2));
    const decision = decidePoll('job-old:complete', job({ status: 'processing', answer: undefined }));
    expect(decision.kind).toBe('processing');
    const applied = applyPollWhileBlank(blanked, decision);
    expect(applied.continuePolling).toBe(true);
    expect(applied.paint).toBe('none');
    expect(applied.session.isDisplayBlank).toBe(true);
    expect(applied.session.screen.pageIndex).toBe(2);
    expect(applied.session.currentAnswer).toBe(longAnswer);
    expect(applied.rememberKey).toBe('job-new:processing');
  });

  it('same job does not wake the HUD', () => {
    const blanked = enterBlank(resultSession(1));
    const applied = applyPollWhileBlank(
      blanked,
      decidePoll('job-old:complete', job({ jobId: 'job-old', seq: 1, answer: longAnswer })),
    );
    expect(applied.session.isDisplayBlank).toBe(true);
    expect(applied.paint).toBe('none');
    expect(applied.continuePolling).toBe(true);
  });

  it('waiting screen survives blank and restore', () => {
    const waiting: BlankSession = {
      isDisplayBlank: false,
      screen: { ...waitingScreen() },
      currentAnswer: '',
      compact: false,
      restorePageIndex: 0,
    };
    const restored = leaveBlank(enterBlank(waiting));
    expect(restored.screen.kind).toBe('waiting');
    expect(restored.isDisplayBlank).toBe(false);
  });
});
