import { $, $$, esc, pace, hm, dmy, dec, SPORT, toast, api, store, swr, icon } from './util.js';
import { viewAnalysis } from './analysis.js';
import { heuteKraftCard, viewPrep, viewLog } from './strength.js';
import { ringHtml, spark } from './charts.js';
import { play, rings } from './motion.js';

const app = $('#app');
let tab = 'today';
let sub = null; // {view:'prep'|'log', kind}

// ---- WebAuthn --------------------------------------------------------------
const b64u = { dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0)).buffer,
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
async function registerPasskey(setupToken, label) {
  const { options, challengeId } = await api('/auth/register/options', { setupToken });
  options.challenge = b64u.dec(options.challenge); options.user.id = b64u.dec(options.user.id);
  options.excludeCredentials = (options.excludeCredentials || []).map((c) => ({ ...c, id: b64u.dec(c.id) }));
  const c = await navigator.credentials.create({ publicKey: options });
  const response = { id: c.id, rawId: b64u.enc(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment || undefined,
    response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), attestationObject: b64u.enc(c.response.attestationObject), transports: c.response.getTransports?.() || [] } };
  await api('/auth/register/verify', { setupToken, challengeId, response, label });
}
async function loginPasskey() {
  const { options, challengeId } = await api('/auth/login/options', {});
  options.challenge = b64u.dec(options.challenge);
  options.allowCredentials = (options.allowCredentials || []).map((c) => ({ ...c, id: b64u.dec(c.id) }));
  const c = await navigator.credentials.get({ publicKey: options });
  const response = { id: c.id, rawId: b64u.enc(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment || undefined,
    response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), authenticatorData: b64u.enc(c.response.authenticatorData), signature: b64u.enc(c.response.signature), userHandle: c.response.userHandle ? b64u.enc(c.response.userHandle) : undefined } };
  await api('/auth/login/verify', { challengeId, response });
}

async function showAuth(state) {
  $('#tabs').hidden = true; app.classList.remove('sub');
  const setup = state.setupNeeded;
  app.innerHTML = `<div class="center"><h1>Fitness Coach</h1><p class="lead">${setup ? 'Erste Einrichtung: Mit dem Setup-Token legst du den Passkey für dieses Gerät an.' : 'Mit Face ID, Touch ID oder Gerätecode anmelden.'}</p>
    ${setup ? '<input class="txt" id="tok" type="password" placeholder="Setup-Token" autocomplete="off">' : ''}
    <button class="pri" id="go">${setup ? 'Passkey anlegen' : 'Mit Passkey anmelden'}</button><p class="err" id="msg"></p></div>`;
  $('#go').onclick = async () => {
    $('#go').disabled = true; $('#msg').textContent = '';
    try { if (setup) await registerPasskey($('#tok').value, navigator.platform || 'Gerät'); else await loginPasskey(); start(); }
    catch (e) { $('#msg').textContent = e.name === 'NotAllowedError' ? 'Abgebrochen.' : e.message; $('#go').disabled = false; }
  };
  if (!setup && window.PublicKeyCredential) $('#go').click();
}


// ---- Heute -----------------------------------------------------------------
const KIND_COLOR = { running: '#FF6B2C', strength: '#AF52DE', spinning: '#0A84FF' };
const group = (k) => (k.startsWith('run') ? 'run' : k.startsWith('strength') ? 'strength' : k === 'spinning' ? 'spin' : 'rest');
const nice = (l) => String(l || '').replace(' (', ' · ').replace(')', '');
const zoneOf = (hr, lthr) => { const r = hr / lthr; return r < 0.85 ? 0 : r < 0.9 ? 1 : r < 0.95 ? 2 : r < 1 ? 3 : 4; };
const ZC = ['#A9C9FF', '#34C759', '#FFCC00', '#FF9500', '#FF3B30'];

function pills(d) {
  const rd = d.readiness, p = d.plan;
  const ts = d.training_status;
  const items = [ts ? `<i class="sdot" style="background:${ts.color}"></i>${esc(ts.label)}` : '', p.block ? `${esc(p.block.label)} · Woche ${p.block.week}${p.block.deload ? ' · Entlastung' : ''}` : '', rd.acwr != null ? `Belastung ${dec(rd.acwr, 2)}` : '', p.provisional ? 'vorläufig' : ''].filter(Boolean);
  return items.length ? `<div class="pills">${items.map((x) => `<span class="pill mute">${x}</span>`).join('')}</div>` : '';
}

const SCORE_COLOR = (s) => (s >= 75 ? '#34C759' : s >= 50 ? '#FF9500' : '#FF3B30');
const DOT = { good: '#34C759', medium: '#FF9500', low: '#FF3B30' };
/** Ein Satz, was heute zu tun ist. */
function advice(d) {
  const p = d.plan, rd = d.readiness;
  if (p.kind === 'rest') return rd.level === 'good' ? 'Ruhetag. Du bist erholt, nutze die Pause zum Auftanken.' : 'Ruhetag. Dein Körper kann ihn gut gebrauchen.';
  if (rd.level === 'low') return p.adjusted ? 'Dein Körper braucht Erholung. Die Einheit ist entschärft.' : 'Dein Körper braucht Erholung. Geh es heute locker an.';
  if (rd.level === 'medium') return p.adjusted ? 'Leicht müde. Die Einheit wurde angepasst.' : 'Leicht müde. Hör beim Training auf deinen Körper.';
  return 'Du bist erholt. Die geplante Einheit passt.';
}
function cockpit(d) {
  const rd = d.readiness, s = rd.score;
  const color = s != null ? SCORE_COLOR(s) : DOT[rd.level] || '#8E8E93';
  const center = s != null ? `<b data-count="${s}" data-dec="0">${s}</b><small>Erholung</small>` : '<b>–</b><small>Erholung</small>';
  const parts = (rd.parts || []).filter((x) => ['hrv', 'rhr', 'sleep'].includes(x.key)).map((x) => `<div class="mt"><i style="background:${DOT[x.status]}"></i><span>${x.label}</span><b>${esc(x.value)}</b></div>`).join('');
  return `<div class="card cockpit">${ringHtml({ p: s != null ? s / 100 : 0, color, size: 108, sw: 10, center })}<div class="cp-text"><div class="cp-adv">${esc(advice(d))}</div>${parts ? `<div class="cp-parts">${parts}</div>` : ''}</div></div>`;
}

const PK = { easy: ['#34C759', 34, 'Locker'], rec: ['#A9C9FF', 20, 'Trab'], mar: ['#FFCC00', 52, 'Marathon'], thr: ['#FF9500', 72, 'Schwelle'], int: ['#FF3B30', 88, 'Intervall'], rep: ['#FF3B30', 100, 'Steigerung'] };
/** Ablauf der Einheit als Treppenprofil: Breite = Dauer, Höhe = Intensität. */
function profileChart(pr) {
  if (!pr?.length) return '';
  const tot = pr.reduce((s, x) => s + x.m, 0);
  const kinds = [...new Set(pr.map((x) => x.k))].filter((k) => k !== 'rec' && PK[k]);
  return `<div class="prof"><div class="pbars">${pr.map((x) => `<i style="flex:${x.m} 1 0;height:${(PK[x.k] || PK.easy)[1]}%;background:${(PK[x.k] || PK.easy)[0]}"></i>`).join('')}</div><div class="pax"><span>0</span><span>${Math.round(tot)} min</span></div>${kinds.length > 1 ? `<div class="plg">${kinds.map((k) => `<span><i style="background:${PK[k][0]}"></i>${PK[k][2]}</span>`).join('')}</div>` : ''}</div>`;
}

