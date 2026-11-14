// Creates the PayPal order for one flight offer. The amount is calculated here on the server, never by the browser.  URL: /api/pay-create
import { pp, paypalReady, PP_CURRENCIES, money } from '../_lib/paypal.js';
import { computeFee } from '../_lib/pricing.js';
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  if (!paypalReady(env) || !env.DUFFEL_TOKEN) return json(500, { error: 'Payment is not configured yet.' });
  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  if (!b.offerId || typeof b.offerId !== 'string') return json(400, { error: 'Invalid request.' });
  try {
    const r = await fetch(`https://api.duffel.com/air/offers/${encodeURIComponent(b.offerId)}`, { headers: { Authorization: `Bearer ${env.DUFFEL_TOKEN}`, 'Duffel-Version': 'v2', Accept: 'application/json' } });
    const j = await r.json();
    if (!r.ok) return json(400, { error: 'This fare has expired. Please search again.' });
    const o = j.data, cur = o.total_currency, base = parseFloat(o.total_amount), fee = computeFee(env, base, o.passengers.length);
    if (!PP_CURRENCIES.includes(cur)) return json(400, { error: `PayPal does not support ${cur} for this fare.` });
    const total = money(base + fee, cur);
    const res = await pp(env, '/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: b.offerId.slice(0, 120), description: 'Get2Fly flight booking', amount: { currency_code: cur, value: total } }]
    });
    if (!res.ok || !res.data.id) return json(502, { error: 'We could not start the payment. Please try again.' });
    return json(200, { id: res.data.id, amount: total, currency: cur, fee: money(fee, cur) });
  } catch (e) { return json(502, { error: 'We could not start the payment. Please try again.' }); }
}
export const onRequest = () => json(405, { error: 'Method not allowed.' });
