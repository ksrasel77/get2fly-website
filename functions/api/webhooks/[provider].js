// Payment provider webhooks.  URL: /api/webhooks/paypal  (or the name of any other provider adapter)
// Each adapter verifies its own signature. Unsigned or invalid events are rejected. Duplicate events are ignored.
import { adapterFor, configuredProvider } from '../../_lib/payments/index.js';
import { applyWebhookEvent } from '../../_lib/checkout.js';
import { LedgerError } from '../../_lib/ledger.js';
import { json } from '../../_lib/http.js';
export async function onRequestPost({ request, env, params }) {
  const name = String(params.provider || '').toLowerCase(), adapter = adapterFor(name);
  if (!adapter || !adapter.capabilities.webhooks) return json(404, { error: 'Not found.' });
  const cfg = configuredProvider({ ...env, PAYMENT_PROVIDER: name });
  if (!cfg.provider) return json(503, { error: 'Not configured.' });
  const rawBody = await request.text();
  if (rawBody.length > 200000) return json(413, { error: 'Too large.' });
  const v = await adapter.verifyWebhook(env, { headers: Object.fromEntries(request.headers), rawBody });
  if (!v.valid) return json(v.retry ? 503 : 400, { error: 'Webhook could not be verified.' });
  try { return json(200, { ok: true, ...(await applyWebhookEvent(env, name, v.event)) }); }
  catch (e) {
    console.error(JSON.stringify({ app: 'get2fly', event: 'webhook_failed', provider: name, code: e instanceof LedgerError ? e.code : 'error' }));
    return json(503, { error: 'Please retry.' });                // a non-200 makes the provider send the event again
  }
}
export const onRequest = () => json(405, { error: 'Method not allowed.' });
