// Krank-Modus: Dialog im Profil, Karten auf Heute, Tages-Check-in.
import { $, $$, esc, api, store, toast } from './util.js';

const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const SEV = {
  leicht: ['Leicht', 'Schnupfen oder Halskratzen, alles oberhalb des Halses'],
  mittel: ['Mittel', 'Husten, Gliederschmerzen, abgeschlagen'],
  schwer: ['Schwer', 'Fieber, Husten in der Brust, bettlägerig'],
};
const FEEL = [['besser', 'Besser'], ['gleich', 'Gleich'], ['schlechter', 'Schlechter']];
const NECK = 'Nackenregel: Bei Beschwerden nur oberhalb des Halses (Schnupfen, Halskratzen) ist lockeres Training in Ordnung. Bei Fieber, Husten in der Brust oder Gliederschmerzen ruht der Sport. Nach Fieber mindestens 24 bis 48 Stunden fieberfrei bleiben, bevor du wieder startest.';

/** Alle Zwischenspeicher leeren, die von Krankheit abhängen (Plan, Woche, Rückblick, Verlauf, Profil). */
export function clearCaches() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('c_')).forEach((k) => store.del(k)); } catch { /* privater Modus */ }
}

const feelSeg = (cur) => `<div class="seg ill-feel" role="group" aria-label="Wie geht es dir heute?">${FEEL.map(([k, t]) => `<button type="button" data-illlog="${k}" aria-pressed="${cur === k}" class="${cur === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;

/** Zeile fürs Profil. */
export function illnessSummary(il) {
  if (!il) return 'Gesund';
  if (il.sick) return `Krank seit ${dm(il.start)}`;
  if (il.recovery) return `Wiedereinstieg, Tag ${il.recovery.since} von ${il.recovery.ramp}`;
  return 'Gesund';
}

/** Karte auf Heute an kranken Tagen und an Rückfall-Pausentagen. */
export function sickCard(d) {
  const p = d.plan, relapse = !!p.relapse;
  const color = '#5E5CE6';
  const kicker = relapse ? 'Wiedereinstieg' : `Krank · Tag ${p.illness?.day ?? ''}`.trim();
  return `<div class="card hero ill" style="--a:${color}"><div class="hero-top"><div class="ht-text"><div class="kicker" style="color:${color}">${esc(kicker)}</div><div class="hero-title">${relapse ? 'Heute Pause' : 'Gute Besserung'}</div></div></div>
    <p class="blurb">${esc(p.summary || '')}</p>
    <div class="ill-q">Wie geht es dir heute?</div>${feelSeg(d.illness?.today_log)}
    <button type="button" class="link" data-illopen>${relapse ? 'Wieder krank melden' : 'Krank-Modus verwalten'}</button></div>`;
}

/** Hinweiskarte im Wiedereinstieg über der Einheit. */
export function returnCard(d) {
  const r = d.plan?.illness; if (r?.state !== 'recovery') return '';
  const lines = [`Umfang aktuell ${r.factor} % deines Normalwerts, er steigt täglich weiter.`];
  if (r.easy) lines.push('Heute nur lockere Läufe und leichte Kraft, kein langer Lauf, keine Intervalle.');
  else if (r.quality_blocked) lines.push('Qualitätseinheiten kommen erst in ein paar Tagen zurück, Läufe bleiben locker.');
  if (r.doctor) lines.push('Nach einem schweren Verlauf: lass dich vor dem Training ärztlich abklären, vor allem bei Husten in der Brust oder Herzklopfen.');
  const ico = '<div class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></div>';
  return `<div class="card info ill-return">${ico}<div><b>Wiedereinstieg · Tag ${r.since} von ${r.ramp}</b><ul class="why">${lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="ill-q">Wie fühlst du dich?</div>${feelSeg(d.illness?.today_log)}<button type="button" class="link" data-illopen>Wieder krank melden oder Details</button></div></div>`;
}

/** Verdrahtet Check-in und „verwalten“ in einem Bereich. */
export function bindIllness(root, after) {
  $$('[data-illlog]', root).forEach((b) => b.addEventListener('click', async () => {
    try { await api('/illness', { action: 'log', value: b.dataset.illlog }); clearCaches(); toast('Gespeichert'); after(); } catch (e) { toast(e.message); }
  }));
  $$('[data-illopen]', root).forEach((b) => b.addEventListener('click', () => openIllness(after)));
}