function wxCard(w) {
  if (!w) return '';
  return `<div class="card wx"><div class="wx-main"><div class="wx-t"><b>${w.temp}°</b><small>gefühlt ${w.feels}°</small></div><div class="wx-d"><span>Regen ${w.rain} %</span><span>Wind ${w.wind} km/h</span><span>${w.hour} Uhr</span></div></div>${w.tips.length ? `<ul class="why">${w.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${w.dry_hours && w.rain >= 40 ? `<p class="fine">Trockenes Zeitfenster: ${w.dry_hours[0]}–${w.dry_hours[1]} Uhr</p>` : ''}</div>`;
}
async function loadWeather(date) {
  const key = 'c_wx_' + date;
  const show = (r) => { const el = $('#wx'); if (el && r?.weather) el.innerHTML = `<h2>Wetter</h2>${wxCard(r.weather)}`; };
  const c = store.get(key); if (c && Date.now() - c.t < 30 * 60 * 1000) show(c.r);
  try { const r = await api('/weather?date=' + date); store.set(key, { t: Date.now(), r }); show(r); } catch { /* Wetter ist optional */ }
}

/** Kennzahlen der Aktivität als Kacheln. */
function statsCard(a) {
  const run = a.sport === 'running';
  const items = [
    ['Dauer', hm(a.duration_s)],
    a.distance_m > 500 ? ['Distanz', `${dec(a.distance_m / 1000, run ? 2 : 1)} km`] : null,
    run && a.distance_m > 500 ? ['Tempo', `${pace(a.duration_s / (a.distance_m / 1000))} /km`] : null,
    a.avg_hr ? ['Puls Ø', `${Math.round(a.avg_hr)} bpm`] : null,
    a.max_hr ? ['Puls max', `${Math.round(a.max_hr)} bpm`] : null,
    run && a.ascent_m ? ['Anstieg', `${Math.round(a.ascent_m)} m`] : null,
    run && a.avg_cadence ? ['Schrittfrequenz', `${Math.round(a.avg_cadence)} spm`] : null,
    a.te_aerobic != null ? ['Trainingseffekt', dec(a.te_aerobic, 1)] : null,
    a.rpe != null ? ['Anstrengung', `${a.rpe} / 10`] : null,
  ].filter(Boolean);
  return `<h2>Deine Einheit</h2><div class="card"><div class="astats">${items.map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join('')}</div></div>`;
}

/** Bewertung gegenüber der Vorgabe und Folgen für die nächsten Einheiten. */
function evalCard(ev) {
  if (!ev) return '';
  const col = ev.score == null ? '#8E8E93' : ev.score >= 85 ? '#34C759' : ev.score >= 70 ? '#30B0C7' : ev.score >= 55 ? '#FF9500' : '#FF3B30';
  const ring = ev.score == null ? '' : `<div class="evr" style="--c:${col};--p:${ev.score}"><b>${ev.score}</b></div>`;
  const checks = (ev.checks || []).map((c) => `<div class="evc"><span>${esc(c.label)}</span><i><u style="width:${Math.round(c.score * 100)}%;background:${c.score >= 0.75 ? '#34C759' : c.score >= 0.45 ? '#FF9500' : '#FF3B30'}"></u></i><small>${esc(c.note)}</small></div>`).join('');
  return `<h2>Bewertung</h2><div class="card ev"><div class="evh">${ring}<div><b>${esc(ev.verdict)}</b><small>${ev.free ? 'Einordnung ohne Vorgabe' : 'im Vergleich zur Vorgabe'}</small></div></div>${checks ? `<div class="evcs">${checks}</div>` : ''}${ev.impact?.length ? `<div class="evi"><h3>Wirkung auf die nächsten Einheiten</h3>${ev.impact.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : ''}</div>`;
}

/** Soll und Ist eines absolvierten Laufs mit Zonenanteilen und Kilometerzeiten (inkl. steigungskorrigiertem Tempo). */
/** Zonenbalken, Intervalle/harte Abschnitte und Kilometer-Dropdown eines Laufs. */
function runExtras(p, a, lthr) {
  const zs = a.zone_s || [], zt = zs.reduce((x, y) => x + y, 0);
  const zone = zt ? `<div class="si-zone"><div class="zb">${zs.map((s, i) => (s ? `<i style="flex:${s};background:${ZC[i]}"></i>` : '')).join('')}</div><div class="zt">${zs.map((s, i) => `<span>Z${i + 1} ${Math.round((s / zt) * 100)} %</span>`).join('')}</div></div>` : '';
  const sp = (a.splits || []).filter((s) => s.pace_s);
  let splits = '';
  if (sp.length) {
    const mn = Math.min(...sp.map((s) => s.pace_s)), mx = Math.max(...sp.map((s) => s.pace_s));
    splits = `<div class="splits"><div class="sp-h"><span>km</span><span></span><span>Tempo</span><span>GAP</span><span>Puls</span></div>${sp.map((s) => `<div class="sp"><span>${s.km}</span><i><u style="width:${(35 + (65 * (mx - s.pace_s)) / (mx - mn || 1)).toFixed(0)}%;background:${s.hr ? ZC[zoneOf(s.hr, lthr)] : '#C7C7CC'}"></u></i><span>${pace(s.pace_s)}</span><span class="mute">${s.gap_s && Math.abs(s.gap_s - s.pace_s) >= 3 ? pace(s.gap_s) : '–'}</span><span>${s.hr || '–'}</span></div>`).join('')}</div>`;
  }
  // Intervalle: je Wiederholung Pace und Puls gegenüber dem Soll
  const st = p.structure?.type, segs = (a.segments || []).filter((s) => s.pace_s);
  const work = (p.profile || []).find((x) => ['int', 'thr', 'mar', 'rep'].includes(x.k));
  let reps = '';
  const freeSegs = p.free && segs.length >= 2;
  if (freeSegs || (p.kind === 'run_quality' && st && st !== 'strides' && st !== 'easy' && segs.length)) {
    const tp = freeSegs ? null : work?.pace_s;
    reps = `<h2>${freeSegs ? 'Harte Abschnitte' : st === 'tempo' || st === 'test30' ? 'Tempoteil' : 'Intervalle'}</h2><div class="card"><div class="splits"><div class="sp-h iv"><span>Nr.</span><span>Dauer</span><span>Tempo</span><span>Soll</span><span>Puls</span></div>${segs.map((s, i) => `<div class="sp iv"><span>${i + 1}</span><span>${hm(s.dur_s)}</span><b>${pace(s.pace_s)}</b><span class="mute">${tp ? `${pace(tp)} <em class="${Math.abs(s.pace_s - tp) <= 6 ? 'ok' : 'off'}">${s.pace_s - tp > 0 ? '+' : s.pace_s - tp < 0 ? '−' : '±'}${Math.abs(s.pace_s - tp)}</em>` : '–'}</span><span>${s.hr || '–'}${s.hr_end ? `<small class="mute"> / ${s.hr_end}</small>` : ''}</span></div>`).join('')}</div><p class="fine ivn">Tempo in min/km, Puls Ø / letzte 30 s. Abweichung vom Soll in s/km.</p></div>`;
  }
  const kmBlock = splits ? `<details class="card fold kmfold"><summary><div class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg></div><b>Pace pro Kilometer</b><span class="cnt">${sp.length}</span>${CHEV}</summary><div class="kmbody">${splits}</div></details>` : '';
  return { zone, reps, km: kmBlock };
}

function sollIst(p, a, lthr) {
  const t = p.targets || {};
  const km = a.distance_m / 1000, pc = a.duration_s / km;
  const tone = (ok) => (ok ? 'ok' : 'off');
  const row = (l, plan, act, dl, ok) => `<div class="si-row"><span>${l}</span><span class="si-p">${plan || '–'}</span><b>${act}</b><em class="${tone(ok)}">${dl || ''}</em></div>`;
  const sgn = (v, n, u) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${dec(Math.abs(v), n)} ${u}`;
  const rows = [];
  if (t.distance_km) rows.push(row('Distanz', `${dec(t.distance_km, 1)} km`, `${dec(km, 1)} km`, sgn(km - t.distance_km, 1, 'km'), Math.abs(km / t.distance_km - 1) <= 0.1));
  else rows.push(row('Distanz', '', `${dec(km, 1)} km`, '', true));
  rows.push(row('Dauer', t.duration_min ? `${t.duration_min} min` : '', hm(a.duration_s), '', true));
  rows.push(row('Tempo /km', t.pace_s ? pace(t.pace_s) : '', pace(pc), t.pace_s ? sgn(pc - t.pace_s, 0, 's/km') : '', t.pace_s ? Math.abs(pc - t.pace_s) <= 8 : true));
  const hrOk = a.avg_hr && (t.hr_to ? a.avg_hr <= t.hr_to + 3 && (!t.hr_from || a.avg_hr >= t.hr_from - 6) : true);
  rows.push(row('Puls Ø bpm', t.hr_to ? `${t.hr_from ? t.hr_from + '–' : 'bis '}${t.hr_to}` : '', a.avg_hr ? `${Math.round(a.avg_hr)}` : '–', '', hrOk));
  if (a.rpe != null) rows.push(row('Anstrengung', '', `${a.rpe} / 10`, '', true));
  const ex = runExtras(p, a, lthr);
  return `<h2>Soll und Ist</h2><div class="card si"><div class="si-head"><span></span><span>Plan</span><span>Ist</span><span></span></div>${rows.join('')}${ex.zone}${a.ascent_m ? `<p class="fine">${Math.round(a.ascent_m)} m Anstieg${a.cad ? ' · ' + Math.round(a.cad) + ' spm' : ''}</p>` : ''}</div>${ex.reps}${ex.km}`;
}

function runCard(d) {
  const p = d.plan, t = p.targets || {}, color = KIND_COLOR.running;
  const big = [];
  if (t.distance_km) big.push(['Distanz', dec(t.distance_km, 1), ' km']);
  if (t.duration_min) big.push(['Dauer', String(t.duration_min), ' min']);
  if (t.pace_s) big.push(['Tempo', pace(t.pace_s), ' /km']);
  let zone = '';
  if (t.hr_from && p.structure?.type !== 'strides') {
    const zi = zoneOf((t.hr_from + t.hr_to) / 2, d.thresholds.lthr);
    zone = `<div class="zone"><div class="zl"><span>Zielpuls</span><span class="mute">${t.hr_from}–${t.hr_to} bpm</span></div><div class="zb">${ZC.map((c, i) => `<i style="flex:${i === 0 ? 3 : 1};background:${c};opacity:${i === zi ? 1 : 0.4}"></i>`).join('')}</div><div class="zt">${['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map((z, i) => `<span${i === zi ? ' class="on"' : ''}>${z}</span>`).join('')}</div></div>`;
  }
  const steps = (p.steps || []).map((s) => `<div class="line"><span class="ln">${esc(s.label)}</span><span class="lv">${esc(s.detail)}</span></div>`).join('');
  return `<div class="card hero" style="--a:${color}"><div class="hero-top"><div class="ht-text"><div class="kicker" style="color:${color}">${esc(nice(p.label))}</div><div class="hero-title">${esc(p.title)}</div></div>${d.stat ? statChip(d.stat) : ''}</div>
    ${big.length ? `<div class="bigs">${big.map(([l, v, u]) => `<div><span>${l}</span><b>${esc(v)}<small>${u}</small></b></div>`).join('')}</div>` : ''}${profileChart(p.profile)}${zone}
    ${steps ? `<div class="lines">${steps}</div>` : `<p class="blurb">${esc(p.summary || '')}</p>`}${garminBtn(d.garmin, p.date)}</div>`;
}
function otherCard(d) {
  const p = d.plan, rest = p.kind === 'rest', color = rest ? '#8E8E93' : KIND_COLOR.spinning;
  const steps = (p.steps || []).map((s) => `<div class="line"><span class="ln">${esc(s.label)}</span><span class="lv">${esc(s.detail)}</span></div>`).join('');
  return `<div class="card hero" style="--a:${color}"><div class="hero-top"><div class="ht-text"><div class="kicker" style="color:${color}">${esc(nice(p.label))}</div><div class="hero-title">${esc(p.title)}</div></div>${d.stat ? statChip(d.stat) : ''}</div>
    ${p.targets?.duration_min ? `<div class="bigs"><div><span>Dauer</span><b>${p.targets.duration_min}<small> min</small></b></div></div>` : ''}<p class="blurb">${esc(p.summary || '')}</p>${steps ? `<div class="lines">${steps}</div>` : ''}</div>`;
}
const CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
function infoCard(d, collapsible = false) {
  const p = d.plan, rd = d.readiness, why = p.why || [];
  const adjusted = !!p.adjusted;
  const lines = why.length ? why.map((w) => w.text) : rd.signals?.length ? rd.signals.map((s) => s.text) : ['Erholung und Belastung liegen im Normalbereich.'];
  if (collapsible && d.training_status) lines.unshift(`Trainingsstatus ${d.training_status.label}: ${d.training_status.text}`);
  const title = adjusted ? 'Heute angepasst' : why.length ? 'So wurde geplant' : 'Heute nicht angepasst';
  const ico = '<div class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg></div>';
  const list = `<ul class="why">${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  if (collapsible) return `<details class="card info fold" data-why>${`<summary>${ico}<b>${title}</b><span class="cnt">${lines.length}</span>${CHEV}</summary>`}${list}</details>`;
  return `<div class="card info">${ico}<div><b>${title}</b>${list}</div></div>`;
}

const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function fitCard(d) {
  const f = d.fitness; if (!f) return '';
  const c = d.cycle;
  const conf = { hoch: 'hoch', mittel: 'mittel', niedrig: 'niedrig' }[f.confidence];
  const evid = f.anchor ? `Beleg vom ${f.anchor.date.slice(8, 10)}.${f.anchor.date.slice(5, 7)}.` : 'noch ohne harten Lauf';
  const delta = f.history?.filter((x) => x != null);
  const dv = delta && delta.length >= 2 ? Math.round((delta.at(-1) - delta[0]) * 10) / 10 : null;
  return `<h2>Leistungsstand</h2><div class="card fitcard"><div class="stars"><div class="star main"><small>VDOT</small><strong><em data-count="${f.vdot}" data-dec="1">${dec(f.vdot, 1)}</em></strong>${dv != null && Math.abs(dv) >= 0.1 ? `<span class="dv ${dv > 0 ? 'up' : 'down'}">${dv > 0 ? '▲' : '▼'} ${dec(Math.abs(dv), 1)} in 8 Wochen</span>` : ''}</div>
    <div class="star"><small>Halbmarathon</small><strong>${hms(f.predictions.hm)}</strong></div><div class="star"><small>Schwelle</small><strong>${pace(f.paces.threshold)}</strong></div></div>
    ${f.history?.filter((x) => x != null).length >= 2 ? `<div class="kspark wide">${spark(f.history, KIND_COLOR.running)}</div>` : ''}
    <p class="fine">Locker ${pace(f.paces.easy)} · Intervall ${pace(f.paces.interval)} /km · ${evid} · Sicherheit ${conf}</p>
    ${c ? `<p class="fine"><b>${c.deload ? 'Entlastungswoche' : `Belastungswoche ${c.week} von 3`}</b> · Wochenziel ${Math.round(c.target_km)} km (letzte Woche ${Math.round(c.last_km)} km)</p>` : ''}</div>`;
}

const STATUS = [[null, 'Offen'], ['done', 'Erledigt'], ['skipped', 'Ausgefallen']];
const SI = {
  open: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg>',
  done: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/></svg>',
  skipped: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/></svg>',
};
function statChip({ date, status }) {
  const k = status || 'open', lab = { open: 'Offen', done: 'Erledigt', skipped: 'Ausgefallen' }[k];
  return `<div class="stat" data-statdate="${date}"><button type="button" class="chip ${k}" aria-haspopup="menu" aria-expanded="false">${SI[k]}<span>${lab}</span></button>
    <div class="menu" role="menu" hidden>${STATUS.map(([s, tx]) => `<button type="button" role="menuitem" data-status="${s ?? ''}" class="${(status || '') === (s ?? '') ? 'on' : ''}">${SI[s || 'open']}<span>${tx}</span></button>`).join('')}</div></div>`;
}
async function setStatus(date, status) {
  await api('/day/status', { date, status: status || null });
  ['c_today', 'c_week'].forEach((k) => store.del(k));
}
function bindStatus(root, date, after) {
  const st = $('.stat', root); if (!st) return;
  const chip = $('.chip', st), menu = $('.menu', st);
  const close = () => { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', away, true); };
  const away = (e) => { if (!st.contains(e.target)) close(); };
  chip.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; chip.setAttribute('aria-expanded', String(open)); if (open) document.addEventListener('click', away, true); });
  $$('[data-status]', menu).forEach((b) => b.addEventListener('click', async () => {
    close();
    try { await setStatus(date, b.dataset.status); toast(b.dataset.status === 'done' ? 'Als erledigt markiert' : b.dataset.status === 'skipped' ? 'Als ausgefallen markiert' : 'Status zurückgesetzt'); after(); } catch (e) { toast(e.message); }
  }));
}

function drawToday(d, stale) {
  const p = d.plan, g = group(p.kind);
  const head = `<div class="head"><div class="eyebrow">${new Date(d.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}${stale ? ' · offline' : ''}</div><h1>Heute</h1></div>`;
  let html = head + pills(d) + cockpit(d);
  html += g === 'strength' && d.session ? heuteKraftCard(d) : g === 'run' ? runCard({ ...d, garmin: d.garmin, stat: p.kind !== 'rest' ? { date: d.date, status: d.status } : null }) : otherCard({ ...d, stat: p.kind !== 'rest' ? { date: d.date, status: d.status } : null });
  if (g === 'run') html += `<div id="wx"></div>` + fitCard(d);
  html += infoCard(d, true);
  const main = d.evaluation ? d.done.find((x) => x.id === d.evaluation.activity_id) : null;
  if (main) html += statsCard(main) + evalCard(d.evaluation) + (main.sport === 'running' ? '<button type="button" class="link solo" id="siBtn">Soll und Ist mit Kilometerzeiten ansehen</button>' : '');
  const rest = d.done.filter((x) => !main || x.id !== main.id);
  if (rest.length) html += `<h2>${main ? 'Weitere Aktivitäten' : 'Heute erledigt'}</h2><div class="card">${rest.map((a) => `<div class="row"><span>${SPORT[a.sport] || a.sport}</span><span class="muted">${hm(a.duration_s)}${a.distance_m > 500 ? ' · ' + (a.distance_m / 1000).toFixed(1).replace('.', ',') + ' km' : ''}${a.avg_hr ? ' · ' + Math.round(a.avg_hr) + ' bpm' : ''}</span></div>`).join('')}</div>`;
  html += `<div class="subrow"><button type="button" class="subtle" id="painBtn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>Schmerz melden</button>${p.kind !== 'rest' ? `<button type="button" class="subtle" id="unfitBtn">${d.unfit ? 'Nicht fit zurücknehmen' : 'Heute nicht fit'}</button>` : ''}</div>`;
  app.innerHTML = html;
  $$('[data-go]', app).forEach((b) => b.addEventListener('click', () => go(b.dataset.go, { kind: b.dataset.kind, blank: !!b.dataset.blank })));
  play(app, 'today');
  $('#painBtn')?.addEventListener('click', () => openPain(d.date));
  $('#siBtn')?.addEventListener('click', () => go('day', { date: d.date }));
  $('#unfitBtn')?.addEventListener('click', async () => {
    try { await api('/day/unfit', { on: !d.unfit }); ['c_today', 'c_week'].forEach((k) => store.del(k)); toast(d.unfit ? 'Zurückgenommen' : 'Einheit wird angepasst'); render(); } catch (e) { toast(e.message); }
  });
  if (g === 'run') loadWeather(d.date);
  bindStatus(app, d.date, () => render());
  bindGarmin(app, () => render());
}


// ---- Garmin: Verbinden und Trainings an die Uhr senden ------------------------
function openGarminConnect(onDone) {
  let mfaState = null;
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Mit Garmin verbinden"><div class="grabber"></div><h3>Mit Garmin verbinden</h3>
    <p class="muted" id="gcInfo">Damit die App Trainings an deine Uhr senden kann, melde dich einmal bei Garmin Connect an. Das Passwort wird nicht gespeichert, nur ein Anmelde-Token.</p>
    <div id="gcCred"><input class="txt" id="gcMail" type="email" placeholder="Garmin E-Mail" autocomplete="username" autocapitalize="off"><input class="txt" id="gcPass" type="password" placeholder="Passwort" autocomplete="current-password"></div>
    <div id="gcMfa" hidden><input class="txt" id="gcCode" inputmode="numeric" placeholder="Code aus E-Mail oder App" autocomplete="one-time-code"></div>
    <button type="button" class="cta" id="gcGo">Verbinden</button><button type="button" class="link" id="gcCancel">Abbrechen</button></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 250); };
  $('.sheet-bg', el).onclick = close; $('#gcCancel', el).onclick = close;
  $('#gcGo', el).onclick = async () => {
    const btn = $('#gcGo', el); btn.disabled = true; btn.textContent = 'Verbinde …';
    try {
      const r = mfaState ? await api('/garmin/verify-mfa', { mfaCode: $('#gcCode', el).value.trim(), mfaState }) : await api('/garmin/connect', { email: $('#gcMail', el).value, password: $('#gcPass', el).value });
      if (r.mfaRequired) {
        mfaState = r.mfaState;
        $('#gcCred', el).hidden = true; $('#gcMfa', el).hidden = false;
        $('#gcInfo', el).textContent = 'Garmin hat dir einen Bestätigungscode geschickt. Gib ihn hier ein.';
        btn.textContent = 'Bestätigen'; btn.disabled = false; $('#gcCode', el).focus();
        return;
      }
      toast('Mit Garmin verbunden'); close(); onDone?.();
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = mfaState ? 'Bestätigen' : 'Verbinden'; }
  };
}

/** Sendet die Einheit des Tages an Garmin; verbindet vorher, falls nötig. */
async function sendToGarmin(date, connected, after) {
  const run = async () => {
    try {
      const r = await api('/garmin/send', { date });
      ['c_today', 'c_week'].forEach((k) => store.del(k));
      toast(r.provisional ? 'Gesendet (Vorschau, wird am Tag angepasst)' : 'An Garmin gesendet');
      after();
    } catch (e) { if (e.message && /neu verbinden|nicht mit Garmin/i.test(e.message)) openGarminConnect(run); else toast(e.message); }
  };
  if (!connected) return openGarminConnect(run);
  await run();
}
function garminBtn(g, date) {
  if (!g?.can) return '';
  return `<div class="gsend"><button type="button" class="link" data-garmin="${date}" data-conn="${g.connected ? 1 : 0}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 13V9M9.5 3h5"/></svg>${g.sent ? 'Erneut an Garmin senden' : 'An Garmin senden'}</button>${g.sent ? `<small class="muted">Gesendet: ${esc(g.sent.name)}</small>` : ''}</div>`;
}
function bindGarmin(root, after) {
  $$('[data-garmin]', root).forEach((b) => b.addEventListener('click', () => sendToGarmin(b.dataset.garmin, b.dataset.conn === '1', after)));
}

function openPain(date) {
  let level = null;
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Schmerz melden"><div class="grabber"></div><h3>Schmerz melden</h3><p class="muted">Wie stark ist der Schmerz gerade? Ab 4 von 10 ersetzt die App belastende Übungen.</p>
    <div class="pain">${[0, 2, 4, 6, 8, 10].map((n) => `<button type="button" data-lv="${n}">${n}</button>`).join('')}</div>
    <input class="txt" id="painArea" placeholder="Wo? z. B. Knie, Achillessehne" autocomplete="off" hidden>
    <button type="button" class="cta" id="painSave" disabled>Speichern</button><button type="button" class="link" id="painCancel">Abbrechen</button></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 250); };
  $('.sheet-bg', el).onclick = close; $('#painCancel', el).onclick = close;
  $$('[data-lv]', el).forEach((b) => b.addEventListener('click', () => {
    level = Number(b.dataset.lv);
    $$('[data-lv]', el).forEach((x) => x.classList.toggle('on', x === b));
    $('#painArea', el).hidden = level < 4; $('#painSave', el).disabled = false;
  }));
  $('#painSave', el).onclick = async () => {
    try { await api('/pain', { level, area: level >= 4 ? ($('#painArea', el).value.trim() || null) : null, date }); toast('Notiert'); close(); } catch (e) { toast(e.message); }
  };
}

