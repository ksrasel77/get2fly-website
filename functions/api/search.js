// Cloudflare Pages Function: searches flights through Duffel.  URL: /api/search
// The Duffel token lives only in the DUFFEL_TOKEN secret (never in the website code).
const CABINS = { economy: 'economy', premium: 'premium_economy', 'premium economy': 'premium_economy', premium_economy: 'premium_economy', business: 'business', first: 'first' };
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const token = env.DUFFEL_TOKEN;
  if (!token) return json(500, { error: 'Search is not configured yet.' });

  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }

  const iata = /^[A-Z]{3}$/, day = /^\d{4}-\d{2}-\d{2}$/;
  const origin = String(b.origin || '').toUpperCase();
  const dest = String(b.destination || '').toUpperCase();
  if (!iata.test(origin) || !iata.test(dest) || origin === dest) return json(400, { error: 'Please choose two different airports.' });
  if (!day.test(b.departureDate || '')) return json(400, { error: 'Please choose a departure date.' });
  if (b.returnDate && (!day.test(b.returnDate) || b.returnDate < b.departureDate)) return json(400, { error: 'The return date must be after the departure date.' });

  const adults = Math.min(Math.max(parseInt(b.adults, 10) || 1, 1), 9);
  const kids = Math.min(Math.max(parseInt(b.children, 10) || 0, 0), 8);
  const cabin = CABINS[String(b.cabin || 'economy').toLowerCase()] || 'economy';

  const slices = [{ origin, destination: dest, departure_date: b.departureDate }];
  if (b.returnDate) slices.push({ origin: dest, destination: origin, departure_date: b.returnDate });
  // Children are searched as age 8 until real passenger ages are collected at checkout.
  const passengers = [...Array(adults).fill({ type: 'adult' }), ...Array(kids).fill({ age: 8 })];

  try {
    const r = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=12000', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ data: { slices, passengers, cabin_class: cabin } })
    });
    const j = await r.json();
    if (!r.ok) {
      const m = j && j.errors && j.errors[0] && j.errors[0].message;
      return json(r.status >= 500 ? 502 : 400, { error: (m ? String(m).slice(0, 140) : 'Search failed. Please try again.') });
    }
    const d = j.data || {};
    const offers = (d.offers || [])
      .sort((a, c) => parseFloat(a.total_amount) - parseFloat(c.total_amount))
      .slice(0, 40)
      .map((o) => {
        const sl = (o.slices || []).map((s) => {
          const g = s.segments || [], a = g[0], z = g[g.length - 1];
          return {
            from: a.origin.iata_code, to: z.destination.iata_code,
            dep: a.departing_at, arr: z.arriving_at, duration: s.duration, stops: g.length - 1,
            via: g.slice(0, -1).map((x) => x.destination.iata_code),
            flights: g.map((x) => ((x.marketing_carrier || {}).iata_code || '') + x.marketing_carrier_flight_number).join(', ')
          };
        });
        const p0 = (((o.slices || [])[0] || {}).segments || [])[0];
        const pax = (p0 && p0.passengers && p0.passengers[0]) || {};
        const bag = { checked: 0, carryOn: 0 };
        (pax.baggages || []).forEach((x) => { if (x.type === 'checked') bag.checked += x.quantity; if (x.type === 'carry_on') bag.carryOn += x.quantity; });
        const rf = o.conditions && o.conditions.refund_before_departure;
        return {
          id: o.id, price: o.total_amount, currency: o.total_currency,
          airline: (o.owner || {}).name, code: (o.owner || {}).iata_code, logo: (o.owner || {}).logo_symbol_url || null,
          cabin: pax.cabin_class_marketing_name || null, baggage: bag,
          refundable: rf ? !!rf.allowed : null, docsRequired: !!o.passenger_identity_documents_required, expires: o.expires_at, slices: sl
        };
      });
    return json(200, { liveMode: !!d.live_mode, requestId: d.id, offers });
  } catch (e) {
    return json(502, { error: 'Search is temporarily unavailable. Please try again.' });
  }
}

export const onRequest = () => json(405, { error: 'Method not allowed.' });
