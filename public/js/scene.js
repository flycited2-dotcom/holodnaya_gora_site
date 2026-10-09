// Процедурная «лесная» сцена: небо, горы, туман, сосны. Рисуется на canvas слоями,
// поэтому в hero слои двигаются с разной скоростью (параллакс), а в игре сливаются в один фон.
// Фото не нужны — и нельзя выдавать выдуманные картинки за настоящую базу.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Гладкий одномерный шум из нескольких октав (для линии гор). */
function makeNoise(rand) {
  const grid = Array.from({ length: 256 }, () => rand());
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x) => {
    const i = Math.floor(x);
    const f = smooth(x - i);
    return grid[i & 255] * (1 - f) + grid[(i + 1) & 255] * f;
  };
  return (x, octaves = 4) => {
    let sum = 0; let amp = 1; let norm = 0; let freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += at(x * freq) * amp; norm += amp; amp *= 0.5; freq *= 2.1;
    }
    return sum / norm;
  };
}

function layerCanvas(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  return { canvas: c, ctx };
}

function pine(ctx, x, baseY, height, width, color, rand) {
  const tiers = 4 + Math.floor(rand() * 2);
  ctx.fillStyle = color;
  // ствол
  ctx.fillRect(x - width * 0.04, baseY - height * 0.12, width * 0.08, height * 0.14);
  // ярусы лапника: каждый следующий шире предыдущего и частично перекрывает его
  for (let i = 0; i < tiers; i++) {
    const y0 = baseY - height + (height * 0.8 * i) / tiers;
    const y1 = Math.min(y0 + height * (0.34 + 0.02 * i), baseY - height * 0.06);
    const tierW = width * (0.36 + 0.64 * ((i + 1) / tiers));
    const jitter = (rand() - 0.5) * width * 0.03;
    ctx.beginPath();
    ctx.moveTo(x + jitter, y0);
    ctx.lineTo(x + tierW / 2, y1);
    ctx.lineTo(x - tierW / 2, y1);
    ctx.closePath();
    ctx.fill();
  }
}

function ridgePath(ctx, w, base, amp, noise, scale, offset) {
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let x = 0; x <= w; x += 4) {
    const n = noise(x * scale + offset, 5);
    ctx.lineTo(x, base - (n - 0.4) * amp * 2);
  }
  ctx.lineTo(w, base + amp * 6);
  ctx.lineTo(0, base + amp * 6);
  ctx.closePath();
}

/**
 * Возвращает слои сцены от дальнего к ближнему.
 * depth — коэффициент параллакса (0 — неподвижно).
 */
