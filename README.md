# Fitness Coach

Persönliche Trainings-App für Laufen, Rad und Kraft. Daten kommen aus der Garmin Personal API, der Plan wird **ausschließlich per Algorithmus** berechnet (keine KI im Betrieb). Läuft als PWA auf Vercel mit Supabase, Anmeldung per Passkey.

## Wie der Plan entsteht
- Feste Wochenroutine: Di Spinning (Kurs), Mi Kraft A, Do Lauf Qualität, Sa Langer Lauf, So Kraft B; Mo und Fr frei. Die Sportart je Tag ist fix, der Inhalt passt sich an.
- **Leistungsstand statt Kalender.** Es gibt kein festes Rennen; die App misst laufend, wie fit du bist (`server/engine/fitness.js`):
  - VDOT nach Daniels & Gilbert aus deinen härtesten Leistungen (beste 5/10/20/30/60 min und ganze Läufe mit Puls nahe Schwelle), mit langsamem Alterungsabschlag (−0,5 % je Woche nach 3 Wochen ohne Beleg).
  - Dazu das Puls-Tempo-Verhalten aller Läufe (Pulsreserve ≈ VO2-Reserve, Swain et al. 1994): wird dein Tempo bei gleichem Puls schneller, steigt der VDOT zwischen harten Läufen.
  - Daraus folgen Schwelle (88 % VO2max), Intervall (98 %), Marathon-/Halbmarathontempo und Prognosen. Das lockere Tempo kommt aus deinen eigenen Z2-Kilometern.
- **Umfang und Zyklus** (`progression.js`): Wochenumfang +10 % gegen letzte Woche, nach drei Belastungswochen eine Entlastungswoche (−22 %, Intensität bleibt), danach zurück auf das alte Niveau. Wachstum nur bei guter Erholung; Belastungsverhältnis (EWMA 7/28 d nach Williams et al.) über 1,3 bremst. Ausreißerwochen (Rennen) werden begrenzt.
- **Qualitätslauf:** Zyklus Schwelle (Cruise-Intervalle) → VO2max-Intervalle → Tempodauerlauf → Entlastung. Das Volumen ist das zuletzt tatsächlich Gelaufene (harte Abschnitte aus der FIT-Datei) × 1,08, bei RPE ≥ 9 × 0,9, bei leichter Einheit × 1,12. Harte Zeit höchstens 20 % der Wochen-Trainingszeit abzüglich Spinning (Seiler, 80/20). Ohne belegte Regelmäßigkeit (6 Läufe in 4 Wochen) nur Steigerungsläufe. Fehlt seit über 5 Wochen ein harter Beleg, ersetzt ein 30-Minuten-Test die Einheit.
- **Langer Lauf:** Wochenziel minus bereits Gelaufenes, höchstens +10 % gegen den längsten Lauf der letzten 4 Wochen und 150 min. Entkopplung (Pa:HR) über 6 % hält die Länge, unter 3 % gibt frei. Ab Belastungswoche 2 Endteil im Marathon-, dann Halbmarathontempo.
- Weitere Regeln: HRV auf ln-Skala (7-Tage-Mittel gegen 60-Tage-Basis, Plews et al.), Ruhepuls, Schlaf, RPE, Schmerz, ausgefallene Läufe, Spinning am Vortag. Jede Anpassung steht mit Begründung auf der Karte („So wurde geplant“).
- Beim ersten Sync nach dem Update werden ältere Läufe einmalig neu ausgewertet (`best.v = 2`: Bestleistungen, harte Abschnitte, Entkopplung). Bis dahin nutzt die App Kilometerwerte und Pulszonen.
- Zonen aus Schwellenpuls 181: Z1 <154, Z2 154–162, Z3 163–171, Z4 172–180, Z5 ≥181.

## Einrichtung
1. **Supabase**: neues Projekt, `supabase/schema.sql` im SQL-Editor ausführen. Tabellen tragen das Präfix `fit_`, RLS ist aktiv, Zugriff nur mit Service-Key.
2. **Vercel**: Repo importieren (Branch `garmin-rewrite`), Umgebungsvariablen aus `.env.example` setzen. Der Cron `/api/cron/sync` läuft täglich (Hobby-Limit).
3. **Erster Start**: App öffnen, Setup-Token eingeben, Passkey anlegen. Weitere Geräte unter Profil, Passkeys.
4. **Verlauf laden**: Profil, „Verlauf ab 01.01. laden“ (mehrere Durchläufe, je Durchlauf wenige Aktivitäten wegen der 60-s-Grenze). Oder lokal: `node scripts/import-local.js <ordner>` mit gesetzten Supabase-Variablen.
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
