/* Base de datos SQLite (node:sqlite, nativo de Node, sin dependencias).
   Guarda pedidos, sus prendas y el stock editable desde el panel del administrador. */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { CATALOG } = require('./catalog');

const DIR = path.join(__dirname, 'data');
fs.mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(path.join(DIR, 'trama.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS stock (
    product_id TEXT PRIMARY KEY,
    qty INTEGER NOT NULL CHECK (qty >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pendiente'
      CHECK (status IN ('pendiente','pagado','en_produccion','enviado','entregado','cancelado')),
    email TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL,
    address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL,
    pay_method TEXT NOT NULL CHECK (pay_method IN ('card','oxxo','spei')),
    promo_code TEXT, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL,
    shipping INTEGER NOT NULL, total INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('stock','custom')),
    product_id TEXT, name TEXT NOT NULL, cut TEXT NOT NULL, color TEXT NOT NULL,
    size TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0), unit_price INTEGER NOT NULL,
    text TEXT, font_id TEXT, text_color TEXT, preset_key TEXT, notes TEXT, thumb TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
`);

/* Siembra el stock inicial desde PRODUCTS la primera vez (no pisa valores ya editados) */
const seedStock = db.prepare('INSERT OR IGNORE INTO stock (product_id, qty) VALUES (?, ?)');
for (const p of CATALOG.PRODUCTS) seedStock.run(p.id, p.stock);

/* Helper de transacciones: BEGIN IMMEDIATE / COMMIT / ROLLBACK alrededor de fn() */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) {}
    throw e;
  }
}

module.exports = { db, tx };
