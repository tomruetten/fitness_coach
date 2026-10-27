import crypto from 'crypto';

export const COOKIE = 'fit_session';
const MAX_AGE_S = 30 * 24 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('SESSION_SECRET (mindestens 32 Zeichen) ist nicht gesetzt');
    return 'dev-only-secret-dev-only-secret-dev-only';
  }
  return s;
}
const sign = (b64) => crypto.createHmac('sha256', secret()).update(b64).digest('base64url');

export function createToken(extra = {}) {
  const b64 = Buffer.from(JSON.stringify({ ...extra, exp: Date.now() + MAX_AGE_S * 1000, v: 1 })).toString('base64url');
  return `${b64}.${sign(b64)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const i = token.lastIndexOf('.');
  const b64 = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const exp = Buffer.from(sign(b64));
  if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignorieren */ } }
  }
  return out;
}

const secure = () => (process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '');
export const setSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=${createToken()}; HttpOnly; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax${secure()}`);
export const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure()}`);

export function isAuthed(req) {
  return !!verifyToken(parseCookies(req.headers.cookie)[COOKIE]);
}
export function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

/** Gegen Cross-Site-Anfragen: schreibende Aufrufe brauchen JSON und einen eigenen Header. */
export function requireJsonHeader(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'fit') {
    return res.status(400).json({ error: 'Ungültige Anfrage' });
  }
  next();
}
