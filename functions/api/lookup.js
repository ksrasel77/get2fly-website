// Cloudflare Pages Function: finds a booking by reference + last name.  URL: /api/lookup
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export async function onRequestPost({ request, env }) {
  const token = env.DUFFEL_TOKEN;
  if (!token) return json(500, { error: 'Booking lookup is not configured yet.' });
  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const ref = String(b.reference || '').trim().toUpperCase(), last = norm(b.lastName);
  if (!/^[A-Z0-9]{5,8}$/.test(ref) || !last) return json(400, { error: 'Please enter your booking reference and last name.' });

  try {
    const r = await fetch(`https://api.duffel.com/air/orders?booking_reference=${encodeURIComponent(ref)}&limit=10`, {
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', Accept: 'application/json' }
    });
    const j = await r.json();
    if (!r.ok) return json(502, { error: 'Booking lookup is temporarily unavailable. Please try again.' });
    const o = (j.data || []).find((x) => (x.passengers || []).some((p) => norm(p.family_name) === last));
    if (!o) return json(404, { error: 'We could not find a booking with those details. Please check your reference and last name.' });

    const docs = o.documents || [];
    const ticketFor = (id) => { const d = docs.find((x) => x.type === 'electronic_ticket' && (x.passenger_ids || []).includes(id)); return d ? d.unique_identifier : null; };
    const passengers = (o.passengers || []).map((p) => ({
      name: [p.given_name, p.family_name].filter(Boolean).join(' '),
      type: p.type === 'child' || (p.age != null && p.age < 12) ? 'child' : 'adult',
      ticket: ticketFor(p.id)
    }));
    const slices = (o.slices || []).map((s) => {
      const g = s.segments || [], a = g[0], z = g[g.length - 1];
      return {
        from: a.origin.iata_code, to: z.destination.iata_code,
        fromCity: a.origin.city_name || a.origin.name, toCity: z.destination.city_name || z.destination.name,
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
    const em = ((o.passengers || [])[0] || {}).email || '';
    return json(200, {
      orderId: o.id, reference: o.booking_reference, airline: (o.owner || {}).name, airlineCode: (o.owner || {}).iata_code,
      liveMode: !!o.live_mode, cancelled: !!o.cancelled_at, createdAt: o.created_at,
      total: { amount: o.total_amount, currency: o.total_currency }, refundable: rf ? !!rf.allowed : null,
      email: em ? em[0] + '***' + em.slice(em.indexOf('@')) : '', passengers, slices, baggage: bag
    });
  } catch (e) {
    return json(502, { error: 'Booking lookup is temporarily unavailable. Please try again.' });
  }
}

export const onRequest = () => json(405, { error: 'Method not allowed.' });
