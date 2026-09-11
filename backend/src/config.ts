export type AppConfig = {
  port: number;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  deviceSecret: string;
  adminPassword: string;
  resultTtlMs: number;
  maxUploadBytes: number;
  imageMaxEdge: number;
  imageJpegQuality: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  /** Directory for JSON jobs, prompt settings, and optimized JPEGs. Empty = memory. */
  dataDir: string;
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const ttlSeconds = num('RESULT_TTL_SECONDS', 3600);
  const maxMb = num('MAX_UPLOAD_MB', 8);
  return {
    port: num('PORT', 8787),
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    deviceSecret: env.G2_DEVICE_SECRET || '',
    adminPassword: (env.G2_ADMIN_PASSWORD || env.G2_DEVICE_SECRET || '').trim(),
    resultTtlMs: ttlSeconds * 1000,
    maxUploadBytes: maxMb * 1024 * 1024,
    imageMaxEdge: num('IMAGE_MAX_EDGE', 1600),
    imageJpegQuality: num('IMAGE_JPEG_QUALITY', 80),
    rateLimitMax: num('RATE_LIMIT_MAX', 30),
    rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
    dataDir: (env.G2_DATA_DIR || '').trim(),
  };
}
