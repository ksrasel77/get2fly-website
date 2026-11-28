// Duffel (flight supplier) access. Nothing in here knows about payment providers.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, PHONE = /^\+\d{7,15}$/, NAME = /^[A-Za-z][A-Za-z '\-]{0,39}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const hdr = (env, withBody) => ({ Authorization: `Bearer ${env.DUFFEL_TOKEN}`, 'Duffel-Version': 'v2', Accept: 'application/json', ...(withBody ? { 'Content-Type': 'application/json' } : {}) });
const isChild = (x) => x.type === 'child' || (x.age != null && x.age < 18);

// Checks the booking request from the browser and returns a clean copy (or an error message).
export function validateRequest(body) {
  const c = body.contact, ps = body.passengers;
  if (!c || !Array.isArray(ps) || !ps.length || ps.length > 9) return { ok: false, error: 'Missing required booking details.' };
  if (!EMAIL.test(c.email || '') || !PHONE.test(c.phone || '')) return { ok: false, error: 'Please enter a valid email and mobile number.' };
  const passengers = [];
  for (const p of ps) {
    if (!['mr', 'ms', 'mrs', 'miss'].includes(p.title) || !['m', 'f'].includes(p.gender) || !NAME.test(p.firstName || '') || !NAME.test(p.lastName || '') || !DAY.test(p.bornOn || '')) return { ok: false, error: "Please check each traveler's title, name, gender and date of birth." };
    const passport = p.passport && p.passport.number ? { number: String(p.passport.number).slice(0, 20), country: String(p.passport.country || '').toUpperCase().slice(0, 2), expires: p.passport.expires } : null;
    passengers.push({ type: p.type === 'child' ? 'child' : 'adult', title: p.title, gender: p.gender, firstName: p.firstName, lastName: p.lastName, bornOn: p.bornOn, passport });
  }
  return { ok: true, clean: { contact: { email: c.email, phone: c.phone }, passengers } };
}

export async function getOffer(env, offerId) {
  let r;
  try { r = await fetch(`https://api.duffel.com/air/offers/${encodeURIComponent(offerId)}`, { headers: hdr(env) }); } catch (e) { return { outcome: 'unavailable' }; }
  const j = await r.json().catch(() => null);
  if (r.status >= 500 || !j) return { outcome: 'unavailable' };
  if (!r.ok) return { outcome: 'expired' };
  const d = j.data, s0 = (d.slices || [])[0];
  return { outcome: 'ok', offer: {
    id: d.id, total: d.total_amount, currency: d.total_currency, expiresAt: d.expires_at,
    passengers: d.passengers.map((p) => ({ id: p.id, type: isChild(p) ? 'child' : 'adult' })),
    route: s0 ? { from: s0.origin.iata_code, to: s0.destination.iata_code, date: (s0.segments && s0.segments[0] && s0.segments[0].departing_at || '').slice(0, 10) } : null
  } };
}

// Matches our travelers to the passenger slots Duffel created for the offer.
export function mapPassengers(offer, clean) {
  const pool = { adult: offer.passengers.filter((x) => x.type === 'adult'), child: offer.passengers.filter((x) => x.type === 'child') };
  if (pool.adult.length !== clean.passengers.filter((p) => p.type !== 'child').length || pool.child.length !== clean.passengers.filter((p) => p.type === 'child').length) return { ok: false, error: 'The travelers do not match your search. Please search again.' };
  const list = clean.passengers.map((p) => {
    const slot = (p.type === 'child' ? pool.child : pool.adult).shift();
    return { id: slot.id, title: p.title, gender: p.gender, given_name: p.firstName, family_name: p.lastName, born_on: p.bornOn, email: clean.contact.email, phone_number: clean.contact.phone,
      ...(p.passport ? { identity_documents: [{ type: 'passport', unique_identifier: p.passport.number, issuing_country_code: p.passport.country, expires_on: p.passport.expires }] } : {}) };
  });
  return { ok: true, list };
}

// outcome: confirmed (order exists) | rejected (Duffel clearly refused: no order exists) | unknown (timeout, 5xx, lost response: an order MAY exist)
export async function createOrder(env, { offerId, passengers, amount, currency }) {
  let r = null;
  try {
    r = await fetch('https://api.duffel.com/air/orders', { method: 'POST', headers: hdr(env, true), body: JSON.stringify({ data: { selected_offers: [offerId], passengers, payments: [{ type: 'balance', amount, currency }] } }) });
  } catch (e) { return { outcome: 'unknown' }; }
  const j = await r.json().catch(() => null);
  if (!j || r.status >= 500) return { outcome: 'unknown' };
  if (!r.ok) return { outcome: 'rejected', message: j.errors && j.errors[0] && j.errors[0].message ? String(j.errors[0].message).slice(0, 140) : 'The airline could not confirm the booking.' };
  return { outcome: 'confirmed', order: j.data };
}

// After an uncertain result: look for an order Duffel may have created (same family name, price and route, created recently).
export async function findRecentOrder(env, { lastName, amount, currency, route, since }) {
  try {
    const r = await fetch(`https://api.duffel.com/air/orders?passenger_name=${encodeURIComponent(lastName)}&limit=20`, { headers: hdr(env) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { outcome: 'unavailable' };
    const hit = (j.data || []).find((o) => o.total_currency === currency && Number(o.total_amount) === Number(amount) && Date.parse(o.created_at) >= since
      && (!route || (o.slices && o.slices[0] && o.slices[0].origin.iata_code === route.from && o.slices[0].destination.iata_code === route.to)));
    return hit ? { outcome: 'found', order: hit } : { outcome: 'none' };
  } catch (e) { return { outcome: 'unavailable' }; }
}

// A Duffel order is NOT the same as an issued ticket. Only e-ticket documents prove ticketing.
export function ticketState(order) {
  const tickets = (order.documents || []).filter((d) => d.type === 'electronic_ticket');
  const covered = (order.passengers || []).filter((p) => tickets.some((t) => (t.passenger_ids || []).includes(p.id))).length;
  return covered === 0 ? 'pending' : covered === (order.passengers || []).length ? 'issued' : 'partial';
}

// Fetches one order by its Duffel id (used by the admin tools to verify a booking before linking it).
export async function getOrder(env, id) {
  try {
    const r = await fetch(`https://api.duffel.com/air/orders/${encodeURIComponent(id)}`, { headers: hdr(env) });
    const j = await r.json().catch(() => null);
    if (r.status === 404) return { outcome: 'none' };
    if (!r.ok || !j) return { outcome: 'unavailable' };
    return { outcome: 'ok', order: j.data };
  } catch (e) { return { outcome: 'unavailable' }; }
}
