const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pace = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');
const hm = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`; };
const dmy = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.';
const SPORT = { running: 'Laufen', cycling: 'Rad', strength: 'Kraft', swimming: 'Schwimmen', tennis: 'Tennis', other: 'Sonstiges' };
let tab = 'today';

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400); }

async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fit' }, body: JSON.stringify(body) };
  if (body === undefined) opt.headers = { 'X-Requested-With': 'fit' };
  const r = await fetch('/api' + path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
  return j;
}
async function cached(key, path) {
  try { const d = await api(path); try { localStorage.setItem(key, JSON.stringify(d)); } catch {} return { d, stale: false }; }
  catch (e) { if (e.auth) throw e; try { const s = localStorage.getItem(key); if (s) return { d: JSON.parse(s), stale: true }; } catch {} throw e; }
}

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
  $('#tabs').hidden = true;
  const setup = state.setupNeeded;
  app.innerHTML = `<div class="center"><h1>Fitness Coach</h1><p class="sub">${setup ? 'Erste Einrichtung: Mit dem Setup-Token legst du den Passkey für dieses Gerät an.' : 'Mit Face ID, Touch ID oder Gerätecode anmelden.'}</p>
    ${setup ? '<input class="txt" id="tok" type="password" placeholder="Setup-Token" autocomplete="off">' : ''}
    <button class="pri" id="go">${setup ? 'Passkey anlegen' : 'Mit Passkey anmelden'}</button><p class="err" id="msg"></p></div>`;
  $('#go').onclick = async () => {
    $('#go').disabled = true; $('#msg').textContent = '';
    try { if (setup) await registerPasskey($('#tok').value, navigator.platform || 'Gerät'); else await loginPasskey(); start(); }
    catch (e) { $('#msg').textContent = e.name === 'NotAllowedError' ? 'Abgebrochen.' : e.message; $('#go').disabled = false; }
  };
  if (!setup && window.PublicKeyCredential) $('#go').click();
}

// ---- Diagramme (SVG) -------------------------------------------------------
function bars(vals, labels, { color = 'var(--acc)', h = 120, fmt = (v) => v } = {}) {
  const W = 320, max = Math.max(1, ...vals), bw = W / vals.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${h + 18}">${vals.map((v, i) => { const bh = (v / max) * (h - 14); return `<rect x="${i * bw + 3}" y="${h - bh}" width="${bw - 6}" height="${bh}" rx="3" fill="${color}"/><text x="${i * bw + bw / 2}" y="${h - bh - 3}" text-anchor="middle">${v ? fmt(v) : ''}</text><text x="${i * bw + bw / 2}" y="${h + 12}" text-anchor="middle">${i % 2 === (vals.length - 1) % 2 ? esc(labels[i]) : ''}</text>`; }).join('')}</svg>`;
}
function line(pts, { h = 120, color = 'var(--acc)', fmt = (v) => v, ref = null, invert = false } = {}) {
  const p = pts.filter((x) => x.y != null);
  if (p.length < 2) return '<p class="muted">Noch zu wenig Daten.</p>';
  const W = 320, ys = p.map((x) => x.y).concat(ref != null ? [ref] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys); if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const X = (i) => 8 + (i / (p.length - 1)) * (W - 16), Y = (v) => { const t = (v - lo) / (hi - lo); return 8 + (invert ? t : 1 - t) * (h - 16); };
  const d = p.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.y).toFixed(1)}`).join('');
  const last = p[p.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${h + 14}">${ref != null ? `<line x1="8" x2="${W - 8}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="var(--mute)" stroke-dasharray="3 3" opacity=".6"/>` : ''}<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${X(p.length - 1)}" cy="${Y(last.y)}" r="3.5" fill="${color}"/><text x="${X(0)}" y="${h + 11}">${esc(p[0].x)}</text><text x="${W - 8}" y="${h + 11}" text-anchor="end">${esc(last.x)}: ${esc(fmt(last.y))}</text></svg>`;
}
function zoneBar(zs) {
  const t = zs.reduce((a, b) => a + b, 0) || 1, c = ['--z1', '--z2', '--z3', '--z4', '--z5'];
  return `<svg class="chart" viewBox="0 0 320 30"><g>${zs.map((s, i) => { const w = (s / t) * 320, x = zs.slice(0, i).reduce((a, b) => a + b, 0) / t * 320; return `<rect x="${x}" y="0" width="${w}" height="22" fill="var(${c[i]})"/>`; }).join('')}</g></svg><div class="legend">${zs.map((s, i) => `<span><i style="background:var(${c[i]})"></i>Z${i + 1} ${Math.round(s / t * 100)} %</span>`).join('')}</div>`;
}

// ---- Ansichten -------------------------------------------------------------
function planCard(p, { hero = true } = {}) {
  const t = p.targets || {};
  const kv = [];
  if (t.distance_km) kv.push(['Distanz', t.distance_km + ' km']);
  if (t.duration_min) kv.push(['Dauer', t.duration_min + ' min']);
  if (t.pace_s) kv.push(['Tempo', pace(t.pace_s) + ' /km']);
  if (t.hr_from && p.structure?.type !== 'strides') kv.push(['Puls', `${t.hr_from}–${t.hr_to}`]);
  const steps = (p.steps || []).map((s) => `<li><b>${esc(s.label)}</b><span>${esc(s.detail)}</span></li>`).join('');
  const why = (p.why || []).length ? `<div class="why"><b>Warum angepasst:</b>${p.why.map((w) => `<p>${esc(w.text)}</p>`).join('')}</div>` : '';
  return `<div class="card ${hero ? 'hero' : ''}"><span class="tag">${esc(p.label)}</span>${p.block ? `<span class="tag">${esc(p.block.label)} · Woche ${p.block.week}${p.block.deload ? ' · Entlastung' : ''}</span>` : ''}${p.provisional ? '<span class="tag">vorläufig</span>' : ''}
    <h3>${esc(p.title)}</h3><div class="muted">${esc(p.summary || '')}</div>${kv.length ? `<div class="kv">${kv.map(([k, v]) => `<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div>` : ''}
    ${steps ? `<ul class="steps">${steps}</ul>` : ''}${why}</div>`;
}

