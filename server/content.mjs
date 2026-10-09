// Проверка content/site.json. Файл правят руками, поэтому опечатка (лишняя запятая, неверная дата,
// два домика с одним id) не должна молча сломать сайт — сервер скажет, что именно не так.

import { parseDate } from './booking.mjs';

const ID_RE = /^[\w-]{1,40}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Возвращает список проблем человеческим языком; пустой список — файл в порядке. */
export function validateContent(c) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (!isObj(c)) return ['Файл должен быть JSON-объектом'];

  if (!c.site?.name) bad('site.name: нужно название');
  if (!c.contacts?.phone) bad('contacts.phone: нужен телефон');
  if (!/^\+\d{10,15}$/.test(c.contacts?.phoneHref ?? '')) bad('contacts.phoneHref: формат +79780000000 (без пробелов и скобок)');

  const b = c.booking;
  if (!isObj(b)) bad('booking: нет раздела');
  else {
    if (!Number.isInteger(b.minNights) || b.minNights < 1) bad('booking.minNights: целое число от 1');
    if (!Number.isInteger(b.maxNights) || b.maxNights < (b.minNights ?? 1)) bad('booking.maxNights: целое число не меньше minNights');
    if (!Number.isInteger(b.horizonDays) || b.horizonDays < 1 || b.horizonDays > 730) bad('booking.horizonDays: от 1 до 730');
    if (!TIME_RE.test(b.checkInTime ?? '')) bad('booking.checkInTime: время вида 14:00');
    if (!TIME_RE.test(b.checkOutTime ?? '')) bad('booking.checkOutTime: время вида 12:00');
    try { new Intl.DateTimeFormat('en-CA', { timeZone: b.timezone }); } catch { bad(`booking.timezone: неизвестный пояс «${b.timezone}»`); }
  }

  const seen = (list, label) => {
    const ids = new Set();
    list.forEach((x, i) => {
      if (!ID_RE.test(x?.id ?? '')) bad(`${label}[${i}].id: латиница, цифры, - и _ (до 40 символов)`);
      else if (ids.has(x.id)) bad(`${label}: id «${x.id}» повторяется`);
      ids.add(x?.id);
    });
  };

  if (!Array.isArray(c.houses) || !c.houses.length) bad('houses: нужен хотя бы один домик');
  else {
    seen(c.houses, 'houses');
    c.houses.forEach((h, i) => {
      if (!h.name) bad(`houses[${i}].name: нужно название`);
      if (!Number.isInteger(h.capacity) || h.capacity < 1 || h.capacity > 30) bad(`houses[${i}].capacity: целое число от 1 до 30`);
      if (!Number.isInteger(h.pricePerNight) || h.pricePerNight <= 0) bad(`houses[${i}].pricePerNight: целое число больше нуля`);
      if (!Array.isArray(h.features)) bad(`houses[${i}].features: список строк (можно пустой)`);
      if (!Array.isArray(h.photos)) bad(`houses[${i}].photos: список ссылок (можно пустой)`);
    });
  }

  if (!Array.isArray(c.shootingPackages)) bad('shootingPackages: нужен список пакетов');
  else {
    seen(c.shootingPackages, 'shootingPackages');
    c.shootingPackages.forEach((p, i) => {
      if (!p.name) bad(`shootingPackages[${i}].name: нужно название`);
      if (typeof p.price !== 'number' || p.price < 0) bad(`shootingPackages[${i}].price: число`);
      if (!Array.isArray(p.includes)) bad(`shootingPackages[${i}].includes: список строк`);
    });
  }

  const cats = new Set((c.eventCategories ?? []).map((x) => x.id));
  if (!Array.isArray(c.eventCategories)) bad('eventCategories: нужен список категорий');
  if (!Array.isArray(c.events)) bad('events: нужен список мероприятий (можно пустой)');
  else {
    seen(c.events, 'events');
    c.events.forEach((e, i) => {
      if (!e.title) bad(`events[${i}].title: нужно название`);
      if (parseDate(e.date) === null) bad(`events[${i}].date: дата вида 2026-12-31`);
      if (!TIME_RE.test(e.time ?? '')) bad(`events[${i}].time: время вида 11:00`);
      if (!cats.has(e.category)) bad(`events[${i}].category: нет такой категории «${e.category}»`);
    });
  }

  if (!Number.isInteger(c.game?.roundSize) || c.game.roundSize < 5 || c.game.roundSize > 100) bad('game.roundSize: от 5 до 100');
  return problems;
}
