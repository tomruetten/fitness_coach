// Krafttag: Heute-Karte, Übungen festlegen, Logbuch.
import { $, $$, esc, kg, dec, store, api, toast, icon } from './util.js';

export const KIND_NAME = { strength_a: 'Kraft A', strength_b: 'Kraft B', strength_x: 'Eigene' };
const slug = (n) => 'x_' + String(n).toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').slice(0, 30);
const pad = (n) => String(n).padStart(2, '0');
const fmtKg = (v) => kg(v);

function lastText(e) {
  if (!e.last?.sets?.length) return 'noch nie gemacht';
  const top = Math.max(...e.last.sets.map((s) => s.kg));
  const reps = e.last.sets[0].reps;
  if (e.timed) return `${reps} s`;
  return top > 0 ? `${reps} × ${fmtKg(top)} kg` : `${reps} Wdh.`;
}
function badge(e) {
  if (!e.last) return '<span class="dbadge neu">neu</span>';
  return e.delta_kg ? `<span class="dbadge up">+${fmtKg(e.delta_kg)} kg</span>` : '<span class="dbadge">gleich</span>';
}
const totalSets = (s) => s.exercises.reduce((a, e) => a + e.sets, 0);

/** Heute-Karte für Krafttage. */
export function heuteKraftCard(d) {
  const s = d.session;
  const shown = s.exercises.slice(0, 4), rest = s.exercises.length - shown.length;
  return `<div class="card hero">
    <div class="hero-top"><div class="kicker" style="color:var(--purple)">${esc(s.title.split(': ')[0])}</div><div class="hero-title">${esc(s.title.split(': ')[1] || s.summary || s.title)}</div></div>
    <div class="stats3"><div><span>Dauer</span><b>${s.duration_min}<small> min</small></b></div><div><span>Übungen</span><b>${s.exercises.length}</b></div><div><span>Sätze</span><b>${totalSets(s)}</b></div></div>
    <div class="lines">${shown.map((e) => `<div class="line"><span class="ln">${esc(e.name)}</span><span class="lv">${e.sets} × ${esc(e.reps)}${e.weight_kg ? ' · ' + fmtKg(e.weight_kg) + ' kg' : ''}</span>${e.delta_kg ? `<span class="dbadge up">+${fmtKg(e.delta_kg)}</span>` : '<span class="dspace"></span>'}</div>`).join('')}${rest > 0 ? `<div class="more-line">und ${rest} weitere Übung${rest > 1 ? 'en' : ''}</div>` : ''}</div>
    <button type="button" class="cta purple" data-go="log" data-kind="${s.kind}">Training starten</button>
    <button type="button" class="link purple" data-go="prep" data-kind="${s.kind}">Übungen anpassen</button>
  </div>`;
}

