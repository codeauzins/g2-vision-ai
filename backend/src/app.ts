import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config.js';
import { requestToken, newJobId, secretsEqual } from './auth.js';
import { HttpError, httpError } from './errors.js';
import { ImageError, isAllowedMime, normalizeMime, optimizeForVision, toDataUrl } from './image.js';
import { buildInstructions, parseMode, userPrompt } from './modes.js';
import type { OpenAIKeyCheck, VisionClient } from './openai.js';
import { MemoryResultStore, toJobView, type ResultStore } from './storage.js';
import { MemoryPromptStore, type PromptStore } from './settings.js';
import { MemoryActivityLog, type ActivityLog } from './activityLog.js';
import { registerAdminRoutes } from './admin.js';
import { APP_VERSION } from './version.js';
import { publicError } from './log.js';

export type AppDeps = {
  config: AppConfig;
  store?: ResultStore;
  prompts?: PromptStore;
  activity?: ActivityLog;
  vision: VisionClient;
  now?: () => number;
};

type IncomingImage = {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, vision } = deps;
  const store = deps.store ?? new MemoryResultStore();
  const prompts = deps.prompts ?? new MemoryPromptStore();
  const activity = deps.activity ?? new MemoryActivityLog(deps.now ?? Date.now);
  const now = deps.now ?? Date.now;
  let seq = 0;
  const KEY_CHECK_TTL_MS = 30_000;
  const KEY_CHECK_WAIT_MS = 5_000;
  let keyCheckCache: { at: number; result: OpenAIKeyCheck } | undefined;

  function note(source: 'server' | 'glasses', message: string, detail?: string): void {
    void activity.add({ source, message, detail });
  }

  const app = Fastify({
    disableRequestLogging: true,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'headers.authorization',
          'req.query.token',
          'req.query.secret',
        ],
        remove: true,
      },
    },
    bodyLimit: config.maxUploadBytes,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
  });

  await app.register(formbody);

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    allowList: (req) => {
      const path = (req.url || '').split('?')[0];
      return (
        path === '/health' ||
        path === '/api/latest' ||
        path === '/api/history' ||
        path === '/api/openai' ||
        path === '/api/hud'
      );
    },
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 8,
    },
  });

  app.addContentTypeParser(/^image\//, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: err.statusCode,
          code: err.code,
          error: err.message,
        },
        'http error',
      );
      return reply.status(err.statusCode).send({
        ok: false,
        error: err.message,
        code: err.code,
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) {
      request.log.warn({ url: request.url }, 'payload too large');
      return reply.status(413).send({
        ok: false,
        error: 'Image is too large',
        code: 'too_large',
      });
    }
    request.log.error({ err: publicError(err), url: request.url, method: request.method }, 'unhandled');
    return reply.status(500).send({
      ok: false,
      error: 'Server error',
      code: 'internal',
    });
  });

  function requireAuth(
    request: {
      log: FastifyInstance['log'];
      method: string;
      url: string;
      headers: { authorization?: string; 'content-type'?: string; 'x-g2-token'?: string | string[] };
      query?: unknown;
    },
    extraToken?: string,
  ): void {
    if (!config.deviceSecret) {
      request.log.error('G2_DEVICE_SECRET is not set');
      throw httpError(500, 'server_misconfigured', 'G2_DEVICE_SECRET is not set');
    }
    const query = (request.query ?? {}) as Record<string, unknown>;
    const headerToken = request.headers['x-g2-token'];
    const queryTok = asString(query.token) || asString(query.secret) || asString(query.access_token);
    const provided = requestToken({
      authorization: request.headers.authorization,
      xToken: Array.isArray(headerToken) ? headerToken[0] : headerToken,
      queryToken: extraToken || queryTok,
    });
    if (!provided) {
      request.log.warn(
        {
          method: request.method,
          url: request.url.split('?')[0],
          contentType: request.headers['content-type'],
          hasBearerHeader: Boolean(request.headers.authorization),
          hasQueryToken: Boolean(queryTok),
          hasFormToken: Boolean(extraToken),
        },
        'auth failed: no token',
      );
      throw httpError(401, 'unauthorized', 'App authentication failed.');
    }
    if (!secretsEqual(config.deviceSecret, provided)) {
      request.log.warn(
        {
          method: request.method,
          url: request.url.split('?')[0],
          providedLen: provided.length,
          expectedLen: config.deviceSecret.length,
          hasFormToken: Boolean(extraToken),
        },
        'auth failed: token mismatch',
      );
      throw httpError(401, 'unauthorized', 'App authentication failed.');
    }
  }

  app.get('/health', async () => ({
    ok: true,
    service: 'g2-vision-ai',
    version: APP_VERSION,
    time: new Date(now()).toISOString(),
    shortcutAuth: ['bearer', 'query_token', 'form_token'],
  }));

  app.get('/api/openai', async (request) => {
    requireAuth(request);
    if (keyCheckCache && now() - keyCheckCache.at < KEY_CHECK_TTL_MS) {
      return { cached: true, ...keyCheckCache.result };
    }
    note('server', 'Checking OpenAI key…');
    const started = now();
    const result = await runKeyCheck();
    keyCheckCache = { at: now(), result };
    request.log.info(
      {
        openaiOk: result.ok,
        openaiKeySet: result.openaiKeySet,
        openaiModel: result.model,
        code: result.code,
        error: result.error,
        ms: now() - started,
      },
      result.ok ? 'openai key ok' : 'openai key failed',
    );
    note(
      'server',
      result.ok ? 'OpenAI key ok' : 'OpenAI key check failed',
      result.error || result.code,
    );
    return { cached: false, ...result };
  });

  app.post('/api/hud', async (request, reply) => {
    requireAuth(request);
    const body = (request.body ?? {}) as { message?: unknown; kind?: unknown };
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim()) {
      throw httpError(400, 'bad_request', 'Missing HUD message.');
    }
    const kind = typeof body.kind === 'string' ? body.kind : undefined;
    await activity.add({
      source: 'glasses',
      message,
      detail: kind,
    });
    return reply.send({ ok: true });
  });

  app.post('/api/analyze', async (request, reply) => {
    const started = now();
    request.log.info(
      {
        contentType: request.headers['content-type'],
        contentLength: request.headers['content-length'],
        multipart: request.isMultipart(),
      },
      'analyze request',
    );
    await store.purgeExpired(now());

    const query = request.query as Record<string, unknown>;
    let image = await extractImage(app, request);
    let mode = parseMode(query.mode);
    let question = asString(query.question);
    let deviceId = asString(query.device_id) || asString(query.deviceId) || asString(request.headers['x-device-id']);
    let formToken: string | undefined;
    let formFieldNames: string[] = [];

    if (request.isMultipart()) {
      const parsed = await readMultipart(request);
      image = parsed.image ?? image;
      mode = parseMode(parsed.fields.mode ?? mode);
      question = parsed.fields.question ?? question;
      deviceId = parsed.fields.device_id ?? parsed.fields.deviceId ?? deviceId;
      formToken = parsed.fields.token ?? parsed.fields.secret ?? parsed.fields.authorization;
      formFieldNames = Object.keys(parsed.fields);
      request.log.info(
        {
          formFields: formFieldNames,
          hasImagePart: Boolean(parsed.image),
          imagePartBytes: parsed.image?.buffer.length,
          imagePartMime: parsed.image?.mimeType,
        },
        'analyze multipart parsed',
      );
    }

    requireAuth(request, formToken);

    if (!image) {
      throw httpError(400, 'missing_image', 'No image was uploaded.');
    }
    if (image.buffer.length > config.maxUploadBytes) {
      throw httpError(413, 'too_large', 'Image is too large');
    }

    const mime = normalizeMime(image.mimeType, image.filename);
    if (mime === 'image/heic' || mime === 'image/heif') {
      throw httpError(
        400,
        'unsupported_type',
        'HEIC is not accepted. In Shortcuts, add Convert Image to JPEG before upload.',
      );
    }
    if (!isAllowedMime(mime) && mime !== 'application/octet-stream') {
      throw httpError(400, 'unsupported_type', 'Use JPEG, PNG, or WebP.');
    }

    let optimized;
    try {
      optimized = await optimizeForVision(image.buffer, {
        maxEdge: config.imageMaxEdge,
        jpegQuality: config.imageJpegQuality,
      });
    } catch (err) {
      if (err instanceof ImageError) {
        throw httpError(400, err.code, err.message);
      }
      throw err;
    }

    image.buffer.fill(0);

    seq += 1;
    const jobId = newJobId();
    if (!config.openaiApiKey) {
      request.log.error({ jobId }, 'OPENAI_API_KEY is empty on this process');
    }
    const createdAt = new Date(now()).toISOString();
    await store.create({
      jobId,
      status: 'processing',
      seq,
      mode,
      deviceId,
      question,
      createdAt,
      updatedAt: createdAt,
      expiresAt: now() + config.resultTtlMs,
    });
    await store.saveImage(jobId, optimized.buffer);

    request.log.info(
      {
        jobId,
        seq,
        mode,
        deviceId,
        bytes: optimized.buffer.length,
        width: optimized.width,
        height: optimized.height,
        parseMs: now() - started,
        openaiKeySet: Boolean(config.openaiApiKey),
        openaiModel: config.openaiModel,
      },
      'upload received',
    );
    note('server', 'Photo received', `job ${jobId.slice(0, 8)} · ${mode}`);

    void processJob({
      jobId,
      dataUrl: toDataUrl(optimized.mimeType, optimized.buffer),
      mode,
      question,
      vision,
      store,
      prompts,
      log: request.log,
      note,
    }).finally(() => {
      optimized.buffer.fill(0);
    });

    return reply.status(202).send({
      ok: true,
      jobId,
      status: 'processing',
    });
  });

  app.get('/api/result/:jobId', async (request) => {
    requireAuth(request);
    await store.purgeExpired(now());
    const { jobId } = request.params as { jobId: string };
    const job = await store.get(jobId);
    if (!job) {
      throw httpError(404, 'not_found', 'No result for that job.');
    }
    return { ok: true, ...toJobView(job) };
  });

  app.get('/api/latest', async (request) => {
    requireAuth(request);
    await store.purgeExpired(now());
    const job = await store.latest();
    if (!job) {
      request.log.debug({ latest: null }, 'latest empty');
      return { ok: true, result: null };
    }
    request.log.debug({ jobId: job.jobId, status: job.status, seq: job.seq }, 'latest');
    return { ok: true, result: toJobView(job) };
  });

  app.get('/api/history', async (request) => {
    requireAuth(request);
    await store.purgeExpired(now());
    const jobs = (await store.list(20)).filter(
      (job) => job.status === 'complete' || job.status === 'error',
    );
    return { ok: true, results: jobs.map(toJobView) };
  });

  registerAdminRoutes(app, { config, store, prompts, activity, now });

  async function runKeyCheck(): Promise<OpenAIKeyCheck> {
    if (!config.openaiApiKey) {
      return {
        ok: false,
        model: config.openaiModel,
        openaiKeySet: false,
        code: 'openai_auth',
        error: 'OPENAI_API_KEY is not set',
      };
    }
    return Promise.race([
      vision.checkApiKey(),
      new Promise<OpenAIKeyCheck>((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            model: config.openaiModel,
            openaiKeySet: true,
            code: 'openai_slow',
          });
        }, KEY_CHECK_WAIT_MS);
      }),
    ]);
  }

  return app;
}

