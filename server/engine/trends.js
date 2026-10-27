import { addDays, diffDays, mondayOf } from './dates.js';
import { acuteChronic } from './load.js';
import { zoneBounds } from './zones.js';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export function trends(ctx) {
  const { activities, days, settings, date } = ctx;
  const m0 = mondayOf(date);

  const weeks = Array.from({ length: 12 }, (_, i) => addDays(m0, -7 * (11 - i)));
  const weekly = weeks.map((w) => {
    const inW = activities.filter((a) => mondayOf(a.local_date) === w);
    const runs = inW.filter((a) => a.sport === 'running' && a.distance_m > 1500);
    const zone = [0, 0, 0, 0, 0];
    for (const r of runs) (r.zone_s || []).forEach((s, i) => { zone[i] += s; });
    return {
      week: w,
      run_km: Math.round(runs.reduce((a, r) => a + r.distance_m, 0) / 100) / 10,
      run_count: runs.length,
      bike_h: Math.round((inW.filter((a) => a.sport === 'cycling').reduce((a, r) => a + r.duration_s, 0) / 3600) * 10) / 10,
      strength: inW.filter((a) => a.sport === 'strength').length,
      load: Math.round(inW.reduce((a, r) => a + (r.load || 0), 0)),
      zone_s: zone,
    };
  });

  const [b2, b3] = zoneBounds(settings.lthr);
  const months = {};
  for (const a of activities) {
    if (a.sport !== 'running') continue;
    const k = a.local_date.slice(0, 7);
    (months[k] ||= []).push(...(a.km_splits || []).filter((s) => s.hr >= b2 && s.hr < b3 && s.pace_s > 240 && s.pace_s < 480).map((s) => s.pace_s));
  }
  const paceZ2 = Object.entries(months).sort().map(([month, v]) => ({ month, pace_s: v.length >= 4 ? Math.round(median(v)) : null, n: v.length })).slice(-8);

  const hrv = days.filter((d) => d.hrv_avg != null && diffDays(date, d.date) <= 60 && diffDays(date, d.date) >= 0).map((d) => ({ date: d.date, hrv: d.hrv_avg, rhr: d.resting_hr ?? null }));

  const acwr = [];
  for (let i = 55; i >= 0; i--) {
    const d = addDays(date, -i);
    const r = acuteChronic(activities.filter((a) => a.local_date <= d), d);
    acwr.push({ date: d, ratio: r.ratio == null ? null : Math.round(r.ratio * 100) / 100 });
  }

  const form = activities
    .filter((a) => a.sport === 'running' && a.distance_m > 3000 && a.gct_ms)
    .slice(-24)
    .map((a) => ({ date: a.local_date, pace_s: Math.round(a.duration_s / (a.distance_m / 1000)), gct: Math.round(a.gct_ms), cad: a.avg_cadence ? Math.round(a.avg_cadence) : null, vo: a.vo_mm ? Math.round(a.vo_mm) : null }));

  return { weekly, paceZ2, hrv, acwr, form };
}
