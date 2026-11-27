import { LedgerError } from './ledger.js';
export const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export class Fail extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; } }

// Basic request checks for browser-facing endpoints: JSON only, small bodies, and same-site browsers only.
// (This blocks other websites from driving our endpoints through a visitor's browser. It is not a replacement for rate limiting.)
export function guard(request, env) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > 60000) return json(413, { error: 'Request too large.' });
  const ct = request.headers.get('content-type') || '';
  if (request.method === 'POST' && !ct.includes('application/json')) return json(415, { error: 'Invalid request.' });
  const origin = request.headers.get('origin');
  if (origin) {
    const allowed = new Set([new URL(request.url).origin, ...String((env && env.ALLOWED_ORIGINS) || 'https://get2fly.com,https://www.get2fly.com').split(',').map((s) => s.trim())]);
    if (!allowed.has(origin)) return json(403, { error: 'Forbidden.' });
  }
  return null;
}
export async function readJson(request) {
  try { const b = await request.json(); if (b && typeof b === 'object') return b; } catch (e) { /* fall through */ }
  throw new Fail(400, 'Invalid request.');
}
// Runs a handler and turns known problems into safe JSON answers (no stack traces or secrets leave the server).
export async function run(fn, env) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message, ...e.extra });
    if (e instanceof LedgerError) {
      console.error(JSON.stringify({ app: 'get2fly', event: 'ledger_error', code: e.code, ...(e.detail || {}) }));       // the real reason goes to the Cloudflare logs
      // Temporary troubleshooting: set DEBUG_PAYMENTS=true to also see the reason in the response. Remove it afterwards.
      return json(503, { error: 'The service is temporarily unavailable. Please try again in a moment.', ...(env && env.DEBUG_PAYMENTS === 'true' ? { debug: { code: e.code, ...(e.detail || {}) } } : {}) });
    }
    console.error(JSON.stringify({ app: 'get2fly', event: 'unexpected_error', message: String(e && e.message).slice(0, 200) }));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