async function processJob(input: {
  jobId: string;
  dataUrl: string;
  mode: ReturnType<typeof parseMode>;
  question?: string;
  vision: VisionClient;
  store: ResultStore;
  prompts: PromptStore;
  log: {
    info: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
  note: (source: 'server' | 'glasses', message: string, detail?: string) => void;
}): Promise<void> {
  const started = Date.now();
  input.log.info({ jobId: input.jobId, mode: input.mode }, 'openai started');
  input.note('server', 'Analyzing…', `job ${input.jobId.slice(0, 8)}`);
  try {
    const settings = await input.prompts.get();
    const instructions = buildInstructions(input.mode, input.question, settings.systemPrompt);
    const userText = userPrompt(input.mode, input.question, settings.userPrompt);
    const answer = await input.vision.analyze({
      imageDataUrl: input.dataUrl,
      mode: input.mode,
      question: input.question,
      instructions,
      userText,
    });
    input.log.info({ jobId: input.jobId, ms: Date.now() - started, chars: answer.length }, 'openai completed');
    await input.store.update(input.jobId, {
      status: 'complete',
      answer,
    });
    input.log.info({ jobId: input.jobId, ms: Date.now() - started }, 'result ready');
    input.note('server', 'Answer ready', `job ${input.jobId.slice(0, 8)}`);
  } catch (err) {
    const details = publicError(err);
    const message = String(details.message || 'OpenAI failed');
    const timeout = /timeout|timed out/i.test(message);
    const authFail = message === 'openai_auth' || details.status === 401;
    input.log.error({ jobId: input.jobId, ms: Date.now() - started, ...details }, 'openai failed');
    await input.store.update(input.jobId, {
      status: 'error',
      errorCode: authFail ? 'openai_auth' : timeout ? 'openai_timeout' : 'openai_error',
      error: authFail
        ? 'OpenAI key rejected. Check Render OPENAI_API_KEY.'
        : timeout
          ? 'AI timed out. Try another photo.'
          : 'AI could not analyze this photo.',
    });
    input.log.warn({ jobId: input.jobId, errorCode: authFail ? 'openai_auth' : timeout ? 'openai_timeout' : 'openai_error' }, 'job marked error');
    input.note(
      'server',
      authFail ? 'OpenAI key rejected' : timeout ? 'AI timed out' : 'AI could not analyze this photo',
      `job ${input.jobId.slice(0, 8)}`,
    );
  }
}

async function extractImage(
  _app: FastifyInstance,
  request: {
    headers: { 'content-type'?: string };
    body: unknown;
  },
): Promise<IncomingImage | undefined> {
  const contentType = request.headers['content-type'] || '';
  if (Buffer.isBuffer(request.body)) {
    return {
      buffer: request.body,
      mimeType: contentType.split(';')[0] || 'application/octet-stream',
    };
  }
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    const body = request.body as {
      imageBase64?: string;
      mimeType?: string;
      mode?: string;
    };
    if (body.imageBase64) {
      return {
        buffer: Buffer.from(body.imageBase64, 'base64'),
        mimeType: body.mimeType || 'image/jpeg',
      };
    }
  }
  return undefined;
}

async function readMultipart(request: {
  isMultipart: () => boolean;
  parts: () => AsyncIterable<{ type: string; fieldname: string; file?: NodeJS.ReadableStream; filename?: string; mimetype?: string; value?: unknown }>;
}): Promise<{ image?: IncomingImage; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  let image: IncomingImage | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file' && part.file) {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const name = part.fieldname.toLowerCase();
      if (['image', 'photo', 'file', 'shortcutinput'].includes(name) || !image) {
        image = {
          buffer: Buffer.concat(chunks),
          mimeType: part.mimetype || 'application/octet-stream',
          filename: part.filename,
        };
      }
    } else if (part.fieldname && part.value != null) {
      fields[part.fieldname.toLowerCase()] = String(part.value);
    }
  }
  return { image, fields };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
