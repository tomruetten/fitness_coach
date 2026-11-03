// Analyse: Laufen, Gesundheit und Krafttraining, je Woche, Monat oder Jahr.
import { esc, store, swr, pace, dec, kg, hm, dmy } from './util.js';
import { chartCard, wireCharts, barAxis, lineAxis, spark, ZONE_COLORS } from './charts.js';
import { play } from './motion.js';

const RUN = '#FF6B2C', STR = '#AF52DE';
const AREA_COLOR = { run: RUN, health: '#30B0C7', strength: STR };
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const seg = (name, items, cur) => `<div class="seg area" role="group" aria-label="${name}">${items.map(([k, t]) => `<button type="button" data-${name}="${k}" aria-pressed="${k === cur}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
const AVG = { week: 'Ø Woche', month: 'Ø 5 Wochen', year: 'Ø Jahr' };
const RANGE = { week: 'Woche', month: 'Monat', year: 'Jahr' };
const CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const val = (v, f = String) => (v == null ? '–' : f(v));
const rangeMenu = (cur) => `<div class="stat"><button type="button" class="chip rng" aria-haspopup="menu" aria-expanded="false"><span>${RANGE[cur]}</span>${CHEV}</button><div class="menu" role="menu" hidden>${Object.entries(RANGE).map(([k, tx]) => `<button type="button" role="menuitem" data-range="${k}" class="${k === cur ? 'on' : ''}"><span>${tx}</span></button>`).join('')}</div></div>`;

function insightsHtml(d, area) {
  if (!d.insights) return '';
  const list = d.insights.filter((i) => i.area === area);
  if (!list.length) return `<h2>Auffälligkeiten</h2><div class="insights"><div class="insight good"><i></i><div><b>Alles im Normalbereich</b><p>Keine Auffälligkeiten im gewählten Zeitraum.</p></div></div></div>`;
  return `<h2>Auffälligkeiten</h2><div class="insights">${list.map((i) => `<div class="insight ${i.tone}"><i></i><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div></div>`).join('')}</div>`;
}

/** Die ersten drei Diagramme offen, der Rest eingeklappt. */
function split(list, open, st) {
  const cards = list.filter(Boolean);
  const main = cards.slice(0, 3).join(''), more = cards.slice(3);
  if (!more.length) return main;
  return `${main}<details class="morecharts" data-more${st.more ? ' open' : ''}><summary><span>Weitere Diagramme</span><em>${more.length}</em>${CHEV}</summary><div class="mc">${more.join('')}</div></details>`;
}

