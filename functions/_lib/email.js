// Builds and sends the booking confirmation email through Resend.
// Needs the RESEND_API_KEY secret. Optional: EMAIL_FROM (default "Get2Fly <bookings@get2fly.com>").
const SITE = 'https://get2fly.com', PHONE = '+973 3757 6600', SUPPORT = 'support@get2fly.com';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y} · ${iso.slice(11, 16)}`; };
const dur = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(d || ''); return m ? `${m[1] || 0}h ${m[2] || 0}m` : ''; };

export function buildEmail(order) {
  const ref = order.booking_reference || '';
  const pax = order.passengers || [], docs = order.documents || [];
  const test = !order.live_mode;
  const slices = (order.slices || []).map((s) => {
    const g = s.segments || [], a = g[0], z = g[g.length - 1];
    return {
      from: a.origin.iata_code, to: z.destination.iata_code, fromName: a.origin.city_name || a.origin.name, toName: z.destination.city_name || z.destination.name,
      dep: a.departing_at, arr: z.arriving_at, duration: dur(s.duration), stops: g.length - 1,
      via: g.slice(0, -1).map((x) => x.destination.iata_code).join(', '),
      flights: g.map((x) => ((x.marketing_carrier || {}).iata_code || '') + x.marketing_carrier_flight_number).join(', ')
    };
  });
  const p0 = ((((order.slices || [])[0] || {}).segments || [])[0] || {}).passengers;
  const bag = { checked: 0, carryOn: 0 };
  ((p0 && p0[0] && p0[0].baggages) || []).forEach((x) => { if (x.type === 'checked') bag.checked += x.quantity; if (x.type === 'carry_on') bag.carryOn += x.quantity; });
  const rf = order.conditions && order.conditions.refund_before_departure;
  const ticket = (id) => { const d = docs.find((x) => x.type === 'electronic_ticket' && (x.passenger_ids || []).includes(id)); return d ? d.unique_identifier : ''; };
  const airline = (order.owner || {}).name || 'the airline';
  const total = `${order.total_currency} ${order.total_amount}`;
  const first = pax[0] ? pax[0].given_name : 'traveler';
  const manage = `${SITE}/?manage=${encodeURIComponent(ref)}`;
  const route = slices.length ? `${slices[0].from} → ${slices[0].to}` : '';
  const subject = `${test ? '[TEST] ' : ''}Your Get2Fly booking ${ref}: ${route}`;
  const cell = 'padding:6px 0;font-size:14px;border-bottom:1px solid #e2e8f0';

  const flightHtml = slices.map((s, i) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px">
    <div style="font-size:12px;color:#64748b;font-weight:bold">${slices.length > 1 ? (i ? 'RETURN' : 'OUTBOUND') : 'FLIGHT'} · ${esc(airline)} · ${esc(s.flights)}</div>
    <div style="font-size:16px;font-weight:bold;margin:6px 0">${esc(s.fromName)} (${esc(s.from)}) → ${esc(s.toName)} (${esc(s.to)})</div>
    <div style="font-size:14px">Departs ${esc(when(s.dep))}<br>Arrives ${esc(when(s.arr))}</div>
    <div style="font-size:13px;color:#64748b;margin-top:4px">${esc(s.duration)} · ${s.stops ? s.stops + ' stop' + (s.stops > 1 ? 's' : '') + (s.via ? ' via ' + esc(s.via) : '') : 'Direct'}</div></div>`).join('');
  const paxHtml = pax.map((p) => `<tr><td style="${cell}"><b>${esc(p.given_name)} ${esc(p.family_name)}</b></td><td style="${cell};text-align:right;color:#475569">${ticket(p.id) ? 'E-ticket ' + esc(ticket(p.id)) : 'E-ticket number pending'}</td></tr>`).join('');

  const html = `<div style="background:#f1f5f9;padding:20px 8px;font-family:Arial,Helvetica,sans-serif;color:#0B2545">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B2545;padding:20px 24px;color:#ffffff;font-size:24px;font-weight:bold">get<span style="color:#FF8A00">2</span>fly<span style="font-size:13px;font-weight:normal;opacity:.8">.com</span></td></tr>
${test ? '<tr><td style="background:#fff7ed;color:#9a3412;padding:10px 24px;font-size:13px"><b>Test booking.</b> No real ticket was issued and nothing was charged.</td></tr>' : ''}
<tr><td style="padding:24px">
<h1 style="font-size:22px;margin:0 0 6px">Your booking is confirmed</h1>
<p style="margin:0 0 16px;color:#475569;font-size:14px">Thank you for booking with Get2Fly, ${esc(first)}. Please keep this email for your trip.</p>
<div style="text-align:center;border:2px dashed #cbd5e1;border-radius:12px;padding:12px;margin-bottom:18px"><div style="font-size:12px;color:#64748b">BOOKING REFERENCE</div><div style="font-size:30px;font-weight:bold;letter-spacing:4px">${esc(ref)}</div></div>
${flightHtml}
<h3 style="font-size:15px;margin:18px 0 6px">Travelers</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${paxHtml}</table>
<h3 style="font-size:15px;margin:18px 0 6px">Baggage and fare</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="${cell}">Checked baggage</td><td style="${cell};text-align:right">${bag.checked ? bag.checked + ' included' : 'Not included'}</td></tr>
<tr><td style="${cell}">Cabin baggage</td><td style="${cell};text-align:right">${bag.carryOn ? bag.carryOn + ' included' : 'Check with the airline'}</td></tr>
<tr><td style="${cell}">Refund rules</td><td style="${cell};text-align:right">${rf ? (rf.allowed ? 'Refundable' : 'Non-refundable') : 'See fare rules'}</td></tr>
<tr><td style="${cell}"><b>Total</b></td><td style="${cell};text-align:right"><b>${esc(total)}</b></td></tr></table>
<p style="font-size:12px;color:#64748b">Baggage weight limits are set by the airline. Please check the airline's rules before you travel.</p>
<div style="text-align:center;margin:22px 0"><a href="${esc(manage)}" style="background:#FF8A00;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:30px;display:inline-block">Manage my booking</a></div>
<p style="font-size:13px;color:#475569">Online check-in is done on ${esc(airline)}'s website, usually 24 to 48 hours before departure. Use your booking reference <b>${esc(ref)}</b>.</p>
<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-top:16px;font-size:13px"><b>Need help? We are here 24/7.</b><br>WhatsApp or call ${PHONE}<br>Email ${SUPPORT}</div>
</td></tr>
<tr><td style="background:#f8fafc;padding:14px 24px;font-size:12px;color:#64748b;text-align:center"><a href="${SITE}/terms.html" style="color:#64748b">Terms</a> · <a href="${SITE}/privacy.html" style="color:#64748b">Privacy</a> · <a href="${SITE}/refund.html" style="color:#64748b">Refund Policy</a><br>© Get2Fly</td></tr>
</table></div>`;

  const text = [`${test ? '[TEST BOOKING] ' : ''}Your Get2Fly booking is confirmed`, `Booking reference: ${ref}`, '',
    ...slices.map((s, i) => `${slices.length > 1 ? (i ? 'Return' : 'Outbound') : 'Flight'}: ${s.fromName} (${s.from}) to ${s.toName} (${s.to})\n  Departs ${when(s.dep)}\n  Arrives ${when(s.arr)}\n  ${airline} ${s.flights}, ${s.duration}, ${s.stops ? s.stops + ' stop(s)' : 'direct'}`), '',
    'Travelers:', ...pax.map((p) => `  ${p.given_name} ${p.family_name}${ticket(p.id) ? ' - E-ticket ' + ticket(p.id) : ''}`), '',
    `Checked baggage: ${bag.checked ? bag.checked + ' included' : 'not included'}`, `Total: ${total}`, '',
    `Manage your booking: ${manage}`, `Support 24/7: ${PHONE} or ${SUPPORT}`].join('\n');
  return { subject, html, text };
}

export async function sendConfirmation(env, order) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'not configured' };
  const to = ((order.passengers || []).find((p) => p.email) || {}).email;
  if (!to) return { ok: false, reason: 'no email' };
  try {
    const m = buildEmail(order);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM || 'Get2Fly <bookings@get2fly.com>', to: [to], reply_to: SUPPORT, subject: m.subject, html: m.html, text: m.text })
    });
    return { ok: r.ok, status: r.status, to };
  } catch (e) { return { ok: false, reason: 'network' }; }
}
