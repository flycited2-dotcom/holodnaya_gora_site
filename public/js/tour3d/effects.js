// Живые детали сцены: дым из трубы, огонь в мангале, снег, светлячки, листопад, звёзды и ночное небо.
// Количество частиц зависит от качества (слабые телефоны получают меньше).

import * as THREE from '../../vendor/three/three.module.min.js';
import { rng } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildEffects(T, { quality = 'high' } = {}) {
  const lo = quality === 'low';
  const rand = rng(99);
  const group = new THREE.Group();
  const trash = [];
  const keep = (x) => { trash.push(x); return x; };
  const st = { smoke: 0, fire: 0, snow: false, fireflies: 0, leaves: null, night: 0 };

  // ---------- дым ----------
  const SMOKE = 26;
  const smokeOrigin = V(0, -100, 0);
  const smoke = Array.from({ length: SMOKE }, (_, i) => {
    const mat = keep(new THREE.SpriteMaterial({ map: T.soft, color: '#d9d4cf', transparent: true, opacity: 0, depthWrite: false }));
    const s = new THREE.Sprite(mat);
    group.add(s);
    return { s, mat, age: (i / SMOKE) * 7, seed: rand() * 10 };
  });

  // ---------- огонь ----------
  const fireOrigin = V(0, -100, 0);
  const flames = Array.from({ length: 7 }, () => {
    const mat = keep(new THREE.SpriteMaterial({ map: T.flame, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    const s = new THREE.Sprite(mat);
    group.add(s);
    return { s, mat, ph: rand() * 10, dx: (rand() - 0.5) * 0.7, dz: (rand() - 0.5) * 0.18 };
  });
  const fireLight = new THREE.PointLight('#ff7a2a', 0, 10, 2);
  group.add(fireLight);

  // ---------- снег ----------
  const SNOW = lo ? 900 : 2200;
  const snowPos = new Float32Array(SNOW * 3);
  const snowSeed = new Float32Array(SNOW);
  for (let i = 0; i < SNOW; i++) {
    snowPos[i * 3] = (rand() - 0.5) * 44;
    snowPos[i * 3 + 1] = rand() * 22;
    snowPos[i * 3 + 2] = (rand() - 0.5) * 44;
    snowSeed[i] = rand() * 10;
  }
  const snowGeo = keep(new THREE.BufferGeometry());
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snowMat = keep(new THREE.PointsMaterial({ map: T.soft, size: 0.1, transparent: true, opacity: 0.95, depthWrite: false, color: '#ffffff' }));
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  snow.visible = false;
  group.add(snow);

  // ---------- светлячки ----------
  const FF = lo ? 40 : 80;
  const ffPos = new Float32Array(FF * 3);
  const ffCol = new Float32Array(FF * 3);
  const ffSeed = Array.from({ length: FF }, () => ({ r: 4 + rand() * 13, a: rand() * 6.28, y: 0.3 + rand() * 1.8, sp: 0.05 + rand() * 0.12, ph: rand() * 10 }));
  const ffGeo = keep(new THREE.BufferGeometry());
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
  const ffMat = keep(new THREE.PointsMaterial({ map: T.soft, size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  fireflies.visible = false;
  group.add(fireflies);

  // ---------- листопад / лепестки ----------
  const LEAVES = lo ? 60 : 130;
  const leafGeo = keep(new THREE.PlaneGeometry(0.09, 0.065));
  const leafMat = keep(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }));
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES);
  leaves.frustumCulled = false;
  leaves.visible = false;
  const leafSt = Array.from({ length: LEAVES }, () => ({
    x: (rand() - 0.5) * 34, y: rand() * 9, z: (rand() - 0.5) * 34, vy: 0.35 + rand() * 0.4, ph: rand() * 10, spin: 1 + rand() * 3, c: rand(),
  }));
  group.add(leaves);

  // ---------- ночь: купол, звёзды, луна ----------
  const domeGeo = keep(new THREE.SphereGeometry(950, 32, 16));
  const dc = []; const dp = domeGeo.attributes.position;
  const zen = new THREE.Color('#03060d'); const hor = new THREE.Color('#1a2a44'); const tmp = new THREE.Color();
  for (let i = 0; i < dp.count; i++) {
    const t = Math.min(1, Math.max(0, dp.getY(i) / 950));
    tmp.copy(hor).lerp(zen, Math.pow(t, 0.6));
    dc.push(tmp.r, tmp.g, tmp.b, 0.82 + t * 0.18);
  }
  domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(dc, 4));
  const domeMat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -2;
  group.add(dome);

  const STARS = 1400;
  const starPos = [];
  for (let i = 0; i < STARS; i++) {
    const u = rand() * 2 - 1; const a = rand() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.05;
    const rr = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(a) * rr * 880, y * 880, Math.sin(a) * rr * 880);
  }
  const starGeo = keep(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = keep(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -1;
  group.add(stars);

  const moonMat = keep(new THREE.SpriteMaterial({ map: T.soft, color: '#f4f1e6', transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const moon = new THREE.Sprite(moonMat);
  moon.scale.set(70, 70, 1);
  moon.renderOrder = -1;
  group.add(moon);

  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const one = V(1, 1, 1); const p = V(0, 0, 0);
  const leafColor = new THREE.Color();

  return {
    group,
    /** Где дымить и где гореть — зависит от домика (у GLB-модели может не быть трубы). */
    setSources(smokeAt, fireAt) {
      smokeOrigin.copy(smokeAt ?? V(0, -100, 0));
      fireOrigin.copy(fireAt ?? V(0, -100, 0));
      fireLight.position.copy(fireOrigin).add(V(0, 0.3, 0));
      st.hasSmoke = !!smokeAt;
      st.hasFire = !!fireAt;
    },
    setSeason(season, palette) {
      st.snow = season === 'winter';
      snow.visible = st.snow;
      st.leaves = season === 'autumn' ? palette : season === 'spring' ? ['#ffffff', '#f6d6e4', '#fbe7ee'] : null;
      leaves.visible = !!st.leaves;
      if (st.leaves) {
        leafSt.forEach((l, i) => leaves.setColorAt(i, leafColor.set(st.leaves[Math.floor(l.c * st.leaves.length)])));
        leaves.instanceColor.needsUpdate = true;
      }
      st.season = season;
    },
    /** night: 0 — день, 1 — ночь; moonDir — направление на луну. */
    setNight(night, moonDir) {
      st.night = night;
      domeMat.opacity = Math.min(1, Math.max(0, (night - 0.25) / 0.6));
      starMat.opacity = Math.min(1, Math.max(0, (night - 0.55) / 0.4)) * 0.9;
      moonMat.opacity = starMat.opacity;
      moon.position.copy(moonDir).multiplyScalar(820);
      const s = st.season;
      st.smoke = st.hasSmoke ? ({ winter: 1, autumn: 0.75, spring: 0.4, summer: 0 }[s] ?? 0) * (0.55 + 0.45 * night) : 0;
      st.fire = st.hasFire ? Math.min(1, Math.max(0, (night - 0.2) / 0.5)) : 0;
      st.fireflies = s === 'summer' || s === 'spring' ? Math.max(0, (night - 0.6) / 0.4) * (s === 'summer' ? 1 : 0.4) : 0;
      fireflies.visible = st.fireflies > 0.01;
      snowMat.color.set(night > 0.6 ? '#c7d3ff' : '#ffffff');
    },
    update(dt, time) {
      // дым: поднимается, расплывается, сносится ветром
      for (const sp of smoke) {
        sp.age += dt;
        if (sp.age > 7) sp.age -= 7;
        const k = sp.age / 7;
        sp.s.position.set(
          smokeOrigin.x + sp.age * 0.32 + Math.sin(time * 0.7 + sp.seed) * 0.12 * k * 3,
          smokeOrigin.y + sp.age * 0.55,
          smokeOrigin.z + Math.cos(time * 0.5 + sp.seed) * 0.1 * k * 3,
        );
        const size = 0.35 + sp.age * 0.38;
        sp.s.scale.set(size, size, 1);
        sp.mat.opacity = st.smoke * Math.sin(Math.PI * k) * (0.32 - 0.12 * st.night);
        sp.mat.color.set(st.night > 0.6 ? '#7d7f86' : '#d9d4cf');
        sp.s.visible = st.smoke > 0.01;
      }
      // огонь
      for (const f of flames) {
        const fl = 0.75 + Math.sin(time * 9 + f.ph) * 0.15 + Math.sin(time * 17 + f.ph * 2) * 0.1;
        f.s.position.set(fireOrigin.x + f.dx * 0.6, fireOrigin.y + 0.1 + fl * 0.12, fireOrigin.z + f.dz);
        f.s.scale.set(0.32 * fl, 0.55 * fl, 1);
        f.mat.opacity = st.fire * (0.65 + 0.35 * fl);
        f.s.visible = st.fire > 0.01;
      }
      fireLight.intensity = st.fire * 7 * (0.85 + Math.sin(time * 11) * 0.1 + Math.sin(time * 23) * 0.05);
      // снег
      if (st.snow) {
        const a = snowGeo.attributes.position;
        for (let i = 0; i < SNOW; i++) {
          let y = a.getY(i) - dt * (0.7 + (snowSeed[i] % 1) * 0.6);
          if (y < 0) y += 22;
          a.setY(i, y);
          a.setX(i, a.getX(i) + Math.sin(time * 0.8 + snowSeed[i]) * dt * 0.25);
        }
        a.needsUpdate = true;
      }
      // светлячки
      if (fireflies.visible) {
        for (let i = 0; i < FF; i++) {
          const f = ffSeed[i];
          const a = f.a + time * f.sp;
          ffPos[i * 3] = Math.cos(a) * f.r + Math.sin(time * 0.9 + f.ph) * 0.4;
          ffPos[i * 3 + 1] = f.y + Math.sin(time * 1.3 + f.ph) * 0.25;
          ffPos[i * 3 + 2] = Math.sin(a) * f.r;
          const blink = Math.max(0, Math.sin(time * 2.2 + f.ph * 3)) ** 3 * st.fireflies;
          ffCol[i * 3] = 0.9 * blink; ffCol[i * 3 + 1] = 1 * blink; ffCol[i * 3 + 2] = 0.35 * blink;
        }
        ffGeo.attributes.position.needsUpdate = true;
        ffGeo.attributes.color.needsUpdate = true;
      }
      // листья
      if (leaves.visible) {
        leafSt.forEach((l, i) => {
          l.y -= dt * l.vy;
          if (l.y < 0.02) { l.y = 6 + rand() * 4; l.x = (rand() - 0.5) * 34; l.z = (rand() - 0.5) * 34; }
          const sway = Math.sin(time * 1.2 + l.ph);
          p.set(l.x + sway * 0.6, l.y, l.z + Math.cos(time + l.ph) * 0.3);
          e.set(time * l.spin + l.ph, time * l.spin * 0.7, sway);
          leaves.setMatrixAt(i, m4.compose(p, q.setFromEuler(e), one));
        });
        leaves.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() { for (const x of trash) x.dispose?.(); leaves.dispose(); },
  };
}
