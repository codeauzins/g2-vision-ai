import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createOpenAIClient } from './openai.js';

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

const app = await buildApp({
  config,
  vision: createOpenAIClient(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel),
});

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info({ port: config.port }, 'g2-vision-ai listening');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