/** Dialog: krank melden, Schweregrad, Check-in, beenden, Wiedereinstieg im Überblick. */
export async function openIllness(after) {
  let v;
  try { v = await api('/illness'); } catch (e) { return toast(e.message); }
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 250); };
  let sev = v.severity || v.recovery?.severity || 'mittel', since = 0;
  const done = (msg) => { clearCaches(); close(); if (msg) toast(msg); after?.(); };
  const act = async (body, msg) => { try { await api('/illness', body); done(msg); } catch (e) { toast(e.message); } };
  const sevList = () => `<div class="group sevlist">${Object.entries(SEV).map(([k, [t, sub]]) => `<button type="button" class="srow btn sev${sev === k ? ' on' : ''}" data-sev="${k}" aria-pressed="${sev === k}"><span class="sl">${t}<small>${sub}</small></span><i class="rad" aria-hidden="true"></i></button>`).join('')}</div>`;
  const draw = () => {
    let body;
    if (v.sick) {
      body = `<h3>Krank seit ${dm(v.start)}</h3><p class="muted">Tag ${v.day}. Die Einheiten zählen nicht als verpasst, Wochenring und Konsistenz bleiben neutral.</p>
        <div class="ill-q">Schweregrad</div>${sevList()}
        <div class="ill-q">Wie geht es dir heute?</div>${feelSeg(v.today_log)}
        <p class="fine">${esc(NECK)}</p>
        <button type="button" class="cta" id="ilEnd">Ich bin wieder fit</button>
        <p class="fine">Der Wiedereinstieg beginnt morgen in Stufen: erst nur lockere Läufe, Umfang und Intensität steigen danach wieder an.</p>
        <button type="button" class="link" id="ilCancel">Krankmeldung zurücknehmen</button><button type="button" class="link" id="ilClose">Schließen</button>`;
    } else if (v.recovery) {
      const r = v.recovery;
      const q = new Date(r.end + 'T12:00'); q.setDate(q.getDate() + r.no_quality + 1);
      const qd = `${String(q.getDate()).padStart(2, '0')}.${String(q.getMonth() + 1).padStart(2, '0')}.`;
      body = `<h3>Wiedereinstieg</h3><p class="muted">Tag ${r.since} von ${r.ramp} nach ${r.pause} Tagen Pause (${SEV[r.severity][0].toLowerCase()}).</p>
        <div class="group"><div class="srow"><span class="sl">Umfang jetzt</span><span class="muted">${r.factor} % vom Normalwert</span></div>
        <div class="srow"><span class="sl">Nur lockere Läufe</span><span class="muted">${r.easy ? `noch ${Math.max(0, r.easy_days - r.since + 1)} Tage` : 'vorbei'}</span></div>
        <div class="srow"><span class="sl">Qualität wieder ab</span><span class="muted">${r.quality_blocked ? qd : 'jetzt möglich'}</span></div>
        <div class="srow"><span class="sl">Kraft</span><span class="muted">leichter, −${Math.round((1 - r.weight_scale) * 100)} % Gewicht</span></div>
        <div class="srow"><span class="sl">Normal ab</span><span class="muted">${dm(r.until)}</span></div></div>
        ${r.doctor ? '<p class="fine">Nach einem schweren Verlauf: lass dich vor dem Training ärztlich abklären, vor allem bei Husten in der Brust oder Herzklopfen.</p>' : ''}
        <div class="ill-q">Wie fühlst du dich?</div>${feelSeg(v.today_log)}
        <p class="fine">Meldest du „schlechter“ oder ist der Ruhepuls deutlich erhöht, macht Coach an dem Tag Pause statt Training.</p>
        <div class="ill-q">Wieder krank?</div>${sevList()}
        <button type="button" class="cta" id="ilStart">Wieder krank melden</button><button type="button" class="link" id="ilClose">Schließen</button>`;
    } else {
      const last = v.recent?.[0];
      body = `<h3>Krank melden</h3><p class="muted">Coach pausiert dann die Einheiten ohne schlechtes Gewissen und plant nach der Genesung den Wiedereinstieg in Stufen, passend zur Dauer und Stärke der Krankheit.</p>
        <div class="ill-q">Wie stark?</div>${sevList()}
        <div class="ill-q">Seit wann?</div><div class="seg" id="ilSince">${[['Heute', 0], ['Gestern', 1], ['Vor 2 Tagen', 2]].map(([t, n]) => `<button type="button" data-since="${n}" class="${since === n ? 'on' : ''}" aria-pressed="${since === n}">${t}</button>`).join('')}</div>
        <p class="fine">${esc(NECK)}</p>
        ${last ? `<p class="fine">Zuletzt: ${dm(last.start)}${last.end ? ' bis ' + dm(last.end) : ''}, ${SEV[last.severity][0].toLowerCase()}.</p>` : ''}
        <button type="button" class="cta" id="ilStart">Krank melden</button><button type="button" class="link" id="ilClose">Abbrechen</button>`;
    }
    el.innerHTML = `<div class="sheet-bg"></div><div class="sheet ill-sheet" role="dialog" aria-modal="true" aria-label="Krank oder erholt"><div class="grabber"></div>${body}</div>`;
    $('.sheet-bg', el).onclick = close;
    $('#ilClose', el)?.addEventListener('click', close);
    $$('[data-sev]', el).forEach((b) => b.addEventListener('click', async () => {
      sev = b.dataset.sev;
      if (v.sick) { try { await api('/illness', { action: 'severity', severity: sev }); v.severity = sev; clearCaches(); after?.(); } catch (e) { return toast(e.message); } }
      draw();
    }));
    $$('[data-since]', el).forEach((b) => b.addEventListener('click', () => { since = Number(b.dataset.since); draw(); }));
    $$('[data-illlog]', el).forEach((b) => b.addEventListener('click', async () => {
      try { await api('/illness', { action: 'log', value: b.dataset.illlog }); v.today_log = b.dataset.illlog; clearCaches(); after?.(); draw(); } catch (e) { toast(e.message); }
    }));
    $('#ilStart', el)?.addEventListener('click', () => {
      const d = new Date(); d.setDate(d.getDate() - since);
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      act({ action: 'start', severity: sev, start }, 'Gute Besserung. Der Plan pausiert.');
    });
    $('#ilEnd', el)?.addEventListener('click', () => act({ action: 'end' }, 'Schön. Der Wiedereinstieg beginnt morgen in Stufen.'));
    $('#ilCancel', el)?.addEventListener('click', () => act({ action: 'cancel' }, 'Krankmeldung zurückgenommen'));
  };
  draw();
}
