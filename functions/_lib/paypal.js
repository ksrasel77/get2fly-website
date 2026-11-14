// PayPal helpers. Secrets (set in Cloudflare): PAYPAL_CLIENT_ID, PAYPAL_SECRET. Optional: PAYPAL_ENV = "live" (default is the sandbox).
const host = (env) => (env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
export const paypalReady = (env) => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET);
export const PP_CURRENCIES = ['AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD'];
export const money = (n, cur) => (['JPY', 'HUF', 'TWD'].includes(cur) ? String(Math.round(n)) : (Math.round(n * 100) / 100).toFixed(2));

async function accessToken(env) {
  const r = await fetch(host(env) + '/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials'
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('PayPal sign-in failed');
  return j.access_token;
}
export async function pp(env, path, method, body, requestId) {
  const t = await accessToken(env);
  const r = await fetch(host(env) + path, {
    method: method || 'GET', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, body: body ? JSON.stringify(body) : undefined
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
