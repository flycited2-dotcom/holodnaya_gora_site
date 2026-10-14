// Процедурные текстуры для 3D-домика: брёвна, доски, кровля, камень, земля, кора.
// Всё рисуется на canvas при загрузке — ни одного файла-картинки, сайт остаётся лёгким.
// Каждая текстура отдаётся парой { map, bump }: цвет и та же картинка как карта рельефа.

import * as THREE from '../../vendor/three/three.module.min.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, hgt = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const pair = (c, opts) => ({ map: tex(c, opts), bump: tex(c, { ...opts, srgb: false }) });

/** Боковая поверхность бревна: x — по окружности, y — вдоль бревна (волокна идут вдоль). */
function logSide(r) {
  const [c, g] = canvas(256, 512);
  const base = g.createLinearGradient(0, 0, 256, 0);
  // в развёртке цилиндра низ и верх бревна темнее — там тень от соседних брёвен
  base.addColorStop(0, '#5b3a22');
  base.addColorStop(0.25, '#9a6a41');
  base.addColorStop(0.5, '#6e4729');
  base.addColorStop(0.75, '#9d6c42');
  base.addColorStop(1, '#5b3a22');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 220; i++) {
    const x = r() * 256;
    const dark = r() < 0.6;
    g.strokeStyle = dark ? `rgba(38,20,8,${0.06 + r() * 0.2})` : `rgba(196,150,100,${0.05 + r() * 0.14})`;
    g.lineWidth = 0.5 + r() * 2.2;
    g.beginPath();
    g.moveTo(x, 0);
    const ph = r() * 6;
    for (let y = 0; y <= 512; y += 16) g.lineTo(x + Math.sin(y * 0.03 + ph) * 1.8, y);
    g.stroke();
  }
  for (let i = 0; i < 7; i++) { // сучки
    const x = r() * 256; const y = r() * 512; const rad = 3 + r() * 6;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad * 2.4);
    grd.addColorStop(0, 'rgba(35,18,8,.95)');
    grd.addColorStop(0.4, 'rgba(70,40,20,.55)');
    grd.addColorStop(1, 'rgba(70,40,20,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, rad * 1.2, rad * 2.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  return pair(c);
}

/** Торец бревна: годичные кольца и тёмная кора по краю. */
function logEnd(r) {
  const [c, g] = canvas(256);
  g.fillStyle = '#3a2414';
  g.fillRect(0, 0, 256, 256);
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 124);
  grd.addColorStop(0, '#c9a06c');
  grd.addColorStop(0.8, '#b8875a');
  grd.addColorStop(0.93, '#8a5c37');
  grd.addColorStop(1, '#3a2414');
  g.fillStyle = grd;
  g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  for (let k = 6; k < 112; k += 3 + r() * 5) {
    g.strokeStyle = `rgba(110,70,38,${0.25 + r() * 0.35})`;
    g.lineWidth = 0.8 + r() * 1.2;
    g.beginPath();
    g.ellipse(128 + r() * 2, 128 + r() * 2, k, k * (0.95 + r() * 0.08), r(), 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) { // трещины усушки
    const a = r() * Math.PI * 2;
    g.strokeStyle = 'rgba(40,22,10,.7)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); g.stroke();
  }
  return pair(c, { repeat: [1, 1] });
}

