const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadBackend, sampleBody, paidSession, stripeFake } = require('./helpers');

process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';

const be = loadBackend();
const { PaymentError } = be.payments;
const { OrderError } = be.orders;
after(() => be.close());
beforeEach(() => be.reset());

const SECRET = 'whsec_testsecret';
const now = () => Math.floor(Date.now() / 1000);
const sign = (raw, ts = now(), secret = SECRET) => `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;
const event = (type, object) => JSON.stringify({ id: 'evt_test1', type, data: { object } });
const isPaymentError = status => e => e instanceof PaymentError && e.status === status;

/* Pedido con stock insuficiente: quedan 1 pieza de prod-04 y se compran 2 (subtotal 478 + envío 79 = 557) */
function pendingWithoutStock(id) {
  be.setStock('prod-04', 1);
  be.orders.savePendingCheckout(id, sampleBody({ items: [{ kind: 'stock', id: 'prod-04', size: 'M', qty: 2 }] }));
  return paidSession(id, 557);
}

test('verifyWebhook acepta una firma válida', () => {
  const raw = event('ping', {});
  assert.equal(be.payments.verifyWebhook(raw, sign(raw)).type, 'ping');
});

test('verifyWebhook rechaza firmas incorrectas, vencidas o ausentes', () => {
  const raw = event('ping', {});
  assert.throws(() => be.payments.verifyWebhook(raw, sign(raw, now(), 'whsec_otro')), isPaymentError(400));
  assert.throws(() => be.payments.verifyWebhook(raw, sign(raw, now() - 3600)), isPaymentError(400));
  assert.throws(() => be.payments.verifyWebhook(raw + ' ', sign(raw)), isPaymentError(400));
  assert.throws(() => be.payments.verifyWebhook(raw, ''), isPaymentError(400));
  assert.throws(() => be.payments.verifyWebhook(raw, `t=${now()},v1=zz`), isPaymentError(400));
});

test('verifyWebhook exige STRIPE_WEBHOOK_SECRET configurado', () => {
  const raw = event('ping', {});
  const header = sign(raw);
  process.env.STRIPE_WEBHOOK_SECRET = '';
  try { assert.throws(() => be.payments.verifyWebhook(raw, header), isPaymentError(503)); }
  finally { process.env.STRIPE_WEBHOOK_SECRET = SECRET; }
});

test('createCheckoutSession guarda el borrador, fija el vencimiento y devuelve la URL de Stripe', async () => {
  const fake = stripeFake();
  try {
    const before = now();
    const r = await be.payments.createCheckoutSession(sampleBody());
    assert.equal(r.url, 'https://checkout.stripe.com/c/pay/cs_test_nueva1');
    assert.ok(be.orders.getPendingCheckout('cs_test_nueva1'));

    const params = new URLSearchParams(fake.calls[0].body);
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), String(378 * 100));
    assert.equal(params.get('line_items[1][price_data][unit_amount]'), String(79 * 100));
    const ttl = Number(params.get('expires_at')) - before;
    assert.ok(ttl > 3600 && ttl <= 12 * 3600 + 5, `vencimiento inesperado: ${ttl} s`);
  } finally { fake.restore(); }
});

test('el webhook checkout.session.completed crea el pedido y es idempotente', async () => {
  const fake = stripeFake();
  try {
    be.orders.savePendingCheckout('cs_test_hook1', sampleBody());
    const raw = event('checkout.session.completed', paidSession('cs_test_hook1', 457));

    assert.deepEqual(await be.payments.handleWebhook(raw, sign(raw)), { received: true });
    assert.equal(be.orderCount(), 1);
    assert.equal(be.stock('prod-01'), 22);

    const callsAfterFirst = fake.calls.length;
    assert.deepEqual(await be.payments.handleWebhook(raw, sign(raw)), { received: true });
    assert.equal(be.orderCount(), 1);
    assert.equal(be.stock('prod-01'), 22);
    assert.equal(fake.calls.length, callsAfterFirst, 'la segunda entrega no debe consultar a Stripe');
  } finally { fake.restore(); }
});

test('el webhook ignora pagos no confirmados y eventos desconocidos', async () => {
  const fake = stripeFake();
  try {
    be.orders.savePendingCheckout('cs_test_hook2', sampleBody());
    const unpaid = event('checkout.session.completed', paidSession('cs_test_hook2', 457, { payment_status: 'unpaid' }));
    assert.deepEqual(await be.payments.handleWebhook(unpaid, sign(unpaid)), { received: true });
    const other = event('charge.updated', {});
    assert.deepEqual(await be.payments.handleWebhook(other, sign(other)), { received: true });
    assert.equal(be.orderCount(), 0);
  } finally { fake.restore(); }
});

test('pago sin stock: el webhook reembolsa automáticamente y no crea pedido', async () => {
  const fake = stripeFake();
  try {
    const session = pendingWithoutStock('cs_test_stock1');
    const raw = event('checkout.session.completed', session);

    assert.deepEqual(await be.payments.handleWebhook(raw, sign(raw)), { received: true, refunded: true });

    const refund = fake.calls.find(c => c.method === 'POST' && c.url.endsWith('/v1/refunds'));
    assert.ok(refund, 'debió solicitar el reembolso');
    assert.equal(new URLSearchParams(refund.body).get('payment_intent'), session.payment_intent);
    assert.equal(refund.headers['Idempotency-Key'], 'refund-cs_test_stock1');
    assert.equal(be.orderCount(), 0);
    assert.equal(be.stock('prod-04'), 1);
  } finally { fake.restore(); }
});

test('pago sin stock al volver de Stripe: reembolsa y avisa al cliente', async () => {
  const session = pendingWithoutStock('cs_test_stock2');
  const fake = stripeFake({ session });
  try {
    await assert.rejects(be.payments.completeCheckout('cs_test_stock2'), e =>
      e instanceof OrderError && e.status === 409 && /reembolsado/.test(e.message) && /Ya no hay stock/.test(e.message));
    assert.equal(fake.calls.filter(c => c.method === 'POST').length, 1);
    assert.equal(be.orderCount(), 0);
  } finally { fake.restore(); }
});

test('si el pago ya fue reembolsado no se crea pedido ni se reembolsa otra vez', async () => {
  const session = paidSession('cs_test_refunded1', 457);
  const fake = stripeFake({ session, refunds: [{ id: 're_previo', status: 'succeeded' }] });
  try {
    be.orders.savePendingCheckout('cs_test_refunded1', sampleBody());
    await assert.rejects(be.payments.completeCheckout('cs_test_refunded1'), e => e instanceof OrderError && e.code === 'refunded');

    const raw = event('checkout.session.completed', session);
    assert.deepEqual(await be.payments.handleWebhook(raw, sign(raw)), { received: true, refunded: true });
    assert.equal(be.orderCount(), 0);
    assert.equal(fake.calls.filter(c => c.method === 'POST').length, 0);
  } finally { fake.restore(); }
});

test('si el reembolso automático falla, el error llega a Stripe para que reintente el webhook', async () => {
  const fake = stripeFake({ failRefund: true });
  try {
    const session = pendingWithoutStock('cs_test_stock3');
    const raw = event('checkout.session.completed', session);
    await assert.rejects(be.payments.handleWebhook(raw, sign(raw)), e =>
      e instanceof PaymentError && e.status === 502 && e.message.includes('cs_test_stock3'));
    assert.equal(be.orderCount(), 0);
  } finally { fake.restore(); }
});

test('completeCheckout devuelve solo los datos públicos del pedido', async () => {
  const session = paidSession('cs_test_ok2', 457);
  const fake = stripeFake({ session });
  try {
    be.orders.savePendingCheckout('cs_test_ok2', sampleBody());
    const r = await be.payments.completeCheckout('cs_test_ok2');
    assert.deepEqual(Object.keys(r).sort(), ['email', 'folio', 'total']);
    assert.match(r.folio, /^TS-\d{5}$/);
    assert.equal(r.total, 457);
  } finally { fake.restore(); }
});

test('el webhook checkout.session.expired descarta el borrador, salvo si ya hay pedido', async () => {
  const fake = stripeFake();
  try {
    be.orders.savePendingCheckout('cs_test_exp1', sampleBody());
    const expired = event('checkout.session.expired', { id: 'cs_test_exp1' });
    assert.deepEqual(await be.payments.handleWebhook(expired, sign(expired)), { received: true });
    assert.equal(be.orders.getPendingCheckout('cs_test_exp1'), undefined);

    be.orders.savePendingCheckout('cs_test_exp2', sampleBody());
    be.orders.completePaidCheckout(paidSession('cs_test_exp2', 457));
    const lateExpired = event('checkout.session.expired', { id: 'cs_test_exp2' });
    await be.payments.handleWebhook(lateExpired, sign(lateExpired));
    assert.ok(be.orders.getPendingCheckout('cs_test_exp2'));
  } finally { fake.restore(); }
});
