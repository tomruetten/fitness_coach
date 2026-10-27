// Startwerte der Anpassungsregeln. Sie sind Vorschläge und werden nach vier
// Wochen an den echten Daten kalibriert (siehe README, „Kalibrierung“).
export const RULES = {
  hrvSdBelow: 1.0,        // HRV-Wochenmittel mehr als 1 SD unter Basislinie
  restingHrAbove: 5,      // Ruhepuls mehr als 5 bpm über Basislinie
  sleepShortHours: 6.5,   // zwei Nächte in Folge darunter
  acwrHigh: 1.5,          // akute/chronische Last darüber: Woche entlasten
  weeklyKmGrowth: 0.10,   // Laufumfang höchstens +10 % gegen Schnitt der letzten 3 Wochen
  painThreshold: 4,       // gemeldeter Schmerz ab 4 von 10
  rpeHigh: 9,             // letzte Einheit mit RPE >= 9 gilt als sehr hart
};

// Wochenstruktur: Sportart pro Wochentag ist fest (0 = Sonntag ... 6 = Samstag).
export const DEFAULT_WEEK = {
  1: { kind: 'rest', label: 'Ruhe' },
  2: { kind: 'spinning', label: 'Spinning (Kurs, abends)', fixed: true },
  3: { kind: 'strength_a', label: 'Kraft A' },
  4: { kind: 'run_quality', label: 'Lauf A (Qualität)' },
  5: { kind: 'rest', label: 'Ruhe' },
  6: { kind: 'run_long', label: 'Lauf B (lang)' },
  0: { kind: 'strength_b', label: 'Kraft B' },
};

export const DEFAULT_SETTINGS = {
  lthr: 181,
  max_hr: 202,
  lt_pace_s: 298,           // 4:58 min/km
  easy_pace_s: 365,         // Start: 6:05 min/km, wird aus Z2-Läufen nachgeführt
  goal: { distance_km: 21.0975, time_s: 6600, date: null }, // 1:50:00, Termin offen
  week: DEFAULT_WEEK,
  strength_max_min: 90,
  block_start: null,        // Datum, ab dem der Blockzähler läuft
  equipment: 'gym',
  timezone: 'Europe/Berlin',
};
