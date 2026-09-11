import { describe, expect, it } from 'vitest';
import {
  historyTitle,
  jobsForHistory,
  mergeHistory,
  newerHistoryIndex,
  olderHistoryIndex,
} from '../src/jobHistory.js';
import type { JobView } from '../src/types.js';

const job = (patch: Partial<JobView>): JobView => ({
  jobId: 'a',
  status: 'complete',
  seq: 1,
  answer: 'one',
  ...patch,
});

describe('job history', () => {
  it('keeps newest first and skips processing', () => {
    const list = jobsForHistory([
      job({ jobId: 'old', seq: 1, answer: 'old' }),
      job({ jobId: 'new', seq: 3, answer: 'new' }),
      job({ jobId: 'busy', seq: 2, status: 'processing', answer: undefined }),
    ]);
    expect(list.map((j) => j.jobId)).toEqual(['new', 'old']);
  });

  it('long-press steps to an older job; tap steps back to newer', () => {
    expect(olderHistoryIndex(0, 3)).toBe(1);
    expect(olderHistoryIndex(1, 3)).toBe(2);
    expect(olderHistoryIndex(2, 3)).toBe(2);
    expect(newerHistoryIndex(2)).toBe(1);
    expect(newerHistoryIndex(1)).toBe(0);
    expect(newerHistoryIndex(0)).toBe(0);
  });

  it('labels older jobs in the HUD title', () => {
    expect(historyTitle('Ask AI', 0, 3)).toBe('Ask AI');
    expect(historyTitle('Ask AI', 1, 3)).toBe('Ask AI 2/3');
  });

  it('merges a new latest job to the front', () => {
    const merged = mergeHistory(
      [job({ jobId: 'old', seq: 1 })],
      [job({ jobId: 'fresh', seq: 4, answer: 'fresh' })],
    );
    expect(merged[0]?.jobId).toBe('fresh');
    expect(merged).toHaveLength(2);
  });
});
