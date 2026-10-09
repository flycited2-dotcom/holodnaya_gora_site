import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { todayIn, addDays } from '../server/booking.mjs';

const TOKEN = 'test-admin-token';

async function boot(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hg-test-'));
  const publicDir = join(dir, 'public');
  mkdirSync(join(publicDir, 'admin'), { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), '<!--DRAFT_BANNER--><title>{{siteName}}</title><a href="tel:{{phoneHref}}">{{phone}}</a>');
  writeFileSync(join(publicDir, 'admin', 'index.html'), '<p>admin</p>');
  writeFileSync(join(dir, 'secret.txt'), 'top secret');

  const sent = [];
  const notifier = {
    booking: async (b) => { sent.push(['booking', b.id]); },
    request: async (r) => { sent.push(['request', r.id]); },
  };
  const { server } = createApp({
    dataDir: join(dir, 'data'), publicDir, notifier,
    env: { ADMIN_TOKEN: TOKEN, ...extraEnv },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, sent, dir,
    async close() { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); },
  };
}

const post = (base, path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const admin = { authorization: `Bearer ${TOKEN}` };

const today = todayIn('Europe/Simferopol');
const bookingBody = (over = {}) => ({
  houseId: 'les', checkIn: addDays(today, 10), checkOut: addDays(today, 12), guests: 2,
  name: 'Иван Петров', phone: '+7 978 123-45-67', comment: 'тест', ...over,
});

test('GET /api/content отдаёт домики и не светит служебное поле', async (t) => {
  const app = await boot(); t.after(app.close);
  const body = await (await fetch(`${app.base}/api/content`)).json();
  assert.ok(body.houses.length >= 1);
  assert.equal(body._readme, undefined);
  assert.equal(body.today, today);
});

test('бронь создаётся, занимает даты, повторная на те же даты отклоняется', async (t) => {
  const app = await boot(); t.after(app.close);
  const res = await post(app.base, '/api/bookings', bookingBody());
  assert.equal(res.status, 201);
  const { booking } = await res.json();
  assert.match(booking.id, /^HG-[A-Z0-9]{6}$/);
  assert.equal(booking.status, 'pending');
  assert.equal(booking.total, 12000);
  assert.deepEqual(app.sent, [['booking', booking.id]]);

  const av = await (await fetch(`${app.base}/api/availability`)).json();
  assert.deepEqual(av.busy.les, [addDays(today, 10), addDays(today, 11)]);
  assert.deepEqual(av.busy.mini, []);

  const dup = await post(app.base, '/api/bookings', bookingBody({ checkIn: addDays(today, 11), checkOut: addDays(today, 13) }));
  assert.equal(dup.status, 422);
  assert.ok((await dup.json()).errors.checkIn);

  // день выезда первого = день заезда следующего — это допустимо
  const next = await post(app.base, '/api/bookings', bookingBody({ checkIn: addDays(today, 12), checkOut: addDays(today, 13) }));
  assert.equal(next.status, 201);
});

test('гонка: 5 одновременных броней на одни даты — создаётся ровно одна', async (t) => {
  const app = await boot(); t.after(app.close);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    post(app.base, '/api/bookings', bookingBody({ name: `Гость ${i}` }))));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 422, 422, 422, 422]);
});

test('ловушка для ботов: заполненное скрытое поле не создаёт бронь', async (t) => {
  const app = await boot(); t.after(app.close);
  const res = await post(app.base, '/api/bookings', bookingBody({ website: 'http://spam' }));
  assert.equal(res.status, 200);
  const av = await (await fetch(`${app.base}/api/availability`)).json();
  assert.deepEqual(av.busy.les, []);
  assert.deepEqual(app.sent, []);
});

test('запись с чужого origin и с неверным Content-Type отклоняется', async (t) => {
  const app = await boot(); t.after(app.close);
  const evil = await post(app.base, '/api/bookings', bookingBody(), { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const form = await fetch(`${app.base}/api/bookings`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x',
  });
  assert.equal(form.status, 415);
  const broken = await fetch(`${app.base}/api/bookings`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
  });
  assert.equal(broken.status, 400);
});

test('обращение на стрельбу сохраняется и приходит уведомление', async (t) => {
  const app = await boot(); t.after(app.close);
  const res = await post(app.base, '/api/requests', {
    type: 'shooting', name: 'Анна', phone: '89781234567', date: addDays(today, 5), people: 3, packageId: 'first',
  });
  assert.equal(res.status, 201);
  const bad = await post(app.base, '/api/requests', { type: 'shooting', name: '', phone: '1' });
  assert.equal(bad.status, 422);
  assert.equal(app.sent.length, 1);
});