// ---- Tagesansicht (Läufe, Spinning) -------------------------------------------
async function viewDay(app, { date, nav }) {
  let data = null;
  const draw = (d) => {
    data = d;
    const p = d.week.find((x) => x.date === date) || d.week[0];
    const g = group(p.kind), past = date <= d.today;
    const fake = { plan: p, thresholds: { lthr: d.lthr }, stat: past ? { date, status: p.status } : null, garmin: date >= d.today ? { can: p.garmin_can, sent: p.garmin_sent, connected: d.garmin_connected } : null };
    const wd = new Date(date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    app.innerHTML = `<button type="button" class="back" data-act="back">${icon.back}Woche</button>
      <div class="head"><div class="eyebrow">${wd}${date === d.today ? ' · heute' : ''}</div><h1>${esc(nice(p.label).replace(/ \(.*/, '').split(' · ')[0])}</h1></div>
      ${g === 'run' ? runCard(fake) : otherCard(fake)}
      ${p.evaluation && (p.done || []).find((x) => x.id === p.evaluation.activity_id) ? statsCard(p.done.find((x) => x.id === p.evaluation.activity_id)) + evalCard(p.evaluation) : ''}
      ${g === 'run' && past && (p.done || []).some((a) => a.sport === 'running') ? sollIst(p, [...p.done].filter((a) => a.sport === 'running').sort((x, y) => y.distance_m - x.distance_m)[0], d.lthr) : ''}
      ${!past ? '<div class="card info"><div class="ico">' + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg></div><div><b>Vorläufig</b><p>Das ist der geplante Ablauf. Am Tag selbst passt die App die Einheit an deine Erholung an, etwa bei schlechtem Schlaf oder hoher Belastung.</p></div></div>' : ''}
      ${(p.why || []).length ? infoCard({ plan: p, readiness: { signals: [] } }) : ''}
`;
    $('[data-act=back]', app).onclick = () => nav('back');
    bindStatus(app, date, () => { store.del('c_week'); viewDay(app, { date, nav }); });
    bindGarmin(app, () => viewDay(app, { date, nav }));
  };
  const cached = store.get('c_week');
  if (cached) draw(cached);
  else app.innerHTML = '<p class="muted center-text">Lädt …</p>';
  try { const d = await api('/week'); store.set('c_week', d); if (JSON.stringify(d) !== JSON.stringify(cached)) draw(d); } catch (e) { if (!cached) throw e; }
}


// ---- Aktivitäten: Liste der letzten 30 Tage und Einzelansicht ------------------
const ACT_COLOR = { running: '#FF6B2C', strength: '#AF52DE', cycling: '#0A84FF' };
const actTitle = (a) => (a.sport === 'running' && a.distance_m > 500 ? `Lauf ${dec(a.distance_m / 1000, 1)} km` : SPORT[a.sport] === 'Rad' ? 'Radfahren' : SPORT[a.sport] || a.sport);
async function viewActs(app, { nav }) {
  const draw = (d) => {
    const byDate = {};
    d.activities.forEach((a) => (byDate[a.date] ||= []).push(a));
    const day = (iso) => new Date(iso + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const rows = Object.keys(byDate).sort().reverse().map((iso) => `<h2>${iso === d.today ? 'Heute' : day(iso)}</h2><div class="group">${byDate[iso].map((a) => `<button type="button" class="srow btn arow" data-act="${a.id}"><i class="abar" style="background:${ACT_COLOR[a.sport] || '#8E8E93'}"></i><span class="at"><b>${esc(actTitle(a))}${a.extra ? '<em class="xtag">zusätzlich</em>' : ''}</b><small>${[hm(a.duration_s), a.sport === 'running' && a.distance_m > 500 ? pace(a.duration_s / (a.distance_m / 1000)) + ' /km' : '', a.avg_hr ? Math.round(a.avg_hr) + ' bpm' : ''].filter(Boolean).join(' · ')}</small></span>${CHEV_R}</button>`).join('')}</div>`).join('');
    app.innerHTML = `<button type="button" class="back" data-back>${icon.back}Woche</button><div class="head"><div class="eyebrow">Letzte 30 Tage</div><h1>Aktivitäten</h1></div>${rows || '<p class="muted center-text">Keine Aktivitäten in den letzten 30 Tagen.</p>'}`;
    $('[data-back]', app).onclick = () => nav('back');
    $$('[data-act]', app).forEach((b) => b.addEventListener('click', () => go('act', { id: b.dataset.act })));
  };
  const cached = store.get('c_acts');
  if (cached) draw(cached); else app.innerHTML = '<p class="muted center-text">Lädt …</p>';
  try { const d = await api('/activities'); store.set('c_acts', d); if (JSON.stringify(d) !== JSON.stringify(cached)) draw(d); } catch (e) { if (!cached) throw e; }
}

async function viewAct(app, { id, nav }) {
  const draw = (r) => {
    const a = r.activity, ev = r.evaluation;
    const when = new Date(a.local_date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    let body = statsCard(a) + evalCard(ev);
    if (a.sport === 'running') {
      if (r.plan && !ev?.free && a.distance_m > 1500) body += sollIst(r.plan, { ...a, cad: a.avg_cadence }, r.lthr);
      else { const ex = runExtras({ free: true }, a, r.lthr); body += (ex.zone ? `<h2>Intensität</h2><div class="card">${ex.zone}</div>` : '') + ex.reps + ex.km; }
    }
    app.innerHTML = `<button type="button" class="back" data-back>${icon.back}Zurück</button><div class="head"><div class="eyebrow">${when}</div><h1>${esc(actTitle(a))}</h1></div>${ev?.free ? `<div class="card info"><div><b>Außerhalb des Plans</b><p>${r.planned_label ? 'Für diesen Tag war „' + esc(nice(r.planned_label).replace(/ \(.*/, '')) + '“ vorgesehen.' : 'Für diesen Tag war keine passende Einheit vorgesehen.'} Die Einheit fließt trotzdem in deine Belastung ein.</p></div></div>` : ''}${body}`;
    $('[data-back]', app).onclick = () => nav('back');
  };
  const key = 'c_act_' + id, cached = store.get(key);
  if (cached) draw(cached); else app.innerHTML = '<p class="muted center-text">Lädt …</p>';
  try { const r = await api('/activity/' + id); store.set(key, r); if (JSON.stringify(r) !== JSON.stringify(cached)) draw(r); } catch (e) { if (!cached) throw e; }
}

// ---- Woche -----------------------------------------------------------------
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const dm = (iso) => `${Number(iso.slice(8, 10))}. ${MON[Number(iso.slice(5, 7)) - 1]}`;
const check = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="erledigt" role="img"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>';
let weekEdit = null; // {order:[Plan], sel:null|index} solange die Woche bearbeitet wird
const GRIP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>';
const isDone = (p) => p.status === 'done' || (p.status !== 'skipped' && p.done?.length > 0);
const RING = { open: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>', skipped: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>' };
const SPC = { run: KIND_COLOR.running, strength: KIND_COLOR.strength, spin: KIND_COLOR.spinning, other: '#8E8E93', done: '#34C759' };
function consCard(c, today) {
  const cells = c.rows.flatMap((r) => r.cells).map((x) => {
    const col = x.s.map((k) => SPC[k]);
    const bg = col.length === 0 ? '' : col.length === 1 ? col[0] : `linear-gradient(135deg,${col[0]} 50%,${col[1]} 50%)`;
    return `<i class="cc${x.future ? ' fut' : ''}${x.skip && !x.s.length ? ' skip' : ''}${x.date === today ? ' now' : ''}"${bg ? ` style="background:${bg}"` : ''} title="${x.date.slice(8, 10)}.${x.date.slice(5, 7)}."></i>`;
  }).join('');
  return `<h2>Konsistenz</h2><div class="card cons"><div class="cons-top"><div><b>${c.streak}</b><small>${c.streak === 1 ? 'Woche' : 'Wochen'} in Folge mit 3+ aktiven Tagen</small></div><div class="r"><b>${c.active_days}</b><small>aktive Tage in ${c.weeks} Wochen</small></div></div><div class="cgrid" style="grid-template-columns:repeat(${c.rows.length},1fr)">${cells}</div><div class="plg"><span><i style="background:${SPC.run}"></i>Laufen</span><span><i style="background:${SPC.strength}"></i>Kraft</span><span><i style="background:${SPC.spin}"></i>Spinning / Rad</span>${c.rows.some((r) => r.cells.some((x) => x.s.includes('other'))) ? `<span><i style="background:${SPC.other}"></i>Sonstiges</span>` : ''}</div></div>`;
}
async function loadReview(todayIso) {
  const open = [1, 2].includes(new Date(todayIso + 'T12:00').getDay()); // Montag und Dienstag
  const show = (r) => {
    const el = $('#rv'); if (!el || !r?.lines) return;
    const stat = (v, l) => `<div><b>${v}</b><small>${l}</small></div>`;
    el.innerHTML = `<details class="card fold review"${open ? ' open' : ''}><summary><div class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg></div><b>Rückblick ${dm(r.monday)} – ${dm(r.to)}</b>${CHEV}</summary><div class="rv-body"><div class="rv-stats">${stat(dec(r.km, 1) + ' km', 'Umfang')}${stat(r.sessions_planned ? `${r.sessions_done}/${r.sessions_planned}` : String(r.runs), r.sessions_planned ? 'Einheiten' : 'Läufe')}${stat(r.easy_pct != null ? r.easy_pct + ' %' : '–', 'locker')}</div><ul class="why">${r.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></details>`;
  };
  const c = store.get('c_review'); if (c) show(c);
  try { const r = await api('/review'); store.set('c_review', r); show(r); } catch { /* Rückblick ist optional */ }
}
function drawWeek(d, stale) {
  const w = weekEdit ? weekEdit.order : d.week; // Tage (Datum) bleiben, Einheiten wandern
  const dates = d.week.map((p) => p.date);
  const c = { run: [0, 0], strength: [0, 0], spin: [0, 0] };
  d.week.forEach((p) => { const g = group(p.kind); if (c[g]) { c[g][1]++; if (isDone(p)) c[g][0]++; } });
  const b0 = d.week[0]?.block;
  const tgt = d.target_km || 0, dn = d.done_km || 0, pct = tgt ? Math.min(1, dn / tgt) : 0;
  const dots = [['Laufen', c.run, KIND_COLOR.running], ['Kraft', c.strength, KIND_COLOR.strength], ['Spinning', c.spin, KIND_COLOR.spinning]].filter(([, v]) => v[1]).map(([l, v, col]) => `<span><i style="background:${col}"></i>${l} ${v[0]}/${v[1]}</span>`).join('');
  const wk = `<div class="card wkcard">${ringHtml({ p: pct, color: KIND_COLOR.running, size: 92, sw: 9, center: `<b><em data-count="${Math.round(pct * 100)}" data-dec="0">${Math.round(pct * 100)}</em><i>%</i></b>` })}<div class="wk-text"><div class="wk-km"><b><em data-count="${dn}" data-dec="1">${dec(dn, 1)}</em></b><span> von ${dec(tgt, tgt % 1 ? 1 : 0)} km</span></div><div class="wk-sub">Laufumfang diese Woche</div><div class="wk-dots">${dots}</div></div></div>`;
  const locked = (p, i) => p.fixed || dates[i] < d.today || d.week[i].done?.length > 0 || d.week[i].fixed;
  const anyMoved = d.week.some((p) => p.moved);
  app.innerHTML = `<div class="head row-head"><div><div class="eyebrow">${dm(dates[0])} – ${dm(dates[6])}${b0 ? ' · ' + esc(b0.label) + ', Woche ' + b0.week : ''}${stale ? ' · offline' : ''}</div><h1>Woche</h1></div><button type="button" class="textbtn" id="wedit">${weekEdit ? 'Fertig' : 'Bearbeiten'}</button></div>
    ${weekEdit ? '<p class="foot edit-hint">Ziehe eine Einheit am Griff auf einen anderen Tag oder tippe zwei Tage nacheinander an, um sie zu tauschen. Spinning und vergangene Tage bleiben fest.</p>' : wk}
    ${weekEdit ? '' : '<div id="rv"></div>'}
    <div class="days${weekEdit ? ' editing' : ''}" id="days">${w.map((p, i) => {
    const g = group(p.kind), t = p.targets || {}, today = dates[i] === d.today, rest = g === 'rest', lock = locked(p, i);
    const col = { run: '#FF6B2C', strength: '#AF52DE', spin: '#0A84FF' }[g];
    const moved = weekEdit ? p.date !== dates[i] || p.moved : p.moved;
    const extraTxt = rest && (d.week[i].done || []).length ? 'Zusätzlich: ' + (d.week[i].done || []).map((x) => (SPORT[x.sport] || x.sport) + (x.distance_m > 1500 ? ' ' + dec(x.distance_m / 1000, 1) + ' km' : '')).join(', ') : '';
    const meta = [rest ? extraTxt : (p.title || '').replace(/^Kraft [AB]: /, ''), moved ? 'verschoben' : d.week[i].status === 'skipped' ? 'ausgefallen' : p.provisional && !rest ? 'vorläufig' : ''].filter(Boolean).join(' · ');
    const act = d.week[i].done || [];
    const unit = g === 'run' ? 'km' : 'min';
    const planV = g === 'run' ? t.distance_km : t.duration_min;
    const actV = g === 'run' ? act.filter((x) => x.sport === 'running').reduce((s, x) => s + (x.distance_m || 0), 0) / 1000 : act.reduce((s, x) => s + (x.duration_s || 0), 0) / 60;
    const fmtV = (v) => (g === 'run' ? dec(v, 1) : String(Math.round(v)));
    const pv = rest || weekEdit || (!planV && !(actV > 0)) ? '' : actV > 0.05 ? `<div class="pv"><b style="color:${col}">${fmtV(actV)}</b><small>${planV ? `/ ${fmtV(planV)} ` : ''}${unit}</small></div>` : `<div class="pv plan${d.week[i].status === 'skipped' ? ' skip' : ''}"><b>${fmtV(planV)}</b><small>${unit}</small></div>`;
    return `<div class="day${today ? ' today' : ''}${rest ? ' rest' : ''}${weekEdit && lock ? ' lock' : ''}${weekEdit && weekEdit.sel === i ? ' sel' : ''}" data-i="${i}"${rest && extraTxt && !weekEdit ? ` data-actid="${d.week[i].done[0].id}"` : ''}${!rest && !weekEdit ? ` data-open="${dates[i]}" data-kind="${g === 'strength' ? p.kind : ''}"` : ''}><div class="dd"><span>${esc(d.week[i].weekday.slice(0, 2))}</span><b>${Number(dates[i].slice(8, 10))}</b></div>${rest ? '' : `<i class="dbar" style="background:${col}"></i>`}<div class="dt"><b>${esc(rest ? 'Ruhetag' : nice(p.label).replace(/ \(.*/, ''))}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</div>${pv}${weekEdit ? (lock ? '' : `<span class="grip" data-grip="${i}" aria-label="Verschieben">${GRIP}</span>`) : (!rest && dates[i] <= d.today) ? `<button type="button" class="ring" data-ring="${i}" aria-label="${isDone(d.week[i]) ? 'Als offen markieren' : 'Als erledigt markieren'}">${isDone(d.week[i]) ? check : d.week[i].status === 'skipped' ? RING.skipped : RING.open}</button>` : today ? '<span class="tbadge">Heute</span>' : ''}</div>`;
  }).join('')}</div>
    ${!weekEdit && d.consistency ? consCard(d.consistency, d.today) : ''}
    ${weekEdit ? '' : `<div class="group"><button type="button" class="srow btn" id="actsBtn"><i class="si2 orange"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg></i><span class="sl">Vergangene Aktivitäten</span><span class="muted">30 Tage</span>${CHEV_R}</button></div>`}
    ${weekEdit && (anyMoved || weekEdit.order.some((p, i) => p.date !== dates[i])) ? '<button type="button" class="link" id="wreset">Auf Standardwoche zurücksetzen</button>' : ''}`;
  if (!weekEdit) { play(app, 'week'); loadReview(d.today); } else rings(app, false);
  $$('.day[data-actid]', app).forEach((r) => r.addEventListener('click', () => go('act', { id: r.dataset.actid })));
  $('#actsBtn')?.addEventListener('click', () => go('acts'));
  $$('.day[data-open]', app).forEach((r) => r.addEventListener('click', (ev) => {
    if (ev.target.closest('.ring')) return;
    if (r.dataset.kind) go('prep', { kind: r.dataset.kind }); else go('day', { date: r.dataset.open });
  }));
  $$('.ring', app).forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const i = Number(b.dataset.ring);
    try { await setStatus(dates[i], isDone(d.week[i]) ? (d.week[i].auto ? 'skipped' : null) : 'done'); render(); } catch (e) { toast(e.message); }
  }));
  $('#wedit').onclick = async () => {
    if (!weekEdit) { weekEdit = { order: [...d.week], sel: null }; return drawWeek(d, stale); }
    const days = Object.fromEntries(dates.map((dt, i) => [dt, weekEdit.order[i].kind]));
    const changed = weekEdit.order.some((p, i) => p.date !== dates[i]);
    weekEdit = null;
    if (changed) { try { await api('/week/plan', { days }); store.del('c_today'); toast('Woche gespeichert'); } catch (e) { toast(e.message); } }
    render();
  };
  $('#wreset')?.addEventListener('click', async () => { try { await api('/week/plan', { reset: true }); store.del('c_today'); weekEdit = null; toast('Standardwoche'); render(); } catch (e) { toast(e.message); } });
  if (!weekEdit) return;
  const swap = (i, j) => { const o = weekEdit.order; [o[i], o[j]] = [o[j], o[i]]; weekEdit.sel = null; drawWeek(d, stale); };
  $$('.day', app).forEach((r) => r.addEventListener('click', () => {
    const i = Number(r.dataset.i); if (locked(weekEdit.order[i], i)) return;
    if (weekEdit.sel == null) { weekEdit.sel = i; drawWeek(d, stale); } else if (weekEdit.sel === i) { weekEdit.sel = null; drawWeek(d, stale); } else swap(weekEdit.sel, i);
  }));
  // Ziehen am Griff
  $$('.grip', app).forEach((g) => g.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const i = Number(g.dataset.grip), row = g.closest('.day'), rows = $$('.day', app);
    const y0 = ev.clientY; let target = -1, moved = false;
    g.setPointerCapture(ev.pointerId);
    const hit = (y) => rows.findIndex((r, k) => k !== i && !locked(weekEdit.order[k], k) && y >= r.getBoundingClientRect().top && y <= r.getBoundingClientRect().bottom);
    const mv = (e) => {
      const dy = e.clientY - y0; if (Math.abs(dy) > 4) moved = true;
      row.style.transform = `translateY(${dy}px)`; row.classList.add('drag');
      const h = hit(e.clientY); if (h !== target) { rows.forEach((r) => r.classList.remove('target')); if (h >= 0) rows[h].classList.add('target'); target = h; }
    };
    const up = () => {
      g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
      row.style.transform = ''; row.classList.remove('drag');
      if (moved) { g.addEventListener('click', (e) => e.stopPropagation(), { once: true, capture: true }); if (target >= 0) swap(i, target); else drawWeek(d, stale); }
    };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  }));
}

