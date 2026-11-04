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
function setsText(e) {
  const same = e.sets.every((x) => x.kg === e.sets[0].kg && x.reps === e.sets[0].reps);
  const top = Math.max(...e.sets.map((x) => x.kg));
  if (same) return `${e.sets.length} × ${e.sets[0].reps}${top > 0 ? ' · ' + fmtKg(top) + ' kg' : ''}`;
  return `${e.sets.length} Sätze${top > 0 ? ' · bis ' + fmtKg(top) + ' kg' : ''}`;
}
/** Heute-Karte, wenn das Training schon protokolliert ist: zeigt, was du tatsächlich gemacht hast. */
function doneKraftCard(d) {
  const sd = d.strength_done, name = KIND_NAME[sd.kind] || 'Krafttraining';
  const vol = sd.volume_kg >= 1000 ? `${dec(sd.volume_kg / 1000, 1)}<small> t</small>` : `${sd.volume_kg.toLocaleString('de-DE')}<small> kg</small>`;
  return `<div class="card hero done" style="--a:var(--purple)">
    <div class="hero-top"><div><div class="kicker" style="color:var(--purple)">${esc(name)}</div><div class="hero-title">Training abgeschlossen</div></div><span class="donecheck" aria-hidden="true">${icon.check}</span></div>
    <div class="stats3"><div><span>Übungen</span><b>${sd.exercises.length}</b></div><div><span>Sätze</span><b>${sd.sets}</b></div><div><span>Volumen</span><b>${vol}</b></div></div>
    <div class="lines">${sd.exercises.map((e) => `<div class="line"><span class="ln">${esc(e.name)}</span><span class="lv">${esc(setsText(e))}</span></div>`).join('')}</div>
    <button type="button" class="link purple" data-go="log" data-kind="${sd.kind || 'strength_x'}" data-edit="1">Training bearbeiten</button>
  </div>`;
}

export function heuteKraftCard(d) {
  if (d.strength_done) return doneKraftCard(d);
  const s = d.session;
  const shown = s.exercises.slice(0, 4), rest = s.exercises.length - shown.length;
  return `<div class="card hero" style="--a:var(--purple)">
    <div class="hero-top"><div class="kicker" style="color:var(--purple)">${esc(s.title.split(': ')[0])}</div><div class="hero-title">${esc(s.title.split(': ')[1] || s.summary || s.title)}</div></div>
    <div class="stats3"><div><span>Dauer</span><b>${s.duration_min}<small> min</small></b></div><div><span>Übungen</span><b>${s.exercises.length}</b></div><div><span>Sätze</span><b>${totalSets(s)}</b></div></div>
    <div class="lines">${shown.map((e) => `<div class="line"><span class="ln">${esc(e.name)}</span><span class="lv">${e.sets} × ${esc(e.reps)}${e.weight_kg ? ' · ' + fmtKg(e.weight_kg) + ' kg' : ''}</span>${e.delta_kg ? `<span class="dbadge up">+${fmtKg(e.delta_kg)}</span>` : '<span class="dspace"></span>'}</div>`).join('')}${rest > 0 ? `<div class="more-line">und ${rest} weitere Übung${rest > 1 ? 'en' : ''}</div>` : ''}</div>
    <button type="button" class="cta purple" data-go="log" data-kind="${s.kind}">Mit Plan starten</button>
    <button type="button" class="link purple" data-go="log" data-kind="strength_x" data-blank="1">Leer starten, Übungen später hinzufügen</button>
    <button type="button" class="link purple" data-go="prep" data-kind="${s.kind}">Übungen anpassen</button>
  </div>`;
}


// ---- Übungsauswahl: Dropdown mit allen bekannten Übungen oder neue Übung ---------
const firstNum = (s) => { const m = String(s ?? '').match(/\d+/); return m ? Number(m[0]) : null; };
async function loadCatalog() { return (await api('/strength/exercises')).exercises; }

