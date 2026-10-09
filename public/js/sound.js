// Звук игры синтезируется на лету через WebAudio — ни одного аудиофайла не нужно.
// Контекст создаётся только после первого жеста пользователя (требование браузеров).

import { storage } from './util.js';

let ctx = null;
let master = null;
let noise = null;
let muted = storage.get('hg_muted', false) === true;

export const isMuted = () => muted;
export function setMuted(value) {
  muted = !!value;
  storage.set('hg_muted', muted);
}

function ensure() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const len = ctx.sampleRate; // 1 секунда белого шума
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function burst({ type, from, to, dur, gain, q = 0.8 }) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone({ type = 'sine', from, to, dur, gain, delay = 0 }) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Выстрел: треск + низкий удар. */
export function playShot() {
  burst({ type: 'lowpass', from: 5200, to: 260, dur: 0.32, gain: 0.9, q: 0.7 });
  tone({ type: 'sine', from: 150, to: 40, dur: 0.22, gain: 0.9 });
}

/** Попадание: сухой «хруст» разлетающейся тарелки. */
export function playHit() {
  burst({ type: 'highpass', from: 3000, to: 6000, dur: 0.12, gain: 0.5, q: 0.5 });
  tone({ type: 'triangle', from: 1100, to: 520, dur: 0.12, gain: 0.12 });
}

export function playMiss() {
  burst({ type: 'bandpass', from: 900, to: 300, dur: 0.18, gain: 0.07, q: 1.2 });
}

export function playClick() {
  tone({ type: 'square', from: 520, to: 520, dur: 0.04, gain: 0.04 });
}

/** Финал раунда: короткая мелодия, чем лучше результат, тем длиннее. */
export function playFinish(great) {
  const notes = great ? [523, 659, 784, 1047] : [392, 440];
  notes.forEach((f, i) => tone({ type: 'triangle', from: f, to: f * 0.998, dur: 0.22, gain: 0.16, delay: i * 0.11 }));
}
