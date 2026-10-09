/* Panel del administrador: login por contraseña con cookie firmada (HMAC, sin librerías),
   listado y detalle de pedidos, cambio de estado (repone stock al cancelar) y edición de stock. */
const crypto = require('crypto');
const { db, tx } = require('./db');
const { CATALOG } = require('./catalog');

const { ADMIN_PASSWORD, SESSION_SECRET, PUBLIC_URL } = process.env;
const COOKIE_NAME = 'trama_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 20;
const STATUSES = ['pendiente', 'pagado', 'en_produccion', 'enviado', 'entregado', 'cancelado'];

class AdminError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const configured = () => !!(ADMIN_PASSWORD && SESSION_SECRET);
const isSecure = () => /^https:/i.test(PUBLIC_URL || '');
const sign = exp => crypto.createHmac('sha256', SESSION_SECRET).update(exp).digest('hex');

function sessionCookie() {
  const exp = String(Date.now() + SESSION_MS);
  return `${COOKIE_NAME}=${exp}.${sign(exp)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS / 1000)}${isSecure() ? '; Secure' : ''}`;
}
function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${isSecure() ? '; Secure' : ''}`;
}

function parseCookies(req) {
  const out = {}, header = req.headers.cookie || '';
  header.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i === -1) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  if (!configured()) return false;
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot === -1) return false;
  const exp = raw.slice(0, dot), sig = raw.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Tope de intentos de login: 5 cada 15 minutos por IP, para frenar fuerza bruta */
const loginHits = new Map();
function loginLimited(ip) {
  const now = Date.now(), windowMs = 15 * 60 * 1000;
  const arr = (loginHits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= 5) return true;
  arr.push(now); loginHits.set(ip, arr);
  return false;
}

function login(password, ip) {
  if (!configured()) throw new AdminError(503, 'El panel del administrador no está configurado.');
  if (loginLimited(ip)) throw new AdminError(429, 'Demasiados intentos. Prueba más tarde.');
  const given = Buffer.from(String(password || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) throw new AdminError(401, 'Contraseña incorrecta.');
  return sessionCookie();
}

function listOrders({ status, q, page }) {
  const where = [], params = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(folio LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${whereSql}`).get(...params).n;
  const rows = db.prepare(`
    SELECT folio, status, email, first_name, last_name, total, created_at
    FROM orders ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...params, PAGE_SIZE, offset);

  return { rows, total, page: pageNum, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

function getOrder(folio) {
  const order = db.prepare('SELECT * FROM orders WHERE folio = ?').get(folio);
  if (!order) throw new AdminError(404, 'Pedido no encontrado.');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  return { order, items };
}

function setOrderStatus(folio, status) {
  if (!STATUSES.includes(status)) throw new AdminError(400, 'Estado inválido.');
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE folio = ?').get(folio);
    if (!order) throw new AdminError(404, 'Pedido no encontrado.');
    if (order.status === 'cancelado' && status !== 'cancelado') throw new AdminError(400, 'No se puede reabrir un pedido cancelado.');

    if (status === 'cancelado' && order.status !== 'cancelado') {
      const items = db.prepare("SELECT product_id, qty FROM order_items WHERE order_id = ? AND kind = 'stock'").all(order.id);
      const restore = db.prepare("UPDATE stock SET qty = qty + ?, updated_at = datetime('now') WHERE product_id = ?");
      for (const it of items) restore.run(it.qty, it.product_id);
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    return { folio, status };
  });
}

function listStock() {
  const byId = new Map(db.prepare('SELECT product_id, qty FROM stock').all().map(r => [r.product_id, r.qty]));
  return CATALOG.PRODUCTS.map(p => ({ id: p.id, name: p.name, cut: p.cut, color: p.color, sizes: p.sizes, qty: byId.get(p.id) ?? 0 }));
}

function setStock(id, qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new AdminError(400, 'La cantidad debe ser un número entero entre 0 y 9999.');
  if (!CATALOG.PRODUCTS.some(p => p.id === id)) throw new AdminError(404, 'Producto no encontrado.');
  const r = db.prepare("UPDATE stock SET qty = ?, updated_at = datetime('now') WHERE product_id = ?").run(n, id);
  if (Number(r.changes) === 0) throw new AdminError(404, 'Producto no encontrado.');
  return { id, qty: n };
}

module.exports = {
  configured, isAuthed, login, sessionCookie, clearSessionCookie,
  listOrders, getOrder, setOrderStatus, listStock, setStock, AdminError, STATUSES
};
