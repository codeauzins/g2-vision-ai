#!/usr/bin/env node
/**
 * Rewrites even-app/app.json network whitelist from VITE_API_BASE_URL.
 * Packaging requires an exact origin; wildcards are not supported.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const fileEnv = {
  ...readEnvFile(resolve(root, '../.env')),
  ...readEnvFile(resolve(root, '.env')),
  ...readEnvFile(resolve(root, '.env.local')),
};

const raw = process.env.VITE_API_BASE_URL || fileEnv.VITE_API_BASE_URL || '';
const origin = raw.replace(/\/$/, '');
const manifestPath = resolve(root, 'app.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (origin && origin.startsWith('http')) {
  const network = (manifest.permissions || []).find((p) => p.name === 'network');
  if (network) {
    network.whitelist = [origin];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`app.json network whitelist -> ${origin}`);
  }
} else {
  console.log('VITE_API_BASE_URL unset; leaving app.json whitelist unchanged');
}