test('админка: без токена 401, с токеном видны заявки; отмена освобождает даты', async (t) => {
  const app = await boot(); t.after(app.close);
  const { booking } = await (await post(app.base, '/api/bookings', bookingBody())).json();

  assert.equal((await fetch(`${app.base}/api/admin/overview`)).status, 401);
  assert.equal((await fetch(`${app.base}/api/admin/overview`, { headers: { authorization: 'Bearer wrong' } })).status, 401);

  const ov = await (await fetch(`${app.base}/api/admin/overview`, { headers: admin })).json();
  assert.equal(ov.bookings.length, 1);
  assert.equal(ov.bookings[0].phone, '+79781234567');

  const confirm = await fetch(`${app.base}/api/admin/bookings/${booking.id}`, {
    method: 'PATCH', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(confirm.status, 200);

  const cancel = await fetch(`${app.base}/api/admin/bookings/${booking.id}`, {
    method: 'PATCH', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancel.status, 200);
  const av = await (await fetch(`${app.base}/api/availability`)).json();
  assert.deepEqual(av.busy.les, []);
});

test('админка: ручная блокировка дат и защита от наложения при восстановлении', async (t) => {
  const app = await boot(); t.after(app.close);
  const { booking } = await (await post(app.base, '/api/bookings', bookingBody())).json();
  const patch = (id, status) => fetch(`${app.base}/api/admin/bookings/${id}`, {
    method: 'PATCH', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ status }),
  });
  await patch(booking.id, 'cancelled');

  const block = await post(app.base, '/api/admin/blocks', {
    houseId: 'les', checkIn: addDays(today, 10), checkOut: addDays(today, 11), note: 'Ремонт',
  }, admin);
  assert.equal(block.status, 201);

  assert.equal((await patch(booking.id, 'confirmed')).status, 409);
});

test('админка отключена без ADMIN_TOKEN', async (t) => {
  const app = await boot({ ADMIN_TOKEN: '' }); t.after(app.close);
  assert.equal((await fetch(`${app.base}/api/admin/overview`, { headers: admin })).status, 503);
});

test('таблица рекордов: валидные результаты сохраняются, нечестные отклоняются', async (t) => {
  const app = await boot(); t.after(app.close);
  const ok = await post(app.base, '/api/scores', { name: 'Саша', score: 300, hits: 20, shots: 28 });
  assert.equal(ok.status, 201);
  assert.equal((await post(app.base, '/api/scores', { name: 'Хакер', score: 99999, hits: 20, shots: 28 })).status, 422);
  assert.equal((await post(app.base, '/api/scores', { name: 'Хакер', score: 10, hits: 99, shots: 100 })).status, 422);
  assert.equal((await post(app.base, '/api/scores', { name: 'Х', score: 10, hits: 5, shots: 2 })).status, 422);

  await post(app.base, '/api/scores', { name: 'пизда', score: 100, hits: 8, shots: 10 });
  const board = await (await fetch(`${app.base}/api/scores`)).json();
  assert.equal(board.allTime[0].name, 'Саша');
  assert.equal(board.allTime[0].score, 300);
  assert.equal(board.allTime[1].name, 'Стрелок'); // нецензурное имя заменено
  assert.equal(board.month.length, 2);
});

test('статика: подстановка контактов, баннер черновика, защита от выхода из каталога', async (t) => {
  const app = await boot(); t.after(app.close);
  const html = await (await fetch(`${app.base}/`)).text();
  assert.match(html, /Холодная гора/);
  assert.match(html, /tel:\+79780000000/);
  assert.match(html, /draft-banner/);

  const admin404 = await fetch(`${app.base}/admin`);
  assert.equal(admin404.status, 200);
  assert.equal(admin404.headers.get('x-robots-tag'), 'noindex, nofollow');

  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/.git/config']) {
    const r = await fetch(app.base + p);
    assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.doesNotMatch(await r.text(), /top secret/);
  }
  assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
  assert.match(await (await fetch(`${app.base}/robots.txt`)).text(), /Disallow: \/admin/);
});

test('заголовки безопасности присутствуют', async (t) => {
  const app = await boot(); t.after(app.close);
  const r = await fetch(`${app.base}/`);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