function runCharts(d, st) {
  d = { cad: [], vdot: [], hm: [], avg: {}, marks: [], ...d };
  const a = d.avg || {}, al = AVG[d.range], mk = d.marks;
  const kmAx = barAxis(Math.max(...d.km.map((v) => v || 0)));
  const z2Ax = lineAxis(d.z2, 10), gctAx = lineAxis(d.gct, 10), cadAx = lineAxis(d.cad || [], 5);
  const acMax = Math.max(...d.acwr.map((v) => v || 0));
  const acAx = acMax > 2 ? { min: 0, max: 3, ticks: [0, 1, 2, 3] } : { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2] };
  const f = d.fitness || {};
  const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  const vAx = lineAxis(d.vdot || [], 1), hAx = lineAxis(d.hm || [], 120);
  const base = { names: d.names, labels: d.labels, marks: mk, future: d.future };
  return split([
    f.vdot ? chartCard({ ...base, title: 'Leistungsstand (VDOT)', type: 'line', vals: d.vdot || [], ...vAx, fmt: (v) => dec(v, 0), tipFmt: (v) => dec(v, 1), color: RUN, big: dec(f.vdot, 1), count: f.vdot, cdec: 1, unit: '', avgLabel: 'aktuell', hint: 'Effektive Sauerstoffaufnahme nach Daniels, berechnet aus deinen härtesten Läufen und dem Verhältnis von Tempo zu Puls. Alle Trainingstempi leiten sich daraus ab.' }) : '',
    chartCard({ ...base, title: 'Laufumfang', type: 'bars', vals: d.km, ...kmAx, fmt: (v) => String(v), tipFmt: (v) => dec(v, 1), color: RUN, big: dec(sum(d.km), d.range === 'week' ? 1 : 0), count: sum(d.km), cdec: d.range === 'week' ? 1 : 0, unit: 'km', avgLabel: 'gesamt', hint: 'Aufbau in Schritten von höchstens 10 % pro Woche, alle vier Wochen eine Entlastung.' }),
    chartCard({ ...base, title: 'Intensitätsverteilung', type: 'stack', vals: d.zones, min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => v + ' %', ref: { v: 80, c: '#8E8E93', t: 'Ziel 80 %' }, legend: ZONE_COLORS.map((c, i) => ({ t: 'Z' + (i + 1), c })), big: val(d.z12), count: d.z12, unit: '% in Z1–Z2', avgLabel: al, hint: 'Mindestens 80 % locker laufen, Z3 bewusst klein halten.' }),
    f.vdot ? chartCard({ ...base, title: 'Halbmarathon-Prognose', type: 'line', vals: d.hm || [], ...hAx, invert: true, fmt: hms, tipFmt: (v) => hms(v) + ':' + String(Math.round(v % 60)).padStart(2, '0'), color: RUN, big: hms(f.predictions.hm) + ' h', unit: '', avgLabel: 'aktuell', hint: 'Zeit, die dein aktueller Leistungsstand für 21,1 km hergibt, wenn du ausgeruht und vorbereitet an den Start gehst.' }) : '',
    chartCard({ ...base, title: 'Tempo bei Z2-Puls', type: 'line', vals: d.z2, ...z2Ax, invert: true, fmt: pace, color: RUN, big: val(a.z2, pace), unit: 'min/km', avgLabel: al, hint: 'Schneller bei gleichem Puls heißt bessere Grundlage.' }),
    chartCard({ ...base, title: 'Belastungsverhältnis 7 / 28 Tage', type: 'line', vals: d.acwr, ...acAx, fmt: (v) => dec(v, v % 1 ? 1 : 0), tipFmt: (v) => dec(v, 2), color: RUN, band: [0.8, 1.3], ref: { v: 1.5, c: '#FF3B30', t: 'Grenze 1,5' }, big: val(a.acwr, (v) => dec(v, 2)), unit: '', avgLabel: al, hint: '0,8 bis 1,3 ist der Zielbereich, über 1,5 wird entlastet.' }),
    chartCard({ ...base, title: 'Schrittfrequenz', type: 'line', vals: d.cad || [], ...cadAx, fmt: String, color: RUN, big: val(a.cad), unit: 'spm', avgLabel: al, hint: 'Schritte pro Minute im Schnitt deiner Läufe. Höher bei gleichem Tempo heißt kürzere, flüssigere Schritte.' }),
    chartCard({ ...base, title: 'Bodenkontaktzeit', type: 'line', vals: d.gct, ...gctAx, invert: true, fmt: String, color: RUN, big: val(a.gct), unit: 'ms', avgLabel: al, hint: 'Kürzer bei gleichem Tempo bedeutet effizientere Schritte.' }),
  ], 3, st);
}

function healthCharts(d, st) {
  d = { hrv: [], rhr: [], sleep: [], bb: [], stress: [], avg: {}, marks: [], ...d };
  const a = d.avg || {}, al = AVG[d.range];
  const hrvAx = lineAxis([...d.hrv, ...(d.hrv_band || [])], 5), rhrAx = lineAxis([...d.rhr, ...(d.rhr_band || [])], 2);
  const slAx = lineAxis([...d.sleep, 7, 9], 1);
  const stAx = lineAxis(d.stress, 10);
  const base = { names: d.names, labels: d.labels, marks: d.marks.filter((m) => m.kind === 'skip' || m.kind === 'deload'), future: d.future };
  return split([
    chartCard({ ...base, title: 'Herzfrequenzvariabilität', type: 'line', vals: d.hrv, ...hrvAx, fmt: String, color: '#30B0C7', band: d.hrv_band, big: val(a.hrv), count: a.hrv, unit: 'ms', avgLabel: al, hint: 'Grün ist dein Normalbereich: Mittel ± 1 Standardabweichung der letzten 60 Tage.' }),
    chartCard({ ...base, title: 'Ruhepuls', type: 'line', vals: d.rhr, ...rhrAx, fmt: String, color: '#FF375F', band: d.rhr_band, big: val(a.rhr), count: a.rhr, unit: 'bpm', avgLabel: al, hint: 'Grün ist dein Normalbereich der letzten 60 Tage. Mehr als 5 bpm über der Basislinie löst einen leichten Lauf aus.' }),
    chartCard({ ...base, title: 'Schlaf', type: 'line', vals: d.sleep, ...slAx, fmt: (v) => dec(v, 0), tipFmt: (v) => dec(v, 1), color: '#5E5CE6', band: [7, 9], big: val(a.sleep, (v) => dec(v, 1)), count: a.sleep, cdec: 1, unit: 'h', avgLabel: al, hint: 'Grün sind 7 bis 9 Stunden. Zwei Nächte unter 6,5 Stunden zählen als Erholungssignal.' }),
    chartCard({ ...base, title: 'Body Battery (Tageshöchstwert)', type: 'line', vals: d.bb, min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: String, color: '#34C759', big: val(a.bb), count: a.bb, unit: '%', avgLabel: al, hint: 'Wie voll dein Akku morgens ist. Dauerhaft niedrige Werte deuten auf zu wenig Erholung hin.' }),
    chartCard({ ...base, title: 'Stress', type: 'line', vals: d.stress, ...stAx, fmt: String, color: '#FF9500', big: val(a.stress), count: a.stress, unit: '', avgLabel: al, hint: 'Durchschnittlicher Garmin-Stresslevel von 0 bis 100. Unter 25 ist Ruhe, über 50 mittlerer bis hoher Stress.' }),
  ], 3, st);
}

