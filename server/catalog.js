/* Carga las reglas de negocio (cortes, productos, precios, envío, promos) directamente desde
   js/data.js para no duplicar esa lógica en el servidor. js/data.js está escrito para el navegador
   (sin module.exports), así que se evalúa en un sandbox con vm y se extraen sus constantes. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA_PATH = path.join(__dirname, '..', 'js', 'data.js');
const code = fs.readFileSync(DATA_PATH, 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  code + '\n;this.__exported = { CUTS, PRODUCTS, SIZES, PRINT_FEE, SHIPPING, FREE_SHIPPING, PROMOS, FONTS, TEXT_COLORS, PRESETS };',
  sandbox,
  { filename: 'data.js' }
);

const CATALOG = sandbox.__exported;

/* Replica cart.js (Cart.totals): subtotal, descuento por promo, envío y total */
function totals(items, promoCode) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const rate = promoCode && CATALOG.PROMOS[promoCode] != null ? CATALOG.PROMOS[promoCode] : 0;
  const discount = Math.round(subtotal * rate);
  const shipping = subtotal === 0 ? 0 : (subtotal >= CATALOG.FREE_SHIPPING ? 0 : CATALOG.SHIPPING);
  const total = Math.max(0, subtotal - discount + shipping);
  return { subtotal, discount, shipping, total };
}

module.exports = { CATALOG, totals };