async function viewToday() {
  const { d, stale } = await cached('c_today', '/today');
  const p = d.plan, rd = d.readiness;
  const lvl = { good: 'Erholung gut', medium: 'Erholung mittel', low: 'Erholung niedrig' }[rd.level] || '';
  let html = `<h1>Heute</h1><p class="sub">${new Date(d.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}${stale ? ' · <span class="err">offline, letzter Stand</span>' : ''}</p>
    <span class="tag ${rd.level}">${lvl}</span>${rd.acwr != null ? `<span class="tag">Belastungsverhältnis ${Number(rd.acwr).toFixed(2)}</span>` : ''}`;
  html += planCard(p);
  if (p.exercises) {
    html += `<h2>Übungen protokollieren</h2><div class="card" id="ex">${p.exercises.map((e, i) => `<div class="ex"><input type="checkbox" data-i="${i}" checked aria-label="erledigt"><label>${esc(e.name)}<small>${e.sets} × ${esc(e.reps)}${e.note ? ' · ' + esc(e.note) : ''}</small></label><input type="number" inputmode="decimal" data-w="${i}" placeholder="kg" value="${e.weight_kg ?? ''}"></div>`).join('')}<button class="pri" id="saveEx">Einheit speichern</button></div>`;
  }
  if (d.done.length) html += `<h2>Heute erledigt</h2><div class="card">${d.done.map((a) => `<div class="row"><span>${SPORT[a.sport] || a.sport}</span><span class="muted">${hm(a.duration_s)}${a.distance_m > 500 ? ' · ' + (a.distance_m / 1000).toFixed(1) + ' km' : ''}${a.avg_hr ? ' · ' + Math.round(a.avg_hr) + ' bpm' : ''}</span></div>`).join('')}</div>`;
  if (rd.signals?.length) html += `<h2>Erholungssignale</h2><div class="card">${rd.signals.map((s) => `<div class="row"><span>${esc(s.text)}</span></div>`).join('')}</div>`;
  if (d.thresholdSuggestion) {
    const s = d.thresholdSuggestion;
    html += `<h2>Schwellenwerte</h2><div class="card"><div>Aus deinen letzten harten Läufen schätzt die App:</div><div class="kv">${s.lthr ? `<div><small>Schwellenpuls</small><strong>${s.lthr}</strong></div>` : ''}${s.lt_pace_s ? `<div><small>Schwellentempo</small><strong>${pace(s.lt_pace_s)}</strong></div>` : ''}</div><button class="sec" id="applyTh">Übernehmen</button></div>`;
  }
  html += `<h2>Schmerz melden</h2><div class="card"><div class="muted">Optional. Ab 4 von 10 werden belastende Übungen ersetzt.</div><div class="pain">${[0, 2, 4, 6, 8].map((n) => `<button data-pain="${n}">${n}</button>`).join('')}</div></div>`;
  app.innerHTML = html;
  $('#saveEx')?.addEventListener('click', async () => {
    const entries = p.exercises.map((e, i) => ({ date: d.date, exercise_id: e.id, sets: e.sets, reps: e.reps, weight_kg: $(`[data-w="${i}"]`).value || null, done_all: $(`[data-i="${i}"]`).checked }));
    try { await api('/strength/log', { entries }); toast('Gespeichert'); } catch (e) { toast(e.message); }
  });
  $('#applyTh')?.addEventListener('click', async () => { try { await api('/threshold/apply', {}); toast('Übernommen'); render(); } catch (e) { toast(e.message); } });
  app.querySelectorAll('[data-pain]').forEach((b) => b.addEventListener('click', async () => {
    const area = Number(b.dataset.pain) >= 4 ? (prompt('Wo? (z. B. Knie, Achillessehne)') || null) : null;
    try { await api('/pain', { level: Number(b.dataset.pain), area, date: d.date }); b.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); toast('Notiert'); } catch (e) { toast(e.message); }
  }));
}

