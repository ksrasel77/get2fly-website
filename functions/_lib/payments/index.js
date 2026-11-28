// Payment provider registry. To add a provider: write an adapter with the same methods and add it to REGISTRY.
// Adapter methods (all return normalized results; provider-specific names never leave the adapter):
//   configProblem(env, mode) -> string|null     supportsCurrency(cur) -> bool      formatAmount(n, cur) -> string
//   publicConfig(env, mode) -> object (browser-safe only)                          clientPayload(providerPaymentId) -> object
//   createPayment(env, {paymentId, orderRef, amount, currency, formatted}) -> {providerPaymentId} | null
//   confirmPayment(env, {providerPaymentId, paymentId, amount, currency, formatted}) -> {status: paid|pending|failed|cancelled|needs_review|unknown, providerCaptureId?, code?}
//   getPaymentStatus(...) same as confirmPayment but never moves money
//   refundPayment(env, {providerCaptureId, amount, currency, full, idempotencyKey}) -> {status: completed|pending|failed|unknown, providerRefundId?}
//   verifyWebhook(env, {headers, rawBody}) -> {valid, retry?, event?: {providerEventId, type, providerPaymentId?, providerCaptureId?, providerRefundId?, amount?, currency?}}
import { paypal } from './paypal.js';
import { testfree } from './testfree.js';
export const REGISTRY = { paypal, testfree };
export const duffelMode = (env) => (String(env.DUFFEL_TOKEN || '').startsWith('duffel_live_') ? 'live' : 'test');
export const adapterFor = (name, registry = REGISTRY) => registry[String(name || '').toLowerCase()] || null;

// Picks the provider from configuration and refuses unsafe combinations (missing keys, test/live mixing).
export function configuredProvider(env, registry = REGISTRY) {
  const name = String(env.PAYMENT_PROVIDER || 'paypal').toLowerCase();
  const adapter = adapterFor(name, registry);
  if (!adapter) return { error: `unknown payment provider "${name}"` };
  const mode = env.PAYMENT_MODE === 'live' ? 'live' : 'test';
  const problem = adapter.configProblem(env, mode);
  if (problem) return { error: problem, name };
  if (mode !== duffelMode(env)) return { error: `payment mode (${mode}) does not match the Duffel token (${duffelMode(env)})`, name };
  return { provider: { name, mode, ...adapter } };
}
