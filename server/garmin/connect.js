// Garmin Connect: Anmeldung wie in der Garmin-Connect-App (SSO, dann OAuth1 und OAuth2, wie die Bibliothek garth)
// und Training an die Uhr senden. Die offizielle Personal API ist nur lesend, Trainings gehen nur über diesen Weg.
// Das Passwort wird nie gespeichert: gespeichert wird nur der langlebige OAuth1-Token (ca. ein Jahr), aus dem sich
// jeweils ein frischer OAuth2-Token holen lässt.
import { createHmac } from 'crypto';

let http = (...a) => fetch(...a);
/** Für Tests: eigene fetch-Funktion einsetzen. */
export const setHttp = (f) => { http = f || ((...a) => fetch(...a)); };

const SSO_BASE = 'https://sso.garmin.com';
const API_BASE = 'https://connectapi.garmin.com';

const DOMAIN = 'garmin.com';
const CLIENT_ID = 'GCM_ANDROID_DARK';
const SERVICE_URL = `https://mobile.integration.${DOMAIN}/gcm/android`;

// Android consumer User-Agent – must match the OAuth consumer key from S3
const OAUTH_UA = 'com.garmin.android.apps.connectmobile';
// Browser-like headers: the SSO endpoints sit behind Cloudflare and reject
// plain HTTP clients. Mirror the WebView the Garmin mobile app runs.
const SSO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const SSO_PAGE_HEADERS = {
  'User-Agent': SSO_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
};
// Headers for connectapi.garmin.com data calls (workout push/schedule)
const CONNECT_HEADERS = {
  'User-Agent': OAUTH_UA,
  'di-backend': 'connectapi.garmin.com',
  'NK': 'NT',
};

// OAuth1 consumer credentials – same public values garth fetches from S3
let _consumer = null;
async function getConsumer() {
  if (_consumer) return _consumer;
  try {
    const r = await http('https://thegarth.s3.amazonaws.com/oauth_consumer.json',
      { signal: AbortSignal.timeout(4000) });
    if (r.ok) { _consumer = await r.json(); return _consumer; }
  } catch {}
  _consumer = { consumer_key: 'fc3e99d2-118c-44b8-8ae3-03370dde24c0', consumer_secret: 'E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF' };
  return _consumer;
}

// Build OAuth1 HMAC-SHA1 Authorization header.
// token/tokenSecret optional – omit for two-legged (consumer-only) calls.
// bodyParams: x-www-form-urlencoded form fields, which MUST be folded into the
// signature base string alongside query params (RFC 5849 §3.4.1.3).
function oauth1Header(method, url, consumerKey, consumerSecret, token = null, tokenSecret = '', bodyParams = null) {
  const urlObj = new URL(url);
  const baseUrl = urlObj.origin + urlObj.pathname;
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const oauthP = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: ts,
    oauth_version: '1.0',
  };
  if (token) oauthP.oauth_token = token;

  // Signature covers OAuth params + query-string params + form body params
  const sigP = { ...oauthP };
  for (const [k, v] of urlObj.searchParams) sigP[k] = v;
  if (bodyParams) for (const [k, v] of Object.entries(bodyParams)) sigP[k] = v;

  // Sort by byte order of the percent-encoded key (not locale-aware)
  const paramStr = Object.entries(sigP)
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');

  const base   = `${method.toUpperCase()}&${enc(baseUrl)}&${enc(paramStr)}`;
  const sigKey = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  oauthP.oauth_signature = createHmac('sha1', sigKey).update(base).digest('base64');

  return 'OAuth ' + Object.entries(oauthP).map(([k, v]) => `${k}="${enc(v)}"`).join(', ');
}
const enc = encodeURIComponent;


// Minimal cookie jar – Node's fetch does not persist cookies across requests,
// so we collect Set-Cookie headers and replay them on the next hop.
function storeCookies(jar, res) {
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const raw of setCookies) {
    const part = raw.split(';')[0].trim();
    const eq = part.indexOf('=');
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
}
const cookieHeader = jar => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

