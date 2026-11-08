// Minimal PDF writer (no libraries) and the e-ticket itinerary layout.
import { COMPANY, when, normalize } from './itinerary.js';
const W = 595.28, H = 841.89, M = 40;
const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const latin = (s) => String(s == null ? '' : s).replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const pesc = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

class Doc {
  constructor(footer) { this.pages = []; this.footer = footer; this.add(); }
  add() { this.ops = []; this.pages.push(this.ops); this.y = H - 50; }
  need(h) { if (this.y - h < 70) this.add(); }
  rect(x, y, w, h, fill, stroke) { this.ops.push(`${rgb(fill || '#ffffff')} rg ${stroke ? rgb(stroke) + ' RG 0.8 w' : ''} ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re ${fill && stroke ? 'B' : stroke ? 'S' : 'f'}`); }
  hr(y, color) { this.ops.push(`${rgb(color || '#cbd5e1')} RG 0.6 w ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S`); }
  text(s, x, y, o = {}) { this.ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${o.size || 10} Tf ${rgb(o.color || '#1f2937')} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${pesc(s)}) Tj ET`); }
  wrap(s, size, width, bold) { const per = Math.max(10, Math.floor(width / (size * (bold ? 0.54 : 0.48)))), out = []; let cur = ''; for (const w of String(s).split(' ')) { if ((cur + ' ' + w).trim().length > per) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; }
  line(s, o = {}) { const size = o.size || 10, x = o.x == null ? M : o.x, lines = this.wrap(s, size, o.width || (W - M - x), o.bold); for (const l of lines) { this.need(size * 1.6); this.text(l, x, this.y, o); this.y -= size * 1.55; } }
  gapY(n) { this.y -= n; }
  build() {
    const objs = [], add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((ops, i) => {
      const foot = [];
      const f = (s, x, y, size) => foot.push(`BT /F1 ${size} Tf ${rgb('#64748b')} rg ${x} ${y} Td (${pesc(s)}) Tj ET`);
      foot.push(`${rgb('#cbd5e1')} RG 0.6 w ${M} 52 m ${W - M} 52 l S`);
      f(this.footer[0], M, 40, 8); f(this.footer[1], M, 29, 8); f(`Page ${i + 1} of ${this.pages.length}`, W - M - 50, 40, 8);
      const body = ops.concat(foot).join('\n');
      const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`) + ' 0 R');
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\n${'endobj'}\n`; });
    const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return u;
  }
}

export function buildPdf(order) {
  const n = normalize(order);
  const d = new Doc([`${COMPANY.name}  |  ${COMPANY.address}`, `${COMPANY.phone}  |  ${COMPANY.email}  |  ${COMPANY.site.replace('https://', '')}`]);
  d.rect(0, H - 92, W, 92, '#0B2545');
  d.text('get2fly.com', M, H - 52, { size: 26, bold: true, color: '#ffffff' });
  d.text('E-TICKET ITINERARY RECEIPT', M, H - 72, { size: 9, color: '#bfdbfe' });
  d.text('BOOKING REFERENCE (PNR)', W - M - 150, H - 40, { size: 8, color: '#bfdbfe' });
  d.text(n.ref, W - M - 150, H - 66, { size: 26, bold: true, color: '#FF8A00' });
  d.y = H - 122;
  d.line('Your booking is confirmed', { size: 17, bold: true, color: '#0B2545' });
  d.line(`Issued ${n.createdAt ? n.createdAt.slice(0, 10) : ''}  -  ${n.airline}  -  Total ${n.total}  -  ${n.refund}`, { size: 9, color: '#64748b' });
  if (n.test) { d.gapY(4); d.rect(M, d.y - 8, W - 2 * M, 22, '#fff7ed', '#fed7aa'); d.text('TEST BOOKING: no real ticket was issued and nothing was charged.', M + 8, d.y - 1, { size: 9, bold: true, color: '#9a3412' }); d.y -= 26; }
  d.gapY(8);
  d.line('Travelers', { size: 12, bold: true, color: '#0B2545' }); d.hr(d.y + 6); d.gapY(2);
  n.passengers.forEach((p) => {
    d.need(30); d.text(p.name, M, d.y, { size: 11, bold: true }); d.text(p.type, 300, d.y, { size: 9, color: '#64748b' });
    d.text(p.tickets.length ? 'E-ticket: ' + p.tickets.join(', ') : 'E-ticket number: pending', 350, d.y, { size: 10, bold: true, color: p.tickets.length ? '#166534' : '#9a3412' }); d.y -= 20;
  });
  d.gapY(6);
  n.slices.forEach((s, si) => {
    d.need(60); d.line(`${n.slices.length > 1 ? (si ? 'Return' : 'Outbound') : 'Flight'}: ${s.segments[0].fromCity} to ${s.segments[s.segments.length - 1].toCity}`, { size: 12, bold: true, color: '#0B2545' }); d.hr(d.y + 6); d.gapY(2);
    s.segments.forEach((g) => {
      d.need(150);
      const top = d.y; d.text(`${g.airline}  ${g.flight}`, M, d.y, { size: 11, bold: true }); d.text(g.cabin ? 'Class: ' + g.cabin : '', 330, d.y, { size: 9, color: '#64748b' }); d.y -= 17;
      d.text('Departure', M, d.y, { size: 8, bold: true, color: '#64748b' }); d.y -= 12;
      d.line(`${when(g.dep)}  -  ${g.fromCity} (${g.from}), ${g.fromAirport}${g.fromTerminal ? ', Terminal ' + g.fromTerminal : ''}`, { size: 10, x: M });
      d.text('Arrival', M, d.y, { size: 8, bold: true, color: '#64748b' }); d.y -= 12;
      d.line(`${when(g.arr)}  -  ${g.toCity} (${g.to}), ${g.toAirport}${g.toTerminal ? ', Terminal ' + g.toTerminal : ''}`, { size: 10 });
      d.line(`Flight time: ${g.duration}   |   Checked baggage: ${g.bag.checked ? g.bag.checked + ' included' : 'not included'}   |   Cabin baggage: ${g.bag.carryOn ? g.bag.carryOn + ' included' : 'check with airline'}   |   Status: ${n.ticketed ? 'Ticketed' : 'Confirmed'}`, { size: 9, color: '#475569' });
      d.gapY(4); d.hr(d.y + 4, '#e2e8f0');
      if (g.layover) { d.line(`Layover: ${g.layover}`, { size: 9, bold: true, color: '#9a3412' }); }
      d.gapY(6);
    });
  });
  d.need(150); d.line('Important information', { size: 12, bold: true, color: '#0B2545' }); d.hr(d.y + 6); d.gapY(2);
  [`Please carry your booking reference (PNR) and your ID${n.international ? ' (passport for international flights)' : ''}. ${n.international ? 'Be at the airport at least 3 hours before your flight.' : 'Be at the airport at least 2 hours before your flight.'}`,
   'Complete airport check-in at least 60 minutes before departure, or earlier if your airline requires it. Online check-in is done on the airline\'s website.',
   'You may need a transit visa for international connecting flights. Please check each country\'s requirements on its official consular website before you travel.',
   'Baggage weight limits are set by the airline. Extra or overweight baggage may be charged.',
   'Changes and refunds follow the airline\'s fare rules and our Refund Policy at get2fly.com/refund.html.'].forEach((t) => d.line('- ' + t, { size: 9.5 }));
  d.gapY(6); d.line(`Need help? We are here 24/7: ${COMPANY.phone} (WhatsApp or call) or ${COMPANY.email}.`, { size: 10, bold: true, color: '#0B2545' });
  return d.build();
}
