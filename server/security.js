// HTTP hardening: security headers, CSRF origin check, rate limiting, login lockout, upload type checks.
import crypto from 'node:crypto';
import { setting, setSetting } from './db.js';

// ---------- demo password (never hard-coded) ----------
// Set DEMO_PASSWORD in the hosting dashboard (min. 12 chars). Without it, a strong random password is generated
// once, stored server-side and printed in the server log only.
export function demoPassword() {
  const env = process.env.DEMO_PASSWORD;
  if (env && env.length >= 12) return env;
  if (env) console.warn('DEMO_PASSWORD ignored: it must be at least 12 characters.');
  let p = setting('generated_demo_password', null);
  if (!p) { p = crypto.randomBytes(12).toString('base64url'); setSetting('generated_demo_password', p); console.log(`Generated staff password (set DEMO_PASSWORD to choose your own): ${p}`); }
  return p;
}

// ---------- headers ----------
export const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:", "connect-src 'self'", "frame-src 'self'", "frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');
// user-supplied or generated documents: no script can ever run, even inside an SVG/HTML file
export const DOC_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
export function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', APP_CSP);
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
export function sessionCookie(req, token, maxAge = SESSION_TTL_S) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
export const SESSION_TTL_S = 8 * 3600;

// ---------- CSRF: state-changing calls must be JSON and come from our own origin ----------
export function csrfOk(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return true;                       // non-browser clients (no cookies sent cross-site anyway: SameSite=Strict)
  try { return new URL(src).host === host; } catch { return false; }
}

// ---------- rate limiting ----------
const buckets = new Map();
export function rateLimited(key, limit, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n++;
  return b.n > limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.start > 3600e3) buckets.delete(k); for (const [k, f] of fails) if (now > f.until && now - f.first > 3600e3) fails.delete(k); }, 600e3).unref();
export const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

// ---------- login lockout: 5 failures on an account (or 30 from one IP) in 15 min → locked 15 min ----------
const fails = new Map();
export function loginLocked(...keys) { const now = Date.now(); return keys.some(k => (fails.get(k)?.until || 0) > now); }
export function loginFailed(...keys) {
  const now = Date.now();
  for (const k of keys) { let f = fails.get(k); if (!f || now - f.first > 15 * 60e3) f = { first: now, n: 0, until: 0 }; f.n++; if (f.n >= (k.startsWith('ip:') ? 30 : 5)) f.until = now + 15 * 60e3; fails.set(k, f); }
}
export function loginOk(...keys) { for (const k of keys) if (!k.startsWith('ip:')) fails.delete(k); }

// ---------- uploads: accept only real images / PDF (checked on the bytes, not the name) ----------
export function sniffMime(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'image/gif';
  if (buf.length > 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
