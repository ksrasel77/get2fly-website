// Public payment settings for the website (no secrets).  URL: /api/pay-config
import { paypalReady } from '../_lib/paypal.js';
import { feeConfig } from '../_lib/pricing.js';
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export async function onRequest({ env }) {
  return json(200, { paypal: paypalReady(env) ? { clientId: env.PAYPAL_CLIENT_ID, env: env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox' } : null, fee: feeConfig(env) });
}
