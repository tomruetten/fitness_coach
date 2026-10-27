// Holt neue Aktivitäten und Tageswerte von Garmin und schreibt sie in den Speicher.
import { MAX_DAYS, MAX_PAGE } from './client.js';
import { activityFromFit } from './fit.js';
import { addDays, diffDays } from '../engine/dates.js';
import { DEFAULT_SETTINGS } from '../engine/config.js';

const todayIn = (tz) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Tageswerte aus den drei Garmin-Antworten in eine Zeile je Datum umrechnen. */
export function mapHealth({ summaries, sleeps, hrvs }) {
  const by = {};
  const put = (date, o) => { if (date) by[date] = { ...(by[date] || { date }), ...o }; };
  for (const s of summaries?.data || summaries || []) {
    const hr = s.heartRate || {};
    const bb = s.bodyBattery || {};
    put(s.calendarDate, {
      resting_hr: hr.restingValue ?? null,
      body_battery_max: bb.maxValue ?? null,
      body_battery_min: bb.minValue ?? null,
      stress_avg: s.stress?.avgLevel ?? null,
      steps: s.movement?.steps?.value ?? null,
    });
  }
  for (const s of Array.isArray(sleeps) ? sleeps : sleeps?.data || []) {
    if (s.sleepTimeSeconds) put(s.calendarDate, { sleep_s: s.sleepTimeSeconds, sleep_deep_s: s.deepSleepSeconds ?? null, sleep_avg_hr: s.avgHeartRate ?? null });
  }
  const hrvList = hrvs?.hrvSummaries || (Array.isArray(hrvs) ? hrvs : []);
  for (const h of hrvList) if (h.lastNightAvg != null) put(h.calendarDate, { hrv_avg: h.lastNightAvg, hrv_status: h.status ?? null });
  return Object.values(by).filter((r) => Object.keys(r).length > 1);
}

function windows(start, end, maxDays) {
  const out = [];
  for (let s = start; diffDays(end, s) >= 0; s = addDays(s, maxDays)) out.push([s, diffDays(end, addDays(s, maxDays - 1)) < 0 ? end : addDays(s, maxDays - 1)]);
  return out;
}

export async function syncHealth(client, store, { from, to }) {
  let rows = [];
  const part = async (fn, max) => {
    const out = [];
    for (const [a, b] of windows(from, to, max)) {
      try { out.push(await fn(a, b)); } catch (e) { out.push(null); console.warn('Garmin-Teilabruf fehlgeschlagen:', e.message); }
    }
    return out;
  };
  const summaries = await part((a, b) => client.dailySummaries(a, b), MAX_DAYS.summaries);
  const sleeps = await part((a, b) => client.sleepSummaries(a, b), MAX_DAYS.sleep);
  const hrvs = await part((a, b) => client.hrvSummaries(a, b), MAX_DAYS.hrv);
  rows = mapHealth({
    summaries: { data: summaries.flatMap((x) => x?.data || []) },
    sleeps: sleeps.flatMap((x) => (Array.isArray(x) ? x : x?.data || [])),
    hrvs: { hrvSummaries: hrvs.flatMap((x) => x?.hrvSummaries || []) },
  });
  if (rows.length) await store.upsertDays(rows);
  return rows.length;
}

/**
 * Ein Synchronisationsschritt. Verarbeitet höchstens `maxNew` neue Aktivitäten, damit die Serverfunktion
 * unter dem Zeitlimit bleibt. `remaining > 0` heißt: erneut aufrufen.
 */
export async function runSync(client, store, { settings = {}, maxNew = 6, historyFrom = null, deadlineMs = 45000 } = {}) {
  const started = Date.now();
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const tz = s.timezone;
  const today = todayIn(tz);
  const lastSync = await store.getSetting('last_sync');
  const from = historyFrom || (lastSync?.date ? addDays(lastSync.date, -3) : addDays(today, -60));

  // 1. Aktivitätenliste seitenweise
  const wanted = [];
  for (let start = 0; ; start += MAX_PAGE) {
    const page = await client.searchActivities({ start, limit: MAX_PAGE, startDate: from, endDate: addDays(today, 1) });
    if (!page?.length) break;
    for (const a of page) wanted.push(a.activityId);
    if (page.length < MAX_PAGE) break;
  }
  const missing = [];
  for (const id of wanted) if (!(await store.hasActivity(id))) missing.push(id);

  // 2. Neue Aktivitäten: FIT laden und auswerten
  let added = 0;
  const errors = [];
  for (const id of missing) {
    if (added >= maxNew || Date.now() - started > deadlineMs) break;
    try {
      const fit = await client.downloadFit(id);
      const row = await activityFromFit(fit, { activityId: id, lthr: s.lthr, tz });
      await store.upsertActivities([row]);
      added++;
    } catch (e) {
      errors.push({ id, error: e.message });
      if (/Garmin lehnte|401|403/.test(e.message)) throw e;
    }
  }
  const remaining = missing.length - added - errors.length;

  // 3. Tageswerte erst, wenn alle Aktivitäten durch sind (spart Zeit pro Aufruf)
  let healthRows = 0;
  if (remaining <= 0 && Date.now() - started < deadlineMs) {
    healthRows = await syncHealth(client, store, { from: historyFrom || addDays(lastSync?.date || addDays(today, -35), -2), to: today });
    await store.setSetting('last_sync', { date: today, at: new Date().toISOString() });
  }
  return { added, remaining: Math.max(0, remaining), healthRows, errors, done: remaining <= 0 };
}
