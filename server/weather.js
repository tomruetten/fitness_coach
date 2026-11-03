// Wetter für den Laufslot (Open-Meteo, ohne Schlüssel). Fehler sind unkritisch: ohne Wetter bleibt der Plan gleich.
const cache = new Map();
const MUNICH = { lat: 48.137, lon: 11.575 };

export async function forecast({ lat, lon } = MUNICH, tz = 'Europe/Berlin', fetchFn = fetch) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m&timezone=${encodeURIComponent(tz)}&forecast_days=3`;
  const r = await fetchFn(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('Wetterdienst nicht erreichbar');
  const j = await r.json();
  const h = j.hourly;
  const data = h.time.map((t, i) => ({ t, date: t.slice(0, 10), hour: Number(t.slice(11, 13)), temp: h.temperature_2m[i], feels: h.apparent_temperature[i], rain: h.precipitation_probability[i] ?? 0, wind: h.wind_speed_10m[i] }));
  cache.set(key, { t: Date.now(), data });
  return data;
}

/** Bestes Zeitfenster (6–21 Uhr) eines Tages und ein Hinweis für das Training. */
export function adviceFor(hours, date, slotHour = null) {
  const day = hours.filter((x) => x.date === date && x.hour >= 6 && x.hour <= 21);
  if (!day.length) return null;
  const score = (x) => x.rain * 0.5 + Math.abs(x.feels - 11) * 2 + Math.max(0, x.wind - 20);
  const pick = slotHour != null ? day.find((x) => x.hour === slotHour) || day[0] : [...day].sort((a, b) => score(a) - score(b))[0];
  const tips = [];
  let pen = 0;
  if (pick.feels >= 20) { pen = Math.round((pick.feels - 15) * 2.5); tips.push(`Warm: Pace nach Puls statt nach Uhr, etwa ${pen} s/km langsamer ist normal. Vorher und unterwegs trinken.`); }
  else if (pick.feels <= 0) tips.push('Kalt: länger einlaufen, Hände und Ohren schützen.');
  if (pick.rain >= 60) tips.push(`Regen wahrscheinlich (${pick.rain} %). ${slotHour == null ? '' : 'Ein anderes Zeitfenster prüfen.'}`.trim());
  if (pick.wind >= 30) tips.push('Starker Wind: Hinweg gegen den Wind planen.');
  const rainy = day.filter((x) => x.rain < 30).map((x) => x.hour);
  return {
    date, hour: pick.hour, temp: Math.round(pick.temp), feels: Math.round(pick.feels), rain: Math.round(pick.rain), wind: Math.round(pick.wind), pace_penalty_s: pen,
    tips, dry_hours: rainy.length ? [Math.min(...rainy), Math.max(...rainy)] : null,
    hours: day.filter((x) => x.hour % 3 === 0).map((x) => ({ hour: x.hour, temp: Math.round(x.temp), rain: Math.round(x.rain) })),
  };
}

export const defaultLocation = MUNICH;