function pickerHtml(cat, exclude, title) {
  const opts = cat.filter((c) => !exclude.has(c.id));
  return `<div class="card addbox picker"><div class="ptitle">${esc(title)}</div>
    <select class="sel" id="pickSel" aria-label="Übung wählen"><option value="">Übung auswählen …</option>${opts.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}<option value="__new">+ Neue Übung …</option></select>
    <div id="newBox" hidden><input class="txt" id="newName" placeholder="Name der neuen Übung" autocomplete="off"><div class="addrow"><label class="fld">Sätze<input class="txt" id="newSets" type="number" inputmode="numeric" value="3"></label><label class="fld">Wdh.<input class="txt" id="newReps" type="number" inputmode="numeric" value="8"></label></div><label class="chk"><input type="checkbox" id="newTimed"> Nach Zeit (Sekunden statt Wdh.)</label></div>
    <div class="pbtns"><button type="button" class="cta small" data-act="pickok">Hinzufügen</button><button type="button" class="link" data-act="pickcancel">Abbrechen</button></div></div>`;
}
/** Verdrahtet das Auswahlfeld. onPick bekommt eine Übung ({id,name,sets,reps,timed,last,prefill,memo}). */
function pickerBind(root, cat, exclude, onPick, onCancel) {
  const sel = $('#pickSel', root), box = $('#newBox', root);
  sel.addEventListener('change', () => { box.hidden = sel.value !== '__new'; if (!box.hidden) $('#newName', root).focus(); });
  $('[data-act=pickcancel]', root).onclick = onCancel;
  $('[data-act=pickok]', root).onclick = () => {
    if (!sel.value) return toast('Bitte eine Übung auswählen');
    if (sel.value !== '__new') return onPick(cat.find((c) => c.id === sel.value));
    const name = $('#newName', root).value.trim();
    if (!name) return toast('Bitte einen Namen eingeben');
    const same = cat.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same) { if (exclude.has(same.id)) return toast('Diese Übung ist schon dabei'); return onPick(same); }
    const sets = Math.max(1, Math.min(10, Number($('#newSets', root).value) || 3));
    const n = Math.max(1, Number($('#newReps', root).value) || 8), timed = $('#newTimed', root).checked;
    const reps = timed ? `${n} s` : String(n);
    onPick({ id: slug(name), name, sets, reps, timed, last: null, prefill: Array.from({ length: sets }, () => ({ kg: 0, reps: n })), memo: '', fresh: true });
  };
}

