// Hero: слои сцены с параллаксом и пролетающие тарелки (по ним можно кликнуть).

import { buildScene } from './scene.js';
import { $, debounce, prefersReducedMotion, toast, track } from './util.js';

const CLAY_SVG = `<svg viewBox="0 0 56 34" aria-hidden="true">
  <ellipse cx="28" cy="21" rx="26" ry="9" fill="#9c3407"/>
  <ellipse cx="28" cy="17" rx="26" ry="10" fill="#ff6a1a"/>
  <ellipse cx="26" cy="14.5" rx="14" ry="4.6" fill="#ffc27d" opacity=".75"/>
</svg>`;

export function initHero() {
  const hero = $('#top');
  const sceneRoot = $('#heroScene');
  const clayLayer = $('#heroClay');
  if (!hero || !sceneRoot) return;

  const reduced = prefersReducedMotion();
  let layers = [];

  function render() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const scene = buildScene(w, h, dpr, 11);
    layers = scene.layers;
    sceneRoot.replaceChildren(...layers.map((l) => l.canvas));
    applyParallax();
  }

  // --- параллакс -------------------------------------------------------------
  let nx = 0; let ny = 0; let cx = 0; let cy = 0; let scrollY = 0; let raf = 0;

  function applyParallax() {
    const w = hero.clientWidth;
    layers.forEach(({ canvas, depth }) => {
      const x = -cx * depth * w * 0.9;
      const y = -cy * depth * 160 + Math.min(scrollY, hero.clientHeight) * depth * 0.9;
      canvas.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
  }

  function tick() {
    cx += (nx - cx) * 0.07;
    cy += (ny - cy) * 0.07;
    applyParallax();
    raf = (Math.abs(nx - cx) > 0.001 || Math.abs(ny - cy) > 0.001) ? requestAnimationFrame(tick) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  if (!reduced) {
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = hero.getBoundingClientRect();
      nx = (e.clientX - r.left) / r.width - 0.5;
      ny = (e.clientY - r.top) / r.height - 0.5;
      kick();
    });
    hero.addEventListener('pointerleave', () => { nx = 0; ny = 0; kick(); });
    window.addEventListener('scroll', () => { scrollY = window.scrollY; kick(); applyParallax(); }, { passive: true });
  }

  render();
  window.addEventListener('resize', debounce(render, 250));

  // --- летающие тарелки ------------------------------------------------------
  if (reduced || !clayLayer) return;

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 }).observe(hero);

  let hitOnce = false;
  const rand = (a, b) => a + Math.random() * (b - a);

  function shatter(x, y) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.className = 'clay-shard';
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      clayLayer.append(s);
      const a = rand(0, Math.PI * 2);
      const d = rand(30, 90);
      s.animate(
        [
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 40}px) rotate(${rand(-360, 360)}deg)`, opacity: 0 },
        ],
        { duration: rand(500, 900), easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' },
      ).onfinish = () => s.remove();
    }
  }

  function launch() {
    if (!visible || document.hidden) return;
    const W = hero.clientWidth;
    const H = hero.clientHeight;
    const fromLeft = Math.random() < 0.5;
    const size = rand(0.8, 1.25);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hero-clay';
    el.tabIndex = -1;
    el.setAttribute('aria-label', 'Тарелка');
    el.innerHTML = CLAY_SVG;
    el.style.width = `${56 * size}px`;
    el.style.height = `${34 * size}px`;
    clayLayer.append(el);

    const dur = rand(4200, 5600);
    const x0 = fromLeft ? -80 : W + 80;
    const x1 = fromLeft ? W * rand(0.55, 0.9) : W * rand(0.1, 0.45);
    const y0 = H * rand(0.62, 0.78);
    const apex = H * rand(0.12, 0.3);
    const t0 = performance.now();
    let alive = true;

    function frame(now) {
      if (!alive) return;
      const t = (now - t0) / dur;
      if (t >= 1 || !el.isConnected) { el.remove(); return; }
      const x = x0 + (x1 - x0) * t;
      // парабола: старт на высоте y0, вершина apex при t = 0.45, затем снижение
      const y = apex + ((y0 - apex) / 0.45 ** 2) * (t - 0.45) ** 2;
      const scale = 1 - t * 0.35;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${t * 540}deg)`;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      alive = false;
      const r = el.getBoundingClientRect();
      const hr = hero.getBoundingClientRect();
      shatter(r.left - hr.left + r.width / 2, r.top - hr.top + r.height / 2);
      el.remove();
      track('hero_clay_hit');
      if (!hitOnce) {
        hitOnce = true;
        toast('Метко! Попробуйте полный раунд из 25 тарелок в тире ниже 👇', 'ok', 5200);
      }
    });
  }

  const loop = () => { launch(); setTimeout(loop, rand(4500, 8500)); };
  setTimeout(loop, 1800);
}
