// Trainingsstatus in Worten (angelehnt an die Einordnung bei Garmin/TrainingPeaks): aus Belastungsverhältnis
// (7/28 Tage, Williams et al. 2017) und der Entwicklung des Leistungsstands (VDOT) über vier Wochen.
const last = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v[v.length - 1] : null; };

export function trainingStatus({ acwr, history = [], weeklyKm = null }) {
  const vNow = last(history);
  const older = history.slice(0, Math.max(0, history.length - 4)).filter((x) => x != null);
  const vOld = older.length ? older[older.length - 1] : null; // Stand vor ca. 4 Wochen
  const dv = vNow != null && vOld != null ? Math.round((vNow - vOld) * 10) / 10 : null;
  const r = acwr;
  if (r != null && r > 1.5) return { key: 'over', label: 'Überlastet', color: '#FF3B30', text: `Die letzte Woche war ${String(r.toFixed(2)).replace('.', ',')}-mal so hart wie dein Schnitt. Mehr Ruhe, bevor es weitergeht.` };
  if (dv != null && dv >= 0.4 && (r == null || r <= 1.5)) return { key: 'productive', label: 'Produktiv', color: '#34C759', text: `Dein Leistungsstand ist in vier Wochen um ${String(dv.toFixed(1)).replace('.', ',')} VDOT gestiegen. Die Belastung passt.` };
  if (dv != null && dv <= -0.6) return { key: 'declining', label: 'Rückgang', color: '#FF9500', text: `Der Leistungsstand ist in vier Wochen um ${String(Math.abs(dv).toFixed(1)).replace('.', ',')} VDOT gefallen. Regelmäßigkeit und ein harter Lauf helfen.` };
  if (r != null && r < 0.8) return { key: 'recovery', label: 'Erholung', color: '#0A84FF', text: 'Die Belastung liegt unter deinem Schnitt. Gut für die Erholung, für Fortschritt braucht es wieder mehr Umfang.' };
  if (r != null && r > 1.3) return { key: 'high', label: 'Fordernd', color: '#FF9500', text: 'Die Belastung ist hoch, aber noch im Rahmen. Achte auf Schlaf und leichte Tage.' };
  return { key: 'maintaining', label: 'Erhaltend', color: '#8E8E93', text: dv != null ? 'Belastung im Normalbereich, der Leistungsstand bleibt stabil. Eine Qualitätseinheit mit leichter Steigerung bringt ihn voran.' : 'Belastung im Normalbereich.' };
}
