// Хранилище на одном JSON-файле. Для базы отдыха (десятки заявок в месяц) этого достаточно,
// и не нужно поднимать СУБД. Все изменения идут через transact() — они выполняются строго по очереди,
// поэтому проверка пересечений дат и запись брони не могут «разъехаться».

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomInt } from 'node:crypto';

const EMPTY = () => ({ bookings: [], requests: [], scores: [] });

// без похожих символов (0/O, 1/I/L), чтобы код брони удобно диктовать по телефону
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode(prefix, taken = new Set()) {
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const code = `${prefix}-${s}`;
    if (!taken.has(code)) return code;
  }
}

export function createStore(file) {
  mkdirSync(dirname(file), { recursive: true });

  let state = EMPTY();
  if (existsSync(file)) {
    try {
      state = { ...EMPTY(), ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (err) {
      // повреждённый файл не затираем молча — оставляем копию и стартуем с чистого
      throw new Error(`Не удалось прочитать ${file}: ${err.message}. Исправьте или переименуйте файл.`);
    }
  }

  let chain = Promise.resolve();
  let tmpCounter = 0;

  async function persist() {
    const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, file);
  }

  return {
    /** Только чтение. Возвращённый объект менять нельзя. */
    snapshot: () => state,

    /** fn(state) выполняется синхронно и атомарно; после неё состояние сохраняется на диск. */
    transact(fn) {
      const run = chain.then(async () => {
        const result = fn(state);
        await persist();
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
