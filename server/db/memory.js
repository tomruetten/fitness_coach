// In-Memory-Speicher mit derselben Schnittstelle wie der Supabase-Speicher.
// Wird für Tests, Simulation und lokale Entwicklung ohne Supabase genutzt.
import fs from 'fs';

export function createMemoryStore(persistPath = null) {
  const t = { settings: {}, activities: new Map(), days: new Map(), strength: [], sets: [], pain: [], passkeys: new Map(), challenges: new Map(), attempts: new Map() };
  if (persistPath && fs.existsSync(persistPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      t.settings = raw.settings || {};
      (raw.activities || []).forEach((a) => t.activities.set(a.id, a));
      (raw.days || []).forEach((d) => t.days.set(d.date, d));
      t.strength = raw.strength || [];
      t.sets = raw.sets || [];
      t.pain = raw.pain || [];
      (raw.passkeys || []).forEach((p) => t.passkeys.set(p.id, p));
    } catch { /* leere Datenbank */ }
  }
  const save = () => {
    if (!persistPath) return;
    fs.writeFileSync(persistPath, JSON.stringify({ settings: t.settings, activities: [...t.activities.values()], days: [...t.days.values()], strength: t.strength, sets: t.sets, pain: t.pain, passkeys: [...t.passkeys.values()] }));
  };
  return {
    kind: 'memory',
    async getSetting(key) { return t.settings[key] ?? null; },
    async setSetting(key, value) { t.settings[key] = value; save(); },
    async upsertActivities(rows) { rows.forEach((r) => t.activities.set(r.id, r)); save(); },
    async activitiesSince(date) { return [...t.activities.values()].filter((a) => a.local_date >= date).sort((a, b) => a.start_time.localeCompare(b.start_time)); },
    async hasActivity(id) { return t.activities.has(Number(id)); },
    async upsertDays(rows) { rows.forEach((r) => t.days.set(r.date, { ...(t.days.get(r.date) || {}), ...r })); save(); },
    async daysSince(date) { return [...t.days.values()].filter((d) => d.date >= date).sort((a, b) => a.date.localeCompare(b.date)); },
    async addStrength(rows) { rows.forEach((r, i) => t.strength.push({ id: t.strength.length + 1 + i, ...r })); save(); },
    async strengthSince(date) { return t.strength.filter((s) => s.date >= date); },
    async replaceSets(date, rows) {
      const ids = new Set(rows.map((r) => r.exercise_id));
      t.sets = t.sets.filter((s) => !(s.date === date && ids.has(s.exercise_id)));
      rows.forEach((r) => t.sets.push({ id: t.sets.length + 1, ...r }));
      save();
    },
    async setsSince(date) { return t.sets.filter((s) => s.date >= date).sort((a, b) => a.date.localeCompare(b.date) || a.set_no - b.set_no); },
    async addPain(row) { t.pain.push({ id: t.pain.length + 1, ...row }); save(); },
    async painSince(date) { return t.pain.filter((p) => p.date >= date); },
    async passkeys() { return [...t.passkeys.values()]; },
    async passkey(id) { return t.passkeys.get(id) || null; },
    async savePasskey(p) { t.passkeys.set(p.id, p); save(); },
    async updatePasskeyCounter(id, counter) { const p = t.passkeys.get(id); if (p) { p.counter = counter; save(); } },
    async saveChallenge(c) { t.challenges.set(c.id, c); },
    async takeChallenge(id) { const c = t.challenges.get(id); t.challenges.delete(id); return c && new Date(c.expires_at) > new Date() ? c : null; },
    async attempts(ip) { return t.attempts.get(ip) || { fails: 0, locked_until: null }; },
    async setAttempts(ip, v) { t.attempts.set(ip, v); },
  };
}
