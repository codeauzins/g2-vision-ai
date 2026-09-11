import { describe, expect, it } from 'vitest';
import {
  HISTORY_ITEM_CHARS,
  HISTORY_LIST_MAX,
  historyTitle,
  jobListLabel,
  jobListLabels,
  jobListWords,
  jobsForHistory,
  mergeHistory,
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
  it('keeps newest first, skips processing, and caps at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      job({ jobId: `j${i}`, seq: i + 1, answer: `answer ${i + 1}` }),
    );
    const list = jobsForHistory([
      ...many,
      job({ jobId: 'busy', seq: 99, status: 'processing', answer: undefined }),
    ]);
    expect(list).toHaveLength(HISTORY_LIST_MAX);
    expect(list[0]?.seq).toBe(25);
    expect(list.some((j) => j.jobId === 'busy')).toBe(false);
  });

  it('builds a one-line HH:MM plus 1-2 word row', () => {
    const label = jobListLabel(
      job({
        createdAt: '2026-09-11T12:04:00.000Z',
        answer: 'Street menu lunch board with a very long line of text that must be cut',
      }),
      0,
    );
    expect(label).toMatch(/^\d{2}:\d{2}\s{2}Street menu$/);
    expect(label).not.toContain('lunch');
    expect(label.length).toBeLessThanOrEqual(HISTORY_ITEM_CHARS);
    expect(jobListWords('Street menu, lunch board.')).toBe('Street menu');
    expect(jobListWords('Failed')).toBe('Failed');
  });

  it('labels selected jobs in the HUD title', () => {
    expect(historyTitle('Ask AI', 0, 3)).toBe('Ask AI');
    expect(historyTitle('Ask AI', 1, 3)).toBe('Ask AI 2/3');
  });

  it('maps jobs to list labels in newest-first order', () => {
    const labels = jobListLabels([
      job({ jobId: 'new', seq: 2, answer: 'Fresh' }),
      job({ jobId: 'old', seq: 1, answer: 'Older' }),
    ]);
    expect(labels[0]).toContain('Fresh');
    expect(labels[1]).toContain('Older');
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