function strengthCharts(d, range) {
  if (!d.ex) return '<div class="card muted">Noch keine Einheiten im Logbuch. Sobald du ein Krafttraining abschließt, erscheinen hier deine Verläufe.</div>';
  const w = d.weight, firstW = w.find((v) => v != null), lastW = [...w].reverse().find((v) => v != null);
  const wAx = lineAxis(w, 5);
  const volAx = barAxis(Math.max(...d.vol.map((v) => v || 0)));
  const sesAx = barAxis(Math.max(2, ...d.sessions.map((v) => v || 0)));
  const delta = firstW != null && lastW != null && range !== 'week' && lastW !== firstW ? (lastW - firstW >= 0 ? '+' : '') + kg(lastW - firstW) + ' kg im Zeitraum' : '';
  return [
    chartCard({ names: d.names, title: 'Gewicht · ' + d.ex.name, type: 'line', labels: d.labels, vals: w, ...wAx, fmt: (v) => kg(v), color: STR, big: lastW == null ? '–' : kg(lastW), unit: 'kg', avgLabel: 'zuletzt', note: delta, hint: 'Arbeitsgewicht des schwersten Satzes. Steigt es über mehrere Einheiten, erhöht die App die Vorgabe.' }),
    chartCard({ names: d.names, title: 'Trainingsvolumen', type: 'bars', labels: d.labels, vals: d.vol, ...volAx, fmt: (v) => kg(v), color: STR, big: dec(sum(d.vol), 1), unit: 't', avgLabel: 'gesamt', hint: 'Sätze × Wdh. × kg. Gesamtgewicht, das du bewegt hast. Es soll langsam steigen und in Entlastungswochen sinken.' }),
    chartCard({ names: d.names, title: 'Einheiten', type: 'bars', labels: d.labels, vals: d.sessions, ...sesAx, fmt: String, color: '#C9A3E8', ref: range === 'month' ? { v: 2, c: '#8E8E93', t: 'Ziel 2' } : null, big: String(sum(d.sessions)), unit: 'Einheiten', avgLabel: 'gesamt', hint: 'Zwei Einheiten pro Woche: Kraft A am Mittwoch, Kraft B am Sonntag.' }),
    `<section class="ccard"><h2>Letzte Einheiten · ${esc(d.ex.name)}</h2>${d.hist.length ? d.hist.map((h) => `<div class="hrow"><span class="hd">${dmy(h.date)}</span><span class="hs">${h.sets} × ${h.reps} · ${kg(h.kg)} kg</span><span class="hdelta">${h.delta == null ? '' : h.delta > 0 ? '+' + kg(h.delta) + ' kg' : h.delta < 0 ? kg(h.delta) + ' kg' : '±0'}</span></div>`).join('') : '<p class="muted">Noch keine Einheiten.</p>'}</section>`,
  ].join('');
}

