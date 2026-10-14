// Окружение домика: поляна в лесу на плато, сосны и лиственные деревья, трава, цветы, камни, дальние горы.
// Всё — инстансами (один вызов отрисовки на сотни деревьев), цвета зависят от сезона.

import * as THREE from '../../vendor/three/three.module.min.js';
import { mergeGeometries, mergeVertices } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';

export const CLEARING = 19; // радиус поляны: дальше начинается лес, камера за него не выходит

export const SEASONS = {
  spring: { ground: '#86a956', grass: '#93c45c', leaves: ['#9fd067', '#b9dc7c', '#8cc552', '#f2d7e3'], flowers: ['#ffffff', '#f6e27a', '#c9a2ff'] },
  summer: { ground: '#5b8a3a', grass: '#64a03e', leaves: ['#3f7d2b', '#4f9034', '#356b26', '#5c9a3a'], flowers: ['#ffffff', '#ffd54a', '#e05b7a', '#8fb7ff'] },
  autumn: { ground: '#86793f', grass: '#b09a4a', leaves: ['#d98a1f', '#c75a1c', '#e8b53b', '#a8461a', '#94922f'], flowers: null },
  winter: { ground: '#eef3f9', grass: null, leaves: null, flowers: null },
};

// ---------- шум ----------
function makeNoise2(rand) {
  const N = 256;
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const s = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => g[(x & (N - 1)) + (y & (N - 1)) * N];
  const v = (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const fx = s(x - xi); const fy = s(y - yi);
    const a = at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx;
    const b = at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
  return (x, y, oct = 4) => {
    let sum = 0; let amp = 1; let norm = 0; let f = 1;
    for (let o = 0; o < oct; o++) { sum += v(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- геометрии деревьев (единичной высоты, масштабируются инстансом) ----------
/** Неровности формы. Совпадающие вершины (швы, грани) сдвигаются одинаково — без щелей. */
function jitter(geo, rand, amt) {
  const p = geo.attributes.position;
  const moved = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let d = moved.get(key);
    if (!d) { d = [(rand() - 0.5) * amt, (rand() - 0.5) * amt * 0.6, (rand() - 0.5) * amt]; moved.set(key, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

const flat = (g) => (g.index ? g.toNonIndexed() : g);

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const p = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const k = 0.75 + 0.35 * Math.min(1, Math.max(0, p.getY(i))); // к верхушке светлее
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function pineGeometry(rand) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.018, 0.03, 0.3, 6);
  trunk.translate(0, 0.15, 0);
  parts.push(paint(trunk, '#3b2a1f'));
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const r = 0.27 * (1 - i * 0.17);
    const h = 0.34 - i * 0.02;
    const cone = new THREE.ConeGeometry(r, h, 9, 2);
    jitter(cone, rand, 0.035);
    cone.translate(0, 0.24 + i * 0.15 + h / 2, 0);
    parts.push(paint(cone, '#1f4a30'));
  }
  return mergeGeometries(parts.map(flat));
}

function pineSnowGeometry(rand) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.27 * (1 - i * 0.17) * 0.86;
    const cone = new THREE.ConeGeometry(r, 0.12, 9, 1, true);
    jitter(cone, rand, 0.02);
    cone.translate(0, 0.24 + i * 0.15 + 0.2, 0);
    parts.push(flat(cone));
  }
  return mergeGeometries(parts);
}

function broadTrunkGeometry() {
  const parts = [];
  const t = new THREE.CylinderGeometry(0.022, 0.04, 0.6, 7);
  t.translate(0, 0.3, 0);
  parts.push(t);
  for (const [ang, tilt, y] of [[0.3, 0.7, 0.42], [2.4, 0.8, 0.5], [4.3, 0.6, 0.47], [5.4, 0.9, 0.58]]) {
    const b = new THREE.CylinderGeometry(0.008, 0.016, 0.3, 5);
    b.translate(0, 0.15, 0);
    b.rotateZ(tilt);
    b.rotateY(ang);
    b.translate(0, y, 0);
    parts.push(b);
  }
  return mergeGeometries(parts.map((g) => paint(flat(g), '#4a3c31')));
}

function crownGeometry(rand) {
  const parts = [];
  for (const [x, y, z, r] of [[0, 0.72, 0, 0.24], [0.15, 0.62, 0.05, 0.17], [-0.14, 0.64, -0.06, 0.18], [0.03, 0.86, 0.04, 0.16], [-0.05, 0.6, 0.14, 0.15]]) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    jitter(s, rand, r * 0.35);
    s.translate(x, y, z);
    parts.push(flat(s));
  }
  // гладкие нормали (иначе крона выглядит гранёной) и затенение снизу и внутри кроны
  let g = mergeGeometries(parts);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.5 + 0.6 * Math.min(1, Math.max(0, (p.getY(i) - 0.45) / 0.5)) + Math.hypot(p.getX(i), p.getZ(i)) * 0.4;
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function tuftGeometry(rand) {
  const pos = []; const col = [];
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2; const rr = rand() * 0.09;
    const x = Math.cos(a) * rr; const z = Math.sin(a) * rr;
    const h = 0.12 + rand() * 0.22; const w = 0.018 + rand() * 0.01;
    const lean = (rand() - 0.5) * 0.16;
    const nx = Math.cos(a + 1.57) * w; const nz = Math.sin(a + 1.57) * w;
    pos.push(x - nx, 0, z - nz, x + nx, 0, z + nz, x + lean, h, z + lean * 0.5);
    col.push(0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.95, 0.95, 0.95);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // травинки освещаются «сверху», а не по случайной нормали треугольника
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Окружение. quality: 'high' | 'low'. */
export function buildNature(T, { quality = 'high' } = {}) {
  const rand = rng(77);
  const noise = makeNoise2(rand);
  const group = new THREE.Group();
  const trash = [];
  const keep = (x) => { trash.push(x); return x; };
  const lo = quality === 'low';

  // высота земли: ровная поляна, дальше — холмы и подъём к горизонту
  const height = (x, z) => {
    const d = Math.hypot(x, z);
    const hills = smooth(CLEARING - 4, 70, d) * (noise(x * 0.02 + 10, z * 0.02 + 10) * 16 + (d - 15) * 0.05);
    const bumps = smooth(7, 16, d) * (noise(x * 0.25, z * 0.25, 2) - 0.5) * 0.5;
    return Math.max(0, hills) + bumps;
  };

  // ---------- земля ----------
  const SIZE = 520; const SEG = lo ? 110 : 170;
  const gGeo = keep(new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG));
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position;
  const gcol = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i); const z = gp.getZ(i);
    gp.setY(i, height(x, z));
    const k = 0.78 + noise(x * 0.06 + 3, z * 0.06 + 7) * 0.4;
    gcol[i * 3] = k; gcol[i * 3 + 1] = k; gcol[i * 3 + 2] = k;
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  gGeo.computeVertexNormals();
  const groundMat = keep(new THREE.MeshStandardMaterial({ map: T.ground.map, bumpMap: T.ground.bump, bumpScale: 0.8, roughness: 0.96, vertexColors: true }));
  const ground = new THREE.Mesh(gGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // ---------- дальние горы (за лесом, в дымке) ----------
  const mountMat = keep(new THREE.MeshStandardMaterial({ color: '#3d5a52', roughness: 1, flatShading: true }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.3;
    const dist = 300 + rand() * 120;
    const geo = keep(jitter(new THREE.ConeGeometry(110 + rand() * 90, 70 + rand() * 70, 7, 3), rand, 18));
    const m = new THREE.Mesh(geo, mountMat);
    m.position.set(Math.sin(a) * dist, -8, Math.cos(a) * dist);
    m.rotation.y = rand() * 3;
    group.add(m);
  }

  // ---------- деревья ----------
  const placeTrees = (count, rMin, rMax, minGap) => {
    const pts = [];
    let guard = 0;
    while (pts.length < count && guard++ < count * 40) {
      // плотнее у края поляны, реже вдали
      const r = rMin + (rMax - rMin) * Math.pow(rand(), 1.6);
      const a = rand() * Math.PI * 2;
      const x = Math.sin(a) * r; const z = Math.cos(a) * r;
      if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minGap * minGap)) continue;
      pts.push({ x, z, y: height(x, z) - 0.15 });
    }
    return pts;
  };
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s3 = new THREE.Vector3(); const p3 = new THREE.Vector3();
  const c = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);

  const pines = placeTrees(lo ? 240 : 420, CLEARING + 0.5, 150, 2.6);
  const pineGeo = keep(pineGeometry(rand));
  const pineMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: false }));
  const pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, pines.length);
  const snowCapGeo = keep(pineSnowGeometry(rand));
  const snowMat = keep(new THREE.MeshStandardMaterial({ color: '#f4f8fd', roughness: 0.85 }));
  const snowCaps = new THREE.InstancedMesh(snowCapGeo, snowMat, pines.length);
  // у края поляны деревья ниже — из-за них видно небо; вглубь леса — выше
  const treeHeight = (t, base, spread) => (base + rand() * spread) * (1 + smooth(CLEARING, 70, Math.hypot(t.x, t.z)) * 0.8);
  pines.forEach((t, i) => {
    const hgt = treeHeight(t, 6.5, 5);
    q.setFromAxisAngle(Y, rand() * Math.PI * 2);
    m4.compose(p3.set(t.x, t.y, t.z), q, s3.set(hgt * (0.85 + rand() * 0.3), hgt, hgt * (0.85 + rand() * 0.3)));
    pineMesh.setMatrixAt(i, m4);
    snowCaps.setMatrixAt(i, m4);
    const k = 0.78 + rand() * 0.35;
    pineMesh.setColorAt(i, c.setRGB(k, k * (0.95 + rand() * 0.1), k));
  });
  pineMesh.castShadow = true;
  snowCaps.visible = false;
  group.add(pineMesh, snowCaps);

  const broad = placeTrees(lo ? 90 : 170, CLEARING + 1, 120, 3.2);
  const trunkGeo = keep(broadTrunkGeometry());
  const trunkMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  const crownGeo = keep(crownGeometry(rand));
  const crownMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, broad.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, broad.length);
  const crownSeeds = broad.map(() => rand());
  broad.forEach((t, i) => {
    const hgt = treeHeight(t, 5.5, 4);
    q.setFromAxisAngle(Y, rand() * Math.PI * 2);
    m4.compose(p3.set(t.x, t.y, t.z), q, s3.set(hgt, hgt, hgt));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, c.set('#ffffff'));
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);

  // ---------- трава, цветы, камни (раскладываются вокруг текущего домика) ----------
  const GRASS = lo ? 2600 : 6000;
  const tuftGeo = keep(tuftGeometry(rand));
  const grassMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }));
  const grass = new THREE.InstancedMesh(tuftGeo, grassMat, GRASS);
  grass.receiveShadow = true;

  const FLOWERS = lo ? 160 : 380;
  const flowerGeo = keep(new THREE.IcosahedronGeometry(0.035, 0));
  const flowerMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.6 }));
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWERS);
  const flowerSeeds = Array.from({ length: FLOWERS }, () => rand());

  const ROCKS = 22;
  const rockGeo = keep(jitter(new THREE.DodecahedronGeometry(0.5, 1), rand, 0.18));
  const rockMat = keep(new THREE.MeshStandardMaterial({ map: T.ground.map, bumpMap: T.stone.bump, bumpScale: 2, roughness: 0.92, color: '#a09a91' }));
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(grass, flowers, rocks);

  /** Разложить мелочь по поляне, не залезая на домик, террасу и дорожку. */
  function layout(clear = []) {
    const lr = rng(5);
    const inside = (x, z, pad = 0) => clear.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
    const spot = (rMin, rMax, pad) => {
      for (let k = 0; k < 30; k++) {
        const r = rMin + (rMax - rMin) * Math.sqrt(lr());
        const a = lr() * Math.PI * 2;
        const x = Math.sin(a) * r; const z = Math.cos(a) * r;
        if (!inside(x, z, pad)) return [x, z];
      }
      return [0, -1000];
    };
    for (let i = 0; i < GRASS; i++) {
      const [x, z] = spot(1.5, CLEARING + 6, 0.1);
      const sc = 0.7 + lr() * 0.9;
      q.setFromAxisAngle(Y, lr() * 6.28);
      grass.setMatrixAt(i, m4.compose(p3.set(x, height(x, z) - 0.02, z), q, s3.set(sc, sc * (0.8 + lr() * 0.5), sc)));
    }
    for (let i = 0; i < FLOWERS; i++) {
      const [x, z] = spot(2, CLEARING, 0.2);
      flowers.setMatrixAt(i, m4.compose(p3.set(x, height(x, z) + 0.2 + lr() * 0.15, z), q.identity(), s3.set(1, 1, 1)));
    }
    for (let i = 0; i < ROCKS; i++) {
      const [x, z] = spot(7, CLEARING + 3, 0.8);
      const sc = 0.3 + lr() * lr() * 1.3;
      q.setFromEuler(new THREE.Euler(lr() * 3, lr() * 3, lr() * 3));
      rocks.setMatrixAt(i, m4.compose(p3.set(x, height(x, z) + sc * 0.12, z), q, s3.set(sc * 1.3, sc * 0.7, sc)));
    }
    for (const im of [grass, flowers, rocks]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }

  function setSeason(season) {
    const S = SEASONS[season] ?? SEASONS.summer;
    const winter = season === 'winter';
    groundMat.color.set(S.ground);
    groundMat.roughness = winter ? 0.75 : 0.96;
    groundMat.bumpScale = winter ? 0.25 : 0.8;
    mountMat.color.set(winter ? '#c9d4dc' : season === 'autumn' ? '#5a5a45' : '#3d5a52');
    snowCaps.visible = winter;
    pineMat.color.set(winter ? '#c6d2cc' : '#ffffff');
    crowns.visible = !winter;
    if (!winter) {
      broad.forEach((_, i) => {
        const pal = S.leaves;
        const pick = pal[Math.floor(crownSeeds[i] * pal.length)];
        crowns.setColorAt(i, c.set(pick).multiplyScalar(0.85 + ((crownSeeds[i] * 7.31) % 1) * 0.3));
      });
      crowns.instanceColor.needsUpdate = true;
    }
    grass.visible = !!S.grass;
    if (S.grass) grassMat.color.set(S.grass);
    flowers.visible = !!S.flowers;
    if (S.flowers) {
      for (let i = 0; i < FLOWERS; i++) flowers.setColorAt(i, c.set(S.flowers[Math.floor(flowerSeeds[i] * S.flowers.length)]));
      flowers.instanceColor.needsUpdate = true;
    }
  }

  return {
    group,
    height,
    ground,
    layout,
    setSeason,
    dispose() { for (const x of trash) x.dispose?.(); for (const im of [pineMesh, snowCaps, trunks, crowns, grass, flowers, rocks]) im.dispose(); },
  };
}
