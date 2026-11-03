// Web-Push für die Morgenerinnerung. Läuft nur, wenn VAPID-Schlüssel gesetzt sind (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
import webpush from 'web-push';

export const pushReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

function configure() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

/** Sendet an alle Abos; gibt die noch gültigen zurück. */
export async function sendAll(subs, payload) {
  if (!pushReady()) return { subs, sent: 0, errors: ['Schlüssel fehlen'] };
  try { configure(); } catch (e) { return { subs, sent: 0, errors: [`Schlüssel ungültig: ${e.message}`] }; }
  const keep = []; const errors = []; let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600 }); keep.push(s); sent++; }
    catch (e) { errors.push(e.statusCode ? `Push-Dienst antwortet ${e.statusCode}` : e.message); if (e.statusCode !== 404 && e.statusCode !== 410) keep.push(s); }
  }
  return { subs: keep, sent, errors };
}
