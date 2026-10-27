// Analyse: Laufen und Krafttraining, je Woche, Monat oder Jahr.
import { esc, store, swr, pace, dec, kg, hm, dmy } from './util.js';
import { chartCard, barAxis, lineAxis, meanSd, ZONE_COLORS } from './charts.js';

const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const seg = (name, items, cur) => `<div class="seg" role="group" aria-label="${name}">${items.map(([k, t]) => `<button type="button" data-${name}="${k}" aria-pressed="${k === cur}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;

function runCharts(d) {
  const kmAx = barAxis(Math.max(...d.km.map((v) => v || 0)));
  const z2Ax = lineAxis(d.z2, 10), hrvAx = lineAxis(d.hrv, 10), rhrAx = lineAxis(d.rhr, 5), gctAx = lineAxis(d.gct, 10);
  const acMax = Math.max(...d.acwr.map((v) => v || 0));
  const acAx = acMax > 2 ? { min: 0, max: 3, ticks: [0, 1, 2, 3] } : { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2] };
  return [
    chartCard({ title: 'Laufumfang', type: 'bars', labels: d.labels, vals: d.km, ...kmAx, fmt: (v) => String(v), color: '#FF6B2C', big: dec(sum(d.km), d.range === 'week' ? 1 : 0), unit: 'km', note: 'Summe', hint: 'Aufbau in Schritten von höchstens 10 % pro Woche.' }),
    chartCard({ title: 'Intensitätsverteilung', type: 'stack', labels: d.labels, vals: d.zones, min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => v + ' %', ref: { v: 80, c: '#8E8E93', t: 'Ziel 80 %' }, legend: ZONE_COLORS.map((c, i) => ({ t: 'Z' + (i + 1), c })), big: d.z12 == null ? '–' : String(d.z12), unit: '% in Z1–Z2', note: 'Ziel 80 %', hint: 'Mindestens 80 % locker laufen, Z3 bewusst klein halten.' }),
    chartCard({ title: 'Tempo bei Z2-Puls', type: 'line', labels: d.labels, vals: d.z2, ...z2Ax, invert: true, fmt: pace, color: '#0A84FF', big: last(d.z2) ? pace(last(d.z2)) : '–', unit: 'min/km', note: 'zuletzt', hint: 'Schneller bei gleichem Puls heißt bessere Grundlage.' }),
    chartCard({ title: 'Herzfrequenzvariabilität', type: 'line', labels: d.labels, vals: d.hrv, ...hrvAx, fmt: String, color: '#30B0C7', band: meanSd(d.hrv), big: last(d.hrv) == null ? '–' : String(last(d.hrv)), unit: 'ms', note: 'zuletzt', hint: 'Grün ist dein Normalbereich (Mittel ± 1 Standardabweichung dieser Ansicht).' }),
    chartCard({ title: 'Ruhepuls', type: 'line', labels: d.labels, vals: d.rhr, ...rhrAx, fmt: String, color: '#FF375F', band: meanSd(d.rhr), big: last(d.rhr) == null ? '–' : String(last(d.rhr)), unit: 'bpm', note: 'zuletzt', hint: 'Mehr als 5 bpm über der Basislinie löst einen leichten Lauf aus.' }),
    chartCard({ title: 'Belastungsverhältnis 7 / 28 Tage', type: 'line', labels: d.labels, vals: d.acwr, ...acAx, fmt: (v) => dec(v, v % 1 ? 1 : 0), color: '#FF9500', band: [0.8, 1.3], ref: { v: 1.5, c: '#FF3B30', t: 'Grenze 1,5' }, big: last(d.acwr) == null ? '–' : dec(last(d.acwr), 2), unit: '', note: 'zuletzt', hint: '0,8 bis 1,3 ist der Zielbereich, über 1,5 wird entlastet.' }),
    chartCard({ title: 'Bodenkontaktzeit', type: 'line', labels: d.labels, vals: d.gct, ...gctAx, invert: true, fmt: String, color: '#5E5CE6', big: last(d.gct) == null ? '–' : String(last(d.gct)), unit: 'ms', note: 'zuletzt', hint: 'Kürzer bei gleichem Tempo bedeutet effizientere Schritte.' }),
  ].join('');
}

