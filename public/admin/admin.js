// Админка: брони, заявки, ручная блокировка дат, модерация рекордов.
// Токен хранится только в sessionStorage — до закрытия вкладки.

import { $, $$, h, rub, formatShort, plural, toast } from '/js/util.js';

const KEY = 'hg_admin_token';
let token = sessionStorage.getItem(KEY) || '';
let data = null;
let timer = 0;

async function call(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Ошибка'), { status: res.status });
  return body;
}

function showLogin(message) {
  clearInterval(timer);
  $('#login').hidden = false;
  $('#panel').hidden = true;
  $('#logout').hidden = true;
  const err = $('#loginError');
  err.hidden = !message;
  err.textContent = message ?? '';
}

async function refresh() {
  try {
    data = await call('/overview');
  } catch (err) {
    if (err.status === 401 || err.status === 429 || err.status === 503) {
      sessionStorage.removeItem(KEY);
      showLogin(err.message);
    } else {
      toast(err.message, 'error');
    }
    return;
  }
  $('#login').hidden = true;
  $('#panel').hidden = false;
  $('#logout').hidden = false;
  render();
}

const STATUS = { pending: 'Ожидает', confirmed: 'Подтверждена', cancelled: 'Отменена', blocked: 'Закрыто', new: 'Новая', done: 'Обработана' };
const TYPE = { shooting: 'Запись на стрельбу', event: 'Мероприятие', question: 'Вопрос' };
const houseName = (id) => data.houses.find((x) => x.id === id)?.name ?? id;
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function render() {
  const showAll = $('#showAll').checked;
  const bookings = data.bookings.filter((b) => showAll || (['pending', 'confirmed', 'blocked'].includes(b.status) && b.checkOut >= data.today));
  $('#cBookings').textContent = data.bookings.filter((b) => b.status === 'pending').length || '';
  $('#cRequests').textContent = data.requests.filter((r) => r.status === 'new').length || '';

  $('#bookingsList').replaceChildren(...(bookings.length ? bookings.map(bookingCard) : [h('div', { class: 'adm-empty' }, 'Броней пока нет')]));
  $('#requestsList').replaceChildren(...(data.requests.length ? data.requests.map(requestCard) : [h('div', { class: 'adm-empty' }, 'Заявок пока нет')]));
  $('#scoresList').replaceChildren(...(data.scores.length ? data.scores.map(scoreRow) : [h('div', { class: 'adm-empty' }, 'Результатов пока нет')]));

  const sel = $('#blockHouse');
  if (!sel.options.length) sel.replaceChildren(...data.houses.map((x) => h('option', { value: x.id }, x.name)));
}

async function act(path, body, method = 'PATCH') {
  try {
    await call(path, { method, body: body ? JSON.stringify(body) : undefined });
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function bookingCard(b) {
  const isBlock = b.status === 'blocked';
  const actions = [];
  if (b.status === 'pending') actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => act(`/bookings/${b.id}`, { status: 'confirmed' }) }, 'Подтвердить'));
  if (b.status !== 'cancelled') actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => confirm(isBlock ? 'Открыть эти даты?' : 'Отменить бронь?') && act(`/bookings/${b.id}`, { status: 'cancelled' }) }, isBlock ? 'Открыть даты' : 'Отменить'));
  if (b.status === 'cancelled') actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => act(`/bookings/${b.id}`, { status: 'pending' }) }, 'Вернуть'));
  return h('article', { class: `adm-item is-${b.status}` },
    h('div', { class: 'adm-head' },
      h('b', {}, `${b.id} · ${houseName(b.houseId)}`),
      h('span', { class: `adm-badge ${b.status}` }, STATUS[b.status])),
    h('div', { class: 'adm-line' }, `${formatShort(b.checkIn)} → ${formatShort(b.checkOut)} · ${b.nights} ${plural(b.nights, ['ночь', 'ночи', 'ночей'])}`
      + (isBlock ? ` · ${b.name}` : ` · ${b.guests} ${plural(b.guests, ['гость', 'гостя', 'гостей'])} · ${rub(b.total)}`)),
    isBlock ? null : h('div', { class: 'adm-line' }, `${b.name} · `, h('a', { href: `tel:${b.phone}` }, b.phone)),
    b.comment ? h('div', { class: 'adm-line' }, `💬 ${b.comment}`) : null,
    h('div', { class: 'adm-line muted' }, `Создана ${when(b.createdAt)}`),
    actions.length ? h('div', { class: 'adm-actions' }, actions) : null);
}

function requestCard(r) {
  return h('article', { class: `adm-item ${r.status === 'new' ? 'is-pending' : ''}` },
    h('div', { class: 'adm-head' },
      h('b', {}, `${r.id} · ${TYPE[r.type] ?? r.type}`),
      h('span', { class: `adm-badge ${r.status}` }, STATUS[r.status])),
    h('div', { class: 'adm-line' }, `${r.name} · `, h('a', { href: `tel:${r.phone}` }, r.phone)),
    h('div', { class: 'adm-line' }, [r.date && `Дата: ${formatShort(r.date)}`, r.type !== 'question' && `Человек: ${r.people}`, r.eventId && `Мероприятие: ${r.eventId}`, r.packageId && `Пакет: ${r.packageId}`].filter(Boolean).join(' · ')),
    r.comment ? h('div', { class: 'adm-line' }, `💬 ${r.comment}`) : null,
    h('div', { class: 'adm-line muted' }, `Получена ${when(r.createdAt)}`),
    h('div', { class: 'adm-actions' },
      r.status === 'new'
        ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => act(`/requests/${r.id}`, { status: 'done' }) }, 'Отметить обработанной')
        : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => act(`/requests/${r.id}`, { status: 'new' }) }, 'Вернуть в новые')));
}

function scoreRow(s) {
  return h('article', { class: 'adm-item' },
    h('div', { class: 'adm-head' },
      h('b', {}, `${s.name} — ${s.score}`),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => confirm(`Удалить «${s.name}»?`) && act(`/scores/${s.id}`, null, 'DELETE') }, 'Удалить')),
    h('div', { class: 'adm-line muted' }, `${s.hits} попаданий · ${s.createdAt.slice(0, 10)}`));
}

// ---------- события ----------
$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  token = $('#token').value.trim();
  sessionStorage.setItem(KEY, token);
  $('#token').value = '';
  await refresh();
  if (!$('#panel').hidden) timer = setInterval(refresh, 60_000);
});
$('#logout').addEventListener('click', () => { sessionStorage.removeItem(KEY); token = ''; showLogin(); });
$('#showAll').addEventListener('change', render);

$$('.adm-tabs [data-tab]').forEach((btn) => btn.addEventListener('click', () => {
  $$('.adm-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  for (const name of ['bookings', 'requests', 'blocks', 'scores']) $(`#tab-${name}`).hidden = name !== btn.dataset.tab;
}));

$('#blockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await call('/blocks', {
      method: 'POST',
      body: JSON.stringify({ houseId: $('#blockHouse').value, checkIn: $('#blockFrom').value, checkOut: $('#blockTo').value, note: $('#blockNote').value || 'Закрыто администратором' }),
    });
    toast('Даты закрыты', 'ok');
    e.target.reset();
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
});

if (token) {
  refresh().then(() => { if (!$('#panel').hidden) timer = setInterval(refresh, 60_000); });
} else {
  showLogin();
}
