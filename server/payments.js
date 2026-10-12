const crypto = require('crypto');
const {
  quoteOrder, savePendingCheckout, completePaidCheckout, getPendingCheckout,
  discardPendingCheckout, findCheckoutSessionByFolio, OrderError
} = require('./orders');
const log = require('./log');

class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const testSecret = () => process.env.STRIPE_SECRET_KEY || '';
const configured = () => /^sk_test_[A-Za-z0-9]+$/.test(testSecret());

/* Las sesiones de pago vencen antes de las 24 h por defecto de Stripe, para que la limpieza de
   borradores (24 h en orders.purgeStaleCheckouts) nunca borre uno que todavía pueda recibir un pago. */
const SESSION_TTL_SECONDS = 12 * 3600;

function requireStripe() {
  const secret = testSecret();
  if (!/^sk_test_[A-Za-z0-9]+$/.test(secret)) {
    throw new PaymentError(503, 'Configura STRIPE_SECRET_KEY con una clave de prueba de Stripe en .env.');
  }
  return secret;
}

async function stripeRequest(endpoint, { method = 'POST', params, idempotencyKey } = {}) {
  const secret = requireStripe();
  const headers = { Authorization: `Bearer ${secret}` };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let response;
  try {
    response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
      method,
      headers,
      body: params ? params.toString() : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new PaymentError(502, 'No se pudo conectar con Stripe. Intenta de nuevo.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && data.error.message;
    throw new PaymentError(502, message || 'Stripe no pudo procesar la solicitud.');
  }
  return data;
}

function siteUrl() {
  const value = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  let url;
  try { url = new URL(value); } catch (e) { throw new PaymentError(500, 'PUBLIC_URL debe ser una URL válida.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new PaymentError(500, 'PUBLIC_URL debe usar HTTP o HTTPS.');
  return url.origin;
}

async function createCheckoutSession(body) {
  const quote = quoteOrder(body);
  if (body.payMethod !== 'card') throw new OrderError(400, 'Stripe Checkout solo está configurado para pagos con tarjeta.');
  if (quote.productsTotal <= 0) throw new OrderError(400, 'El total del pedido debe ser mayor que cero.');

  const baseUrl = siteUrl();
  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'mxn',
    'line_items[0][price_data][unit_amount]': String(quote.productsTotal * 100),
    'line_items[0][price_data][product_data][name]': 'Pedido Trama Studio',
    'line_items[0][price_data][product_data][description]': quote.description || 'Prendas Trama Studio',
    'line_items[0][quantity]': '1',
    customer_email: body.customer.email.trim(),
    locale: 'es-419',
    expires_at: String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS),
    success_url: `${baseUrl}/checkout.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/checkout.html?payment=cancelled`
  });
  if (quote.shipping > 0) {
    params.set('line_items[1][price_data][currency]', 'mxn');
    params.set('line_items[1][price_data][unit_amount]', String(quote.shipping * 100));
    params.set('line_items[1][price_data][product_data][name]', 'Envío estándar');
    params.set('line_items[1][quantity]', '1');
  }

  const session = await stripeRequest('checkout/sessions', { params });
  if (!session.id || !session.url) throw new PaymentError(502, 'Stripe no devolvió una sesión de pago válida.');
  savePendingCheckout(session.id, body);
  return { url: session.url };
}

async function retrieveCheckoutSession(sessionId) {
  if (typeof sessionId !== 'string' || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
    throw new OrderError(400, 'La sesión de pago no es válida.');
  }
  return stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
}

/* ---------- Reembolsos ---------- */

const paymentIntentId = value => (typeof value === 'string' && /^pi_[A-Za-z0-9_]+$/.test(value) ? value : '');

/* true si el pago ya tiene un reembolso vigente (hecho por este servidor o desde el panel de Stripe) */
async function hasActiveRefund(paymentIntent) {
  const list = await stripeRequest(`refunds?payment_intent=${encodeURIComponent(paymentIntent)}&limit=10`, { method: 'GET' });
  return (list.data || []).some(r => r.status !== 'failed' && r.status !== 'canceled');
}

/* Reembolsa el pago completo. Es idempotente: si ya hay un reembolso vigente no crea otro, y la
   llave de idempotencia evita duplicados si dos solicitudes llegan a la vez. */
async function refundPayment(paymentIntent, sessionId, reason) {
  const pi = paymentIntentId(paymentIntent);
  if (!pi) throw new PaymentError(502, 'No se encontró el pago de Stripe que se debe reembolsar.');
  if (await hasActiveRefund(pi)) return { refunded: true, already: true };

  const params = new URLSearchParams({ payment_intent: pi, 'metadata[trama_reason]': reason, 'metadata[checkout_session]': sessionId });
  if (reason === 'admin_cancel') params.set('reason', 'requested_by_customer');
  const refund = await stripeRequest('refunds', { params, idempotencyKey: `refund-${sessionId}` });
  return { refunded: true, already: false, id: refund.id };
}

