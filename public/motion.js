// Sanfte Zustände: Zahlen zählen hoch, Ringe füllen sich. Wiederholte Zeichnungen derselben Ansicht
// (zwischengespeicherter Stand, dann frische Daten) werden nicht erneut animiert.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const seen = new Map();

/** true, wenn die Ansicht `key` jetzt animiert erscheinen soll (höchstens alle 30 Sekunden). */
export function fresh(key, ms = 30000) {
  const now = Date.now();
  const ok = !reduce && now - (seen.get(key) || 0) > ms;
  if (ok) seen.set(key, now);
  return ok;
}

const ease = (t) => 1 - (1 - t) ** 3;

export function countUp(root, on) {
  if (!on) return;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count), d = Number(el.dataset.dec || 0);
    if (!Number.isFinite(to)) return;
    const fmt = (v) => v.toFixed(d).replace('.', ',');
    const t0 = performance.now(), dur = 800;
    el.textContent = fmt(0);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(to * ease(k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export function rings(root, on) {
  root.querySelectorAll('circle[data-p]').forEach((c) => {
    const C = 2 * Math.PI * Number(c.getAttribute('r')), p = Math.min(1, Math.max(0, Number(c.dataset.p) || 0));
    c.style.strokeDasharray = C;
    if (!on) { c.style.strokeDashoffset = C * (1 - p); return; }
    c.style.transition = 'none'; c.style.strokeDashoffset = C;
    requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transition = 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)'; c.style.strokeDashoffset = C * (1 - p); }));
  });
}

/** Alles auf einmal: Klasse für CSS-Zeichenanimationen, Zahlen und Ringe. */
export function play(root, key) {
  const on = fresh(key);
  root.classList.toggle('draw', on);
  countUp(root, on);
  rings(root, on);
  return on;
}