function strengthCharts(d, range) {
  if (!d.ex) return '<div class="card muted">Noch keine Einheiten im Logbuch. Sobald du ein Krafttraining abschließt, erscheinen hier deine Verläufe.</div>';
  const w = d.weight, firstW = w.find((v) => v != null), lastW = last(w);
  const wAx = lineAxis(w, 5);
  const volAx = barAxis(Math.max(...d.vol.map((v) => v || 0)));
  const sesAx = barAxis(Math.max(2, ...d.sessions.map((v) => v || 0)));
  const delta = firstW != null && lastW != null && range !== 'week' && lastW !== firstW ? (lastW - firstW >= 0 ? '+' : '') + kg(lastW - firstW) + ' kg im Zeitraum' : 'schwerster Satz';
  return [
    chartCard({ title: 'Gewicht · ' + d.ex.name, type: 'line', labels: d.labels, vals: w, ...wAx, fmt: (v) => kg(v), color: '#AF52DE', big: lastW == null ? '–' : kg(lastW), unit: 'kg', note: delta, hint: 'Arbeitsgewicht des schwersten Satzes. Steigt es über mehrere Einheiten, erhöht die App die Vorgabe.' }),
    chartCard({ title: 'Trainingsvolumen', type: 'bars', labels: d.labels, vals: d.vol, ...volAx, fmt: (v) => kg(v), color: '#AF52DE', big: dec(sum(d.vol), 1), unit: 't', note: 'Sätze × Wdh. × kg', hint: 'Gesamtgewicht, das du bewegt hast. Es soll langsam steigen und in Entlastungswochen sinken.' }),
    chartCard({ title: 'Einheiten', type: 'bars', labels: d.labels, vals: d.sessions, ...sesAx, fmt: String, color: '#C9A3E8', ref: range === 'month' ? { v: 2, c: '#8E8E93', t: 'Ziel 2' } : null, big: String(sum(d.sessions)), unit: 'Einheiten', note: range === 'month' ? 'Ziel 2 pro Woche' : '', hint: 'Zwei Einheiten pro Woche: Kraft A am Mittwoch, Kraft B am Sonntag.' }),
    `<section class="ccard"><h2>Letzte Einheiten · ${esc(d.ex.name)}</h2>${d.hist.length ? d.hist.map((h) => `<div class="hrow"><span class="hd">${dmy(h.date)}</span><span class="hs">${h.sets} × ${h.reps} · ${kg(h.kg)} kg</span><span class="hdelta">${h.delta == null ? '' : h.delta > 0 ? '+' + kg(h.delta) + ' kg' : h.delta < 0 ? kg(h.delta) + ' kg' : '±0'}</span></div>`).join('') : '<p class="muted">Noch keine Einheiten.</p>'}</section>`,
  ].join('');
}

export async function viewAnalysis(app, isCurrent = () => true) {
  const st = { tab: 'run', range: 'month', ex: '', ...(store.get('ana') || {}) };
  const save = () => store.set('ana', st);
  const path = st.tab === 'run' ? `/trends?range=${st.range}` : `/strength/analysis?range=${st.range}&ex=${encodeURIComponent(st.ex || '')}`;
  const key = `c_ana_${st.tab}_${st.range}_${st.tab === 'run' ? '' : st.ex}`;

  const draw = (d, offline) => {
    const k = d && (st.tab === 'run'
      ? [['Läufe', String(d.kpis.runs), ''], ['Distanz', dec(d.kpis.km, 1), ' km'], ['Zeit', hm(d.kpis.time_s).replace(' h', ''), d.kpis.time_s >= 3600 ? ' h' : ' min']]
      : [['Einheiten', String(d.kpis.sessions), ''], ['Volumen', dec(d.kpis.volume_t, 1), ' t'], ['Sätze', String(d.kpis.sets), '']]);
    app.innerHTML = `<div class="head"><div class="eyebrow">${esc((st.tab === 'strength' ? 'Krafttraining · ' : '') + (d?.sub || ''))}${offline ? ' · offline' : ''}</div><h1>Analyse</h1></div>
      ${seg('tab', [['run', 'Laufen'], ['strength', 'Krafttraining']], st.tab)}
      ${seg('range', [['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']], st.range)}
      ${d ? `<div class="kpis">${k.map(([l, v, u]) => `<div class="kpi"><span>${l}</span><b>${esc(v)}<small>${u}</small></b></div>`).join('')}</div>
      ${st.tab === 'strength' && d.exercises.length ? `<div class="chips" role="group" aria-label="Übung">${d.exercises.map((e) => `<button type="button" data-ex="${esc(e.id)}" aria-pressed="${e.id === d.ex.id}" class="${e.id === d.ex.id ? 'on' : ''}">${esc(e.name)}</button>`).join('')}</div>` : ''}
      ${st.tab === 'run' ? runCharts(d) : strengthCharts(d, st.range)}` : '<p class="muted center-text">Lädt …</p>'}`;
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; save(); viewAnalysis(app, isCurrent); }));
    app.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { st.range = b.dataset.range; save(); viewAnalysis(app, isCurrent); }));
    app.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { st.ex = b.dataset.ex; save(); viewAnalysis(app, isCurrent); }));
  };
  if (!store.get(key)) draw(null, false);
  await swr(key, path, draw, isCurrent);
}
