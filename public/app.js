import { $, $$, esc, pace, hm, dmy, dec, SPORT, toast, api, store, swr, icon } from './util.js';
import { viewAnalysis } from './analysis.js';
import { heuteKraftCard, viewPrep, viewLog } from './strength.js';

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
  const lvl = { good: ['Erholung gut', '#34C759'], medium: ['Erholung mittel', '#FF9500'], low: ['Erholung niedrig', '#FF3B30'] }[rd.level];
  return `<div class="pills">${lvl ? `<span class="pill"><i style="background:${lvl[1]}"></i>${lvl[0]}</span>` : ''}${rd.acwr != null ? `<span class="pill mute">Belastung ${dec(rd.acwr, 2)}</span>` : ''}${p.block ? `<span class="pill mute">${esc(p.block.label)} · Woche ${p.block.week}${p.block.deload ? ' · Entlastung' : ''}</span>` : ''}${p.provisional ? '<span class="pill mute">vorläufig</span>' : ''}</div>`;
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
  return `<div class="card hero"><div class="hero-top"><div class="ht-text"><div class="kicker" style="color:${color}">${esc(nice(p.label))}</div><div class="hero-title">${esc(p.title)}</div></div>${d.stat ? statChip(d.stat) : ''}</div>
    ${big.length ? `<div class="bigs">${big.map(([l, v, u]) => `<div><span>${l}</span><b>${esc(v)}<small>${u}</small></b></div>`).join('')}</div>` : ''}${zone}
    ${steps ? `<div class="lines">${steps}</div>` : `<p class="blurb">${esc(p.summary || '')}</p>`}</div>`;
}
function otherCard(d) {
  const p = d.plan, rest = p.kind === 'rest', color = rest ? '#8E8E93' : KIND_COLOR.spinning;
  const steps = (p.steps || []).map((s) => `<div class="line"><span class="ln">${esc(s.label)}</span><span class="lv">${esc(s.detail)}</span></div>`).join('');
  return `<div class="card hero"><div class="hero-top"><div class="ht-text"><div class="kicker" style="color:${color}">${esc(nice(p.label))}</div><div class="hero-title">${esc(p.title)}</div></div>${d.stat ? statChip(d.stat) : ''}</div>
    ${p.targets?.duration_min ? `<div class="bigs"><div><span>Dauer</span><b>${p.targets.duration_min}<small> min</small></b></div></div>` : ''}<p class="blurb">${esc(p.summary || '')}</p>${steps ? `<div class="lines">${steps}</div>` : ''}</div>`;
}
function infoCard(d) {
  const p = d.plan, rd = d.readiness, why = p.why || [];
  const adjusted = !!p.adjusted;
  const lines = why.length ? why.map((w) => w.text) : rd.signals?.length ? rd.signals.map((s) => s.text) : ['Erholung und Belastung liegen im Normalbereich.'];
  const title = adjusted ? 'Heute angepasst' : why.length ? 'So wurde geplant' : 'Heute nicht angepasst';
  return `<div class="card info"><div class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg></div><div><b>${title}</b><ul class="why">${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
}

const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function fitCard(d) {
  const f = d.fitness; if (!f) return '';
  const c = d.cycle;
  const conf = { hoch: 'hoch', mittel: 'mittel', niedrig: 'niedrig' }[f.confidence];
  const evid = f.anchor ? `Beleg vom ${f.anchor.date.slice(8, 10)}.${f.anchor.date.slice(5, 7)}.` : 'noch ohne harten Lauf';
  return `<h2>Leistungsstand</h2><div class="card fitcard"><div class="kv"><div><small>VDOT</small><strong>${dec(f.vdot, 1)}</strong></div><div><small>Halbmarathon-Prognose</small><strong>${hms(f.predictions.hm)}</strong></div><div><small>Schwelle</small><strong>${pace(f.paces.threshold)}</strong></div></div>
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
  let html = head + pills(d);
  html += g === 'strength' && d.session ? heuteKraftCard(d) : g === 'run' ? runCard({ ...d, stat: p.kind !== 'rest' ? { date: d.date, status: d.status } : null }) : otherCard({ ...d, stat: p.kind !== 'rest' ? { date: d.date, status: d.status } : null });
  html += infoCard(d);
  if (g === 'run') html += fitCard(d);
  if (d.done.length) html += `<h2>Heute erledigt</h2><div class="card">${d.done.map((a) => `<div class="row"><span>${SPORT[a.sport] || a.sport}</span><span class="muted">${hm(a.duration_s)}${a.distance_m > 500 ? ' · ' + (a.distance_m / 1000).toFixed(1).replace('.', ',') + ' km' : ''}${a.avg_hr ? ' · ' + Math.round(a.avg_hr) + ' bpm' : ''}</span></div>`).join('')}</div>`;
  if (d.thresholdSuggestion) {
    const s = d.thresholdSuggestion;
    html += `<h2>Schwellenwerte</h2><div class="card"><div>Aus deinen letzten harten Läufen schätzt die App:</div><div class="kv">${s.lthr ? `<div><small>Schwellenpuls</small><strong>${s.lthr}</strong></div>` : ''}${s.lt_pace_s ? `<div><small>Schwellentempo</small><strong>${pace(s.lt_pace_s)}</strong></div>` : ''}</div><button class="sec" id="applyTh">Übernehmen</button></div>`;
  }
  html += `<button type="button" class="subtle" id="painBtn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>Schmerz melden</button>`;
  app.innerHTML = html;
  $$('[data-go]', app).forEach((b) => b.addEventListener('click', () => go(b.dataset.go, { kind: b.dataset.kind, blank: !!b.dataset.blank })));
  $('#applyTh')?.addEventListener('click', async () => { try { await api('/threshold/apply', {}); toast('Übernommen'); render(); } catch (e) { toast(e.message); } });
  $('#painBtn')?.addEventListener('click', () => openPain(d.date));
  bindStatus(app, d.date, () => render());
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
    const fake = { plan: p, thresholds: { lthr: d.lthr }, stat: past ? { date, status: p.status } : null };
    const wd = new Date(date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    app.innerHTML = `<button type="button" class="back" data-act="back">${icon.back}Woche</button>
      <div class="head"><div class="eyebrow">${wd}${date === d.today ? ' · heute' : ''}</div><h1>${esc(nice(p.label).replace(/ \(.*/, '').split(' · ')[0])}</h1></div>
      ${g === 'run' ? runCard(fake) : otherCard(fake)}
      ${!past ? '<div class="card info"><div class="ico">' + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg></div><div><b>Vorläufig</b><p>Das ist der geplante Ablauf. Am Tag selbst passt die App die Einheit an deine Erholung an, etwa bei schlechtem Schlaf oder hoher Belastung.</p></div></div>' : ''}
      ${(p.why || []).length ? infoCard({ plan: p, readiness: { signals: [] } }) : ''}
`;
    $('[data-act=back]', app).onclick = () => nav('week');
    bindStatus(app, date, () => { store.del('c_week'); viewDay(app, { date, nav }); });
  };
  const cached = store.get('c_week');
  if (cached) draw(cached);
  else app.innerHTML = '<p class="muted center-text">Lädt …</p>';
  try { const d = await api('/week'); store.set('c_week', d); if (JSON.stringify(d) !== JSON.stringify(cached)) draw(d); } catch (e) { if (!cached) throw e; }
}

