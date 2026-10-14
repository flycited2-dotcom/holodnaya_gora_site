// Бронирование домика: выбор домика → даты в календаре → контакты → заявка.
// Занятые даты приходят с сервера; повторную проверку сервер всё равно делает сам.

import { api } from './api.js';
import {
  $, $$, h, rub, plural, dayNum, addDays, parts, MONTHS, WEEKDAYS_SHORT, weekdayMon0,
  formatLong, formatShort, storage, track, toast, attachPhoneMask, showFieldErrors,
} from './util.js';

const CABIN_SVG = (n) => `
<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="hs${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13414a"/><stop offset="1" stop-color="#e58a47" stop-opacity=".55"/></linearGradient></defs>
  <rect width="320" height="200" fill="url(#hs${n})"/>
  <circle cx="${230 + n * 14}" cy="104" r="20" fill="#ffd9a0" opacity=".9"/>
  <path d="M0 140 Q60 96 130 128 T260 118 T320 130 V200 H0Z" fill="#18523f"/>
  <path d="M0 160 Q90 128 180 156 T320 150 V200 H0Z" fill="#0d3a2c"/>
  <g fill="#06241c">
    <path d="M26 176 l18 -62 l18 62z"/><path d="M34 176 l10 -86 l10 86z" opacity=".0"/>
    <path d="M276 178 l20 -70 l20 70z"/><path d="M250 182 l14 -48 l14 48z"/>
  </g>
  <g transform="translate(${96 + n * 6} 108)">
    <rect x="0" y="34" width="${84 + n * 8}" height="46" fill="#4b2e1c"/>
    <path d="M-10 36 L${42 + n * 4} -8 L${94 + n * 8} 36Z" fill="#2d1b11"/>
    <rect x="${14 + n * 2}" y="48" width="16" height="18" rx="2" fill="#ffb347"/>
    <rect x="${44 + n * 4}" y="48" width="16" height="18" rx="2" fill="#ffb347" opacity=".85"/>
    <rect x="${64 + n * 6}" y="54" width="12" height="26" fill="#1d120a"/>
  </g>
</svg>`;