export async function viewAnalysis(app, isCurrent = () => true) {
  const st = { tab: 'run', range: 'month', ex: '', more: false, ...(store.get('ana') || {}) };
  if (!['run', 'health', 'strength'].includes(st.tab)) st.tab = 'run';
  const save = () => store.set('ana', st);
  const path = st.tab === 'strength' ? `/strength/analysis?range=${st.range}&ex=${encodeURIComponent(st.ex || '')}` : `/trends?range=${st.range}`;
  const key = st.tab === 'strength' ? `c_ana_strength_${st.range}_${st.ex}` : `c_ana_${st.range}`; // Laufen und Gesundheit teilen sich die Daten

  const kpi = ([l, v, u, o = {}]) => `<div class="kpi"><span>${l}</span><b><em${o.n != null ? ` data-count="${o.n}" data-dec="${o.d ?? 0}"` : ''}>${esc(v)}</em><small>${u}</small></b>${o.sub ? `<i class="ks">${esc(o.sub)}</i>` : ''}${o.spark ? `<div class="kspark">${o.spark}</div>` : ''}</div>`;
  const draw = (d, offline) => {
    const a = d?.avg || {}, col = AREA_COLOR[st.tab];
    const hmShort = (s) => hm(s).replace(' h', '');
    const k = d && (st.tab === 'run'
      ? [['Distanz', dec(d.kpis.km, 1), ' km', { n: d.kpis.km, d: 1, sub: `${d.kpis.runs} ${d.kpis.runs === 1 ? 'Lauf' : 'Läufe'}`, spark: spark(d.km, RUN, true) }],
        ['VDOT', val(d.fitness?.vdot, (v) => dec(v, 1)), '', { n: d.fitness?.vdot, d: 1, sub: d.fitness?.predictions ? `HM ${Math.floor(d.fitness.predictions.hm / 3600)}:${String(Math.floor((d.fitness.predictions.hm % 3600) / 60)).padStart(2, '0')} h` : '', spark: spark(d.vdot, RUN) }],
        ['Zeit', hmShort(d.kpis.time_s), d.kpis.time_s >= 3600 ? ' h' : ' min', { sub: d.kpis.runs ? `Ø ${Math.round(d.kpis.time_s / 60 / d.kpis.runs)} min je Lauf` : '' }]]
      : st.tab === 'health'
        ? [['Ø HRV', val(a.hrv), ' ms', { n: a.hrv, spark: spark(d.hrv, col) }], ['Ø Ruhepuls', val(a.rhr), ' bpm', { n: a.rhr, spark: spark(d.rhr, '#FF375F') }], ['Ø Schlaf', val(a.sleep, (v) => dec(v, 1)), ' h', { n: a.sleep, d: 1, spark: spark(d.sleep, '#5E5CE6') }]]
        : [['Einheiten', String(d.kpis.sessions), '', { n: d.kpis.sessions, spark: spark(d.sessions, STR, true) }], ['Volumen', dec(d.kpis.volume_t, 1), ' t', { n: d.kpis.volume_t, d: 1, spark: spark(d.vol, STR, true) }], ['Sätze', String(d.kpis.sets), '', { n: d.kpis.sets }]]);
    app.style.setProperty('--area', col);
    app.innerHTML = `<div class="head row-head"><div><div class="eyebrow">${esc((st.tab === 'strength' ? 'Krafttraining · ' : st.tab === 'health' ? 'Gesundheit · ' : '') + (d?.sub || ''))}${offline ? ' · offline' : ''}</div><h1>Analyse</h1></div>${rangeMenu(st.range)}</div>
      ${seg('tab', [['run', 'Laufen'], ['health', 'Gesundheit'], ['strength', 'Kraft']], st.tab)}
      ${d ? `<div class="kpis">${k.map(kpi).join('')}</div>
      ${st.tab === 'strength' && d.exercises.length ? `<div class="chips" role="group" aria-label="Übung">${d.exercises.map((e) => `<button type="button" data-ex="${esc(e.id)}" aria-pressed="${e.id === d.ex.id}" class="${e.id === d.ex.id ? 'on' : ''}">${esc(e.name)}</button>`).join('')}</div>` : ''}
      ${st.tab === 'strength' ? '' : insightsHtml(d, st.tab)}
      ${st.tab === 'run' ? runCharts(d, st) : st.tab === 'health' ? healthCharts(d, st) : strengthCharts(d, st.range)}` : '<p class="muted center-text">Lädt …</p>'}`;
    if (d) play(app, `ana:${st.tab}:${st.range}`);
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; save(); viewAnalysis(app, isCurrent); }));
    app.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { st.ex = b.dataset.ex; save(); viewAnalysis(app, isCurrent); }));
    const det = app.querySelector('[data-more]');
    det?.addEventListener('toggle', () => { st.more = det.open; save(); });
    const sm = app.querySelector('.stat');
    const chip = sm.querySelector('.chip'), menu = sm.querySelector('.menu');
    const close = () => { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', away, true); };
    const away = (e) => { if (!sm.contains(e.target)) close(); };
    chip.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; chip.setAttribute('aria-expanded', String(open)); if (open) document.addEventListener('click', away, true); });
    menu.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { close(); if (st.range === b.dataset.range) return; st.range = b.dataset.range; save(); viewAnalysis(app, isCurrent); }));
  };
  if (!app.dataset.wired) { wireCharts(app); app.dataset.wired = '1'; }
  if (!store.get(key)) draw(null, false);
  await swr(key, path, draw, isCurrent);
}
