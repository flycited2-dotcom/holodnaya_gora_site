// Простой ограничитель частоты запросов в памяти процесса (скользящее окно).

export function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> массив временных меток

  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, list] of hits) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, Math.max(windowMs, 60_000));
  timer.unref();

  return {
    /** true — запрос разрешён и засчитан; false — лимит исчерпан. */
    take(key) {
      const now = Date.now();
      const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
    /** Сколько попыток осталось, не засчитывая новую. */
    peek(key) {
      const now = Date.now();
      const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      return Math.max(0, max - list.length);
    },
  };
}
