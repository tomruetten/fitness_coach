import { createClient } from '@supabase/supabase-js';

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export function createSupabaseStore(url, serviceKey) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    kind: 'supabase',
    async getSetting(key) {
      const d = must(await sb.from('fit_settings').select('value').eq('key', key).maybeSingle());
      return d?.value ?? null;
    },
    async setSetting(key, value) { must(await sb.from('fit_settings').upsert({ key, value, updated_at: new Date().toISOString() })); },
    async upsertActivities(rows) { for (const c of chunk(rows, 50)) must(await sb.from('fit_activities').upsert(c, { onConflict: 'id' })); },
    async activitiesSince(date) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const d = must(await sb.from('fit_activities').select('*').gte('local_date', date).order('start_time').range(from, from + 999));
        out.push(...d);
        if (d.length < 1000) break;
      }
      return out;
    },
    async hasActivity(id) { const d = must(await sb.from('fit_activities').select('id').eq('id', id).maybeSingle()); return !!d; },
    async upsertDays(rows) { for (const c of chunk(rows, 200)) must(await sb.from('fit_daily_health').upsert(c.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'date' })); },
    async daysSince(date) { return must(await sb.from('fit_daily_health').select('*').gte('date', date).order('date')); },
    async addStrength(rows) { if (rows.length) must(await sb.from('fit_strength_log').insert(rows)); },
    async strengthSince(date) { return must(await sb.from('fit_strength_log').select('*').gte('date', date).order('date')); },
    async addPain(row) { must(await sb.from('fit_pain').insert(row)); },
    async painSince(date) { return must(await sb.from('fit_pain').select('*').gte('date', date)); },
    async passkeys() { return must(await sb.from('fit_passkeys').select('*')); },
    async passkey(id) { return must(await sb.from('fit_passkeys').select('*').eq('id', id).maybeSingle()); },
    async savePasskey(p) { must(await sb.from('fit_passkeys').insert(p)); },
    async updatePasskeyCounter(id, counter) { must(await sb.from('fit_passkeys').update({ counter }).eq('id', id)); },
    async saveChallenge(c) {
      await sb.from('fit_challenges').delete().lt('expires_at', new Date().toISOString());
      must(await sb.from('fit_challenges').insert(c));
    },
    async takeChallenge(id) {
      const d = must(await sb.from('fit_challenges').select('*').eq('id', id).maybeSingle());
      if (d) await sb.from('fit_challenges').delete().eq('id', id);
      return d && new Date(d.expires_at) > new Date() ? d : null;
    },
    async attempts(ip) { return must(await sb.from('fit_login_attempts').select('*').eq('ip', ip).maybeSingle()) || { fails: 0, locked_until: null }; },
    async setAttempts(ip, v) { must(await sb.from('fit_login_attempts').upsert({ ip, ...v, updated_at: new Date().toISOString() })); },
  };
}