// Garmin SSO → OAuth1 → OAuth2 login, mirroring the Garmin Connect mobile app
// (the flow used by the `garth` library). Returns an OAuth2 Bearer access token.
export async function garminLogin(email, password) {
  const jar = new Map();

  // Step 1: GET the mobile sign-in page to seed Cloudflare/session cookies
  const signInUrl = `${SSO_BASE}/mobile/sso/en/sign-in?clientId=${CLIENT_ID}`;
  const r1 = await http(signInUrl, {
    headers: { ...SSO_PAGE_HEADERS, 'Sec-Fetch-Site': 'none' },
  });
  if (!r1.ok) throw new Error(`Garmin SSO nicht erreichbar (${r1.status})`);
  storeCookies(jar, r1);

  // Step 2: POST credentials to the mobile login API → service ticket (JSON)
  const loginParams = new URLSearchParams({
    clientId: CLIENT_ID,
    locale: 'en-US',
    service: SERVICE_URL,
  });
  const loginUrl = `${SSO_BASE}/mobile/api/login?${loginParams}`;
  const r2 = await http(loginUrl, {
    method: 'POST',
    headers: {
      ...SSO_PAGE_HEADERS,
      'Content-Type': 'application/json',
      'Origin': SSO_BASE,
      'Referer': signInUrl,
      'Cookie': cookieHeader(jar),
    },
    body: JSON.stringify({
      username: email,
      password,
      rememberMe: false,
      captchaToken: '',
    }),
  });
  storeCookies(jar, r2);

  let loginJson;
  try {
    loginJson = await r2.json();
  } catch {
    throw new Error(`Garmin-Login fehlgeschlagen (HTTP ${r2.status})`);
  }

  const respType = loginJson?.responseStatus?.type;
  if (respType === 'MFA_REQUIRED') {
    // mfaLastMethodUsed tells us how Garmin sent the code (email/sms/totp);
    // it must be echoed back to /mobile/api/mfa/verifyCode. Default to email.
    const mfaMethod = loginJson?.customerMfaInfo?.mfaLastMethodUsed || 'email';
    return { mfaRequired: true, jar: [...jar.entries()], mfaMethod };
  }
  if (respType !== 'SUCCESSFUL' || !loginJson.serviceTicketId) {
    const msg = loginJson?.responseStatus?.message || 'E-Mail oder Passwort falsch';
    throw new Error(`Garmin-Login fehlgeschlagen: ${msg}`);
  }
  const ticket = loginJson.serviceTicketId;

  // Step 3 (best-effort): pin the Cloudflare load-balancer backend via embed
  try {
    const r3 = await http(`${SSO_BASE}/portal/sso/embed`, {
      headers: {
        ...SSO_PAGE_HEADERS,
        'Sec-Fetch-Site': 'same-origin',
        'Referer': loginUrl,
        'Cookie': cookieHeader(jar),
      },
    });
    storeCookies(jar, r3);
  } catch {}

  const consumer = await getConsumer();

  // Step 4: exchange the ticket for an OAuth1 request token (consumer-signed).
  // login-url MUST match the `service` the ticket was issued for, or Garmin
  // rejects the ticket with 401.
  const preUrl = `${API_BASE}/oauth-service/oauth/preauthorized?ticket=${enc(ticket)}&login-url=${enc(SERVICE_URL)}&accepts-mfa-tokens=true`;
  const preAuth = oauth1Header('GET', preUrl, consumer.consumer_key, consumer.consumer_secret);
  const r4 = await http(preUrl, {
    headers: { 'User-Agent': OAUTH_UA, 'Authorization': preAuth, 'Cookie': cookieHeader(jar) },
  });
  const body4 = await r4.text();
  if (!r4.ok) {
    throw new Error(`Garmin OAuth1-Anfrage fehlgeschlagen (${r4.status}): ${body4.slice(0, 120)}`);
  }
  // Response is URL-encoded key=value pairs, not JSON
  const o1 = Object.fromEntries(new URLSearchParams(body4));
  if (!o1.oauth_token || !o1.oauth_token_secret) {
    throw new Error('Garmin OAuth1-Token nicht erhalten');
  }

  // Step 5: exchange the OAuth1 token for an OAuth2 access token.
  // The OAuth1 token/secret are long-lived (~1 year), so we return them too:
  // a later silent refresh can re-run just this step without the password.
  const oauth2 = await exchangeOAuth2(consumer, o1.oauth_token, o1.oauth_token_secret, jar);
  return {
    ...oauth2,
    oauthToken: o1.oauth_token,
    oauthTokenSecret: o1.oauth_token_secret,
  };
}

