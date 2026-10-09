// Диалог «Записаться»: стрельба, мероприятие или вопрос. Открывается любой кнопкой с data-request.

import { api } from './api.js';
import { $, h, rub, addDays, storage, track, attachPhoneMask, showFieldErrors, formatShort } from './util.js';

const COPY = {
  shooting: {
    title: 'Запись на стрельбу',
    lead: 'Оставьте контакты — администратор перезвонит и подтвердит время.',
    done: 'Мы перезвоним и подберём удобное время для стрельбы.',
  },
  event: {
    title: 'Запись на мероприятие',
    lead: 'Оставьте контакты — мы закрепим за вами место.',
    done: 'Место за вами закреплено предварительно — администратор подтвердит запись по телефону.',
  },
  question: {
    title: 'Задать вопрос',
    lead: 'Напишите, что вас интересует, — ответим по телефону.',
    done: 'Мы получили ваш вопрос и скоро свяжемся с вами.',
  },
};

export function initRequests(content) {
  const dlg = $('#requestDialog');
  const form = $('#requestForm');
  if (!dlg || !form || typeof dlg.showModal !== 'function') return;

  const titleEl = $('#reqTitle');
  const leadEl = $('#reqLead');
  const packageRow = $('#reqPackageRow');
  const packageSel = $('#reqPackage');
  const eventRow = $('#reqEventRow');
  const eventName = $('#reqEventName');
  const dateRow = $('#reqDateRow');
  const peopleRow = $('#reqPeopleRow');
  const errorBox = $('#reqError');
  const done = $('#reqDone');
  const submit = $('#reqSubmit');
  let ctx = { type: 'shooting', eventId: '', packageId: '' };

  packageSel.replaceChildren(...content.shootingPackages.map((p) =>
    h('option', { value: p.id }, `${p.name} — ${rub(p.price)} ${p.unit}`)));

  const dateInput = form.elements.date;
  dateInput.min = content.today;
  dateInput.max = addDays(content.today, content.booking.horizonDays);
  attachPhoneMask(form.elements.phone);

  function open({ type = 'shooting', eventId = '', packageId = '' } = {}) {
    ctx = { type: COPY[type] ? type : 'shooting', eventId, packageId };
    const copy = COPY[ctx.type];
    titleEl.textContent = copy.title;
    leadEl.textContent = copy.lead;

    const ev = ctx.type === 'event' ? content.events.find((e) => e.id === eventId) : null;
    packageRow.hidden = ctx.type !== 'shooting';
    eventRow.hidden = !ev;
    dateRow.hidden = ctx.type !== 'shooting';
    peopleRow.hidden = ctx.type === 'question';
    if (ev) {
      titleEl.textContent = 'Запись на мероприятие';
      eventName.textContent = `${ev.title} · ${formatShort(ev.date)}, ${ev.time}`;
    }
    if (packageId) packageSel.value = packageId;
    form.elements.date.value = '';
    form.elements.comment.value = '';
    form.elements.consent.checked = false;

    const saved = storage.get('hg_contact');
    if (saved) { form.elements.name.value = saved.name ?? ''; form.elements.phone.value = saved.phone ?? ''; }

    showFieldErrors(form, {});
    errorBox.hidden = true;
    form.hidden = false;
    done.hidden = true;
    submit.disabled = false;
    submit.textContent = 'Отправить';
    if (!dlg.open) dlg.showModal();
    track('request_open', { type: ctx.type });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-request]');
    if (!btn) return;
    e.preventDefault();
    open({ type: btn.dataset.request, eventId: btn.dataset.event, packageId: btn.dataset.package });
  });

  const close = () => dlg.close();
  $('#reqClose').addEventListener('click', close);
  $('#reqDoneClose').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { // клик по подложке
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;

    const local = {};
    if (form.elements.name.value.trim().length < 2) local.name = 'Укажите имя';
    if (form.elements.phone.value.replace(/\D/g, '').length < 11) local.phone = 'Укажите телефон полностью';
    if (!form.elements.consent.checked) local.consent = 'Нужно согласие на обработку данных';
    if (ctx.type === 'question' && form.elements.comment.value.trim().length < 3) local.comment = 'Напишите ваш вопрос';
    showFieldErrors(form, local);
    if (Object.keys(local).length) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }

    submit.disabled = true;
    submit.textContent = 'Отправляем…';
    try {
      const ev = ctx.eventId ? content.events.find((x) => x.id === ctx.eventId) : null;
      await api.createRequest({
        type: ctx.type,
        name: form.elements.name.value,
        phone: form.elements.phone.value,
        date: ev ? ev.date : form.elements.date.value,
        people: ctx.type === 'question' ? 1 : Number(form.elements.people.value) || 1,
        eventId: ctx.eventId || undefined,
        packageId: ctx.type === 'shooting' ? packageSel.value : undefined,
        comment: form.elements.comment.value,
        website: form.elements.website.value,
      });
      storage.set('hg_contact', { name: form.elements.name.value, phone: form.elements.phone.value });
      track('request_submit', { type: ctx.type });
      $('#reqDoneText').textContent = COPY[ctx.type].done;
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      if (err.errors) showFieldErrors(form, err.errors);
      errorBox.textContent = err.errors ? 'Проверьте выделенные поля' : `${err.message} Можно позвонить: ${content.contacts.phone}`;
      errorBox.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Отправить';
    }
  });
}
