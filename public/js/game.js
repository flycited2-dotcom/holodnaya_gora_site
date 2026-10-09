// Мини-игра «Тарелочки»: раунд из 25 тарелок, как на настоящем стенде.
// Вся логика живёт в «виртуальных» координатах шириной VW, поэтому игра одинаково играется на любом экране.

import { buildScene, drawClay } from './scene.js';
import { $, $$, h, storage, debounce, prefersReducedMotion, track, toast, plural } from './util.js';
import { api } from './api.js';
import * as sound from './sound.js';

const VW = 1000;
const COOLDOWN = 0.32;       // пауза между выстрелами, с
const MAX_SCORE_PER_HIT = 25; // совпадает с проверкой на сервере: 10 + 5 (дальность) + 10 (серия)

const RANKS = [
  { min: 0, name: 'Пока наблюдатель', text: 'Не расстраивайтесь: первые тарелки у всех летят мимо.' },
  { min: 5, name: 'Новичок', text: 'Глаз привыкает — ещё один раунд, и станет заметно лучше.' },
  { min: 10, name: 'Стрелок', text: 'Уверенный результат для первого знакомства со стендом.' },
  { min: 15, name: 'Меткий глаз', text: 'Так держать — с таким результатом на стенде не стыдно.' },
  { min: 20, name: 'Мастер стенда', text: 'Серьёзный результат! Реальный стенд вас ждёт.' },
  { min: 24, name: 'Снайпер Холодной горы', text: 'Почти идеально. Приезжайте — покажете это вживую.' },
];
const rankFor = (hits) => [...RANKS].reverse().find((r) => hits >= r.min);