// ---- Übungen festlegen ----------------------------------------------------
export async function viewPrep(app, { kind, nav }) {
  let s = null, edit = false, list = [], adding = false, cat = [], saved = [];
  const sessions = {}; // je Vorlage gemerkt, damit das Umschalten sofort geht
  const fetchKind = async (k) => { sessions[k] = await api('/strength/session?kind=' + k); return sessions[k]; };
  const apply = (k) => { kind = k; s = sessions[k]; list = s.exercises.map((e) => ({ id: e.id, name: e.name, sets: e.sets, reps: e.reps })); draw(); };
  const load = async (k, force = false) => {
    if (force || !sessions[k]) { app.classList.add('busy'); try { await fetchKind(k); } finally { app.classList.remove('busy'); } }
    apply(k);
  };
  const draw = () => {
    const by = Object.fromEntries(s.exercises.map((e) => [e.id, e]));
    const wd = new Date(s.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long' });
    app.innerHTML = `<button type="button" class="back" data-act="back">${icon.back}Zurück</button>
      <div class="head row-head"><div><div class="eyebrow">${kind === 'strength_x' ? 'Eigenes Training' : esc(wd)} · ca. ${s.duration_min} min</div><h1>${kind === 'strength_x' ? 'Eigene' : esc(KIND_NAME[kind])}</h1></div>
      <button type="button" class="textbtn" data-act="edit">${edit ? 'Fertig' : 'Bearbeiten'}</button></div>
      <div class="seg" role="group" aria-label="Vorlage">${Object.entries(KIND_NAME).map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${k === kind}" class="${k === kind ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="card list">${list.length ? list.map((e, i) => {
    const o = by[e.id];
    return `<div class="xrow">${edit ? `<button type="button" class="rm" data-rm="${i}" aria-label="${esc(e.name)} entfernen">−</button>` : icon.grip}
        <div class="xmain"><span class="xname">${esc(e.name)}</span>${edit ? `<div class="efields"><div class="ef"><span>Sätze</span><span class="mini"><button type="button" data-sd="${i}" aria-label="Sätze verringern">−</button><b>${e.sets}</b><button type="button" data-su="${i}" aria-label="Sätze erhöhen">+</button></span></div><label class="ef grow"><span>Wiederholungen</span><input class="reps" data-rp="${i}" value="${esc(e.reps)}" placeholder="z. B. 8 oder 30 s" aria-label="Wiederholungen"></label></div>` : ''}<span class="xsub">${edit ? '' : `${e.sets} Sätze · ${o?.last ? 'letztes Mal ' + lastText(o) : 'noch nie gemacht'}`}</span></div>
        ${edit ? '' : o ? badge(o) : '<span class="dbadge neu">neu</span>'}</div>`;
  }).join('') : '<div class="xrow"><span class="muted">Noch keine Übungen. Füge unten die erste hinzu.</span></div>'}</div>
      ${adding ? pickerHtml(cat, new Set(list.map((e) => e.id)), 'Übung zur Vorlage hinzufügen') : `<button type="button" class="addbtn" data-act="add">${icon.plus}Übung hinzufügen</button>`}
      ${saved.length && !adding ? `<button type="button" class="addbtn" data-act="wkload">${icon.plus}Gespeichertes Workout laden</button>` : ''}
      ${edit && s.customized && kind !== 'strength_x' ? '<button type="button" class="link" data-act="reset">Auf Standard zurücksetzen</button>' : ''}
      <p class="foot">Die Auswahlliste enthält alle Übungen, die du je angelegt oder trainiert hast. Die Vorgabe „+2,5 kg“ kommt aus deinen letzten Einheiten: Hast du alle Sätze geschafft, schlägt die App etwas mehr Gewicht vor.</p>
      <div class="bar-fixed two"><button type="button" class="cta" data-act="start" ${list.length ? '' : 'disabled'}>Mit dieser Vorlage starten</button><button type="button" class="cta ghost" data-act="blank">Leer starten, Übungen später hinzufügen</button></div>`;
    bind();
  };
  const persist = async () => { await api('/strength/template', { kind, exercises: list }); };
  const openWorkoutList = () => {
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    const target = kind === 'strength_x' ? 'Eigene' : KIND_NAME[kind];
    const rows = () => saved.map((w) => `<div class="srow wk"><button type="button" class="wkmain" data-wload="${esc(w.id)}"><span class="sl">${esc(w.name)}</span><span class="muted">${w.exercises.length} ${w.exercises.length === 1 ? "Übung" : "Übungen"}</span></button><button type="button" class="rm" data-wdel="${esc(w.id)}" aria-label="${esc(w.name)} löschen">−</button></div>`).join('');
    el.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Gespeichertes Workout laden"><div class="grabber"></div><h3>Gespeichertes Workout laden</h3><p class="muted">Ein Tipp ersetzt die Übungen in ${esc(target)}.</p><div class="group" id="wkList">${rows()}</div><button type="button" class="link" id="wkClose">Abbrechen</button></div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('open'));
    const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 250); };
    $('.sheet-bg', el).onclick = close; $('#wkClose', el).onclick = close;
    const wire = () => {
      $$('[data-wload]', el).forEach((b) => b.addEventListener('click', async () => {
        const w = saved.find((x) => x.id === b.dataset.wload); if (!w) return;
        list = w.exercises.map((e) => ({ ...e })); adding = false; close();
        try { await persist(); await load(kind, true); toast(`„${w.name}" geladen`); } catch (e) { toast(e.message); }
      }));
      $$('[data-wdel]', el).forEach((b) => b.addEventListener('click', async () => {
        try { await api('/strength/workouts', { delete: b.dataset.wdel }); saved = saved.filter((x) => x.id !== b.dataset.wdel); if (!saved.length) { close(); draw(); return; } $('#wkList', el).innerHTML = rows(); wire(); draw(); } catch (e) { toast(e.message); }
      }));
    };
    wire();
  };
  const bind = () => {
    $$('[data-kind]', app).forEach((b) => b.addEventListener('click', async () => { if (b.dataset.kind !== kind) { edit = false; adding = false; await load(b.dataset.kind).catch((e) => toast(e.message)); } }));
    $('[data-act=back]', app).onclick = () => nav('back');
    $('[data-act=edit]', app).onclick = async () => {
      if (edit) { try { await persist(); await load(kind, true); } catch (e) { toast(e.message); } edit = false; draw(); } else { edit = true; draw(); }
    };
    $$('[data-rm]', app).forEach((b) => b.addEventListener('click', () => { list.splice(Number(b.dataset.rm), 1); draw(); }));
    $$('[data-sd]', app).forEach((b) => b.addEventListener('click', () => { const e = list[Number(b.dataset.sd)]; e.sets = Math.max(1, e.sets - 1); draw(); }));
    $$('[data-su]', app).forEach((b) => b.addEventListener('click', () => { const e = list[Number(b.dataset.su)]; e.sets = Math.min(10, e.sets + 1); draw(); }));
    $$('[data-rp]', app).forEach((i) => i.addEventListener('change', () => { list[Number(i.dataset.rp)].reps = i.value.trim() || '8'; }));
    $('[data-act=wkload]', app)?.addEventListener('click', () => openWorkoutList());
    $('[data-act=add]', app)?.addEventListener('click', () => { adding = true; draw(); });
    if (adding) pickerBind(app, cat, new Set(list.map((e) => e.id)), async (c) => {
      list.push({ id: c.id, name: c.name, sets: c.sets, reps: c.reps }); adding = false;
      try { await persist(); await load(kind, true); } catch (e) { toast(e.message); }
    }, () => { adding = false; draw(); });
    $('[data-act=reset]', app)?.addEventListener('click', async () => { try { await api('/strength/template', { kind, exercises: null }); edit = false; await load(kind, true); } catch (e) { toast(e.message); } });
    $('[data-act=start]', app).onclick = async () => { if (edit) { try { await persist(); } catch (e) { return toast(e.message); } } nav('log', { kind }); };
    $('[data-act=blank]', app).onclick = () => nav('log', { kind: 'strength_x', blank: true });
  };
  app.innerHTML = '<p class="muted center-text">Lädt …</p>';
  let wk;
  [, cat, wk] = await Promise.all([fetchKind(kind), loadCatalog(), api('/strength/workouts').catch(() => ({ workouts: [] }))]);
  saved = wk.workouts || [];
  apply(kind);
  Object.keys(KIND_NAME).filter((k) => k !== kind).forEach((k) => fetchKind(k).catch(() => {})); // übrige Vorlagen im Hintergrund
}

