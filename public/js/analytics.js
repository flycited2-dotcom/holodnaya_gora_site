// Яндекс.Метрика подключается только если на сервере задан METRIKA_ID (см. .env.example).
// Загрузка идёт из внешнего файла, а не inline-скриптом — так работает строгая Content-Security-Policy.

export function initAnalytics(id) {
  if (!id || window.ym) return;
  window.ym = function ym(...args) { (window.ym.a = window.ym.a || []).push(args); };
  window.ym.l = Date.now();
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.append(s);
  window.ym(Number(id), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}
