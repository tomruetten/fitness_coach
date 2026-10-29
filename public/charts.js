// Diagramme mit Achsen, Gitter und Normbereichen. Alles in Prozent, damit es auf jeder Breite passt.
import { esc } from './util.js';

export const ZONE_COLORS = ['#A9C9FF', '#34C759', '#FFCC00', '#FF9500', '#FF3B30'];
const H = 150;
const has = (v) => v != null && !Number.isNaN(v);

/** Rundet einen Maximalwert auf eine schöne Achse mit höchstens 4 Teilen. */
export function barAxis(max) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  const m = Math.max(max || 0, 1);
  const step = steps.find((s) => m / s <= 4) || 1000;
  const top = Math.ceil(m / step) * step;
  return { min: 0, max: top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

/** Achse um Messwerte herum, auf Vielfache von `step` gerundet (mindestens 3 Teile). */
export function lineAxis(vals, step) {
  const v = vals.filter(has);
  if (!v.length) return { min: 0, max: step * 3, ticks: [0, step, step * 2, step * 3] };
  let lo = Math.floor((Math.min(...v) - step * 0.4) / step) * step;
  let hi = Math.ceil((Math.max(...v) + step * 0.4) / step) * step;
  if (hi - lo < step * 3) hi = lo + step * 3;
  let s = step;
  while ((hi - lo) / s > 6) s *= 2;
  hi = lo + Math.ceil((hi - lo) / s) * s;
  const ticks = []; for (let t = lo; t <= hi + 1e-9; t += s) ticks.push(Math.round(t * 100) / 100);
  return { min: lo, max: hi, ticks };
}

export function meanSd(vals) {
  const v = vals.filter(has);
  if (v.length < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return [m - sd, m + sd];
}

/**
 * o: {title, type:'bars'|'stack'|'line', labels, vals, min, max, ticks, fmt, color, invert, band, ref:{v,c,t},
 *     legend:[{t,c}], big, unit, note, hint}
 */
export function chartCard(o) {
  const n = o.labels.length;
  const cx = (i) => ((i + 0.5) / n) * 100;
  const topPct = (v) => { const t = (v - o.min) / (o.max - o.min); return (o.invert ? t : 1 - t) * 100; };
  const data = o.type === 'stack' ? o.vals.some(Boolean) : o.vals.some((v) => has(v) && (o.type === 'line' || v > 0));

  let html = `<section class="ccard"><div class="chead"><div><h2>${esc(o.title)}</h2><div class="big">${esc(o.big ?? '–')}<span>${o.unit ? ' ' + esc(o.unit) : ''}</span></div></div><span class="note">${esc(o.note || '')}</span></div>`;

  if (!data) {
    html += `<div class="empty">Noch keine Daten in diesem Zeitraum.</div>`;
  } else {
    let plot = '';
    o.ticks.forEach((t) => {
      const p = topPct(t);
      const base = (!o.invert && t === o.min) || (o.invert && t === o.max);
      plot += `<div class="grid${base ? ' base' : ''}" style="top:${p.toFixed(2)}%"></div><div class="yl" style="top:${p.toFixed(2)}%">${esc(o.fmt(t))}</div>`;
    });
    if (o.band) {
      const a = topPct(o.band[0]), b = topPct(o.band[1]);
      plot += `<div class="band" style="top:${Math.min(a, b).toFixed(2)}%;height:${Math.abs(a - b).toFixed(2)}%"></div>`;
    }
    if (o.type === 'bars') {
      const w = (100 / n) * 0.58;
      o.vals.forEach((v, i) => { if (v > 0) plot += `<div class="bar" style="left:${(cx(i) - w / 2).toFixed(2)}%;width:${w.toFixed(2)}%;height:${Math.max(1.5, (v / o.max) * 100).toFixed(2)}%;background:${o.color}"></div>`; });
    } else if (o.type === 'stack') {
      const w = (100 / n) * 0.58;
      o.vals.forEach((s, i) => { if (s) plot += `<div class="stack" style="left:${(cx(i) - w / 2).toFixed(2)}%;width:${w.toFixed(2)}%">${s.map((p, k) => `<i style="height:${p}%;background:${ZONE_COLORS[k]}"></i>`).join('')}</div>`; });
    } else {
      const pts = [];
      o.vals.forEach((v, i) => { if (has(v)) pts.push([cx(i), Math.min(100, Math.max(0, topPct(v)))]); });
      if (pts.length > 1) plot += `<svg class="trace" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ')}" fill="none" stroke="${o.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
      pts.forEach((p) => { plot += `<i class="dot" style="left:${p[0].toFixed(2)}%;top:${p[1].toFixed(2)}%;border-color:${o.color}"></i>`; });
    }
    if (o.ref) {
      const t = topPct(o.ref.v);
      plot += `<div class="ref" style="top:${t.toFixed(2)}%;border-color:${o.ref.c}"></div><div class="reflabel" style="top:${t.toFixed(2)}%;color:${o.ref.c}">${esc(o.ref.t)}</div>`;
    }
    const tipOf = (i) => {
      const nm = o.names?.[i] || o.labels[i];
      if (o.type === 'stack') return o.vals[i] ? `${nm}<br>${o.vals[i].map((p, k) => (p ? `Z${k + 1} ${p} %` : '')).filter(Boolean).join(' · ')}` : null;
      const v = o.vals[i];
      if (!has(v) || (o.type === 'bars' && !(v > 0))) return null;
      return `${nm}<br><b>${(o.tipFmt || o.fmt)(v)}${o.unit ? ' ' + o.unit : ''}</b>`;
    };
    o.labels.forEach((l, i) => {
      const tip = tipOf(i);
      if (tip == null) return;
      const top = o.type === 'stack' ? 0 : o.type === 'bars' ? Math.min(100, topPct(o.vals[i])) : Math.min(100, Math.max(0, topPct(o.vals[i])));
      plot += `<button type="button" class="hit" data-x="${cx(i).toFixed(2)}" data-top="${top.toFixed(2)}" data-tip="${esc(tip)}" aria-label="${esc(tip.replace(/<[^>]+>/g, ' '))}" style="left:${(cx(i) - 50 / n).toFixed(2)}%;width:${(100 / n).toFixed(2)}%"></button>`;
    });
    o.labels.forEach((l, i) => { plot += `<div class="xl" style="left:${cx(i).toFixed(2)}%">${esc(l)}</div>`; });
    html += `<div class="plot" style="height:${H}px" role="img" aria-label="${esc(o.title)}">${plot}</div>`;
  }
  if (o.legend?.length) html += `<div class="legend">${o.legend.map((l) => `<span><i style="background:${l.c}"></i>${esc(l.t)}</span>`).join('')}</div>`;
  if (o.hint) html += `<p class="hint">${esc(o.hint)}</p>`;
  return html + '</section>';
}

/** Antippen eines Datenpunkts zeigt den genauen Wert. */
export function wireCharts(root) {
  root.addEventListener('click', (ev) => {
    const hit = ev.target.closest?.('.hit');
    const plots = root.querySelectorAll('.plot');
    const clear = (p) => p.querySelectorAll('.tip,.vline').forEach((x) => x.remove());
    if (!hit) { plots.forEach(clear); return; }
    const plot = hit.closest('.plot');
    const same = plot.querySelector('.tip')?.dataset.x === hit.dataset.x;
    plots.forEach(clear);
    if (same) return;
    const x = Number(hit.dataset.x), top = Number(hit.dataset.top);
    const line = document.createElement('div'); line.className = 'vline'; line.style.left = x + '%';
    const tip = document.createElement('div'); tip.className = 'tip' + (x < 22 ? ' l' : x > 78 ? ' r' : ''); tip.dataset.x = hit.dataset.x;
    tip.style.left = x + '%'; tip.style.top = `calc(${top}% - 10px)`; tip.innerHTML = hit.dataset.tip;
    if (top < 28) { tip.classList.add('below'); tip.style.top = `calc(${top}% + 12px)`; }
    plot.append(line, tip);
  });
}