// Complete a login that required MFA. `jarEntries` is the serialized cookie jar
// returned by garminLogin, `mfaMethod` the method Garmin reported (email/totp/…).
// Mirrors garth's handle_mfa → POST /mobile/api/mfa/verifyCode with the same
// login_params as query string and the verification code in the JSON body.
export async function garminLoginMfa(mfaCode, jarEntries, mfaMethod = 'email') {
  const jar = new Map(jarEntries || []);
  const loginParams = new URLSearchParams({
    clientId: CLIENT_ID,
    locale: 'en-US',
    service: SERVICE_URL,
  });
  const signInUrl = `${SSO_BASE}/mobile/sso/en/sign-in?clientId=${CLIENT_ID}`;
  const mfaUrl = `${SSO_BASE}/mobile/api/mfa/verifyCode?${loginParams}`;
  const r = await http(mfaUrl, {
    method: 'POST',
    headers: {
      ...SSO_PAGE_HEADERS,
      'Content-Type': 'application/json',
      'Origin': SSO_BASE,
      'Referer': signInUrl,
      'Cookie': cookieHeader(jar),
    },
    body: JSON.stringify({
      mfaMethod: mfaMethod || 'email',
      mfaVerificationCode: String(mfaCode).trim(),
      rememberMyBrowser: false,
      reconsentList: [],
      mfaSetup: false,
    }),
  });
  storeCookies(jar, r);

  let mfaJson;
  try { mfaJson = await r.json(); } catch {
    throw new Error(`Garmin MFA fehlgeschlagen (HTTP ${r.status})`);
  }
  const mfaRespType = mfaJson?.responseStatus?.type;
  if (mfaRespType !== 'SUCCESSFUL' || !mfaJson.serviceTicketId) {
    const msg = mfaJson?.responseStatus?.message || 'Code ungültig oder abgelaufen';
    throw new Error(`Garmin MFA fehlgeschlagen: ${msg}`);
  }
  const ticket = mfaJson.serviceTicketId;

  // Same OAuth1→OAuth2 exchange as in garminLogin
  try {
    await http(`${SSO_BASE}/portal/sso/embed`, {
      headers: { ...SSO_PAGE_HEADERS, 'Sec-Fetch-Site': 'same-origin', 'Referer': signInUrl, 'Cookie': cookieHeader(jar) },
    }).then(r3 => storeCookies(jar, r3));
  } catch {}

  const consumer = await getConsumer();
  const preUrl = `${API_BASE}/oauth-service/oauth/preauthorized?ticket=${enc(ticket)}&login-url=${enc(SERVICE_URL)}&accepts-mfa-tokens=true`;
  const preAuth = oauth1Header('GET', preUrl, consumer.consumer_key, consumer.consumer_secret);
  const r4 = await http(preUrl, {
    headers: { 'User-Agent': OAUTH_UA, 'Authorization': preAuth, 'Cookie': cookieHeader(jar) },
  });
  const body4 = await r4.text();
  if (!r4.ok) throw new Error(`Garmin OAuth1-Anfrage fehlgeschlagen (${r4.status}): ${body4.slice(0, 120)}`);
  const o1 = Object.fromEntries(new URLSearchParams(body4));
  if (!o1.oauth_token || !o1.oauth_token_secret) throw new Error('Garmin OAuth1-Token nicht erhalten');

  // After MFA, the preauthorized response carries an mfa_token that MUST be
  // folded into the OAuth2 exchange body (and its signature) – otherwise the
  // exchange is rejected. garth does the same.
  const oauth2 = await exchangeOAuth2(consumer, o1.oauth_token, o1.oauth_token_secret, jar, o1.mfa_token);
  return { ...oauth2, oauthToken: o1.oauth_token, oauthTokenSecret: o1.oauth_token_secret };
}