async function viewWeek() {
  const { d, stale } = await cached('c_week', '/week');
  const names = { rest: 'Ruhetag' };
  app.innerHTML = `<h1>Woche</h1><p class="sub">Sportart fix, Inhalt passt sich an.${stale ? ' <span class="err">Offline-Stand</span>' : ''}</p><div class="week">${d.week.map((p) => {
    const t = p.targets || {}; const meta = [t.distance_km && t.distance_km + ' km', t.duration_min && t.duration_min + ' min'].filter(Boolean).join(' · ');
    return `<div class="day ${p.date === d.today ? 'today' : ''} ${p.provisional ? 'prov' : ''}"><div class="d">${esc(p.weekday.slice(0, 2))}</div><div class="t"><b>${esc(p.kind === 'rest' ? names.rest : p.label)}</b><small>${esc(p.kind === 'rest' ? '' : p.title)}${meta ? ' · ' + meta : ''}</small></div>${p.done?.length ? '<span class="ok">✓</span>' : ''}</div>`;
  }).join('')}</div>`;
}

async function viewTrends() {
  const { d } = await cached('c_trends', '/trends');
  const w = d.weekly, lab = w.map((x) => dmy(x.week).slice(0, 5));
  const zsum = [0, 0, 0, 0, 0]; w.slice(-6).forEach((x) => x.zone_s.forEach((s, i) => { zsum[i] += s; }));
  app.innerHTML = `<h1>Trends</h1><p class="sub">Letzte 12 Wochen</p>
   <h2>Laufkilometer pro Woche</h2><div class="card">${bars(w.map((x) => x.run_km), lab, { fmt: (v) => Math.round(v) })}</div>
   <h2>Intensitätsverteilung Laufen (6 Wochen)</h2><div class="card">${zoneBar(zsum)}<div class="muted" style="margin-top:6px">Ziel im Aufbau: etwa 80 % in Z1–Z2.</div></div>
   <h2>Tempo bei Z2-Puls (Monatsmedian)</h2><div class="card">${line(d.paceZ2.map((x) => ({ x: x.month.slice(2), y: x.pace_s })), { fmt: pace, invert: true })}<div class="muted">Schneller bei gleichem Puls bedeutet bessere Grundlage.</div></div>
   <h2>Belastungsverhältnis (7 d / 28 d)</h2><div class="card">${line(d.acwr.map((x) => ({ x: dmy(x.date), y: x.ratio })), { ref: 1.5, fmt: (v) => v.toFixed(2) })}<div class="muted">Gestrichelt: 1,5, darüber wird entlastet.</div></div>
   <h2>HRV und Ruhepuls</h2><div class="card">${line(d.hrv.map((x) => ({ x: dmy(x.date), y: x.hrv })), { fmt: (v) => Math.round(v) + ' ms' })}${line(d.hrv.map((x) => ({ x: dmy(x.date), y: x.rhr })), { color: 'var(--z5)', fmt: (v) => Math.round(v) + ' bpm' })}</div>
   <h2>Bodenkontaktzeit</h2><div class="card">${line(d.form.map((x) => ({ x: dmy(x.date), y: x.gct })), { fmt: (v) => v + ' ms', invert: true })}<div class="muted">Kürzer bei gleichem Tempo ist effizienter.</div></div>
   <h2>Gesamtbelastung pro Woche</h2><div class="card">${bars(w.map((x) => x.load), lab, { color: 'var(--z4)' })}</div>`;
}

