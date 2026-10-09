// Афиша мероприятий: фильтры, карточки, запись и выгрузка в календарь (.ics).

import { $, h, dayNum, parts, MONTHS_SHORT, WEEKDAYS_SHORT, weekdayMon0, formatLong, formatShort, plural, track } from './util.js';

function until(iso, today) {
  const n = dayNum(iso) - dayNum(today);
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Событие как файл календаря. Время «плавающее» (локальное), поэтому не зависит от часового пояса клиента. */
function downloadIcs(ev, content) {
  const d = ev.date.replaceAll('-', '');
  const [hh, mm] = ev.time.split(':');
  const start = `${d}T${hh}${mm}00`;
  const endHour = String(Math.min(23, Number(hh) + 3)).padStart(2, '0');
  const end = `${d}T${endHour}${mm}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Holodnaya Gora//RU', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${ev.id}@holodnaya-gora`, `DTSTAMP:${stamp}`,
    `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.description)}`,
    `LOCATION:${icsEscape(content.contacts.address)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${ev.id}.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  track('event_ics', { event: ev.id });
}

export function initEvents(content) {
  const grid = $('#eventsGrid');
  const filters = $('#eventFilters');
  if (!grid) return;

  const today = content.today;
  const upcoming = content.events
    .filter((e) => (e.endDate ?? e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const labels = Object.fromEntries(content.eventCategories.map((c) => [c.id, c.label]));
  let active = 'all';

  // ближайшее событие — в hero
  const next = upcoming[0];
  const chip = $('#nextEvent');
  if (next && chip) {
    chip.replaceChildren(h('span', {}, 'Ближайшее: ', h('b', {}, next.title), ` · ${formatShort(next.date)}`));
    chip.hidden = false;
  }

  function renderCards() {
    const list = upcoming.filter((e) => active === 'all' || e.category === active);
    if (!list.length) {
      grid.replaceChildren(h('div', { class: 'events-empty' },
        upcoming.length ? 'В этой категории пока ничего нет.' : 'Скоро анонсируем новые мероприятия. Позвоните — расскажем, что планируется.'));
      return;
    }
    grid.replaceChildren(...list.map((e) => {
      const { d, m } = parts(e.date);
      return h('article', { class: 'event' },
        h('div', { class: 'event-date' }, h('b', {}, String(d)), h('span', {}, MONTHS_SHORT[m - 1]), h('em', {}, WEEKDAYS_SHORT[weekdayMon0(e.date)])),
        h('div', {},
          h('span', { class: 'event-tag' }, labels[e.category] ?? ''),
          h('h3', {}, e.title),
          h('p', {}, e.description),
          h('p', { class: 'event-meta' }, `${formatLong(e.date)}, ${e.time} · ${until(e.date, today)}${e.price ? ` · ${e.price}` : ''}`),
          h('div', { class: 'event-actions' },
            e.signup ? h('button', { class: 'btn btn-sm', type: 'button', dataset: { request: 'event', event: e.id } }, 'Записаться') : null,
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => downloadIcs(e, content) }, 'В календарь'))));
    }));
  }

  const present = new Set(upcoming.map((e) => e.category));
  const cats = [{ id: 'all', label: 'Все' }, ...content.eventCategories.filter((c) => present.has(c.id))];
  filters.replaceChildren(...cats.map((c) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(c.id === active),
    onclick: (ev) => {
      active = c.id;
      filters.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
      renderCards();
    },
  }, c.label)));
  filters.hidden = cats.length <= 2;

  renderCards();
}