// ---- Logbuch ---------------------------------------------------------------
export async function viewLog(app, { kind, blank, edit, nav }) {
  const [s, cat0] = await Promise.all([api('/strength/session?kind=' + kind + (blank ? '&blank=1' : '') + (edit ? '&edit=1' : '')), loadCatalog()]);
  let cat = cat0;
  const dk = `draft_${s.date}_${edit ? 'edit' : blank ? 'blank' : kind}`;
  const mk = (e) => ({ id: e.id, name: e.name, timed: !!e.timed, last: e.last || null, note: e.memo || '', reps: e.reps || '8', sets: (e.prefill?.length ? e.prefill : Array.from({ length: e.sets || 3 }, () => ({ kg: 0, reps: firstNum(e.reps) || 8 }))).map((p) => [p.kg, p.reps, !!e.done]) });
  let st = store.get(dk);
  if (!st || !Array.isArray(st.data)) st = { start: Date.now(), open: blank ? -1 : 0, data: s.exercises.map(mk) };
  let picking = null; // {mode:'add'} | {mode:'replace', ei}
  let armed = -1;     // Entfernen-Bestätigung
  if (blank && !st.data.length) picking = { mode: 'add' };
  const save = () => store.set(dk, st);
  const stepKg = 0.5;
  const secs = () => Math.max(0, Math.round((Date.now() - st.start) / 1000));
  const clock = () => `${Math.floor(secs() / 60)}:${pad(secs() % 60)}`;
  const ids = () => new Set(st.data.map((e) => e.id));

  const totals = () => {
    let done = 0, all = 0, vol = 0;
    st.data.forEach((e) => e.sets.forEach((x) => { all++; if (x[2]) { done++; if (!e.timed) vol += x[0] * x[1]; } }));
    return { done, all, vol };
  };
  const draw = () => {
    const t = totals();
    app.innerHTML = `<button type="button" class="back" data-act="back">${icon.back}Zurück</button>
    <div class="head row-head"><div><div class="eyebrow">${edit ? 'Bereits gespeichert' : `Läuft seit <span id="clock">${clock()}</span> min`}</div><h1>${edit ? 'Training bearbeiten' : esc(s.title.split(': ')[0])}</h1></div><div class="count">${t.done} von ${t.all} Sätzen</div></div>
    <div class="pbar"><div style="width:${t.all ? Math.round((t.done / t.all) * 100) : 0}%"></div></div>
    ${st.data.length ? '' : '<div class="card muted emptyhint">Noch keine Übungen. Wähle unten die erste aus.</div>'}
    ${st.data.map((e, ei) => {
    const dn = e.sets.filter((x) => x[2]).length, complete = dn === e.sets.length && e.sets.length > 0, open = ei === st.open;
    return `<section class="card ex"><button type="button" class="exhead" data-open="${ei}" aria-expanded="${open}"><div class="xmain"><span class="xtitle">${esc(e.name)}</span><span class="xsub">Letztes Mal: ${e.last ? lastText({ last: e.last, timed: e.timed }) : 'noch nie gemacht'}${e.note ? ' · Notiz' : ''}</span></div><span class="prog${complete ? ' full' : ''}">${dn} / ${e.sets.length}</span></button>
      ${open ? `<div class="exbody"><div class="sethead"><span>Satz</span><span>Zuletzt</span><span>kg</span><span>${e.timed ? 'Sek.' : 'Wdh.'}</span><span></span></div>
      ${e.sets.map((x, si) => {
    const p = e.last?.sets[si] || e.last?.sets[e.last.sets.length - 1];
    return `<div class="setrow"><span class="sn">${si + 1}</span><span class="prev">${p ? fmtKg(p.kg) + ' × ' + p.reps : '–'}</span>
        <div class="step kgs"><button type="button" data-k="${ei}.${si}.-1" aria-label="Gewicht verringern">−</button><input class="${x[2] ? 'v on' : 'v'}" inputmode="decimal" data-kin="${ei}.${si}" value="${fmtKg(x[0])}" aria-label="Gewicht in kg"><button type="button" data-k="${ei}.${si}.1" aria-label="Gewicht erhöhen">+</button></div>
        <div class="step reps"><button type="button" data-r="${ei}.${si}.-1" aria-label="${e.timed ? 'Sekunden' : 'Wiederholungen'} verringern">−</button><span class="${x[2] ? 'v on' : 'v'}">${x[1]}</span><button type="button" data-r="${ei}.${si}.1" aria-label="${e.timed ? 'Sekunden' : 'Wiederholungen'} erhöhen">+</button></div>
        <button type="button" class="tick${x[2] ? ' on' : ''}" data-d="${ei}.${si}" aria-pressed="${!!x[2]}" aria-label="Satz erledigt">${icon.check}</button></div>`;
  }).join('')}
      <div class="setbtns"><button type="button" class="addset" data-as="${ei}">${icon.plus}Satz hinzufügen</button>${e.sets.length > 1 ? `<button type="button" class="delset" data-ds="${ei}" aria-label="Letzten Satz entfernen">−</button>` : ''}</div>
      <textarea class="memo" data-note="${ei}" rows="2" placeholder="Notiz, z. B. Sitzeinstellung am Gerät" aria-label="Notiz zu ${esc(e.name)}">${esc(e.note)}</textarea>
      ${picking?.mode === 'replace' && picking.ei === ei ? pickerHtml(cat, ids(), 'Ersetzen durch') : `<div class="exacts"><button type="button" data-rep="${ei}">Ersetzen</button><button type="button" class="danger" data-del="${ei}">${armed === ei ? 'Wirklich entfernen?' : 'Entfernen'}</button></div>`}</div>` : ''}</section>`;
  }).join('')}
    ${picking?.mode === 'add' ? pickerHtml(cat, ids(), 'Übung hinzufügen') : `<button type="button" class="addbtn" data-act="add">${icon.plus}Übung hinzufügen</button>`}
    <div class="vol"><span>Volumen bisher</span><b>${Math.round(t.vol).toLocaleString('de-DE')}<small> kg</small></b></div>
    <button type="button" class="cta big" data-act="finish">Training beenden</button>`;
    bind();
  };
  const upd = () => { save(); const y = window.scrollY; draw(); window.scrollTo(0, y); };
  const bind = () => {
    $('[data-act=back]', app).onclick = () => { clearInterval(viewLog.tm); nav('back'); };
    $$('[data-open]', app).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.open); st.open = st.open === i ? -1 : i; armed = -1; picking = null; upd(); }));
    $$('[data-k]', app).forEach((b) => b.addEventListener('click', () => { const [e, i, d] = b.dataset.k.split('.').map(Number); const x = st.data[e].sets[i]; x[0] = Math.max(0, Math.round((x[0] + d * stepKg) * 10) / 10); upd(); }));
    $$('[data-kin]', app).forEach((inp) => {
      const [e, i] = inp.dataset.kin.split('.').map(Number);
      inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); });
      inp.addEventListener('change', () => {
        const v = Number(inp.value.trim().replace(',', '.'));
        if (!Number.isFinite(v) || v < 0 || v > 600) { toast('Bitte ein Gewicht in kg eingeben'); inp.value = fmtKg(st.data[e].sets[i][0]); return; }
        st.data[e].sets[i][0] = Math.round(v * 100) / 100; upd();
      });
    });
    $$('[data-r]', app).forEach((b) => b.addEventListener('click', () => { const [e, i, d] = b.dataset.r.split('.').map(Number); const x = st.data[e].sets[i]; x[1] = Math.max(0, x[1] + d * (st.data[e].timed ? 5 : 1)); upd(); }));
    $$('[data-d]', app).forEach((b) => b.addEventListener('click', () => { const [e, i] = b.dataset.d.split('.').map(Number); const x = st.data[e].sets[i]; x[2] = !x[2]; upd(); }));
    $$('[data-as]', app).forEach((b) => b.addEventListener('click', () => { const e = st.data[Number(b.dataset.as)]; const l = e.sets[e.sets.length - 1] || [0, firstNum(e.reps) || 8]; e.sets.push([l[0], l[1], false]); upd(); }));
    $$('[data-ds]', app).forEach((b) => b.addEventListener('click', () => { const e = st.data[Number(b.dataset.ds)]; if (e.sets.length > 1) e.sets.pop(); upd(); }));
    $$('[data-note]', app).forEach((n) => n.addEventListener('input', () => { st.data[Number(n.dataset.note)].note = n.value; save(); }));
    $$('[data-rep]', app).forEach((b) => b.addEventListener('click', () => { picking = { mode: 'replace', ei: Number(b.dataset.rep) }; armed = -1; upd(); }));
    $$('[data-del]', app).forEach((b) => b.addEventListener('click', () => {
      const ei = Number(b.dataset.del), e = st.data[ei];
      if (e.sets.some((x) => x[2]) && armed !== ei) { armed = ei; return upd(); }
      st.data.splice(ei, 1); armed = -1; st.open = Math.min(st.open, st.data.length - 1); upd();
    }));
    $('[data-act=add]', app)?.addEventListener('click', () => { picking = { mode: 'add' }; upd(); });
    if (picking) pickerBind(app, cat, ids(), (c) => {
      const e = mk(c);
      if (picking.mode === 'replace') { st.data[picking.ei] = e; st.open = picking.ei; } else { st.data.push(e); st.open = st.data.length - 1; }
      picking = null; upd();
    }, () => { picking = null; upd(); });
    $('[data-act=finish]', app).onclick = async () => {
      const exercises = st.data.map((e) => ({ id: e.id, name: e.name, reps_spec: e.reps, sets: e.sets.filter((x) => x[2]).map((x) => ({ weight_kg: x[0], reps: x[1], done: true })) })).filter((e) => e.sets.length);
      if (!exercises.length) return toast('Noch kein Satz abgehakt');
      const notes = Object.fromEntries(st.data.map((e) => [e.id, e.note || '']));
      const b = $('[data-act=finish]', app); b.disabled = true;
      try {
        await api('/strength/sets', { date: s.date, kind: kind === 'strength_x' ? null : kind, exercises, notes, edit: !!edit });
        store.del(dk); ['c_today', 'c_week'].forEach((k) => store.del(k));
        Object.keys(localStorage).filter((k) => k.startsWith('c_ana_')).forEach((k) => store.del(k));
        clearInterval(viewLog.tm); toast('Training gespeichert');
        if (blank && !edit) await askSaveWorkout(exercises);
        nav('home');
      } catch (e) { b.disabled = false; toast(e.message); }
    };
  };
  save(); draw();
  clearInterval(viewLog.tm);
  viewLog.tm = setInterval(() => { const c = $('#clock'); if (c) c.textContent = clock(); else clearInterval(viewLog.tm); }, 1000);
}

