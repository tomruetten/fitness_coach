export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');
export const hm = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`; };
export const dmy = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.';
export const dec = (v, n = 1) => (v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toFixed(n).replace('.', ','));
export const kg = (v) => (v == null ? '–' : String(Math.round(v * 10) / 10).replace('.', ','));
export const SPORT = { running: 'Laufen', cycling: 'Rad', strength: 'Kraft', swimming: 'Schwimmen', tennis: 'Tennis', other: 'Sonstiges' };

export function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

export async function api(path, body) {
  const opt = body === undefined ? { headers: { 'X-Requested-With': 'fit' } } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fit' }, body: JSON.stringify(body) };
  const r = await fetch('/api' + path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
  return j;
}

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* privater Modus */ } },
};

/** Zeigt zuerst den zwischengespeicherten Stand und aktualisiert danach. `draw(data, offline)`. */
export async function swr(key, path, draw, isCurrent = () => true) {
  const shown = store.get(key);
  if (shown) draw(shown, false);
  try {
    const d = await api(path);
    store.set(key, d);
    if (isCurrent() && JSON.stringify(d) !== JSON.stringify(shown)) draw(d, false);
    return d;
  } catch (e) {
    if (e.auth) throw e;
    if (!shown) throw e;
    if (isCurrent()) draw(shown, true);
    return shown;
  }
}

export const icon = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  checkCircle: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="erledigt"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
  grip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>',
  spark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};
