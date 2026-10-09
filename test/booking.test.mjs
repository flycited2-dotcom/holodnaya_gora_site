import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, formatDate, nightsBetween, addDays, normalizePhone,
  rangesOverlap, busyNights, hasConflict, validateBooking, quote, validateRequest,
} from '../server/booking.mjs';

const houses = [
  { id: 'les', name: 'Лесной', capacity: 4, pricePerNight: 6000 },
  { id: 'mini', name: 'Мини', capacity: 2, pricePerNight: 3500 },
];
const rules = { minNights: 1, maxNights: 21, horizonDays: 365 };
const today = '2026-10-10';

test('parseDate принимает только реальные даты YYYY-MM-DD', () => {
  assert.equal(typeof parseDate('2026-10-10'), 'number');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('2026-13-01'), null);
  assert.equal(parseDate('10.10.2026'), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
  assert.equal(parseDate('2026-10-10T00:00:00'), null);
});

test('formatDate и addDays — обратимы и учитывают границы месяцев/года', () => {
  assert.equal(formatDate(parseDate('2026-12-31') + 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('nightsBetween считает ночи', () => {
  assert.equal(nightsBetween('2026-10-10', '2026-10-13'), 3);
  assert.equal(nightsBetween('2026-10-10', '2026-10-10'), 0);
  assert.equal(nightsBetween('2026-10-13', '2026-10-10'), -3);
  assert.equal(nightsBetween('bad', '2026-10-10'), null);
});

test('normalizePhone приводит российские номера к +7XXXXXXXXXX', () => {
  assert.equal(normalizePhone('+7 (978) 123-45-67'), '+79781234567');
  assert.equal(normalizePhone('8 978 123 45 67'), '+79781234567');
  assert.equal(normalizePhone('9781234567'), '+79781234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('+1 202 555 0100'), null);
  assert.equal(normalizePhone(''), null);
});

test('rangesOverlap: день выезда одного = день заезда другого — не конфликт', () => {
  assert.equal(rangesOverlap('2026-10-10', '2026-10-12', '2026-10-12', '2026-10-14'), false);
  assert.equal(rangesOverlap('2026-10-10', '2026-10-13', '2026-10-12', '2026-10-14'), true);
  assert.equal(rangesOverlap('2026-10-10', '2026-10-20', '2026-10-12', '2026-10-14'), true);
  assert.equal(rangesOverlap('2026-10-12', '2026-10-14', '2026-10-10', '2026-10-20'), true);
});

const stored = [
  { id: 1, houseId: 'les', checkIn: '2026-10-12', checkOut: '2026-10-15', status: 'confirmed' },
  { id: 2, houseId: 'les', checkIn: '2026-10-20', checkOut: '2026-10-22', status: 'pending' },
  { id: 3, houseId: 'les', checkIn: '2026-10-25', checkOut: '2026-10-27', status: 'cancelled' },
  { id: 4, houseId: 'mini', checkIn: '2026-10-12', checkOut: '2026-10-15', status: 'confirmed' },
];

test('busyNights отдаёт ночи активных броней только нужного домика', () => {
  const nights = busyNights(stored, 'les');
  assert.deepEqual(nights, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-20', '2026-10-21']);
});

test('busyNights учитывает ручные блокировки (status blocked)', () => {
  const nights = busyNights([{ houseId: 'les', checkIn: '2026-11-01', checkOut: '2026-11-03', status: 'blocked' }], 'les');
  assert.deepEqual(nights, ['2026-11-01', '2026-11-02']);
});

test('hasConflict: отменённые не мешают, активные мешают', () => {
  assert.equal(hasConflict(stored, 'les', '2026-10-25', '2026-10-27'), false);
  assert.equal(hasConflict(stored, 'les', '2026-10-14', '2026-10-16'), true);
  assert.equal(hasConflict(stored, 'les', '2026-10-15', '2026-10-17'), false);
  assert.equal(hasConflict(stored, 'mini', '2026-10-20', '2026-10-21'), false);
});

const good = {
  houseId: 'les', checkIn: '2026-10-16', checkOut: '2026-10-18', guests: 3,
  name: 'Иван Петров', phone: '+7 978 123-45-67', comment: 'Приедем вечером',
};

test('validateBooking: корректная заявка проходит и нормализуется', () => {
  const r = validateBooking(good, { houses, today, rules, existing: stored });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.phone, '+79781234567');
  assert.equal(r.value.nights, 2);
  assert.equal(r.value.total, 12000);
  assert.equal(r.value.name, 'Иван Петров');
});

test('validateBooking: ловит все основные ошибки', () => {
  const run = (patch) => validateBooking({ ...good, ...patch }, { houses, today, rules, existing: stored });
  assert.equal(run({ houseId: 'nope' }).errors.houseId !== undefined, true);
  assert.equal(run({ checkIn: '2026-10-09', checkOut: '2026-10-11' }).errors.checkIn !== undefined, true);
  assert.equal(run({ checkOut: '2026-10-16' }).errors.checkOut !== undefined, true);
  assert.equal(run({ checkOut: '2026-12-30' }).errors.checkOut !== undefined, true);
  assert.equal(run({ guests: 9 }).errors.guests !== undefined, true);
  assert.equal(run({ guests: 0 }).errors.guests !== undefined, true);
  assert.equal(run({ name: ' ' }).errors.name !== undefined, true);
  assert.equal(run({ phone: '123' }).errors.phone !== undefined, true);
  assert.equal(run({ checkIn: '2026-10-14', checkOut: '2026-10-16' }).errors.checkIn !== undefined, true);
  assert.equal(run({ checkIn: '2028-10-14', checkOut: '2028-10-16' }).errors.checkIn !== undefined, true);
});

test('validateBooking: обрезает длинные строки и чистит управляющие символы', () => {
  const r = validateBooking({ ...good, name: 'А'.repeat(500), comment: 'x\u0000y'.repeat(900) }, { houses, today, rules, existing: [] });
  assert.equal(r.ok, true);
  assert.ok(r.value.name.length <= 80);
  assert.ok(r.value.comment.length <= 1000);
  assert.ok(!r.value.comment.includes('\u0000'));
});

test('quote считает сумму', () => {
  assert.equal(quote(houses[0], 3), 18000);
  assert.equal(quote(houses[1], 1), 3500);
});

test('validateRequest: запись на стрельбу', () => {
  const ok = validateRequest(
    { type: 'shooting', name: 'Анна', phone: '89781234567', date: '2026-10-17', people: 4, comment: '' },
    { today, rules },
  );
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.people, 4);

  const bad = validateRequest({ type: 'shooting', name: '', phone: 'x', date: '2020-01-01', people: 0 }, { today, rules });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.name && bad.errors.phone && bad.errors.date && bad.errors.people);

  const wrongType = validateRequest({ type: 'hack', name: 'Анна', phone: '89781234567' }, { today, rules });
  assert.equal(wrongType.ok, false);
});

test('validateRequest: дата необязательна для вопроса, но если есть — должна быть валидной', () => {
  const q = validateRequest({ type: 'question', name: 'Олег', phone: '89781234567', comment: 'Сколько стоит?' }, { today, rules });
  assert.equal(q.ok, true, JSON.stringify(q.errors));
  const badDate = validateRequest({ type: 'question', name: 'Олег', phone: '89781234567', date: '31.12.2026' }, { today, rules });
  assert.equal(badDate.ok, false);
});
