// Cloudflare Pages Function: re-sends the confirmation email to the booking's own email.  URL: /api/resend-email
import { sendConfirmation } from '../_lib/email.js';
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export async function onRequestPost({ request, env }) {
  const token = env.DUFFEL_TOKEN;
  if (!token || !env.RESEND_API_KEY) return json(500, { error: 'Email is not configured yet.' });
  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const ref = String(b.reference || '').trim().toUpperCase(), last = norm(b.lastName);
  if (!/^[A-Z0-9]{5,8}$/.test(ref) || !last) return json(400, { error: 'Invalid request.' });
  try {
    const r = await fetch(`https://api.duffel.com/air/orders?booking_reference=${encodeURIComponent(ref)}&limit=10`, {
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', Accept: 'application/json' }
    });
    const j = await r.json();
    const o = r.ok && (j.data || []).find((x) => (x.passengers || []).some((p) => norm(p.family_name) === last));
    if (!o) return json(404, { error: 'We could not find that booking.' });
    const res = await sendConfirmation(env, o);
    if (!res.ok) return json(502, { error: 'We could not send the email right now. Please contact support.' });
    const em = res.to; return json(200, { sent: true, to: em[0] + '***' + em.slice(em.indexOf('@')) });
  } catch (e) { return json(502, { error: 'We could not send the email right now. Please contact support.' }); }
}
export const onRequest = () => json(405, { error: 'Method not allowed.' });
