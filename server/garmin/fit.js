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
      alt: r.enhanced_altitude ?? r.altitude ?? null,
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

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** Geglättete Geschwindigkeit (gleitendes Mittel über `w` Sekunden, rückwärts). */
function smoothSpeed(pts, w = 20) {
  const out = new Array(pts.length).fill(0);
  let j = 0, sum = 0, tsum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i].speed * pts[i].dt; tsum += pts[i].dt;
    while (pts[i].t - pts[j].t > w) { sum -= pts[j].speed * pts[j].dt; tsum -= pts[j].dt; j++; }
    out[i] = tsum > 0 ? sum / tsum : 0;
  }
  return out;
}

/**
 * Harte Abschnitte eines Laufs (Intervalle, Tempoteile, Endbeschleunigung): zusammenhängende Stücke,
 * die mindestens 60 s dauern und deutlich schneller sind als das Grundtempo des Laufs (Median).
 * Rückgabe je Abschnitt: Dauer, Pace, mittlerer Puls und Puls der letzten 30 s.
 */
export function hardSegments(samples) {
  const pts = samples.filter((s) => s.speed > 0.5 && s.dt > 0);
  if (pts.length < 120) return [];
  const sp = smoothSpeed(pts);
  const base = median(pts.filter((s) => s.speed > 1.5).map((s) => s.speed));
  if (!base) return [];
  const thr = base * 1.12;
  const segs = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const hard = sp[i] >= thr;
    if (hard) { if (!cur) cur = { a: i, b: i, gap: 0 }; else { cur.b = i; cur.gap = 0; } }
    else if (cur) { cur.gap += pts[i].dt; if (cur.gap > 20) { segs.push(cur); cur = null; } }
  }
  if (cur) segs.push(cur);
  const out = [];
  for (const s of segs) {
    const part = pts.slice(s.a, s.b + 1);
    const dur = part.reduce((a, p) => a + p.dt, 0);
    if (dur < 60) continue;
    const dist = part.reduce((a, p) => a + p.speed * p.dt, 0);
    const hr = part.reduce((a, p) => a + p.hr * p.dt, 0) / Math.max(1, part.filter((p) => p.hr > 0).reduce((a, p) => a + p.dt, 0));
    const tail = part.filter((p) => p.t >= part[part.length - 1].t - 30 && p.hr > 0);
    out.push({
      dur_s: Math.round(dur),
      pace_s: Math.round((dur / dist) * 1000),
      hr: Math.round(hr),
      hr_end: tail.length ? Math.round(tail.reduce((a, p) => a + p.hr, 0) / tail.length) : null,
    });
  }
  return out;
}

/**
 * Entkopplung (Pa:HR): Verlust an Tempo-pro-Puls zwischen erster und zweiter Hälfte eines gleichmäßigen Laufs.
 * Unter etwa 5 % gilt die aerobe Grundlage für diese Dauer als tragfähig. Nur für Läufe ab 40 min sinnvoll.
 */
export function decoupling(samples) {
  const pts = samples.filter((s) => s.speed > 1.5 && s.hr > 90 && s.dt > 0);
  if (pts.length < 600) return null;
  const t0 = pts[0].t + 600; // die ersten 10 min zählen als Einlaufen
  const body = pts.filter((s) => s.t >= t0);
  if (body.length < 900) return null;
  const sp = smoothSpeed(body, 30);
  const m = sp.reduce((a, b) => a + b, 0) / sp.length;
  const cv = Math.sqrt(sp.reduce((a, b) => a + (b - m) ** 2, 0) / sp.length) / m;
  const mid = Math.floor(body.length / 2);
  const ef = (part) => {
    const v = part.reduce((a, p) => a + p.speed * p.dt, 0) / part.reduce((a, p) => a + p.dt, 0);
    const h = part.reduce((a, p) => a + p.hr * p.dt, 0) / part.reduce((a, p) => a + p.dt, 0);
    return v / h;
  };
  const e1 = ef(body.slice(0, mid)), e2 = ef(body.slice(mid));
  return { pct: Math.round(((e1 - e2) / e1) * 1000) / 10, steady: cv < 0.12 };
}

/** Höhenunterschied eines Abschnitts (m), geglättet über je 5 Messpunkte an Anfang und Ende. */
function elevChange(seg) {
  const a = seg.map((s) => s.alt).filter((v) => v != null);
  if (a.length < 12) return null;
  const m = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  return m(a.slice(-5)) - m(a.slice(0, 5));
}

/** Steigungskorrigiertes Tempo (Minetti et al. 2002: Energiekosten des Laufens je Steigung g). */
export function gapPace(paceS, grade) {
  const g = Math.max(-0.15, Math.min(0.15, grade));
  const cost = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return paceS * (3.6 / cost);
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
      const pace = (span / dist) * 1000;
      const ele = elevChange(seg);
      const gap = ele == null ? null : gapPace(pace, ele / dist);
      out.push({
        km: out.length + 1,
        pace_s: Math.round(pace),
        gap_s: gap == null ? null : Math.round(gap),
        ele: ele == null ? null : Math.round(ele),
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

/** Alles, was die Planung aus einem Lauf lernt. v=2 markiert die erweiterte Auswertung. */
export function runAnalysis(samples) {
  const best = { v: 3 };
  for (const [k, min] of [['m5', 5], ['m10', 10], ['m20', 20], ['m30', 30], ['m60', 60]]) best[k] = bestEffort(samples, min * 60);
  best.segments = hardSegments(samples);
  best.drift = decoupling(samples);
  return best;
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
    best: isRun ? runAnalysis(samples) : null,
    km_splits: isRun ? kmSplits(samples) : null,
  };
  row.load = Math.round(activityLoad({ sport, durationS: row.duration_s, zoneSecs }) * 10) / 10;
  return row;
}
