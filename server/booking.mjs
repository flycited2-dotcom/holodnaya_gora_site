// Чистая логика бронирования: даты, пересечения, валидация, цена.
// Без доступа к диску и сети — поэтому легко тестируется.
//
// Даты — строки 'YYYY-MM-DD' (календарные дни по местному времени базы, без часовых поясов).
// Бронь занимает ночи [checkIn, checkOut): день выезда свободен для следующего гостя.

const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Статусы, которые занимают даты. cancelled — освобождает. */
export const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'blocked']);
export const REQUEST_TYPES = new Set(['shooting', 'event', 'question']);

/** 'YYYY-MM-DD' -> номер дня от эпохи, либо null, если дата нереальная. */
export function parseDate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

export function formatDate(dayNumber) {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  const day = parseDate(s);
  return day === null ? null : formatDate(day + n);
}

export function nightsBetween(checkIn, checkOut) {
  const a = parseDate(checkIn);
  const b = parseDate(checkOut);
  return a === null || b === null ? null : b - a;
}

/** Сегодняшняя дата в часовом поясе базы (Крым = Europe/Simferopol). */
export function todayIn(timeZone = 'Europe/Simferopol', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return parts; // en-CA даёт YYYY-MM-DD
}

/** Российский номер -> '+7XXXXXXXXXX' либо null. */
export function normalizePhone(s) {
  if (typeof s !== 'string') return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return `+7${digits.slice(1)}`;
  // 10 цифр без кода страны: мобильные (9xx) и крымские городские (365…)
  if (digits.length === 10 && (digits[0] === '9' || digits[0] === '3')) return `+7${digits}`;
  return null;
}

/** Пересечение полуоткрытых интервалов [aIn, aOut) и [bIn, bOut). */
export function rangesOverlap(aIn, aOut, bIn, bOut) {
  return aIn < bOut && bIn < aOut;
}

/** Список занятых ночей домика (отсортирован, без повторов). */
export function busyNights(bookings, houseId) {
  const set = new Set();
  for (const b of bookings) {
    if (b.houseId !== houseId || !ACTIVE_STATUSES.has(b.status)) continue;
    const from = parseDate(b.checkIn);
    const to = parseDate(b.checkOut);
    if (from === null || to === null) continue;
    for (let d = from; d < to; d++) set.add(formatDate(d));
  }
  return [...set].sort();
}

export function hasConflict(bookings, houseId, checkIn, checkOut, ignoreId = null) {
  return bookings.some((b) =>
    b.houseId === houseId
    && b.id !== ignoreId
    && ACTIVE_STATUSES.has(b.status)
    && rangesOverlap(checkIn, checkOut, b.checkIn, b.checkOut));
}

export function quote(house, nights) {
  return house.pricePerNight * nights;
}

// --- очистка пользовательского ввода ---------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanLine(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d{1,4}$/.test(v.trim())) return Number(v);
  return null;
}

function checkContacts(input, errors) {
  const name = cleanLine(input.name, 80);
  if (name.length < 2) errors.name = 'Укажите имя';
  const phone = normalizePhone(typeof input.phone === 'string' ? input.phone : '');
  if (!phone) errors.phone = 'Укажите телефон в формате +7 978 123-45-67';
  return { name, phone };
}

function checkFutureDate(value, today, horizonDays, label, errors, key) {
  const day = parseDate(value);
  const t = parseDate(today);
  if (day === null) { errors[key] = `${label}: неверная дата`; return false; }
  if (day < t) { errors[key] = `${label}: дата уже прошла`; return false; }
  if (day - t > horizonDays) { errors[key] = `${label}: слишком далеко вперёд`; return false; }
  return true;
}

/**
 * Проверка заявки на бронь домика.
 * @returns {{ok: boolean, errors: Record<string,string>, value?: object}}
 */
export function validateBooking(input, { houses, today, rules, existing }) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const house = houses.find((h) => h.id === src.houseId);
  if (!house) errors.houseId = 'Выберите домик';

  const { name, phone } = checkContacts(src, errors);

  const guests = toInt(src.guests);
  if (guests === null || guests < 1) errors.guests = 'Укажите число гостей';
  else if (house && guests > house.capacity) errors.guests = `В этом домике максимум ${house.capacity} гостей`;

  const checkIn = typeof src.checkIn === 'string' ? src.checkIn : '';
  const checkOut = typeof src.checkOut === 'string' ? src.checkOut : '';
  const inOk = checkFutureDate(checkIn, today, rules.horizonDays, 'Заезд', errors, 'checkIn');
  const outOk = parseDate(checkOut) !== null;
  if (!outOk) errors.checkOut = 'Выезд: неверная дата';

  if (inOk && outOk) {
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < rules.minNights) {
      errors.checkOut = rules.minNights === 1
        ? 'Выезд должен быть позже заезда'
        : `Минимальный срок — ${rules.minNights} ноч.`;
    } else if (nights > rules.maxNights) {
      errors.checkOut = `Максимальный срок онлайн-брони — ${rules.maxNights} ноч. Для длительного проживания позвоните нам`;
    } else if (house && hasConflict(existing, house.id, checkIn, checkOut)) {
      errors.checkIn = 'На эти даты домик уже занят — выберите другие';
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const nights = nightsBetween(checkIn, checkOut);
  return {
    ok: true,
    errors,
    value: {
      houseId: house.id,
      checkIn,
      checkOut,
      nights,
      guests,
      name,
      phone,
      comment: cleanText(src.comment, 1000),
      total: quote(house, nights),
    },
  };
}

/**
 * Проверка обращения: запись на стрельбу, на мероприятие или вопрос.
 */
export function validateRequest(input, { today, rules }) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  if (!REQUEST_TYPES.has(src.type)) errors.type = 'Неизвестный тип обращения';
  const { name, phone } = checkContacts(src, errors);

  let date = '';
  if (src.date !== undefined && src.date !== null && src.date !== '') {
    date = String(src.date);
    checkFutureDate(date, today, rules.horizonDays, 'Дата', errors, 'date');
  }

  let people = 1;
  if (src.people !== undefined && src.people !== null && src.people !== '') {
    const n = toInt(src.people);
    if (n === null || n < 1 || n > 50) errors.people = 'Количество человек: от 1 до 50';
    else people = n;
  }

  const eventId = typeof src.eventId === 'string' && /^[\w-]{1,40}$/.test(src.eventId) ? src.eventId : '';
  const packageId = typeof src.packageId === 'string' && /^[\w-]{1,40}$/.test(src.packageId) ? src.packageId : '';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    value: {
      type: src.type, name, phone, date, people, eventId, packageId,
      comment: cleanText(src.comment, 1000),
    },
  };
}
