// Admin API logic. Every function here runs only after requireStaff() has approved the request.
import * as L from './ledger.js';
import { Fail } from './http.js';
import { configuredProvider, adapterFor, duffelMode } from './payments/index.js';
import { feeConfig } from './pricing.js';
import { refundPayment, reconcileOrder, confirmOrder } from './checkout.js';
import { sendConfirmation } from './email.js';
import * as D from './duffel.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, q = encodeURIComponent;
const ORDER_COLS = 'id,public_ref,status,amount,fee_amount,fare_amount,currency,travelers,booking_reference,duffel_order_id,ticket_status,attempts,last_error,confirmation_sent_at,created_at,updated_at';
const mask = { email: (e) => (e ? e[0] + '***' + e.slice(e.indexOf('@')) : ''), phone: (p) => (p ? p.slice(0, 4) + '****' + p.slice(-2) : ''), pass: (n) => (n ? '***' + String(n).slice(-3) : '') };
const pick = (o, keys) => Object.fromEntries(keys.split(',').map((k) => [k, o[k]]));
const two = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// Personal data is hidden unless the person explicitly presses "Reveal" (which is written to the audit trail).
function safeRequest(r, reveal) {
  if (!r) return null;
  return { contact: r.contact ? { email: reveal ? r.contact.email : mask.email(r.contact.email), phone: reveal ? r.contact.phone : mask.phone(r.contact.phone) } : null,
    passengers: (r.passengers || []).map((p) => ({ type: p.type, title: p.title, firstName: p.firstName, lastName: p.lastName,
      ...(p.bornOn ? { bornOn: reveal ? p.bornOn : p.bornOn.slice(0, 4) + '-**-**' } : {}), ...(p.passport ? { passport: { number: reveal ? p.passport.number : mask.pass(p.passport.number), country: p.passport.country } } : {}) })), route: r.route };
}
const audit = (env, staff, order, payment, type, detail) => L.event(env, { order_id: order && order.id, payment_id: payment && payment.id, source: 'admin', event_type: type, provider: payment && payment.provider, detail: { admin: staff.id, role: staff.role, ...(detail || {}) } });
const needId = (v) => { if (!UUID.test(String(v || ''))) throw new Fail(400, 'Invalid request.'); return String(v); };
const note = (v, min) => { const t = String(v || '').trim(); if (t.length < (min || 1) || t.length > 500) throw new Fail(400, min > 1 ? `Please write at least ${min} characters.` : 'Please write a note (up to 500 characters).'); return t; };

export const me = (staff, env) => ({ id: staff.id, email: staff.email, role: staff.role, mfaRequired: String(env.ADMIN_REQUIRE_MFA) === 'true' });

export async function health(env) {
  const cfg = configuredProvider(env); let ledger = false;
  try { await L.list(env, 'orders', 'select=id&limit=1'); ledger = true; } catch (e) { ledger = false; }
  return { provider: cfg.provider ? { name: cfg.provider.name, mode: cfg.provider.mode, ok: true } : { ok: false, problem: cfg.error }, ledgerReachable: ledger, duffelMode: duffelMode(env), paymentModeSetting: env.PAYMENT_MODE === 'live' ? 'live' : 'test',
    webhookSecretSet: !!env.PAYPAL_WEBHOOK_ID, emailConfigured: !!env.RESEND_API_KEY, adminEmailAllowList: !!env.ADMIN_EMAILS, mfaRequired: String(env.ADMIN_REQUIRE_MFA) === 'true', fee: feeConfig(env) };
}

export async function stats(env, days) {
  const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90), since = new Date(Date.now() - d * 864e5).toISOString();
  const orders = await L.list(env, 'orders', `select=id,status,amount,currency,updated_at,created_at&created_at=gte.${q(since)}&order=created_at.desc&limit=5000`);
  const pays = await L.list(env, 'payments', `select=status,provider,amount,currency,refunded_amount,updated_at&created_at=gte.${q(since)}&order=created_at.desc&limit=5000`);
  const review = await L.list(env, 'orders', 'select=id&status=eq.needs_review&limit=500');
  const by = {}; orders.forEach((o) => { by[o.status] = (by[o.status] || 0) + 1; });
  const sum = (rows, f, c) => { const m = {}; rows.forEach((r) => { m[r[c]] = (m[r[c]] || 0) + Number(f(r)); }); return Object.entries(m).map(([currency, v]) => ({ currency, amount: two(v) })); };
  const stale = (r) => Date.now() - Date.parse(r.updated_at) > 120000;
  return { days: d, orders: by, needsReviewNow: review.length, revenue: sum(orders.filter((o) => o.status === 'confirmed'), (o) => o.amount, 'currency'), refunded: sum(pays, (p) => p.refunded_amount, 'currency').filter((x) => Number(x.amount) > 0),
    stuck: orders.filter((o) => o.status === 'processing' && stale(o)).length + pays.filter((p) => p.status === 'processing' && stale(p)).length,
    byProvider: pays.reduce((m, p) => { m[p.provider] = (m[p.provider] || 0) + 1; return m; }, {}) };
}

