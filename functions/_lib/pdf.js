// Minimal PDF writer (no libraries) and the e-ticket layout (page 1: itinerary, page 2: travel conditions).
import { COMPANY, when, normalize } from './itinerary.js';
import { LOGO } from './logo-data.js';
const W = 595.28, H = 841.89, M = 42, NAVY = '#0B2545', BLUE = '#2196F3', ORANGE = '#FF8A00', GRAY = '#64748b', INK = '#1f2937';
// Helvetica character widths (characters 32 to 126), per 1000 units
const HR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const latin = (s) => String(s == null ? '' : s).replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const pesc = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const tw = (s, size, bold) => { let w = 0; for (const ch of latin(s)) { const c = ch.charCodeAt(0); w += ((bold ? HB : HR)[c - 32] || 556) * size / 1000; } return w; };

class Doc {
  constructor(footer) { this.pages = []; this.footer = footer; this.add(); }
  add() { this.ops = []; this.pages.push(this.ops); this.y = H - M; }
  need(h) { if (this.y - h < 78) { this.add(); return true; } return false; }
  rect(x, y, w, h, fill, stroke) { this.ops.push(`${rgb(fill || '#ffffff')} rg ${stroke ? rgb(stroke) + ' RG 0.7 w' : ''} ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re ${fill && stroke ? 'B' : stroke ? 'S' : 'f'}`); }
  hr(y, color, dash) { this.ops.push(`${dash ? '[3 3] 0 d' : '[] 0 d'} ${rgb(color || '#e2e8f0')} RG 0.7 w ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S [] 0 d`); }
  image(x, y, w, h) { this.ops.push(`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} cm /Im1 Do Q`); }
  text(s, x, y, o = {}) { const size = o.size || 10, w = o.right || o.center ? tw(s, size, o.bold) : 0; const px = o.right ? x - w : o.center ? x - w / 2 : x; this.ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${size} Tf ${rgb(o.color || INK)} rg ${px.toFixed(1)} ${y.toFixed(1)} Td (${pesc(s)}) Tj ET`); }
  wrap(s, size, width, bold) { const out = []; let cur = ''; for (const w of String(s).split(' ')) { const t = cur ? cur + ' ' + w : w; if (cur && tw(t, size, bold) > width) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
  para(s, o = {}) { const size = o.size || 10, x = o.x == null ? M : o.x; for (const l of this.wrap(s, size, o.width || (W - M - x), o.bold)) { this.need(size * 1.7); this.text(l, x, this.y, o); this.y -= size * 1.6; } }
  heading(s, min = 60) { this.need(min); this.y -= 6; this.rect(M, this.y - 3, 4, 15, ORANGE); this.text(s, M + 12, this.y, { size: 13, bold: true, color: NAVY }); this.y -= 24; }
  label(s, x, y) { this.text(s.toUpperCase(), x, y, { size: 7.5, bold: true, color: GRAY }); }
  build() {
    const objs = [], add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add('');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const bin = atob(LOGO.data);
    const img = add(`<< /Type /XObject /Subtype /Image /Width ${LOGO.w} /Height ${LOGO.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${LOGO.w} >> /Length ${bin.length} >>\nstream\n${bin}\nendstream`);
    const kids = [];
    this.pages.forEach((ops, i) => {
      const foot = [`${rgb('#e2e8f0')} RG 0.7 w ${M} 56 m ${W - M} 56 l S`];
      const f = (s, x, y, o) => foot.push(`BT /F1 8 Tf ${rgb(GRAY)} rg ${(o ? x - tw(s, 8) : x).toFixed(1)} ${y} Td (${pesc(s)}) Tj ET`);
      f(`${this.footer[0]}`, M, 42); f(this.footer[1], M, 31); f(`Page ${i + 1} of ${this.pages.length}`, W - M, 42, true);
      const body = ops.concat(foot).join('\n');
      const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 ${img} 0 R >> >> /Contents ${c} 0 R >>`) + ' 0 R');
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return u;
  }
}

