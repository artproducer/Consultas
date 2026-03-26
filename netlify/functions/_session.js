const crypto = require('crypto');

const COOKIE_NAME = 'inbox_session';

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(value, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(cookieHeader) {
  const out = {};
  const src = String(cookieHeader || '');
  if (!src) return out;

  const parts = src.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function createSessionToken(secret, ttlSeconds) {
  const now = Date.now();
  const payload = {
    iat: now,
    exp: now + (ttlSeconds * 1000)
  };

  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token, secret) {
  const raw = String(token || '');
  const parts = raw.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64, secret);
  if (!timingSafeEqualStr(sig, expectedSig)) return false;

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64));
  } catch (_) {
    return false;
  }

  if (!payload || typeof payload.exp !== 'number') return false;
  return payload.exp > Date.now();
}

function buildSessionCookie(token, ttlSeconds) {
  // SameSite=None is required for cross-site cookies (GitHub Pages -> Netlify).
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${ttlSeconds}`;
}

function buildLogoutCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  timingSafeEqualStr,
  createSessionToken,
  verifySessionToken,
  buildSessionCookie,
  buildLogoutCookie
};
