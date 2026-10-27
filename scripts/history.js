// Lädt Aktivitäten (activities.json) und Garmin-Tageswerte (health/*.json) aus einem lokalen Ordner.
import fs from 'fs';
import path from 'path';

export function loadHealthDays(dir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'health', f), 'utf8')); } catch { return []; } };
  const by = {};
  const put = (date, o) => { by[date] = { ...(by[date] || { date }), ...o }; };
  for (const x of read('hrv.json')) if (x.lastNightAvg != null) put(x.calendarDate, { hrv_avg: x.lastNightAvg, hrv_status: x.status });
  for (const x of read('sleep.json')) if (x.sleepTimeSeconds) put(x.calendarDate, { sleep_s: x.sleepTimeSeconds, sleep_deep_s: x.deepSleepSeconds, sleep_avg_hr: x.avgHeartRate });
  for (const x of read('daily_summaries.json')) {
    const hr = x.heartRate || {};
    if (hr.restingValue) put(x.calendarDate, { resting_hr: hr.restingValue });
    if (x.bodyBattery?.maxValue != null) put(x.calendarDate, { body_battery_max: x.bodyBattery.maxValue });
  }
  return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
}

export function loadHistory(dir) {
  const activities = JSON.parse(fs.readFileSync(path.join(dir, 'activities.json'), 'utf8'));
  return { activities, days: loadHealthDays(dir) };
}