export async function listOrders(env, p) {
  const limit = Math.min(Math.max(parseInt(p.get('limit'), 10) || 25, 1), 100), offset = Math.max(parseInt(p.get('offset'), 10) || 0, 0);
  const text = (p.get('q') || '').trim(); let ids = null;
  if (text) {                                                  // exact-match lookups: booking reference, our reference, Duffel id, payment ids
    ids = new Set(); const up = text.toUpperCase();
    const add = async (table, filter, col) => { for (const r of await L.list(env, table, `${filter}&select=${col}&limit=50`)) ids.add(r[col]); };
    await add('orders', `public_ref=eq.${q(up)}`, 'id'); await add('orders', `booking_reference=eq.${q(up)}`, 'id'); await add('orders', `duffel_order_id=eq.${q(text)}`, 'id');
    if (UUID.test(text)) { await add('orders', `id=eq.${text}`, 'id'); await add('payments', `id=eq.${text}`, 'order_id'); }
    await add('payments', `provider_payment_id=eq.${q(text)}`, 'order_id'); await add('payments', `provider_capture_id=eq.${q(text)}`, 'order_id');
  }
  const ps = p.get('payStatus'), pv = p.get('provider');
  if (ps || pv) {
    const rows = await L.list(env, 'payments', [ps && `status=eq.${q(ps)}`, pv && `provider=eq.${q(pv)}`, 'select=order_id', 'limit=1000'].filter(Boolean).join('&'));
    const s = new Set(rows.map((r) => r.order_id)); ids = ids ? new Set([...ids].filter((x) => s.has(x))) : s;
  }
  if (ids && !ids.size) return { orders: [], hasMore: false };
  const c = [`select=${ORDER_COLS}`];
  if (ids) c.push(`id=in.(${[...ids].slice(0, 200).join(',')})`);
  const st = p.get('status'); if (st) { if (!/^[a-z_]{3,20}$/.test(st)) throw new Fail(400, 'Invalid filter.'); c.push(`status=eq.${st}`); }
  for (const [k, op] of [['from', 'gte'], ['to', 'lt']]) { const v = p.get(k); if (v) { if (!/^\d{4}-\d{2}-\d{2}/.test(v)) throw new Fail(400, 'Invalid date.'); c.push(`created_at=${op}.${q(v)}`); } }
  c.push('order=created_at.desc', `limit=${limit + 1}`, `offset=${offset}`);
  const rows = await L.list(env, 'orders', c.join('&')), page = rows.slice(0, limit);
  const pays = page.length ? await L.list(env, 'payments', `order_id=in.(${page.map((o) => o.id).join(',')})&select=id,order_id,provider,mode,status,amount,currency,refunded_amount&order=created_at.asc`) : [];
  return { hasMore: rows.length > limit, orders: page.map((o) => ({ ...pick(o, ORDER_COLS), payments: pays.filter((x) => x.order_id === o.id).map((x) => pick(x, 'id,provider,mode,status,amount,currency,refunded_amount')) })) };
}

const allowed = (order, payments, role) => {
  const pay = payments[payments.length - 1], a = ['add_note'];
  if (pay) a.push('verify_payment');
  if (order.status === 'confirmed' && order.duffel_order_id) a.push('resend_email');
  if (role === 'admin') {
    if (order.status === 'needs_review') { a.push('reconcile'); if (pay && pay.status === 'paid') a.push('link_duffel_order'); }
    if (pay && pay.status === 'needs_review') a.push('resolve_payment');
    if (order.status === 'needs_review' && pay && pay.status !== 'needs_review') a.push('close_failed');
    if (pay && ['paid', 'partially_refunded'].includes(pay.status) && pay.provider_capture_id) a.push('refund');
  }
  return a;
};

