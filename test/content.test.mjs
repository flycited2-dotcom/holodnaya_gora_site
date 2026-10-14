import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContent } from '../server/content.mjs';

const real = () => JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url), 'utf8'));

test('реальный content/site.json проходит проверку', () => {
  assert.deepEqual(validateContent(real()), []);
});

test('опечатки владельца находятся и объясняются понятно', () => {
  const c = real();
  c.houses[1].id = c.houses[0].id;            // повторный id
  c.houses[0].pricePerNight = '6000';          // цена строкой
  c.events[0].date = '2026-02-30';             // несуществующая дата
  c.events[1].category = 'nope';               // нет такой категории
  c.contacts.phoneHref = '+7 (978) 000-00-00'; // формат не для tel:
  c.booking.timezone = 'Mars/Olympus';
  const problems = validateContent(c).join('\n');
  assert.match(problems, /повторяется/);
  assert.match(problems, /pricePerNight/);
  assert.match(problems, /events\[0\]\.date/);
  assert.match(problems, /нет такой категории/);
  assert.match(problems, /phoneHref/);
  assert.match(problems, /timezone/);
});

test('3D-модель домика: правильные настройки проходят, ошибки объясняются', () => {
  const ok = real();
  ok.houses[0].model3d = {
    src: '/models/les.glb', kind: 'scan', scale: 1, rotationY: 90, chimney: [1.5, 5.2, -1],
    hotspots: [{ anchor: 'terrace', title: 'Терраса', text: 'Вид на лес' }, { position: [0, 1.5, 3], title: 'Окно' }],
  };
  ok.houses[1].model3d = { hotspots: [{ anchor: 'mangal', title: 'Мангал' }] }; // только тексты подсказок
  ok.houses[2].model3d = null;
  assert.deepEqual(validateContent(ok), []);

  const c = real();
  c.houses[0].model3d = {
    src: '../secret.glb', kind: 'photo', scale: -1, chimney: [1, 2],
    hotspots: [{ text: 'без заголовка и без места' }, { title: 'x', position: [1, 'a', 3] }],
  };
  c.houses[1].model3d = 'les.glb';
  const problems = validateContent(c).join('\n');
  assert.match(problems, /model3d\.src/);
  assert.match(problems, /model3d\.kind/);
  assert.match(problems, /model3d\.scale/);
  assert.match(problems, /model3d\.chimney/);
  assert.match(problems, /hotspots\[0\]\.title/);
  assert.match(problems, /hotspots\[0\]: нужна position/);
  assert.match(problems, /hotspots\[1\]\.position/);
  assert.match(problems, /houses\[1\]\.model3d: объект/);
});

test('пустые и неверные структуры не роняют проверку', () => {
  assert.ok(validateContent(null).length > 0);
  assert.ok(validateContent({}).length > 0);
  assert.ok(validateContent([]).length > 0);
});
