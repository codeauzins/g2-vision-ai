import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(backendRoot, '..');

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const count = sh('git rev-list --count HEAD') || process.env.GIT_COMMIT_COUNT || '0';
const fullSha = process.env.RENDER_GIT_COMMIT || sh('git rev-parse HEAD') || 'unknown';
const sha = String(fullSha)
  .replace(/[^0-9a-f]/gi, '')
  .slice(0, 7);
const version = `v.0.1.${count}-${sha || 'unknown'}`;

writeFileSync(
  join(backendRoot, 'src/version.generated.ts'),
  `export const APP_VERSION = ${JSON.stringify(version)};\n`,
);
console.log(version);
