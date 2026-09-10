import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config.js';
import { requestToken, newJobId, secretsEqual } from './auth.js';
import { HttpError, httpError } from './errors.js';
import { ImageError, isAllowedMime, normalizeMime, optimizeForVision, toDataUrl } from './image.js';
import { parseMode } from './modes.js';
import type { VisionClient } from './openai.js';
import { MemoryResultStore, toJobView, type ResultStore } from './storage.js';
import { APP_VERSION } from './version.js';

export type AppDeps = {
  config: AppConfig;
  store?: ResultStore;
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
  const now = deps.now ?? Date.now;
  let seq = 0;

  const app = Fastify({
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

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    allowList: (req) => req.url === '/health',
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
      return reply.status(err.statusCode).send({
        ok: false,
        error: err.message,
        code: err.code,
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) {
      return reply.status(413).send({
        ok: false,
        error: 'Image is too large',
        code: 'too_large',
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    request.log.error({ err: message }, 'unhandled');
    return reply.status(500).send({
      ok: false,
      error: 'Server error',
      code: 'internal',
    });
  });

  function requireAuth(
    request: {
      headers: { authorization?: string; 'x-g2-token'?: string | string[] };
      query?: unknown;
    },
    extraToken?: string,
  ): void {
    if (!config.deviceSecret) {
      throw httpError(500, 'server_misconfigured', 'G2_DEVICE_SECRET is not set');
    }
    const query = (request.query ?? {}) as Record<string, unknown>;
    const headerToken = request.headers['x-g2-token'];
    const provided = requestToken({
      authorization: request.headers.authorization,
      xToken: Array.isArray(headerToken) ? headerToken[0] : headerToken,
      queryToken:
        extraToken ||
        asString(query.token) ||
        asString(query.secret) ||
        asString(query.access_token),
    });
    if (!secretsEqual(config.deviceSecret, provided)) {
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

  app.post('/api/analyze', async (request, reply) => {
    await store.purgeExpired(now());

    const query = request.query as Record<string, unknown>;
    let image = await extractImage(app, request);
    let mode = parseMode(query.mode);
    let question = asString(query.question);
    let deviceId = asString(query.device_id) || asString(query.deviceId) || asString(request.headers['x-device-id']);
    let formToken: string | undefined;

    if (request.isMultipart()) {
      const parsed = await readMultipart(request);
      image = parsed.image ?? image;
      mode = parseMode(parsed.fields.mode ?? mode);
      question = parsed.fields.question ?? question;
      deviceId = parsed.fields.device_id ?? parsed.fields.deviceId ?? deviceId;
      formToken = parsed.fields.token ?? parsed.fields.secret ?? parsed.fields.authorization;
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

    if (!config.openaiApiKey && process.env.NODE_ENV !== 'test') {
      request.log.warn('OPENAI_API_KEY missing; jobs will fail until it is set');
    }

    seq += 1;
    const jobId = newJobId();
    const createdAt = new Date(now()).toISOString();
    await store.create({
      jobId,
      status: 'processing',
      seq,
      mode,
      deviceId,
      createdAt,
      updatedAt: createdAt,
      expiresAt: now() + config.resultTtlMs,
    });

    request.log.info(
      { jobId, seq, mode, bytes: optimized.buffer.length, width: optimized.width, height: optimized.height },
      'upload received',
    );

    void processJob({
      jobId,
      dataUrl: toDataUrl(optimized.mimeType, optimized.buffer),
      mode,
      question,
      vision,
      store,
      log: request.log,
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
      return { ok: true, result: null };
    }
    return { ok: true, result: toJobView(job) };
  });

  return app;
}

async function processJob(input: {
  jobId: string;
  dataUrl: string;
  mode: ReturnType<typeof parseMode>;
  question?: string;
  vision: VisionClient;
  store: ResultStore;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}): Promise<void> {
  const started = Date.now();
  input.log.info({ jobId: input.jobId }, 'openai started');
  try {
    const answer = await input.vision.analyze({
      imageDataUrl: input.dataUrl,
      mode: input.mode,
      question: input.question,
    });
    input.log.info({ jobId: input.jobId, ms: Date.now() - started, chars: answer.length }, 'openai completed');
    await input.store.update(input.jobId, {
      status: 'complete',
      answer,
    });
    input.log.info({ jobId: input.jobId, ms: Date.now() - started }, 'result ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenAI failed';
    const timeout = /timeout|timed out/i.test(message);
    input.log.error({ jobId: input.jobId, err: message }, 'openai failed');
    await input.store.update(input.jobId, {
      status: 'error',
      errorCode: timeout ? 'openai_timeout' : 'openai_error',
      error: timeout ? 'AI timed out. Try another photo.' : 'AI could not analyze this photo.',
    });
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