async function setupPush(first) {
  const box = $('#pushCard'); if (!box) return;
  const note = (txt) => { box.innerHTML = `<div class="muted" id="pushInfo">${txt}</div>`; };
  let pu = first;
  try { pu = await api('/push/state'); } catch { /* alten Stand zeigen */ }
  if (!pu?.ready) return note('Noch nicht eingerichtet: Auf dem Server fehlen die Push-Schlüssel (VAPID).');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return note('Auf diesem Gerät nicht verfügbar. Auf dem iPhone muss die App zum Home-Bildschirm hinzugefügt sein (iOS 16.4 oder neuer).');
  const reg = await navigator.serviceWorker.ready;
  const cur = await reg.pushManager.getSubscription();
  const sw = (on, attr) => `<button type="button" class="sw${on ? ' on' : ''}" role="switch" aria-checked="${on}" ${attr}><i></i></button>`;
  box.innerHTML = `<div class="nrow main"><div><b>Mitteilungen auf diesem Gerät</b><small>${cur ? 'Eingeschaltet' : 'Ausgeschaltet. Zum Empfangen hier einschalten.'}</small></div>${sw(!!cur, 'data-dev')}</div>
    <div class="ntypes${cur ? '' : ' off'}">${pu.types.map((n) => `<div class="nrow"><div><b>${esc(n.title)}</b><small>${esc(n.desc)}</small></div>${sw(n.on, `data-nid="${esc(n.id)}"`)}</div>`).join('')}</div>`;
  // Schalter reagiert sofort (optimistisch); Abo-Arbeit läuft im Hintergrund, kein Neuaufbau der Karte
  const dev = $('[data-dev]', box), devSub = $('.nrow.main small', box), types = $('.ntypes', box);
  const paint = (on) => {
    dev.classList.toggle('on', on); dev.setAttribute('aria-checked', String(on));
    types.classList.toggle('off', !on);
    devSub.textContent = on ? 'Eingeschaltet' : 'Ausgeschaltet. Zum Empfangen hier einschalten.';
  };
  let busy = false;
  dev.onclick = async () => {
    if (busy) return;
    busy = true;
    const want = !dev.classList.contains('on');
    paint(want);
    try {
      if (!want) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await api('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
        toast('Mitteilungen aus');
      } else {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Mitteilungen nicht erlaubt');
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(b64u.dec(pu.key)) });
        await api('/push/subscribe', { subscription: s.toJSON() }); toast('Mitteilungen an');
      }
    } catch (e) { paint(!want); toast(e.message); }
    busy = false;
  };
  $$('[data-nid]', box).forEach((b) => b.addEventListener('click', async () => {
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    try { await api('/push/prefs', { id: b.dataset.nid, on }); } catch (e) { b.classList.toggle('on', !on); b.setAttribute('aria-checked', String(!on)); toast(e.message); }
  }));
}

