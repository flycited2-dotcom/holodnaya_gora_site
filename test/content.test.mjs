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

test('пустые и неверные структуры не роняют проверку', () => {
  assert.ok(validateContent(null).length > 0);
  assert.ok(validateContent({}).length > 0);
  assert.ok(validateContent([]).length > 0);
});
