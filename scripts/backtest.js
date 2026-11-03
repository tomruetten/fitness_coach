// Backtest des Leistungsmodells: Wie gut hätte der VDOT von Tag X die harten Läufe danach vorhergesagt?
// Aufruf: node scripts/backtest.js <ordner-mit-activities.json-und-health/>
import { loadHistory } from './history.js';
import { withDefaults } from '../server/engine/planner.js';
import { fitnessState, predictTime, effortsOf } from '../server/engine/fitness.js';
import { addDays } from '../server/engine/dates.js';

const dir = process.argv[2] || '/home/claude/testdata';
const { activities, days } = loadHistory(dir);
const settings = withDefaults({});
const runs = activities.filter((a) => a.sport === 'running' && a.distance_m > 1500).sort((a, b) => a.local_date.localeCompare(b.local_date));
const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const rows = [];
for (const r of runs) {
  const hard = effortsOf(r, settings.lthr).filter((e) => e.kind === 'run' || e.dur_s >= 1200);
  if (!hard.length) continue;
  const asOf = addDays(r.local_date, -1);
  const before = activities.filter((a) => a.local_date <= asOf);
  if (before.filter((a) => a.sport === 'running').length < 3) continue;
  const f = fitnessState({ activities: before, days: days.filter((d) => d.date <= asOf), settings, asOf });
  const e = hard.sort((a, b) => b.dur_s - a.dur_s)[0];
  const dist = (e.dur_s / e.pace_s) * 1000;
  const pred = predictTime(f.vdot, dist);
  rows.push({ date: r.local_date, dist_km: dist / 1000, actual: e.dur_s, pred, err: ((pred - e.dur_s) / e.dur_s) * 100, vdot: f.vdot, vdot_run: e.vdot, src: f.source });
}
if (!rows.length) { console.log('Keine harten Läufe mit Vorgeschichte gefunden.'); process.exit(0); }
console.log('Datum       Distanz  Ist        Vorhersage  Abweichung  VDOT vorher → im Lauf');
for (const x of rows) console.log(`${x.date}  ${x.dist_km.toFixed(1).padStart(5)} km  ${hms(x.actual)}    ${hms(x.pred)}     ${(x.err > 0 ? '+' : '') + x.err.toFixed(1)} %      ${x.vdot.toFixed(1)} → ${x.vdot_run.toFixed(1)}  (${x.src})`);
const mape = rows.reduce((s, x) => s + Math.abs(x.err), 0) / rows.length, bias = rows.reduce((s, x) => s + x.err, 0) / rows.length;
console.log(`\n${rows.length} harte Läufe · mittlere Abweichung ${mape.toFixed(1)} % · Tendenz ${bias > 0 ? '+' : ''}${bias.toFixed(1)} % (positiv = Modell zu langsam)`);
