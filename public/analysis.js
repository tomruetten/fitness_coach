// Analyse: Laufen, Gesundheit und Krafttraining, je Woche, Monat oder Jahr.
import { esc, store, swr, pace, dec, kg, hm, dmy } from './util.js';
import { chartCard, wireCharts, barAxis, lineAxis, ZONE_COLORS } from './charts.js';

const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const seg = (name, items, cur) => `<div class="seg" role="group" aria-label="${name}">${items.map(([k, t]) => `<button type="button" data-${name}="${k}" aria-pressed="${k === cur}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
const AVG = { week: 'Ø Woche', month: 'Ø 5 Wochen', year: 'Ø Jahr' };
const val = (v, f = String) => (v == null ? '–' : f(v));

function runCharts(d) {
  d = { cad: [], vdot: [], hm: [], avg: {}, ...d };
  const a = d.avg || {}, al = AVG[d.range];
  const kmAx = barAxis(Math.max(...d.km.map((v) => v || 0)));
  const z2Ax = lineAxis(d.z2, 10), gctAx = lineAxis(d.gct, 10), cadAx = lineAxis(d.cad || [], 5);
  const acMax = Math.max(...d.acwr.map((v) => v || 0));
  const acAx = acMax > 2 ? { min: 0, max: 3, ticks: [0, 1, 2, 3] } : { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2] };
  const f = d.fitness || {};
  const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  const vAx = lineAxis(d.vdot || [], 1), hAx = lineAxis(d.hm || [], 120);
  return [
    f.vdot ? chartCard({ names: d.names, title: 'Leistungsstand (VDOT)', type: 'line', labels: d.labels, vals: d.vdot || [], ...vAx, fmt: (v) => dec(v, 0), tipFmt: (v) => dec(v, 1), color: '#FF6B2C', big: dec(f.vdot, 1), unit: '', avgLabel: 'aktuell', hint: 'Effektive Sauerstoffaufnahme nach Daniels, berechnet aus deinen härtesten Läufen und dem Verhältnis von Tempo zu Puls. Alle Trainingstempi leiten sich daraus ab.' }) : '',
    f.vdot ? chartCard({ names: d.names, title: 'Halbmarathon-Prognose', type: 'line', labels: d.labels, vals: d.hm || [], ...hAx, invert: true, fmt: hms, tipFmt: (v) => hms(v) + ':' + String(Math.round(v % 60)).padStart(2, '0'), color: '#AF52DE', big: hms(f.predictions.hm) + ' h', unit: '', avgLabel: 'aktuell', hint: 'Zeit, die dein aktueller Leistungsstand für 21,1 km hergibt, wenn du ausgeruht und vorbereitet an den Start gehst.' }) : '',
    chartCard({ names: d.names, title: 'Laufumfang', type: 'bars', labels: d.labels, vals: d.km, ...kmAx, fmt: (v) => String(v), tipFmt: (v) => dec(v, 1), color: '#FF6B2C', big: dec(sum(d.km), d.range === 'week' ? 1 : 0), unit: 'km', avgLabel: 'gesamt', hint: 'Aufbau in Schritten von höchstens 10 % pro Woche.' }),
    chartCard({ names: d.names, title: 'Intensitätsverteilung', type: 'stack', labels: d.labels, vals: d.zones, min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => v + ' %', ref: { v: 80, c: '#8E8E93', t: 'Ziel 80 %' }, legend: ZONE_COLORS.map((c, i) => ({ t: 'Z' + (i + 1), c })), big: val(d.z12), unit: '% in Z1–Z2', avgLabel: al, hint: 'Mindestens 80 % locker laufen, Z3 bewusst klein halten.' }),
    chartCard({ names: d.names, title: 'Tempo bei Z2-Puls', type: 'line', labels: d.labels, vals: d.z2, ...z2Ax, invert: true, fmt: pace, color: '#0A84FF', big: val(a.z2, pace), unit: 'min/km', avgLabel: al, hint: 'Schneller bei gleichem Puls heißt bessere Grundlage.' }),
    chartCard({ names: d.names, title: 'Belastungsverhältnis 7 / 28 Tage', type: 'line', labels: d.labels, vals: d.acwr, ...acAx, fmt: (v) => dec(v, v % 1 ? 1 : 0), tipFmt: (v) => dec(v, 2), color: '#FF9500', band: [0.8, 1.3], ref: { v: 1.5, c: '#FF3B30', t: 'Grenze 1,5' }, big: val(a.acwr, (v) => dec(v, 2)), unit: '', avgLabel: al, hint: '0,8 bis 1,3 ist der Zielbereich, über 1,5 wird entlastet.' }),
    chartCard({ names: d.names, title: 'Schrittfrequenz', type: 'line', labels: d.labels, vals: d.cad || [], ...cadAx, fmt: String, color: '#32ADE6', big: val(a.cad), unit: 'spm', avgLabel: al, hint: 'Schritte pro Minute im Schnitt deiner Läufe. Höher bei gleichem Tempo heißt kürzere, flüssigere Schritte.' }),
    chartCard({ names: d.names, title: 'Bodenkontaktzeit', type: 'line', labels: d.labels, vals: d.gct, ...gctAx, invert: true, fmt: String, color: '#5E5CE6', big: val(a.gct), unit: 'ms', avgLabel: al, hint: 'Kürzer bei gleichem Tempo bedeutet effizientere Schritte.' }),
  ].join('');
}

