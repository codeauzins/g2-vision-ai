import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { FileResultStore, MemoryResultStore } from '../src/storage.js';
import type { VisionClient } from '../src/openai.js';

const SECRET = 'test-device-secret';

async function jpeg(bytes = 32): Promise<Buffer> {
  return sharp({
    create: { width: bytes, height: bytes, channels: 3, background: { r: 20, g: 180, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

function config() {
  return {
    ...loadConfig({
      OPENAI_API_KEY: 'sk-test',
      G2_DEVICE_SECRET: SECRET,
      RESULT_TTL_SECONDS: '2',
      MAX_UPLOAD_MB: '1',
      RATE_LIMIT_MAX: '200',
    }),
    openaiApiKey: 'sk-test',
    deviceSecret: SECRET,
    resultTtlMs: 2_000,
    maxUploadBytes: 1024 * 1024,
    rateLimitMax: 200,
  };
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJob(app: Awaited<ReturnType<typeof buildApp>>, jobId: string) {
  for (let i = 0; i < 40; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/result/${jobId}`,
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const body = res.json();
    if (body.status !== 'processing') return res;
    await wait(25);
  }
  throw new Error(`job ${jobId} stayed processing`);
}

describe('g2-vision-ai backend', () => {
  const vision: VisionClient = {
    analyze: vi.fn(async () => 'A green square. This is a demo answer for glasses.'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  async function makeApp(overrides?: Partial<VisionClient> & { store?: MemoryResultStore; now?: () => number }) {
    const store = overrides?.store ?? new MemoryResultStore();
    const app = await buildApp({
      config: config(),
      store,
      vision: {
        analyze: overrides?.analyze ?? vision.analyze,
      },
      now: overrides?.now,
    });
    return { app, store };
  }

  it('health is public', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it('rejects unauthorized analyze', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: { 'content-type': 'image/jpeg' },
      payload: await jpeg(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    await app.close();
  });

  it('rejects missing image', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: { authorization: `Bearer ${SECRET}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('missing_image');
    await app.close();
  });

  it('rejects invalid image bytes', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: Buffer.from('not-an-image'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_image');
    await app.close();
  });

  it('rejects oversized payload', async () => {
    const { app } = await makeApp();
    const huge = Buffer.alloc(1024 * 1024 + 10, 1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: huge,
    });
    expect([413, 400]).toContain(res.statusCode);
    await app.close();
  });

  it('creates a job then returns the completed result and latest', async () => {
    const { app } = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyze?mode=general&device_id=iphone',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: await jpeg(64),
    });
    expect(created.statusCode).toBe(202);
    const { jobId } = created.json();
    expect(jobId).toBeTruthy();
    expect(created.json().status).toBe('processing');

    const result = await waitForJob(app, String(jobId));
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe('complete');
    expect(result.json().answer).toContain('green square');

    const latest = await app.inject({
      method: 'GET',
      url: '/api/latest',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(latest.json().result.jobId).toBe(jobId);
    expect(latest.json().result.seq).toBe(1);
    expect(vision.analyze).toHaveBeenCalledOnce();
    await app.close();
  });

  it('maps OpenAI errors to a glasses-safe message', async () => {
    const { app } = await makeApp({
      analyze: async () => {
        throw new Error('timeout from openai');
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: await jpeg(),
    });
    const result = await waitForJob(app, created.json().jobId as string);
    expect(result.json().status).toBe('error');
    expect(result.json().errorCode).toBe('openai_timeout');
    await app.close();
  });

  it('purges expired results', async () => {
    let t = 1_000;
    const store = new MemoryResultStore();
    const { app } = await makeApp({
      store,
      now: () => t,
    });
    await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: await jpeg(),
    });
    t = 1_000 + 3_000;
    const latest = await app.inject({
      method: 'GET',
      url: '/api/latest',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(latest.json().result).toBeNull();
    await app.close();
  });

  it('accepts multipart file field named image', async () => {
    const { app } = await makeApp();
    const img = await jpeg(48);
    const form = new FormData();
    form.append('mode', 'ocr');
    form.append('device_id', 'shortcut');
    form.append('image', new Blob([img], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: { authorization: `Bearer ${SECRET}` },
      payload: form,
    });
    expect(res.statusCode).toBe(202);
    const done = await waitForJob(app, String(res.json().jobId));
    expect(done.json().status).toBe('complete');
    await app.close();
  });

  it('returns empty latest without crashing', async () => {
    const { app } = await makeApp();
    const latest = await app.inject({
      method: 'GET',
      url: '/api/latest',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().result).toBeNull();
    await app.close();
  });

  it('rejects heic with a shortcut-friendly message', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/heic',
      },
      payload: Buffer.from('not-heic-but-typed-as-heic'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('unsupported_type');
    await app.close();
  });
});

describe('memory store', () => {
  it('does not crash when empty', async () => {
    const store = new MemoryResultStore();
    expect(await store.latest()).toBeUndefined();
    expect(await store.get('missing')).toBeUndefined();
    expect(await store.purgeExpired()).toBe(0);
  });
});

describe('file store', () => {
  it('reloads jobs from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g2-store-'));
    const file = join(dir, 'jobs.json');
    const first = new FileResultStore(file);
    await first.create({
      jobId: 'a',
      status: 'complete',
      seq: 1,
      mode: 'general',
      answer: 'ok',
      createdAt: 't',
      updatedAt: 't',
      expiresAt: Date.now() + 60_000,
    });
    const second = new FileResultStore(file);
    const latest = await second.latest();
    expect(latest?.jobId).toBe('a');
    expect(latest?.answer).toBe('ok');
  });
});
