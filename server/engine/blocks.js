// Blocklogik ohne festes Renndatum: Basis (4) -> Aufbau (5) -> Spezifisch (3), dann wieder von vorn.
// Mit Renndatum wird rückwärts gerechnet: Rennwoche = Tapering, davor 3 Wochen Spezifisch, 5 Aufbau, Rest Basis.
import { diffDays, mondayOf } from './dates.js';

export const BLOCK_LABEL = { basis: 'Basis', aufbau: 'Aufbau', spezifisch: 'Spezifisch', taper: 'Tapering' };

export function blockFor(date, settings) {
  const thisMonday = mondayOf(date);
  const raceDate = settings.goal?.date;
  if (raceDate && diffDays(raceDate, date) >= 0) {
    const w = Math.round(diffDays(mondayOf(raceDate), thisMonday) / 7); // 0 = Rennwoche
    if (w === 0) return { name: 'taper', week: 1, deload: false, weeksToRace: 0 };
    if (w <= 3) return { name: 'spezifisch', week: 4 - w, deload: false, weeksToRace: w };
    if (w <= 8) return { name: 'aufbau', week: 9 - w, deload: 9 - w === 4, weeksToRace: w };
    const start = settings.block_start || thisMonday;
    const k = Math.max(0, Math.round(diffDays(thisMonday, mondayOf(start)) / 7));
    const week = (k % 4) + 1;
    return { name: 'basis', week, deload: week === 4, weeksToRace: w };
  }
  const start = settings.block_start || thisMonday;
  const k = Math.max(0, Math.round(diffDays(thisMonday, mondayOf(start)) / 7)) % 12;
  if (k < 4) return { name: 'basis', week: k + 1, deload: k === 3, weeksToRace: null };
  if (k < 9) return { name: 'aufbau', week: k - 3, deload: k - 3 === 4, weeksToRace: null };
  return { name: 'spezifisch', week: k - 8, deload: false, weeksToRace: null };
}
