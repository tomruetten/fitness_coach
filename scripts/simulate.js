// Spielt den Plan gegen die eigene Historie ab: Was hätte die App an Tag X empfohlen?
// Aufruf: node scripts/simulate.js <ordner-mit-activities.json-und-health/> [YYYY-MM-DD]
import fs from 'fs';
import path from 'path';
import { planDay, readiness, withDefaults } from '../server/engine/planner.js';
import { loadHistory } from './history.js';

const dir = process.argv[2] || '/home/claude/testdata';
const date = process.argv[3] || new Date().toISOString().slice(0, 10);
const { activities, days } = loadHistory(dir);
const settings = withDefaults({ block_start: '2026-10-26' });
const ctx = { date, settings, activities: activities.filter((a) => a.local_date <= date), days, strengthLog: [], pain: [] };
const r = readiness(ctx);
console.log(`Stichtag ${date}: Erholung ${r.level}`, r.signals.map((s) => s.id).join(', ') || '–', 'ACWR', r.acwr?.toFixed(2));
const p = planDay(ctx, {});
console.log(JSON.stringify({ title: p.title, block: p.block, kind: p.kind, steps: p.steps, exercises: p.exercises, targets: p.targets, why: p.why }, null, 1));