export function initGame(content) {
  const stage = $('#gameStage');
  const canvas = $('#gameCanvas');
  if (!stage || !canvas) return;

  const ROUND = content.game?.roundSize ?? 25;
  const ctx = canvas.getContext('2d');
  const reduced = prefersReducedMotion();
  const overlay = $('#gameOverlay');
  const live = $('#gameLive');
  const btnPause = $('#btnPause');
  const btnSound = $('#btnSound');
  const hud = {
    score: $('#hudScore'), target: $('#hudTarget'), hits: $('#hudHits'),
    combo: $('#hudCombo'), comboWrap: $('#hudComboWrap'),
  };

  const rand = Math.random;
  const between = (a, b) => a + rand() * (b - a);

  let dpr = 1; let cssW = 0; let cssH = 0; let scale = 1; let vh = 625;
  let bg = null;
  let S = freshState();
  let last = 0; let rafId = 0; let visible = true;

  function freshState() {
    return {
      mode: 'idle', // idle | playing | paused | done
      targets: [], particles: [], popups: [],
      spawned: 0, resolved: 0, hits: 0, shots: 0, score: 0, combo: 0, bestCombo: 0,
      nextSpawn: 1.2, startDelay: 1.1, cooldown: 0, recoil: 0, flash: 0, shake: 0,
      aim: { x: VW / 2, y: vh * 0.42 }, pendingSubmit: true,
    };
  }

  // ---------- размеры и фон ----------
  function resize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = rect.width; cssH = rect.height;
    scale = cssW / VW;
    vh = VW * (cssH / cssW);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    bg = document.createElement('canvas');
    bg.width = canvas.width; bg.height = canvas.height;
    const bctx = bg.getContext('2d');
    bctx.scale(dpr, dpr);
    buildScene(cssW, cssH, dpr, 23).composite(bctx, cssW, cssH);
    // силуэты «машинок» по краям
    bctx.fillStyle = '#03100d';
    const gy = vh * 0.8 * scale;
    bctx.fillRect(0, gy, cssW * 0.1, cssH - gy);
    bctx.fillRect(cssW * 0.9, gy, cssW * 0.1, cssH - gy);

    if (S.mode === 'idle') S.aim.y = vh * 0.42;
    draw();
  }

  // ---------- HUD ----------
  function renderHud() {
    hud.score.textContent = S.score;
    hud.target.textContent = `${Math.min(S.spawned, ROUND)} / ${ROUND}`;
    hud.hits.textContent = S.hits;
    hud.combo.textContent = `×${Math.max(1, S.combo)}`;
    hud.comboWrap.classList.toggle('hot', S.combo >= 3);
  }

  // ---------- оверлей ----------
  function showOverlay(node) {
    overlay.replaceChildren(node);
    overlay.hidden = false;
    stage.classList.add('has-overlay'); // прячет HUD под окном
  }
  const hideOverlay = () => { overlay.hidden = true; stage.classList.remove('has-overlay'); };

  function startCard() {
    const best = storage.get('hg_best');
    return h('div', { class: 'ov-card' },
      h('div', { class: 'ov-title' }, 'Тарелочки'),
      h('p', { class: 'ov-text' }, `Раунд из ${ROUND} тарелок. Нажимайте на летящие мишени — чем дальше тарелка и длиннее серия попаданий, тем больше очков.`),
      h('div', { class: 'ov-actions' },
        h('button', { class: 'btn btn-lg', type: 'button', onclick: startRound }, 'Начать раунд')),
      best ? h('p', { class: 'ov-note' }, `Ваш рекорд: ${best.score} очков, ${best.hits} из ${ROUND}`) : null,
    );
  }

  function pauseCard() {
    return h('div', { class: 'ov-card' },
      h('div', { class: 'ov-title' }, 'Пауза'),
      h('div', { class: 'ov-actions' },
        h('button', { class: 'btn btn-lg', type: 'button', onclick: resume }, 'Продолжить'),
        h('button', { class: 'btn btn-lg btn-ghost', type: 'button', onclick: startRound }, 'Заново')),
    );
  }

  function resultCard() {
    const rank = rankFor(S.hits);
    const acc = S.shots ? Math.round((S.hits / S.shots) * 100) : 0;
    const prevBest = storage.get('hg_best');
    const isRecord = !prevBest || S.score > prevBest.score;
    if (isRecord && S.score > 0) storage.set('hg_best', { score: S.score, hits: S.hits });

    const nameInput = h('input', {
      type: 'text', maxlength: '20', placeholder: 'Ваше имя', autocomplete: 'nickname',
      'aria-label': 'Имя для таблицы лидеров', value: storage.get('hg_name', '') || '',
    });
    const saveBtn = h('button', { class: 'btn', type: 'submit' }, 'В таблицу');
    const form = h('form', { class: 'ov-form' }, nameInput, saveBtn);
    const status = h('p', { class: 'ov-note' });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!S.pendingSubmit) return;
      saveBtn.disabled = true;
      const name = nameInput.value.trim();
      storage.set('hg_name', name);
      try {
        await api.submitScore({ name, score: S.score, hits: S.hits, shots: S.shots });
        S.pendingSubmit = false;
        form.hidden = true;
        status.textContent = 'Результат записан в таблицу лидеров';
        track('game_score_saved');
        await loadBoard(true);
      } catch (err) {
        saveBtn.disabled = false;
        status.textContent = err.message;
      }
    });

    const canSave = S.hits > 0 && S.pendingSubmit;
    return h('div', { class: 'ov-card' },
      h('span', { class: 'ov-rank' }, isRecord && S.score > 0 ? `${rank.name} · новый рекорд!` : rank.name),
      h('div', { class: 'ov-title' }, `${S.hits} из ${ROUND}`),
      h('p', { class: 'ov-text' }, rank.text),
      h('div', { class: 'ov-stats' },
        h('div', {}, h('b', {}, S.score), h('span', {}, 'очков')),
        h('div', {}, h('b', {}, `${acc}%`), h('span', {}, 'точность')),
        h('div', {}, h('b', {}, `×${Math.max(S.bestCombo, 1)}`), h('span', {}, 'лучшая серия')),
      ),
      canSave ? form : null,
      status,
      h('div', { class: 'ov-actions' },
        h('button', { class: 'btn', type: 'button', onclick: startRound }, 'Ещё раунд'),
        h('button', { class: 'btn btn-ghost', type: 'button', dataset: { request: 'shooting' } }, 'Стрелять вживую')),
    );
  }

  // ---------- управление раундом ----------
  function startRound() {
    sound.playClick();
    S = freshState();
    S.mode = 'playing';
    stage.classList.add('is-playing');
    hideOverlay();
    btnPause.hidden = false;
    renderHud();
    live.textContent = 'Раунд начался';
    track('game_start');
    stage.focus({ preventScroll: true });
    loop();
  }

  function pause() {
    if (S.mode !== 'playing') return;
    S.mode = 'paused';
    stage.classList.remove('is-playing');
    showOverlay(pauseCard());
  }

  function resume() {
    if (S.mode !== 'paused') return;
    S.mode = 'playing';
    stage.classList.add('is-playing');
    hideOverlay();
    last = performance.now();
    loop();
  }

  function finish() {
    S.mode = 'done';
    stage.classList.remove('is-playing');
    btnPause.hidden = true;
    const great = S.hits >= 15;
    sound.playFinish(great);
    track('game_finish', { hits: S.hits, score: S.score });
    live.textContent = `Раунд окончен: ${S.hits} из ${ROUND}, ${S.score} очков`;
    setTimeout(() => { if (S.mode === 'done') showOverlay(resultCard()); }, 450);
  }

  // ---------- мишени ----------
  function spawnTarget() {
    const i = S.spawned++;
    const level = i / (ROUND - 1);
    const fromLeft = rand() < 0.5;
    const r0 = Math.max(32, 17 / scale);
    S.targets.push({
      x0: fromLeft ? VW * 0.08 : VW * 0.92,
      tx: VW * (fromLeft ? between(0.5, 0.9) : between(0.1, 0.5)),
      y0: vh * 0.8,
      apex: vh * between(0.14, 0.42),
      T: Math.max(1.55, 3.0 - level * 1.0) + between(-0.15, 0.25),
      age: 0, r0, spin: between(0, 6), vspin: between(6, 11) * (rand() < 0.5 ? -1 : 1),
      x: 0, y: 0, r: r0, p: 0,
    });
  }

  function targetPos(t) {
    t.p = t.age / t.T;
    t.x = t.x0 + (t.tx - t.x0) * t.p;
    t.y = t.apex + 4 * (t.y0 - t.apex) * (t.p - 0.5) ** 2;
    t.r = t.r0 * (1 - 0.5 * t.p);
  }

  // ---------- частицы ----------
  function burstShards(t) {
    const n = reduced ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const a = between(0, Math.PI * 2);
      const sp = between(80, 360);
      S.particles.push({
        type: 'shard', x: t.x, y: t.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        life: 0, max: between(0.7, 1.3), size: between(0.12, 0.3) * t.r, rot: between(0, 6), vr: between(-14, 14),
        color: rand() < 0.7 ? '#ff6a1a' : rand() < 0.5 ? '#c9480d' : '#ffb066',
      });
    }
    for (let i = 0; i < (reduced ? 3 : 7); i++) {
      S.particles.push({
        type: 'puff', x: t.x + between(-8, 8), y: t.y + between(-6, 6), vx: between(-50, 50), vy: between(-60, 10),
        life: 0, max: between(0.6, 1.1), size: between(0.5, 1.1) * t.r, color: 'rgba(255,170,100,',
      });
    }
  }

  function burstPellets(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = between(0, Math.PI * 2);
      const sp = between(40, 220);
      S.particles.push({
        type: 'pellet', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: between(0.18, 0.4), size: between(1.5, 3), color: '#f5efe0',
      });
    }
  }

  // ---------- выстрел ----------
  function fire(vx, vy) {
    if (S.mode !== 'playing' || S.startDelay > 0) return;
    if (S.cooldown > 0) return;
    S.shots++;
    S.cooldown = COOLDOWN;
    S.recoil = 1;
    S.flash = reduced ? 0.4 : 1;
    S.shake = reduced ? 0 : 1;
    sound.playShot();
    burstPellets(vx, vy);

    let best = null; let bestD = Infinity;
    for (const t of S.targets) {
      const d = Math.hypot(t.x - vx, t.y - vy);
      const reach = t.r * 1.75 + 12 / scale; // дробь летит облаком, поэтому прощаем неточность
      if (d <= reach && d < bestD) { best = t; bestD = d; }
    }

    if (best) {
      S.combo++;
      S.bestCombo = Math.max(S.bestCombo, S.combo);
      const pts = Math.min(MAX_SCORE_PER_HIT, 10 + Math.round(best.p * 5) + Math.min(S.combo - 1, 5) * 2);
      S.score += pts;
      S.hits++;
      S.resolved++;
      S.popups.push({ x: best.x, y: best.y - best.r, text: `+${pts}`, life: 0, max: 0.9, hot: S.combo >= 3 });
      burstShards(best);
      sound.playHit();
      S.targets.splice(S.targets.indexOf(best), 1);
      live.textContent = `Попадание, ${S.hits} из ${ROUND}`;
    } else {
      if (S.combo > 0) S.popups.push({ x: vx, y: vy - 18, text: 'Мимо', life: 0, max: 0.6, miss: true });
      S.combo = 0;
      sound.playMiss();
    }
    renderHud();
  }

  // ---------- обновление ----------
  function update(dt) {
    if (S.startDelay > 0) { S.startDelay -= dt; return; }
    S.cooldown = Math.max(0, S.cooldown - dt);
    S.recoil = Math.max(0, S.recoil - dt * 5);
    S.flash = Math.max(0, S.flash - dt * 7);
    S.shake = Math.max(0, S.shake - dt * 6);

    if (S.spawned < ROUND) {
      S.nextSpawn -= dt;
      if (S.nextSpawn <= 0) {
        const level = S.spawned / (ROUND - 1);
        const double = S.spawned >= 12 && S.spawned < ROUND - 1 && rand() < 0.22;
        spawnTarget();
        if (double) spawnTarget();
        S.nextSpawn = Math.max(0.7, 1.45 - level * 0.6) * (double ? 1.4 : 1) + between(0, 0.5);
        renderHud();
      }
    }

    for (let i = S.targets.length - 1; i >= 0; i--) {
      const t = S.targets[i];
      t.age += dt;
      t.spin += t.vspin * dt;
      targetPos(t);
      if (t.p >= 1) { // не сбили — тарелка упала
        S.targets.splice(i, 1);
        S.resolved++;
        S.combo = 0;
        renderHud();
      }
    }

    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.life += dt;
      if (p.life >= p.max) { S.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'shard') { p.vy += 900 * dt; p.rot += p.vr * dt; }
      else if (p.type === 'pellet') { p.vy += 300 * dt; p.vx *= 0.96; }
      else { p.vx *= 0.97; p.vy *= 0.97; }
    }
    for (let i = S.popups.length - 1; i >= 0; i--) {
      const p = S.popups[i];
      p.life += dt;
      if (p.life >= p.max) S.popups.splice(i, 1);
    }

    if (S.spawned >= ROUND && S.targets.length === 0 && S.mode === 'playing') finish();
  }

  // ---------- отрисовка ----------
  function draw() {
    if (!bg) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sk = S.shake * 5 * dpr;
    ctx.translate((rand() - 0.5) * sk, (rand() - 0.5) * sk);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    for (const t of S.targets) {
      drawClay(ctx, t.x, t.y, t.r, t.spin);
    }

    for (const p of S.particles) {
      const k = 1 - p.life / p.max;
      if (p.type === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        ctx.restore();
      } else if (p.type === 'puff') {
        ctx.fillStyle = `${p.color}${(k * 0.35).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.4), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    ctx.textAlign = 'center';
    for (const p of S.popups) {
      const k = p.life / p.max;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `800 ${p.miss ? 22 : 30}px Unbounded, sans-serif`;
      ctx.fillStyle = p.miss ? '#9fb0a5' : p.hot ? '#ffd34d' : '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 5;
      const y = p.y - k * 50;
      ctx.strokeText(p.text, p.x, y); ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;

    if (S.flash > 0) {
      const g = ctx.createRadialGradient(VW / 2, vh, 10, VW / 2, vh, vh * 1.1);
      g.addColorStop(0, `rgba(255,220,160,${0.4 * S.flash})`);
      g.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, vh);
    }

    if (S.mode === 'playing' && S.startDelay > 0) {
      ctx.globalAlpha = Math.min(1, S.startDelay * 2);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 8;
      ctx.font = '800 56px Unbounded, sans-serif';
      ctx.strokeText('К стрельбе!', VW / 2, vh * 0.4); ctx.fillText('К стрельбе!', VW / 2, vh * 0.4);
      ctx.globalAlpha = 1;
    }

    if (S.mode === 'playing') drawCrosshair();
  }

  function drawCrosshair() {
    const { x } = S.aim;
    const y = S.aim.y - S.recoil * 14;
    const r = 26;
    ctx.save();
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    crosshairPath(x, y, r); ctx.lineWidth = 6; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = S.cooldown > 0 ? 'rgba(255,255,255,.55)' : '#fff';
    crosshairPath(x, y, r); ctx.stroke();
    if (S.cooldown > 0) { // кольцо перезарядки
      ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - S.cooldown / COOLDOWN));
      ctx.stroke();
    }
    ctx.restore();
  }
  function crosshairPath(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r - 10, y); ctx.lineTo(x - r * 0.45, y);
    ctx.moveTo(x + r + 10, y); ctx.lineTo(x + r * 0.45, y);
    ctx.moveTo(x, y - r - 10); ctx.lineTo(x, y - r * 0.45);
    ctx.moveTo(x, y + r + 10); ctx.lineTo(x, y + r * 0.45);
  }

  // ---------- цикл ----------
  function loop() {
    cancelAnimationFrame(rafId);
    last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (S.mode === 'playing') update(dt);
      else if (S.particles.length || S.popups.length) { // доигрываем эффекты после финала
        for (const p of S.particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.type === 'shard') p.vy += 900 * dt; }
        S.particles = S.particles.filter((p) => p.life < p.max);
        for (const p of S.popups) p.life += dt;
        S.popups = S.popups.filter((p) => p.life < p.max);
      }
      draw();
      const busy = S.mode === 'playing' || S.particles.length || S.popups.length;
      if (busy && visible && !document.hidden) rafId = requestAnimationFrame(frame);
      else rafId = 0;
    };
    rafId = requestAnimationFrame(frame);
  }

  // ---------- ввод ----------
  const toVirtual = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * VW, y: ((e.clientY - r.top) / r.height) * vh };
  };

  canvas.addEventListener('pointermove', (e) => {
    if (S.mode !== 'playing') return;
    S.aim = toVirtual(e);
    if (!rafId) draw();
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (S.mode !== 'playing') return;
    e.preventDefault();
    S.aim = toVirtual(e);
    fire(S.aim.x, S.aim.y);
  });
  stage.addEventListener('contextmenu', (e) => { if (S.mode === 'playing') e.preventDefault(); });

  stage.tabIndex = 0;
  stage.setAttribute('aria-label', 'Игровое поле «Тарелочки»');
  stage.addEventListener('keydown', (e) => {
    if (e.target.closest('button, input, a')) return;
    const step = 34;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move && S.mode === 'playing') {
      e.preventDefault();
      S.aim.x = Math.max(0, Math.min(VW, S.aim.x + move[0]));
      S.aim.y = Math.max(0, Math.min(vh, S.aim.y + move[1]));
      if (!rafId) draw();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (S.mode === 'playing') fire(S.aim.x, S.aim.y);
      else if (S.mode === 'idle' || S.mode === 'done') startRound();
      else if (S.mode === 'paused') resume();
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') && S.mode === 'playing' && !e.target.closest('input, textarea')) pause();
  });

  btnPause.addEventListener('click', () => (S.mode === 'playing' ? pause() : resume()));

  function syncSoundButton() {
    const on = !sound.isMuted();
    btnSound.setAttribute('aria-pressed', String(on));
    btnSound.setAttribute('aria-label', on ? 'Звук включён' : 'Звук выключен');
  }
  btnSound.addEventListener('click', () => { sound.setMuted(!sound.isMuted()); syncSoundButton(); sound.playClick(); });
  syncSoundButton();

  // экономим батарею: ставим на паузу, когда игра ушла с экрана или вкладка скрыта
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible && S.mode === 'playing') pause();
    if (visible && !rafId && (S.mode === 'playing')) loop();
  }, { threshold: 0.2 }).observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'playing') pause(); });

  new ResizeObserver(debounce(resize, 120)).observe(stage);

  // ---------- таблица лидеров ----------
  let board = { month: [], allTime: [] };
  let boardTab = 'month';
  const boardList = $('#boardList');
  const boardMe = $('#boardMe');

  function renderBoard() {
    const rows = board[boardTab] ?? [];
    if (!rows.length) {
      boardList.replaceChildren(h('li', { class: 'board-empty' },
        boardTab === 'month' ? 'В этом месяце пока никого — станьте первым!' : 'Пока нет результатов'));
      return;
    }
    boardList.replaceChildren(...rows.map((r) =>
      h('li', {}, h('span', { class: 'nm' }, r.name), h('span', { class: 'pts' }, `${r.score}`))));
  }

  async function loadBoard(highlight = false) {
    try {
      board = await api.scores();
      renderBoard();
      const best = storage.get('hg_best');
      if (best) {
        boardMe.hidden = false;
        boardMe.textContent = `Ваш лучший результат: ${best.score} ${plural(best.score, ['очко', 'очка', 'очков'])}`;
      }
      if (highlight) toast('Таблица обновлена', 'ok', 2200);
    } catch {
      boardList.replaceChildren(h('li', { class: 'board-empty' }, 'Не удалось загрузить таблицу'));
    }
  }

  $$('[data-board]').forEach((btn) => btn.addEventListener('click', () => {
    boardTab = btn.dataset.board;
    $$('[data-board]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    renderBoard();
  }));

  // ---------- старт ----------
  showOverlay(startCard());
  renderHud();
  resize();
  loadBoard();
}

