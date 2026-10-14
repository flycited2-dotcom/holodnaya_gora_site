// Сервер сайта «Холодная гора»: статика + небольшой JSON API. Без внешних зависимостей.
// Запуск:  node server/index.mjs   (настройки — переменные окружения, см. .env.example)

import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, extname, sep, resolve } from 'node:path';

import { createStore, makeCode } from './store.mjs';
import { createLimiter } from './limits.mjs';
import { createNotifier } from './notify.mjs';
import { validateContent } from './content.mjs';
import { maxScore } from '../public/js/scoring.js'; // те же правила очков, что и в игре
import {
  validateBooking, validateRequest, busyNights, hasConflict, parseDate, todayIn,
} from './booking.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.webmanifest', '.gltf', '.bin']);
const LONG_CACHE = new Set(['.woff2', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.mp3', '.ogg', '.glb']);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BAD_NAME_RE = /(хуй|хуя|хуе|пизд|бляд|блят|ебан|ебат|ебал|ебну|залуп|мудак|гандон)/i;

export function createApp(opts = {}) {
  const env = { ...process.env, ...opts.env };
  const dataDir = resolve(opts.dataDir ?? env.DATA_DIR ?? join(ROOT, 'data'));
  const publicDir = resolve(opts.publicDir ?? join(ROOT, 'public'));
  const contentFile = resolve(opts.contentFile ?? join(ROOT, 'content', 'site.json'));
  const trustProxy = env.TRUST_PROXY === '1';
  const adminToken = env.ADMIN_TOKEN || '';
  const siteUrl = (env.SITE_URL || '').replace(/\/+$/, '');
  const metrikaId = /^\d{4,12}$/.test(env.METRIKA_ID || '') ? env.METRIKA_ID : '';

  const store = createStore(join(dataDir, 'store.json'));
  const notifier = opts.notifier ?? createNotifier({
    token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, siteUrl,
  });

  const limiters = {
    booking: createLimiter({ windowMs: 3_600_000, max: 6 }),
    request: createLimiter({ windowMs: 3_600_000, max: 10 }),
    score: createLimiter({ windowMs: 3_600_000, max: 30 }),
    api: createLimiter({ windowMs: 60_000, max: 240 }),
    adminFail: createLimiter({ windowMs: 15 * 60_000, max: 10 }),
  };

  // --- контент (перечитывается при изменении файла) -------------------------
  let contentCache = { mtime: 0, data: null };
  function loadContent() {
    const data = JSON.parse(readFileSync(contentFile, 'utf8'));
    const problems = validateContent(data);
    if (problems.length) throw new Error(`content/site.json: ${problems.join('; ')}`);
    return data;
  }
  function content() {
    const mtime = statSync(contentFile).mtimeMs;
    if (mtime !== contentCache.mtime) {
      try {
        contentCache = { mtime, data: loadContent() };
      } catch (err) {
        if (!contentCache.data) throw err; // при старте — падаем с понятным текстом
        // при правке «на лету» оставляем последнюю рабочую версию, а не роняем сайт
        console.error(`[content] ошибка в site.json, используется прежняя версия: ${err.message}`);
        contentCache = { ...contentCache, mtime };
      }
    }
    return contentCache.data;
  }
  content(); // упасть сразу при старте, если файл битый

  const rulesOf = (c) => ({
    minNights: c.booking.minNights, maxNights: c.booking.maxNights, horizonDays: c.booking.horizonDays,
  });
  const todayOf = (c) => todayIn(c.booking.timezone);

  // --- ответы ---------------------------------------------------------------
  const SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'x-frame-options': 'DENY',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self' https://mc.yandex.ru",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://mc.yandex.ru", // blob: — текстуры внутри GLB-моделей
      "font-src 'self'",
      "connect-src 'self' https://mc.yandex.ru",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };

  function json(res, status, body, extra = {}) {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'content-length': buf.length,
      'cache-control': 'no-store',
      ...extra,
    });
    res.end(buf);
  }

  function clientIp(req) {
    if (trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function readJson(req, limit = 32 * 1024) {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Нужен Content-Type: application/json');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, 'Слишком большой запрос');
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      return parsed;
    } catch {
      throw new HttpError(400, 'Некорректный JSON');
    }
  }

  // защита от CSRF: запись только с того же origin
  function assertSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let host;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Bad origin'); }
    if (host !== req.headers.host) throw new HttpError(403, 'Cross-origin запрос отклонён');
  }

  function isAdmin(req) {
    if (!adminToken) return false;
    const header = String(req.headers.authorization ?? '');
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a = createHash('sha256').update(given).digest();
    const b = createHash('sha256').update(adminToken).digest();
    return timingSafeEqual(a, b);
  }

  function requireAdmin(req) {
    if (!adminToken) throw new HttpError(503, 'Админка выключена: не задан ADMIN_TOKEN');
    const ip = clientIp(req);
    if (limiters.adminFail.peek(ip) === 0) throw new HttpError(429, 'Слишком много неудачных попыток. Попробуйте позже');
    if (!isAdmin(req)) {
      limiters.adminFail.take(ip);
      throw new HttpError(401, 'Неверный токен');
    }
  }

  // --- API ------------------------------------------------------------------
  const publicBooking = (b, c) => ({
    id: b.id,
    house: c.houses.find((h) => h.id === b.houseId)?.name ?? b.houseId,
    checkIn: b.checkIn, checkOut: b.checkOut, nights: b.nights, guests: b.guests, total: b.total, status: b.status,
  });

  const REQUEST_LABEL = { shooting: 'Запись на стрельбу', event: 'Запись на мероприятие', question: 'Вопрос' };

  async function api(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    const c = content();

    if (!limiters.api.take(clientIp(req))) throw new HttpError(429, 'Слишком много запросов');

    if (method === 'GET' && pathname === '/api/content') {
      const { _readme, ...pub } = c;
      return json(res, 200, { ...pub, today: todayOf(c), metrikaId });
    }

    if (method === 'GET' && pathname === '/api/availability') {
      const busy = {};
      for (const h of c.houses) busy[h.id] = busyNights(store.snapshot().bookings, h.id);
      return json(res, 200, { today: todayOf(c), busy });
    }

    if (method === 'POST' && pathname === '/api/bookings') {
      assertSameOrigin(req);
      if (!limiters.booking.take(clientIp(req))) throw new HttpError(429, 'Слишком много заявок с вашего адреса. Позвоните нам');
      const body = await readJson(req);
      if (typeof body.website === 'string' && body.website.trim()) return json(res, 200, { ok: true }); // ловушка для ботов

      const result = await store.transact((st) => {
        const v = validateBooking(body, { houses: c.houses, today: todayOf(c), rules: rulesOf(c), existing: st.bookings });
        if (!v.ok) return v;
        const record = {
          id: makeCode('HG', new Set(st.bookings.map((b) => b.id))),
          ...v.value,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        st.bookings.push(record);
        return { ok: true, record };
      });
      if (!result.ok) return json(res, 422, { ok: false, errors: result.errors });

      notifier.booking(result.record, c.houses.find((h) => h.id === result.record.houseId)).catch(() => {});
      return json(res, 201, { ok: true, booking: publicBooking(result.record, c) });
    }

    if (method === 'POST' && pathname === '/api/requests') {
      assertSameOrigin(req);
      if (!limiters.request.take(clientIp(req))) throw new HttpError(429, 'Слишком много обращений с вашего адреса. Позвоните нам');
      const body = await readJson(req);
      if (typeof body.website === 'string' && body.website.trim()) return json(res, 200, { ok: true });

      const result = await store.transact((st) => {
        const v = validateRequest(body, { today: todayOf(c), rules: rulesOf(c) });
        if (!v.ok) return v;
        const record = {
          id: makeCode('Z', new Set(st.requests.map((r) => r.id))),
          ...v.value,
          status: 'new',
          createdAt: new Date().toISOString(),
        };
        st.requests.push(record);
        return { ok: true, record };
      });
      if (!result.ok) return json(res, 422, { ok: false, errors: result.errors });

      const r = result.record;
      notifier.request({
        ...r,
        eventTitle: c.events.find((e) => e.id === r.eventId)?.title,
        packageTitle: c.shootingPackages.find((p) => p.id === r.packageId)?.name,
      }, REQUEST_LABEL[r.type]).catch(() => {});
      return json(res, 201, { ok: true, id: r.id });
    }

    if (method === 'GET' && pathname === '/api/scores') {
      const month = todayOf(c).slice(0, 7);
      const all = store.snapshot().scores;
      const view = (list) => list.slice(0, 10).map((s) => ({ name: s.name, score: s.score, hits: s.hits, date: s.createdAt.slice(0, 10) }));
      const byScore = (a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt);
      return json(res, 200, {
        allTime: view([...all].sort(byScore)),
        month: view(all.filter((s) => s.createdAt.startsWith(month)).sort(byScore)),
      });
    }

    if (method === 'POST' && pathname === '/api/scores') {
      assertSameOrigin(req);
      if (!limiters.score.take(clientIp(req))) throw new HttpError(429, 'Слишком много результатов');
      const body = await readJson(req, 2 * 1024);
      const round = c.game.roundSize;
      const toInt = (v) => (Number.isInteger(v) ? v : null);
      const score = toInt(body.score);
      const hits = toInt(body.hits);
      const shots = toInt(body.shots);
      let name = String(body.name ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
      if (!name) name = 'Стрелок';
      if (BAD_NAME_RE.test(name)) name = 'Стрелок';
      if (score === null || hits === null || shots === null
        || score < 0 || hits < 0 || hits > round || shots < hits || shots > round * 40
        || score > maxScore(hits, shots, round)) {
        throw new HttpError(422, 'Некорректный результат');
      }
      if (hits === 0) return json(res, 200, { ok: true, saved: false });

      const rec = await store.transact((st) => {
        const record = {
          id: makeCode('S', new Set(st.scores.map((s) => s.id))),
          name, score, hits, shots, createdAt: new Date().toISOString(),
        };
        st.scores.push(record);
        st.scores.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
        if (st.scores.length > 500) st.scores.length = 500;
        return record;
      });
      return json(res, 201, { ok: true, saved: true, id: rec.id });
    }

    // --- админка ---
    if (pathname.startsWith('/api/admin/')) {
      requireAdmin(req);
      const st = store.snapshot();

      if (method === 'GET' && pathname === '/api/admin/overview') {
        const byNew = (a, b) => b.createdAt.localeCompare(a.createdAt);
        return json(res, 200, {
          houses: c.houses.map((h) => ({ id: h.id, name: h.name })),
          bookings: [...st.bookings].sort(byNew),
          requests: [...st.requests].sort(byNew),
          scores: [...st.scores].slice(0, 50),
          today: todayOf(c),
        });
      }

      let m = pathname.match(/^\/api\/admin\/bookings\/([\w-]+)$/);
      if (m && method === 'PATCH') {
        assertSameOrigin(req);
        const body = await readJson(req);
        const status = body.status;
        if (!['pending', 'confirmed', 'cancelled'].includes(status)) throw new HttpError(422, 'Недопустимый статус');
        const result = await store.transact((s) => {
          const b = s.bookings.find((x) => x.id === m[1]);
          if (!b) return { code: 404 };
          if (status !== 'cancelled' && hasConflict(s.bookings, b.houseId, b.checkIn, b.checkOut, b.id)) {
            return { code: 409 };
          }
          b.status = status;
          b.updatedAt = new Date().toISOString();
          return { code: 200, booking: b };
        });
        if (result.code === 404) throw new HttpError(404, 'Бронь не найдена');
        if (result.code === 409) throw new HttpError(409, 'Даты уже заняты другой бронью');
        return json(res, 200, { ok: true, booking: result.booking });
      }

      if (method === 'POST' && pathname === '/api/admin/blocks') {
        assertSameOrigin(req);
        const body = await readJson(req);
        const house = c.houses.find((h) => h.id === body.houseId);
        const a = parseDate(body.checkIn);
        const b = parseDate(body.checkOut);
        if (!house || a === null || b === null || b <= a || b - a > 366) throw new HttpError(422, 'Проверьте домик и даты');
        const result = await store.transact((s) => {
          if (hasConflict(s.bookings, house.id, body.checkIn, body.checkOut)) return null;
          const rec = {
            id: makeCode('B', new Set(s.bookings.map((x) => x.id))),
            houseId: house.id, checkIn: body.checkIn, checkOut: body.checkOut,
            nights: b - a, guests: 0, name: String(body.note ?? 'Блокировка').slice(0, 80), phone: '', comment: '',
            total: 0, status: 'blocked', createdAt: new Date().toISOString(),
          };
          s.bookings.push(rec);
          return rec;
        });
        if (!result) throw new HttpError(409, 'На эти даты уже есть бронь');
        return json(res, 201, { ok: true, booking: result });
      }

      m = pathname.match(/^\/api\/admin\/requests\/([\w-]+)$/);
      if (m && method === 'PATCH') {
        assertSameOrigin(req);
        const body = await readJson(req);
        if (!['new', 'done'].includes(body.status)) throw new HttpError(422, 'Недопустимый статус');
        const rec = await store.transact((s) => {
          const r = s.requests.find((x) => x.id === m[1]);
          if (r) r.status = body.status;
          return r;
        });
        if (!rec) throw new HttpError(404, 'Не найдено');
        return json(res, 200, { ok: true, request: rec });
      }

      m = pathname.match(/^\/api\/admin\/scores\/([\w-]+)$/);
      if (m && method === 'DELETE') {
        assertSameOrigin(req);
        const removed = await store.transact((s) => {
          const i = s.scores.findIndex((x) => x.id === m[1]);
          if (i === -1) return false;
          s.scores.splice(i, 1);
          return true;
        });
        if (!removed) throw new HttpError(404, 'Не найдено');
        return json(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, 'Не найдено');
  }

  // --- статика --------------------------------------------------------------
  const fileCache = new Map(); // путь -> { key, buf, gz, etag, type }

  function renderIndex(html, c, req) {
    const origin = siteUrl || `http://${req.headers.host ?? 'localhost'}`;
    const draftBanner = c.draft
      ? '<div class="draft-banner" role="note">Черновик: цены, контакты и даты — заглушки до подтверждения владельцем</div>'
      : '';
    const map = {
      siteName: c.site.name,
      tagline: c.site.tagline,
      region: c.site.region,
      phone: c.contacts.phone,
      phoneHref: c.contacts.phoneHref,
      address: c.contacts.address,
      hours: c.contacts.hours,
      mapUrl: `https://yandex.ru/maps/?text=${encodeURIComponent(c.contacts.mapQuery)}`,
      metrikaId,
      canonical: origin,
    };
    return html
      .replace('<!--DRAFT_BANNER-->', draftBanner)
      .replace(/\{\{(\w+)\}\}/g, (_, key) => esc(map[key] ?? ''));
  }

  async function serveStatic(req, res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Bad path'); }
    if (rel.includes('\0')) throw new HttpError(400, 'Bad path');
    if (rel === '/admin' || rel === '/admin/') rel = '/admin/index.html';
    if (rel.endsWith('/')) rel += 'index.html';

    const full = resolve(join(publicDir, normalize(rel)));
    if (full !== publicDir && !full.startsWith(publicDir + sep)) throw new HttpError(403, 'Forbidden');
    if (rel.split('/').some((seg) => seg.startsWith('.'))) throw new HttpError(404, 'Не найдено');

    let st;
    try { st = await stat(full); } catch { throw new HttpError(404, 'Не найдено'); }
    if (st.isDirectory()) throw new HttpError(404, 'Не найдено');

    const ext = extname(full).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const isIndex = ext === '.html' && !full.includes(`${sep}admin${sep}`); // страницы сайта подставляют контакты из site.json
    const c = isIndex ? content() : null;
    // Адрес сайта в шаблоне берётся из SITE_URL; без него — из заголовка Host, и тогда кэш делится по Host
    const hostPart = isIndex && !siteUrl ? String(req.headers.host ?? '').slice(0, 80) : '';
    const cacheKey = `${full}|${hostPart}`;
    const stamp = `${st.mtimeMs}:${st.size}:${isIndex ? contentCache.mtime : 0}`;

    let entry = fileCache.get(cacheKey);
    if (!entry || entry.key !== stamp) {
      let buf = await readFile(full);
      if (isIndex) buf = Buffer.from(renderIndex(buf.toString('utf8'), c, req));
      const etag = `"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
      entry = { key: stamp, buf, etag, gz: COMPRESSIBLE.has(ext) && buf.length > 512 ? gzipSync(buf) : null };
      if (fileCache.size > 200) fileCache.clear(); // защита от раздувания кэша чужими значениями Host
      fileCache.set(cacheKey, entry);
    }

    const headers = {
      ...SECURITY_HEADERS,
      'content-type': type,
      etag: entry.etag,
      'cache-control': LONG_CACHE.has(ext) ? 'public, max-age=604800' : 'no-cache',
      vary: 'Accept-Encoding',
    };
    if (full.includes(`${sep}admin${sep}`)) headers['x-robots-tag'] = 'noindex, nofollow';

    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const body = entry.gz && acceptsGzip ? entry.gz : entry.buf;
    if (entry.gz && acceptsGzip) headers['content-encoding'] = 'gzip';
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function serveGenerated(req, res, pathname) {
    const origin = siteUrl || `http://${req.headers.host ?? 'localhost'}`;
    if (pathname === '/robots.txt') {
      const body = `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`;
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME['.txt'], 'cache-control': 'public, max-age=3600' });
      return res.end(body);
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(origin)}/</loc></url></urlset>\n`;
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME['.xml'], 'cache-control': 'public, max-age=3600' });
    return res.end(body);
  }

  // --- сервер ---------------------------------------------------------------
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const { pathname } = url;

      if (pathname === '/healthz') return json(res, 200, { ok: true });
      if (pathname === '/robots.txt' || pathname === '/sitemap.xml') return serveGenerated(req, res, pathname);

      if (pathname.startsWith('/api/')) {
        await api(req, res, url);
        if (req.method !== 'GET') console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      await serveStatic(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[error]', err);
      if (res.headersSent) return res.end();
      const message = status === 500 ? 'Внутренняя ошибка сервера' : err.message;
      if ((req.url ?? '').startsWith('/api/')) return json(res, status, { ok: false, error: message });
      res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      res.end(status === 404 ? 'Страница не найдена' : message);
    }
  });

  return { server, store };
}

/** Минимальная загрузка .env (KEY=VALUE), без внешних зависимостей. Уже заданные переменные не трогаем. */
function loadDotenv(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// запуск, если файл вызван напрямую
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadDotenv(join(ROOT, '.env'));
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const { server } = createApp();
  server.listen(port, host, () => {
    console.log(`Холодная гора: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (!process.env.ADMIN_TOKEN) console.log('Подсказка: задайте ADMIN_TOKEN, чтобы включить /admin');
    if (!process.env.TELEGRAM_BOT_TOKEN) console.log('Подсказка: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID для уведомлений о заявках');
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
