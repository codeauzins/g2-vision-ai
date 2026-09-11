import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileActivityLog, MemoryActivityLog } from '../src/activityLog.js';

describe('activity log', () => {
  it('keeps newest first and dedupes rapid repeats', async () => {
    let t = 1_000;
    const log = new MemoryActivityLog(() => t);
    await log.add({ source: 'glasses', message: 'Checking OpenAI key…' });
    await log.add({ source: 'glasses', message: 'Checking OpenAI key…' });
    t = 5_000;
    await log.add({ source: 'glasses', message: 'Ready' });
    const rows = await log.list();
    expect(rows.map((row) => row.message)).toEqual(['Ready', 'Checking OpenAI key…']);
  });

  it('persists to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g2-log-'));
    const path = join(dir, 'activity.json');
    const first = new FileActivityLog(path);
    await first.add({ source: 'server', message: 'Analyzing…', detail: 'job abc' });
    const second = new FileActivityLog(path);
    const rows = await second.list();
    expect(rows[0]?.message).toBe('Analyzing…');
    expect(rows[0]?.detail).toBe('job abc');
  });
});
