const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, sampleBody, paidSession, stripeFake, installFetch } = require('./helpers');

process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';

const be = loadBackend();
const { AdminError } = be.admin;
after(() => be.close());
beforeEach(() => be.reset());

/* Crea un pedido pagado (2 x prod-01, stock 24 -> 22) ligado a su sesión de Stripe */
function paidOrder(sessionId) {
  be.orders.savePendingCheckout(sessionId, sampleBody());
  return be.orders.completePaidCheckout(paidSession(sessionId, 457)).folio;
}
const statusOf = folio => be.db.prepare('SELECT status FROM orders WHERE folio = ?').get(folio).status;

test('cancelar un pedido pagado reembolsa en Stripe y repone el stock', async () => {
  const folio = paidOrder('cs_test_adm1');
  assert.equal(be.stock('prod-01'), 22);
  const fake = stripeFake({ session: paidSession('cs_test_adm1', 457) });
  try {
    const r = await be.admin.updateOrderStatus(folio, 'cancelado');
    assert.deepEqual({ ...r }, { folio, status: 'cancelado', refunded: true });
    assert.equal(statusOf(folio), 'cancelado');
    assert.equal(be.stock('prod-01'), 24);

    const refunds = fake.calls.filter(c => c.method === 'POST');
    assert.equal(refunds.length, 1);
    assert.equal(new URLSearchParams(refunds[0].body).get('reason'), 'requested_by_customer');
    assert.equal(refunds[0].headers['Idempotency-Key'], 'refund-cs_test_adm1');
  } finally { fake.restore(); }
});

test('si el pago ya estaba reembolsado, cancelar no crea otro reembolso', async () => {
  const folio = paidOrder('cs_test_adm2');
  const fake = stripeFake({ session: paidSession('cs_test_adm2', 457), refunds: [{ status: 'succeeded' }] });
  try {
    const r = await be.admin.updateOrderStatus(folio, 'cancelado');
    assert.equal(r.refunded, true);
    assert.equal(statusOf(folio), 'cancelado');
    assert.equal(fake.calls.filter(c => c.method === 'POST').length, 0);
  } finally { fake.restore(); }
});

test('si el reembolso falla, el pedido no se cancela y el stock no se repone', async () => {
  const folio = paidOrder('cs_test_adm3');
  const fake = stripeFake({ session: paidSession('cs_test_adm3', 457), failRefund: true });
  try {
    await assert.rejects(be.admin.updateOrderStatus(folio, 'cancelado'), e =>
      e instanceof AdminError && e.status === 502 && /refund_boom/.test(e.message));
    assert.equal(statusOf(folio), 'pagado');
    assert.equal(be.stock('prod-01'), 22);
  } finally { fake.restore(); }
});

test('cancelar un pedido que no pasó por Stripe no consulta a Stripe', async () => {
  const { folio } = be.orders.createOrder(sampleBody());
  const fake = installFetch(() => { throw new Error('no debía llamar a Stripe'); });
  try {
    const r = await be.admin.updateOrderStatus(folio, 'cancelado');
    assert.equal(r.refunded, false);
    assert.equal(statusOf(folio), 'cancelado');
    assert.equal(fake.calls.length, 0);
  } finally { fake.restore(); }
});

test('otros cambios de estado no tocan Stripe', async () => {
  const folio = paidOrder('cs_test_adm4');
  const fake = installFetch(() => { throw new Error('no debía llamar a Stripe'); });
  try {
    const r = await be.admin.updateOrderStatus(folio, 'enviado');
    assert.deepEqual({ ...r }, { folio, status: 'enviado', refunded: false });
    assert.equal(fake.calls.length, 0);
  } finally { fake.restore(); }
});

test('updateOrderStatus valida el estado y el folio, y no reabre pedidos cancelados', async () => {
  const folio = paidOrder('cs_test_adm5');
  await assert.rejects(be.admin.updateOrderStatus(folio, 'inventado'), e => e instanceof AdminError && e.status === 400);
  await assert.rejects(be.admin.updateOrderStatus('TS-99999', 'enviado'), e => e instanceof AdminError && e.status === 404);

  be.db.prepare("UPDATE orders SET status = 'cancelado' WHERE folio = ?").run(folio);
  await assert.rejects(be.admin.updateOrderStatus(folio, 'pagado'), e => e instanceof AdminError && e.status === 400);
});
