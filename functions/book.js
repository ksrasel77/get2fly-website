// Netlify Function: creates bookings/orders through Duffel.
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const send = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  if (event.httpMethod !== 'POST') return send(405, { error: 'Method not allowed.' });
  
  const token = process.env.DUFFEL_TOKEN;
  if (!token) return send(500, { error: 'Booking is not configured yet.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return send(400, { error: 'Invalid request.' }); }

  const { offerId, passengerDetails } = b;
  if (!offerId || !passengerDetails) {
    return send(400, { error: 'Missing required booking details.' });
  }

  // Split full name into given name and family name
  const nameParts = (passengerDetails.fullName || 'Traveler Passenger').trim().split(' ');
  const given_name = nameParts[0] || 'Traveler';
  const family_name = nameParts.slice(1).join(' ') || 'Passenger';

  try {
    // Step 1: Fetch offer details to get the exact passenger ID structure required by Duffel
    const offerRes = await fetch(`https://api.duffel.com/air/offers/${offerId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', Accept: 'application/json' }
    });
    const offerData = await offerRes.json();
    if (!offerRes.ok) {
      return send(400, { error: 'Selected flight offer has expired or is invalid.' });
    }

    const originalPassenger = offerData.data.passengers[0] || {};
    const duffelPassengerId = originalPassenger.id;
    const totalAmount = offerData.data.total_amount;
    const totalCurrency = offerData.data.total_currency;

    // Step 2: Create the Order via Duffel API
    const orderRes = await fetch('https://api.duffel.com/air/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        data: {
          selected_offers: [offerId],
          passengers: [
            {
              id: duffelPassengerId,
              given_name: given_name,
              family_name: family_name,
              title: 'mr',
              gender: 'm',
              born_on: passengerDetails.bornOn || '1995-01-01',
              email: passengerDetails.email,
              phone_number: passengerDetails.phone
            }
          ],
          payments: [
            {
              type: 'balance',
              amount: totalAmount,
              currency: totalCurrency
            }
          ]
        }
      })
    });

    const orderJson = await orderRes.json();
    if (!orderRes.ok) {
      const msg = orderJson && orderJson.errors && orderJson.errors[0] && orderJson.errors[0].message;
      return send(400, { error: (msg ? String(msg).slice(0, 140) : 'Booking creation failed.') });
    }

    const order = orderJson.data || {};
    return send(200, {
      success: true,
      orderId: order.id,
      bookingReference: order.booking_reference || 'PENDING',
      totalAmount: order.total_amount,
      currency: order.total_currency
    });

  } catch (e) {
    return send(502, { error: 'Booking service is temporarily unavailable. Please try again.' });
  }
};