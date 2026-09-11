import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ACTIVITY_LOG_MAX = 200;
export const ACTIVITY_DEDUPE_MS = 1_500;

export type ActivitySource = 'server' | 'glasses';

export type ActivityEntry = {
  id: string;
  at: string;
  source: ActivitySource;
  message: string;
  detail?: string;
};

export interface ActivityLog {
  add(input: { source: ActivitySource; message: string; detail?: string; at?: string }): Promise<ActivityEntry>;
  list(limit?: number): Promise<ActivityEntry[]>;
}

export class MemoryActivityLog implements ActivityLog {
  protected entries: ActivityEntry[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async add(input: { source: ActivitySource; message: string; detail?: string; at?: string }): Promise<ActivityEntry> {
    const message = input.message.replace(/\s+/g, ' ').trim().slice(0, 180);
    const detail = input.detail?.replace(/\s+/g, ' ').trim().slice(0, 240) || undefined;
    const atMs = input.at ? Date.parse(input.at) : this.now();
    const at = Number.isFinite(atMs) ? new Date(atMs).toISOString() : new Date(this.now()).toISOString();
    const newest = this.entries[0];
    if (
      newest &&
      newest.source === input.source &&
      newest.message === message &&
      Math.abs(Date.parse(newest.at) - Date.parse(at)) < ACTIVITY_DEDUPE_MS
    ) {
      return newest;
    }
    const entry: ActivityEntry = {
      id: randomUUID(),
      at,
      source: input.source,
      message: message || '(empty)',
      detail,
    };
    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, ACTIVITY_LOG_MAX);
    return entry;
  }

  async list(limit = 150): Promise<ActivityEntry[]> {
    return this.entries.slice(0, Math.max(1, limit));
  }
}

export class FileActivityLog extends MemoryActivityLog {
  constructor(
    private readonly filePath: string,
    now?: () => number,
  ) {
    super(now);
    this.loadSync();
  }

  override async add(input: { source: ActivitySource; message: string; detail?: string; at?: string }): Promise<ActivityEntry> {
    const before = this.entries[0]?.id;
    const entry = await super.add(input);
    if (entry.id !== before) await this.flush();
    return entry;
  }

  private loadSync(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as { entries?: ActivityEntry[] };
      if (!Array.isArray(parsed.entries)) return;
      this.entries = parsed.entries
        .filter((row) => row && typeof row.message === 'string')
        .slice(0, ACTIVITY_LOG_MAX);
    } catch {
      this.entries = [];
    }
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
  }
}
