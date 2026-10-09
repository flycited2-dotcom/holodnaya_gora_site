// Уведомления владельцу в Telegram. Если токен не задан — тихо пишем в консоль,
// заявка при этом всё равно сохранена и видна в /admin.

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const ruDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const rub = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;

export function createNotifier({ token, chatId, siteUrl }) {
  async function send(text) {
    if (!token || !chatId) {
      console.log('[notify:console]\n' + text.replace(/<[^>]+>/g, ''));
      return false;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.error('[notify] Telegram ответил', res.status, (await res.text()).slice(0, 200));
        return false;
      }
      return true;
    } catch (err) {
      console.error('[notify] не удалось отправить:', err.message);
      return false;
    }
  }

  const adminLink = siteUrl ? `\n<a href="${esc(siteUrl)}/admin">Открыть админку</a>` : '';

  return {
    send,
    booking(b, house) {
      return send(
        `🏡 <b>Новая бронь ${esc(b.id)}</b>\n`
        + `${esc(house?.name ?? b.houseId)}\n`
        + `Заезд ${ruDate(b.checkIn)} → выезд ${ruDate(b.checkOut)} (${b.nights} ноч.)\n`
        + `Гостей: ${b.guests} · Сумма: ${rub(b.total)}\n`
        + `👤 ${esc(b.name)} · ${esc(b.phone)}`
        + (b.comment ? `\n💬 ${esc(b.comment)}` : '')
        + adminLink,
      );
    },
    request(r, label) {
      const icon = { shooting: '🎯', event: '📅', question: '❓' }[r.type] ?? '✉️';
      return send(
        `${icon} <b>${esc(label)} ${esc(r.id)}</b>\n`
        + `👤 ${esc(r.name)} · ${esc(r.phone)}\n`
        + (r.date ? `Дата: ${ruDate(r.date)}\n` : '')
        + `Человек: ${r.people}`
        + (r.eventId ? `\nМероприятие: ${esc(r.eventTitle ?? r.eventId)}` : '')
        + (r.packageId ? `\nПакет: ${esc(r.packageTitle ?? r.packageId)}` : '')
        + (r.comment ? `\n💬 ${esc(r.comment)}` : '')
        + adminLink,
      );
    },
  };
}