/** Доски: идут вдоль x, зазоры между ними — вдоль y. */
function planks(r, { tone = [128, 94, 62], boards = 8 } = {}) {
  const [c, g] = canvas(512);
  const bh = 512 / boards;
  for (let b = 0; b < boards; b++) {
    const k = 0.82 + r() * 0.3;
    g.fillStyle = `rgb(${tone[0] * k | 0},${tone[1] * k | 0},${tone[2] * k | 0})`;
    g.fillRect(0, b * bh, 512, bh);
    for (let i = 0; i < 26; i++) {
      const y = b * bh + r() * bh;
      g.strokeStyle = r() < 0.6 ? `rgba(40,24,12,${0.05 + r() * 0.15})` : `rgba(220,190,150,${0.04 + r() * 0.1})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      const ph = r() * 6;
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + ph) * 1.2);
      g.stroke();
    }
    // стык досок по длине и гвозди
    const joint = r() * 512;
    g.fillStyle = 'rgba(20,12,6,.55)';
    g.fillRect(joint, b * bh, 2, bh);
    g.fillStyle = 'rgba(30,30,30,.7)';
    for (const x of [joint - 10, joint + 12]) {
      g.beginPath(); g.arc(x, b * bh + bh * 0.3, 1.6, 0, 7); g.arc(x, b * bh + bh * 0.7, 1.6, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(15,9,4,.85)'; // щель между досками
    g.fillRect(0, b * bh, 512, 2.5);
  }
  return pair(c);
}

/** Мягкая кровля (гибкая черепица): ряды «лепестков», ряды идут вдоль y, сдвиг — каждый второй ряд. */
function shingles(r) {
  const [c, g] = canvas(512);
  g.fillStyle = '#1d1210';
  g.fillRect(0, 0, 512, 512);
  const rows = 8; const rw = 512 / rows; const tabs = 6; const th = 512 / tabs;
  for (let i = 0; i < rows; i++) {
    const off = i % 2 ? th / 2 : 0;
    for (let j = -1; j < tabs + 1; j++) {
      const y = j * th + off;
      const k = 0.75 + r() * 0.4;
      const gr = g.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
      gr.addColorStop(0, `rgb(${92 * k | 0},${44 * k | 0},${34 * k | 0})`);
      gr.addColorStop(1, `rgb(${60 * k | 0},${28 * k | 0},${22 * k | 0})`);
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(i * rw + 1, y + 2, rw - 3, th - 4, [0, 10, 10, 0]);
      g.fill();
      for (let s = 0; s < 40; s++) { // посыпка
        g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.25)' : 'rgba(255,200,170,.12)';
        g.fillRect(i * rw + r() * rw, y + r() * th, 1.5, 1.5);
      }
    }
  }
  return pair(c);
}

/** Бутовый камень: неровные камни и тёмный раствор. */
function stone(r) {
  const [c, g] = canvas(512);
  g.fillStyle = '#3d3a35';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    const x = r() * 512; const y = r() * 512; const w = 30 + r() * 46; const hh = 22 + r() * 30;
    const v = 105 + r() * 70;
    const tint = r() * 18;
    for (const [dx, dy] of [[0, 0], [-512, 0], [512, 0], [0, -512], [0, 512]]) {
      const gr = g.createRadialGradient(x + dx - w * 0.2, y + dy - hh * 0.25, 2, x + dx, y + dy, w * 0.75);
      gr.addColorStop(0, `rgb(${v + 30 + tint | 0},${v + 26 | 0},${v + 18 | 0})`);
      gr.addColorStop(1, `rgb(${v - 30 + tint | 0},${v - 32 | 0},${v - 38 | 0})`);
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x + dx, y + dy, w / 2, hh / 2, r() * 0.5 - 0.25, 0, Math.PI * 2);
      g.fill();
    }
  }
  return pair(c);
}

/** Земля: светлая «нейтральная» крапчатая текстура — цвет сезона даёт материал. */
function ground(r) {
  const [c, g] = canvas(512);
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 160; i++) { // пятна
    const x = r() * 512; const y = r() * 512; const rad = 10 + r() * 50;
    const v = 150 + r() * 105 | 0;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${v},${v},${v},.5)`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) { // травинки и крупинки
    const v = 110 + r() * 145 | 0;
    g.fillStyle = `rgba(${v},${v},${v},.55)`;
    const x = r() * 512; const y = r() * 512;
    g.fillRect(x, y, 1 + r() * 1.5, 2 + r() * 4);
  }
  return pair(c, { repeat: [60, 60] });
}

/** Кора: вертикальные тёмные борозды. */
function bark(r) {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#4a3a2e';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 70; i++) {
    const x = r() * 128;
    g.strokeStyle = r() < 0.6 ? `rgba(20,14,10,${0.3 + r() * 0.4})` : `rgba(140,120,100,${0.15 + r() * 0.2})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 20) g.lineTo(x + (r() - 0.5) * 6, y);
    g.stroke();
  }
  return pair(c, { repeat: [2, 4] });
}

/** Круглые спрайты: мягкое пятно (дым, свечение, снег) и язык пламени. */
function sprite(stops, size = 128) {
  const [c, g] = canvas(size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Свет в окне ночью: тёплая середина и шторы по краям (используется как emissiveMap стекла). */
function windowLight(r) {
  const [c, g] = canvas(128);
  const gr = g.createRadialGradient(64, 70, 4, 64, 64, 80);
  gr.addColorStop(0, '#fff1cf');
  gr.addColorStop(0.55, '#ffc27a');
  gr.addColorStop(1, '#b8622a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  for (const side of [0, 1]) { // шторы
    const x0 = side ? 128 - 30 : 0;
    for (let x = 0; x < 30; x += 3) {
      g.fillStyle = `rgba(120,50,20,${0.35 + r() * 0.25 + Math.sin(x * 0.6) * 0.1})`;
      g.fillRect(x0 + x, 0, 3, 128);
    }
  }
  g.fillStyle = 'rgba(90,40,15,.35)'; // полка/подоконник внутри
  g.fillRect(0, 104, 128, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Набор текстур создаётся один раз на весь просмотрщик и делится между домиками. */
export function makeTextures() {
  const r = rng(20261014);
  return {
    log: logSide(r),
    logEnd: logEnd(r),
    planks: planks(r),
    planksDark: planks(r, { tone: [92, 64, 42], boards: 10 }),
    shingles: shingles(r),
    stone: stone(r),
    ground: ground(r),
    bark: bark(r),
    windowLight: windowLight(r),
    soft: sprite([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]),
    glow: sprite([[0, 'rgba(255,214,150,1)'], [0.2, 'rgba(255,170,80,.6)'], [1, 'rgba(255,120,40,0)']]),
    flame: sprite([[0, 'rgba(255,250,210,1)'], [0.3, 'rgba(255,190,70,.9)'], [0.65, 'rgba(255,90,20,.45)'], [1, 'rgba(200,40,0,0)']]),
    shadow: sprite([[0, 'rgba(0,0,0,.62)'], [0.55, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']], 256),
  };
}

/** Копия текстуры с собственным повтором (картинка общая, память не тратится). */
export function repeatOf(t, x, y) {
  const c = t.clone();
  c.repeat.set(x, y);
  c.needsUpdate = true;
  return c;
}
