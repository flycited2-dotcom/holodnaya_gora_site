// Процедурный домик: сруб с террасой под общей крышей или каркасный A-frame для маленьких домиков.
// Размеры и детали берутся из данных домика (площадь, удобства), поэтому домики из site.json разные.
//
// Возвращает «объект домика» с тем же интерфейсом, что и загрузчик GLB-модели (model.js):
//   { group, anchors, smokeAt, fireAt, focus, clear, setSeason, setWarm, update, dispose }
// Просмотрщику всё равно, нарисован домик кодом, отсканирован или куплен.

import * as THREE from '../../vendor/three/three.module.min.js';
import { rng, repeatOf } from './textures.js';

const PLINTH = 0.5;                  // высота каменного цоколя и настила террасы, м
const LOG_R = 0.13;                  // радиус бревна
const STEP = LOG_R * 2 * 0.86;       // шаг рядов: брёвна врублены друг в друга
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AXIS_X = V(1, 0, 0);
const AXIS_Y = V(0, 1, 0);

const has = (house, re) => (house.features ?? []).some((f) => re.test(f));

export function hashSeed(s) {
  let x = 2166136261;
  for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

/** Мастерская: создаёт меши и запоминает всё, что потом нужно освободить. */
class Kit {
  constructor(T, seed) {
    this.T = T;
    this.rand = rng(seed);
    this.group = new THREE.Group();
    this.trash = [];
    this.anchors = new Map();
    this.glows = [];
    this.lamps = [];
    this.lights = [];
    this.snow = [];     // видно только зимой
    this.summer = [];   // зимой прячется под снег
    this.clear = [];
  }

  keep(x) { this.trash.push(x); return x; }
  mat(p) { return this.keep(new THREE.MeshStandardMaterial(p)); }
  tex(t, x, y, rot = 0) {
    const c = this.keep(repeatOf(t, x, y));
    if (rot) { c.center.set(0.5, 0.5); c.rotation = rot; }
    return c;
  }
  mesh(geo, mat, parent = this.group, { cast = true, receive = true } = {}) {
    this.keep(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  }
  box(w, h, d, mat, x, y, z, parent) {
    const m = this.mesh(new THREE.BoxGeometry(w, h, d), mat, parent);
    m.position.set(x, y, z);
    return m;
  }
  cyl(r, len, mat, x, y, z, parent, seg = 14) {
    const m = this.mesh(new THREE.CylinderGeometry(r, r, len, seg), mat, parent);
    m.position.set(x, y, z);
    return m;
  }
  anchor(name, p, n) { this.anchors.set(name, { p, n: n.clone().normalize() }); }
  dispose() { for (const x of this.trash) x.dispose?.(); this.trash = []; }
}

function materials(kit, roofTint) {
  const { T } = kit;
  const logSide = kit.mat({ map: T.log.map, bumpMap: T.log.bump, bumpScale: 1.4, roughness: 0.82 });
  const logEnd = kit.mat({ map: T.logEnd.map, bumpMap: T.logEnd.bump, bumpScale: 0.8, roughness: 0.9 });
  return {
    log: [logSide, logEnd, logEnd],
    trim: kit.mat({ map: T.planksDark.map, color: '#8d7868', roughness: 0.74 }),
    shutter: kit.mat({ map: T.planksDark.map, color: '#7fae95', roughness: 0.7 }),
    lining: kit.mat({ map: kit.tex(T.planks.map, 1.5, 2), color: '#c9b49c', roughness: 0.8 }),
    roofTint,
    stone: kit.mat({ map: kit.tex(T.stone.map, 3, 0.45), bumpMap: kit.tex(T.stone.bump, 3, 0.45), bumpScale: 2.5, roughness: 0.95 }),
    pathStone: kit.mat({ map: kit.tex(T.ground.map, 0.3, 0.3), bumpMap: kit.tex(T.stone.bump, 0.3, 0.3), bumpScale: 1.5, color: '#b5afa5', roughness: 0.9 }),
    chimney: kit.mat({ map: kit.tex(T.stone.map, 0.7, 2.4), bumpMap: kit.tex(T.stone.bump, 0.7, 2.4), bumpScale: 2.5, roughness: 0.95 }),
    glass: kit.mat({ color: '#16222a', roughness: 0.06, metalness: 0.9, emissive: '#ffb469', emissiveMap: T.windowLight, emissiveIntensity: 0 }),
    metal: kit.mat({ color: '#2c2b29', roughness: 0.45, metalness: 0.85 }),
    snow: kit.mat({ color: '#f3f7fc', roughness: 0.8 }),
  };
}

// ---------- брёвна (одним InstancedMesh на весь сруб) ----------
function addLogs(kit, M, logs) {
  if (!logs.length) return;
  const geo = kit.keep(new THREE.CylinderGeometry(1, 1, 1, 18, 1));
  geo.rotateZ(Math.PI / 2); // ось бревна — вдоль x
  const im = new THREE.InstancedMesh(geo, M.log, logs.length);
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  logs.forEach((L, i) => {
    q.setFromAxisAngle(AXIS_Y, L.alongZ ? Math.PI / 2 : 0);
    roll.setFromAxisAngle(AXIS_X, kit.rand() * Math.PI * 2); // каждое бревно повёрнуто по-своему — текстура не повторяется
    q.multiply(roll);
    const r = L.r * (0.94 + kit.rand() * 0.1);
    m.compose(V(L.x, L.y, L.z), q, V(L.len, r, r));
    im.setMatrixAt(i, m);
    const k = 0.84 + kit.rand() * 0.24;
    im.setColorAt(i, c.setRGB(k, k * (0.96 + kit.rand() * 0.06), k * 0.94));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  kit.group.add(im);
}

/** Ряды брёвен одной стены с вырезами под окна и двери. axis — вдоль какой оси идёт стена. */
function wallRows(logs, { axis, at, from, to, ys, openings = [] }) {
  for (const y of ys) {
    let parts = [[from(y), to(y)]];
    for (const o of openings) {
      if (y + LOG_R * 0.55 < o.y0 || y - LOG_R * 0.55 > o.y1) continue;
      const a = o.c - o.w / 2 - 0.07;
      const b = o.c + o.w / 2 + 0.07;
      parts = parts.flatMap(([p, q]) => ((b <= p || a >= q) ? [[p, q]] : [[p, Math.min(a, q)], [Math.max(b, p), q]]));
    }
    for (const [p, q] of parts) {
      if (q - p < 0.12) continue;
      const mid = (p + q) / 2;
      logs.push(axis === 'x'
        ? { x: mid, y, z: at, len: q - p, r: LOG_R, alongZ: false }
        : { x: at, y, z: mid, len: q - p, r: LOG_R, alongZ: true });
    }
  }
}

// ---------- окна, двери, свет ----------
function glowPlane(kit, parent, w, h, z) {
  const mat = kit.keep(new THREE.MeshBasicMaterial({
    map: kit.T.glow, color: '#ffb36b', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const m = kit.mesh(new THREE.PlaneGeometry(w * 2.3, h * 2), mat, parent, { cast: false, receive: false });
  m.position.z = z;
  kit.glows.push(mat);
}

function framed(kit, pos, normal) {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.lookAt(pos.clone().add(normal)); // локальная +z смотрит наружу
  kit.group.add(g);
  return g;
}

function addWindow(kit, M, { pos, normal, w, h, shutters = false }) {
  const g = framed(kit, pos, normal);
  const d = LOG_R * 2 + 0.08;
  kit.box(w + 0.18, 0.09, d, M.trim, 0, h / 2 + 0.045, 0, g);
  kit.box(0.09, h, d, M.trim, -w / 2 - 0.045, 0, 0, g);
  kit.box(0.09, h, d, M.trim, w / 2 + 0.045, 0, 0, g);
  kit.box(w + 0.36, 0.06, d * 0.5 + 0.2, M.trim, 0, -h / 2 - 0.06, d * 0.25 + 0.06, g); // отлив
  const glass = kit.mesh(new THREE.PlaneGeometry(w, h), M.glass, g, { cast: false });
  glass.position.z = -0.03;
  kit.box(0.05, h, 0.05, M.trim, 0, 0, 0, g);           // импост
  kit.box(w, 0.05, 0.05, M.trim, 0, h * 0.2, 0, g);
  if (shutters) {
    for (const s of [-1, 1]) kit.box(w / 2 + 0.06, h + 0.1, 0.045, M.shutter, s * (w * 0.75 + 0.17), 0, LOG_R + 0.05, g);
  }
  glowPlane(kit, g, w, h, LOG_R + 0.2);
  return g;
}

function addDoor(kit, M, { pos, normal, w = 0.96, h = 2.08 }) {
  const g = framed(kit, pos, normal);
  const d = LOG_R * 2 + 0.08;
  kit.box(w + 0.2, 0.1, d, M.trim, 0, h / 2 + 0.05, 0, g);
  kit.box(0.1, h, d, M.trim, -w / 2 - 0.05, 0, 0, g);
  kit.box(0.1, h, d, M.trim, w / 2 + 0.05, 0, 0, g);
  const doorMat = kit.mat({ map: kit.tex(kit.T.planksDark.map, 0.5, 1, Math.PI / 2), color: '#b08a6a', roughness: 0.7 });
  kit.box(w, h, 0.07, doorMat, 0, 0, -0.01, g);
  kit.box(w * 0.86, 0.06, 0.04, M.trim, 0, h * 0.28, 0.04, g); // поперечины
  kit.box(w * 0.86, 0.06, 0.04, M.trim, 0, -h * 0.3, 0.04, g);
  const knob = kit.mesh(new THREE.SphereGeometry(0.04, 12, 8), M.metal, g);
  knob.position.set(w * 0.36, -0.02, 0.07);
  return g;
}

function addLantern(kit, M, pos, normal) {
  const g = framed(kit, pos, normal);
  kit.box(0.04, 0.04, 0.24, M.metal, 0, 0.13, -0.1, g); // кронштейн
  const lamp = kit.mat({ color: '#2e1f12', emissive: '#ffc27d', emissiveIntensity: 0, roughness: 0.4 });
  kit.lamps.push(lamp);
  kit.box(0.15, 0.22, 0.15, lamp, 0, 0, 0.02, g);
  kit.box(0.2, 0.04, 0.2, M.metal, 0, 0.13, 0.02, g);
  const light = new THREE.PointLight('#ffb36b', 0, 9, 2);
  light.position.set(0, -0.05, 0.3);
  g.add(light);
  kit.lights.push({ light, base: 5 });
  glowPlane(kit, g, 0.3, 0.35, 0.12);
}

function spillLight(kit, pos, base = 8) {
  const light = new THREE.PointLight('#ffae62', 0, 9, 2);
  light.position.copy(pos);
  kit.group.add(light);
  kit.lights.push({ light, base });
}

// ---------- крыша ----------
/**
 * Двускатная крыша: нижняя плоскость ската проходит через (±halfSpan, baseY).
 * Каждый скат — кровля сверху и деревянная подшивка снизу. Возвращает высоту конька.
 */
function addGableRoof(kit, M, { halfSpan, baseY, pitch, z0, z1, overhang = 0.55 }) {
  const { T } = kit;
  const tan = Math.tan(pitch);
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  const xe = halfSpan + overhang;
  const len = xe / cos + 0.12;
  const depth = z1 - z0;
  const zc = (z0 + z1) / 2;
  const ridgeY = baseY + halfSpan * tan;
  const roofMat = kit.mat({
    map: kit.tex(T.shingles.map, len / 1.25, depth / 1.25), bumpMap: kit.tex(T.shingles.bump, len / 1.25, depth / 1.25),
    bumpScale: 2.2, roughness: 0.9, color: M.roofTint,
  });
  const LIN = 0.1; const TOP = 0.07;
  for (const s of [-1, 1]) {
    const n = V(s * sin, cos, 0);
    const base = V(s * (xe / 2 - 0.06), ridgeY - (xe / 2 - 0.06) * tan, zc); // точка на нижней плоскости ската
    const lining = kit.box(len, LIN, depth, M.lining, 0, 0, 0);
    lining.position.copy(base).addScaledVector(n, LIN / 2);
    const top = kit.box(len, TOP, depth + 0.04, roofMat, 0, 0, 0);
    top.position.copy(base).addScaledVector(n, LIN + TOP / 2);
    const snow = kit.box(len - 0.18, 0.1, depth - 0.16, M.snow, 0, 0, 0);
    snow.position.copy(base).addScaledVector(n, LIN + TOP + 0.05);
    snow.visible = false;
    kit.snow.push(snow);
    for (const m of [lining, top, snow]) m.rotation.z = -s * pitch;
    for (const z of [z0 - 0.03, z1 + 0.03]) { // ветровые доски
      const b = kit.box(len, 0.26, 0.05, M.trim, 0, 0, 0);
      b.position.copy(base).addScaledVector(n, 0.06);
      b.position.z = z;
      b.rotation.z = -s * pitch;
    }
  }
  kit.box(0.28, 0.08, depth + 0.1, M.metal, 0, ridgeY + (LIN + TOP) / cos + 0.02, zc); // конёк
  return ridgeY;
}

// ---------- терраса, ступени, ограждение ----------
function addDeck(kit, M, { x0, x1, z0, z1 }) {
  const { T } = kit;
  const w = x1 - x0; const d = z1 - z0;
  const deck = kit.mat({
    map: kit.tex(T.planks.map, w / 2.2, d / 1.15), bumpMap: kit.tex(T.planks.bump, w / 2.2, d / 1.15), bumpScale: 1.2, roughness: 0.78,
  });
  kit.box(w, 0.1, d, deck, (x0 + x1) / 2, PLINTH - 0.05, (z0 + z1) / 2);
  kit.box(w - 0.12, PLINTH - 0.1, d - 0.12, M.trim, (x0 + x1) / 2, (PLINTH - 0.1) / 2, (z0 + z1) / 2);
  kit.deckMat = deck;
  return deck;
}

function addStairs(kit, { x, z, w = 1.5 }) {
  for (let k = 1; k <= 3; k++) {
    const top = PLINTH * (1 - k / 4);
    kit.box(w, top, 0.32, kit.deckMat, x, top / 2, z + 0.16 + (k - 1) * 0.3);
  }
}

function addRailing(kit, M, segs) {
  const H = 0.95;
  const balusters = [];
  for (const [ax, az, bx, bz] of segs) {
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bz - az, bx - ax);
    for (const y of [PLINTH + H, PLINTH + 0.16]) {
      const rail = kit.box(len, 0.07, 0.08, M.trim, (ax + bx) / 2, y, (az + bz) / 2);
      rail.rotation.y = -ang;
    }
    const n = Math.max(1, Math.round(len / 0.15));
    for (let i = 1; i < n; i++) balusters.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
  }
  const geo = kit.keep(new THREE.BoxGeometry(0.045, H - 0.16, 0.045));
  const im = new THREE.InstancedMesh(geo, M.trim, balusters.length);
  const m = new THREE.Matrix4();
  balusters.forEach(([x, z], i) => im.setMatrixAt(i, m.makeTranslation(x, PLINTH + 0.16 + (H - 0.16) / 2, z)));
  im.castShadow = true;
  im.receiveShadow = true;
  kit.group.add(im);
}

function post(kit, M, x, z, y0, y1) {
  const p = kit.cyl(0.11, y1 - y0, M.log, x, (y0 + y1) / 2, z);
  return p;
}

// ---------- двор: мангал, дровник, дорожка ----------
function addMangal(kit, M, at) {
  const { T } = kit;
  const gravel = kit.mat({ map: kit.tex(T.ground.map, 1.2, 1.2), color: '#a39985', roughness: 1 });
  const disc = kit.mesh(new THREE.CircleGeometry(1.9, 40), gravel, kit.group, { cast: false });
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(at.x, 0.03, at.z);
  kit.summer.push(disc); // зимой площадку заметает
  const g = new THREE.Group();
  g.position.copy(at);
  g.rotation.y = -0.35;
  kit.group.add(g);
  kit.box(1.0, 0.26, 0.38, M.metal, 0, 0.78, 0, g);
  for (const sx of [-0.44, 0.44]) for (const sz of [-0.15, 0.15]) kit.box(0.04, 0.68, 0.04, M.metal, sx, 0.34, sz, g);
  kit.coals = kit.mat({ color: '#241710', emissive: '#ff5a14', emissiveIntensity: 0, roughness: 1 });
  kit.box(0.92, 0.03, 0.3, kit.coals, 0, 0.9, 0, g);
  const bench = kit.cyl(0.17, 1.7, M.log, 0, 0.17, 1.35, g);
  bench.rotation.z = Math.PI / 2;
  kit.cyl(0.21, 0.45, M.log, -1.25, 0.225, 0.55, g);
  kit.cyl(0.21, 0.45, M.log, 1.3, 0.225, 0.4, g);
  kit.fireAt = at.clone().add(V(0, 0.95, 0));
  kit.anchor('mangal', at.clone().add(V(0, 1.2, 0)), V(0.4, 0.35, 1));
  kit.clear.push({ x0: at.x - 2, x1: at.x + 2, z0: at.z - 2, z1: at.z + 2 });
}

function addWoodpile(kit, logs, { x, z0, z1 }) {
  const cols = Math.floor((z1 - z0) / 0.15);
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < cols; i++) {
      if (row > 3 && kit.rand() < 0.35) continue;
      logs.push({ x: x + (kit.rand() - 0.5) * 0.06, y: 0.08 + row * 0.135, z: z0 + i * 0.15 + (row % 2) * 0.07, len: 0.48, r: 0.068, alongZ: false });
    }
  }
}

function addPath(kit, M, z0, n = 8) {
  for (let i = 0; i < n; i++) {
    const s = kit.cyl(0.36, 0.06, M.pathStone, (kit.rand() - 0.5) * 0.35 + Math.sin(i * 0.7) * 0.25, 0.03, z0 + i * 0.78, kit.group, 9);
    s.scale.set(1 + kit.rand() * 0.25, 1, 0.8 + kit.rand() * 0.25);
    s.rotation.y = kit.rand() * 3;
    s.castShadow = false;
    kit.summer.push(s);
  }
  kit.clear.push({ x0: -0.9, x1: 0.9, z0, z1: z0 + n * 0.78 });
  kit.anchor('parking', V(0, 0.35, z0 + n * 0.78 + 0.4), V(0, 0.8, 1));
}

function contactShadow(kit, w, d, x = 0, z = 0) {
  const mat = kit.keep(new THREE.MeshBasicMaterial({ map: kit.T.shadow, transparent: true, depthWrite: false, opacity: 0.9 }));
  const m = kit.mesh(new THREE.PlaneGeometry(w, d), mat, kit.group, { cast: false, receive: false });
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.015, z);
}

// ---------- сруб ----------
function buildLogCabin(kit, M, house) {
  const area = house.area ?? 36;
  const W = Math.min(10, Math.max(6, Math.sqrt(area * 1.35)));
  const D = Math.min(8, Math.max(4.6, area / W));
  const T = Math.min(2.8, Math.max(2.1, D * 0.42));
  const pitch = THREE.MathUtils.degToRad(34);
  const tan = Math.tan(pitch);
  const heating = has(house, /отоплен|печ|камин/i);
  const logs = [];

  // цоколь
  kit.box(W + 0.4, PLINTH, D + 0.4, M.stone, 0, PLINTH / 2, 0);

  const nRows = 11;
  const rowY = (k) => PLINTH + LOG_R + k * STEP;
  const topY = rowY(nRows - 0.5) + LOG_R; // верх боковых стен — на них лежит крыша
  const ridgeY = topY + (W / 2) * tan;
  const e = 0.32; // выпуск брёвен на углах

  // проёмы
  const winY0 = PLINTH + 0.85; const winY1 = PLINTH + 2.0;
  const frontWins = W > 7.6 ? [-W * 0.3, W * 0.3] : [-W * 0.27, W * 0.27];
  const front = [
    { c: 0, w: 0.96, y0: PLINTH - 0.2, y1: PLINTH + 2.12, kind: 'door' },
    ...frontWins.map((c) => ({ c, w: 1.0, y0: winY0, y1: winY1, kind: 'win' })),
  ];
  const gableWin = ridgeY - topY > 1.5 ? { c: 0, w: 0.7, y0: topY + 0.25, y1: topY + 0.95, kind: 'win' } : null;
  if (gableWin) front.push(gableWin);
  const sideZ = D > 5.8 ? [-D * 0.22, D * 0.22] : [0];
  const side = sideZ.map((c) => ({ c, w: 0.9, y0: winY0, y1: winY1, kind: 'win' }));
  const back = [{ c: W * 0.2, w: 0.9, y0: winY0, y1: winY1, kind: 'win' }];

  // стены: фасад и задняя стена — вдоль x, боковые — вдоль z со сдвигом на полряда
  const frontYs = []; for (let k = 0; k < nRows; k++) frontYs.push(rowY(k));
  const sideYs = []; for (let k = 0; k <= nRows; k++) sideYs.push(rowY(k - 0.5));
  const gableYs = []; for (let k = nRows; ; k++) { const y = rowY(k); if (W / 2 - (y + LOG_R - topY) / tan < 0.3) break; gableYs.push(y); }
  const span = () => -W / 2 - e; const spanEnd = () => W / 2 + e;
  const gHalf = (y) => W / 2 - (y + LOG_R * 0.6 - topY) / tan;
  wallRows(logs, { axis: 'x', at: D / 2, from: span, to: spanEnd, ys: frontYs, openings: front });
  wallRows(logs, { axis: 'x', at: -D / 2, from: span, to: spanEnd, ys: frontYs, openings: back });
  wallRows(logs, { axis: 'x', at: D / 2, from: (y) => -gHalf(y), to: gHalf, ys: gableYs, openings: front });
  wallRows(logs, { axis: 'x', at: -D / 2, from: (y) => -gHalf(y), to: gHalf, ys: gableYs });
  for (const sx of [-1, 1]) {
    wallRows(logs, { axis: 'z', at: sx * W / 2, from: () => -D / 2 - e, to: () => D / 2 + e, ys: sideYs, openings: side });
  }

  // окна и дверь
  const wy = (winY0 + winY1) / 2;
  for (const c of frontWins) addWindow(kit, M, { pos: V(c, wy, D / 2), normal: V(0, 0, 1), w: 1.0, h: winY1 - winY0, shutters: true });
  if (gableWin) addWindow(kit, M, { pos: V(0, (gableWin.y0 + gableWin.y1) / 2, D / 2), normal: V(0, 0, 1), w: 0.7, h: 0.7 });
  for (const sx of [-1, 1]) for (const c of sideZ) addWindow(kit, M, { pos: V(sx * W / 2, wy, c), normal: V(sx, 0, 0), w: 0.9, h: winY1 - winY0 });
  addWindow(kit, M, { pos: V(W * 0.2, wy, -D / 2), normal: V(0, 0, -1), w: 0.9, h: winY1 - winY0 });
  addDoor(kit, M, { pos: V(0, PLINTH + 1.04, D / 2), normal: V(0, 0, 1) });
  addLantern(kit, M, V(0.82, PLINTH + 2.2, D / 2 + LOG_R + 0.12), V(0, 0, 1));
  spillLight(kit, V(0, PLINTH + 1.4, D / 2 + 1.1), 9);

  // крыша — общая для дома и террасы
  addGableRoof(kit, M, { halfSpan: W / 2, baseY: topY, pitch, z0: -D / 2 - 0.55, z1: D / 2 + T + 0.4 });

  // терраса
  addDeck(kit, M, { x0: -W / 2 - 0.2, x1: W / 2 + 0.2, z0: D / 2, z1: D / 2 + T });
  addStairs(kit, { x: 0, z: D / 2 + T });
  const postsX = W > 8 ? [-W / 2 + 0.14, -W / 4, W / 4, W / 2 - 0.14] : [-W / 2 + 0.14, W / 2 - 0.14];
  for (const x of postsX) post(kit, M, x, D / 2 + T - 0.12, PLINTH, topY - 0.2);
  kit.box(W + 0.3, 0.22, 0.2, M.trim, 0, topY - 0.1, D / 2 + T - 0.12);              // ригель
  kit.box(0.16, ridgeY - topY, 0.16, M.trim, 0, (topY + ridgeY) / 2, D / 2 + T - 0.12); // стойка фронтона
  const zf = D / 2 + T - 0.12;
  const rx = W / 2 + 0.1;
  addRailing(kit, M, [[-rx + 0.1, zf, -0.85, zf], [0.85, zf, rx - 0.1, zf], [-rx, D / 2 + 0.3, -rx, zf], [rx, D / 2 + 0.3, rx, zf]]);

  // печная труба
  let smokeAt = null;
  if (heating) {
    const cx = W * 0.22; const cz = -D * 0.12;
    const y0 = ridgeY - cx * tan - 0.4; const y1 = ridgeY + 0.75;
    kit.box(0.62, y1 - y0, 0.62, M.chimney, cx, (y0 + y1) / 2, cz);
    kit.box(0.8, 0.08, 0.8, M.metal, cx, y1 + 0.04, cz);
    smokeAt = V(cx, y1 + 0.25, cz);
    kit.anchor('chimney', V(cx, y1 + 0.1, cz), V(0.5, 1, 0.5));
    addWoodpile(kit, logs, { x: W / 2 + 0.55, z0: -D / 2 + 0.4, z1: D / 4 });
  }
  if (has(house, /мангал/i)) addMangal(kit, M, V(W / 2 + 2.6, 0, D / 2 + T * 0.5 + 0.4));
  addLogs(kit, M, logs);

  addPath(kit, M, D / 2 + T + 1.1);
  contactShadow(kit, W + 3.5, D + T + 3, 0, T / 2);

  // точки для подсказок
  kit.anchor('interior', V(frontWins[1], wy, D / 2 + LOG_R + 0.06), V(0, 0, 1));
  kit.anchor('door', V(0, PLINTH + 1.2, D / 2 + 0.1), V(0, 0, 1));
  kit.anchor('terrace', V(-W * 0.3, PLINTH + 0.55, D / 2 + T * 0.55), V(-0.2, 0.5, 1));
  kit.anchor('kitchen', V(W / 2 + LOG_R + 0.06, wy, sideZ[0]), V(1, 0, 0));
  kit.clear.push({ x0: -W / 2 - 1, x1: W / 2 + 1.2, z0: -D / 2 - 1, z1: D / 2 + T + 1.3 });

  return { smokeAt, size: { w: W + 1, d: D + T + 1 }, focusY: 2.2, focusZ: T * 0.35 };
}

// ---------- A-frame ----------
function buildAFrame(kit, M, house) {
  const area = house.area ?? 22;
  const W = Math.min(7, Math.max(5, Math.sqrt(area) * 1.2));
  const D = Math.min(7, Math.max(4.2, (area / W) * 1.25));
  const T = 2.2;
  const pitch = THREE.MathUtils.degToRad(60);
  const tan = Math.tan(pitch);
  const baseY = PLINTH + 0.25;
  const heating = has(house, /отоплен|печ|камин/i);

  kit.box(W + 0.3, PLINTH, D + 0.2, M.stone, 0, PLINTH / 2, 0);
  const ridgeY = addGableRoof(kit, M, { halfSpan: W / 2, baseY, pitch, z0: -D / 2 - 0.3, z1: D / 2 + 0.55, overhang: 0.3 });
  const apex = ridgeY - 0.04;
  const hw = (apex - PLINTH) / tan; // полуширина фронтона на уровне пола

  const tri = (z, mat) => {
    const s = new THREE.Shape();
    s.moveTo(-hw, PLINTH); s.lineTo(hw, PLINTH); s.lineTo(0, apex); s.closePath();
    const m = kit.mesh(new THREE.ShapeGeometry(s), mat, kit.group, { cast: true });
    m.position.z = z;
    return m;
  };
  const backMat = kit.mat({ map: kit.tex(kit.T.planks.map, 0.8, 0.8, Math.PI / 2), color: '#c8a888', roughness: 0.8, side: THREE.DoubleSide });
  tri(-D / 2, backMat);
  const frontGlass = kit.mat({ color: '#16222a', roughness: 0.05, metalness: 0.9, emissive: '#ffb469', emissiveIntensity: 0 });
  M.glassExtra = frontGlass;
  tri(D / 2 - 0.04, frontGlass);

  // каркас стеклянного фронтона
  const zf = D / 2 + 0.02;
  const slopeLen = Math.hypot(hw, apex - PLINTH);
  const ang = Math.atan2(apex - PLINTH, hw);
  for (const s of [-1, 1]) {
    const b = kit.box(slopeLen, 0.16, 0.14, M.trim, s * hw / 2, (PLINTH + apex) / 2, zf);
    b.rotation.z = s * -ang;
  }
  for (const y of [PLINTH + 2.3, PLINTH + 3.5]) {
    const half = (apex - y) / tan;
    if (half > 0.3) kit.box(half * 2, 0.12, 0.12, M.trim, 0, y, zf);
  }
  kit.box(hw * 2, 0.14, 0.14, M.trim, 0, PLINTH + 0.07, zf);
  const xs = [-0.55, 0.55, -hw * 0.6, hw * 0.6];
  for (const x of xs) {
    const top = Math.min(PLINTH + 2.3, apex - Math.abs(x) * tan);
    kit.box(0.1, top - PLINTH, 0.12, M.trim, x, (PLINTH + top) / 2, zf);
  }
  kit.box(0.1, apex - 0.3 - (PLINTH + 2.3), 0.12, M.trim, 0, (PLINTH + 2.3 + apex - 0.3) / 2, zf);
  const knob = kit.mesh(new THREE.SphereGeometry(0.04, 12, 8), M.metal);
  knob.position.set(0.4, PLINTH + 1.05, zf + 0.08);
  for (const [x, y, w, h] of [[0, PLINTH + 1.2, hw * 0.75, 1.3], [0, PLINTH + 3, hw * 0.4, 0.8]]) {
    const g = framed(kit, V(x, y, zf), V(0, 0, 1));
    glowPlane(kit, g, w, h, 0.25);
  }
  addLantern(kit, M, V(-0.95, PLINTH + 2.05, zf + 0.12), V(0, 0, 1));
  spillLight(kit, V(0, PLINTH + 1.3, D / 2 + 1.2), 12);

  addDeck(kit, M, { x0: -hw - 0.15, x1: hw + 0.15, z0: D / 2, z1: D / 2 + T });
  addStairs(kit, { x: 0, z: D / 2 + T, w: 1.6 });

  let smokeAt = null;
  if (heating) {
    const cx = W * 0.2; const cz = -D * 0.15;
    const y0 = ridgeY - cx * tan - 0.2; const y1 = ridgeY + 0.6;
    kit.cyl(0.1, y1 - y0, M.metal, cx, (y0 + y1) / 2, cz);
    const cap = kit.mesh(new THREE.ConeGeometry(0.22, 0.16, 12), M.metal);
    cap.position.set(cx, y1 + 0.12, cz);
    smokeAt = V(cx, y1 + 0.3, cz);
    kit.anchor('chimney', V(cx, y1 + 0.1, cz), V(0.5, 1, 0.5));
  }
  if (has(house, /мангал/i)) addMangal(kit, M, V(hw + 2.6, 0, D / 2 + 1.4));

  addPath(kit, M, D / 2 + T + 1.1);
  contactShadow(kit, W + 3, D + T + 3, 0, T / 2);

  kit.anchor('interior', V(-hw * 0.3, PLINTH + 1.7, zf + 0.06), V(0, 0, 1));
  kit.anchor('door', V(0, PLINTH + 1.1, zf + 0.06), V(0, 0, 1));
  kit.anchor('terrace', V(hw * 0.55, PLINTH + 0.4, D / 2 + T * 0.6), V(0.3, 0.6, 1));
  kit.clear.push({ x0: -W / 2 - 1, x1: W / 2 + 1, z0: -D / 2 - 1, z1: D / 2 + T + 1.3 });

  return { smokeAt, size: { w: W + 1, d: D + T + 1 }, focusY: 2.4, focusZ: T * 0.3 };
}

/** Собрать домик по данным из site.json. T — общий набор текстур. */
export function buildCabin(house, T, index = 0) {
  const kit = new Kit(T, hashSeed(house.id));
  const roofTints = ['#ffffff', '#a9bfa0', '#c4bbb4'];
  const M = materials(kit, roofTints[index % roofTints.length]);
  const aframe = (house.area ?? 30) <= 26;
  const info = aframe ? buildAFrame(kit, M, house) : buildLogCabin(kit, M, house);
  const glassMats = [M.glass, M.glassExtra].filter(Boolean);
  const radius = Math.hypot(info.size.w / 2, info.size.d / 2);

  return {
    kind: 'procedural',
    group: kit.group,
    anchors: kit.anchors,
    smokeAt: info.smokeAt,
    fireAt: kit.fireAt ?? null,
    focus: { target: V(0, info.focusY, info.focusZ), radius },
    clear: kit.clear,
    setSeason(season) {
      for (const m of kit.snow) m.visible = season === 'winter';
      for (const m of kit.summer) m.visible = season !== 'winter';
    },
    /** w: 0 — день, 1 — ночь. Окна, фонарь и угли разгораются к вечеру. */
    setWarm(w) {
      for (const m of glassMats) m.emissiveIntensity = w * 1.6;
      for (const m of kit.glows) m.opacity = w * 0.5;
      for (const m of kit.lamps) m.emissiveIntensity = w * 3;
      if (kit.coals) kit.coals.emissiveIntensity = w * 2.2;
      this._warm = w;
    },
    update(dt, time) {
      const w = this._warm ?? 0;
      const flicker = 0.93 + Math.sin(time * 7.3) * 0.04 + Math.sin(time * 13.7) * 0.03;
      for (const { light, base } of kit.lights) light.intensity = base * w * flicker;
    },
    dispose() { kit.dispose(); },
  };
}
