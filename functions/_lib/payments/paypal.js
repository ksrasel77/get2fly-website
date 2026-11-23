// PayPal adapter. All PayPal-specific URLs, ids and status names stay in this file.
const host = (env) => (env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
const CURRENCIES = ['AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD'];
const formatAmount = (n, cur) => (['JPY', 'HUF', 'TWD'].includes(cur) ? String(Math.round(n)) : (Math.round(n * 100) / 100).toFixed(2));
const enc = encodeURIComponent;

async function call(env, path, method, body, requestId) {
  try {
    const t = await fetch(host(env) + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    const tj = await t.json().catch(() => ({}));
    if (!t.ok || !tj.access_token) return { ok: false, status: t.status || 0, data: {}, unreachable: t.status >= 500 };
    const r = await fetch(host(env) + path, { method: method || 'GET', headers: { Authorization: 'Bearer ' + tj.access_token, 'Content-Type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch (e) { return { ok: false, status: 0, data: {}, unreachable: true }; }
}
const unknown = (r) => r.unreachable || r.status >= 500 || r.status === 0;

// Looks at the PayPal order and (optionally) captures it. Returns a NORMALIZED result.
async function inspect(env, a, doCapture) {
  const got = await call(env, `/v2/checkout/orders/${enc(a.providerPaymentId)}`);
  if (unknown(got)) return { status: 'unknown' };
  if (!got.ok) return { status: 'failed', code: 'order_not_found' };
  const o = got.data, unit = o.purchase_units && o.purchase_units[0];
  if (!unit || unit.custom_id !== a.paymentId) return { status: 'failed', code: 'reference_mismatch' };
  if (!unit.amount || unit.amount.value !== a.formatted || unit.amount.currency_code !== a.currency) return { status: 'failed', code: 'amount_mismatch' };
  const check = (c) => {
    if (!c.amount || c.amount.value !== a.formatted || c.amount.currency_code !== a.currency) return { status: 'needs_review', code: 'captured_amount_mismatch', providerCaptureId: c.id };
    if (c.status === 'COMPLETED') return { status: 'paid', providerCaptureId: c.id };
    if (c.status === 'PENDING') return { status: 'pending', providerCaptureId: c.id };
    return { status: 'failed', code: 'capture_' + String(c.status).toLowerCase() };
  };
  const caps = (unit.payments && unit.payments.captures) || [];
  const existing = caps.find((c) => c.status === 'COMPLETED') || caps[0];
  if (existing) return check(existing);                       // already captured: report it, never capture twice
  if (o.status === 'VOIDED') return { status: 'cancelled' };
  if (o.status !== 'APPROVED') return { status: 'pending', code: 'not_approved' };
  if (!doCapture) return { status: 'pending', code: 'approved_not_captured' };
  const cap = await call(env, `/v2/checkout/orders/${enc(a.providerPaymentId)}/capture`, 'POST', {}, 'capture-' + a.paymentId);
  if (unknown(cap)) return { status: 'unknown' };
  if (!cap.ok) {
    const text = JSON.stringify(cap.data);
    if (text.includes('ORDER_ALREADY_CAPTURED')) return inspect(env, a, false);
    return { status: 'failed', code: text.includes('INSTRUMENT_DECLINED') ? 'declined' : 'rejected' };
  }
  const c = cap.data.purchase_units && cap.data.purchase_units[0] && cap.data.purchase_units[0].payments && cap.data.purchase_units[0].payments.captures && cap.data.purchase_units[0].payments.captures[0];
  return c ? check(c) : { status: 'unknown' };
}

function normalizeWebhook(ev) {
  const r = ev.resource || {}, base = { providerEventId: ev.id, providerType: ev.event_type };
  const orderId = r.supplementary_data && r.supplementary_data.related_ids && r.supplementary_data.related_ids.order_id;
  const up = (r.links || []).find((l) => l.rel === 'up');
  switch (ev.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED': return { ...base, type: 'payment.paid', providerCaptureId: r.id, providerPaymentId: orderId, amount: r.amount && r.amount.value, currency: r.amount && r.amount.currency_code };
    case 'PAYMENT.CAPTURE.PENDING': return { ...base, type: 'payment.pending', providerCaptureId: r.id, providerPaymentId: orderId };
    case 'PAYMENT.CAPTURE.DENIED': return { ...base, type: 'payment.failed', providerCaptureId: r.id, providerPaymentId: orderId };
    case 'PAYMENT.CAPTURE.REFUNDED': return { ...base, type: 'refund.completed', providerRefundId: r.id, providerCaptureId: up && up.href.split('/').pop(), amount: r.amount && r.amount.value, currency: r.amount && r.amount.currency_code };
    case 'PAYMENT.CAPTURE.REVERSED': return { ...base, type: 'payment.reversed', providerCaptureId: r.id };
    case 'CUSTOMER.DISPUTE.CREATED': return { ...base, type: 'payment.disputed', providerCaptureId: r.disputed_transactions && r.disputed_transactions[0] && r.disputed_transactions[0].seller_transaction_id };
    default: return { ...base, type: 'ignored' };
  }
}

export const paypal = {
  id: 'paypal',
  label: 'PayPal',
  capabilities: { authorizeCapture: true, partialRefund: true, webhooks: true, flow: 'paypal-buttons' },
  configProblem(env, mode) {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) return 'PayPal credentials are missing';
    if ((mode === 'live') !== (env.PAYPAL_ENV === 'live')) return 'PayPal environment does not match the payment mode';
    return null;
  },
  supportsCurrency: (c) => CURRENCIES.includes(c),
  formatAmount,
  publicConfig: (env, mode) => ({ flow: 'paypal-buttons', clientId: env.PAYPAL_CLIENT_ID, sdkEnv: mode === 'live' ? 'live' : 'sandbox' }),
  clientPayload: (providerPaymentId) => ({ orderId: providerPaymentId }),
  async createPayment(env, a) {
    const res = await call(env, '/v2/checkout/orders', 'POST', { intent: 'CAPTURE', purchase_units: [{ custom_id: a.paymentId, description: 'Get2Fly flight booking ' + a.orderRef, amount: { currency_code: a.currency, value: a.formatted } }] }, 'create-' + a.paymentId);
    return res.ok && res.data.id ? { providerPaymentId: res.data.id } : null;
  },
  confirmPayment: (env, a) => inspect(env, a, true),      // verify the order and capture it (once)
  getPaymentStatus: (env, a) => inspect(env, a, false),   // read-only check used by reconciliation
  async refundPayment(env, a) {
    const body = a.full ? {} : { amount: { value: formatAmount(a.amount, a.currency), currency_code: a.currency } };
    const res = await call(env, `/v2/payments/captures/${enc(a.providerCaptureId)}/refund`, 'POST', body, a.idempotencyKey);
    if (unknown(res)) return { status: 'unknown' };
    if (!res.ok) return { status: 'failed', code: 'refund_rejected' };
    const s = res.data.status;
    return { status: s === 'COMPLETED' ? 'completed' : s === 'PENDING' ? 'pending' : 'failed', providerRefundId: res.data.id };
  },
  async verifyWebhook(env, { headers, rawBody }) {
    if (!env.PAYPAL_WEBHOOK_ID) return { valid: false };
    let ev; try { ev = JSON.parse(rawBody); } catch (e) { return { valid: false }; }
    const h = (k) => headers[k] || headers[k.toLowerCase()];
    const res = await call(env, '/v1/notifications/verify-webhook-signature', 'POST', {
      auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: ev
    });
    if (unknown(res)) return { valid: false, retry: true };
    return res.ok && res.data.verification_status === 'SUCCESS' ? { valid: true, event: normalizeWebhook(ev) } : { valid: false };
  }
};
