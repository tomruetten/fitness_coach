// Zeiträume für die Analyse: Woche (7 Tage), Monat (letzte 5 Wochen), Jahr (12 Monate).
import { addDays, mondayOf } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

export function isoWeek(d) {
  const dt = new Date(Date.parse(d + 'T00:00:00Z'));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

export function buckets(range, date) {
  let list;
  let sub;
  if (range === 'week') {
    const m = mondayOf(date);
    list = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label, i) => ({ label, from: addDays(m, i), to: addDays(m, i) }));
    sub = `Woche ${dm(m)} bis ${dm(addDays(m, 6))}`;
  } else if (range === 'year') {
    const y = Number(date.slice(0, 4));
    list = Array.from({ length: 12 }, (_, i) => {
      const from = `${y}-${pad(i + 1)}-01`;
      const next = i === 11 ? `${y + 1}-01-01` : `${y}-${pad(i + 2)}-01`;
      return { label: 'JFMAMJJASOND'[i], from, to: addDays(next, -1) };
    });
    sub = `${y} · Januar bis Dezember`;
  } else {
    const m = mondayOf(date);
    list = [4, 3, 2, 1, 0].map((i) => {
      const from = addDays(m, -7 * i);
      return { label: 'KW' + isoWeek(from), from, to: addDays(from, 6) };
    });
    sub = 'Letzte 5 Wochen';
  }
  return { list: list.map((b) => ({ ...b, future: b.from > date })), sub };
}