export function buildPdf(order, paid) {
  const n = normalize(order, paid);
  const d = new Doc([`${COMPANY.name}  |  ${COMPANY.address}`, `${COMPANY.phone}  |  ${COMPANY.email}  |  ${COMPANY.site.replace('https://', '')}`]);
  // Header: logo left, company details right
  const lh = 46, lw = lh * LOGO.w / LOGO.h;
  d.image(M, H - M - lh + 6, lw, lh);
  d.text(COMPANY.name, W - M, H - M, { size: 11, bold: true, color: NAVY, right: true });
  COMPANY.addressLines.concat([COMPANY.phone, COMPANY.email]).forEach((l, i) => d.text(l, W - M, H - M - 13 - i * 11.5, { size: 8.5, color: GRAY, right: true }));
  d.hr(H - M - 62, '#cbd5e1'); d.y = H - M - 92;
  // Title and PNR
  d.text('E-TICKET ITINERARY RECEIPT', M, d.y, { size: 8.5, bold: true, color: BLUE });
  d.text('Your booking is confirmed', M, d.y - 22, { size: 20, bold: true, color: NAVY });
  d.rect(W - M - 150, d.y - 34, 150, 52, NAVY);
  d.text('PNR CODE', W - M - 75, d.y + 6, { size: 7.5, bold: true, color: '#bfdbfe', center: true });
  d.text(n.ref, W - M - 75, d.y - 20, { size: 22, bold: true, color: ORANGE, center: true });
  d.y -= 50;
  d.text(`Issued ${n.createdAt ? n.createdAt.slice(0, 10) : ''}   |   Airline: ${n.airline}   |   ${n.refund}`, M, d.y, { size: 8.5, color: GRAY }); d.y -= 14;
  if (n.test) { d.rect(M, d.y - 8, W - 2 * M, 20, '#fff7ed', '#fed7aa'); d.text('TEST BOOKING: no real ticket was issued and nothing was charged.', M + 10, d.y - 1.5, { size: 9, bold: true, color: '#9a3412' }); d.y -= 26; }

  d.heading('Traveler Details', 120);
  n.passengers.forEach((p) => {
    d.need(70); const top = d.y; d.rect(M, top - 52, W - 2 * M, 60, '#f8fafc', '#e2e8f0');
    d.text(`${p.name}  (${p.type})`, M + 12, top - 8, { size: 12, bold: true, color: NAVY });
    d.label('Ticket number', M + 12, top - 26); d.text(p.tickets.length ? p.tickets.join(', ') : 'Pending: not issued yet', M + 12, top - 40, { size: 10.5, bold: true, color: p.tickets.length ? '#166534' : '#9a3412' });
    d.label('PNR code', 270, top - 26); d.text(n.ref, 270, top - 40, { size: 10.5, bold: true });
    d.label('Status', 400, top - 26); d.text(p.tickets.length ? 'Ticketed' : 'Confirmed', 400, top - 40, { size: 10.5, bold: true, color: p.tickets.length ? '#166534' : '#b45309' });
    d.y = top - 70;
  });

  d.heading('Flight Details', 230);
  n.slices.forEach((s, si) => {
    const a = s.segments[0], z = s.segments[s.segments.length - 1];
    d.need(60); d.rect(M, d.y - 5, W - 2 * M, 21, '#e8f3ff'); d.text(`${n.slices.length > 1 ? (si ? 'Return' : 'Departure') : 'Flight'}:  ${a.fromCity}  -  ${z.toCity}`, M + 10, d.y + 1, { size: 10.5, bold: true, color: NAVY }); d.y -= 28;
    s.segments.forEach((g) => {
      const dep = d.wrap(`${g.fromCity}, ${g.fromAirport}${g.fromTerminal ? ' - Terminal ' + g.fromTerminal : ''}`, 9.5, 370), arr = d.wrap(`${g.toCity}, ${g.toAirport}${g.toTerminal ? ' - Terminal ' + g.toTerminal : ''}`, 9.5, 370);
      const hgt = 58 + dep.length * 12.5 + arr.length * 12.5 + 14; d.need(hgt + 20); const t = d.y;
      d.label('Airline', M, t); d.text(g.airline, M, t - 13, { size: 11, bold: true }); d.label('Flight number', 270, t); d.text(g.flight, 270, t - 13, { size: 11, bold: true }); d.label('Class', 400, t); d.text(g.cabin || '-', 400, t - 13, { size: 11, bold: true });
      let y = t - 38;
      d.label('Departure', M, y); d.text(g.dep.slice(11, 16), M, y - 16, { size: 15, bold: true, color: NAVY }); d.text(when(g.dep).split(' ').slice(0, 4).join(' '), M + 64, y - 4, { size: 9.5, bold: true });
      dep.forEach((l, i) => d.text(l, M + 64, y - 17 - i * 12.5, { size: 9.5, color: INK })); y -= 22 + dep.length * 12.5;
      d.label('Arrival', M, y); d.text(g.arr.slice(11, 16), M, y - 16, { size: 15, bold: true, color: NAVY }); d.text(when(g.arr).split(' ').slice(0, 4).join(' '), M + 64, y - 4, { size: 9.5, bold: true });
      arr.forEach((l, i) => d.text(l, M + 64, y - 17 - i * 12.5, { size: 9.5, color: INK })); y -= 24 + arr.length * 12.5;
      d.text(`Flight time ${g.duration}`, M, y, { size: 8.5, color: GRAY }); d.y = y - 10;
      if (g.layover) { const lt = `Stop: ${g.layover} layover`, lw2 = tw(lt, 9, true); d.hr(d.y, '#cbd5e1', true); d.rect(W / 2 - lw2 / 2 - 8, d.y - 7, lw2 + 16, 14, '#ffffff'); d.text(lt, W / 2, d.y - 3.5, { size: 9, bold: true, color: '#9a3412', center: true }); d.y -= 24; }
      else { d.hr(d.y, '#e2e8f0'); d.y -= 14; }
    });
  });

  d.heading('Baggage Details', 120);
  d.need(60); d.label('Traveler', M, d.y); d.label('Flight', 250, d.y); d.label('Baggage allowance', 360, d.y); d.y -= 14;
  n.passengers.forEach((p) => n.slices.forEach((s, si) => {
    const g = s.segments[0]; d.need(40); const t = d.y;
    d.text(`${p.name} (${p.type})`, M, t, { size: 9.5, bold: true }); d.text(`${g.from} - ${s.segments[s.segments.length - 1].to}`, 250, t, { size: 9.5 });
    d.text(g.bag.carryOn ? `${g.bag.carryOn} cabin bag included` : 'Cabin bag: check with airline', 360, t, { size: 9.5 }); d.text(g.bag.checked ? `${g.bag.checked} checked bag${g.bag.checked > 1 ? 's' : ''} included` : 'No checked bag included', 360, t - 12.5, { size: 9.5 });
    d.y = t - 30; d.hr(d.y + 12);
  }));
  d.text('Baggage weight limits are set by the airline. Extra or overweight bags may be charged.', M, d.y + 2, { size: 8, color: GRAY }); d.y -= 22;

  d.heading('Payment Information', 160);
  d.need(90); const pt = d.y; d.rect(M, pt - 62, W - 2 * M, 72, '#f8fafc', '#e2e8f0');
  if (n.base) { d.text('Price', M + 14, pt - 10, { size: 10, color: GRAY }); d.text(n.base, 250, pt - 10, { size: 10.5 }); d.text('Taxes and fees', M + 14, pt - 28, { size: 10, color: GRAY }); d.text(n.taxes, 250, pt - 28, { size: 10.5 }); if (n.fee) { d.text('Service fee', M + 14, pt - 46, { size: 10, color: GRAY }); d.text(n.fee, 250, pt - 46, { size: 10.5 }); } }
  else d.text('Fare including taxes and fees', M + 14, pt - 10, { size: 10, color: GRAY });
  d.text('TOTAL', W - M - 14, pt - 14, { size: 8, bold: true, color: GRAY, right: true }); d.text(n.total, W - M - 14, pt - 38, { size: 17, bold: true, color: NAVY, right: true });
  d.y = pt - 80;
  if (n.paidVia) { d.text(`Paid with ${n.paidVia}`, M, d.y, { size: 9, bold: true, color: '#166534' }); d.y -= 13; }
  d.text('This document is your e-ticket itinerary receipt. It is not an invoice.', M, d.y, { size: 8, color: GRAY });

  // Page 2: travel conditions
  d.y -= 14; d.heading('Travel Conditions', 330);
  d.para(`A short summary of the conditions that apply to your booking. The full text is in our Terms & Conditions, Privacy Policy and Refund Policy at ${COMPANY.site.replace('https://', '')}.`, { size: 9.5, color: GRAY }); d.y -= 6;
  [['Our role', `${COMPANY.name} is a travel agent. We arrange your flight with the airline. Your contract for carriage is with the airline, and the airline's conditions of carriage apply to your journey.`],
   ['Changes, cancellations and refunds', 'Whether a ticket can be changed or refunded depends on the fare rules of the airline. Please read our Refund Policy. Contact us as early as possible, because airline deadlines and fees can change close to departure.'],
   ['Baggage', 'Free baggage allowance depends on the airline, route and cabin. Baggage weight limits are set by the airline, and extra or overweight bags may be charged at the airport.'],
   ['Airline schedule changes and delays', 'Airlines may change schedules or cancel flights. We will pass on notices we receive and help you with your options, but the airline is responsible for the flight and for any compensation required by law.'],
   ['Travel documents and visas', 'You are responsible for valid passports, visas, health documents and transit requirements for every country on your journey. Names on this ticket must match your passport exactly.'],
   ['Check-in and airport times', `Please carry your booking reference (PNR) and ID${n.international ? ' (passport for international flights)' : ''}. Be at the airport at least ${n.international ? 3 : 2} hours before departure, and complete check-in at least 60 minutes before departure or earlier if your airline requires it. Online check-in is done on the airline's website.`],
   ['Need help?', `We are here 24/7. WhatsApp or call ${COMPANY.phone}, or email ${COMPANY.email}.`]
  ].forEach(([h, t]) => { d.need(64); d.y -= 4; d.text(h, M, d.y, { size: 11, bold: true, color: NAVY }); d.y -= 15; d.para(t, { size: 9.5 }); d.y -= 4; });
  d.y -= 8; d.text(`Thank you for choosing ${COMPANY.name}!`, M, d.y, { size: 13, bold: true, color: NAVY });
  return d.build();
}
