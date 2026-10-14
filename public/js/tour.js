// «Домик в 3D»: осмотр выбранного домика — покрутить, день/закат/ночь, сезон по датам брони, точки-подсказки.
// Three.js и сцена грузятся лениво, когда гость подлистал к домикам. Тем же движком рисуются картинки
// для карточек домиков (вместо плоских заглушек), если у домика ещё нет настоящих фото.
// Нет WebGL или что-то сломалось — блок не показывается, карточки и бронь работают как раньше.

import { $, $$, h, toast, track, prefersReducedMotion, parts, formatShort } from './util.js';

const SEASON_NAMES = { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' };
const monthSeason = (m) => (m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn');

// Удобства из site.json → точки на домике. Тексты общие, без выдуманных подробностей.
const FEATURE_SPOTS = [
  { re: /терраса/i, anchor: 'terrace', title: 'Терраса', text: 'Утренний кофе и вечерний чай с видом на лес.' },
  { re: /мангал/i, anchor: 'mangal', title: 'Мангальная зона', text: 'Своё место для мангала в паре шагов от террасы.' },
  { re: /отоплен|печ|камин/i, anchor: 'chimney', title: 'Отопление', text: 'В домике тепло даже в прохладные горные ночи.' },
  { re: /кухн/i, anchor: 'kitchen', title: 'Кухня', text: 'Можно готовить самим — кухня прямо в домике.' },
  { re: /парковк/i, anchor: 'parking', title: 'Парковка рядом', text: 'Машину можно оставить в нескольких шагах от домика.' },
];

/** Подсказки для домика: из model3d.hotspots, а если их нет — из списка удобств. */
export function hotspotsFor(house, anchors) {
  const custom = house.model3d?.hotspots;
  if (Array.isArray(custom) && custom.length) {
    return custom
      .map((s, i) => ({ id: s.anchor ?? `hs${i}`, title: s.title, text: s.text ?? '' }))
      .filter((s) => anchors.has(s.id));
  }
  const used = new Set();
  const list = [];
  for (const f of FEATURE_SPOTS) {
    const feat = house.features.find((x) => f.re.test(x));
    if (feat && anchors.has(f.anchor)) { list.push({ id: f.anchor, title: f.title, text: f.text }); used.add(feat); }
  }
  if (anchors.has('interior')) {
    const rest = house.features.filter((x) => !used.has(x));
    const inside = [house.beds, house.area ? `${house.area} м²` : null, `до ${house.capacity} гостей`].filter(Boolean).join(' · ');
    list.unshift({ id: 'interior', title: 'Внутри', text: `${inside}${rest.length ? `. Ещё: ${rest.join(', ')}` : ''}.` });
  }
  return list;
}

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function pickQuality() {
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  return mem <= 4 || cores <= 4 || window.matchMedia('(max-width: 900px)').matches ? 'low' : 'high';
}

export function initTour(content) {
  const root = $('#tour');
  if (!root || !webglOk() || !content.houses?.length) return;

  const houses = content.houses;
  const stage = $('#tourStage');
  const poster = $('#tourPoster');
  const posterText = $('#tourPosterText');
  const startBtn = $('#tourStart');
  const spotsLayer = $('#tourSpots');
  const badge = $('#tourBadge');
  const hint = $('#tourHint');
  const pop = $('#tourPop');
  const note = $('#tourNote');
  const reduced = prefersReducedMotion();
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const debug = new URLSearchParams(location.search).has('debug3d');

  const st = {
    houseId: houses[0].id, checkIn: null, seasonMode: 'auto', time: 1,
    viewer: null, ready: false, loading: false, spots: [], popIndex: -1, visible: false, hintT: 0,
  };
  const house = () => houses.find((x) => x.id === st.houseId) ?? houses[0];
  const index = () => houses.indexOf(house());
  const autoSeason = () => monthSeason(parts(st.checkIn ?? content.today).m);
  const season = () => (st.seasonMode === 'auto' ? autoSeason() : st.seasonMode);

  root.hidden = false;

  // ---------- подписи ----------
  /** shown: что реально показано — 'model' (файл модели) или 'procedural' (нарисовано кодом). */
  function renderBadge(shown) {
    const x = house();
    const m = x.model3d;
    const isModel = shown ? shown === 'model' : !!m?.src;
    const kind = isModel ? (m?.kind === 'scan' ? '3D-скан домика' : '3D-модель домика') : '3D-иллюстрация, не точная копия домика';
    badge.replaceChildren(h('b', {}, x.name), h('span', {}, kind));
  }

  function renderNote() {
    const s = autoSeason();
    if (st.seasonMode !== 'auto') note.textContent = `Показан сезон: ${SEASON_NAMES[st.seasonMode]}. «Авто» — сезон по датам вашей брони.`;
    else if (st.checkIn) note.textContent = `Сезон по датам брони: ${SEASON_NAMES[s]}, заезд ${formatShort(st.checkIn)}.`;
    else note.textContent = `Сейчас на Холодной горе ${SEASON_NAMES[s]}. Выберите даты в календаре — домик покажется в нужном сезоне.`;
  }

  function syncButtons() {
    $$('[data-time]', root).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.time) === st.time)));
    $$('[data-season]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === st.seasonMode)));
    $('[data-season="auto"]', root).textContent = `Авто · ${SEASON_NAMES[autoSeason()]}`;
  }

  function showHint(text, ms = 5000) {
    hint.textContent = text;
    hint.classList.add('is-on');
    clearTimeout(st.hintT);
    st.hintT = setTimeout(hideHint, ms);
  }
  function hideHint() { hint.classList.remove('is-on'); }

  // ---------- точки-подсказки ----------
  function buildSpots() {
    const anchors = st.viewer.anchors;
    spotsLayer.replaceChildren();
    st.spots = hotspotsFor(house(), anchors).map((s, i) => {
      const el = h('button', { class: 'tour-spot', type: 'button', 'aria-label': s.title, onclick: () => openSpot(i) },
        h('span', { class: 'tour-spot-label', 'aria-hidden': 'true' }, s.title));
      spotsLayer.append(el);
      const a = anchors.get(s.id);
      return { ...s, el, p: a.p, n: a.n };
    });
    st.viewer.setSpots(st.spots);
    closePop();
  }

  function openSpot(i) {
    const s = st.spots[i];
    if (!s) return;
    st.popIndex = i;
    st.viewer.focus(s.id);
    $('#tourPopTitle').textContent = s.title;
    $('#tourPopText').textContent = s.text;
    $('#tourPopNext').hidden = st.spots.length < 2;
    pop.hidden = false;
    st.spots.forEach((x, k) => x.el.classList.toggle('is-active', k === i));
    hideHint();
    track('tour_hotspot', { house: st.houseId, spot: s.id });
  }

  function closePop() {
    pop.hidden = true;
    st.popIndex = -1;
    st.spots.forEach((x) => x.el.classList.remove('is-active'));
  }

  // ---------- загрузка ----------
  async function renderCardImages(viewer) {
    for (const [i, x] of houses.entries()) {
      if (x.photos?.length) continue; // настоящие фото важнее
      const art = $(`.house[data-house="${CSS.escape(x.id)}"] .house-art`);
      if (!art) continue;
      const shot = await viewer.snapshot(x, i);
      if (!shot) continue;
      art.querySelector('svg, .house-render')?.remove();
      art.querySelector('.house-render-tag')?.remove();
      art.prepend(h('img', { class: 'house-render', src: shot.url, alt: '', width: 640, height: 400 }));
      art.append(h('span', { class: 'house-render-tag' }, shot.kind === 'model' ? '3D-модель' : '3D-иллюстрация'));
    }
  }

  function watchVisibility() {
    const sync = () => {
      if (st.visible && !document.hidden) st.viewer.start();
      else st.viewer.stop();
    };
    new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; sync(); }, { threshold: 0.02 }).observe(stage);
    document.addEventListener('visibilitychange', sync);
  }

  async function load() {
    if (st.viewer || st.loading) return;
    st.loading = true;
    startBtn.hidden = true;
    poster.classList.add('is-loading');
    posterText.textContent = 'Загружаем 3D-домик…';
    try {
      const { createViewer } = await import('./tour3d/viewer.js');
      const viewer = createViewer(stage, { quality: pickQuality(), reducedMotion: reduced });
      st.viewer = viewer;
      viewer.setSeason(season());
      viewer.setTime(st.time, true);
      await renderCardImages(viewer);
      const obj = await viewer.setHouse(house(), index());
      renderBadge(obj?.kind);
      buildSpots();
      setupCanvas(viewer);
      st.ready = true;
      poster.classList.add('is-gone');
      root.classList.add('is-ready');
      watchVisibility();
      showHint(touch
        ? 'Проведите пальцем влево-вправо — домик повернётся. Двумя пальцами — приблизить.'
        : 'Потяните мышью, чтобы покрутить. Оранжевые точки — подсказки.', 6500);
      track('tour_ready', { house: st.houseId });
    } catch (err) {
      console.error('3D-домик не загрузился', err);
      st.viewer?.dispose();
      st.viewer = null;
      poster.classList.remove('is-loading');
      posterText.textContent = 'Не получилось показать 3D на этом устройстве. Карточки и бронь работают как обычно.';
      root.classList.add('is-failed');
    } finally {
      st.loading = false;
    }
  }

  function setupCanvas(viewer) {
    const c = viewer.canvas;
    c.tabIndex = 0;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'Домик в 3D. Стрелки — повернуть, плюс и минус — приблизить или отдалить.');
    c.addEventListener('keydown', (e) => {
      const acts = {
        ArrowLeft: () => viewer.orbitBy(-0.15), ArrowRight: () => viewer.orbitBy(0.15),
        ArrowUp: () => viewer.orbitBy(0, -0.08), ArrowDown: () => viewer.orbitBy(0, 0.08),
        '+': () => viewer.zoomBy(0.85), '=': () => viewer.zoomBy(0.85), '-': () => viewer.zoomBy(1.18),
      };
      if (acts[e.key]) { e.preventDefault(); acts[e.key](); hideHint(); }
    });
    viewer.onInteract(hideHint);
    if (debug) {
      c.addEventListener('dblclick', (e) => {
        const p = viewer.pick(e.clientX, e.clientY);
        if (!p) return;
        console.info('3D-точка', JSON.stringify(p));
        toast(`Координаты точки: [${p.join(', ')}]`, 'ok', 8000);
      });
      showHint('Режим настройки: двойной клик по модели — координаты точки для model3d.hotspots', 10000);
    }
  }

  async function switchHouse() {
    renderBadge();
    closePop();
    st.spots = [];
    spotsLayer.replaceChildren();
    st.viewer.setSpots([]);
    const obj = await st.viewer.setHouse(house(), index());
    if (obj) { renderBadge(obj.kind); buildSpots(); }
  }

  // ---------- связь с бронированием ----------
  document.addEventListener('hg:booking', (e) => {
    const { houseId, checkIn } = e.detail ?? {};
    const changed = !!houseId && houseId !== st.houseId;
    if (houseId) st.houseId = houseId;
    st.checkIn = checkIn ?? null;
    renderNote();
    syncButtons();
    if (!st.ready) { renderBadge(); return; }
    st.viewer.setSeason(season());
    if (changed) switchHouse();
  });

  // ---------- кнопки ----------
  $$('[data-time]', root).forEach((b) => b.addEventListener('click', () => {
    st.time = Number(b.dataset.time);
    st.viewer?.setTime(st.time);
    syncButtons();
    track('tour_time', { time: st.time });
  }));
  $$('[data-season]', root).forEach((b) => b.addEventListener('click', () => {
    st.seasonMode = b.dataset.season;
    st.viewer?.setSeason(season());
    syncButtons();
    renderNote();
    track('tour_season', { season: st.seasonMode });
  }));

  const fsBtn = $('[data-act="fullscreen"]', root);
  if (!document.fullscreenEnabled) fsBtn.hidden = true;
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !st.viewer) return;
    if (act === 'zoom-in') st.viewer.zoomBy(0.8);
    if (act === 'zoom-out') st.viewer.zoomBy(1.25);
    if (act === 'reset') { closePop(); st.viewer.resetView(); }
    if (act === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen?.().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.setAttribute('aria-label', document.fullscreenElement === root ? 'Свернуть' : 'На весь экран');
  });

  $('#tourPopClose').addEventListener('click', closePop);
  $('#tourPopNext').addEventListener('click', () => openSpot((st.popIndex + 1) % st.spots.length));
  $('#tourDates').addEventListener('click', () => $('#calendar')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) closePop(); });

  // колесо мыши листает страницу; приближение — с Ctrl (или жестом на тачпаде), как на картах
  stage.addEventListener('wheel', (e) => {
    if (!st.ready || e.ctrlKey || e.metaKey || document.fullscreenElement === root) return;
    e.stopPropagation();
    showHint('Чтобы приблизить, зажмите Ctrl и покрутите колёсико', 1800);
  }, { capture: true });

  // ---------- старт ----------
  renderBadge();
  renderNote();
  syncButtons();
  startBtn.addEventListener('click', load);
  if (navigator.connection?.saveData) {
    posterText.textContent = 'Покажем домик в 3D: покрутить, посмотреть вечером и зимой. Загрузится около 220 КБ.';
    startBtn.hidden = false;
  } else {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '900px 0px' });
    io.observe($('#houses') ?? root);
  }
}
