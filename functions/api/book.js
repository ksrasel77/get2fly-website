// Completes a checkout: verifies the payment on the server, then books with Duffel. Safe to call repeatedly (it never pays or books twice).  URL: /api/book
// The browser sends ONLY the internal payment id. Amounts, provider ids and traveler details all come from the saved order.
import { guard, json, readJson, run } from '../_lib/http.js';
import { completeCheckout } from '../_lib/checkout.js';
export async function onRequestPost({ request, env }) {
  const bad = guard(request, env); if (bad) return bad;
  return run(async () => {
    const r = await completeCheckout(env, await readJson(request));
    return json(r.status === 'processing' || r.status === 'payment_pending' || r.status === 'needs_review' ? 202 : 200, r);
  }, env);
}
export const onRequest = () => json(405, { error: 'Method not allowed.' });
