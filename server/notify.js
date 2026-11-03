// Mitteilungen: eine Liste von Arten, jede mit Zeitfenster (lokale Stunde) und Bedingung. Neue Arten kommen hier dazu;
// die Oberfläche im Profil zeigt automatisch alle Einträge aus NOTIFICATIONS.
import { loadContext, loadSettings } from './context.js';
import { planDay, readiness } from './engine/planner.js';
import { pushReady, sendAll } from './push.js';

const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const km = (v) => String(v).replace('.', ',');

export const NOTIFICATIONS = [
  {
    id: 'morning',
    title: 'Morgens: Einheit des Tages',
    desc: 'Gegen 6 Uhr: heutige Einheit und deine Erholung.',
    window: [5, 9],
    async build({ ctx }) {
      const rd = readiness(ctx);
      const plan = planDay(ctx, { rd });
      if (plan.kind === 'rest') return { title: 'Heute', body: 'Heute ist Ruhetag. Gute Erholung!', url: '/' };
      const tail = rd.level === 'low' ? ' Dein Körper braucht Erholung, die Einheit ist entschärft.' : rd.level === 'medium' ? ' Leicht müde, achte auf den Puls.' : '';
      const dist = plan.targets?.distance_km && String(plan.kind).startsWith('run') ? ` · ${km(plan.targets.distance_km)} km` : '';
      return { title: rd.score != null ? `Heute · Erholung ${rd.score}` : 'Heute', body: `${plan.title}${dist}.${tail}`, url: '/' };
    },
  },
  {
    id: 'evening',
    title: 'Abends: Einheit eintragen',
    desc: 'Um 22 Uhr, nur wenn die Einheit noch nicht als erledigt oder ausgefallen eingetragen ist. Nicht an Ruhetagen.',
    window: [22, 23],
    needsSync: true,
    async build({ ctx }) {
      const plan = planDay(ctx, { rd: readiness(ctx) });
      if (plan.kind === 'rest') return null;
      if (ctx.settings._status?.[ctx.date]) return null; // bereits eingetragen (erledigt oder ausgefallen)
      const grp = String(plan.kind).startsWith('run') ? 'running' : String(plan.kind).startsWith('strength') ? 'strength' : 'cycling';
      if (ctx.activities.some((a) => a.local_date === ctx.date && a.sport === grp)) return null; // von Garmin erkannt, gilt als erledigt
      return { title: 'Einheit eintragen', body: `${plan.title}: war sie heute erledigt oder ist sie ausgefallen? Kurz im Plan eintragen.`, url: '/' };
    },
  },
];

export const defaultPrefs = () => Object.fromEntries(NOTIFICATIONS.map((n) => [n.id, true]));

export async function getPrefs(store) {
  return { ...defaultPrefs(), ...((await store.getSetting('notify_prefs')) || {}) };
}

/**
 * Prüft alle Mitteilungsarten und verschickt die fälligen. Läuft von Cron-Aufrufen; jede Art geht pro Tag höchstens einmal raus.
 * @param {{store:object, sync?:()=>Promise<void>, send?:Function, hour?:number}} o
 */
export async function runNotifications({ store, sync = null, send = sendAll, hour = null, force = null }) {
  const settings = await loadSettings(store);
  const h = hour ?? hourIn(settings.timezone);
  const subs = (await store.getSetting('push_subs')) || [];
  if (!subs.length || (send === sendAll && !pushReady())) return { sent: [], skipped: 'keine Abos oder Schlüssel' };
  const prefs = await getPrefs(store);
  const sentLog = (await store.getSetting('notify_sent')) || {};
  const out = [];
  let live = subs;
  for (const n of NOTIFICATIONS) {
    if (!prefs[n.id]) continue;
    if (force !== n.id && (h < n.window[0] || h > n.window[1])) continue;
    let ctx = await loadContext(store);
    if (force !== n.id && sentLog[n.id] === ctx.date) continue;
    if (n.needsSync && sync) { try { await sync(); ctx = await loadContext(store); } catch { /* Garmin gerade nicht erreichbar: mit dem bekannten Stand entscheiden */ } }
    const payload = await n.build({ ctx });
    sentLog[n.id] = ctx.date; // auch „nichts zu senden“ zählt, damit es nicht erneut geprüft wird
    if (!payload) { out.push({ id: n.id, sent: 0, reason: 'nicht nötig' }); continue; }
    const r = await send(live, payload);
    live = r.subs;
    out.push({ id: n.id, sent: r.sent });
  }
  await store.setSetting('notify_sent', sentLog);
  if (live.length !== subs.length) await store.setSetting('push_subs', live);
  return { sent: out };
}
