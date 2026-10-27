# Fitness Coach

Persönliche Trainings-App für Laufen, Rad und Kraft. Daten kommen aus der Garmin Personal API, der Plan wird **ausschließlich per Algorithmus** berechnet (keine KI im Betrieb). Läuft als PWA auf Vercel mit Supabase, Anmeldung per Passkey.

## Wie der Plan entsteht
- Feste Wochenroutine: Di Spinning (Kurs), Mi Kraft A, Do Lauf Qualität, Sa Langer Lauf, So Kraft B; Mo und Fr frei. Die Sportart je Tag ist fix, der Inhalt passt sich an.
- Blockperiodisierung (Basis 4, Aufbau 5, Spezifisch 3 Wochen, Taper). Mit Wettkampfdatum wird rückwärts gezählt, sonst Zyklus à 12 Wochen.
- Anpassung nach Regeln: Entlastungswoche (R-DELOAD), Belastungsverhältnis 7 d/28 d über 1,5 (R-LOAD), HRV, Ruhepuls, Schlaf (R-HRV/RHR/SLEEP), Anstrengung (R-RPE), Schmerz (R-PAIN), ausgefallene Läufe (R-MISSED), Umfangszuwachs höchstens 10 % (R-GROWTH), Spinning gestern (R-SPIN). Jede Anpassung steht mit Begründung auf der Karte.
- Zonen aus Schwellenpuls 181: Z1 <154, Z2 154–162, Z3 163–171, Z4 172–180, Z5 ≥181.

## Einrichtung
1. **Supabase**: neues Projekt, `supabase/schema.sql` im SQL-Editor ausführen. Tabellen tragen das Präfix `fit_`, RLS ist aktiv, Zugriff nur mit Service-Key.
2. **Vercel**: Repo importieren (Branch `garmin-rewrite`), Umgebungsvariablen aus `.env.example` setzen. Der Cron `/api/cron/sync` läuft täglich (Hobby-Limit).
3. **Erster Start**: App öffnen, Setup-Token eingeben, Passkey anlegen. Weitere Geräte unter Mehr, Passkeys.
4. **Verlauf laden**: Mehr, „Verlauf ab 01.01. laden“ (mehrere Durchläufe, je Durchlauf wenige Aktivitäten wegen der 60-s-Grenze). Oder lokal: `node scripts/import-local.js <ordner>` mit gesetzten Supabase-Variablen.
5. **Zum Home-Bildschirm hinzufügen** (iOS: Teilen, Zum Home-Bildschirm; Android: Installieren).

## Lokal
```
npm install
node server/dev.js          # http://localhost:3000, ohne Supabase mit Arbeitsspeicher
npm test
node scripts/simulate.js <ordner> 2026-09-20   # Plan gegen eigene Historie abspielen
```
Lokal ohne HTTPS: `SESSION_SECRET` ist nur in Produktion Pflicht; Passkeys funktionieren auf `localhost`.

## Hinweise
- Garmin-Token (24 h) werden in `fit_settings` zwischengespeichert.
- Schwellenwerte: Die App schlägt Schwellenpuls und -tempo aus harten Läufen vor, du bestätigst unter Heute.
- Das Planungsdokument beschreibt die Hintergründe; die Architektur dort ist durch diese Umsetzung (Vercel + Supabase) ersetzt.
