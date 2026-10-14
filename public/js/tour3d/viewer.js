// 3D-просмотрщик домиков: сцена, свет, небо, время суток, сезоны, камера и точки-подсказки.
// Ничего не знает о вёрстке сайта — интерфейс (кнопки, подсказки, бронь) живёт в public/js/tour.js.

import * as THREE from '../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { Sky } from '../../vendor/three/addons/objects/Sky.js';
import { makeTextures } from './textures.js';
import { buildCabin } from './cabin.js';
import { buildNature, CLEARING, SEASONS } from './nature.js';
import { buildEffects } from './effects.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rad = THREE.MathUtils.degToRad;
const dirOf = (el, az) => V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));

// Ключевые кадры времени суток: 0 — день, 1 — закат, 2 — ночь. Между ними — плавная интерполяция.
// skyEl — высота солнца для неба, lightEl/az — откуда светит основной свет (днём солнце, ночью луна).
const KEYS = [
  { skyEl: 48, lightEl: 50, az: -35, light: 2.7, lightColor: '#fff3e0', hemi: 0.95, hemiSky: '#cfe2ff', hemiGround: '#5d5240', exposure: 0.6, fog: '#b9cad6', fogD: 0.0032, turb: 3.5, ray: 1.0, mie: 0.004, mieG: 0.8, env: 0.85, night: 0 },
  { skyEl: 3, lightEl: 11, az: -62, light: 3.4, lightColor: '#ffb070', hemi: 0.8, hemiSky: '#ffd2a8', hemiGround: '#4a3528', exposure: 0.72, fog: '#d29a78', fogD: 0.004, turb: 6, ray: 2.4, mie: 0.006, mieG: 0.88, env: 0.75, night: 0.1 },
  { skyEl: -9, lightEl: 38, az: 28, light: 1.35, lightColor: '#a9bdff', hemi: 0.45, hemiSky: '#4a64a0', hemiGround: '#141a22', exposure: 0.95, fog: '#0e1828', fogD: 0.005, turb: 2, ray: 0.4, mie: 0.005, mieG: 0.8, env: 0.3, night: 1 },
].map((k) => Object.fromEntries(Object.entries(k).map(([n, v]) => [n, typeof v === 'string' ? new THREE.Color(v) : v])));

function frameAt(t) {
  const i = Math.min(1, Math.floor(t));
  const f = t - i;
  const a = KEYS[i]; const b = KEYS[i + 1];
  const out = {};
  for (const n of Object.keys(a)) out[n] = a[n].isColor ? a[n].clone().lerp(b[n], f) : a[n] + (b[n] - a[n]) * f;
  return out;
}

export const TIMES = ['day', 'sunset', 'night'];

