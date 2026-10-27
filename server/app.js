import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStore } from './db/index.js';
import { clearSessionCookie, isAuthed, requireAuth, requireJsonHeader, setSessionCookie } from './auth/session.js';
import { loginOptions, registrationOptions, verifyLogin, verifyRegistration } from './auth/passkeys.js';
import { loadContext, loadSettings, todayIn } from './context.js';
import { planDay, planWeek, readiness } from './engine/planner.js';
import { estimateThreshold } from './engine/threshold.js';
import { trends, trendsWindow } from './engine/trends.js';
import { sessionFor, strengthAnalysis } from './engine/strength.js';
import { addDays, weekDates, weekday } from './engine/dates.js';
import { GarminClient } from './garmin/client.js';
import { runSync } from './garmin/sync.js';
import { timingSafeEqual } from 'crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{store?:object, garmin?:()=>GarminClient, serveStatic?:boolean}} o */
export function createApp({ store = getStore(), garmin = null, serveStatic = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', requireJsonHeader);

  const garminClient = () => {
    if (garmin) return garmin();
    return new GarminClient({
      apiKey: process.env.GARMIN_PERSONAL_API_KEY,
      tokenCache: { get: () => store.getSetting('garmin_token'), set: (v) => store.setSetting('garmin_token', v) },
    });
  };

  app.get('/api/health', wrap(async (req, res) => {
    const has = (k) => !!process.env[k];
    const secretOk = (process.env.SESSION_SECRET || '').length >= 32;
    const missing = [];
    if (!has('SUPABASE_URL') || !has('SUPABASE_SERVICE_KEY')) missing.push('SUPABASE_URL/SUPABASE_SERVICE_KEY');
    if (!secretOk) missing.push('SESSION_SECRET (mind. 32 Zeichen)');
    if (!has('APP_ORIGIN')) missing.push('APP_ORIGIN');
    if (!has('SETUP_TOKEN')) missing.push('SETUP_TOKEN (nur für die Ersteinrichtung)');
    if (!has('GARMIN_PERSONAL_API_KEY')) missing.push('GARMIN_PERSONAL_API_KEY');
    let db = 'ok';
    try { await store.passkeys(); } catch (e) { db = String(e.message || e).slice(0, 200); }
    res.json({ ok: missing.length === 0 && db === 'ok', store: store.kind || 'memory', db, missing });
  }));

  // ---- Anmeldung -------------------------------------------------------------
  app.get('/api/auth/state', wrap(async (req, res) => {
    const keys = await store.passkeys();
    res.json({ setupNeeded: keys.length === 0, authed: isAuthed(req), passkeys: isAuthed(req) ? keys.map((k) => ({ id: k.id, label: k.label, created_at: k.created_at })) : undefined });
  }));

  // Erste Einrichtung nur mit SETUP_TOKEN; weitere Geräte nur mit bestehender Anmeldung.
  const canRegister = async (req) => {
    const keys = await store.passkeys();
    if (keys.length > 0) return isAuthed(req);
    const t = process.env.SETUP_TOKEN;
    return !!t && safeEq(req.body?.setupToken || '', t);
  };
  app.post('/api/auth/register/options', wrap(async (req, res) => {
    if (!(await canRegister(req))) return res.status(403).json({ error: 'Nicht erlaubt' });
    res.json(await registrationOptions(store, req));
  }));
  app.post('/api/auth/register/verify', wrap(async (req, res) => {
    if (!(await canRegister(req))) return res.status(403).json({ error: 'Nicht erlaubt' });
    await verifyRegistration(store, req, req.body);
    setSessionCookie(res);
    res.json({ ok: true });
  }));
  app.post('/api/auth/login/options', wrap(async (req, res) => res.json(await loginOptions(store, req))));
  app.post('/api/auth/login/verify', wrap(async (req, res) => {
    await verifyLogin(store, req, req.body);
    setSessionCookie(res);
    res.json({ ok: true });
  }));
  app.post('/api/auth/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

  // ---- Cron (Vercel sendet CRON_SECRET als Bearer-Token) -----------------------
  app.get('/api/cron/sync', wrap(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const given = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!secret || !safeEq(given, secret)) return res.status(401).json({ error: 'Nicht erlaubt' });
    const settings = await loadSettings(store);
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const r = await runSync(garminClient(), store, { settings, maxNew: 6, deadlineMs: 40000 });
      total += r.added;
      if (r.done) break;
    }
    res.json({ ok: true, added: total });
  }));

  app.use('/api', requireAuth);

  // ---- Daten -------------------------------------------------------------
  app.get('/api/today', wrap(async (req, res) => {
    const [ctx, last] = await Promise.all([loadContext(store), store.getSetting('last_sync')]);
    const rd = readiness(ctx);
    const plan = planDay(ctx, { rd });
    const done = ctx.activities.filter((a) => a.local_date === ctx.date);
    const est = estimateThreshold(ctx.activities, ctx.settings, ctx.date);
    const { settings, ...rdOut } = rd;
    let session = null;
    if (plan.kind === 'strength_a' || plan.kind === 'strength_b') session = sessionFor({ plan, kind: plan.kind, template: await store.getSetting('strength_template'), sets: ctx.sets, date: ctx.date });
    res.json({ date: ctx.date, session, plan, readiness: rdOut, done, thresholdSuggestion: Object.keys(est.suggestion).length ? { ...est.suggestion, basedOn: est.basedOn } : null, lastSync: last, thresholds: { lthr: ctx.settings.lthr, max_hr: ctx.settings.max_hr, lt_pace_s: ctx.settings.lt_pace_s, easy_pace_s: ctx.settings.easy_pace_s } });
  }));

  app.get('/api/week', wrap(async (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : undefined;
    const ctx = await loadContext(store, { date });
    const plans = planWeek({ ...ctx, today: ctx.today });
    const dates = weekDates(ctx.date);
    const week = plans.map((p, i) => ({ ...p, done: ctx.activities.filter((a) => a.local_date === dates[i]).map((a) => ({ id: a.id, sport: a.sport, duration_s: a.duration_s, distance_m: a.distance_m, avg_hr: a.avg_hr, load: a.load })) }));
    res.json({ today: ctx.today, week });
  }));

  app.get('/api/activities', wrap(async (req, res) => {
    const ctx = await loadContext(store);
    const n = Math.min(60, Number(req.query.limit) || 25);
    res.json({ activities: [...ctx.activities].reverse().slice(0, n) });
  }));

  // Woche umplanen: Einheiten zwischen Tagen der laufenden Woche tauschen (Datum -> Einheit).
  app.post('/api/week/plan', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const today = todayIn(settings.timezone);
    const dates = weekDates(today);
    const all = (await store.getSetting('day_overrides')) || {};
    if (req.body?.reset) dates.forEach((d) => delete all[d]);
    else {
      const given = req.body?.days || {};
      const kinds = Object.values(settings.week).map((s) => s.kind).sort();
      const mine = dates.map((d) => given[d]);
      if (mine.some((k) => !k) || [...mine].sort().join() !== kinds.join()) return res.status(400).json({ error: 'Ungültige Wochenplanung' });
      dates.forEach((d, i) => { if (mine[i] === (settings.week[weekday(d)]?.kind)) delete all[d]; else all[d] = mine[i]; });
    }
    for (const k of Object.keys(all)) if (k < addDays(today, -60)) delete all[k];
    await store.setSetting('day_overrides', all);
    res.json({ ok: true });
  }));

  const RANGES = ['week', 'month', 'year'];
  app.get('/api/trends', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const date = todayIn(settings.timezone);
    const range = RANGES.includes(req.query.range) ? req.query.range : 'month';
    const w = trendsWindow(range, date);
    const [activities, days] = await Promise.all([store.activitiesSince(w.from), store.daysSince(w.days)]);
    res.json(trends({ activities, days, settings, date }, range));
  }));

  // ---- Kraft-Logbuch ---------------------------------------------------------
  const KINDS = ['strength_a', 'strength_b', 'strength_x'];
  app.get('/api/strength/session', wrap(async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'strength_a';
    const ctx = await loadContext(store);
    const plan = planWeek(ctx).find((p) => p.kind === kind) || null;
    res.json(sessionFor({ plan, kind, template: await store.getSetting('strength_template'), sets: ctx.sets, date: ctx.date }));
  }));
  app.post('/api/strength/template', wrap(async (req, res) => {
    const kind = req.body?.kind;
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unbekannte Vorlage' });
    const all = (await store.getSetting('strength_template')) || {};
    if (req.body.exercises === null) delete all[kind];
    else {
      const slug = (n) => 'x_' + String(n).toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').slice(0, 30);
      all[kind] = (Array.isArray(req.body.exercises) ? req.body.exercises : []).slice(0, 15).map((e) => {
        const name = String(e.name || '').trim().slice(0, 60);
        return { id: String(e.id || slug(name)).slice(0, 40), name, sets: Math.max(1, Math.min(10, Number(e.sets) || 3)), reps: String(e.reps || '8').slice(0, 20) };
      }).filter((e) => e.name);
      if (!all[kind].length) delete all[kind];
    }
    await store.setSetting('strength_template', all);
    res.json({ ok: true });
  }));
  app.post('/api/strength/sets', wrap(async (req, res) => {
    const date = isDate(req.body?.date) ? req.body.date : todayIn();
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : null;
    const rows = [];
    for (const e of (Array.isArray(req.body?.exercises) ? req.body.exercises : []).slice(0, 20)) {
      const id = String(e.id || '').slice(0, 40), name = String(e.name || '').slice(0, 60);
      if (!id || !name) continue;
      (Array.isArray(e.sets) ? e.sets : []).slice(0, 12).forEach((s, i) => {
        const reps = Math.round(Number(s.reps)), kg = Number(s.weight_kg);
        if (!(reps >= 0 && reps <= 300) || !(kg >= 0 && kg <= 600)) return;
        rows.push({ date, kind, exercise_id: id, exercise_name: name, set_no: i + 1, weight_kg: kg, reps, done: s.done !== false });
      });
    }
    await store.replaceSets(date, rows);
    res.json({ ok: true, saved: rows.length });
  }));
  app.get('/api/strength/analysis', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const date = todayIn(settings.timezone);
    const range = RANGES.includes(req.query.range) ? req.query.range : 'month';
    const sets = await store.setsSince(addDays(date, -400));
    res.json(strengthAnalysis({ sets, range, ex: String(req.query.ex || ''), date }));
  }));

  app.get('/api/settings', wrap(async (req, res) => {
    const s = await loadSettings(store);
    const { _z2from, _z2to, _z4from, ...out } = s;
    res.json(out);
  }));
  app.post('/api/settings', wrap(async (req, res) => {
    const saved = (await store.getSetting('settings')) || {};
    const b = req.body || {};
    const next = { ...saved };
    const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : undefined);
    for (const [k, lo, hi] of [['lthr', 120, 210], ['max_hr', 140, 220], ['lt_pace_s', 180, 480], ['easy_pace_s', 240, 600], ['strength_max_min', 20, 180]]) {
      const v = num(b[k], lo, hi);
      if (v !== undefined) next[k] = v;
    }
    if (b.goal) {
      const g = { ...(saved.goal || {}) };
      if (num(b.goal.time_s, 600, 40000) !== undefined) g.time_s = num(b.goal.time_s, 600, 40000);
      if (num(b.goal.distance_km, 1, 100) !== undefined) g.distance_km = num(b.goal.distance_km, 1, 100);
      if (b.goal.date === null || b.goal.date === '') g.date = null;
      else if (isDate(b.goal.date)) g.date = b.goal.date;
      next.goal = g;
    }
    await store.setSetting('settings', next);
    res.json({ ok: true });
  }));
  app.post('/api/threshold/apply', wrap(async (req, res) => {
    const ctx = await loadContext(store);
    const est = estimateThreshold(ctx.activities, ctx.settings, ctx.date);
    const saved = (await store.getSetting('settings')) || {};
    const next = { ...saved, ...est.suggestion };
    if (est.easyPace) next.easy_pace_s = est.easyPace;
    await store.setSetting('settings', next);
    res.json({ ok: true, applied: { ...est.suggestion, ...(est.easyPace ? { easy_pace_s: est.easyPace } : {}) } });
  }));

  app.post('/api/strength/log', wrap(async (req, res) => {
    const rows = (Array.isArray(req.body?.entries) ? req.body.entries : []).slice(0, 40).map((e) => ({
      date: isDate(e.date) ? e.date : todayIn(),
      exercise_id: String(e.exercise_id || '').slice(0, 40),
      sets: Number.isFinite(Number(e.sets)) ? Number(e.sets) : null,
      reps: e.reps ? String(e.reps).slice(0, 30) : null,
      weight_kg: Number.isFinite(Number(e.weight_kg)) ? Number(e.weight_kg) : null,
      done_all: e.done_all !== false,
      rpe: Number.isFinite(Number(e.rpe)) ? Number(e.rpe) : null,
    })).filter((r) => r.exercise_id);
    await store.addStrength(rows);
    res.json({ ok: true, saved: rows.length });
  }));
  app.post('/api/pain', wrap(async (req, res) => {
    const level = Number(req.body?.level);
    if (!Number.isInteger(level) || level < 0 || level > 10) return res.status(400).json({ error: 'Schmerz 0 bis 10' });
    await store.addPain({ date: isDate(req.body.date) ? req.body.date : todayIn(), level, area: req.body.area ? String(req.body.area).slice(0, 40) : null });
    res.json({ ok: true });
  }));

  app.post('/api/sync', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const r = await runSync(garminClient(), store, { settings, maxNew: 6, deadlineMs: 40000, historyFrom: isDate(req.body?.from) ? req.body.from : null });
    res.json(r);
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

  if (serveStatic) {
    const pub = path.join(here, '..', 'public');
    app.use(express.static(pub, { setHeaders: (res, p) => { if (/sw\.js$|index\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('Fehler:', err);
    res.status(status).json({ error: status >= 500 ? (req.path.startsWith('/api/auth/') ? `Serverfehler: ${String(err.message).slice(0, 160)}` : 'Serverfehler') : err.message });
  });
  return app;
}
