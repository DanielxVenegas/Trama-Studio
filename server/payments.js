const crypto = require('crypto');
const { quoteOrder, savePendingCheckout, completePaidCheckout, OrderError } = require('./orders');

class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const testSecret = () => process.env.STRIPE_SECRET_KEY || '';
const configured = () => /^sk_test_[A-Za-z0-9]+$/.test(testSecret());

function requireStripe() {
  const secret = testSecret();
  if (!/^sk_test_[A-Za-z0-9]+$/.test(secret)) {
    throw new PaymentError(503, 'Configura STRIPE_SECRET_KEY con una clave de prueba de Stripe en .env.');
  }
  return secret;
}

async function stripeRequest(endpoint, { method = 'POST', params } = {}) {
  const secret = requireStripe();
  let response;
  try {
    response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
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

async function completeCheckout(sessionId) {
  const session = await retrieveCheckoutSession(sessionId);
  if (session.mode !== 'payment' || session.currency !== 'mxn') throw new OrderError(400, 'La sesión de pago no corresponde a este pedido.');
  return completePaidCheckout(session);
}

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

function handleWebhook(rawBody, signature) {
  const event = verifyWebhook(rawBody, signature);
  if (event.type === 'checkout.session.completed' && event.data && event.data.object && event.data.object.payment_status === 'paid') {
    completePaidCheckout(event.data.object);
  }
  return { received: true };
}

module.exports = { configured, createCheckoutSession, completeCheckout, handleWebhook, PaymentError };