export function createViewer(container, { quality = 'high', reducedMotion = false } = {}) {
  const lo = quality === 'low';
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const maxPR = lo ? 1.25 : 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'tour-canvas';
  container.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#b9cad6', 0.0032);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);

  // ---------- управление ----------
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 17;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = 1.47;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  canvas.style.touchAction = 'pan-y'; // вертикальный свайп по-прежнему листает страницу
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  const listeners = new Set();
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    state.fly = null;
    controls.enabled = true;
    for (const fn of listeners) fn();
  });

  // ---------- небо, свет, окружение ----------
  const sky = new Sky();
  sky.scale.setScalar(1800);
  scene.add(sky);
  const envScene = new THREE.Scene();
  const skyEnv = new Sky();
  skyEnv.material.dispose();
  skyEnv.material = sky.material;
  skyEnv.scale.setScalar(1800);
  envScene.add(skyEnv);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  let envAt = -9;

  const hemi = new THREE.HemisphereLight('#cfe2ff', '#5d5240', 1);
  const key = new THREE.DirectionalLight('#fff3e0', 2.7);
  key.castShadow = true;
  key.shadow.mapSize.set(lo ? 1024 : 2048, lo ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 100 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  scene.add(hemi, key, key.target);

  const T = makeTextures();
  const nature = buildNature(T, { quality });
  const effects = buildEffects(T, { quality });
  scene.add(nature.group, effects.group);

  const state = { obj: null, house: null, season: 'autumn', tod: 1, todTarget: 1, time: 0, fly: null, raf: 0, running: false, token: 0, spots: [] };

  function updateEnv() {
    const rt = pmrem.fromScene(envScene, 0, 0.1, 4000);
    scene.environment = rt.texture;
    envRT?.dispose();
    envRT = rt;
    envAt = state.tod;
  }

  function applyTime(t) {
    const f = frameAt(t);
    const u = sky.material.uniforms;
    u.sunPosition.value.copy(dirOf(f.skyEl, f.az));
    u.turbidity.value = f.turb;
    u.rayleigh.value = f.ray;
    u.mieCoefficient.value = f.mie;
    u.mieDirectionalG.value = f.mieG;
    const target = state.obj?.focus.target ?? V(0, 1.5, 0);
    key.target.position.copy(target);
    key.position.copy(target).addScaledVector(dirOf(f.lightEl, f.az), 45);
    key.color.copy(f.lightColor);
    key.intensity = f.light;
    hemi.color.copy(f.hemiSky);
    hemi.groundColor.copy(f.hemiGround);
    hemi.intensity = f.hemi;
    renderer.toneMappingExposure = f.exposure;
    scene.fog.color.copy(f.fog);
    scene.fog.density = f.fogD;
    scene.environmentIntensity = f.env;
    const warm = clamp((t - 0.35) / 1.3, 0, 1);
    state.obj?.setWarm(warm);
    effects.setNight(f.night, dirOf(f.lightEl, f.az)); // луна — там, откуда светит ночной свет
  }

  function applySeason() {
    const s = state.season;
    nature.setSeason(s);
    effects.setSeason(s, SEASONS[s]?.leaves);
    state.obj?.setSeason(s);
    applyTime(state.tod);
  }

  // ---------- камера ----------
  function fitFov(aspect) {
    // на узких экранах расширяем угол, чтобы домик целиком помещался по ширине
    camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(rad(22)) / aspect)), 38, 62);
  }

  function defaultView(obj) {
    const { target, radius } = obj.focus;
    const dist = clamp(radius * 2.3 + 3, 9, controls.maxDistance);
    return { target: target.clone(), pos: target.clone().addScaledVector(dirOf(9, 34), dist) };
  }

  function flyTo(view, dur = reducedMotion ? 0 : 1.1) {
    controls.autoRotate = false;
    if (dur <= 0) {
      controls.target.copy(view.target);
      camera.position.copy(view.pos);
      controls.update();
      return;
    }
    controls.enabled = false;
    state.fly = { t: 0, dur, fromT: controls.target.clone(), toT: view.target, fromP: camera.position.clone(), toP: view.pos };
  }

  function clampCamera() {
    const p = camera.position;
    const hz = Math.hypot(p.x, p.z);
    const lim = CLEARING - 1.2;
    if (hz > lim) { p.x *= lim / hz; p.z *= lim / hz; }
    const floor = nature.height(p.x, p.z) + 0.5;
    if (p.y < floor) p.y = floor;
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitFov(camera.aspect);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- точки-подсказки ----------
  const pv = V(0, 0, 0); const toCam = V(0, 0, 0);
  function projectSpots() {
    const w = container.clientWidth; const h = container.clientHeight;
    for (const s of state.spots) {
      pv.copy(s.p).project(camera);
      toCam.copy(camera.position).sub(s.p);
      const visible = s.n.dot(toCam) > 0 && pv.z < 1 && Math.abs(pv.x) < 1.02 && Math.abs(pv.y) < 1.02;
      s.el.style.transform = `translate(${(((pv.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - pv.y) / 2) * h).toFixed(1)}px)`;
      s.el.toggleAttribute('data-hidden', !visible);
    }
  }

  // ---------- цикл ----------
  const clock = new THREE.Clock();
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  function tick() {
    state.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    state.time += dt;

    if (state.tod !== state.todTarget) {
      const d = state.todTarget - state.tod;
      state.tod += Math.sign(d) * Math.min(Math.abs(d), dt * (reducedMotion ? 20 : 1.25));
      applyTime(state.tod);
      if (Math.abs(state.tod - envAt) > 0.3 || state.tod === state.todTarget) updateEnv();
    }

    if (state.fly) {
      const f = state.fly;
      f.t += dt;
      const k = ease(Math.min(1, f.t / f.dur));
      controls.target.lerpVectors(f.fromT, f.toT, k);
      camera.position.lerpVectors(f.fromP, f.toP, k);
      if (k >= 1) { state.fly = null; controls.enabled = true; }
    }
    controls.update(dt);
    clampCamera();
    state.obj?.update(dt, state.time);
    effects.update(dt, state.time);
    projectSpots();
    renderer.render(scene, camera);
  }

  async function setHouse(house, index = 0, { keepView = false } = {}) {
    const token = ++state.token;
    let obj = null;
    if (house.model3d?.src) {
      try {
        const { loadModelHouse } = await import('./model.js');
        obj = await loadModelHouse(house);
      } catch (err) {
        // файл модели не найден или битый — показываем нарисованный домик, а не пустую поляну
        console.warn(`3D-модель ${house.model3d.src} не загрузилась, показываем иллюстрацию`, err);
      }
    }
    obj ??= buildCabin(house, T, index);
    if (token !== state.token) { obj.dispose(); return null; }
    // точки с координатами из site.json — и для модели, и для процедурного домика
    (house.model3d?.hotspots ?? []).forEach((h, i) => {
      const id = h.anchor ?? `hs${i}`;
      if (Array.isArray(h.position) && !obj.anchors.has(id)) {
        const p = V(...h.position);
        const n = Array.isArray(h.normal) ? V(...h.normal).normalize() : V(p.x, 0.35, p.z).normalize();
        obj.anchors.set(id, { p, n });
      }
    });
    if (state.obj) { scene.remove(state.obj.group); state.obj.dispose(); }
    state.obj = obj;
    state.house = house;
    scene.add(obj.group);
    nature.layout(obj.clear);
    effects.setSources(obj.smokeAt, obj.fireAt);
    applySeason();
    if (!keepView) flyTo(defaultView(obj), 0);
    if (!scene.environment) updateEnv();
    return obj;
  }

  return {
    canvas,
    get season() { return state.season; },
    get anchors() { return state.obj?.anchors ?? new Map(); },
    setHouse,
    setSeason(s) { if (SEASONS[s] && s !== state.season) { state.season = s; applySeason(); } },
    /** 0 — день, 1 — закат, 2 — ночь. */
    setTime(i, instant = false) {
      state.todTarget = clamp(i, 0, 2);
      if (instant) { state.tod = state.todTarget; applyTime(state.tod); updateEnv(); }
    },
    setSpots(list) { state.spots = list; },
    onInteract(fn) { listeners.add(fn); },
    resetView() { if (state.obj) flyTo(defaultView(state.obj)); },
    focus(id) {
      const a = state.obj?.anchors.get(id);
      if (!a) return;
      const side = V(a.n.x, 0, a.n.z);
      if (side.lengthSq() < 0.01) side.set(0, 0, 1);
      side.normalize();
      const pos = a.p.clone().addScaledVector(side, 4.2).add(V(0, 1 + Math.max(0, a.n.y) * 1.6, 0));
      flyTo({ target: a.p.clone(), pos });
    },
    orbitBy(dTheta, dPhi = 0) {
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta += dTheta;
      sph.phi = clamp(sph.phi + dPhi, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(off.setFromSpherical(sph));
      controls.autoRotate = false;
    },
    zoomBy(f) {
      const off = camera.position.clone().sub(controls.target);
      const len = clamp(off.length() * f, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(off.setLength(len));
      controls.autoRotate = false;
    },
    start() {
      if (state.running) return;
      state.running = true;
      clock.getDelta();
      tick();
    },
    stop() {
      state.running = false;
      cancelAnimationFrame(state.raf);
    },
    /** Картинка домика для карточки: { url: JPEG data URL, kind } — тем же движком, что и 3D. */
    async snapshot(house, index, { width = 640, height = 400 } = {}) {
      const obj = await setHouse(house, index);
      if (!obj) return null;
      const prevPR = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      fitFov(camera.aspect);
      camera.updateProjectionMatrix();
      const view = defaultView(obj);
      camera.position.copy(view.pos);
      camera.lookAt(view.target);
      effects.update(0.016, 4);
      obj.update(0.016, 4);
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/jpeg', 0.86);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
      resize();
      return { url, kind: obj.kind };
    },
    /** Режим настройки (?debug3d): координаты точки модели под курсором. */
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([state.obj?.group, nature.ground].filter(Boolean), true)[0];
      return hit ? hit.point.toArray().map((v) => Math.round(v * 100) / 100) : null;
    },
    dispose() {
      this.stop();
      ro.disconnect();
      controls.dispose();
      state.obj?.dispose();
      nature.dispose();
      effects.dispose();
      envRT?.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
