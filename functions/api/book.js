// Cloudflare Pages Function: creates bookings/orders through Duffel.  URL: /api/book
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const TITLES = ['mr', 'ms', 'mrs', 'miss'];
const NAME = /^[A-Za-z][A-Za-z '\-]{0,39}$/, DAY = /^\d{4}-\d{2}-\d{2}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, PHONE = /^\+\d{7,15}$/;

export async function onRequestPost({ request, env }) {
  const token = env.DUFFEL_TOKEN;
  if (!token) return json(500, { error: 'Booking is not configured yet.' });
  // Safety: a live token must never create orders until customer payment is connected.
  if (token.startsWith('duffel_live_') && env.ALLOW_LIVE_BOOKING !== 'true') {
    return json(503, { error: 'Online booking is not open yet. Please contact us on WhatsApp.' });
  }

  let b;
  try { b = await request.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const { offerId, contact, passengers } = b;
  if (!offerId || typeof offerId !== 'string' || !contact || !Array.isArray(passengers) || !passengers.length || passengers.length > 9) {
    return json(400, { error: 'Missing required booking details.' });
  }
  if (!EMAIL.test(contact.email || '') || !PHONE.test(contact.phone || '')) return json(400, { error: 'Please enter a valid email and mobile number.' });
  for (const p of passengers) {
    if (!TITLES.includes(p.title) || !['m', 'f'].includes(p.gender) || !NAME.test(p.firstName || '') || !NAME.test(p.lastName || '') || !DAY.test(p.bornOn || '')) {
      return json(400, { error: 'Please check each traveler\'s title, name, gender and date of birth.' });
    }
  }

  try {
    // Step 1: fetch the offer to get the passenger ids Duffel expects
    const offerRes = await fetch(`https://api.duffel.com/air/offers/${encodeURIComponent(offerId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', Accept: 'application/json' }
    });
    const offerData = await offerRes.json();
    if (!offerRes.ok) return json(400, { error: 'This fare has expired. Please search again.' });
    const offer = offerData.data;
    const isChild = (x) => x.type === 'child' || (x.age != null && x.age < 18);
    const pool = { adult: offer.passengers.filter((x) => !isChild(x)), child: offer.passengers.filter(isChild) };
    if (pool.adult.length !== passengers.filter((p) => p.type !== 'child').length || pool.child.length !== passengers.filter((p) => p.type === 'child').length) {
      return json(400, { error: 'The travelers do not match your search. Please search again.' });
    }

    // Step 2: create the order
    const orderPassengers = passengers.map((p) => {
      const slot = (p.type === 'child' ? pool.child : pool.adult).shift();
      const doc = p.passport && p.passport.number ? [{
        type: 'passport', unique_identifier: String(p.passport.number).slice(0, 20),
        issuing_country_code: String(p.passport.country || '').toUpperCase(), expires_on: p.passport.expires
      }] : undefined;
      return {
        id: slot.id, title: p.title, gender: p.gender, given_name: p.firstName, family_name: p.lastName,
        born_on: p.bornOn, email: contact.email, phone_number: contact.phone,
        ...(doc ? { identity_documents: doc } : {})
      };
    });
    const orderRes = await fetch('https://api.duffel.com/air/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ data: {
        selected_offers: [offerId], passengers: orderPassengers,
        payments: [{ type: 'balance', amount: offer.total_amount, currency: offer.total_currency }]
      } })
    });
    const orderJson = await orderRes.json();
    if (!orderRes.ok) {
      const msg = orderJson && orderJson.errors && orderJson.errors[0] && orderJson.errors[0].message;
      return json(400, { error: msg ? String(msg).slice(0, 160) : 'Booking creation failed.' });
    }
    const order = orderJson.data || {};
    return json(200, {
      success: true, orderId: order.id, bookingReference: order.booking_reference || 'PENDING',
      totalAmount: order.total_amount, currency: order.total_currency, liveMode: !!order.live_mode
    });
  } catch (e) {
    return json(502, { error: 'Booking service is temporarily unavailable. Please try again.' });
  }
}

export const onRequest = () => json(405, { error: 'Method not allowed.' });
