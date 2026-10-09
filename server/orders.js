/* Pedidos: valida los datos del cliente y las prendas, recalcula precios en el servidor
   (nunca confía en los que manda el navegador), descuenta stock de forma transaccional
   y guarda el pedido con un folio único. El pago sigue simulado: nunca llegan datos de tarjeta aquí. */
const { db, tx } = require('./db');
const { CATALOG, totals } = require('./catalog');

const MAX = { email: 120, name: 80, address: 160, city: 80, state: 80, notes: 400, text: 24 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const THUMB_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/;
const PAY_METHODS = new Set(['card', 'oxxo', 'spei']);
const MAX_THUMB_BYTES = 300 * 1024;

class OrderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const str = v => (typeof v === 'string' ? v.trim() : '');

function validateCustomer(raw) {
  const c = raw || {};
  const email = str(c.email), firstName = str(c.firstName), lastName = str(c.lastName);
  const address = str(c.address), city = str(c.city), state = str(c.state);
  const zip = str(c.zip), phone = str(c.phone).replace(/\D/g, '');

  if (!email || !EMAIL_RE.test(email) || email.length > MAX.email) throw new OrderError(400, 'Ingresa un correo válido.');
  if (!firstName || firstName.length > MAX.name) throw new OrderError(400, 'Escribe tu nombre.');
  if (!lastName || lastName.length > MAX.name) throw new OrderError(400, 'Escribe tus apellidos.');
  if (!address || address.length > MAX.address) throw new OrderError(400, 'Escribe tu calle y número.');
  if (!city || city.length > MAX.city) throw new OrderError(400, 'Escribe tu ciudad.');
  if (!state || state.length > MAX.state) throw new OrderError(400, 'Escribe tu estado.');
  if (!ZIP_RE.test(zip)) throw new OrderError(400, 'El código postal debe tener 5 dígitos.');
  if (phone.length < 10 || phone.length > 15) throw new OrderError(400, 'Escribe un teléfono a 10 dígitos.');

  return { email, firstName, lastName, address, city, state, zip, phone };
}

function validateItem(raw) {
  if (!raw || (raw.kind !== 'stock' && raw.kind !== 'custom')) throw new OrderError(400, 'Hay una prenda inválida en el carrito.');
  const qty = Number(raw.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new OrderError(400, 'La cantidad de una prenda no es válida.');

  if (raw.kind === 'stock') {
    const product = CATALOG.PRODUCTS.find(p => p.id === raw.id);
    if (!product) throw new OrderError(400, 'Una de las prendas en stock ya no existe.');
    const sizes = product.sizes.split(',').map(s => s.trim());
    const size = str(raw.size);
    if (!sizes.includes(size)) throw new OrderError(400, `Talla inválida para ${product.name}.`);
    return {
      kind: 'stock', productId: product.id, name: product.name, cut: product.cut, color: product.color,
      size, qty, unitPrice: product.price,
      text: null, fontId: null, textColor: null, presetKey: null, notes: null, thumb: null
    };
  }

  const cut = str(raw.cut);
  if (!CATALOG.CUTS[cut]) throw new OrderError(400, 'Corte inválido en una prenda personalizada.');
  const color = str(raw.color);
  if (!HEX_RE.test(color)) throw new OrderError(400, 'Color inválido en una prenda personalizada.');
  const size = str(raw.size);
  if (!CATALOG.SIZES.includes(size)) throw new OrderError(400, 'Talla inválida en una prenda personalizada.');

  const text = str(raw.text).slice(0, MAX.text) || null;
  const fontId = raw.fontId && CATALOG.FONTS.some(f => f.id === raw.fontId) ? raw.fontId : null;
  const textColor = raw.textColor && HEX_RE.test(raw.textColor) ? raw.textColor : null;
  const presetKey = raw.presetKey && CATALOG.PRESETS[raw.presetKey] ? raw.presetKey : null;
  const notes = str(raw.notes).slice(0, MAX.notes) || null;

  let thumb = null;
  if (raw.thumb) {
    if (typeof raw.thumb !== 'string' || !THUMB_RE.test(raw.thumb)) throw new OrderError(400, 'La imagen de una prenda personalizada no es válida.');
    if (raw.thumb.length * 3 / 4 > MAX_THUMB_BYTES) throw new OrderError(400, 'La imagen de una prenda personalizada pesa demasiado.');
    thumb = raw.thumb;
  }

  return {
    kind: 'custom', productId: null, name: `Playera ${CATALOG.CUTS[cut].name} personalizada`, cut, color, size, qty,
    unitPrice: CATALOG.CUTS[cut].price + CATALOG.PRINT_FEE,
    text, fontId, textColor, presetKey, notes, thumb
  };
}

function createOrder(body) {
  const b = body || {};
  const customer = validateCustomer(b.customer);
  const payMethod = str(b.payMethod);
  if (!PAY_METHODS.has(payMethod)) throw new OrderError(400, 'Elige un método de pago válido.');

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length === 0) throw new OrderError(400, 'Agrega al menos una prenda antes de pagar.');
  if (rawItems.length > 40) throw new OrderError(400, 'Hay demasiadas prendas en el pedido.');
  const items = rawItems.map(validateItem);

  const promoInput = str(b.promo).toUpperCase();
  const promo = promoInput && CATALOG.PROMOS[promoInput] != null ? promoInput : null;
  const { subtotal, discount, shipping, total } = totals(items, promo);

  return tx(() => {
    /* Suma las cantidades por producto para descontar el stock en un solo UPDATE por producto */
    const need = new Map();
    for (const it of items) if (it.kind === 'stock') need.set(it.productId, (need.get(it.productId) || 0) + it.qty);

    const dec = db.prepare("UPDATE stock SET qty = qty - ?, updated_at = datetime('now') WHERE product_id = ? AND qty >= ?");
    for (const [productId, qty] of need) {
      const r = dec.run(qty, productId, qty);
      if (Number(r.changes) === 0) {
        const name = (items.find(i => i.productId === productId) || {}).name || productId;
        throw new OrderError(409, `Ya no hay stock suficiente de "${name}".`);
      }
    }

    const insertOrder = db.prepare(`
      INSERT INTO orders (email, first_name, last_name, phone, address, city, state, zip,
        pay_method, promo_code, subtotal, discount, shipping, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const r = insertOrder.run(
      customer.email, customer.firstName, customer.lastName, customer.phone,
      customer.address, customer.city, customer.state, customer.zip,
      payMethod, promo, subtotal, discount, shipping, total
    );
    const orderId = Number(r.lastInsertRowid);
    const folio = 'TS-' + String(orderId).padStart(5, '0');
    db.prepare('UPDATE orders SET folio = ? WHERE id = ?').run(folio, orderId);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, kind, product_id, name, cut, color, size, qty, unit_price,
        text, font_id, text_color, preset_key, notes, thumb)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of items) {
      insertItem.run(orderId, it.kind, it.productId, it.name, it.cut, it.color, it.size, it.qty, it.unitPrice,
        it.text, it.fontId, it.textColor, it.presetKey, it.notes, it.thumb);
    }

    return { folio, total };
  });
}

module.exports = { createOrder, OrderError };
