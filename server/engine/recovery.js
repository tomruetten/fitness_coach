// Erholungssignale aus den Tageswerten. Startwerte sind Vorschläge und lassen sich
// in server/engine/config.js anpassen.
import { RULES } from './config.js';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => {
  if (xs.length < 5) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const DAY = 86400000;
const dayNum = (d) => Math.floor(new Date(d + 'T00:00:00Z').getTime() / DAY);

/**
 * @param {Array<{date:string, hrv_avg?:number, resting_hr?:number, sleep_s?:number}>} days
 * @param {string} asOf  YYYY-MM-DD (Stichtag, Daten bis einschließlich)
 */
export function recoveryState(days, asOf) {
  const end = dayNum(asOf);
  const inRange = (d, from, to) => {
    const n = dayNum(d.date);
    return n >= from && n <= to;
  };
  const last7 = days.filter((d) => inRange(d, end - 6, end));
  const base = days.filter((d) => inRange(d, end - 34, end - 7));

  const hrvNow = mean(last7.map((d) => d.hrv_avg).filter(Number.isFinite));
  const hrvBase = base.map((d) => d.hrv_avg).filter(Number.isFinite);
  const hrvMean = mean(hrvBase);
  const hrvSd = sd(hrvBase);

  const rhrNow = mean(last7.slice(-3).map((d) => d.resting_hr).filter(Number.isFinite));
  const rhrBase = mean(base.map((d) => d.resting_hr).filter(Number.isFinite));

  const sleeps = days
    .filter((d) => inRange(d, end - 1, end))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.sleep_s)
    .filter(Number.isFinite);
  const shortSleepTwoNights = sleeps.length === 2 && sleeps.every((s) => s < RULES.sleepShortHours * 3600);

  const signals = [];
  if (hrvNow != null && hrvMean != null && hrvSd != null && hrvNow < hrvMean - RULES.hrvSdBelow * hrvSd) {
    signals.push({ id: 'R-HRV', text: `HRV-Wochenmittel ${hrvNow.toFixed(0)} ms liegt unter der Basislinie (${hrvMean.toFixed(0)} ± ${hrvSd.toFixed(0)} ms)` });
  }
  if (rhrNow != null && rhrBase != null && rhrNow > rhrBase + RULES.restingHrAbove) {
    signals.push({ id: 'R-RHR', text: `Ruhepuls ${rhrNow.toFixed(0)} bpm liegt ${(rhrNow - rhrBase).toFixed(0)} bpm über der Basislinie` });
  }
  if (shortSleepTwoNights) {
    signals.push({ id: 'R-SLEEP', text: `Schlaf unter ${RULES.sleepShortHours} h in zwei Nächten in Folge` });
  }
  return {
    hrvNow, hrvMean, hrvSd, rhrNow, rhrBase,
    signals,
    level: signals.length >= 2 ? 'low' : signals.length === 1 ? 'medium' : 'good',
  };
}
