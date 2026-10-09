// Клиент серверного API.

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
  } catch {
    throw Object.assign(new Error('Нет связи с сервером. Проверьте интернет или позвоните нам.'), { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error ?? 'Не удалось выполнить запрос'), {
      status: res.status, errors: data?.errors ?? null,
    });
  }
  return data;
}

const send = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  content: () => request('/api/content'),
  availability: () => request('/api/availability'),
  createBooking: (body) => send('/api/bookings', body),
  createRequest: (body) => send('/api/requests', body),
  scores: () => request('/api/scores'),
  submitScore: (body) => send('/api/scores', body),
};