/** Nach einem freien Training: Workout als Vorlage speichern? Wartet, bis der Dialog geschlossen ist. */
function askSaveWorkout(exercises) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    el.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Workout speichern"><div class="grabber"></div><h3>Workout speichern?</h3><p class="muted">${exercises.length} Übungen. Gespeicherte Workouts kannst du später in Kraft A, Kraft B oder Eigene laden.</p>
      <input class="txt" id="wkName" placeholder="Name, z. B. Oberkörper schwer" autocomplete="off" maxlength="40">
      <button type="button" class="cta" id="wkSave">Speichern</button><button type="button" class="link" id="wkSkip">Nicht speichern</button></div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('open'));
    const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 250); resolve(); };
    $('#wkSkip', el).onclick = close;
    $('#wkSave', el).onclick = async () => {
      const name = $('#wkName', el).value.trim();
      if (!name) return toast('Bitte einen Namen eingeben');
      const b = $('#wkSave', el); b.disabled = true;
      try {
        await api('/strength/workouts', { name, exercises: exercises.map((e) => ({ id: e.id, name: e.name, sets: e.sets.length, reps: e.reps_spec || String(e.sets[0]?.reps ?? 8) })) });
        toast('Workout gespeichert'); close();
      } catch (e) { b.disabled = false; toast(e.message); }
    };
  });
}
