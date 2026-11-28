// Public (browser-safe) payment settings.  URL: /api/pay-config
import { configuredProvider } from '../_lib/payments/index.js';
import { feeConfig } from '../_lib/pricing.js';
import { ledgerReady } from '../_lib/ledger.js';
import { json } from '../_lib/http.js';
export async function onRequest({ env }) {
  const cfg = configuredProvider(env);
  const ready = !!cfg.provider && ledgerReady(env);
  return json(200, { provider: ready ? { name: cfg.provider.name, mode: cfg.provider.mode, label: cfg.provider.label, ...cfg.provider.publicConfig(env, cfg.provider.mode) } : null, fee: feeConfig(env) });
}