function svgFromString(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export async function initBooking(content) {
  const root = $('#booking');
  if (!root) return;

  const rules = content.booking;
  const houses = content.houses;
  const wide = window.matchMedia('(min-width: 901px)');
  const form = $('#bookingForm');
  const calendarEl = $('#calendar');
  const hintEl = $('#dateHint');
  const summaryBody = $('#summaryBody');
  const submitBtn = $('#bookingSubmit');
  const errorBox = $('#bookingError');
  const guestInput = $('#bkGuests');

  const st = {
    today: content.today,
    houseId: houses[0]?.id ?? null,
    checkIn: null,
    checkOut: null,
    hover: null,
    view: { y: parts(content.today).y, m: parts(content.today).m },
    busy: {},
    sending: false,
  };
  const house = () => houses.find((x) => x.id === st.houseId);
  const busySet = () => new Set(st.busy[st.houseId] ?? []);
  const maxDay = () => dayNum(st.today) + rules.horizonDays;

  async function loadAvailability() {
    try {
      const data = await api.availability();
      st.today = data.today;
      st.busy = data.busy;
    } catch { /* без данных календарь просто покажет всё свободным — сервер всё равно проверит */ }
  }

  // ---------- карточки домиков ----------
  const cardsEl = $('#houseCards');
  function renderHouses() {
    cardsEl.replaceChildren(...houses.map((x, i) => {
      const art = h('div', { class: 'house-art' },
        x.photos?.[0] ? h('img', { src: x.photos[0], alt: x.name, loading: 'lazy' }) : svgFromString(CABIN_SVG(i)),
        h('span', { class: 'house-pick', 'aria-hidden': 'true' }));
      const card = h('button', {
        class: 'house', type: 'button', role: 'radio', 'aria-checked': String(x.id === st.houseId),
        dataset: { house: x.id },
        onclick: () => selectHouse(x.id, true),
      },
      art,
      h('div', { class: 'house-body' },
        h('span', { class: 'house-tag' }, x.tag),
        h('h3', {}, x.name),
        h('p', { class: 'house-desc' }, x.description),
        h('ul', { class: 'house-features' }, x.features.map((f) => h('li', {}, f))),
        h('div', { class: 'house-foot' },
          h('span', { class: 'house-price' }, rub(x.pricePerNight), ' ', h('small', {}, '/ ночь')),
          h('span', { class: 'house-cap' }, `до ${x.capacity} ${plural(x.capacity, ['гостя', 'гостей', 'гостей'])}`))));
      return card;
    }));
  }

  function selectHouse(id, scroll) {
    st.houseId = id;
    $$('.house', cardsEl).forEach((c) => c.setAttribute('aria-checked', String(c.dataset.house === id)));
    $('#bookingHouseName').textContent = `· ${house().name}`;
    guestInput.max = house().capacity;
    if (Number(guestInput.value) > house().capacity) guestInput.value = house().capacity;
    // выбранные даты могли стать недоступными в другом домике
    if (st.checkIn && st.checkOut && !rangeFree(st.checkIn, st.checkOut)) { st.checkIn = null; st.checkOut = null; }
    renderCalendar(); updateSummary();
    if (scroll) track('booking_select_house', { house: id });
  }

  // ---------- календарь ----------
  function rangeFree(from, to) {
    const busy = busySet();
    for (let d = dayNum(from); d < dayNum(to); d++) {
      if (busy.has(addDays(from, d - dayNum(from)))) return false;
    }
    return true;
  }

  /** Можно ли нажать на день в текущем состоянии выбора. */
  function canPick(iso) {
    const d = dayNum(iso);
    if (d < dayNum(st.today) || d > maxDay()) return false;
    const busy = busySet();
    if (st.checkIn && !st.checkOut && iso > st.checkIn) { // выбираем выезд
      const nights = d - dayNum(st.checkIn);
      if (nights < rules.minNights || nights > rules.maxNights) return false;
      return rangeFree(st.checkIn, iso);
    }
    return !busy.has(iso); // выбираем заезд
  }

  function pick(iso) {
    if (st.checkIn && !st.checkOut && iso > st.checkIn) {
      st.checkOut = iso;
    } else {
      st.checkIn = iso;
      st.checkOut = null;
    }
    st.hover = null;
    paintDays(); updateSummary(); updateHint();
  }

  function addMonth(view, k) {
    const idx = view.y * 12 + (view.m - 1) + k;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  }

  function renderCalendar() {
    const count = wide.matches ? 2 : 1;
    const cur = { y: parts(st.today).y, m: parts(st.today).m };
    const last = addMonth(cur, Math.floor(rules.horizonDays / 30));
    const viewIdx = st.view.y * 12 + st.view.m;
    const canPrev = viewIdx > cur.y * 12 + cur.m;
    const canNext = viewIdx + count - 1 < last.y * 12 + last.m;

    const nav = h('div', { class: 'cal-head' },
      h('button', { class: 'cal-nav', type: 'button', 'aria-label': 'Предыдущий месяц', disabled: !canPrev, onclick: () => { st.view = addMonth(st.view, -1); renderCalendar(); } }, '‹'),
      h('span', { class: 'sr-only' }, 'Календарь'),
      h('button', { class: 'cal-nav', type: 'button', 'aria-label': 'Следующий месяц', disabled: !canNext, onclick: () => { st.view = addMonth(st.view, 1); renderCalendar(); } }, '›'));

    const months = h('div', { class: 'cal-months' });
    for (let k = 0; k < count; k++) {
      const { y, m } = addMonth(st.view, k);
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': `${MONTHS[m - 1]} ${y}` },
        WEEKDAYS_SHORT.map((w) => h('div', { class: 'cal-dow', role: 'columnheader' }, w)),
        Array.from({ length: weekdayMon0(first) }, () => h('span', { class: 'cal-day is-blank', 'aria-hidden': 'true' })));
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        grid.append(h('button', {
          class: 'cal-day', type: 'button', dataset: { iso }, role: 'gridcell',
          onclick: () => { if (canPick(iso)) pick(iso); else rejectPick(iso); },
          onmouseenter: () => { if (st.checkIn && !st.checkOut && canPick(iso)) { st.hover = iso; paintDays(); } },
        }, String(d)));
      }
      months.append(h('div', {}, h('div', { class: 'cal-title' }, `${MONTHS[m - 1]} ${y}`), grid));
    }
    months.addEventListener('mouseleave', () => { if (st.hover) { st.hover = null; paintDays(); } });

    const legend = h('div', { class: 'cal-legend' },
      h('span', {}, h('i', { style: 'background:var(--accent)' }), 'ваш выбор'),
      h('span', {}, h('i', { style: 'background:repeating-linear-gradient(135deg,rgba(255,255,255,.25) 0 3px,transparent 3px 6px)' }), 'занято'));
    calendarEl.replaceChildren(nav, months, legend);
    paintDays();
  }

  function rejectPick(iso) {
    if (dayNum(iso) < dayNum(st.today)) return;
    if (st.checkIn && !st.checkOut && iso > st.checkIn) {
      toast('В этом промежутке есть занятые даты — выберите другой выезд', 'error');
    }
  }

  function paintDays() {
    const hoverEnd = st.hover && st.checkIn && !st.checkOut ? st.hover : null;
    const end = st.checkOut ?? hoverEnd;
    const busy = busySet();
    $$('.cal-day[data-iso]', calendarEl).forEach((el) => {
      const iso = el.dataset.iso;
      const past = dayNum(iso) < dayNum(st.today);
      const pickable = canPick(iso);
      const isBusy = busy.has(iso);
      el.classList.toggle('is-past', past);
      el.classList.toggle('is-busy', isBusy && !past);
      el.classList.toggle('is-checkout-only', isBusy && pickable);
      el.classList.toggle('is-today', iso === st.today);
      el.disabled = !pickable;
      el.classList.toggle('is-start', iso === st.checkIn);
      el.classList.toggle('is-end', !!end && iso === end);
      el.classList.toggle('is-range', !!st.checkIn && !!end && iso > st.checkIn && iso < end);
      const selected = iso === st.checkIn || iso === st.checkOut;
      el.setAttribute('aria-pressed', String(selected));
      el.setAttribute('aria-label', `${formatLong(iso)}${isBusy ? ', занято' : ''}${iso === st.checkIn ? ', заезд' : ''}${iso === st.checkOut ? ', выезд' : ''}`);
    });
  }

  function updateHint() {
    if (!st.checkIn) hintEl.textContent = 'Нажмите дату заезда. Дни с зачёркиванием уже заняты.';
    else if (!st.checkOut) hintEl.textContent = `Заезд ${formatShort(st.checkIn)}. Теперь выберите дату выезда.`;
    else {
      const n = dayNum(st.checkOut) - dayNum(st.checkIn);
      hintEl.textContent = `${n} ${plural(n, ['ночь', 'ночи', 'ночей'])}: ${formatShort(st.checkIn)} → ${formatShort(st.checkOut)}`;
    }
  }

  // ---------- сводка ----------
  function nights() {
    return st.checkIn && st.checkOut ? dayNum(st.checkOut) - dayNum(st.checkIn) : 0;
  }
  function updateSummary() {
    const hs = house();
    const n = nights();
    const guests = Number(guestInput.value) || 1;
    if (!hs || !n) {
      summaryBody.replaceChildren(h('p', { class: 'sum-empty' }, hs ? `${hs.name}. Выберите даты заезда и выезда в календаре.` : 'Выберите домик.'));
      submitBtn.disabled = true;
    } else {
      summaryBody.replaceChildren(
        row('Домик', hs.name),
        row('Заезд', `${formatShort(st.checkIn)}, с ${rules.checkInTime}`),
        row('Выезд', `${formatShort(st.checkOut)}, до ${rules.checkOutTime}`),
        row('Гостей', String(guests)),
        row('Ночей', `${n} × ${rub(hs.pricePerNight)}`),
        h('div', { class: 'sum-total' }, h('span', {}, 'Итого'), h('b', {}, rub(hs.pricePerNight * n))));
      submitBtn.disabled = false;
    }
    $('#bookingNote').textContent = rules.note;
    updateHint();
    // 3D-домик (tour.js) показывает выбранный домик и сезон по дате заезда
    document.dispatchEvent(new CustomEvent('hg:booking', { detail: { houseId: st.houseId, checkIn: st.checkIn, checkOut: st.checkOut } }));
  }
  const row = (k, v) => h('div', { class: 'sum-row' }, h('span', {}, k), h('b', {}, v));

  // ---------- гости ----------
  $$('#guestStepper [data-step]').forEach((b) => b.addEventListener('click', () => {
    const max = house()?.capacity ?? 6;
    guestInput.value = Math.min(max, Math.max(1, (Number(guestInput.value) || 1) + Number(b.dataset.step)));
    updateSummary();
  }));
  guestInput.addEventListener('change', () => {
    const max = house()?.capacity ?? 6;
    guestInput.value = Math.min(max, Math.max(1, Number(guestInput.value) || 1));
    updateSummary();
  });

  // ---------- контакты ----------
  attachPhoneMask(form.elements.phone);
  const saved = storage.get('hg_contact');
  if (saved) { form.elements.name.value = saved.name ?? ''; form.elements.phone.value = saved.phone ?? ''; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (st.sending) return;
    errorBox.hidden = true;

    const local = {};
    if (!st.checkIn || !st.checkOut) local.checkIn = 'Выберите даты';
    if (form.elements.name.value.trim().length < 2) local.name = 'Укажите имя';
    if (form.elements.phone.value.replace(/\D/g, '').length < 11) local.phone = 'Укажите телефон полностью';
    if (!form.elements.consent.checked) local.consent = 'Нужно согласие на обработку данных';
    showFieldErrors(form, local);
    if (Object.keys(local).length) {
      if (local.checkIn) { errorBox.textContent = 'Выберите даты заезда и выезда в календаре'; errorBox.hidden = false; $('#calendar').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    st.sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';
    try {
      const { booking } = await api.createBooking({
        houseId: st.houseId, checkIn: st.checkIn, checkOut: st.checkOut,
        guests: Number(guestInput.value), name: form.elements.name.value, phone: form.elements.phone.value,
        comment: form.elements.comment.value, website: form.elements.website.value,
      });
      storage.set('hg_contact', { name: form.elements.name.value, phone: form.elements.phone.value });
      track('booking_submit', { house: st.houseId, nights: booking.nights, total: booking.total });
      showDone(booking);
      await loadAvailability();
    } catch (err) {
      if (err.errors) {
        showFieldErrors(form, err.errors);
        const general = [err.errors.houseId, err.errors.checkIn, err.errors.checkOut].filter(Boolean).join('. ');
        if (general) { errorBox.textContent = general; errorBox.hidden = false; }
        if (err.errors.checkIn || err.errors.checkOut) { st.checkIn = null; st.checkOut = null; await loadAvailability(); renderCalendar(); updateSummary(); }
      } else {
        errorBox.textContent = `${err.message} Можно позвонить: ${content.contacts.phone}`;
        errorBox.hidden = false;
      }
    } finally {
      st.sending = false;
      submitBtn.textContent = 'Отправить заявку';
      updateSummary();
    }
  });

  function showDone(b) {
    const phoneLink = h('a', { href: `tel:${content.contacts.phoneHref}` }, content.contacts.phone);
    const done = h('div', { class: 'b-block booking-done', role: 'status', style: 'grid-column:1/-1;text-align:center;padding:48px 24px' },
      h('div', { class: 'done-mark', 'aria-hidden': 'true' }, '✓'),
      h('h3', { style: 'justify-content:center;font-size:1.6rem;margin-bottom:12px' }, 'Заявка принята'),
      h('p', { class: 'muted' }, 'Номер вашей брони (сохраните его):'),
      h('p', { style: 'font-family:var(--font-display);font-weight:800;font-size:2rem;color:var(--accent-2);margin:0 0 16px' }, b.id),
      h('p', {}, `${b.house}, ${formatShort(b.checkIn)} → ${formatShort(b.checkOut)}, ${b.nights} ${plural(b.nights, ['ночь', 'ночи', 'ночей'])}, ${rub(b.total)}.`),
      h('p', { class: 'muted' }, 'Администратор свяжется с вами, чтобы подтвердить бронь. Если не дозвонились — позвоните сами: ', phoneLink, '.'),
      h('button', { class: 'btn', type: 'button', onclick: reset }, 'Оформить ещё одну'));
    root.replaceChildren(done);
    done.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function reset() { location.hash = '#houses'; location.reload(); }

  // ---------- старт ----------
  renderHouses();
  await loadAvailability();
  selectHouse(st.houseId, false);
  wide.addEventListener('change', renderCalendar);
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && !st.sending) { await loadAvailability(); paintDays(); }
  });
}
