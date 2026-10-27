// FIT-Datei -> Aktivitätszeile. Reine Funktionen, keine Datenbank- oder Netzwerkzugriffe.
import FitParserPkg from 'fit-file-parser';
import { zoneSeconds } from '../engine/zones.js';
import { activityLoad } from '../engine/load.js';

const FitParser = FitParserPkg.default || FitParserPkg;

export function localDate(iso, tz = 'Europe/Berlin') {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function mapSport(sport, sub) {
  if (sport === 'running') return 'running';
  if (sport === 'cycling') return 'cycling';
  if (sport === 'training' && String(sub).includes('strength')) return 'strength';
  if (sport === 'swimming') return 'swimming';
  if (sport === 'tennis') return 'tennis';
  return 'other';
}

export function parseFit(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', temperatureUnit: 'celsius', elapsedRecordField: true, mode: 'list' });
    parser.parse(buffer, (err, data) => (err ? reject(new Error(String(err))) : resolve(data)));
  });
}

/** Records -> Samples mit Zeitschritt dt (max. 10 s, damit Pausen nicht zählen). */
export function toSamples(records) {
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const t = new Date(r.timestamp).getTime() / 1000;
    const next = records[i + 1] ? new Date(records[i + 1].timestamp).getTime() / 1000 : t + 1;
    out.push({
      t,
      dt: Math.max(0, Math.min(next - t, 10)),
      hr: r.heart_rate || 0,
      speed: r.enhanced_speed ?? r.speed ?? 0,
      dist: r.distance ?? null,
      cad: r.cadence ?? null,
      frac: r.fractional_cadence ?? 0,
      gct: r.stance_time ?? null,
      vo: r.vertical_oscillation ?? null,
      sl: r.step_length ?? null,
      pw: r.power ?? null,
    });
  }
  return out;
}

/** Beste zusammenhängende Anstrengung über `windowS` Sekunden (Pace und mittlerer Puls). */
export function bestEffort(samples, windowS) {
  const pts = samples.filter((s) => s.dist != null);
  if (pts.length < 2) return null;
  const cumHr = [0];
  for (const s of pts) cumHr.push(cumHr[cumHr.length - 1] + s.hr * s.dt);
  const cumT = [0];
  for (const s of pts) cumT.push(cumT[cumT.length - 1] + s.dt);
  let best = null;
  let j = 0;
  for (let i = 0; i < pts.length; i++) {
    if (j < i) j = i;
    while (j < pts.length - 1 && pts[j].t - pts[i].t < windowS) j++;
    const span = pts[j].t - pts[i].t;
    if (span < windowS || span > windowS * 1.15) continue; // Pausen im Fenster aussortieren
    const dist = pts[j].dist - pts[i].dist;
    if (dist <= 0) continue;
    const speed = dist / span;
    if (!best || speed > best.speed) {
      const hr = (cumHr[j + 1] - cumHr[i]) / Math.max(1, cumT[j + 1] - cumT[i]);
      best = { speed, pace_s: 1000 / speed, hr: Math.round(hr), at: new Date(pts[i].t * 1000).toISOString() };
    }
  }
  return best && { pace_s: Math.round(best.pace_s), hr: best.hr, at: best.at };
}

export function kmSplits(samples) {
  const pts = samples.filter((s) => s.dist != null);
  if (!pts.length) return [];
  const out = [];
  let startIdx = 0;
  let nextKm = 1000;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].dist >= nextKm) {
      const seg = pts.slice(startIdx, i + 1);
      const span = pts[i].t - pts[startIdx].t;
      const dist = pts[i].dist - pts[startIdx].dist;
      const hr = seg.reduce((a, s) => a + s.hr * s.dt, 0) / Math.max(1, seg.reduce((a, s) => a + s.dt, 0));
      const mean = (k) => {
        const v = seg.map((s) => s[k]).filter((x) => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      out.push({
        km: out.length + 1,
        pace_s: Math.round((span / dist) * 1000),
        hr: Math.round(hr),
        cad: mean('cad') != null ? Math.round((mean('cad') + mean('frac')) * 2) : null,
        gct: mean('gct') != null ? Math.round(mean('gct')) : null,
      });
      startIdx = i;
      nextKm += 1000;
    }
  }
  return out;
}

/**
 * @param {Buffer} buffer FIT-Datei
 * @param {{activityId:number|string, lthr:number, tz?:string}} opts
 */
export async function activityFromFit(buffer, { activityId, lthr, tz = 'Europe/Berlin' }) {
  const fit = await parseFit(buffer);
  const s = fit.sessions?.[0];
  if (!s) throw new Error('Keine Session in der FIT-Datei');
  const sport = mapSport(s.sport, s.sub_sport);
  const samples = toSamples(fit.records || []);
  const zoneSecs = zoneSeconds(samples, lthr).map((x) => Math.round(x));
  const isRun = sport === 'running';
  const rawRpe = s.workout_rpe;
  const rpe = rawRpe == null ? null : rawRpe > 10 ? rawRpe / 10 : rawRpe;

  const row = {
    id: Number(activityId),
    start_time: new Date(s.start_time).toISOString(),
    local_date: localDate(s.start_time, tz),
    sport,
    sub_sport: s.sub_sport || null,
    indoor: s.sub_sport === 'indoor_cycling',
    duration_s: Math.round(s.total_timer_time || 0),
    distance_m: Math.round(s.total_distance || 0),
    avg_hr: s.avg_heart_rate ?? null,
    max_hr: s.max_heart_rate ?? null,
    avg_cadence: isRun && s.avg_cadence != null ? Math.round((s.avg_cadence + (s.avg_fractional_cadence || 0)) * 2 * 10) / 10 : s.avg_cadence ?? null,
    avg_power: s.avg_power ?? null,
    ascent_m: s.total_ascent ?? null,
    te_aerobic: s.total_training_effect ?? null,
    te_anaerobic: s.total_anaerobic_effect ?? s.total_anaerobic_training_effect ?? null,
    rpe,
    feel: s.workout_feel ?? null,
    gct_ms: isRun ? s.avg_stance_time ?? null : null,
    vo_mm: isRun ? s.avg_vertical_oscillation ?? null : null,
    step_len_m: isRun && s.avg_step_length ? Math.round(s.avg_step_length) / 1000 : null,
    vert_ratio: isRun ? s.avg_vertical_ratio ?? null : null,
    zone_s: zoneSecs,
    best: isRun ? { m20: bestEffort(samples, 20 * 60), m30: bestEffort(samples, 30 * 60) } : null,
    km_splits: isRun ? kmSplits(samples) : null,
  };
  row.load = Math.round(activityLoad({ sport, durationS: row.duration_s, zoneSecs }) * 10) / 10;
  return row;
}