async function viewMore() {
  const [s, st] = await Promise.all([api('/settings'), api('/auth/state')]);
  const g = s.goal || {};
  app.innerHTML = `<h1>Mehr</h1><h2>Ziel</h2><div class="card">
    <div class="row"><span>Halbmarathon-Zeit</span><input class="txt" id="gt" style="width:110px;margin:0" value="${Math.floor(g.time_s / 3600)}:${String(Math.floor(g.time_s % 3600 / 60)).padStart(2, '0')}:${String(g.time_s % 60).padStart(2, '0')}"></div>
    <div class="row"><span>Wettkampfdatum</span><input class="txt" id="gd" type="date" style="width:160px;margin:0" value="${g.date || ''}"></div>
    <div class="row"><span>Schwellenpuls</span><input class="txt" id="lthr" type="number" style="width:90px;margin:0" value="${s.lthr}"></div>
    <div class="row"><span>Maximalpuls</span><input class="txt" id="mhr" type="number" style="width:90px;margin:0" value="${s.max_hr}"></div>
    <div class="row"><span>Schwellentempo (min/km)</span><input class="txt" id="ltp" style="width:90px;margin:0" value="${pace(s.lt_pace_s)}"></div>
    <div class="row"><span>Lockeres Tempo</span><input class="txt" id="ezp" style="width:90px;margin:0" value="${pace(s.easy_pace_s)}"></div>
    <button class="pri" id="saveS">Speichern</button></div>
  <h2>Garmin</h2><div class="card"><div class="muted" id="syncInfo">Holt neue Aktivitäten und Gesundheitsdaten.</div><button class="pri" id="sync">Jetzt synchronisieren</button><button class="sec" id="hist">Verlauf ab 01.01. laden</button></div>
  <h2>Passkeys</h2><div class="card">${(st.passkeys || []).map((k) => `<div class="row"><span>${esc(k.label || 'Gerät')}</span><span class="muted">${esc((k.created_at || '').slice(0, 10))}</span></div>`).join('')}<button class="sec" id="addPk">Dieses Gerät hinzufügen</button></div>
  <button class="sec" id="out">Abmelden</button>`;
  const parseT = (v) => { const p = v.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN; };
  $('#saveS').onclick = async () => {
    try { await api('/settings', { lthr: $('#lthr').value, max_hr: $('#mhr').value, lt_pace_s: parseT($('#ltp').value), easy_pace_s: parseT($('#ezp').value), goal: { time_s: parseT($('#gt').value), date: $('#gd').value || null } }); toast('Gespeichert'); } catch (e) { toast(e.message); }
  };
  const doSync = async (from) => {
    $('#sync').disabled = $('#hist').disabled = true; let added = 0, lastHealth = null;
    try { for (let i = 0; i < 12; i++) { $('#syncInfo').textContent = `Synchronisiere … ${added} neu`; const r = await api('/sync', from ? { from } : {}); added += r.added; if (r.health) lastHealth = r.health; if (r.done) break; } const h = lastHealth; $('#syncInfo').textContent = `Fertig, ${added} neue Aktivitäten.` + (h ? ` Tageswerte: ${h.rows} Tage (HRV ${h.hrv}, Ruhepuls ${h.rhr}, Schlaf ${h.sleep})${h.errors?.length ? '. Fehler: ' + h.errors.join('; ') : ''}` : ''); }
    catch (e) { $('#syncInfo').textContent = 'Fehler: ' + e.message; }
    $('#sync').disabled = $('#hist').disabled = false;
  };
  $('#sync').onclick = () => doSync();
  $('#hist').onclick = () => doSync(new Date().getFullYear() + '-01-01');
  $('#addPk').onclick = async () => { try { await registerPasskey('', navigator.platform || 'Gerät'); toast('Passkey angelegt'); render(); } catch (e) { toast(e.name === 'NotAllowedError' ? 'Abgebrochen' : e.message); } };
  $('#out').onclick = async () => { await api('/auth/logout', {}); start(); };
}

const views = { today: viewToday, week: viewWeek, trends: viewTrends, more: viewMore };
async function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  try { await views[tab](); window.scrollTo(0, 0); }
  catch (e) { if (e.auth) return start(); app.innerHTML = `<h1>Ups</h1><p class="err">${esc(e.message)}</p><button class="sec" onclick="location.reload()">Neu laden</button>`; }
}
async function start() {
  let st;
  try { st = await api('/auth/state'); } catch (e) {
    let hint = '';
    try { const h = await (await fetch('/api/health', { headers: { 'X-Requested-With': 'fit' } })).json(); if (h.missing?.length) hint = '<p class="err">Fehlende Konfiguration: ' + esc(h.missing.join(', ')) + '</p>'; } catch {}
    const offline = e instanceof TypeError;
    app.innerHTML = `<div class="center"><h1>${offline ? 'Offline' : 'Serverfehler'}</h1><p class="sub">${offline ? 'Keine Verbindung zum Server.' : esc(e.message)}</p>${hint}<button class="pri" onclick="location.reload()">Erneut versuchen</button></div>`; return; }
  if (!st.authed) return showAuth(st);
  $('#tabs').hidden = false; render();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#tabs').hidden && (tab === 'today' || tab === 'week')) render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
