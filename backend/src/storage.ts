import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type JobStatus = 'processing' | 'complete' | 'error';

export type JobRecord = {
  jobId: string;
  status: JobStatus;
  seq: number;
  mode: string;
  deviceId?: string;
  answer?: string;
  error?: string;
  errorCode?: string;
  question?: string;
  hasImage?: boolean;
  imageMime?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
};

export type JobView = Omit<JobRecord, 'expiresAt'>;

export interface ResultStore {
  create(job: JobRecord): Promise<void>;
  update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined>;
  get(jobId: string): Promise<JobRecord | undefined>;
  latest(): Promise<JobRecord | undefined>;
  list(limit?: number): Promise<JobRecord[]>;
  saveImage(jobId: string, bytes: Buffer, mimeType?: string): Promise<void>;
  getImage(jobId: string): Promise<{ bytes: Buffer; mimeType: string } | undefined>;
  purgeExpired(now?: number): Promise<number>;
}

export function toJobView(job: JobRecord): JobView {
  const { expiresAt: _expiresAt, ...view } = job;
  return view;
}

/**
 * In-memory personal store. Render restarts wipe it.
 * Swap this class for Redis/Postgres later; callers only use ResultStore.
 */
export class MemoryResultStore implements ResultStore {
  protected readonly jobs = new Map<string, JobRecord>();
  protected readonly images = new Map<string, { bytes: Buffer; mimeType: string }>();
  protected latestId: string | undefined;

  async create(job: JobRecord): Promise<void> {
    this.jobs.set(job.jobId, job);
    this.latestId = job.jobId;
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined> {
    const current = this.jobs.get(jobId);
    if (!current) return undefined;
    const next = { ...current, ...patch, jobId, updatedAt: patch.updatedAt ?? new Date().toISOString() };
    this.jobs.set(jobId, next);
    this.latestId = jobId;
    return next;
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.jobs.get(jobId);
  }

  async latest(): Promise<JobRecord | undefined> {
    if (!this.latestId) return undefined;
    return this.jobs.get(this.latestId);
  }

  async list(limit = 80): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .sort((a, b) => b.seq - a.seq)
      .slice(0, Math.max(1, limit));
  }

  async saveImage(jobId: string, bytes: Buffer, mimeType = 'image/jpeg'): Promise<void> {
    this.images.set(jobId, { bytes: Buffer.from(bytes), mimeType });
    const current = this.jobs.get(jobId);
    if (current) {
      this.jobs.set(jobId, { ...current, hasImage: true, imageMime: mimeType });
    }
  }

  async getImage(jobId: string): Promise<{ bytes: Buffer; mimeType: string } | undefined> {
    return this.images.get(jobId);
  }

  async purgeExpired(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.expiresAt <= now) {
        this.jobs.delete(id);
        this.images.delete(id);
        removed += 1;
        if (this.latestId === id) this.latestId = undefined;
      }
    }
    if (!this.latestId && this.jobs.size > 0) {
      let newest: JobRecord | undefined;
      for (const job of this.jobs.values()) {
        if (!newest || job.seq > newest.seq) newest = job;
      }
      this.latestId = newest?.jobId;
    }
    return removed;
  }
}

type FileShape = { latestId?: string; jobs: JobRecord[] };

/**
 * Persists job JSON and optimized JPEGs to a disk directory such as Render /var/data2.
 */
export class FileResultStore extends MemoryResultStore {
  private readonly imagesDir: string;

  constructor(private readonly filePath: string) {
    super();
    this.imagesDir = join(dirname(filePath), 'images');
    this.loadSync();
  }

  override async create(job: JobRecord): Promise<void> {
    await super.create(job);
    await this.flush();
  }

  override async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined> {
    const next = await super.update(jobId, patch);
    await this.flush();
    return next;
  }

  override async saveImage(jobId: string, bytes: Buffer, mimeType = 'image/jpeg'): Promise<void> {
    await mkdir(this.imagesDir, { recursive: true });
    await writeFile(this.imagePath(jobId), bytes);
    await super.saveImage(jobId, bytes, mimeType);
    await this.flush();
  }

  override async getImage(jobId: string): Promise<{ bytes: Buffer; mimeType: string } | undefined> {
    const memory = await super.getImage(jobId);
    if (memory) return memory;
    try {
      const bytes = await readFile(this.imagePath(jobId));
      const job = this.jobs.get(jobId);
      return { bytes, mimeType: job?.imageMime || 'image/jpeg' };
    } catch {
      return undefined;
    }
  }

  override async purgeExpired(now = Date.now()): Promise<number> {
    const doomed: string[] = [];
    for (const [id, job] of this.jobs) {
      if (job.expiresAt <= now) doomed.push(id);
    }
    const removed = await super.purgeExpired(now);
    await Promise.all(
      doomed.map(async (id) => {
        try {
          await unlink(this.imagePath(id));
        } catch {
          // File may already be gone.
        }
      }),
    );
    if (removed > 0) await this.flush();
    return removed;
  }

  private imagePath(jobId: string): string {
    return join(this.imagesDir, `${jobId}.jpg`);
  }

  private loadSync(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as FileShape;
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      for (const job of jobs) {
        if (job?.jobId) this.jobs.set(job.jobId, job);
      }
      this.latestId = parsed.latestId;
      if (this.latestId && !this.jobs.has(this.latestId)) this.latestId = undefined;
    } catch {
      this.jobs.clear();
      this.latestId = undefined;
    }
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload: FileShape = {
      latestId: this.latestId,
      jobs: [...this.jobs.values()],
    };
    await writeFile(this.filePath, JSON.stringify(payload), 'utf8');
  }
}
