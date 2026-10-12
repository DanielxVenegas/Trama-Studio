/* Utilidades compartidas por las pruebas (node:test, sin dependencias).
   loadBackend() copia server/ y js/data.js a una carpeta temporal antes de cargarlos, así db.js crea su
   base SQLite ahí (server/data) y las pruebas jamás tocan la base real del proyecto. */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LOG_LEVEL = 'silent';
const SRC = path.join(__dirname, '..');

function loadBackend() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trama-test-'));
  fs.mkdirSync(path.join(root, 'js'));
  fs.copyFileSync(path.join(SRC, 'js', 'data.js'), path.join(root, 'js', 'data.js'));
  fs.cpSync(path.join(SRC, 'server'), path.join(root, 'server'), { recursive: true, filter: src => path.basename(src) !== 'data' });

  const load = name => require(path.join(root, 'server', name));
  const { db } = load('db.js');
  const { CATALOG } = load('catalog.js');

  return {
    root, db, CATALOG,
    orders: load('orders.js'), payments: load('payments.js'), admin: load('admin.js'),
    /* Deja la base como recién creada: sin pedidos ni borradores y con el stock inicial del catálogo */
    reset() {
      db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM checkout_sessions;');
      const set = db.prepare('UPDATE stock SET qty = ? WHERE product_id = ?');
      for (const p of CATALOG.PRODUCTS) set.run(p.stock, p.id);
    },
    stock(productId) { return db.prepare('SELECT qty FROM stock WHERE product_id = ?').get(productId).qty; },
    setStock(productId, qty) { db.prepare('UPDATE stock SET qty = ? WHERE product_id = ?').run(qty, productId); },
    orderCount() { return db.prepare('SELECT COUNT(*) AS n FROM orders').get().n; },
    close() {
      try { db.close(); } catch (e) {}
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (e) {}
    }
  };
}

/* Pedido de ejemplo válido: 2 x "Básica Cobalto" (189 c/u) -> subtotal 378, envío 79, total 457 */
const sampleBody = (overrides = {}) => ({
  customer: {
    email: 'cliente@example.com', firstName: 'Ana', lastName: 'Prueba', address: 'Calle 1 #2',
    city: 'Ciudad de México', state: 'CDMX', zip: '01000', phone: '5512345678'
  },
  payMethod: 'card',
  promo: '',
  items: [{ kind: 'stock', id: 'prod-01', size: 'M', qty: 2 }],
  ...overrides
});

/* Sesión de Stripe Checkout pagada, con la forma que usa el servidor */
const paidSession = (id, total, overrides = {}) => ({
  id, mode: 'payment', currency: 'mxn', payment_status: 'paid', amount_total: total * 100,
  payment_intent: 'pi_test_' + id.slice('cs_test_'.length), ...overrides
});

/* Sustituye fetch por un doble que registra las llamadas. handler({url, method, headers, body}) -> { status?, body? } */
function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? String(init.body) : '' };
    calls.push(call);
    const out = await handler(call);
    return new Response(JSON.stringify(out.body === undefined ? {} : out.body), {
      status: out.status || 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

/* Doble de la API de Stripe: sesión consultable, lista de reembolsos y creación de reembolsos */
function stripeFake({ session, refunds = [], failRefund = false } = {}) {
  return installFetch(call => {
    const u = new URL(call.url);
    if (u.pathname === '/v1/refunds' && call.method === 'GET') return { body: { data: refunds } };
    if (u.pathname === '/v1/refunds' && call.method === 'POST') {
      return failRefund ? { status: 400, body: { error: { message: 'refund_boom' } } } : { body: { id: 're_test1', status: 'succeeded' } };
    }
    if (u.pathname.startsWith('/v1/checkout/sessions/') && call.method === 'GET') return { body: session };
    if (u.pathname === '/v1/checkout/sessions' && call.method === 'POST') {
      return { body: { id: 'cs_test_nueva1', url: 'https://checkout.stripe.com/c/pay/cs_test_nueva1' } };
    }
    return { status: 404, body: { error: { message: `ruta inesperada ${call.method} ${u.pathname}` } } };
  });
}

/* Aplica variables de entorno durante fn() y las restaura al terminar (undefined = borrar) */
async function withEnv(vars, fn) {
  const previous = {};
  for (const [k, v] of Object.entries(vars)) { previous[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

module.exports = { loadBackend, sampleBody, paidSession, installFetch, stripeFake, withEnv };