export function buildScene(w, h, dpr = 1, seed = 11) {
  const rand = rng(seed);
  const noise = makeNoise(rand);
  const layers = [];

  // 1. Небо, звёзды, закат
  {
    const { canvas, ctx } = layerCanvas(w, h, dpr);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#031017');
    sky.addColorStop(0.3, '#0a2d36');
    sky.addColorStop(0.5, '#1f5a58');
    sky.addColorStop(0.64, '#b86a3a');
    sky.addColorStop(0.8, '#f08a3c');
    sky.addColorStop(1, '#f08a3c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < Math.round(w / 12); i++) {
      const y = rand() * h * 0.5;
      ctx.fillStyle = `rgba(255,244,220,${(0.15 + rand() * 0.55) * (1 - y / (h * 0.55))})`;
      ctx.beginPath();
      ctx.arc(rand() * w, y, 0.4 + rand() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    const sx = w * 0.72; const sy = h * 0.58; const sr = Math.min(w, h) * 0.075;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.5);
    glow.addColorStop(0, 'rgba(255,170,80,0.55)');
    glow.addColorStop(0.25, 'rgba(255,120,50,0.22)');
    glow.addColorStop(1, 'rgba(255,100,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const disc = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr);
    disc.addColorStop(0, '#fff2cf');
    disc.addColorStop(1, '#ffb25a');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    layers.push({ canvas, depth: 0 });
  }

  // 2. Дальние горы
  {
    const { canvas, ctx } = layerCanvas(w, h, dpr);
    const off = rand() * 100;
    ridgePath(ctx, w, h * 0.6, h * 0.11, noise, 0.0032, off);
    const g = ctx.createLinearGradient(0, h * 0.4, 0, h * 0.75);
    g.addColorStop(0, '#2c5f63'); g.addColorStop(1, '#4a8076');
    ctx.fillStyle = g; ctx.fill();
    ridgePath(ctx, w, h * 0.67, h * 0.085, noise, 0.0045, off + 31);
    const g2 = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.8);
    g2.addColorStop(0, '#1d4a4c'); g2.addColorStop(1, '#2f6560');
    ctx.fillStyle = g2; ctx.fill();
    layers.push({ canvas, depth: 0.012 });
  }

  // 3. Средний гребень с мелким лесом и туманом
  {
    const { canvas, ctx } = layerCanvas(w, h, dpr);
    const off = rand() * 100;
    const base = h * 0.74; const amp = h * 0.06;
    ridgePath(ctx, w, base, amp, noise, 0.006, off);
    ctx.fillStyle = '#123a36'; ctx.fill();
    const color = '#0d2f2c';
    for (let x = -10; x < w + 10; x += 9 + rand() * 9) {
      const ridgeY = base - (noise(x * 0.006 + off, 5) - 0.4) * amp * 2;
      pine(ctx, x, ridgeY + 4, h * (0.045 + rand() * 0.04), h * 0.03, color, rand);
    }
    const mist = ctx.createLinearGradient(0, base - amp * 1.5, 0, base + amp * 2.2);
    mist.addColorStop(0, 'rgba(180,215,200,0)');
    mist.addColorStop(0.7, 'rgba(120,170,160,0.28)');
    mist.addColorStop(1, 'rgba(18,58,54,0.0)');
    ctx.fillStyle = mist; ctx.fillRect(0, base - amp * 1.5, w, amp * 4);
    layers.push({ canvas, depth: 0.028 });
  }

  // 4. Ближний лес
  {
    const { canvas, ctx } = layerCanvas(w, h, dpr);
    const ground = h * 0.88;
    const gr = ctx.createLinearGradient(0, ground - h * 0.06, 0, h);
    gr.addColorStop(0, '#07201b'); gr.addColorStop(1, '#03100d');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, ground);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, ground - noise(x * 0.01 + 5, 3) * h * 0.04);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

    const color = '#051a15';
    const edge = (x) => Math.min(x, w - x) / (w * 0.5); // 0 у края, 1 в центре
    for (let x = -20; x < w + 20; x += 20 + rand() * 40) {
      const e = edge(Math.max(0, Math.min(w, x)));
      const height = h * (0.1 + rand() * 0.1 + (1 - e) * 0.28);
      pine(ctx, x, ground + h * 0.02, height, height * 0.5, color, rand);
    }
    // лёгкий «воздух» снизу
    const haze = ctx.createLinearGradient(0, h * 0.6, 0, ground);
    haze.addColorStop(0, 'rgba(20,70,64,0)'); haze.addColorStop(1, 'rgba(20,70,64,0.22)');
    ctx.fillStyle = haze; ctx.fillRect(0, h * 0.6, w, h * 0.4);
    layers.push({ canvas, depth: 0.055 });
  }

  return {
    layers,
    /** Склеить все слои в один canvas-контекст (для фона игры). */
    composite(target, tw, th) {
      for (const { canvas } of layers) target.drawImage(canvas, 0, 0, tw, th);
    },
  };
}

/**
 * Рисует тарелку-мишень.
 * r — половина ширины; spin — угол кувыркания (рад), от него зависит «раскрытие» эллипса.
 */
export function drawClay(ctx, x, y, r, spin = 0, alpha = 1) {
  const ry = r * (0.2 + 0.2 * Math.abs(Math.sin(spin)));
  const tilt = Math.sin(spin * 0.5) * 0.18;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(tilt);

  // тень снизу (толщина диска)
  ctx.fillStyle = '#9c3407';
  ctx.beginPath(); ctx.ellipse(0, ry * 0.5, r, ry, 0, 0, Math.PI * 2); ctx.fill();

  // верхняя поверхность
  const g = ctx.createRadialGradient(-r * 0.3, -ry * 0.5, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ffc27d'); g.addColorStop(0.55, '#ff6a1a'); g.addColorStop(1, '#d9480f');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2); ctx.fill();

  // купол
  ctx.fillStyle = 'rgba(255,214,160,0.55)';
  ctx.beginPath(); ctx.ellipse(-r * 0.05, -ry * 0.18, r * 0.5, ry * 0.5, 0, 0, Math.PI * 2); ctx.fill();

  // блик по верхнему краю
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.96, ry * 0.94, 0, Math.PI * 1.12, Math.PI * 1.7); ctx.stroke();
  ctx.restore();
}

export { rng };