/* Reembolsa el pago de un pedido existente (cancelación desde el panel). Los pedidos que no pasaron
   por Stripe (p. ej. creados antes de integrar pagos) no tienen nada que reembolsar. */
async function refundOrderPayment(folio) {
  const sessionId = findCheckoutSessionByFolio(folio);
  if (!sessionId) return { refunded: false, reason: 'no_stripe_payment' };
  const session = await retrieveCheckoutSession(sessionId);
  if (session.payment_status !== 'paid') return { refunded: false, reason: 'not_paid' };
  const result = await refundPayment(session.payment_intent, sessionId, 'admin_cancel');
  log.info('payments', `Pedido ${folio} reembolsado${result.already ? ' (ya existía un reembolso)' : ''}: ${sessionId}.`);
  return result;
}

/* ---------- Confirmación del pedido ---------- */

/* Convierte un pago confirmado en pedido. Se usa tanto al volver de Stripe como desde el webhook.
   - Si ya se reembolsó el pago (aunque haya sido desde el panel de Stripe) no se crea pedido.
   - Si el pago llegó pero ya no hay stock, se reembolsa solo para no cobrar sin entregar. */
async function finalizePaidSession(session) {
  const draft = session.payment_status === 'paid' ? getPendingCheckout(session.id) : null;
  if (draft && !draft.folio && paymentIntentId(session.payment_intent) && await hasActiveRefund(session.payment_intent)) {
    throw new OrderError(409, 'Este pago ya fue reembolsado, por lo que no se generó ningún pedido.', 'refunded');
  }

  try {
    const result = completePaidCheckout(session);
    if (result.created) log.info('payments', `Pedido ${result.folio} creado desde la sesión ${session.id}.`);
    return result;
  } catch (e) {
    if (!(e instanceof OrderError) || e.code !== 'out_of_stock') throw e;
    try {
      await refundPayment(session.payment_intent, session.id, 'out_of_stock');
    } catch (refundError) {
      log.error('payments', `Pago sin stock y reembolso automático fallido (${session.id}): ${log.detail(refundError)}`);
      throw new PaymentError(502, `${e.message} No pudimos reembolsar tu pago automáticamente; contáctanos e indica esta referencia: ${session.id}.`);
    }
    log.warn('payments', `Pago ${session.id} reembolsado automáticamente: ${e.message}`);
    throw new OrderError(409, `${e.message} Tu pago fue reembolsado automáticamente; el cargo puede tardar unos días en desaparecer de tu estado de cuenta.`, 'refunded');
  }
}

async function completeCheckout(sessionId) {
  const session = await retrieveCheckoutSession(sessionId);
  if (session.mode !== 'payment' || session.currency !== 'mxn') throw new OrderError(400, 'La sesión de pago no corresponde a este pedido.');
  const result = await finalizePaidSession(session);
  return { folio: result.folio, email: result.email, total: result.total };
}

/* ---------- Webhook ---------- */

function verifyWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret.startsWith('whsec_')) throw new PaymentError(503, 'Configura STRIPE_WEBHOOK_SECRET para activar la confirmación de pagos.');
  const parts = String(signature || '').split(',').reduce((all, part) => {
    const [key, value] = part.split('=', 2);
    if (key === 't') all.timestamp = value;
    if (key === 'v1') all.signatures.push(value);
    return all;
  }, { timestamp: '', signatures: [] });
  const timestamp = Number(parts.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.signatures.length) {
    throw new PaymentError(400, 'La firma del webhook de Stripe no es válida.');
  }

  const expected = crypto.createHmac('sha256', secret).update(`${parts.timestamp}.${rawBody}`).digest();
  const valid = parts.signatures.some(value => {
    if (!/^[a-f\d]{64}$/i.test(value)) return false;
    const actual = Buffer.from(value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
  if (!valid) throw new PaymentError(400, 'La firma del webhook de Stripe no es válida.');
  try { return JSON.parse(rawBody); } catch (e) { throw new PaymentError(400, 'El webhook de Stripe no contiene JSON válido.'); }
}

async function handleWebhook(rawBody, signature) {
  const event = verifyWebhook(rawBody, signature);
  const object = event.data && event.data.object;

  if (event.type === 'checkout.session.completed' && object && object.payment_status === 'paid') {
    try {
      await finalizePaidSession(object);
    } catch (e) {
      /* Pago ya reembolsado: no hay nada más que hacer, así que se responde 200 para que Stripe no reintente */
      if (e instanceof OrderError && e.code === 'refunded') return { received: true, refunded: true };
      throw e;
    }
  } else if (event.type === 'checkout.session.expired' && object && typeof object.id === 'string') {
    if (discardPendingCheckout(object.id)) log.info('payments', `Sesión de pago expirada, borrador descartado: ${object.id}.`);
  }
  return { received: true };
}

module.exports = {
  configured, createCheckoutSession, completeCheckout, handleWebhook, verifyWebhook,
  refundOrderPayment, PaymentError
};
