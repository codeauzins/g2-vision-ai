import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createOpenAIClient } from './openai.js';
import { FileResultStore, MemoryResultStore } from './storage.js';
import { APP_VERSION } from './version.js';

function loadLocalEnv(): void {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
    }
  }
}

loadLocalEnv();

const config = loadConfig();

if (!config.deviceSecret) {
  console.warn('G2_DEVICE_SECRET is empty. Authenticated routes will fail until it is set.');
}
if (!config.openaiApiKey) {
  console.warn('OPENAI_API_KEY is empty. Vision jobs will fail until it is set.');
}

function openStore(dataDir: string) {
  if (!dataDir) return new MemoryResultStore();
  try {
    mkdirSync(dataDir, { recursive: true });
    return new FileResultStore(join(dataDir, 'jobs.json'));
  } catch (err) {
    console.warn('G2_DATA_DIR is not writable; using in-memory results', err);
    return new MemoryResultStore();
  }
}

const store = openStore(config.dataDir);

const app = await buildApp({
  config,
  store,
  vision: createOpenAIClient(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel),
});

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    {
      port: config.port,
      version: APP_VERSION,
      openaiModel: config.openaiModel,
      openaiKeySet: Boolean(config.openaiApiKey),
      dataDir: config.dataDir || '(memory)',
    },
    'g2-vision-ai listening',
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
