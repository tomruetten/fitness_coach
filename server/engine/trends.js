import { addDays, diffDays } from './dates.js';
import { acuteChronic } from './load.js';
import { zoneBounds } from './zones.js';
import { buckets } from './buckets.js';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Zeitraum, den die Datenbank für `range` laden muss. */
export function trendsWindow(range, date) {
  const { list } = buckets(range, date);
  return { from: addDays(list[0].from, -30), days: [addDays(list[0].from, 0), addDays(date, -60)].sort()[0] };
}

export function trends(ctx, range = 'month') {
  const { activities, days, settings, date } = ctx;
  const { list, sub } = buckets(range, date);
  const [b2, b3] = zoneBounds(settings.lthr);
  const isRun = (a) => a.sport === 'running' && a.distance_m > 1500;

  const minRunsForPace = range === 'week' ? 1 : 2;
  const out = { range, sub, labels: list.map((b) => b.label), names: list.map((b) => b.name), future: list.map((b) => b.future), km: [], zones: [], z2: [], hrv: [], rhr: [], acwr: [], gct: [], cad: [], sleep: [], bb: [], stress: [] };
  // Normalbereich: Mittel ± 1 Standardabweichung der Tageswerte der letzten 60 Tage
  const band = (key) => {
    const v = days.filter((d) => d.date > addDays(date, -60) && d.date <= date).map((d) => d[key]).filter(Number.isFinite);
    if (v.length < 14) return null;
    const m = mean(v), sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    return [r1(m - sd), r1(m + sd)];
  };
  out.hrv_band = band('hrv_avg');
  out.rhr_band = band('resting_hr');
  const total = [0, 0, 0, 0, 0];
  let runs = 0, km = 0, time = 0;

  for (const b of list) {
    if (b.future) { out.km.push(null); out.zones.push(null); out.z2.push(null); out.hrv.push(null); out.rhr.push(null); out.acwr.push(null); out.gct.push(null); out.cad.push(null); out.sleep.push(null); out.bb.push(null); out.stress.push(null); continue; }
    const inB = activities.filter((a) => a.local_date >= b.from && a.local_date <= b.to);
    const rs = inB.filter(isRun);
    const bKm = rs.reduce((a, r) => a + r.distance_m, 0) / 1000;
    runs += rs.length; km += bKm; time += rs.reduce((a, r) => a + r.duration_s, 0);
    out.km.push(r1(bKm));

    const zone = [0, 0, 0, 0, 0];
    for (const r of rs) (r.zone_s || []).forEach((s, i) => { zone[i] += s; total[i] += s; });
    const zt = zone.reduce((a, c) => a + c, 0);
    out.zones.push(zt > 0 ? zone.map((s) => Math.round((s / zt) * 100)) : null);

    const paces = rs.flatMap((r) => (r.km_splits || []).filter((s) => s.hr >= b2 && s.hr < b3 && s.pace_s > 240 && s.pace_s < 480).map((s) => s.pace_s));
    out.z2.push(paces.length >= 3 && rs.length >= minRunsForPace ? Math.round(median(paces)) : null);

    const ds = days.filter((d) => d.date >= b.from && d.date <= b.to);
    const hrv = ds.map((d) => d.hrv_avg).filter(Number.isFinite);
    const rhr = ds.map((d) => d.resting_hr).filter(Number.isFinite);
    out.hrv.push(hrv.length ? Math.round(mean(hrv)) : null);
    out.rhr.push(rhr.length ? Math.round(mean(rhr)) : null);
    const sl = ds.map((d) => d.sleep_s).filter((v) => Number.isFinite(v) && v > 0);
    const bb = ds.map((d) => d.body_battery_max).filter(Number.isFinite);
    const sr = ds.map((d) => d.stress_avg).filter((v) => Number.isFinite(v) && v >= 0);
    out.sleep.push(sl.length ? r1(mean(sl) / 3600) : null);
    out.bb.push(bb.length ? Math.round(mean(bb)) : null);
    out.stress.push(sr.length ? Math.round(mean(sr)) : null);

    const end = b.to > date ? date : b.to;
    const ac = acuteChronic(activities.filter((a) => a.local_date <= end), end);
    out.acwr.push(ac.ratio == null ? null : Math.round(ac.ratio * 100) / 100);

    const g = rs.map((r) => r.gct_ms).filter(Number.isFinite);
    out.gct.push(g.length ? Math.round(mean(g)) : null);
    const cd = rs.map((r) => r.avg_cadence).filter((v) => Number.isFinite(v) && v > 100);
    out.cad.push(cd.length ? Math.round(mean(cd)) : null);
  }
  // Durchschnitte über den gewählten Zeitraum (bis heute)
  const from = list[0].from;
  const wd = days.filter((d) => d.date >= from && d.date <= date);
  const wa = activities.filter((a) => a.local_date >= from && a.local_date <= date && isRun(a));
  const avgOf = (xs, f = (v) => Math.round(v)) => { const v = xs.filter(Number.isFinite); return v.length ? f(mean(v)) : null; };
  const allPaces = wa.flatMap((r) => (r.km_splits || []).filter((s) => s.hr >= b2 && s.hr < b3 && s.pace_s > 240 && s.pace_s < 480).map((s) => s.pace_s));
  out.avg = {
    hrv: avgOf(wd.map((d) => d.hrv_avg)), rhr: avgOf(wd.map((d) => d.resting_hr)),
    sleep: avgOf(wd.map((d) => (d.sleep_s > 0 ? d.sleep_s : NaN)), (v) => r1(v / 3600)),
    bb: avgOf(wd.map((d) => d.body_battery_max)), stress: avgOf(wd.map((d) => d.stress_avg)),
    z2: allPaces.length >= 3 ? Math.round(median(allPaces)) : null,
    gct: avgOf(wa.map((r) => r.gct_ms)), cad: avgOf(wa.map((r) => (r.avg_cadence > 100 ? r.avg_cadence : NaN))),
    acwr: avgOf(out.acwr, (v) => Math.round(v * 100) / 100),
  };
  const tz = total.reduce((a, c) => a + c, 0);
  out.z12 = tz ? Math.round(((total[0] + total[1]) / tz) * 100) : null;
  out.kpis = { runs, km: r1(km), time_s: Math.round(time) };
  return out;
}

export { diffDays };
