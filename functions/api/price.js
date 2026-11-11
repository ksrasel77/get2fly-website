// Cloudflare Pages Function: cheapest price for one date (used by the price graph).  URL: /api/price
// One call = one Duffel search. Results are cached for 30 minutes so repeat views cost nothing.
const CABINS = { economy: 'economy', premium: 'premium_economy', 'premium economy': 'premium_economy', premium_economy: 'premium_economy', business: 'business', first: 'first' };
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const token = env.DUFFEL_TOKEN;
  if (!token) return json(500, { error: 'Prices are not configured yet.' });
  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const iata = /^[A-Z]{3}$/, day = /^\d{4}-\d{2}-\d{2}$/;
  const origin = String(b.origin || '').toUpperCase(), dest = String(b.destination || '').toUpperCase();
  if (!iata.test(origin) || !iata.test(dest) || origin === dest || !day.test(b.departureDate || '')) return json(400, { error: 'Invalid request.' });
  const now = new Date(), max = new Date(Date.now() + 360 * 864e5).toISOString().slice(0, 10);
  if (b.departureDate < new Date(now.getTime() - 864e5).toISOString().slice(0, 10) || b.departureDate > max) return json(400, { error: 'Date out of range.' });
  if (b.returnDate && (!day.test(b.returnDate) || b.returnDate <= b.departureDate || b.returnDate > '2100-01-01')) return json(400, { error: 'Invalid return date.' });
  const adults = Math.min(Math.max(parseInt(b.adults, 10) || 1, 1), 9), kids = Math.min(Math.max(parseInt(b.children, 10) || 0, 0), 8);
  const cabin = CABINS[String(b.cabin || 'economy').toLowerCase()] || 'economy';

  let cache = null, key = null;
  try {
    cache = caches.default;
    key = new Request('https://get2fly.com/__cache/price?' + new URLSearchParams({ o: origin, d: dest, dep: b.departureDate, ret: b.returnDate || '', a: adults, k: kids, c: cabin }));
    const hit = await cache.match(key);
    if (hit) return json(200, await hit.json());
  } catch (e) { cache = null; }

  const slices = [{ origin, destination: dest, departure_date: b.departureDate }];
  if (b.returnDate) slices.push({ origin: dest, destination: origin, departure_date: b.returnDate });
  const passengers = [...Array(adults).fill({ type: 'adult' }), ...Array(kids).fill({ age: 8 })];
  try {
    const r = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=8000', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ data: { slices, passengers, cabin_class: cabin } })
    });
    const j = await r.json();
    if (!r.ok) return json(r.status >= 500 ? 502 : 400, { error: 'Price lookup failed.' });
    const offers = (j.data && j.data.offers) || [];
    let best = null;
    for (const o of offers) { const p = parseFloat(o.total_amount); if (!isNaN(p) && (!best || p < best.p)) best = { p, c: o.total_currency }; }
    const out = { price: best ? best.p.toFixed(2) : null, currency: best ? best.c : null };
    if (cache) { try { await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' } })); } catch (e) { /* ignore */ } }
    return json(200, out);
  } catch (e) {
    return json(502, { error: 'Price lookup failed.' });
  }
}
export const onRequest = () => json(405, { error: 'Method not allowed.' });
