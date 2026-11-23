// Starts a checkout: validates the flight and travelers, saves the order and payment in the ledger, then asks the provider for a payment.  URL: /api/pay-create
import { guard, json, readJson, run } from '../_lib/http.js';
import { startCheckout } from '../_lib/checkout.js';
export async function onRequestPost({ request, env }) {
  const bad = guard(request, env); if (bad) return bad;
  return run(async () => json(200, await startCheckout(env, await readJson(request))));
}
export const onRequest = () => json(405, { error: 'Method not allowed.' });
