// Загрузка настоящей 3D-модели домика (GLB/GLTF): скан с телефона (Polycam, Luma, Scaniverse — экспорт в GLB)
// или купленная/заказанная модель. Отдаёт тот же «объект домика», что и процедурный cabin.js.
//
// Настройка — в content/site.json, у домика поле model3d (подробно — в README, раздел «3D-домики»).

import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GLOW_DEFAULT = /glass|window|стекл|окн/i;

const vec = (a) => (Array.isArray(a) && a.length === 3 ? V(a[0], a[1], a[2]) : null);

export async function loadModelHouse(house) {
  const cfg = house.model3d;
  const gltf = await new GLTFLoader().loadAsync(cfg.src);
  const root = gltf.scene;
  const holder = new THREE.Group();
  holder.add(root);

  // поворот, масштаб и установка на землю в центр поляны
  root.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY ?? 0);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(V(0, 0, 0));
  const maxSide = Math.max(size.x, size.z) || 1;
  // без явного scale подгоняем явно «не метровые» модели (сантиметры, миллиметры) под ~9 м
  const scale = cfg.scale ?? (maxSide > 60 || maxSide < 1.5 ? 9 / maxSide : 1);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const center = box.getCenter(V(0, 0, 0));
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  const off = vec(cfg.offset);
  if (off) root.position.add(off);
  holder.updateMatrixWorld(true);
  box.setFromObject(holder);

  // тени и «окна», которые ночью светятся
  const glowRe = Array.isArray(cfg.glow) && cfg.glow.length
    ? new RegExp(cfg.glow.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
    : GLOW_DEFAULT;
  const glowMats = new Set();
  holder.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (m && 'emissive' in m && (glowRe.test(m.name ?? '') || glowRe.test(o.name ?? ''))) {
        m.emissive = new THREE.Color('#ffb469');
        glowMats.add(m);
      }
    });
  });

  // точки подсказок: имя узла модели (например, пустышка «terrace», сделанная в Blender) или координаты
  const anchors = new Map();
  const outward = (p) => {
    const n = V(p.x, 0.35, p.z);
    return n.lengthSq() < 0.2 ? V(0, 0.4, 1) : n.normalize();
  };
  (cfg.hotspots ?? []).forEach((h, i) => {
    let p = vec(h.position);
    if (!p && h.anchor) {
      const node = holder.getObjectByName(h.anchor);
      if (node) p = node.getWorldPosition(V(0, 0, 0));
    }
    if (!p) return;
    anchors.set(h.anchor ?? `hs${i}`, { p, n: vec(h.normal)?.normalize() ?? outward(p) });
  });

  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  let warm = 0;
  return {
    kind: 'model',
    group: holder,
    anchors,
    smokeAt: vec(cfg.chimney),
    fireAt: vec(cfg.fire),
    focus: { target: V(0, Math.min(2, (box.max.y - box.min.y) * 0.4), 0), radius: Math.hypot(w / 2, d / 2) },
    clear: [{ x0: box.min.x - 0.8, x1: box.max.x + 0.8, z0: box.min.z - 0.8, z1: box.max.z + 0.8 }],
    setSeason() {},
    setWarm(v) { warm = v; for (const m of glowMats) m.emissiveIntensity = warm * 1.6; },
    update() {},
    dispose() {
      holder.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const v of Object.values(m ?? {})) if (v?.isTexture) v.dispose();
          m?.dispose();
        }
      });
    },
  };
}