// Re-exchange a stored OAuth1 token for a fresh OAuth2 access token, without
// SSO/password. This is what keeps the user logged in: garth works the same way.
export async function garminRefreshToken(oauthToken, oauthTokenSecret) {
  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('Garmin OAuth1-Token fehlt – bitte neu verbinden');
  }
  const consumer = await getConsumer();
  return exchangeOAuth2(consumer, oauthToken, oauthTokenSecret);
}

// Step 5 extracted: sign the OAuth2 exchange with the OAuth1 token. The SSO
// cookie jar is optional – on a silent refresh we no longer have it, and the
// OAuth1 signature alone authenticates the exchange.
async function exchangeOAuth2(consumer, oauthToken, oauthTokenSecret, jar = null, mfaToken = null) {
  const exchangeUrl = `${API_BASE}/oauth-service/oauth/exchange/user/2.0`;
  const exchangeBody = { audience: 'GARMIN_CONNECT_MOBILE_ANDROID_DI' };
  if (mfaToken) exchangeBody.mfa_token = mfaToken;
  const authHdr = oauth1Header('POST', exchangeUrl,
    consumer.consumer_key, consumer.consumer_secret,
    oauthToken, oauthTokenSecret, exchangeBody);
  const headers = {
    'User-Agent': OAUTH_UA,
    'Authorization': authHdr,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (jar) headers['Cookie'] = cookieHeader(jar);
  const r5 = await http(exchangeUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(exchangeBody).toString(),
  });
  const body5 = await r5.text();
  if (!r5.ok) {
    throw new Error(`Garmin OAuth2-Exchange fehlgeschlagen (${r5.status}): ${body5.slice(0, 120)}`);
  }
  const tok = JSON.parse(body5);
  if (!tok.access_token) throw new Error('Garmin Access-Token nicht erhalten');
  return { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 };
}


// ---- Trainings an Garmin senden ---------------------------------------------------

const authError = (msg = 'Garmin-Sitzung abgelaufen. Bitte im Profil neu verbinden.') => Object.assign(new Error(msg), { code: 'GARMIN_AUTH' });

function apiHeaders(accessToken) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...CONNECT_HEADERS };
}

async function call(accessToken, endpoint, method, body) {
  const res = await http(`${API_BASE}${endpoint}`, { method, headers: apiHeaders(accessToken), body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 || res.status === 403) throw authError();
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Garmin-Fehler (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  const text = await res.text().catch(() => '');
  return text.trim() ? JSON.parse(text) : null;
}

/** Legt das Training bei Garmin an und gibt die workoutId zurück. */
export async function pushWorkout(accessToken, workout) {
  const r = await call(accessToken, '/workout-service/workout', 'POST', workout);
  if (!r?.workoutId) throw new Error('Garmin hat keine Workout-ID geliefert');
  return r.workoutId;
}

/** Trägt ein Training für ein Datum (YYYY-MM-DD) im Garmin-Kalender ein, damit es auf der Uhr erscheint. */
export const scheduleWorkout = (accessToken, workoutId, date) => call(accessToken, `/workout-service/schedule/${workoutId}`, 'POST', { date });

/** Löscht ein früher gesendetes Training (Fehler werden ignoriert, z. B. wenn es schon gelöscht wurde). */
export async function deleteWorkout(accessToken, workoutId) {
  try { await call(accessToken, `/workout-service/workout/${workoutId}`, 'DELETE'); } catch (e) { if (e.code === 'GARMIN_AUTH') throw e; }
}

export { authError };
