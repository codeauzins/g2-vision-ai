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
    checkApiKey: vi.fn(async () => ({
      ok: true,
      model: 'gpt-4o-mini',
      openaiKeySet: true,
    })),
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
        checkApiKey: overrides?.checkApiKey ?? vision.checkApiKey,
      },
      now: overrides?.now,
    });
    return { app, store };
  }

  it('tests the OpenAI key before the glasses show Ready', async () => {
    const { app } = await makeApp();
    const denied = await app.inject({ method: 'GET', url: '/api/openai' });
    expect(denied.statusCode).toBe(401);
    const res = await app.inject({
      method: 'GET',
      url: '/api/openai',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().openaiKeySet).toBe(true);
    expect(vision.checkApiKey).toHaveBeenCalledOnce();
    const cached = await app.inject({
      method: 'GET',
      url: '/api/openai',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(cached.json().cached).toBe(true);
    expect(vision.checkApiKey).toHaveBeenCalledOnce();
    await app.close();
  });

  it('reports a rejected OpenAI key without showing Ready', async () => {
    const { app } = await makeApp({
      checkApiKey: async () => ({
        ok: false,
        model: 'gpt-4o-mini',
        openaiKeySet: true,
        code: 'openai_auth',
        error: 'OpenAI key rejected',
      }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/openai',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.json().ok).toBe(false);
    expect(res.json().code).toBe('openai_auth');
    await app.close();
  });

  it('records glasses HUD lines in admin Logs', async () => {
    const { app } = await makeApp();
    const denied = await app.inject({ method: 'POST', url: '/api/hud', payload: { message: 'Checking OpenAI key…' } });
    expect(denied.statusCode).toBe(401);
    const posted = await app.inject({
      method: 'POST',
      url: '/api/hud',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      payload: { message: 'Checking OpenAI key…', kind: 'checking' },
    });
    expect(posted.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `password=${SECRET}`,
    });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const dash = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(dash.body).toContain('Logs');
    expect(dash.body).toContain('Checking OpenAI key');
    expect(dash.body).toContain('glasses');
    const fragment = await app.inject({ method: 'GET', url: '/admin/logs', headers: { cookie } });
    expect(fragment.body).toContain('Checking OpenAI key');
    await app.close();
  });

  it('health is public', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().version).toMatch(/^v\.0\.1\.\d+-[0-9a-f]{7}$/);
    expect(res.json().shortcutAuth).toContain('form_token');
    await app.close();
  });

  it('accepts a Shortcut-style query token with a raw JPEG body', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/analyze?mode=general&device_id=iphone&token=${SECRET}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: await jpeg(48),
    });
    expect(res.statusCode).toBe(202);
    const done = await waitForJob(app, String(res.json().jobId));
    expect(done.json().status).toBe('complete');
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

    const history = await app.inject({
      method: 'GET',
      url: '/api/history',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().results).toHaveLength(1);
    expect(history.json().results[0].answer).toContain('green square');
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

  it('protects the admin page and shows saved photos after login', async () => {
    const { app } = await makeApp();
    const locked = await app.inject({ method: 'GET', url: '/admin' });
    expect(locked.statusCode).toBe(200);
    expect(locked.body).toContain('Password');
    expect(locked.body).not.toContain('OpenAI prompt');

    const denied = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'password=nope',
    });
    expect(denied.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `password=${SECRET}`,
    });
    expect(login.statusCode).toBe(303);
    const cookie = String(login.headers['set-cookie'] || '');
    expect(cookie).toContain('g2_admin=');

    const created = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: await jpeg(48),
    });
    const jobId = String(created.json().jobId);
    await waitForJob(app, jobId);

    const dash = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { cookie: cookie.split(';')[0] },
    });
    expect(dash.body).toContain('OpenAI prompt');
    expect(dash.body).toContain('Logs');
    expect(dash.body).toContain(jobId);
    expect(dash.body).toContain('green square');

    const image = await app.inject({
      method: 'GET',
      url: `/admin/image/${jobId}`,
      headers: { cookie: cookie.split(';')[0] },
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toMatch(/image\/jpeg/);
    expect(image.rawPayload.length).toBeGreaterThan(32);

    const anonImage = await app.inject({ method: 'GET', url: `/admin/image/${jobId}` });
    expect(anonImage.statusCode).toBe(401);
    await app.close();
  });

  it('uses the admin-edited OpenAI prompt on the next photo', async () => {
    const seen: string[] = [];
    const { app } = await makeApp({
      analyze: async (input) => {
        seen.push(input.instructions || '');
        return 'ok';
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `password=${SECRET}`,
    });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const saved = await app.inject({
      method: 'POST',
      url: '/admin/settings',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'systemPrompt=Always mention BANANA.&userPrompt=Describe this.',
    });
    expect(saved.statusCode).toBe(303);

    const created = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'image/jpeg',
      },
      payload: await jpeg(),
    });
    await waitForJob(app, String(created.json().jobId));
    expect(seen.some((text) => text.includes('BANANA'))).toBe(true);
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

  it('reloads a stored photo from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g2-img-'));
    const file = join(dir, 'jobs.json');
    const first = new FileResultStore(file);
    await first.create({
      jobId: '11111111-1111-4111-8111-111111111111',
      status: 'complete',
      seq: 1,
      mode: 'general',
      answer: 'ok',
      createdAt: 't',
      updatedAt: 't',
      expiresAt: Date.now() + 60_000,
    });
    await first.saveImage('11111111-1111-4111-8111-111111111111', Buffer.from('jpeg-bytes'));
    const second = new FileResultStore(file);
    const image = await second.getImage('11111111-1111-4111-8111-111111111111');
    expect(image?.bytes.toString()).toBe('jpeg-bytes');
  });
});