// ---- Übungen festlegen -----------------------------------------------------
export async function viewPrep(app, { kind, nav }) {
  let s = null, edit = false, list = [], adding = false;
  const load = async (k) => {
    kind = k;
    app.innerHTML = '<p class="muted center-text">Lädt …</p>';
    s = await api('/strength/session?kind=' + k);
    list = s.exercises.map((e) => ({ id: e.id, name: e.name, sets: e.sets, reps: e.reps }));
    draw();
  };
  const draw = () => {
    const by = Object.fromEntries(s.exercises.map((e) => [e.id, e]));
    const wd = new Date(s.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long' });
    app.innerHTML = `<button type="button" class="back" data-act="back">${icon.back}Zurück</button>
      <div class="head row-head"><div><div class="eyebrow">${kind === 'strength_x' ? 'Eigenes Training' : esc(wd)} · ca. ${s.duration_min} min</div><h1>${kind === 'strength_x' ? 'Eigenes Training' : esc(KIND_NAME[kind])}</h1></div>
      <button type="button" class="textbtn" data-act="edit">${edit ? 'Fertig' : 'Bearbeiten'}</button></div>
      <div class="seg" role="group" aria-label="Vorlage">${Object.entries(KIND_NAME).map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${k === kind}" class="${k === kind ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="card list">${list.length ? list.map((e, i) => {
    const o = by[e.id];
    return `<div class="xrow">${edit ? `<button type="button" class="rm" data-rm="${i}" aria-label="${esc(e.name)} entfernen">−</button>` : icon.grip}
        <div class="xmain"><span class="xname">${esc(e.name)}</span><span class="xsub">${edit ? `<span class="mini"><button type="button" data-sd="${i}" aria-label="Sätze verringern">−</button><b>${e.sets}</b><button type="button" data-su="${i}" aria-label="Sätze erhöhen">+</button></span> Sätze · <input class="reps" data-rp="${i}" value="${esc(e.reps)}" aria-label="Wiederholungen" size="6">` : `${e.sets} Sätze · ${o?.last ? 'letztes Mal ' + lastText(o) : 'noch nie gemacht'}`}</span></div>
        ${edit ? '' : o ? badge(o) : '<span class="dbadge neu">neu</span>'}</div>`;
  }).join('') : '<div class="xrow"><span class="muted">Noch keine Übungen. Füge unten die erste hinzu.</span></div>'}</div>
      ${adding ? `<div class="card addbox"><input class="txt" id="newName" placeholder="Name der Übung" autocomplete="off"><div class="addrow"><input class="txt" id="newSets" type="number" inputmode="numeric" value="3" aria-label="Sätze"><input class="txt" id="newReps" value="8" aria-label="Wiederholungen"><button type="button" class="cta small" data-act="addok">Hinzufügen</button></div></div>` : `<button type="button" class="addbtn" data-act="add">${icon.plus}Übung hinzufügen</button>`}
      ${edit && s.customized && kind !== 'strength_x' ? '<button type="button" class="link" data-act="reset">Auf Standard zurücksetzen</button>' : ''}
      <p class="foot">Die Vorgabe „+2,5 kg“ kommt aus deinen letzten Einheiten: Hast du alle Sätze geschafft, schlägt die App etwas mehr Gewicht vor. Du kannst sie jederzeit überschreiben.</p>
      <div class="bar-fixed"><button type="button" class="cta" data-act="start" ${list.length ? '' : 'disabled'}>Training starten</button></div>`;
    bind();
  };
  const persist = async () => { await api('/strength/template', { kind, exercises: list }); };
  const bind = () => {
    $$('[data-kind]', app).forEach((b) => b.addEventListener('click', async () => { if (b.dataset.kind !== kind) { edit = false; adding = false; await load(b.dataset.kind).catch((e) => toast(e.message)); } }));
    $('[data-act=back]', app).onclick = () => nav('today');
    $('[data-act=edit]', app).onclick = async () => {
      if (edit) { try { await persist(); await load(kind); } catch (e) { toast(e.message); } edit = false; draw(); } else { edit = true; draw(); }
    };
    $$('[data-rm]', app).forEach((b) => b.addEventListener('click', () => { list.splice(Number(b.dataset.rm), 1); draw(); }));
    $$('[data-sd]', app).forEach((b) => b.addEventListener('click', () => { const e = list[Number(b.dataset.sd)]; e.sets = Math.max(1, e.sets - 1); draw(); }));
    $$('[data-su]', app).forEach((b) => b.addEventListener('click', () => { const e = list[Number(b.dataset.su)]; e.sets = Math.min(10, e.sets + 1); draw(); }));
    $$('[data-rp]', app).forEach((i) => i.addEventListener('change', () => { list[Number(i.dataset.rp)].reps = i.value.trim() || '8'; }));
    $('[data-act=add]', app)?.addEventListener('click', () => { adding = true; draw(); $('#newName').focus(); });
    $('[data-act=addok]', app)?.addEventListener('click', async () => {
      const name = $('#newName').value.trim();
      if (!name) return toast('Bitte einen Namen eingeben');
      list.push({ id: slug(name), name, sets: Math.max(1, Math.min(10, Number($('#newSets').value) || 3)), reps: $('#newReps').value.trim() || '8' });
      adding = false;
      try { await persist(); await load(kind); } catch (e) { toast(e.message); }
    });
    $('[data-act=reset]', app)?.addEventListener('click', async () => { try { await api('/strength/template', { kind, exercises: null }); edit = false; await load(kind); } catch (e) { toast(e.message); } });
    $('[data-act=start]', app).onclick = async () => { if (edit) { try { await persist(); } catch (e) { return toast(e.message); } } nav('log', { kind }); };
  };
  await load(kind);
}

// ---- Logbuch ---------------------------------------------------------------
export async function viewLog(app, { kind, nav }) {
  const s = await api('/strength/session?kind=' + kind);
  const dk = `draft_${s.date}_${kind}`;
  let st = store.get(dk);
  if (!st || !Array.isArray(st.data)) {
    st = { start: Date.now(), open: 0, data: s.exercises.map((e) => ({ id: e.id, name: e.name, timed: e.timed, last: e.last, sets: e.prefill.map((p) => [p.kg, p.reps, false]) })) };
  }
  let adding = false;
  const save = () => store.set(dk, st);
  const stepKg = 2.5;
  const secs = () => Math.max(0, Math.round((Date.now() - st.start) / 1000));
  const clock = () => `${Math.floor(secs() / 60)}:${pad(secs() % 60)}`;

  const totals = () => {
    let done = 0, all = 0, vol = 0;
    st.data.forEach((e) => e.sets.forEach((x) => { all++; if (x[2]) { done++; if (!e.timed) vol += x[0] * x[1]; } }));
    return { done, all, vol };
  };
  const draw = () => {
    const t = totals();
    app.innerHTML = `<button type="button" class="back" data-act="back">${icon.back}Zurück</button>
    <div class="head row-head"><div><div class="eyebrow">Läuft seit <span id="clock">${clock()}</span> min</div><h1>${esc(s.title.split(': ')[0])}</h1></div><div class="count">${t.done} von ${t.all} Sätzen</div></div>
    <div class="pbar"><div style="width:${t.all ? Math.round((t.done / t.all) * 100) : 0}%"></div></div>
    ${st.data.map((e, ei) => {
    const dn = e.sets.filter((x) => x[2]).length, complete = dn === e.sets.length, open = ei === st.open;
    return `<section class="card ex"><button type="button" class="exhead" data-open="${ei}" aria-expanded="${open}"><div class="xmain"><span class="xtitle">${esc(e.name)}</span><span class="xsub">Letztes Mal: ${e.last ? lastText({ last: e.last, timed: e.timed }) : 'noch nie gemacht'}</span></div><span class="prog${complete ? ' full' : ''}">${dn} / ${e.sets.length}</span></button>
      ${open ? `<div class="exbody"><div class="sethead"><span>Satz</span><span>Zuletzt</span><span>kg</span><span>${e.timed ? 'Sek.' : 'Wdh.'}</span><span></span></div>
      ${e.sets.map((x, si) => {
    const p = e.last?.sets[si] || e.last?.sets[e.last.sets.length - 1];
    return `<div class="setrow"><span class="sn">${si + 1}</span><span class="prev">${p ? fmtKg(p.kg) + ' × ' + p.reps : '–'}</span>
        <div class="step kgs"><button type="button" data-k="${ei}.${si}.-1" aria-label="Gewicht verringern">−</button><span class="${x[2] ? 'v on' : 'v'}">${fmtKg(x[0])}</span><button type="button" data-k="${ei}.${si}.1" aria-label="Gewicht erhöhen">+</button></div>
        <div class="step reps"><button type="button" data-r="${ei}.${si}.-1" aria-label="${e.timed ? 'Sekunden' : 'Wiederholungen'} verringern">−</button><span class="${x[2] ? 'v on' : 'v'}">${x[1]}</span><button type="button" data-r="${ei}.${si}.1" aria-label="${e.timed ? 'Sekunden' : 'Wiederholungen'} erhöhen">+</button></div>
        <button type="button" class="tick${x[2] ? ' on' : ''}" data-d="${ei}.${si}" aria-pressed="${!!x[2]}" aria-label="Satz erledigt">${icon.check}</button></div>`;
  }).join('')}
      <div class="setbtns"><button type="button" class="addset" data-as="${ei}">${icon.plus}Satz hinzufügen</button>${e.sets.length > 1 ? `<button type="button" class="delset" data-ds="${ei}" aria-label="Letzten Satz entfernen">−</button>` : ''}</div></div>` : ''}</section>`;
  }).join('')}
    ${adding ? `<div class="card addbox"><input class="txt" id="newName" placeholder="Name der Übung" autocomplete="off"><button type="button" class="cta small" data-act="addok">Hinzufügen</button></div>` : `<button type="button" class="addbtn" data-act="add">${icon.plus}Übung hinzufügen</button>`}
    <div class="vol"><span>Volumen bisher</span><b>${Math.round(t.vol).toLocaleString('de-DE')}<small> kg</small></b></div>
    <button type="button" class="cta big" data-act="finish">Training beenden</button>`;
    bind();
  };
  const upd = () => { save(); const y = window.scrollY; draw(); window.scrollTo(0, y); };
  const bind = () => {
    $('[data-act=back]', app).onclick = () => { clearInterval(viewLog.tm); nav('today'); };
    $$('[data-open]', app).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.open); st.open = st.open === i ? -1 : i; upd(); }));
    $$('[data-k]', app).forEach((b) => b.addEventListener('click', () => { const [e, i, d] = b.dataset.k.split('.').map(Number); const x = st.data[e].sets[i]; x[0] = Math.max(0, Math.round((x[0] + d * stepKg) * 10) / 10); upd(); }));
    $$('[data-r]', app).forEach((b) => b.addEventListener('click', () => { const [e, i, d] = b.dataset.r.split('.').map(Number); const x = st.data[e].sets[i]; x[1] = Math.max(0, x[1] + d * (st.data[e].timed ? 5 : 1)); upd(); }));
    $$('[data-d]', app).forEach((b) => b.addEventListener('click', () => { const [e, i] = b.dataset.d.split('.').map(Number); const x = st.data[e].sets[i]; x[2] = !x[2]; upd(); }));
    $$('[data-as]', app).forEach((b) => b.addEventListener('click', () => { const e = st.data[Number(b.dataset.as)]; const l = e.sets[e.sets.length - 1]; e.sets.push([l[0], l[1], false]); upd(); }));
    $$('[data-ds]', app).forEach((b) => b.addEventListener('click', () => { const e = st.data[Number(b.dataset.ds)]; if (e.sets.length > 1) e.sets.pop(); upd(); }));
    $('[data-act=add]', app)?.addEventListener('click', () => { adding = true; draw(); $('#newName').focus(); });
    $('[data-act=addok]', app)?.addEventListener('click', () => {
      const name = $('#newName').value.trim();
      if (!name) return toast('Bitte einen Namen eingeben');
      st.data.push({ id: slug(name), name, timed: false, last: null, sets: [0, 0, 0].map(() => [0, 8, false]) });
      st.open = st.data.length - 1; adding = false; upd();
    });
    $('[data-act=finish]', app).onclick = async () => {
      const exercises = st.data.map((e) => ({ id: e.id, name: e.name, sets: e.sets.filter((x) => x[2]).map((x) => ({ weight_kg: x[0], reps: x[1], done: true })) })).filter((e) => e.sets.length);
      if (!exercises.length) return toast('Noch kein Satz abgehakt');
      const b = $('[data-act=finish]', app); b.disabled = true;
      try {
        await api('/strength/sets', { date: s.date, kind: kind === 'strength_x' ? null : kind, exercises });
        store.del(dk); ['c_today', 'c_week'].forEach((k) => store.del(k));
        Object.keys(localStorage).filter((k) => k.startsWith('c_ana_')).forEach((k) => store.del(k));
        clearInterval(viewLog.tm); toast('Training gespeichert'); nav('today');
      } catch (e) { b.disabled = false; toast(e.message); }
    };
  };
  save(); draw();
  clearInterval(viewLog.tm);
  viewLog.tm = setInterval(() => { const c = $('#clock'); if (c) c.textContent = clock(); else clearInterval(viewLog.tm); }, 1000);
}
