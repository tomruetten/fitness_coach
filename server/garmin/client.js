// Schlanker Client für die Garmin Connect Personal API (nur lesend).
// Endpunkte und Grenzen entsprechen dem offiziellen Python-Client (Apache-2.0).
import { unzipSync } from 'fflate';

export const BASE_URL = process.env.GARMIN_PERSONAL_API_BASE_URL || 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
export const MAX_DAYS = { sleep: 31, summaries: 31, hrv: 365 };
export const MAX_PAGE = 45;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jwtExp = (jwt) => {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).exp * 1000; } catch { return Date.now() + 3600e3; }
};

export class GarminClient {
  /**
   * @param {{apiKey:string, tokenCache?:{get():Promise<any>, set(v:any):Promise<void>}, fetchImpl?:typeof fetch}} o
   */
  constructor({ apiKey, tokenCache = null, fetchImpl = fetch }) {
    if (!apiKey) throw new Error('GARMIN_PERSONAL_API_KEY fehlt');
    this.apiKey = apiKey;
    this.tokenCache = tokenCache;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async getToken(force = false) {
    const margin = 3600e3; // eine Stunde Sicherheitsabstand
    if (!force && this.token && this.token.exp - Date.now() > margin) return this.token.value;
    if (!force && this.tokenCache) {
      const c = await this.tokenCache.get();
      if (c && c.exp - Date.now() > margin) { this.token = c; return c.value; }
    }
    const res = await this.fetch(BASE_URL + TOKEN_PATH, { method: 'POST', headers: { Accept: '*/*', Authorization: `ApiKey ${this.apiKey}` } });
    if (!res.ok) throw new Error(`Garmin lehnte den API-Key ab (HTTP ${res.status}). Key abgelaufen oder gelöscht?`);
    const value = (await res.text()).trim();
    this.token = { value, exp: jwtExp(value) };
    if (this.tokenCache) await this.tokenCache.set(this.token);
    return value;
  }

  async request(path, { params, accept = 'application/json', binary = false } = {}) {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, String(v));
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(refreshed && attempt > 0);
      let res;
      try {
        res = await this.fetch(url, { headers: { Accept: accept, Authorization: `Bearer ${token}` } });
      } catch (e) {
        if (attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
        throw e;
      }
      if (res.status === 401 && !refreshed) { refreshed = true; this.token = null; continue; }
      if ([408, 429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 && ra <= 20 ? ra * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`Garmin ${res.status} bei ${path}`);
      if (binary) return Buffer.from(await res.arrayBuffer());
      const text = await res.text();
      return text.trim() ? JSON.parse(text) : null;
    }
  }

  searchActivities({ start = 0, limit = MAX_PAGE, startDate, endDate } = {}) {
    return this.request('/activitylist-service/activities/search/activities', { params: { start, limit, startDate, endDate } });
  }

  async downloadFit(activityId) {
    const zip = await this.request(`/download-service/files/activity/${Number(activityId)}`, { accept: 'application/x-zip-compressed', binary: true });
    const files = unzipSync(new Uint8Array(zip));
    const name = Object.keys(files).find((n) => n.toLowerCase().endsWith('.fit')) || Object.keys(files)[0];
    if (!name) throw new Error('Leeres Archiv von Garmin');
    return Buffer.from(files[name]);
  }

  dailySummaries(start, end) { return this.request('/usersummary-service/v2/dailysummaries', { params: { startDate: start, endDate: end } }); }
  sleepSummaries(start, end) { return this.request('/sleep-service/sleep/dailySleepSummariesByDate', { params: { startDate: start, endDate: end } }); }
  hrvSummaries(start, end) { return this.request(`/hrv-service/hrv/daily/${start}/${end}`); }
  heartRateZones() { return this.request('/biometric-service/heartRateZones/v2'); }
  profileSettings() { return this.request('/userprofile-service/userprofile/settings'); }
}
