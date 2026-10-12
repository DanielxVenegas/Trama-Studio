const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, sampleBody, paidSession } = require('./helpers');

const be = loadBackend();
const { OrderError } = be.orders;
after(() => be.close());
beforeEach(() => be.reset());

const rejectsOrder = (fn, status, code) => assert.throws(fn, e => e instanceof OrderError && e.status === status && (code === undefined || e.code === code));

test('prepareOrder recalcula precios con el catálogo y no confía en los del navegador', () => {
  const body = sampleBody({ items: [{ kind: 'stock', id: 'prod-01', size: 'M', qty: 2, price: 1, unitPrice: 1 }], total: 1 });
  const o = be.orders.prepareOrder(body);
  assert.equal(o.items[0].unitPrice, 189);
  assert.equal(o.subtotal, 378);
  assert.equal(o.shipping, 79);
  assert.equal(o.total, 457);
});

test('prepareOrder aplica envío gratis desde el umbral y descuentos de códigos válidos', () => {
  const items = [{ kind: 'stock', id: 'prod-03', size: 'M', qty: 4 }];
  assert.equal(be.orders.prepareOrder(sampleBody({ items })).total, 956);

  const promo = be.orders.prepareOrder(sampleBody({ items, promo: 'lanzamiento' }));
  assert.equal(promo.promo, 'LANZAMIENTO');
  assert.equal(promo.discount, 143);
  assert.equal(promo.total, 813);
});

test('prepareOrder ignora códigos promocionales desconocidos', () => {
  const o = be.orders.prepareOrder(sampleBody({ promo: 'GRATIS100' }));
  assert.equal(o.promo, null);
  assert.equal(o.discount, 0);
});

test('prepareOrder calcula el precio de una prenda personalizada en el servidor', () => {
  const o = be.orders.prepareOrder(sampleBody({
    items: [{ kind: 'custom', cut: 'regular', color: '#2F4BFF', size: 'L', qty: 1, text: 'Hola', fontId: 'display', unitPrice: 1 }]
  }));
  assert.equal(o.items[0].unitPrice, 169 + 60);
});

test('prepareOrder rechaza datos inválidos', () => {
  const customer = sampleBody().customer;
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ customer: { ...customer, email: 'no-es-correo' } })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ customer: { ...customer, zip: '123' } })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ customer: { ...customer, phone: '123' } })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ payMethod: 'bitcoin' })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ items: [] })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ items: [{ kind: 'stock', id: 'prod-99', size: 'M', qty: 1 }] })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ items: [{ kind: 'stock', id: 'prod-04', size: 'S', qty: 1 }] })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ items: [{ kind: 'stock', id: 'prod-01', size: 'M', qty: 0 }] })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ items: [{ kind: 'stock', id: 'prod-01', size: 'M', qty: 21 }] })), 400);
  rejectsOrder(() => be.orders.prepareOrder(sampleBody({ items: [{ kind: 'custom', cut: 'regular', color: 'rojo', size: 'M', qty: 1 }] })), 400);
});

test('completePaidCheckout crea el pedido pagado y descuenta el stock', () => {
  const body = sampleBody();
  be.orders.savePendingCheckout('cs_test_ok1', body);
  const r = be.orders.completePaidCheckout(paidSession('cs_test_ok1', 457));

  assert.equal(r.created, true);
  assert.match(r.folio, /^TS-\d{5}$/);
  assert.equal(r.email, 'cliente@example.com');
  assert.equal(r.total, 457);
  assert.equal(r.order.customer.firstName, 'Ana');
  assert.equal(be.db.prepare('SELECT status FROM orders WHERE folio = ?').get(r.folio).status, 'pagado');
  assert.equal(be.stock('prod-01'), 22);
});

test('completePaidCheckout es idempotente: repetirlo no duplica pedido ni descuenta de nuevo', () => {
  be.orders.savePendingCheckout('cs_test_idem1', sampleBody());
  const first = be.orders.completePaidCheckout(paidSession('cs_test_idem1', 457));
  const second = be.orders.completePaidCheckout(paidSession('cs_test_idem1', 457));

  assert.equal(second.created, false);
  assert.equal(second.folio, first.folio);
  assert.equal(be.orderCount(), 1);
  assert.equal(be.stock('prod-01'), 22);
});

test('completePaidCheckout no crea pedido si el pago no está confirmado', () => {
  be.orders.savePendingCheckout('cs_test_unpaid1', sampleBody());
  rejectsOrder(() => be.orders.completePaidCheckout(paidSession('cs_test_unpaid1', 457, { payment_status: 'unpaid' })), 409);
  assert.equal(be.orderCount(), 0);
  assert.equal(be.stock('prod-01'), 24);
});

test('completePaidCheckout rechaza un total distinto al calculado por el servidor', () => {
  be.orders.savePendingCheckout('cs_test_mismatch1', sampleBody());
  rejectsOrder(() => be.orders.completePaidCheckout(paidSession('cs_test_mismatch1', 100)), 409);
  assert.equal(be.orderCount(), 0);
});

test('completePaidCheckout falla con 503 si no existe el borrador de la sesión', () => {
  rejectsOrder(() => be.orders.completePaidCheckout(paidSession('cs_test_sinborrador1', 457)), 503);
});

test('completePaidCheckout sin stock suficiente falla con out_of_stock y no deja pedido ni stock a medias', () => {
  be.setStock('prod-04', 1);
  const body = sampleBody({ items: [{ kind: 'stock', id: 'prod-04', size: 'M', qty: 2 }] });
  be.orders.savePendingCheckout('cs_test_nostock1', body);

  rejectsOrder(() => be.orders.completePaidCheckout(paidSession('cs_test_nostock1', 557)), 409, 'out_of_stock');
  assert.equal(be.orderCount(), 0);
  assert.equal(be.stock('prod-04'), 1);
  assert.equal(be.orders.getPendingCheckout('cs_test_nostock1').folio, null);
});

const insertDraft = (id, folio, age) => be.db.prepare(
  "INSERT INTO checkout_sessions (session_id, payload, folio, created_at) VALUES (?, '{}', ?, datetime('now', ?))"
).run(id, folio, age);

test('purgeStaleCheckouts borra solo borradores sin pedido con más de 24 horas', () => {
  insertDraft('cs_test_viejo1', null, '-25 hours');
  insertDraft('cs_test_viejo2', 'TS-00001', '-25 hours');
  insertDraft('cs_test_reciente1', null, '-1 hours');

  assert.equal(be.orders.purgeStaleCheckouts(24), 1);
  assert.equal(be.orders.getPendingCheckout('cs_test_viejo1'), undefined);
  assert.ok(be.orders.getPendingCheckout('cs_test_viejo2'));
  assert.ok(be.orders.getPendingCheckout('cs_test_reciente1'));
});

test('discardPendingCheckout no toca borradores que ya generaron pedido', () => {
  insertDraft('cs_test_abandonado1', null, '-1 hours');
  insertDraft('cs_test_cerrado1', 'TS-00002', '-1 hours');

  assert.equal(be.orders.discardPendingCheckout('cs_test_abandonado1'), 1);
  assert.equal(be.orders.discardPendingCheckout('cs_test_cerrado1'), 0);
  assert.equal(be.orders.discardPendingCheckout('cs_test_inexistente1'), 0);
  assert.ok(be.orders.getPendingCheckout('cs_test_cerrado1'));
});