function healthCharts(d) {
  d = { hrv: [], rhr: [], sleep: [], bb: [], stress: [], avg: {}, ...d };
  const a = d.avg || {}, al = AVG[d.range];
  const hrvAx = lineAxis([...d.hrv, ...(d.hrv_band || [])], 5), rhrAx = lineAxis([...d.rhr, ...(d.rhr_band || [])], 2);
  const slAx = lineAxis([...d.sleep, 7, 9], 1);
  const stAx = lineAxis(d.stress, 10);
  return [
    chartCard({ names: d.names, title: 'Herzfrequenzvariabilität', type: 'line', labels: d.labels, vals: d.hrv, ...hrvAx, fmt: String, color: '#30B0C7', band: d.hrv_band, big: val(a.hrv), unit: 'ms', avgLabel: al, hint: 'Grün ist dein Normalbereich: Mittel ± 1 Standardabweichung der letzten 60 Tage.' }),
    chartCard({ names: d.names, title: 'Ruhepuls', type: 'line', labels: d.labels, vals: d.rhr, ...rhrAx, fmt: String, color: '#FF375F', band: d.rhr_band, big: val(a.rhr), unit: 'bpm', avgLabel: al, hint: 'Grün ist dein Normalbereich der letzten 60 Tage. Mehr als 5 bpm über der Basislinie löst einen leichten Lauf aus.' }),
    chartCard({ names: d.names, title: 'Schlaf', type: 'line', labels: d.labels, vals: d.sleep, ...slAx, fmt: (v) => dec(v, 0), tipFmt: (v) => dec(v, 1), color: '#5E5CE6', band: [7, 9], big: val(a.sleep, (v) => dec(v, 1)), unit: 'h', avgLabel: al, hint: 'Grün sind 7 bis 9 Stunden. Zwei Nächte unter 6,5 Stunden zählen als Erholungssignal.' }),
    chartCard({ names: d.names, title: 'Body Battery (Tageshöchstwert)', type: 'line', labels: d.labels, vals: d.bb, min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: String, color: '#34C759', big: val(a.bb), unit: '%', avgLabel: al, hint: 'Wie voll dein Akku morgens ist. Dauerhaft niedrige Werte deuten auf zu wenig Erholung hin.' }),
    chartCard({ names: d.names, title: 'Stress', type: 'line', labels: d.labels, vals: d.stress, ...stAx, fmt: String, color: '#FF9500', big: val(a.stress), unit: '', avgLabel: al, hint: 'Durchschnittlicher Garmin-Stresslevel von 0 bis 100. Unter 25 ist Ruhe, über 50 mittlerer bis hoher Stress.' }),
  ].join('');
}

