// Точка входа: общее поведение страницы + запуск модулей.

import { api } from './api.js';
import { $, $$, h, rub, toast, track } from './util.js';
import { initHero } from './hero.js';
import { initGame } from './game.js';
import { initBooking } from './booking.js';
import { initRequests } from './requests.js';
import { initEvents } from './events.js';
import { initAnalytics } from './analytics.js';

document.documentElement.classList.add('js-ready');

// ---------- появление блоков при прокрутке ----------
function initReveal() {
  const nodes = $$('.reveal');
  if (!('IntersectionObserver' in window)) { nodes.forEach((n) => n.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  nodes.forEach((n) => io.observe(n));
  setTimeout(() => nodes.forEach((n) => n.classList.add('in')), 4000); // страховка
}

// ---------- шапка и меню ----------
function initHeader() {
  const header = $('#header');
  const burger = $('#burger');
  const nav = $('#nav');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const banner = $('.draft-banner');
  if (banner) document.documentElement.style.setProperty('--banner-h', `${banner.offsetHeight}px`);

  const setOpen = (open) => {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    nav.classList.toggle('open', open);
    header.classList.toggle('is-scrolled', open || window.scrollY > 24);
  };
  burger.addEventListener('click', () => setOpen(burger.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

// ---------- вкладки «Школа стенда» ----------
function initTabs() {
  const list = $('#schoolTabs');
  if (!list) return;
  const tabs = $$('[role="tab"]', list);

  function activate(tab, focus = false) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    if (focus) tab.focus();
    track('school_tab', { tab: tab.id });
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => activate(t));
    t.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (dir) { e.preventDefault(); activate(tabs[(i + dir + tabs.length) % tabs.length], true); }
      if (e.key === 'Home') { e.preventDefault(); activate(tabs[0], true); }
      if (e.key === 'End') { e.preventDefault(); activate(tabs[tabs.length - 1], true); }
    });
  });
}

// ---------- «Знаете ли вы?» ----------
const FACTS = [
  'Тарелка делается из известняковой крошки и смолы — поэтому при попадании она не раскалывается на куски, а рассыпается облаком пыли.',
  'Скит придумали американские охотники в 1920-х, чтобы тренироваться вне охотничьего сезона. В олимпийской программе скит — с 1968 года.',
  'Тарелка вылетает из машинки со скоростью порядка 80–110 км/ч, а целиться нужно не в неё, а впереди неё — туда, где она окажется через долю секунды.',
  'Стендовая стрельба по глиняным тарелкам появилась на Олимпийских играх 1908 года в Лондоне — до этого стреляли по живым голубям.',
  'Лучшие стрелки на трапе и ските не «наводят» ружьё, а двигаются вместе с тарелкой — как танцор с партнёром, а выстрел происходит в ритме движения.',
];
function initFacts() {
  const text = $('#factText');
  const btn = $('#factNext');
  if (!text) return;
  let i = Math.floor(Math.random() * FACTS.length);
  const show = () => { text.textContent = FACTS[i]; };
  show();
  btn.addEventListener('click', () => { i = (i + 1) % FACTS.length; show(); });
}

// ---------- пакеты стрельбы и контакты ----------
function renderPackages(content) {
  const box = $('#packages');
  box.replaceChildren(...content.shootingPackages.map((p) =>
    h('article', { class: `pkg reveal in${p.popular ? ' pkg-popular' : ''}` },
      p.popular ? h('span', { class: 'pkg-badge' }, 'Для первого раза') : null,
      h('h3', {}, p.name),
      h('p', { class: 'pkg-meta' }, p.duration),
      h('div', { class: 'pkg-price' }, rub(p.price), ' ', h('small', {}, p.unit)),
      h('ul', {}, p.includes.map((x) => h('li', {}, x))),
      h('button', { class: `btn ${p.popular ? '' : 'btn-ghost'}`, type: 'button', dataset: { request: 'shooting', package: p.id } }, 'Записаться'))));
}

function renderContacts(content) {
  const c = content.contacts;
  const extra = $('#contactExtra');
  const links = [
    c.email && h('a', { href: `mailto:${c.email}` }, c.email),
    c.telegram && h('a', { href: c.telegram, target: '_blank', rel: 'noopener' }, 'Telegram'),
    c.whatsapp && h('a', { href: c.whatsapp, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
  ].filter(Boolean);
  extra.replaceChildren(...links);
  extra.hidden = !links.length;
}

// ---------- запуск ----------
initReveal();
initHeader();
initTabs();
initFacts();
initHero();

(async () => {
  let content;
  try {
    content = await api.content();
  } catch {
    toast('Не удалось загрузить данные. Обновите страницу или позвоните нам.', 'error', 8000);
    return;
  }
  initAnalytics(content.metrikaId);
  renderPackages(content);
  renderContacts(content);
  initRequests(content);
  initEvents(content);
  initGame(content);
  await initBooking(content);

  // ссылка вида /#houses, открытая по прямой ссылке, должна доскроллить после того, как контент отрисован
  if (location.hash) $(location.hash)?.scrollIntoView();
})();
