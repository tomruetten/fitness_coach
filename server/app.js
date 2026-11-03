import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStore } from './db/index.js';
import { clearSessionCookie, isAuthed, requireAuth, requireJsonHeader, setSessionCookie } from './auth/session.js';
import { loginOptions, registrationOptions, verifyLogin, verifyRegistration } from './auth/passkeys.js';
import { loadContext, loadSettings, todayIn } from './context.js';
import { planningContext, planDay, planWeek, readiness, slotOf } from './engine/planner.js';
import { estimateThreshold } from './engine/threshold.js';
import { fitnessState } from './engine/fitness.js';
import { trends, trendsWindow } from './engine/trends.js';
import { sessionFor, strengthAnalysis, exerciseInfo, exerciseCatalog } from './engine/strength.js';
import { addDays, weekDates, weekday } from './engine/dates.js';
import { GarminClient } from './garmin/client.js';
import { runSync } from './garmin/sync.js';
import { timingSafeEqual } from 'crypto';
import { trainingStatus } from './engine/status.js';
import { weekReview, consistency } from './engine/review.js';
import { forecast, adviceFor, defaultLocation } from './weather.js';
import { evaluateSession, matchingActivities } from './engine/evaluate.js';
import { pushReady, publicKey } from './push.js';
import { runNotifications, NOTIFICATIONS, getPrefs } from './notify.js';
import { mondayOf } from './engine/dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{store?:object, garmin?:()=>GarminClient, serveStatic?:boolean}} o */
const fitnessOut = ({ lthr, ...f }) => f;

