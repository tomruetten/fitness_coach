#!/usr/bin/env node
// Garmin-Anmeldung auf dem eigenen Rechner (privater Internetanschluss, deshalb selten gedrosselt).
// Gibt eine Zeile aus, die in der App unter Profil, Garmin, „Token aus Skript einfügen“ eingefügt wird.
// Das Passwort wird nur für diese Anmeldung verwendet und nirgends gespeichert.
import readline from 'readline';
import { garminLogin, garminLoginMfa } from '../server/garmin/connect.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q, hidden = false) => new Promise((res) => {
  if (hidden) { const w = rl._writeToOutput; rl._writeToOutput = (s) => { if (s.includes(q)) w.call(rl, s); }; }
  rl.question(q, (a) => { if (hidden) { rl._writeToOutput = rl.constructor.prototype._writeToOutput; process.stdout.write('\n'); } res(a.trim()); });
});

try {
  const email = await ask('Garmin E-Mail: ');
  const password = await ask('Passwort: ', true);
  let r = await garminLogin(email, password);
  if (r.mfaRequired) r = await garminLoginMfa(await ask('Bestätigungscode: '), r.jar, r.mfaMethod);
  console.log(`\nFertig (Zugriffstoken gültig bis ${new Date(r.expiresAt).toLocaleString('de-DE')}). Diese Zeile in der App einfügen:\n`);
  console.log(Buffer.from(JSON.stringify({ o: r.oauthToken, s: r.oauthTokenSecret, a: r.accessToken, e: r.expiresAt })).toString('base64url'));
  console.log();
} catch (e) { console.error('Fehler:', e.message); process.exitCode = 1; }
rl.close();
