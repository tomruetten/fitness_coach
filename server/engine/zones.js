// Pulszonen und Pace-Hilfen. Grenzen als Prozent des Schwellenpulses (LTHR),
// nach der gängigen Einteilung: Z1 <85 %, Z2 85–89 %, Z3 90–94 %, Z4 95–99 %, Z5 ab 100 %.
export const ZONE_NAMES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

export function zoneBounds(lthr) {
  // Untergrenzen von Z2..Z5 (Z1 beginnt bei 0)
  return [0.85, 0.9, 0.95, 1.0].map((p) => Math.round(lthr * p));
}

/** Liefert 1..5 für einen Puls. */
export function zoneOf(hr, lthr) {
  const [b2, b3, b4, b5] = zoneBounds(lthr);
  if (hr < b2) return 1;
  if (hr < b3) return 2;
  if (hr < b4) return 3;
  if (hr < b5) return 4;
  return 5;
}

/** Lesbare Zonenliste, z. B. [{zone:2, from:154, to:162}]. */
export function zoneTable(lthr) {
  const [b2, b3, b4, b5] = zoneBounds(lthr);
  return [
    { zone: 1, from: 0, to: b2 - 1 },
    { zone: 2, from: b2, to: b3 - 1 },
    { zone: 3, from: b3, to: b4 - 1 },
    { zone: 4, from: b4, to: b5 - 1 },
    { zone: 5, from: b5, to: null },
  ];
}

/** Sekunden pro Zone aus einer Liste von {hr, dt}-Samples. */
export function zoneSeconds(samples, lthr) {
  const out = [0, 0, 0, 0, 0];
  for (const s of samples) {
    if (!s.hr || s.hr <= 0) continue;
    out[zoneOf(s.hr, lthr) - 1] += s.dt;
  }
  return out;
}

export const fmtPace = (secPerKm) => {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm - m * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const parsePace = (txt) => {
  const m = /^(\d+):(\d{2})$/.exec(String(txt).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
