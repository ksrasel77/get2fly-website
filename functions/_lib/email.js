// Builds and sends the booking confirmation email (with the PDF e-ticket attached) through Resend.
// Needs the RESEND_API_KEY secret. Optional: EMAIL_FROM (default "Get2Fly <bookings@get2fly.com>").
import { COMPANY, when, normalize } from './itinerary.js';
import { buildPdf } from './pdf.js';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };

export function buildEmail(order, paid) {
  const n = normalize(order, paid);
  const first = (n.passengers[0] || {}).name || 'traveler';
  const manage = `${COMPANY.site}/?manage=${encodeURIComponent(n.ref)}`;
  const subject = `${n.test ? '[TEST] ' : ''}Details of your ${n.routeText} flight with PNR ${n.ref}`;
  const hr = '<div style="border-top:1px solid #e2e8f0;margin:16px 0"></div>';
  const lbl = 'font-size:12px;font-weight:bold;color:#64748b;margin:12px 0 2px';
  const flights = n.slices.map((s, si) => `<h3 style="font-size:16px;margin:24px 0 8px;color:#0B2545">&#9992; ${n.slices.length > 1 ? (si ? 'Return' : 'Departure') : 'Departure'} Flight Information</h3>` + s.segments.map((g) => `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:6px">
      <div style="font-size:15px;font-weight:bold">${esc(g.airline)}</div>
      <div style="font-size:14px;color:#475569">${esc(g.from)} &rsaquo; ${esc(g.to)} &nbsp; ${esc(g.flight)}${g.cabin ? ' &nbsp; Class: ' + esc(g.cabin) : ''}</div>
      <div style="${lbl}">Departure</div><div style="font-size:14px">${esc(when(g.dep))} - ${esc(g.fromCity)} (${esc(g.fromAirport)}${g.fromTerminal ? ' - Terminal ' + esc(g.fromTerminal) : ''})</div>
      <div style="${lbl}">Arrival</div><div style="font-size:14px">${esc(when(g.arr))} - ${esc(g.toCity)} (${esc(g.toAirport)}${g.toTerminal ? ' - Terminal ' + esc(g.toTerminal) : ''})</div>
      <div style="${lbl}">Total Flight Time</div><div style="font-size:14px">${esc(g.duration)}</div>
      <div style="${lbl}">Baggage Allowance</div><div style="font-size:14px">${g.bag.carryOn ? g.bag.carryOn + ' cabin bag included' : 'Cabin bag: check with the airline'}<br>${g.bag.checked ? g.bag.checked + ' checked bag' + (g.bag.checked > 1 ? 's' : '') + ' included' : 'No checked bag included'}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px">Baggage weight limits are set by the airline. You may be charged extra for overweight or additional bags.</div>
      <div style="${lbl}">PNR (Booking Reference Number)</div><div style="font-size:14px">${esc(n.ref)}</div>
      <div style="${lbl}">Status</div><div><span style="background:${n.ticketed ? '#22c55e' : '#f59e0b'};color:#fff;font-size:12px;font-weight:bold;padding:2px 8px;border-radius:4px">${n.ticketed ? 'Ticketed' : 'Confirmed'}</span></div>
    </div>${g.layover ? `<div style="text-align:center;font-size:13px;color:#9a3412;margin:8px 0">&#9201; Stop: ${esc(g.layover)} layover</div>` : ''}`).join('')).join('');
  const travelers = n.passengers.map((p) => `<div style="margin-bottom:12px"><div style="${lbl}">Traveler Name</div><div style="font-size:14px">${esc(p.name)}</div>
    <div style="${lbl}">PNR (Booking Reference Number)</div><div style="font-size:14px">${esc(n.ref)}</div>
    <div style="${lbl}">Ticket Number</div><div style="font-size:14px;font-weight:bold;color:${p.tickets.length ? '#2196F3' : '#9a3412'}">${p.tickets.length ? esc(p.tickets.join(', ')) : 'Pending: the airline has not issued it yet. You can request this email again later from Manage My Booking.'}</div></div>`).join('');

  const html = `<div style="background:#f1f5f9;padding:20px 8px;font-family:Arial,Helvetica,sans-serif;color:#0B2545">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B2545;padding:24px;text-align:center;color:#ffffff;font-size:28px;font-weight:bold">get<span style="color:#FF8A00">2</span>fly<span style="font-size:14px;font-weight:normal;opacity:.8">.com</span></td></tr>
${n.test ? '<tr><td style="background:#fff7ed;color:#9a3412;padding:10px 24px;font-size:13px"><b>Test booking.</b> No real ticket was issued and nothing was charged.</td></tr>' : ''}
<tr><td style="padding:24px">
<h1 style="font-size:22px;line-height:1.35;margin:0 0 12px;font-weight:normal;color:#334155">Dear <b>${esc(first)}</b>, you have successfully booked your flight!</h1>
<p style="margin:0 0 8px;font-size:14px;color:#475569">You can view the flight information for your trip below and in the attached PDF e-ticket document.</p>
${hr}<div style="font-size:15px">PNR code for your flight: <b style="color:#2196F3;letter-spacing:2px">${esc(n.ref)}</b></div>${hr}
<p style="font-size:14px;color:#475569;line-height:1.6">We would like to remind you to have your <b>PNR code</b> and <b>ID${n.international ? ' (passport for international flights)' : ''}</b> with you to avoid any problems. You should be at the airport at least <b>${n.international ? '3' : '2'} hours</b> before your flight.</p>
<div style="text-align:center;margin:20px 0"><a href="${esc(manage)}" style="background:#FF8A00;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:30px;display:inline-block">Manage my booking</a></div>
<p style="font-size:14px;color:#475569">Online check-in is done on ${esc(n.airline)}'s website, usually 24 to 48 hours before departure. Have a nice flight!<br><b style="color:#2196F3">Get2Fly</b> <b>Team</b></p>
<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-top:16px"><div style="color:#d97706;font-weight:bold;font-size:14px;margin-bottom:6px">&#9432; Please Note</div>
<div style="font-size:13px;color:#475569;line-height:1.6">- You may need a transit visa for an international connecting flight. We strongly recommend checking each country's transit visa requirements on its official consular website before your flight.<br><br>- You need to complete the airport check-in procedures at least 60 minutes before departure, or earlier if your airline requires it.</div></div>
${flights}
<h3 style="font-size:16px;margin:24px 0 8px;color:#0B2545">&#128100; Traveler Information</h3><div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px">${travelers}</div>
<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-top:20px;font-size:13px"><b>Need help? We are here 24/7.</b><br>WhatsApp or call ${esc(COMPANY.phone)}<br>Email ${esc(COMPANY.email)}</div>
</td></tr>
<tr><td style="background:#f8fafc;padding:16px 24px;font-size:12px;color:#64748b;text-align:center;line-height:1.7">${esc(COMPANY.name)}, ${esc(COMPANY.address)}<br>${esc(COMPANY.phone)} | ${esc(COMPANY.email)}<br><a href="${COMPANY.site}/terms.html" style="color:#64748b">Terms</a> · <a href="${COMPANY.site}/privacy.html" style="color:#64748b">Privacy</a> · <a href="${COMPANY.site}/refund.html" style="color:#64748b">Refund Policy</a><br>&copy; 2026 ${esc(COMPANY.name)}. All rights reserved.</td></tr>
</table></div>`;

  const text = [`${n.test ? '[TEST BOOKING] ' : ''}Dear ${first}, you have successfully booked your flight!`, `PNR code: ${n.ref}`, 'Your e-ticket PDF is attached.', '',
    ...n.slices.flatMap((s, i) => s.segments.map((g) => `${i ? 'Return' : 'Departure'}: ${g.airline} ${g.flight}, ${g.fromCity} (${g.from}) to ${g.toCity} (${g.to})\n  Departs ${when(g.dep)}\n  Arrives ${when(g.arr)}${g.layover ? '\n  Layover after this flight: ' + g.layover : ''}`)), '',
    'Travelers:', ...n.passengers.map((p) => `  ${p.name} - ticket number: ${p.tickets.length ? p.tickets.join(', ') : 'pending'}`), '',
    `Please carry your PNR and ID. Be at the airport at least ${n.international ? 3 : 2} hours before your flight.`, `Manage your booking: ${manage}`, `Support 24/7: ${COMPANY.phone} or ${COMPANY.email}`, `${COMPANY.name}, ${COMPANY.address}`].join('\n');
  return { subject, html, text, ref: n.ref };
}

export async function sendConfirmation(env, order, paid) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'not configured' };
  const to = ((order.passengers || []).find((p) => p.email) || {}).email;
  if (!to) return { ok: false, reason: 'no email' };
  try {
    const m = buildEmail(order, paid);
    const body = { from: env.EMAIL_FROM || 'Get2Fly <bookings@get2fly.com>', to: [to], reply_to: COMPANY.email, subject: m.subject, html: m.html, text: m.text };
    try { body.attachments = [{ filename: `Get2Fly_E-ticket_${m.ref}.pdf`, content: b64(buildPdf(order, paid)) }]; } catch (e) { /* send the email even if the PDF fails */ }
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, to, attached: !!body.attachments };
  } catch (e) { return { ok: false, reason: 'network' }; }
}
