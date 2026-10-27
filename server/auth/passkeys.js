// Passkey-Anmeldung (WebAuthn) für genau eine Person.
import crypto from 'crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const USER_ID = new TextEncoder().encode('athlete');
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const fromB64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

export function relyingParty(req) {
  let env = (process.env.APP_ORIGIN || '').trim();
  if (env && !/^https?:\/\//.test(env)) env = 'https://' + env;
  const origin = env || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const url = new URL(origin);
  return { origin: url.origin, rpID: process.env.RP_ID || url.hostname, rpName: 'Fitness Coach' };
}

const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

async function assertNotLocked(store, ip) {
  const a = await store.attempts(ip);
  if (a.locked_until && new Date(a.locked_until) > new Date()) {
    const e = new Error('Zu viele Fehlversuche. Bitte später erneut versuchen.');
    e.status = 429;
    throw e;
  }
}
async function registerFail(store, ip) {
  const a = await store.attempts(ip);
  const fails = (a.fails || 0) + 1;
  await store.setAttempts(ip, { fails: fails >= MAX_FAILS ? 0 : fails, locked_until: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : null });
}

export async function registrationOptions(store, req) {
  const { rpID, rpName } = relyingParty(req);
  const existing = await store.passkeys();
  const options = await generateRegistrationOptions({
    rpName, rpID, userName: 'athlete', userDisplayName: 'Athlet', userID: USER_ID, attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports || undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const id = crypto.randomUUID();
  await store.saveChallenge({ id, challenge: options.challenge, kind: 'register', expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() });
  return { options, challengeId: id };
}

export async function verifyRegistration(store, req, { challengeId, response, label }) {
  const { origin, rpID } = relyingParty(req);
  const c = await store.takeChallenge(challengeId);
  if (!c || c.kind !== 'register') throw Object.assign(new Error('Anfrage abgelaufen'), { status: 400 });
  const v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!v.verified || !v.registrationInfo) throw Object.assign(new Error('Registrierung nicht bestätigt'), { status: 400 });
  const { credential } = v.registrationInfo;
  await store.savePasskey({ id: credential.id, public_key: b64u(credential.publicKey), counter: credential.counter, transports: credential.transports || null, label: (label || 'Gerät').slice(0, 40) });
  return true;
}

export async function loginOptions(store, req) {
  await assertNotLocked(store, ipOf(req));
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const id = crypto.randomUUID();
  await store.saveChallenge({ id, challenge: options.challenge, kind: 'login', expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() });
  return { options, challengeId: id };
}

export async function verifyLogin(store, req, { challengeId, response }) {
  const ip = ipOf(req);
  await assertNotLocked(store, ip);
  const { origin, rpID } = relyingParty(req);
  const c = await store.takeChallenge(challengeId);
  const fail = async (msg) => { await registerFail(store, ip); throw Object.assign(new Error(msg), { status: 401 }); };
  if (!c || c.kind !== 'login') return fail('Anfrage abgelaufen');
  const pk = await store.passkey(response?.id);
  if (!pk) return fail('Unbekannter Passkey');
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.id, publicKey: fromB64u(pk.public_key), counter: Number(pk.counter || 0), transports: pk.transports || undefined },
    });
  } catch { return fail('Anmeldung fehlgeschlagen'); }
  if (!v.verified) return fail('Anmeldung fehlgeschlagen');
  await store.updatePasskeyCounter(pk.id, v.authenticationInfo.newCounter);
  await store.setAttempts(ip, { fails: 0, locked_until: null });
  return true;
}
