// Provider-independent checkout workflow and state machine.
// payment: pending -> processing -> paid -> (refund_pending -> partially_refunded|refunded) ; any -> needs_review
// order:   pending -> processing -> confirmed ; pending|processing -> failed ; any -> needs_review
// Only this server code changes these statuses (database triggers reject illegal jumps). The browser can never mark anything paid or confirmed.
import * as L from './ledger.js';
import { configuredProvider, adapterFor } from './payments/index.js';
import * as D from './duffel.js';
import { computeFee } from './pricing.js';
import { sendConfirmation } from './email.js';
import { Fail } from './http.js';

const KEY = /^[A-Za-z0-9_-]{16,64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'G2F-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CH[b % 32]).join('');
const two = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const STUCK_MS = 120000;
const logErr = (o) => console.error(JSON.stringify({ app: 'get2fly', ...o }));

const view = (order, payment, status, message, extra) => ({ status, orderRef: order.public_ref, paymentId: payment.id, message, ...(extra || {}) });
async function ev(env, order, payment, type, from, to, detail, source, strict) {
  try { await L.event(env, { order_id: order.id, payment_id: payment && payment.id, source: source || 'api', event_type: type, provider: payment && payment.provider, from_status: from || null, to_status: to || null, detail: detail || null }); }
  catch (e) { if (strict) throw e; logErr({ event: 'audit_write_failed', type, orderRef: order.public_ref }); }
}
const methodLabel = (p) => (adapterFor(p.provider) || {}).label || p.provider;

// ---------------------------------------------------------------- 1. start a checkout (before any money moves)
export async function startCheckout(env, body) {
  const cfg = configuredProvider(env);
  if (!cfg.provider || !L.ledgerReady(env)) { logErr({ event: 'payments_not_ready', reason: cfg.error || 'ledger not configured' }); throw new Fail(503, 'Online payment is not available right now. Please contact us on WhatsApp.'); }
  const provider = cfg.provider, key = String(body.idempotencyKey || ''), offerId = String(body.offerId || '');
  if (!KEY.test(key) || !offerId || offerId.length > 120) throw new Fail(400, 'Invalid request.');
  const v = D.validateRequest(body); if (!v.ok) throw new Fail(400, v.error);

  let order = await L.find(env, 'orders', `idempotency_key=eq.${encodeURIComponent(key)}`);
  if (order) {                                               // same checkout sent again (double click, retry, second tab)
    if (order.offer_id !== offerId) throw new Fail(409, 'This checkout belongs to a different flight. Please refresh the page.');
    const pay = await L.find(env, 'payments', `order_id=eq.${order.id}&status=in.(pending,authorized,processing,paid)&order=created_at.desc`);
    if (pay && pay.provider_payment_id && order.status === 'pending' && ['pending', 'authorized'].includes(pay.status)) {
      return { paymentId: pay.id, orderRef: order.public_ref, provider: pay.provider, mode: pay.mode, clientPayload: provider.clientPayload(pay.provider_payment_id), amount: two(order.amount), currency: order.currency, fee: two(order.fee_amount), reused: true };
    }
    throw new Fail(409, 'This checkout has already been used. Please check your booking status or refresh the page.', { orderRef: order.public_ref, paymentId: pay && pay.id });
  }

  const off = await D.getOffer(env, offerId);
  if (off.outcome === 'expired') throw new Fail(410, 'This fare has expired. Please search again.');
  if (off.outcome !== 'ok') throw new Fail(503, 'The airline service is temporarily unavailable. Please try again.');
  const offer = off.offer, map = D.mapPassengers(offer, v.clean);
  if (!map.ok) throw new Fail(400, map.error);              // find problems BEFORE taking money
  if (!provider.supportsCurrency(offer.currency)) throw new Fail(400, `Payments in ${offer.currency} are not supported for this fare.`);

  const fare = Number(offer.total), fee = computeFee(env, fare, offer.passengers.length), total = Math.round((fare + fee) * 100) / 100;
  const row = { public_ref: newRef(), idempotency_key: key, offer_id: offerId, amount: two(total), fare_amount: two(fare), fee_amount: two(fee), currency: offer.currency, travelers: offer.passengers.length, booking_request: { ...v.clean, route: offer.route } };
  try { order = await L.insert(env, 'orders', row); }
  catch (e) {
    if (e.code !== 'conflict') throw e;
    order = await L.find(env, 'orders', `idempotency_key=eq.${encodeURIComponent(key)}`);           // lost a race with the same checkout
    if (!order) { row.public_ref = newRef(); order = await L.insert(env, 'orders', row); }          // reference collision: retry once
    else throw new Fail(409, 'This checkout is already in progress. Please wait a moment and try again.', { orderRef: order.public_ref });
  }
  const payment = await L.insert(env, 'payments', { order_id: order.id, provider: provider.name, mode: provider.mode, amount: two(total), currency: offer.currency });
  let created = null;
  try { created = await provider.createPayment(env, { paymentId: payment.id, orderRef: order.public_ref, amount: total, currency: offer.currency, formatted: provider.formatAmount(total, offer.currency) }); } catch (e) { created = null; }
  if (!created || !created.providerPaymentId) {
    await L.cas(env, 'payments', payment.id, ['pending'], { status: 'failed', failure_code: 'create_failed' });
    await L.cas(env, 'orders', order.id, ['pending'], { status: 'failed', last_error: 'payment could not be created' });
    throw new Fail(502, 'We could not start the payment. Please try again.');
  }
  await L.patch(env, 'payments', payment.id, { provider_payment_id: created.providerPaymentId });
  await ev(env, order, payment, 'payment_created', null, 'pending', { amount: two(total), currency: offer.currency }, 'api', true);
  return { paymentId: payment.id, orderRef: order.public_ref, provider: provider.name, mode: provider.mode, clientPayload: provider.clientPayload(created.providerPaymentId, created), amount: two(total), currency: offer.currency, fee: two(fee) };
}

// ---------------------------------------------------------------- 2. complete: verify payment, then book (safe to call many times)
export async function completeCheckout(env, body, depth = 0) {
  const id = String(body.paymentId || ''); if (!UUID.test(id)) throw new Fail(400, 'Invalid request.');
  if (!L.ledgerReady(env)) throw new Fail(503, 'Online payment is not available right now.');
  const payment = await L.find(env, 'payments', `id=eq.${id}`); if (!payment) throw new Fail(404, 'Payment not found.');
  const order = await L.find(env, 'orders', `id=eq.${payment.order_id}`);
  const adapter = adapterFor(payment.provider);
  const cfg = configuredProvider({ ...env, PAYMENT_PROVIDER: payment.provider });
  if (!adapter || !cfg.provider) { logErr({ event: 'provider_unavailable', provider: payment.provider, reason: cfg.error }); throw new Fail(503, 'Online payment is not available right now.'); }
  const provider = cfg.provider;

  // Already finished? Return the stored result (idempotent).
  if (order.status === 'confirmed') return confirmedView(order, payment);
  if (order.status === 'needs_review' || payment.status === 'needs_review') return view(order, payment, 'needs_review', reviewMsg(order));
  if (order.status === 'failed' || order.status === 'cancelled') return view(order, payment, payment.status === 'refunded' ? 'refunded' : 'failed', failedMsg(payment));
  if (['refund_pending', 'partially_refunded', 'refunded', 'failed', 'cancelled'].includes(payment.status)) return view(order, payment, 'failed', failedMsg(payment));

  const stuck = Date.now() - Date.parse(payment.status === 'paid' ? order.updated_at : payment.updated_at) > STUCK_MS;
  if (payment.status === 'processing' || (payment.status === 'paid' && order.status === 'processing')) {
    if (!stuck) return view(order, payment, 'processing', 'We are processing your booking. Please do not pay again.');
    return markReview(env, order, payment, 'request_stalled');
  }

  if (payment.status === 'pending' || payment.status === 'authorized') {
    // Before taking money: is the fare still valid and unchanged?
    const off = await D.getOffer(env, order.offer_id);
    if (off.outcome === 'unavailable') throw new Fail(503, 'The airline service is temporarily unavailable. You have not been charged. Please try again.');
    if (off.outcome === 'expired' || Number(off.offer.total) !== Number(order.fare_amount)) {
      await L.cas(env, 'payments', payment.id, ['pending', 'authorized'], { status: 'cancelled', failure_code: off.outcome === 'expired' ? 'offer_expired' : 'price_changed' });
      await L.cas(env, 'orders', order.id, ['pending'], { status: 'cancelled', last_error: off.outcome === 'expired' ? 'offer expired' : 'price changed' });
      await ev(env, order, payment, 'checkout_cancelled', 'pending', 'cancelled', { reason: off.outcome === 'expired' ? 'offer_expired' : 'price_changed' });
      return view(order, payment, 'failed', 'The fare changed or expired before payment. You have not been charged. Please search again.');
    }
    const claimed = await L.cas(env, 'payments', payment.id, ['pending', 'authorized'], { status: 'processing' });
    if (!claimed) return depth < 2 ? completeCheckout(env, body, depth + 1) : view(order, payment, 'processing', 'We are processing your booking. Please do not pay again.');
    const pay = claimed;
    let res; try { res = await provider.confirmPayment(env, { providerPaymentId: pay.provider_payment_id, paymentId: pay.id, amount: Number(pay.amount), currency: pay.currency, formatted: provider.formatAmount(Number(pay.amount), pay.currency) }); } catch (e) { res = { status: 'unknown' }; }
    if (res.status === 'paid') {
      try { await L.cas(env, 'payments', pay.id, ['processing'], { status: 'paid', provider_capture_id: res.providerCaptureId }); }
      catch (e) {
        logErr({ event: 'PAID_BUT_NOT_RECORDED', orderRef: order.public_ref, paymentId: pay.id, captureId: res.providerCaptureId, code: e.code });
        throw new Fail(503, `We received your payment but could not finish recording it. Please do not pay again. Contact us on WhatsApp with reference ${order.public_ref}.`, { orderRef: order.public_ref });
      }
      await ev(env, order, pay, 'payment_paid', 'processing', 'paid', { captureId: res.providerCaptureId });
      return bookFlight(env, provider, order, { ...pay, status: 'paid', provider_capture_id: res.providerCaptureId });
    }
    if (res.status === 'pending') { await L.cas(env, 'payments', pay.id, ['processing'], { status: 'pending', ...(res.providerCaptureId ? { provider_capture_id: res.providerCaptureId } : {}) }); await ev(env, order, pay, 'payment_pending', 'processing', 'pending', { code: res.code }); return view(order, pay, 'payment_pending', res.code === 'not_approved' ? 'The payment has not been approved yet.' : 'Your payment is still being processed. Please do not pay again.'); }
    if (res.status === 'failed' || res.status === 'cancelled') {
      await L.cas(env, 'payments', pay.id, ['processing'], { status: res.status, failure_code: res.code || res.status });
      await L.cas(env, 'orders', order.id, ['pending'], { status: 'failed', last_error: 'payment ' + (res.code || res.status) });
      await ev(env, order, pay, 'payment_' + res.status, 'processing', res.status, { code: res.code });
      return view(order, pay, 'failed', 'The payment was not completed. You have not been charged.');
    }
    // unknown or needs_review (money may have moved): never guess
    await L.cas(env, 'payments', pay.id, ['processing'], { status: 'needs_review', failure_code: res.code || 'unknown_outcome', ...(res.providerCaptureId ? { provider_capture_id: res.providerCaptureId } : {}) });
    await L.cas(env, 'orders', order.id, ['pending'], { status: 'needs_review', last_error: 'payment outcome unclear' });
    await ev(env, order, pay, 'payment_needs_review', 'processing', 'needs_review', { code: res.code });
    return view(order, pay, 'needs_review', reviewMsg(order));
  }
  if (payment.status === 'paid') return bookFlight(env, provider, order, payment);    // resume: paid earlier, booking not finished
  return view(order, payment, 'processing', 'We are processing your booking. Please do not pay again.');
}

const reviewMsg = (o) => `We received your payment, but we need to check your booking. Please do not pay again. We will contact you soon. Your reference is ${o.public_ref}.`;
const failedMsg = (p) => (p.status === 'refunded' ? 'The booking could not be completed and your payment has been refunded.' : p.status === 'refund_pending' || p.status === 'partially_refunded' ? 'The booking could not be completed. Your refund is being processed.' : 'The booking was not completed. You have not been charged.');
function confirmedView(order, payment) {
  return view(order, payment, 'confirmed', 'Your booking is confirmed.', { bookingReference: order.booking_reference, ticketStatus: order.ticket_status, emailSent: !!order.confirmation_sent_at, liveMode: payment.mode === 'live',
    paid: { amount: two(order.amount), currency: order.currency, fee: two(order.fee_amount), method: methodLabel(payment) } });
}
async function markReview(env, order, payment, code) {
  // The payment is only flagged when ITS outcome is unclear. If it was verified as paid and only the booking is uncertain, it stays paid.
  if (['processing', 'pending', 'authorized'].includes(payment.status)) await L.cas(env, 'payments', payment.id, ['processing', 'pending', 'authorized'], { status: 'needs_review', failure_code: code }).catch(() => null);
  await L.cas(env, 'orders', order.id, ['pending', 'processing'], { status: 'needs_review', last_error: code }).catch(() => null);
  await ev(env, order, payment, 'marked_needs_review', null, 'needs_review', { code });
  return view(order, payment, 'needs_review', reviewMsg(order));
}
const scrub = (req) => ({ contact: { email: req.contact.email }, passengers: req.passengers.map((p) => ({ type: p.type, firstName: p.firstName, lastName: p.lastName })), route: req.route });

// ---------------------------------------------------------------- 3. book with Duffel (only after the payment is recorded as paid)
async function bookFlight(env, provider, order, payment) {
  const claimed = await L.cas(env, 'orders', order.id, ['pending'], { status: 'processing', attempts: order.attempts + 1 });
  if (!claimed) { const o = await L.find(env, 'orders', `id=eq.${order.id}`); return o.status === 'confirmed' ? confirmedView(o, payment) : view(o, payment, o.status === 'needs_review' ? 'needs_review' : 'processing', o.status === 'needs_review' ? reviewMsg(o) : 'We are processing your booking. Please do not pay again.'); }
  order = claimed; const req = order.booking_request;
  const off = await D.getOffer(env, order.offer_id);
  if (off.outcome === 'unavailable') return markReview(env, order, payment, 'duffel_unavailable_after_payment');
  let result;
  if (off.outcome === 'expired' || Number(off.offer.total) !== Number(order.fare_amount)) result = { outcome: 'rejected', message: 'The fare changed or expired.' };
  else { const map = D.mapPassengers(off.offer, req); result = map.ok ? await D.createOrder(env, { offerId: order.offer_id, passengers: map.list, amount: off.offer.total, currency: off.offer.currency }) : { outcome: 'rejected', message: map.error }; }

  if (result.outcome === 'confirmed') return confirmOrder(env, order, payment, result.order);
  if (result.outcome === 'rejected') {                       // Duffel clearly refused: no booking exists, so refunding is safe
    await L.cas(env, 'orders', order.id, ['processing'], { status: 'failed', last_error: result.message });
    await ev(env, order, payment, 'booking_rejected', 'processing', 'failed', { message: result.message });
    const rf = await refundPayment(env, { paymentId: payment.id, reason: 'booking rejected by supplier', requestedBy: 'system', idempotencyKey: 'auto-' + payment.id }).catch((e) => ({ error: e }));
    const done = rf && rf.status === 'completed';
    return view(order, payment, done ? 'refunded' : 'failed', done ? 'The airline could not confirm your booking, so your payment has been refunded.' : `The airline could not confirm your booking. Your refund is being processed. Reference ${order.public_ref}.`);
  }
  // unknown outcome: Duffel may or may not have created the order. Look for it; never refund automatically.
  await ev(env, order, payment, 'booking_outcome_unknown', 'processing', null, { attempt: order.attempts });
  const found = await D.findRecentOrder(env, { lastName: req.passengers[0].lastName, amount: off.offer.total, currency: off.offer.currency, route: req.route, since: Date.parse(order.created_at) });
  if (found.outcome === 'found') return confirmOrder(env, order, payment, found.order, true);
  return markReview(env, order, payment, 'booking_outcome_unknown');
}

export async function confirmOrder(env, order, payment, duffelOrder, recovered) {
  let saved = true;
  try { await L.cas(env, 'orders', order.id, ['processing', 'needs_review'], { status: 'confirmed', duffel_order_id: duffelOrder.id, booking_reference: duffelOrder.booking_reference, ticket_status: D.ticketState(duffelOrder), last_error: null, booking_request: scrub(order.booking_request) }); }
  catch (e) { saved = false; logErr({ event: 'BOOKED_BUT_NOT_RECORDED', orderRef: order.public_ref, duffelOrderId: duffelOrder.id, pnr: duffelOrder.booking_reference, code: e.code }); }
  if (saved) await ev(env, order, payment, recovered ? 'booking_recovered' : 'booking_confirmed', 'processing', 'confirmed', { duffelOrderId: duffelOrder.id, ticket: D.ticketState(duffelOrder) });
  const paid = { amount: two(order.amount), currency: order.currency, fee: two(order.fee_amount), method: methodLabel(payment) };
  let sent = false;
  try { const m = await sendConfirmation(env, duffelOrder, paid); sent = !!m.ok; } catch (e) { sent = false; }
  if (saved) { await ev(env, order, payment, sent ? 'email_sent' : 'email_failed', null, null, null); if (sent) await L.patch(env, 'orders', order.id, { confirmation_sent_at: new Date().toISOString() }).catch(() => null); }
  return view(order, payment, 'confirmed', 'Your booking is confirmed.', { bookingReference: duffelOrder.booking_reference, ticketStatus: D.ticketState(duffelOrder), emailSent: sent, liveMode: !!duffelOrder.live_mode, paid });
}

// ---------------------------------------------------------------- 4. refunds (provider independent; duplicate-safe; never guesses)
export async function refundPayment(env, { paymentId, amount, reason, requestedBy, idempotencyKey }) {
  const payment = await L.find(env, 'payments', `id=eq.${paymentId}`); if (!payment) throw new Fail(404, 'Payment not found.');
  const order = await L.find(env, 'orders', `id=eq.${payment.order_id}`);
  const adapter = adapterFor(payment.provider), cfg = configuredProvider({ ...env, PAYMENT_PROVIDER: payment.provider });
  if (!adapter || !cfg.provider) throw new Fail(503, 'The payment provider is not available.');
  const key = String(idempotencyKey || ''); if (!key) throw new Fail(400, 'A refund needs an idempotency key.');
  const existing = await L.find(env, 'refunds', `idempotency_key=eq.${encodeURIComponent(key)}`);
  if (existing) return { status: existing.status, refundId: existing.id, duplicate: true };
  if (!['paid', 'partially_refunded'].includes(payment.status) || !payment.provider_capture_id) throw new Fail(409, 'This payment cannot be refunded in its current state.');
  const remaining = Math.round((Number(payment.amount) - Number(payment.refunded_amount)) * 100) / 100;
  const amt = amount == null ? remaining : Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0) || amt > remaining) throw new Fail(400, 'The refund amount is not valid.');
  if (amt < remaining && !cfg.provider.capabilities.partialRefund) throw new Fail(400, 'This payment provider does not support partial refunds.');
  let refund;
  try { refund = await L.insert(env, 'refunds', { payment_id: payment.id, idempotency_key: key, amount: two(amt), currency: payment.currency, reason: String(reason || '').slice(0, 200), requested_by: requestedBy || 'system' }); }
  catch (e) { if (e.code === 'conflict') return { status: 'pending', duplicate: true }; throw e; }
  const moved = await L.cas(env, 'payments', payment.id, ['paid', 'partially_refunded'], { status: 'refund_pending' });
  if (!moved) { await L.cas(env, 'refunds', refund.id, ['pending'], { status: 'failed' }); throw new Fail(409, 'This payment changed while the refund was starting. Please try again.'); }
  await ev(env, order, payment, 'refund_requested', payment.status, 'refund_pending', { amount: two(amt), reason }, requestedBy === 'system' ? 'system' : 'admin');
  let res; try { res = await cfg.provider.refundPayment(env, { providerCaptureId: payment.provider_capture_id, amount: amt, currency: payment.currency, full: amt === remaining && Number(payment.refunded_amount) === 0, idempotencyKey: key }); } catch (e) { res = { status: 'unknown' }; }
  if (res.status === 'completed') {
    const total = Math.round((Number(payment.refunded_amount) + amt) * 100) / 100, final = total >= Number(payment.amount) ? 'refunded' : 'partially_refunded';
    await L.cas(env, 'refunds', refund.id, ['pending'], { status: 'completed', provider_refund_id: res.providerRefundId });
    await L.cas(env, 'payments', payment.id, ['refund_pending'], { status: final, refunded_amount: two(total) });
    await ev(env, order, payment, 'refund_completed', 'refund_pending', final, { amount: two(amt) });
    return { status: 'completed', refundId: refund.id };
  }
  if (res.status === 'pending') return { status: 'pending', refundId: refund.id };            // provider will confirm by webhook
  if (res.status === 'failed') {
    await L.cas(env, 'refunds', refund.id, ['pending'], { status: 'failed' });
    await L.cas(env, 'payments', payment.id, ['refund_pending'], { status: Number(payment.refunded_amount) > 0 ? 'partially_refunded' : 'paid' });
    await ev(env, order, payment, 'refund_failed', 'refund_pending', null, null);
    return { status: 'failed', refundId: refund.id };
  }
  await L.cas(env, 'refunds', refund.id, ['pending'], { status: 'needs_review' });
  await L.cas(env, 'payments', payment.id, ['refund_pending'], { status: 'needs_review', failure_code: 'refund_outcome_unknown' });
  await ev(env, order, payment, 'refund_needs_review', 'refund_pending', 'needs_review', null);
  return { status: 'needs_review', refundId: refund.id };
}

