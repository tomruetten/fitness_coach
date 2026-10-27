// Kalenderrechnung auf YYYY-MM-DD-Strings (UTC-basiert, damit keine Zeitzonenfehler entstehen).
const DAY = 86400000;
const ms = (d) => Date.parse(d + 'T00:00:00Z');
export const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((ms(a) - ms(b)) / DAY);
export const weekday = (d) => new Date(ms(d)).getUTCDay(); // 0 = Sonntag
export const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const weekDates = (d) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(d), i));
