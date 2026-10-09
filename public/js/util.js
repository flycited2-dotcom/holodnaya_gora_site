// Мелкие общие помощники.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Мини-«hyperscript»: h('div', {class: 'x', onclick}, 'текст', childNode). Текст всегда экранируется. */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') throw new Error('h(): html запрещён, используйте текстовые узлы');
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// --- даты: 'YYYY-MM-DD' и номера дней (как на сервере, без часовых поясов) ----
const DAY = 86_400_000;
export const dayNum = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
export const isoFromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoFromDay(dayNum(iso) + n);
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
export function formatLong(iso) {
  const { d, m, y } = parts(iso);
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}
export function formatShort(iso) {
  const { d, m } = parts(iso);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}
/** День недели, понедельник = 0. */
export function weekdayMon0(iso) {
  return (new Date(dayNum(iso) * DAY).getUTCDay() + 6) % 7;
}

// --- хранилище, которое не падает в приватном режиме ---------------------------
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ничего страшного */ }
  },
};

// --- аналитика: цели Яндекс.Метрики (если счётчик подключён) --------------------
export function track(goal, params) {
  try {
    const id = Number(document.querySelector('meta[name="metrika-id"]')?.content);
    if (id && typeof window.ym === 'function') window.ym(id, 'reachGoal', goal, params);
  } catch { /* аналитика не должна ломать сайт */ }
}

export function toast(message, kind = 'info', ms = 4500) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const node = h('div', { class: `toast ${kind === 'error' ? 'toast-error' : kind === 'ok' ? 'toast-ok' : ''}` }, message);
  box.append(node);
  setTimeout(() => node.remove(), ms);
}

export const debounce = (fn, ms = 150) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Маска телефона: +7 978 123-45-67 */
export function attachPhoneMask(input) {
  const format = (raw) => {
    let d = raw.replace(/\D/g, '');
    if (!d) return '';
    if (d[0] === '8' || d[0] === '7') d = d.slice(1);
    d = d.slice(0, 10);
    let out = '+7';
    if (d.length) out += ` ${d.slice(0, 3)}`;
    if (d.length > 3) out += ` ${d.slice(3, 6)}`;
    if (d.length > 6) out += `-${d.slice(6, 8)}`;
    if (d.length > 8) out += `-${d.slice(8, 10)}`;
    return out;
  };
  input.addEventListener('input', () => {
    // не ломаем удаление: если пользователь стирает, просто переформатируем
    input.value = format(input.value);
  });
  input.addEventListener('focus', () => { if (!input.value) input.value = '+7 '; });
  input.addEventListener('blur', () => { if (input.value.replace(/\D/g, '').length <= 1) input.value = ''; });
}

/** Показать ошибки полей из ответа сервера: errors = {phone: '...'} */
export function showFieldErrors(form, errors = {}) {
  for (const el of form.querySelectorAll('[data-error]')) {
    const key = el.dataset.error;
    el.textContent = errors[key] ?? '';
    const input = form.elements[key];
    if (input && 'setAttribute' in input) {
      if (errors[key]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
}
