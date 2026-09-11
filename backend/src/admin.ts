import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import { secretsEqual } from './auth.js';
import { httpError } from './errors.js';
import { APP_VERSION } from './version.js';
import type { PromptSettings, PromptStore } from './settings.js';
import type { JobRecord, ResultStore } from './storage.js';

const COOKIE = 'g2_admin';
const SESSION_TTL_SEC = 60 * 60 * 24 * 14;

export function adminSessionToken(password: string): string {
  return createHmac('sha256', password).update('g2-admin-session-v1').digest('hex');
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cookieHeader(token: string, secure: boolean, clear = false): string {
  const parts = [
    `${COOKIE}=${clear ? '' : token}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecure(request: FastifyRequest): boolean {
  const proto = String(request.headers['x-forwarded-proto'] || '');
  return proto.includes('https') || request.protocol === 'https';
}

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    store: ResultStore;
    prompts: PromptStore;
    now?: () => number;
  },
): void {
  const { config, store, prompts } = deps;
  const now = deps.now ?? Date.now;

  function loggedIn(request: FastifyRequest): boolean {
    if (!config.adminPassword) return false;
    const provided = readCookie(request.headers.cookie, COOKIE);
    return secretsEqual(adminSessionToken(config.adminPassword), provided);
  }

  function requireAdmin(request: FastifyRequest): void {
    if (!loggedIn(request)) {
      throw httpError(401, 'unauthorized', 'Admin login required.');
    }
  }

  app.get('/admin', async (request, reply) => {
    if (!loggedIn(request)) {
      return reply.type('text/html; charset=utf-8').send(loginPage(''));
    }
    await store.purgeExpired(now());
    const settings = await prompts.get();
    const jobs = await store.list(80);
    return reply.type('text/html; charset=utf-8').send(dashboardPage({ config, settings, jobs }));
  });

  app.get('/admin/login', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(loginPage(''));
  });

  app.post('/admin/login', async (request, reply) => {
    if (!config.adminPassword) {
      return reply
        .code(500)
        .type('text/html; charset=utf-8')
        .send(loginPage('Set G2_ADMIN_PASSWORD (or G2_DEVICE_SECRET) on Render.'));
    }
    const body = (request.body ?? {}) as { password?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    if (!secretsEqual(config.adminPassword, password)) {
      request.log.warn({ url: '/admin/login' }, 'admin login failed');
      return reply.code(401).type('text/html; charset=utf-8').send(loginPage('Wrong password.'));
    }
    reply.header('set-cookie', cookieHeader(adminSessionToken(config.adminPassword), isSecure(request)));
    return reply.redirect('/admin', 303);
  });

  app.post('/admin/logout', async (request, reply) => {
    reply.header('set-cookie', cookieHeader('', isSecure(request), true));
    return reply.redirect('/admin/login', 303);
  });

  app.post('/admin/settings', async (request, reply) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as { systemPrompt?: string; userPrompt?: string; reset?: string };
    if (body.reset === '1') {
      await prompts.reset();
    } else {
      await prompts.save({
        systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
        userPrompt: typeof body.userPrompt === 'string' ? body.userPrompt : undefined,
      });
    }
    request.log.info({ reset: body.reset === '1' }, 'admin prompt saved');
    return reply.redirect('/admin', 303);
  });

  app.get('/admin/image/:jobId', async (request, reply) => {
    requireAdmin(request);
    const { jobId } = request.params as { jobId: string };
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
      throw httpError(404, 'not_found', 'No image.');
    }
    const image = await store.getImage(jobId);
    if (!image) {
      throw httpError(404, 'not_found', 'No image.');
    }
    return reply
      .header('cache-control', 'private, max-age=3600')
      .type(image.mimeType || 'image/jpeg')
      .send(image.bytes);
  });
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; background: #0d0f0c; color: #d7f5c8; }
    main { max-width: 920px; margin: 0 auto; padding: 24px 16px 64px; }
    h1, h2 { font-weight: 650; }
    a { color: #9cff57; }
    .card { background: #161a14; border: 1px solid #2a3324; border-radius: 12px; padding: 16px; margin: 16px 0; }
    label { display: block; margin: 12px 0 6px; color: #a4c090; }
    input[type=password], textarea { width: 100%; box-sizing: border-box; background: #0d0f0c; color: #e8ffd6; border: 1px solid #3d4a34; border-radius: 8px; padding: 10px; font: 13px/1.4 ui-monospace, Menlo, monospace; }
    textarea { min-height: 220px; }
    button { background: #9cff57; color: #111; border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 700; cursor: pointer; }
    button.secondary { background: #2a3324; color: #d7f5c8; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .muted { color: #8aa078; font-size: 13px; }
    .err { color: #ff8a8a; }
    .job { display: grid; grid-template-columns: 160px 1fr; gap: 12px; }
    .job img { width: 160px; height: auto; border-radius: 8px; background: #000; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
    @media (max-width: 640px) { .job { grid-template-columns: 1fr; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function loginPage(error: string): string {
  return shell(
    'Ask AI admin',
    `<h1>Ask AI admin</h1>
     <div class="card">
       <p class="muted">Password is <code>G2_ADMIN_PASSWORD</code> on Render, or <code>G2_DEVICE_SECRET</code> if that is unset.</p>
       ${error ? `<p class="err">${esc(error)}</p>` : ''}
       <form method="post" action="/admin/login">
         <label for="password">Password</label>
         <input id="password" name="password" type="password" autocomplete="current-password" required />
         <p><button type="submit">Log in</button></p>
       </form>
     </div>`,
  );
}

function dashboardPage(input: {
  config: AppConfig;
  settings: PromptSettings;
  jobs: JobRecord[];
}): string {
  const { config, settings, jobs } = input;
  const jobsHtml = jobs.length
    ? jobs
        .map((job) => {
          const img = job.hasImage
            ? `<img src="/admin/image/${esc(job.jobId)}" alt="Photo ${esc(job.jobId.slice(0, 8))}" />`
            : `<p class="muted">No photo stored</p>`;
          const body = job.answer || job.error || '(still analyzing)';
          return `<article class="card job">
            <div>${img}</div>
            <div>
              <p><strong>${esc(job.status)}</strong> · ${esc(job.mode)} · seq ${job.seq}<br />
              <span class="muted">${esc(job.createdAt)} · ${esc(job.jobId)}</span></p>
              <pre>${esc(body)}</pre>
            </div>
          </article>`;
        })
        .join('')
    : `<p class="muted">No tasks yet. Take a photo with the Action Button after this deploy.</p>`;

  return shell(
    'Ask AI admin',
    `<div class="row">
       <h1 style="margin:0">Ask AI admin</h1>
       <form method="post" action="/admin/logout"><button class="secondary" type="submit">Log out</button></form>
     </div>
     <p class="muted">${esc(APP_VERSION)} · model ${esc(config.openaiModel)} · OpenAI key ${config.openaiApiKey ? 'set' : 'MISSING'} · disk ${esc(config.dataDir || '(memory only)')}</p>

     <section class="card">
       <h2>OpenAI prompt</h2>
       <p class="muted">Saved on this server. The next photo uses the new text. Mode extras (ocr / translate / …) still append after the system prompt.</p>
       <form method="post" action="/admin/settings">
         <label for="systemPrompt">System prompt</label>
         <textarea id="systemPrompt" name="systemPrompt">${esc(settings.systemPrompt)}</textarea>
         <label for="userPrompt">Default user prompt (general mode)</label>
         <textarea id="userPrompt" name="userPrompt" style="min-height:80px">${esc(settings.userPrompt)}</textarea>
         <p class="row">
           <button type="submit">Save prompt</button>
           <button class="secondary" type="submit" name="reset" value="1">Reset to default</button>
         </p>
       </form>
     </section>

     <h2>Previous tasks</h2>
     ${jobsHtml}`,
  );
}