function strengthCharts(d, range) {
  if (!d.ex) return '<div class="card muted">Noch keine Einheiten im Logbuch. Sobald du ein Krafttraining abschließt, erscheinen hier deine Verläufe.</div>';
  const w = d.weight, firstW = w.find((v) => v != null), lastW = [...w].reverse().find((v) => v != null);
  const wAx = lineAxis(w, 5);
  const volAx = barAxis(Math.max(...d.vol.map((v) => v || 0)));
  const sesAx = barAxis(Math.max(2, ...d.sessions.map((v) => v || 0)));
  const delta = firstW != null && lastW != null && range !== 'week' && lastW !== firstW ? (lastW - firstW >= 0 ? '+' : '') + kg(lastW - firstW) + ' kg im Zeitraum' : '';
  return [
    chartCard({ names: d.names, title: 'Gewicht · ' + d.ex.name, type: 'line', labels: d.labels, vals: w, ...wAx, fmt: (v) => kg(v), color: '#AF52DE', big: lastW == null ? '–' : kg(lastW), unit: 'kg', avgLabel: 'zuletzt', note: delta, hint: 'Arbeitsgewicht des schwersten Satzes. Steigt es über mehrere Einheiten, erhöht die App die Vorgabe.' }),
    chartCard({ names: d.names, title: 'Trainingsvolumen', type: 'bars', labels: d.labels, vals: d.vol, ...volAx, fmt: (v) => kg(v), color: '#AF52DE', big: dec(sum(d.vol), 1), unit: 't', avgLabel: 'gesamt', hint: 'Sätze × Wdh. × kg. Gesamtgewicht, das du bewegt hast. Es soll langsam steigen und in Entlastungswochen sinken.' }),
    chartCard({ names: d.names, title: 'Einheiten', type: 'bars', labels: d.labels, vals: d.sessions, ...sesAx, fmt: String, color: '#C9A3E8', ref: range === 'month' ? { v: 2, c: '#8E8E93', t: 'Ziel 2' } : null, big: String(sum(d.sessions)), unit: 'Einheiten', avgLabel: 'gesamt', hint: 'Zwei Einheiten pro Woche: Kraft A am Mittwoch, Kraft B am Sonntag.' }),
    `<section class="ccard"><h2>Letzte Einheiten · ${esc(d.ex.name)}</h2>${d.hist.length ? d.hist.map((h) => `<div class="hrow"><span class="hd">${dmy(h.date)}</span><span class="hs">${h.sets} × ${h.reps} · ${kg(h.kg)} kg</span><span class="hdelta">${h.delta == null ? '' : h.delta > 0 ? '+' + kg(h.delta) + ' kg' : h.delta < 0 ? kg(h.delta) + ' kg' : '±0'}</span></div>`).join('') : '<p class="muted">Noch keine Einheiten.</p>'}</section>`,
  ].join('');
}

export async function viewAnalysis(app, isCurrent = () => true) {
  const st = { tab: 'run', range: 'month', ex: '', ...(store.get('ana') || {}) };
  if (!['run', 'health', 'strength'].includes(st.tab)) st.tab = 'run';
  const save = () => store.set('ana', st);
  const path = st.tab === 'strength' ? `/strength/analysis?range=${st.range}&ex=${encodeURIComponent(st.ex || '')}` : `/trends?range=${st.range}`;
  const key = st.tab === 'strength' ? `c_ana_strength_${st.range}_${st.ex}` : `c_ana_${st.range}`; // Laufen und Gesundheit teilen sich die Daten

  const draw = (d, offline) => {
    const a = d?.avg || {};
    const k = d && (st.tab === 'run'
      ? [['Läufe', String(d.kpis.runs), ''], ['Distanz', dec(d.kpis.km, 1), ' km'], ['Zeit', hm(d.kpis.time_s).replace(' h', ''), d.kpis.time_s >= 3600 ? ' h' : ' min']]
      : st.tab === 'health'
        ? [['Ø HRV', val(a.hrv), ' ms'], ['Ø Ruhepuls', val(a.rhr), ' bpm'], ['Ø Schlaf', val(a.sleep, (v) => dec(v, 1)), ' h']]
        : [['Einheiten', String(d.kpis.sessions), ''], ['Volumen', dec(d.kpis.volume_t, 1), ' t'], ['Sätze', String(d.kpis.sets), '']]);
    app.innerHTML = `<div class="head"><div class="eyebrow">${esc((st.tab === 'strength' ? 'Krafttraining · ' : st.tab === 'health' ? 'Gesundheit · ' : '') + (d?.sub || ''))}${offline ? ' · offline' : ''}</div><h1>Analyse</h1></div>
      ${seg('tab', [['run', 'Laufen'], ['health', 'Gesundheit'], ['strength', 'Kraft']], st.tab)}
      ${seg('range', [['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']], st.range)}
      ${d ? `<div class="kpis">${k.map(([l, v, u]) => `<div class="kpi"><span>${l}</span><b>${esc(v)}<small>${u}</small></b></div>`).join('')}</div>
      ${st.tab === 'strength' && d.exercises.length ? `<div class="chips" role="group" aria-label="Übung">${d.exercises.map((e) => `<button type="button" data-ex="${esc(e.id)}" aria-pressed="${e.id === d.ex.id}" class="${e.id === d.ex.id ? 'on' : ''}">${esc(e.name)}</button>`).join('')}</div>` : ''}
      ${st.tab === 'run' ? runCharts(d) : st.tab === 'health' ? healthCharts(d) : strengthCharts(d, st.range)}` : '<p class="muted center-text">Lädt …</p>'}`;
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; save(); viewAnalysis(app, isCurrent); }));
    app.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { st.range = b.dataset.range; save(); viewAnalysis(app, isCurrent); }));
    app.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { st.ex = b.dataset.ex; save(); viewAnalysis(app, isCurrent); }));
  };
  if (!app.dataset.wired) { wireCharts(app); app.dataset.wired = '1'; }
  if (!store.get(key)) draw(null, false);
  await swr(key, path, draw, isCurrent);
}
