// Diagramme mit Achsen, Gitter und Normbereichen. Alles in Prozent, damit es auf jeder Breite passt.
import { esc } from './util.js';

export const ZONE_COLORS = ['#A9C9FF', '#34C759', '#FFCC00', '#FF9500', '#FF3B30'];
const H = 150;

/** Fortschrittsring; `center` ist beliebiges HTML in der Mitte. Die Füllung setzt motion.js. */
export function ringHtml({ p, color, size = 112, sw = 10, center = '' }) {
  const r = (size - sw) / 2, c = size / 2, C = 2 * Math.PI * r;
  return `<div class="rg" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(120,120,128,.16)" stroke-width="${sw}"/><circle data-p="${Math.min(1, Math.max(0, p))}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" transform="rotate(-90 ${c} ${c})" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - Math.min(1, Math.max(0, p)))).toFixed(1)}"/></svg><div class="rc">${center}</div></div>`;
}

/** Mini-Verlauf ohne Achsen für Kennzahlen. */
export function spark(vals, color, bars = false) {
  const pts = (vals || []).map((v, i) => [i, v]).filter(([, v]) => has(v));
  if (pts.length < 2) return '';
  const n = vals.length, lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), span = hi - lo || 1;
  const X = (i) => (n === 1 ? 50 : 3 + (i / (n - 1)) * 94), Y = (v) => 26 - ((v - lo) / span) * 22;
  if (bars) {
    const w = 94 / n * 0.6;
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">${vals.map((v, i) => (has(v) && v > 0 ? `<rect x="${(X(i) - w / 2).toFixed(1)}" y="${(28 - (v / (hi || 1)) * 24).toFixed(1)}" width="${w.toFixed(1)}" height="${((v / (hi || 1)) * 24).toFixed(1)}" rx="1.5" fill="${color}" opacity=".85"/>` : '')).join('')}</svg>`;
  }
  const last = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map(([i, v]) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><i class="spark-dot" style="left:${X(last[0]).toFixed(1)}%;top:${((Y(last[1]) / 30) * 100).toFixed(1)}%;background:${color}"></i>`;
}

const MARK = { deload: ['#30B0C7', '↓', 'Entlastung'], race: ['#FFB000', '★', 'Rennen/Test'], test: ['#FFB000', '★', 'Leistungstest'], skip: ['#8E8E93', '✕', 'Ausgefallen'] };
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

  let html = `<section class="ccard"><div class="chead"><div><h2>${esc(o.title)}</h2><div class="big"><b class="num"${o.count != null ? ` data-count="${o.count}" data-dec="${o.cdec || 0}"` : ''}>${esc(o.big ?? '–')}</b><span>${o.unit ? ' ' + esc(o.unit) : ''}</span>${o.avgLabel ? `<em class="avgl">${esc(o.avgLabel)}</em>` : ''}</div></div>${o.note ? `<span class="note">${esc(o.note)}</span>` : ''}</div>`;

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
      o.vals.forEach((v, i) => {
        if (v > 0) plot += `<div class="bar" style="--i:${i};left:${(cx(i) - w / 2).toFixed(2)}%;width:${w.toFixed(2)}%;height:${Math.max(1.5, (v / o.max) * 100).toFixed(2)}%;background:${o.color}"></div>`;
        else if (o.future?.[i]) plot += `<div class="bar ghost" style="left:${(cx(i) - w / 2).toFixed(2)}%;width:${w.toFixed(2)}%;height:22%;border-color:${o.color}"></div>`;
      });
    } else if (o.type === 'stack') {
      const w = (100 / n) * 0.58;
      o.vals.forEach((s, i) => { if (s) plot += `<div class="stack" style="--i:${i};left:${(cx(i) - w / 2).toFixed(2)}%;width:${w.toFixed(2)}%">${s.map((p, k) => `<i style="height:${p}%;background:${ZONE_COLORS[k]}"></i>`).join('')}</div>`; });
    } else {
      const pts = [];
      o.vals.forEach((v, i) => { if (has(v)) pts.push([cx(i), Math.min(100, Math.max(0, topPct(v)))]); });
      if (pts.length > 1) plot += `<svg class="trace" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ')}" fill="none" stroke="${o.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
      pts.forEach((p, k) => { plot += `<i class="dot" style="--i:${k};left:${p[0].toFixed(2)}%;top:${p[1].toFixed(2)}%;border-color:${o.color}"></i>`; });
    }
    if (o.ref) {
      const t = topPct(o.ref.v);
      plot += `<div class="ref" style="top:${t.toFixed(2)}%;border-color:${o.ref.c}"></div><div class="reflabel" style="top:${t.toFixed(2)}%;color:${o.ref.c}">${esc(o.ref.t)}</div>`;
    }
    const marks = (o.marks || []).filter((m) => m.i >= 0 && m.i < n);
    marks.forEach((m) => {
      const [c, g, tt] = MARK[m.kind] || MARK.skip;
      plot += `<div class="mkline" style="left:${cx(m.i).toFixed(2)}%;border-color:${c}"></div><span class="mk" style="left:${cx(m.i).toFixed(2)}%;background:${c}" title="${esc(m.label || tt)}">${g}</span>`;
    });
    const markTip = (i) => marks.filter((m) => m.i === i).map((m) => `<br><span class="tm" style="color:${(MARK[m.kind] || MARK.skip)[0]}">${esc(m.label)}</span>`).join('');
    const tipOf = (i) => {
      const nm = o.names?.[i] || o.labels[i];
      if (o.type === 'stack') return o.vals[i] ? `${nm}<br>${o.vals[i].map((p, k) => (p ? `Z${k + 1} ${p} %` : '')).filter(Boolean).join(' · ')}${markTip(i)}` : null;
      const v = o.vals[i];
      if (!has(v) || (o.type === 'bars' && !(v > 0))) return null;
      return `${nm}<br><b>${(o.tipFmt || o.fmt)(v)}${o.unit ? ' ' + o.unit : ''}</b>${markTip(i)}`;
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
  const used = [...new Set((o.marks || []).map((m) => (m.kind === 'race' || m.kind === 'test' ? m.kind : m.kind)))];
  if (data && used.length) html += `<div class="legend marks">${used.map((k) => { const [c, g, tt] = MARK[k] || MARK.skip; return `<span><b class="mk-s" style="background:${c}">${g}</b>${esc(tt)}</span>`; }).join('')}</div>`;
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
