// Shared helpers: turns a Duffel order into simple data used by the confirmation email and the PDF e-ticket.
export const COMPANY = { name: 'Get2Fly LLC', address: '30 N Gould St, Ste R, Sheridan, WY 82801, USA', phone: '+973 3757 6600', email: 'support@get2fly.com', site: 'https://get2fly.com' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const when = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}, ${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${iso.slice(11, 16)}`; };
export const dur = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(d || ''); return m ? `${m[1] ? m[1] + 'h ' : ''}${m[2] ? m[2] + 'min' : ''}`.trim() || '0min' : ''; };
const mins = (iso) => { const [d, t] = iso.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.slice(0, 5).split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi) / 60000; };
const gap = (a, b) => { const x = mins(b) - mins(a); return `${Math.floor(x / 60) ? Math.floor(x / 60) + 'h ' : ''}${x % 60 ? (x % 60) + 'min' : ''}`.trim() || '0min'; };

export function normalize(order) {
  const docs = (order.documents || []).filter((x) => x.type === 'electronic_ticket');
  const passengers = (order.passengers || []).map((p) => ({
    name: [p.given_name, p.family_name].filter(Boolean).join(' '), type: p.type === 'child' || (p.age != null && p.age < 12) ? 'Child' : 'Adult',
    tickets: docs.filter((d) => (d.passenger_ids || []).includes(p.id)).map((d) => d.unique_identifier)
  }));
  const ticketed = passengers.length > 0 && passengers.every((p) => p.tickets.length);
  let international = false;
  const slices = (order.slices || []).map((s) => ({
    segments: (s.segments || []).map((g, i, arr) => {
      const pax = (g.passengers && g.passengers[0]) || {}, bag = { checked: 0, carryOn: 0 };
      (pax.baggages || []).forEach((x) => { if (x.type === 'checked') bag.checked += x.quantity; if (x.type === 'carry_on') bag.carryOn += x.quantity; });
      if ((g.origin.iata_country_code || '') !== (g.destination.iata_country_code || '')) international = true;
      const mc = g.marketing_carrier || {};
      return {
        airline: mc.name || (order.owner || {}).name || '', flight: (mc.iata_code || '') + g.marketing_carrier_flight_number, cabin: pax.cabin_class_marketing_name || '',
        from: g.origin.iata_code, fromAirport: g.origin.name, fromCity: g.origin.city_name || g.origin.name, fromTerminal: g.origin_terminal || '',
        to: g.destination.iata_code, toAirport: g.destination.name, toCity: g.destination.city_name || g.destination.name, toTerminal: g.destination_terminal || '',
        dep: g.departing_at, arr: g.arriving_at, duration: dur(g.duration), bag,
        layover: arr[i + 1] ? gap(g.arriving_at, arr[i + 1].departing_at) : ''
      };
    })
  }));
  const first = slices[0] && slices[0].segments[0], lastSlice = slices[0] && slices[0].segments;
  const rf = order.conditions && order.conditions.refund_before_departure;
  return {
    ref: order.booking_reference || '', test: !order.live_mode, airline: (order.owner || {}).name || 'the airline', createdAt: order.created_at || '',
    total: `${order.total_currency} ${order.total_amount}`, passengers, slices, ticketed, international,
    refund: rf ? (rf.allowed ? 'Refundable' : 'Non-refundable') : 'See fare rules',
    routeText: first ? `${first.fromCity} - ${(slices[0].segments[lastSlice.length - 1]).toCity}` : ''
  };
}