/** VDOT der letzten 8 Wochen im Wochenabstand, für die Mini-Kurve auf der Startseite. */
function vdotHistory(ctx, settings) {
  const out = [];
  for (let i = 7; i >= 0; i--) {
    const d = addDays(ctx.date, -7 * i);
    const f = fitnessState({ activities: ctx.activities.filter((a) => a.local_date <= d), days: ctx.days.filter((x) => x.date <= d), settings, asOf: d });
    out.push(f.source === 'läufe' ? f.vdot : null);
  }
  return out;
}

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
    let notified = null;
    try { notified = await runNotifications({ store }); } catch { /* Mitteilungen dürfen den Sync nicht stören */ }
    res.json({ ok: true, added: total, notified });
  }));

  // Mitteilungen: prüft Zeitfenster und Bedingungen. Vercel ruft das abends auf; der Morgenversand hängt am Sync-Cron.
  const syncOnce = async () => { const settings = await loadSettings(store); await runSync(garminClient(), store, { settings, maxNew: 6, deadlineMs: 20000 }); };
  app.get('/api/cron/notify', wrap(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const given = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!secret || !safeEq(given, secret)) return res.status(401).json({ error: 'Nicht erlaubt' });
    res.json({ ok: true, ...(await runNotifications({ store, sync: syncOnce })) });
  }));

  app.use('/api', requireAuth);

  // ---- Daten -------------------------------------------------------------
  app.get('/api/today', wrap(async (req, res) => {
    const [ctx, last] = await Promise.all([loadContext(store), store.getSetting('last_sync')]);
    const rd = readiness(ctx);
    const plan = planDay(ctx, { rd });
    const done = ctx.activities.filter((a) => a.local_date === ctx.date);
    const est = estimateThreshold(ctx.activities, ctx.settings, ctx.date);
    const pc = planningContext(ctx, rd.settings, rd);
    const { settings, ...rdOut } = rd;
    let session = null;
    if (plan.kind === 'strength_a' || plan.kind === 'strength_b') session = sessionFor({ plan, kind: plan.kind, template: await store.getSetting('strength_template'), sets: ctx.sets, date: ctx.date, notes: (await store.getSetting('exercise_notes')) || {} });
    const history = vdotHistory(ctx, rd.settings);
    const tstatus = trainingStatus({ acwr: rd.acwr, history });
    const auto = !ctx.settings._status?.[ctx.date] && matchingActivities(plan, ctx.activities, ctx.date).length > 0;
    const evaluation = evaluateSession({ plan, activities: ctx.activities, rd, date: ctx.date }) || (done.length ? evaluateSession({ plan: null, activities: ctx.activities, rd, date: ctx.date, act: done.reduce((b, x) => ((x.duration_s || 0) > (b.duration_s || 0) ? x : b)) }) : null);
    res.json({ date: ctx.date, status: ctx.settings._status?.[ctx.date] || (auto ? 'done' : null), auto, evaluation, unfit: !!ctx.settings._unfit?.[ctx.date], training_status: tstatus, session, plan, readiness: rdOut, done, fitness: { ...fitnessOut(pc.fit), history }, cycle: { week: pc.wp.c, deload: pc.wp.deload, target_km: pc.wp.target, last_km: Math.round(pc.wp.last * 10) / 10, avg4_km: Math.round(pc.wp.avg4 * 10) / 10, reason: pc.wp.reason }, thresholdSuggestion: est.suggestion.lthr ? { lthr: est.suggestion.lthr, basedOn: est.basedOn } : null, lastSync: last, thresholds: { lthr: ctx.settings.lthr, max_hr: ctx.settings.max_hr, lt_pace_s: ctx.settings.lt_pace_s, easy_pace_s: ctx.settings.easy_pace_s } });
  }));

  app.get('/api/week', wrap(async (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : undefined;
    const ctx = await loadContext(store, { date });
    const plans = planWeek({ ...ctx, today: ctx.today });
    const dates = weekDates(ctx.date);
    const week = plans.map((p, i) => ({ ...p, done: ctx.activities.filter((a) => a.local_date === dates[i]).map((a) => ({ id: a.id, sport: a.sport, duration_s: a.duration_s, distance_m: a.distance_m, avg_hr: a.avg_hr, max_hr: a.max_hr, load: a.load, ascent_m: a.ascent_m, rpe: a.rpe, te: a.te_aerobic, te_aerobic: a.te_aerobic, cad: a.avg_cadence, avg_cadence: a.avg_cadence, segments: a.sport === 'running' ? a.best?.segments : undefined, zone_s: a.zone_s, splits: a.sport === 'running' ? a.km_splits : undefined })) }));
    const runKm = (list) => list.filter((a) => a.sport === 'running').reduce((s, a) => s + (a.distance_m || 0), 0) / 1000;
    const target = week.reduce((s, p) => s + (p.targets?.distance_km && !String(p.kind).startsWith('strength') ? Number(p.targets.distance_km) : 0), 0);
    res.json({ today: ctx.today, lthr: ctx.settings.lthr, consistency: consistency({ activities: ctx.activities, settings: ctx.settings, today: ctx.today }), target_km: Math.round(target * 10) / 10, done_km: Math.round(week.reduce((s, p) => s + runKm(p.done), 0) * 10) / 10, week: week.map((p) => { const auto = !ctx.settings._status?.[p.date] && matchingActivities(p, ctx.activities, p.date).length > 0; return { ...p, status: ctx.settings._status?.[p.date] || (auto ? 'done' : null), auto, evaluation: p.date <= ctx.today ? evaluateSession({ plan: p, activities: ctx.activities, date: p.date }) : null }; }) });
  }));

  // Rückblick auf die letzte volle Woche (am Montag/Dienstag wird er oben in der Woche gezeigt).
  app.get('/api/review', wrap(async (req, res) => {
    const base = await loadContext(store);
    const monday = addDays(mondayOf(base.today), -7);
    const ctx = await loadContext(store, { date: addDays(monday, 6) });
    const planned = planWeek({ ...ctx, today: ctx.today });
    res.json({ ...weekReview({ activities: ctx.activities, days: ctx.days, settings: ctx.settings, monday, planned }), today: base.today });
  }));

  // Wetter für heute oder einen Tag der nächsten zwei Tage.
  app.get('/api/weather', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const today = todayIn(settings.timezone);
    const date = isDate(req.query.date) ? req.query.date : today;
    try {
      const hours = await forecast(settings.location || defaultLocation, settings.timezone);
      res.json({ weather: adviceFor(hours, date) });
    } catch { res.json({ weather: null }); }
  }));

  // „Heute nicht fit“: stuft die heutige Einheit herunter. Nur für den heutigen Tag.
  app.post('/api/day/unfit', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const today = todayIn(settings.timezone);
    const all = (await store.getSetting('unfit')) || {};
    if (req.body?.on === false) delete all[today]; else all[today] = true;
    for (const k of Object.keys(all)) if (k < addDays(today, -7)) delete all[k];
    await store.setSetting('unfit', all);
    res.json({ ok: true });
  }));

  // Push-Benachrichtigungen
  app.get('/api/push/state', wrap(async (req, res) => {
    const subs = (await store.getSetting('push_subs')) || [];
    const prefs = await getPrefs(store);
    res.json({ ready: pushReady(), key: publicKey(), count: subs.length, types: NOTIFICATIONS.map((n) => ({ id: n.id, title: n.title, desc: n.desc, on: !!prefs[n.id] })) });
  }));
  app.post('/api/push/prefs', wrap(async (req, res) => {
    const { id, on } = req.body || {};
    if (!NOTIFICATIONS.some((n) => n.id === id) || typeof on !== 'boolean') return res.status(400).json({ error: 'Unbekannte Mitteilung' });
    const prefs = await getPrefs(store);
    prefs[id] = on;
    await store.setSetting('notify_prefs', prefs);
    res.json({ ok: true });
  }));
  app.post('/api/push/subscribe', wrap(async (req, res) => {
    const s = req.body?.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !/^https:\/\//.test(s.endpoint)) return res.status(400).json({ error: 'Abo ungültig' });
    const subs = ((await store.getSetting('push_subs')) || []).filter((x) => x.endpoint !== s.endpoint);
    subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
    await store.setSetting('push_subs', subs.slice(-5));
    res.json({ ok: true });
  }));
  app.post('/api/push/unsubscribe', wrap(async (req, res) => {
    const ep = req.body?.endpoint;
    await store.setSetting('push_subs', ((await store.getSetting('push_subs')) || []).filter((x) => x.endpoint !== ep));
    res.json({ ok: true });
  }));

  // Aktivitäten der letzten 31 Tage (leichte Liste) und Einzelansicht mit allen Auswertungen.
  const isRunAct = (a) => a.sport === 'running' && a.distance_m > 1500;
  const planKind = (ctx, d) => slotOf(ctx.settings, d).kind;
  const groupOfKind = (k) => (String(k).startsWith('run') ? 'running' : String(k).startsWith('strength') ? 'strength' : k === 'rest' ? null : 'cycling');
  app.get('/api/activities', wrap(async (req, res) => {
    const ctx = await loadContext(store);
    const from = addDays(ctx.today, -31);
    const list = ctx.activities.filter((a) => a.local_date >= from && a.local_date <= ctx.today && (a.duration_s || 0) > 300)
      .sort((x, y) => (y.start_time || '').localeCompare(x.start_time || ''))
      .map((a) => ({ id: a.id, date: a.local_date, sport: a.sport, duration_s: a.duration_s, distance_m: a.distance_m, avg_hr: a.avg_hr, te_aerobic: a.te_aerobic, extra: groupOfKind(planKind(ctx, a.local_date)) !== a.sport || (a.sport === 'running' && !isRunAct(a)) }));
    res.json({ today: ctx.today, activities: list });
  }));
  app.get('/api/activity/:id', wrap(async (req, res) => {
    const ctx0 = await loadContext(store);
    const a = ctx0.activities.find((x) => String(x.id) === String(req.params.id));
    if (!a || a.local_date < addDays(ctx0.today, -35)) return res.status(404).json({ error: 'Aktivität nicht gefunden' });
    const plan = planWeek({ ...ctx0, date: a.local_date, today: ctx0.today }).find((p) => p.date === a.local_date);
    const rd = a.local_date === ctx0.today ? readiness(ctx0) : null;
    const evaluation = evaluateSession({ plan, activities: ctx0.activities, rd, date: a.local_date, act: a });
    const { km_splits, best, ...rest } = a;
    res.json({ activity: { ...rest, splits: a.sport === 'running' ? km_splits : undefined, segments: a.sport === 'running' ? best?.segments : undefined }, plan: evaluation?.free ? null : plan, planned_label: plan?.label || null, evaluation, lthr: ctx0.settings.lthr });
  }));

  // Einheit manuell als erledigt oder ausgefallen kennzeichnen (auch nachträglich).
  app.post('/api/day/status', wrap(async (req, res) => {
    const settings = await loadSettings(store);
    const today = todayIn(settings.timezone);
    const { date, status } = req.body || {};
    if (!isDate(date) || date > today || date < addDays(today, -120)) return res.status(400).json({ error: 'Datum nicht möglich' });
    if (status !== null && status !== 'done' && status !== 'skipped') return res.status(400).json({ error: 'Status unbekannt' });
    const all = (await store.getSetting('day_status')) || {};
    if (status) all[date] = status; else delete all[date];
    for (const k of Object.keys(all)) if (k < addDays(today, -150)) delete all[k];
    await store.setSetting('day_status', all);
    res.json({ ok: true });
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
    res.json(sessionFor({ plan, kind, template: await store.getSetting('strength_template'), sets: ctx.sets, date: ctx.date, notes: (await store.getSetting('exercise_notes')) || {}, blank: req.query.blank === '1' }));
  }));

  // Übungskatalog: wächst mit jeder Übung, die du anlegst oder trainierst.
  const cleanEx = (e) => ({ id: String(e.id || '').slice(0, 40), name: String(e.name || '').trim().slice(0, 60), sets: Math.max(1, Math.min(10, Number(e.sets) || 3)), reps: String(e.reps || '8').slice(0, 20) });
  async function registerCatalog(list) {
    const cat = (await store.getSetting('exercise_catalog')) || [];
    let changed = false;
    for (const raw of list) {
      const e = cleanEx(raw);
      if (!e.id || !e.name) continue;
      const i = cat.findIndex((c) => c.id === e.id);
      if (i < 0) { cat.push(e); changed = true; } else if (cat[i].sets !== e.sets || cat[i].reps !== e.reps || cat[i].name !== e.name) { cat[i] = e; changed = true; }
    }
    if (changed) await store.setSetting('exercise_catalog', cat.slice(-300));
  }
  app.get('/api/strength/exercises', wrap(async (req, res) => {
    const ctx = await loadContext(store);
    const planned = planWeek(ctx).filter((p) => p.exercises).flatMap((p) => p.exercises.map((e) => ({ id: e.id, name: e.name, sets: e.sets, reps: e.reps })));
    const sets = await store.setsSince(addDays(ctx.date, -400));
    const notes = (await store.getSetting('exercise_notes')) || {};
    const cat = exerciseCatalog({ catalog: (await store.getSetting('exercise_catalog')) || [], planned, sets });
    res.json({ exercises: cat.map((b) => exerciseInfo(b, { sets, date: ctx.date, notes })) });
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
    if (all[kind]) await registerCatalog(all[kind]);
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
    const used = (Array.isArray(req.body?.exercises) ? req.body.exercises : []).filter((e) => Array.isArray(e.sets) && e.sets.length).map((e) => ({ id: e.id, name: e.name, sets: e.sets.length, reps: e.reps_spec || (e.sets[0]?.reps ?? 8) }));
    await registerCatalog(used);
    if (req.body?.notes && typeof req.body.notes === 'object') {
      const notes = (await store.getSetting('exercise_notes')) || {};
      for (const [id, v] of Object.entries(req.body.notes).slice(0, 40)) { const s = String(v || '').trim().slice(0, 400); if (s) notes[String(id).slice(0, 40)] = s; else delete notes[String(id).slice(0, 40)]; }
      await store.setSetting('exercise_notes', notes);
    }
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
    const ctx = await loadContext(store);
    const est = estimateThreshold(ctx.activities, ctx.settings, ctx.date);
    res.json({ ...out, thresholdSuggestion: est.suggestion.lthr ? { lthr: est.suggestion.lthr, basedOn: est.basedOn } : null });
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
    if (Array.isArray(b.races)) next.races = b.races.filter((r) => isDate(r?.date)).slice(0, 30).map((r) => ({ date: r.date, label: String(r.label || 'Rennen').slice(0, 40) }));
    if (b.goal) {
      const g = { ...(saved.goal || {}) };
      if (num(b.goal.time_s, 3600, 14400) !== undefined) g.time_s = num(b.goal.time_s, 3600, 14400);
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
    const applied = est.suggestion.lthr ? { lthr: est.suggestion.lthr } : {};
    await store.setSetting('settings', { ...saved, ...applied });
    res.json({ ok: true, applied });
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
    app.use(express.static(pub, { setHeaders: (res, p) => { res.setHeader('Cache-Control', 'no-cache'); } }));
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