const CHEV_R = '<svg class="chr" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>';
async function viewMore(isCurrent = () => true) {
  const cached = store.get('c_more');
  const load = () => Promise.all([api('/settings'), api('/auth/state'), api('/push/state').catch(() => null), api('/garmin/state').catch(() => null)]).then(([s, st, pu, gs]) => ({ s, st, pu, gs }));
  if (cached) draw(cached);
  else app.innerHTML = '<div class="head"><h1>Profil</h1></div><p class="muted center-text">Lädt …</p>';
  const fresh = await load();
  store.set('c_more', fresh);
  if (isCurrent() && JSON.stringify(fresh) !== JSON.stringify(cached) && !app.contains(document.activeElement && document.activeElement.matches('input') ? document.activeElement : null)) draw(fresh);
  function draw({ s, st, pu, gs }) {
    const g = s.goal || {};
    const ts = s.thresholdSuggestion;
    const ic = (c, svg) => `<i class="si2 ${c}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg></i>`;
    const IC = {
      heart: ic('red', '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>'),
      bolt: ic('orange', '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>'),
      pace: ic('blue', '<circle cx="12" cy="13" r="7.5"/><path d="M12 13l3-3M9.5 3h5"/>'),
      easy: ic('green', '<path d="M3 17c3-6 6-6 9-2s6 3 9-4"/>'),
      cal: ic('purple', '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
      sync: ic('blue', '<path d="M20 11a8 8 0 00-14-4M4 5v4h4M4 13a8 8 0 0014 4M20 19v-4h-4"/>'),
      hist: ic('gray', '<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7M4 4v4h4M12 8v4l3 2"/>'),
      key: ic('gray', '<circle cx="8" cy="14" r="3.5"/><path d="M10.5 11.5L20 4M16 8l3 3"/>'),
      watch: ic('green', '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6l.7-3h4.6L15 6M9 18l.7 3h4.6l.7-3M12 10v2.5l1.5 1"/>'),
      plus: ic('blue', '<path d="M12 5v14M5 12h14"/>'),
    };
    const gt = g.time_s ? `${Math.floor(g.time_s / 3600)}:${String(Math.floor((g.time_s % 3600) / 60)).padStart(2, '0')}:${String(g.time_s % 60).padStart(2, '0')}` : '';
    const days = g.date ? Math.ceil((new Date(g.date + 'T12:00') - new Date()) / 86400000) : null;
    const sugg = ts && ts.lthr && ts.lthr !== s.lthr ? `<div class="card sugg"><div class="sg-t"><b>Neuer Schwellenpuls erkannt</b><small>Aus deinen letzten harten Läufen: ${ts.lthr} bpm statt ${s.lthr} bpm.</small></div><button class="pill-btn" id="applyTh">Übernehmen</button></div>` : '';
    const row = (icon, label, id, val, unit, attrs = '') => `<label class="srow">${icon}<span class="sl">${label}</span><input class="val" id="${id}" value="${val}" ${attrs}>${unit ? `<u>${unit}</u>` : ''}</label>`;
    app.innerHTML = `<div class="head row-head"><div><div class="eyebrow">Einstellungen</div><h1>Profil</h1></div><div class="avatar" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.4 7-5.4s6.1 1.8 7 5.4"/></svg></div></div>
    <div class="card goal"><div class="kicker">Halbmarathon-Ziel</div><input class="goalbig" id="gt" inputmode="numeric" value="${gt}" placeholder="1:50:00" aria-label="Zielzeit"><div class="goal-d"><span>${g.date ? (days > 0 ? `Wettkampf in ${days} ${days === 1 ? 'Tag' : 'Tagen'}` : 'Wettkampf') : 'Noch kein Termin'}</span><input class="val date" id="gd" type="date" value="${g.date || ''}" aria-label="Wettkampfdatum"></div></div>
    ${sugg}
    <h2>Puls und Tempo</h2><div class="group">
      ${row(IC.heart, 'Schwellenpuls', 'lthr', s.lthr, 'bpm', 'type="number" inputmode="numeric"')}
      ${row(IC.bolt, 'Maximalpuls', 'mhr', s.max_hr, 'bpm', 'type="number" inputmode="numeric"')}
      ${row(IC.pace, 'Schwellentempo', 'ltp', pace(s.lt_pace_s), '/km', 'inputmode="numeric"')}
      ${row(IC.easy, 'Lockeres Tempo', 'ezp', pace(s.easy_pace_s), '/km', 'inputmode="numeric"')}
    </div><p class="gfoot">Das Schwellentempo ist nur der Startwert. Sobald harte Läufe vorliegen, berechnet die App den Leistungsstand daraus selbst.</p>
    <h2>Mitteilungen</h2><div class="group" id="pushCard"><div class="muted pad" id="pushInfo">Lädt …</div></div>
    <h2>Garmin</h2><div class="group">
      <button type="button" class="srow btn" id="sync">${IC.sync}<span class="sl">Jetzt synchronisieren</span>${CHEV_R}</button>
      <button type="button" class="srow btn" id="hist">${IC.hist}<span class="sl">Verlauf ab 01.01. laden</span>${CHEV_R}</button>
      <button type="button" class="srow btn" id="gConn">${IC.watch}<span class="sl">Trainings an die Uhr senden</span><span class="gstate${gs?.connected ? ' on' : ''}">${gs?.connected ? 'Verbunden' : 'Verbinden'}</span>${CHEV_R}</button>
      ${gs?.connected ? '<button type="button" class="srow btn out2" id="gOff"><span class="sl">Garmin-Verbindung trennen</span></button>' : ''}
    </div><p class="gfoot" id="syncInfo">Holt neue Aktivitäten und Gesundheitsdaten.</p>
    <h2>Sicherheit</h2><div class="group">
      ${(st.passkeys || []).map((k) => `<div class="srow">${IC.key}<span class="sl">${esc(k.label || 'Gerät')}</span><span class="muted">${esc((k.created_at || '').slice(0, 10).split('-').reverse().join('.'))}</span></div>`).join('')}
      <button type="button" class="srow btn" id="addPk">${IC.plus}<span class="sl blue">Dieses Gerät hinzufügen</span></button>
    </div>
    <div class="group"><button type="button" class="srow btn out" id="out"><span class="sl">Abmelden</span></button></div>`;
    $('#applyTh')?.addEventListener('click', async () => { try { await api('/threshold/apply', {}); toast('Übernommen'); ['c_more', 'c_today', 'c_week'].forEach((k) => store.del(k)); render(); } catch (e) { toast(e.message); } });
    const parseT = (v) => { const p = v.trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN; };
    // Änderungen werden direkt gespeichert, sobald ein Feld verlassen wird
    const save = async () => {
      const times = { gt: $('#gt').value, ltp: $('#ltp').value, ezp: $('#ezp').value };
      if (Object.values(times).some((v) => v.trim() && !Number.isFinite(parseT(v)))) return toast('Zeiten bitte als 1:50:00 bzw. 4:58 eingeben');
      const gs = parseT(times.gt);
      if (times.gt.trim() && (gs < 3600 || gs > 14400)) return toast('Zielzeit zwischen 1:00:00 und 4:00:00 eingeben');
      try {
        await api('/settings', { lthr: $('#lthr').value, max_hr: $('#mhr').value, lt_pace_s: parseT(times.ltp), easy_pace_s: parseT(times.ezp), goal: { time_s: parseT(times.gt), date: $('#gd').value || null } });
        ['c_more', 'c_today', 'c_week'].forEach((k) => store.del(k));
        toast('Gespeichert');
      } catch (e) { toast(e.message); }
    };
    // Zifferntastatur ohne Doppelpunkt: Eingabe automatisch als h:mm:ss bzw. m:ss formatieren
    const fmtDigits = (v, hours) => {
      const d = v.replace(/\D/g, '').slice(0, hours ? 5 : 3);
      if (d.length <= 2) return d;
      const ss = d.slice(-2), mm = d.slice(-4, -2), h = d.slice(0, -4);
      return hours ? (h ? `${h}:${mm}:${ss}` : `${d.slice(0, -2)}:${ss}`) : `${d.slice(0, -2)}:${ss}`;
    };
    [['gt', true], ['ltp', false], ['ezp', false]].forEach(([id, hrs]) => $('#' + id).addEventListener('input', (e) => { e.target.value = fmtDigits(e.target.value, hrs); }));
    ['gt', 'gd', 'lthr', 'mhr', 'ltp', 'ezp'].forEach((id) => $('#' + id).addEventListener('change', save));
    const doSync = async (from) => {
      $('#sync').disabled = $('#hist').disabled = true; let added = 0, lastHealth = null;
      try { for (let i = 0; i < 12; i++) { $('#syncInfo').textContent = `Synchronisiere … ${added} neu`; const r = await api('/sync', from ? { from } : {}); added += r.added; if (r.health) lastHealth = r.health; if (r.done) break; } const h = lastHealth; $('#syncInfo').textContent = `Fertig, ${added} neue Aktivitäten.` + (h ? ` Tageswerte: ${h.rows} Tage (HRV ${h.hrv}, Ruhepuls ${h.rhr}, Schlaf ${h.sleep})${h.errors?.length ? '. Fehler: ' + h.errors.join('; ') : ''}` : ''); }
      catch (e) { $('#syncInfo').textContent = 'Fehler: ' + e.message; }
      $('#sync').disabled = $('#hist').disabled = false;
    };
    $('#gConn').onclick = () => { if (gs?.connected) return toast('Bereits verbunden. Senden geht über „An Garmin senden“ bei einem Lauf.'); openGarminConnect(() => { store.del('c_more'); render(); }); };
    $('#gOff')?.addEventListener('click', async () => { try { await api('/garmin/disconnect', {}); toast('Verbindung getrennt'); store.del('c_more'); render(); } catch (e) { toast(e.message); } });
    setupPush(pu);
    $('#sync').onclick = () => doSync();
    $('#hist').onclick = () => doSync(new Date().getFullYear() + '-01-01');
    $('#addPk').onclick = async () => { try { await registerPasskey('', navigator.platform || 'Gerät'); toast('Passkey angelegt'); store.del('c_more'); render(); } catch (e) { toast(e.name === 'NotAllowedError' ? 'Abgebrochen' : e.message); } };
    $('#out').onclick = async () => { await api('/auth/logout', {}); start(); };
  }
}


// ---- Automatische Synchronisierung ------------------------------------------
let syncing = false;
async function autoSync(force = false) {
  const last = store.get('auto_sync') || 0;
  if (syncing || (!force && Date.now() - last < 3 * 60 * 1000)) return;
  syncing = true;
  try {
    let added = 0, health = 0;
    for (let i = 0; i < 8; i++) {
      const r = await api('/sync', {});
      added += r.added || 0; health += r.healthRows || 0;
      if (r.done) break;
    }
    store.set('auto_sync', Date.now());
    if (added || health) {
      if (added) toast(added === 1 ? 'Neue Aktivität geladen' : `${added} neue Aktivitäten geladen`);
      if (!sub && !weekEdit && !$('#tabs').hidden && tab !== 'more') render();
    }
  } catch (e) { if (e.auth) start(); /* sonst still: Garmin gerade nicht erreichbar */ } finally { syncing = false; }
}

// ---- Navigation ------------------------------------------------------------
const views = { today: ['c_today', '/today', drawToday], week: ['c_week', '/week', drawWeek] };
let renderId = 0;
// Verlauf für „Zurück“: jeder Wechsel legt den vorherigen Zustand ab, damit Zurück dort landet, wo du warst.
const TABS = ['today', 'week', 'analysis', 'more'];
const hist = [];
let dir = 0; // Richtung der nächsten Übergangsanimation: 1 = vor, -1 = zurück
function push() { hist.push({ tab, sub }); if (hist.length > 30) hist.shift(); }
function go(view, o = {}) {
  if (view === 'back') {
    const prev = hist.pop(); if (!prev) return false;
    tab = prev.tab; sub = prev.sub; dir = -1;
  } else if (view === 'home') { // zurück auf die zuletzt besuchte Hauptansicht, auch über mehrere Unterseiten hinweg
    while (hist.length && hist[hist.length - 1].sub) hist.pop();
    const prev = hist.pop();
    if (prev) tab = prev.tab;
    sub = null; dir = -1;
  } else if (TABS.includes(view)) {
    if (tab !== view || sub) push();
    dir = TABS.indexOf(view) >= TABS.indexOf(tab) ? 1 : -1;
    sub = null; tab = view;
  } else { push(); sub = { view, ...o }; dir = 1; }
  if (!sub) placePill(TABS.indexOf(tab)); // die Blase startet vor dem schweren Neuzeichnen der Seite
  requestAnimationFrame(() => render());
  return true;
}
async function render() {
  const my = ++renderId;
  if (tab !== 'week' || sub) weekEdit = null;
  const isCurrent = () => my === renderId;
  clearInterval(viewLog.tm);
  $$('#tabs button').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#tabs').hidden = !!sub;
  if (!sub) placePill(TABS.indexOf(tab));
  app.classList.toggle('sub', !!sub); app.classList.remove('draw');
  window.scrollTo(0, 0);
  app.style.transition = 'none'; app.style.transform = ''; app.style.opacity = '';
  if (dir && app.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) { movingOn(); const an = app.animate([{ transform: `translateX(${dir * 38}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }); an.onfinish = an.oncancel = movingOff; } else movingOff();
  dir = 0;
  try {
    if (sub) { const f = { log: viewLog, day: viewDay, acts: viewActs, act: viewAct }[sub.view] || viewPrep; await f(app, { ...sub, nav: go }); return; }
    if (tab === 'more') { await viewMore(isCurrent); return; }
    if (tab === 'analysis') { await viewAnalysis(app, isCurrent); return; }
    const [key, path, draw] = views[tab];
    if (!store.get(key)) app.innerHTML = '<p class="muted center-text">Lädt …</p>';
    await swr(key, path, (d, off) => { if (isCurrent()) draw(d, off); }, isCurrent);
  } catch (e) { if (e.auth) return start(); if (isCurrent()) app.innerHTML = `<div class="head"><h1>Ups</h1></div><p class="err">${esc(e.message)}</p><button class="sec" onclick="location.reload()">Neu laden</button>`; }
}
async function start() {
  let st;
  try { st = await api('/auth/state'); } catch (e) {
    let hint = '';
    try { const h = await (await fetch('/api/health', { headers: { 'X-Requested-With': 'fit' } })).json(); if (h.missing?.length) hint = '<p class="err">Fehlende Konfiguration: ' + esc(h.missing.join(', ')) + '</p>'; } catch {}
    const offline = e instanceof TypeError;
    app.innerHTML = `<div class="center"><h1>${offline ? 'Offline' : 'Serverfehler'}</h1><p class="lead">${offline ? 'Keine Verbindung zum Server.' : esc(e.message)}</p>${hint}<button class="pri" onclick="location.reload()">Erneut versuchen</button></div>`; return; }
  if (!st.authed) return showAuth(st);
  sub = null; hist.length = 0; $('#tabs').hidden = false; render(); autoSync();
  api('/week').then((d) => store.set('c_week', d)).catch(() => {});
  Promise.all([api('/settings'), api('/auth/state')]).then(([s, st]) => store.set('c_more', { s, st })).catch(() => {});
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
setInterval(() => { if (!document.hidden && !$('#tabs').hidden) autoSync(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.hidden || $('#tabs').hidden) return; if (tab === 'today' || tab === 'week') render(); autoSync(); });
// ---- Navigationsblase unten: folgt dem aktiven Tab (und dem Finger beim Wischen) -----------------
const pill = document.createElement('i');
pill.className = 'tabpill';
$('#tabs').prepend(pill);
let pillShown = false, geo = null;
const movingOn = () => document.documentElement.classList.add('moving');
const movingOff = () => document.documentElement.classList.remove('moving');
function measurePill() {
  const bs = $$('#tabs button');
  geo = bs.map((b) => ({ x: b.offsetLeft, w: b.offsetWidth, h: b.offsetHeight, top: b.offsetTop }));
  if (geo[0]) { pill.style.width = geo[0].w + 'px'; pill.style.height = geo[0].h + 'px'; pill.style.top = geo[0].top + 'px'; }
}
function placePill(pos, animate = true) {
  if ($('#tabs').hidden) { pillShown = false; geo = null; return; }
  if (!geo || geo[0].w === 0) measurePill();
  const lo = Math.max(0, Math.floor(pos)), hi = Math.min(geo.length - 1, Math.ceil(pos)), f = pos - Math.floor(pos);
  const x = geo[lo].x + (geo[hi].x - geo[lo].x) * f;
  if (animate && pillShown) { if (pill.style.transition === 'none') void pill.offsetWidth; pill.style.transition = ''; } else pill.style.transition = 'none';
  pill.style.transform = `translate3d(${x}px,0,0)`;
  pillShown = true;
}
window.addEventListener('resize', () => { geo = null; placePill(TABS.indexOf(tab), false); });

// ---- Wischgesten: Seite folgt dem Finger; seitlich zwischen Tabs wechseln, vom linken Rand zurück ------
(() => {
  let s = null;
  const blocked = (el) => {
    if (!el || !el.closest) return false;
    if (el.closest('svg, input, textarea, select, .sheet, .menu, .grip, [data-noswipe]')) return true;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  const setApp = (tx, op, ms) => { app.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.8,.2,1), opacity ${ms}ms` : 'none'; app.style.transform = tx ? `translateX(${tx}px)` : ''; app.style.opacity = op == null ? '' : String(op); };
  const W = () => window.innerWidth;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { s = null; return; }
    const t0 = e.touches[0];
    s = { x: t0.clientX, y: t0.clientY, t: Date.now(), el: e.target, mode: null };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!s || s.mode === 'none') return;
    const t1 = e.touches[0], dx = t1.clientX - s.x, dy = t1.clientY - s.y;
    if (!s.mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      s.mode = 'none';
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && !$('.sheet-wrap.open')) {
        if (s.x <= 28 && dx > 0 && (sub || hist.length)) s.mode = 'edge';
        else if (!sub && !$('#tabs').hidden && !weekEdit && !blocked(s.el)) s.mode = 'tab';
      }
      if (s.mode === 'none') return;
      movingOn();
    }
    if (e.cancelable) e.preventDefault();
    if (s.mode === 'edge') {
      const tx = Math.max(0, dx);
      setApp(tx * 0.85, 1 - Math.min(0.6, tx / W()));
    } else {
      const i = TABS.indexOf(tab), n = i + (dx < 0 ? 1 : -1), valid = n >= 0 && n < TABS.length;
      const k = valid ? 0.55 : 0.16;
      setApp(dx * k, 1 - Math.min(0.55, Math.abs(dx) / W()));
      placePill(Math.min(TABS.length - 1, Math.max(0, i - (dx / W()) * (valid ? 1.15 : 0.25))), false);
    }
  }, { passive: false });
  const finish = (e, cancelled) => {
    if (!s) return;
    const st = s; s = null;
    if (!st.mode || st.mode === 'none') return;
    const t1 = e.changedTouches[0], dx = t1.clientX - st.x, vel = dx / Math.max(1, Date.now() - st.t);
    const i = TABS.indexOf(tab);
    if (st.mode === 'edge') {
      if (!cancelled && (dx > W() * 0.3 || vel > 0.5) && dx > 40) {
        setApp(W() * 0.35, 0, 150);
        setTimeout(() => go('back'), 150);
      } else { setApp(0, 1, 260); setTimeout(movingOff, 280); }
      return;
    }
    const n = i + (dx < 0 ? 1 : -1);
    if (!cancelled && n >= 0 && n < TABS.length && (Math.abs(dx) > W() * 0.25 || Math.abs(vel) > 0.45) && Math.abs(dx) > 40) {
      setApp(dx < 0 ? -50 : 50, 0, 140);
      placePill(n, true); // Blase gleitet sofort weiter, ohne auf den Seitenwechsel zu warten
      setTimeout(() => go(TABS[n]), 140);
    } else { setApp(0, 1, 260); placePill(i, true); setTimeout(movingOff, 280); }
  };
  document.addEventListener('touchend', (e) => finish(e, false), { passive: true });
  document.addEventListener('touchcancel', (e) => finish(e, true), { passive: true });
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