// ---- Woche -----------------------------------------------------------------
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const dm = (iso) => `${Number(iso.slice(8, 10))}. ${MON[Number(iso.slice(5, 7)) - 1]}`;
const check = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="erledigt" role="img"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>';
let weekEdit = null; // {order:[Plan], sel:null|index} solange die Woche bearbeitet wird
const GRIP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>';
const isDone = (p) => p.status === 'done' || (p.status !== 'skipped' && p.done?.length > 0);
const RING = { open: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>', skipped: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>' };
function drawWeek(d, stale) {
  const w = weekEdit ? weekEdit.order : d.week; // Tage (Datum) bleiben, Einheiten wandern
  const dates = d.week.map((p) => p.date);
  const c = { run: [0, 0], strength: [0, 0], spin: [0, 0] };
  d.week.forEach((p) => { const g = group(p.kind); if (c[g]) { c[g][1]++; if (isDone(p)) c[g][0]++; } });
  const b0 = d.week[0]?.block;
  const prog = (l, [a, n], col) => `<div class="pc"><span>${l}</span><b>${a}<small> / ${n}</small></b><div class="pt"><i style="width:${n ? Math.round(a / n * 100) : 0}%;background:${col}"></i></div></div>`;
  const locked = (p, i) => p.fixed || dates[i] < d.today || d.week[i].done?.length > 0 || d.week[i].fixed;
  const anyMoved = d.week.some((p) => p.moved);
  app.innerHTML = `<div class="head row-head"><div><div class="eyebrow">${dm(dates[0])} – ${dm(dates[6])}${b0 ? ' · ' + esc(b0.label) + ', Woche ' + b0.week : ''}${stale ? ' · offline' : ''}</div><h1>Woche</h1></div><button type="button" class="textbtn" id="wedit">${weekEdit ? 'Fertig' : 'Bearbeiten'}</button></div>
    ${weekEdit ? '<p class="foot edit-hint">Ziehe eine Einheit am Griff auf einen anderen Tag oder tippe zwei Tage nacheinander an, um sie zu tauschen. Spinning und vergangene Tage bleiben fest.</p>' : `<div class="card prog3">${prog('Laufen', c.run, '#FF6B2C')}${prog('Kraft', c.strength, '#AF52DE')}${prog('Spinning', c.spin, '#0A84FF')}</div>`}
    <div class="days${weekEdit ? ' editing' : ''}" id="days">${w.map((p, i) => {
    const g = group(p.kind), t = p.targets || {}, today = dates[i] === d.today, rest = g === 'rest', lock = locked(p, i);
    const col = { run: '#FF6B2C', strength: '#AF52DE', spin: '#0A84FF' }[g];
    const moved = weekEdit ? p.date !== dates[i] || p.moved : p.moved;
    const meta = [rest ? '' : (p.title || '').replace(/^Kraft [AB]: /, ''), t.distance_km && g === 'run' ? dec(t.distance_km, 1) + ' km' : '', t.duration_min && g !== 'run' ? t.duration_min + ' min' : '', moved ? 'verschoben' : d.week[i].status === 'skipped' ? 'ausgefallen' : p.provisional && !rest ? 'vorläufig' : ''].filter(Boolean).join(' · ');
    return `<div class="day${today ? ' today' : ''}${rest ? ' rest' : ''}${weekEdit && lock ? ' lock' : ''}${weekEdit && weekEdit.sel === i ? ' sel' : ''}" data-i="${i}"${!rest && !weekEdit ? ` data-open="${dates[i]}" data-kind="${g === 'strength' ? p.kind : ''}"` : ''}><div class="dd"><span>${esc(d.week[i].weekday.slice(0, 2))}</span><b>${Number(dates[i].slice(8, 10))}</b></div>${rest ? '' : `<i class="dbar" style="background:${col}"></i>`}<div class="dt"><b>${esc(rest ? 'Ruhetag' : nice(p.label).replace(/ \(.*/, ''))}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</div>${weekEdit ? (lock ? '' : `<span class="grip" data-grip="${i}" aria-label="Verschieben">${GRIP}</span>`) : (!rest && dates[i] <= d.today) ? `<button type="button" class="ring" data-ring="${i}" aria-label="${isDone(d.week[i]) ? 'Als offen markieren' : 'Als erledigt markieren'}">${isDone(d.week[i]) ? check : d.week[i].status === 'skipped' ? RING.skipped : RING.open}</button>` : today ? '<span class="tbadge">Heute</span>' : ''}</div>`;
  }).join('')}</div>
    ${weekEdit && (anyMoved || weekEdit.order.some((p, i) => p.date !== dates[i])) ? '<button type="button" class="link" id="wreset">Auf Standardwoche zurücksetzen</button>' : ''}`;
  $$('.day[data-open]', app).forEach((r) => r.addEventListener('click', (ev) => {
    if (ev.target.closest('.ring')) return;
    if (r.dataset.kind) go('prep', { kind: r.dataset.kind }); else go('day', { date: r.dataset.open });
  }));
  $$('.ring', app).forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const i = Number(b.dataset.ring);
    try { await setStatus(dates[i], isDone(d.week[i]) ? null : 'done'); render(); } catch (e) { toast(e.message); }
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

async function viewMore() {
  // Inhalt unverändert, nur neues Aussehen

  const [s, st] = await Promise.all([api('/settings'), api('/auth/state')]);
  const g = s.goal || {};
  app.innerHTML = `<h1>Mehr</h1><h2>Ziel</h2><div class="card">
    <div class="row"><span>Halbmarathon-Zeit</span><input class="txt" id="gt" style="width:110px;margin:0" value="${Math.floor(g.time_s / 3600)}:${String(Math.floor(g.time_s % 3600 / 60)).padStart(2, '0')}:${String(g.time_s % 60).padStart(2, '0')}"></div>
    <div class="row"><span>Wettkampfdatum</span><input class="txt" id="gd" type="date" style="width:160px;margin:0" value="${g.date || ''}"></div>
    <div class="row"><span>Schwellenpuls</span><input class="txt" id="lthr" type="number" style="width:90px;margin:0" value="${s.lthr}"></div>
    <div class="row"><span>Maximalpuls</span><input class="txt" id="mhr" type="number" style="width:90px;margin:0" value="${s.max_hr}"></div>
    <div class="row"><span>Schwellentempo (Startwert)</span><input class="txt" id="ltp" style="width:90px;margin:0" value="${pace(s.lt_pace_s)}"></div>
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


// ---- Automatische Synchronisierung ------------------------------------------
let syncing = false;
async function autoSync(force = false) {
  const last = store.get('auto_sync') || 0;
  if (syncing || (!force && Date.now() - last < 10 * 60 * 1000)) return;
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
function go(view, o = {}) {
  if (['today', 'week', 'analysis', 'more'].includes(view)) { sub = null; tab = view; } else sub = { view, ...o };
  render();
}
async function render() {
  const my = ++renderId;
  if (tab !== 'week' || sub) weekEdit = null;
  const isCurrent = () => my === renderId;
  clearInterval(viewLog.tm);
  $$('#tabs button').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#tabs').hidden = !!sub;
  app.classList.toggle('sub', !!sub);
  window.scrollTo(0, 0);
  try {
    if (sub) { const f = sub.view === 'log' ? viewLog : sub.view === 'day' ? viewDay : viewPrep; await f(app, { ...sub, nav: go }); return; }
    if (tab === 'more') { await viewMore(); return; }
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
  sub = null; $('#tabs').hidden = false; render(); autoSync();
  api('/week').then((d) => store.set('c_week', d)).catch(() => {});
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; sub = null; render(); }));
document.addEventListener('visibilitychange', () => { if (document.hidden || $('#tabs').hidden) return; if (tab === 'today' || tab === 'week') render(); autoSync(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