export async function orderDetail(env, staff, id, reveal) {
  const order = await L.find(env, 'orders', `id=eq.${needId(id)}`); if (!order) throw new Fail(404, 'Order not found.');
  const payments = await L.list(env, 'payments', `order_id=eq.${order.id}&order=created_at.asc`);
  const refunds = payments.length ? await L.list(env, 'refunds', `payment_id=in.(${payments.map((p) => p.id).join(',')})&order=created_at.asc`) : [];
  const events = await L.list(env, 'payment_events', `order_id=eq.${order.id}&order=created_at.asc&limit=300`);
  if (reveal) await audit(env, staff, order, null, 'admin_revealed_personal_data', {});     // looking at personal data is itself recorded
  const { booking_request, ...rest } = order;
  return { order: { ...rest, booking_request: safeRequest(booking_request, !!reveal) }, payments, refunds, events: events.map((e) => pick(e, 'id,source,event_type,provider,from_status,to_status,detail,created_at')), actions: allowed(order, payments, staff.role), revealed: !!reveal };
}

export async function action(env, staff, body) {
  const act = String(body.action || '');
  const order = body.orderId ? await L.find(env, 'orders', `id=eq.${needId(body.orderId)}`) : null;
  const payment = body.paymentId ? await L.find(env, 'payments', `id=eq.${needId(body.paymentId)}`) : order ? await L.find(env, 'payments', `order_id=eq.${order.id}&order=created_at.desc`) : null;
  const target = order || (payment && await L.find(env, 'orders', `id=eq.${payment.order_id}`));
  if (!target) throw new Fail(404, 'Not found.');
  const allowedNow = allowed(target, payment ? [payment] : [], staff.role);
  if (!['add_note', 'verify_payment', 'resend_email', 'reconcile', 'link_duffel_order', 'resolve_payment', 'close_failed', 'refund'].includes(act)) throw new Fail(400, 'Unknown action.');
  if (!allowedNow.includes(act)) throw new Fail(staff.role === 'support' && !['add_note', 'verify_payment', 'resend_email'].includes(act) ? 403 : 409, 'That action is not available for this order right now.');

  if (act === 'add_note') { await audit(env, staff, target, payment, 'admin_note', { note: note(body.note) }); return { ok: true }; }

  if (act === 'verify_payment') {                                // read-only: asks the provider what it says
    const ad = adapterFor(payment.provider), cfg = configuredProvider({ ...env, PAYMENT_PROVIDER: payment.provider });
    if (!ad || !cfg.provider) throw new Fail(503, 'The payment provider is not configured.');
    let r; try { r = await ad.getPaymentStatus(env, { providerPaymentId: payment.provider_payment_id, paymentId: payment.id, amount: Number(payment.amount), currency: payment.currency, formatted: ad.formatAmount(Number(payment.amount), payment.currency) }); } catch (e) { r = { status: 'unknown' }; }
    await audit(env, staff, target, payment, 'admin_verify_payment', { providerSays: r.status, code: r.code || null });
    return { providerSays: r.status, code: r.code || null, captureId: r.providerCaptureId || null, ledgerSays: payment.status, matches: (r.status === 'paid') === (['paid', 'partially_refunded', 'refund_pending', 'refunded'].includes(payment.status)) };
  }

  if (act === 'resend_email') {
    const last = await L.find(env, 'payment_events', `order_id=eq.${target.id}&event_type=eq.email_resent&order=created_at.desc`);
    if (last && Date.now() - Date.parse(last.created_at) < 60000) throw new Fail(429, 'An email was just sent. Please wait a minute.');
    const d = await D.getOrder(env, target.duffel_order_id); if (d.outcome !== 'ok') throw new Fail(503, 'The airline system could not be reached.');
    const sent = await sendConfirmation(env, d.order, { amount: two(target.amount), currency: target.currency, fee: two(target.fee_amount), method: (adapterFor(payment && payment.provider) || {}).label || '' });
    await audit(env, staff, target, payment, 'email_resent', { ok: !!sent.ok });
    if (sent.ok) await L.patch(env, 'orders', target.id, { confirmation_sent_at: new Date().toISOString() });
    if (!sent.ok) throw new Fail(502, 'The email could not be sent.'); return { ok: true };
  }

  if (act === 'reconcile') { await audit(env, staff, target, payment, 'admin_reconcile', {}); return reconcileOrder(env, target.id); }

  if (act === 'link_duffel_order') {                              // staff found the booking in Duffel; the server re-checks it before linking
    const did = String(body.duffelOrderId || '').trim(); if (!/^ord_[A-Za-z0-9]{6,60}$/.test(did)) throw new Fail(400, 'Enter the Duffel order id (it starts with ord_).');
    const taken = await L.find(env, 'orders', `duffel_order_id=eq.${q(did)}`); if (taken) throw new Fail(409, 'That Duffel order is already linked to another order.');
    const d = await D.getOrder(env, did); if (d.outcome === 'none') throw new Fail(404, 'Duffel has no order with that id.'); if (d.outcome !== 'ok') throw new Fail(503, 'The airline system could not be reached.');
    const o = d.order, req = target.booking_request || {};
    const same = o.total_currency === target.currency && Number(o.total_amount) === Number(target.fare_amount)
      && (o.passengers || []).some((p) => String(p.family_name || '').toLowerCase() === String((req.passengers && req.passengers[0] && req.passengers[0].lastName) || '').toLowerCase())
      && !!o.live_mode === (payment.mode === 'live');
    if (!same) throw new Fail(409, 'That Duffel order does not match this order (price, currency, traveler name or test/live mode).');
    await audit(env, staff, target, payment, 'admin_link_duffel_order', { duffelOrderId: did, note: String(body.note || '').slice(0, 300) });
    const r = await confirmOrder(env, target, payment, o, true); return { ok: true, status: r.status, bookingReference: r.bookingReference, emailSent: r.emailSent };
  }

  if (act === 'resolve_payment') {                                // needs_review -> paid / failed / cancelled, only if the PROVIDER agrees
    const to = String(body.to || ''); if (!['paid', 'failed', 'cancelled'].includes(to)) throw new Fail(400, 'Choose paid, failed or cancelled.');
    const why = note(body.note, 5);
    const ad = adapterFor(payment.provider);
    let r; try { r = await ad.getPaymentStatus(env, { providerPaymentId: payment.provider_payment_id, paymentId: payment.id, amount: Number(payment.amount), currency: payment.currency, formatted: ad.formatAmount(Number(payment.amount), payment.currency) }); } catch (e) { r = { status: 'unknown' }; }
    if (to === 'paid' && !(r.status === 'paid' && r.providerCaptureId)) throw new Fail(409, `The provider does not confirm this payment as paid (it says: ${r.status}).`);
    if (to !== 'paid' && !['failed', 'cancelled'].includes(r.status)) throw new Fail(409, `The provider does not confirm this payment as ${to} (it says: ${r.status}). If money was taken, refund it instead.`);
    await audit(env, staff, target, payment, 'admin_resolve_payment', { to, providerSays: r.status, note: why });
    const done = await L.cas(env, 'payments', payment.id, ['needs_review'], to === 'paid' ? { status: 'paid', provider_capture_id: r.providerCaptureId, failure_code: null } : { status: to, failure_code: 'admin_' + to });
    if (!done) throw new Fail(409, 'This payment changed in the meantime. Please reload.'); return { ok: true, status: to };
  }

  if (act === 'close_failed') {                                   // staff confirmed no booking exists: close the order (refund separately if money was taken)
    const why = note(body.note, 5); await audit(env, staff, target, payment, 'admin_close_failed', { note: why });
    const done = await L.cas(env, 'orders', target.id, ['needs_review'], { status: 'failed', last_error: 'closed by staff' });
    if (!done) throw new Fail(409, 'This order changed in the meantime. Please reload.');
    return { ok: true, nextStep: ['paid', 'partially_refunded'].includes(payment.status) ? 'The customer has paid. Refund the payment now.' : null };
  }

  if (act === 'refund') {
    const why = note(body.reason, 5), key = String(body.idempotencyKey || ''); if (key.length < 8 || key.length > 80) throw new Fail(400, 'Invalid request.');
    await audit(env, staff, target, payment, 'admin_refund_requested', { amount: body.amount == null ? 'full' : two(body.amount), reason: why });
    return refundPayment(env, { paymentId: payment.id, amount: body.amount == null || body.amount === '' ? null : Number(body.amount), reason: why, requestedBy: staff.id, idempotencyKey: 'admin-' + key });
  }
  throw new Fail(400, 'Unknown action.');
}