// ---------------------------------------------------------------- 5. webhooks (already signature-verified by the adapter)
export async function applyWebhookEvent(env, providerName, e) {
  const find = async () => (e.providerCaptureId && await L.find(env, 'payments', `provider=eq.${providerName}&provider_capture_id=eq.${encodeURIComponent(e.providerCaptureId)}`))
    || (e.providerPaymentId && await L.find(env, 'payments', `provider=eq.${providerName}&provider_payment_id=eq.${encodeURIComponent(e.providerPaymentId)}`)) || null;
  const payment = await find(), order = payment && await L.find(env, 'orders', `id=eq.${payment.order_id}`);
  const rec = await L.event(env, { order_id: order && order.id, payment_id: payment && payment.id, source: 'webhook', event_type: e.type, provider: providerName, provider_event_id: e.providerEventId, detail: { providerType: e.providerType, amount: e.amount, currency: e.currency } });
  if (rec.duplicate) return { duplicate: true };              // same event delivered twice
  if (!payment) return { ignored: 'unknown payment' };
  switch (e.type) {
    case 'payment.failed': await L.cas(env, 'payments', payment.id, ['pending', 'processing', 'authorized'], { status: 'failed', failure_code: 'provider_denied' }); break;
    case 'payment.reversed': case 'payment.disputed':          // chargeback or reversal: a person must review it
      await L.cas(env, 'payments', payment.id, ['paid', 'partially_refunded', 'refund_pending'], { status: 'needs_review', failure_code: e.type });
      await L.cas(env, 'orders', order.id, ['confirmed'], { status: 'needs_review', last_error: e.type }); break;
    case 'refund.completed': {                                 // a refund finished (maybe started outside our system)
      const have = e.providerRefundId && await L.find(env, 'refunds', `payment_id=eq.${payment.id}&provider_refund_id=eq.${encodeURIComponent(e.providerRefundId)}`);
      if (have) { await L.cas(env, 'refunds', have.id, ['pending'], { status: 'completed' }); break; }
      const amt = Math.round(Number(e.amount) * 100) / 100; if (!(amt > 0)) break;
      const total = Math.round((Number(payment.refunded_amount) + amt) * 100) / 100;
      if (total > Number(payment.amount)) { await L.cas(env, 'payments', payment.id, ['paid', 'partially_refunded', 'refund_pending'], { status: 'needs_review', failure_code: 'refund_exceeds_payment' }); break; }
      await L.insert(env, 'refunds', { payment_id: payment.id, idempotency_key: 'webhook-' + e.providerEventId, provider_refund_id: e.providerRefundId, amount: two(amt), currency: payment.currency, status: 'completed', reason: 'refund recorded from provider', requested_by: 'provider' }).catch((er) => { if (er.code !== 'conflict') throw er; });
      await L.cas(env, 'payments', payment.id, ['paid', 'partially_refunded', 'refund_pending'], { status: total >= Number(payment.amount) ? 'refunded' : 'partially_refunded', refunded_amount: two(total) }); break; }
    default: break;                                            // payment.paid / pending: our own capture flow owns these states; the event is only logged
  }
  return { applied: e.type };
}

// ---------------------------------------------------------------- 6. recovery: look again at an order that needs review
export async function reconcileOrder(env, orderId) {
  const order = await L.find(env, 'orders', `id=eq.${orderId}`); if (!order) throw new Fail(404, 'Order not found.');
  const payment = await L.find(env, 'payments', `order_id=eq.${order.id}&order=created_at.desc`);
  if (order.status === 'confirmed') return { result: 'already_confirmed' };
  const req = order.booking_request || {};
  const found = req.passengers ? await D.findRecentOrder(env, { lastName: req.passengers[0].lastName, amount: order.fare_amount, currency: order.currency, route: req.route, since: Date.parse(order.created_at) }) : { outcome: 'none' };
  if (found.outcome === 'found') { await confirmOrder(env, order, payment, found.order, true); return { result: 'booking_found_and_linked', bookingReference: found.order.booking_reference }; }
  return { result: found.outcome === 'unavailable' ? 'supplier_unavailable' : 'no_booking_found' };
}
