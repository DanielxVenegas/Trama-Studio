/* Datos del sitio: edita aquí stock, cortes, colores, precios y número de WhatsApp */
const WHATSAPP = '520000000000'; // lada país + número, sin + ni espacios

/* price = precio base de la playera en blanco para personalizar (antes de PRINT_FEE) */
const CUTS = {
  regular:  { name: 'Regular',  desc: 'Caída clásica, cómoda para todo el día.', w: .60, L: 1.80, s: .30, price: 169 },
  oversize: { name: 'Oversize', desc: 'Hombros caídos y mangas largas. Look urbano.', w: .78, L: 1.95, s: .45, price: 199 },
  slim:     { name: 'Slim',     desc: 'Ajustada al cuerpo, mangas cortas.', w: .50, L: 1.75, s: .22, price: 179 },
  crop:     { name: 'Crop',     desc: 'Corte corto, justo arriba de la cadera.', w: .62, L: 1.35, s: .30, price: 179 }
};

const COLORS = [
  { name: 'Blanco',  hex: '#FFFFFF' }, { name: 'Negro',  hex: '#1B1B1F' },
  { name: 'Cobalto', hex: '#2F4BFF' }, { name: 'Arena',  hex: '#E6D5B8' },
  { name: 'Bosque',  hex: '#2F5D50' }, { name: 'Rojo',   hex: '#D7263D' },
  { name: 'Gris',    hex: '#9AA3AF' }
];

const PRODUCTS = [
  { id: 'prod-01', name: 'Básica Cobalto',  cut: 'regular',  color: '#2F4BFF', stock: 24, price: 189, sizes: 'S, M, L, XL' },
  { id: 'prod-02', name: 'Básica Negra',    cut: 'regular',  color: '#1B1B1F', stock: 31, price: 189, sizes: 'S, M, L, XL' },
  { id: 'prod-03', name: 'Street Arena',    cut: 'oversize', color: '#E6D5B8', stock: 12, price: 239, sizes: 'M, L, XL' },
  { id: 'prod-04', name: 'Street Bosque',   cut: 'oversize', color: '#2F5D50', stock: 4,  price: 239, sizes: 'M, L' },
  { id: 'prod-05', name: 'Fit Blanca',      cut: 'slim',     color: '#FFFFFF', stock: 18, price: 199, sizes: 'S, M, L' },
  { id: 'prod-06', name: 'Fit Gris',        cut: 'slim',     color: '#9AA3AF', stock: 9,  price: 199, sizes: 'S, M, L' },
  { id: 'prod-07', name: 'Crop Roja',       cut: 'crop',     color: '#D7263D', stock: 5,  price: 209, sizes: 'S, M' },
  { id: 'prod-08', name: 'Crop Blanca',     cut: 'crop',     color: '#FFFFFF', stock: 14, price: 209, sizes: 'S, M, L' }
];

/* Tallas disponibles para pedidos personalizados */
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/* Reglas de precio y envío (edítalas según tu negocio) */
const PRINT_FEE = 60;       // cargo fijo por estampado/texto personalizado
const SHIPPING = 79;        // envío estándar (MXN)
const FREE_SHIPPING = 899;  // a partir de este subtotal el envío es gratis

/* Códigos promocionales: clave en mayúsculas -> descuento decimal */
const PROMOS = { TRAMA10: .10, LANZAMIENTO: .15 };

/* Tipografías disponibles para el texto personalizado (ya cargadas en <head>) */
const FONTS = [
  { id: 'display', name: 'Bricolage (Titular)', family: "'Bricolage Grotesque', sans-serif", weight: 800, style: 'normal' },
  { id: 'body',    name: 'Figtree (Limpia)',    family: "'Figtree', sans-serif",              weight: 700, style: 'normal' },
  { id: 'script',  name: 'Figtree Itálica',     family: "'Figtree', sans-serif",              weight: 700, style: 'italic' }
];

const TEXT_COLORS = [
  { name: 'Tinta',   hex: '#101B33' },
  { name: 'Blanco',  hex: '#FFFFFF' },
  { name: 'Cobalto', hex: '#2F4BFF' },
  { name: 'Sol',     hex: '#FFD23F' },
  { name: 'Rojo',    hex: '#D7263D' }
];

/* Estampados prediseñados (se usan si el cliente no sube su propio archivo).
   `inner` son solo las formas, sin envoltura <svg>, para poder incrustarlas o rasterizarlas. */
const PRESETS = {
  ninguno: { name: 'Solo texto', inner: '' },
  rayo: {
    name: 'Rayo',
    inner: `<polygon points="78,8 40,74 64,74 56,132 104,56 76,56" fill="#2F4BFF" stroke="#101B33" stroke-width="3" stroke-linejoin="round"/>`
  },
  grid99: {
    name: 'Grid 99',
    inner: `<rect x="10" y="10" width="120" height="120" rx="10" fill="#fff" stroke="#101B33" stroke-width="3"/>
      <line x1="10" y1="70" x2="130" y2="70" stroke="#2F4BFF" stroke-width="2" stroke-dasharray="4,4"/>
      <text x="70" y="52" font-family="'Bricolage Grotesque', sans-serif" font-weight="800" font-size="22" fill="#101B33" text-anchor="middle">TRAMA</text>
      <text x="70" y="96" font-family="'Bricolage Grotesque', sans-serif" font-weight="800" font-size="30" fill="#2F4BFF" text-anchor="middle">99</text>`
  },
  carita: {
    name: 'Carita',
    inner: `<circle cx="70" cy="70" r="54" fill="#FFD23F" stroke="#101B33" stroke-width="3"/>
      <circle cx="50" cy="60" r="6" fill="#101B33"/>
      <circle cx="90" cy="60" r="6" fill="#101B33"/>
      <path d="M42,86 Q70,112 98,86" fill="none" stroke="#101B33" stroke-width="5" stroke-linecap="round"/>`
  },
  bloque: {
    name: 'Bloque Geo',
    inner: `<polygon points="70,12 118,110 22,110" fill="#2F4BFF" fill-opacity=".15" stroke="#101B33" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="70" cy="78" r="20" fill="none" stroke="#101B33" stroke-width="3"/>
      <line x1="70" y1="40" x2="70" y2="98" stroke="#2F4BFF" stroke-width="2"/>`
  }
};

/* SVG independiente de un estampado (con xmlns, para rasterizarlo con <img>) */
function presetStandaloneSVG(key) {
  const p = PRESETS[key]; if (!p || !p.inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">${p.inner}</svg>`;
}

/* Ícono pequeño de un estampado, para mostrarlo en los botones del selector */
function presetIconSVG(key) {
  const p = PRESETS[key]; if (!p || !p.inner) return '<span class="preset-none">Aa</span>';
  return `<svg viewBox="0 0 140 140" aria-hidden="true">${p.inner}</svg>`;
}

/* Escapa texto de usuario para insertarlo de forma segura dentro de un SVG */
function escapeXML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/* Silueta SVG de una playera según el corte (front/back cambia el escote) */
function shirtPath(k, side) {
  const { w, L, s } = CUTS[k], sx = w + .04, ex = sx + s, bx = ex - .22, neck = side === 'back' ? .88 : .7;
  const p = (x, y) => (120 + x * 88).toFixed(1) + ' ' + (14 + (1 - y) * 88).toFixed(1);
  return `M${p(-.28,1)} L${p(-sx,.92)} L${p(-ex,.54)} L${p(-bx,.3)} L${p(-w,.3)} L${p(-w,1-L)} L${p(w,1-L)} L${p(w,.3)} L${p(bx,.3)} L${p(ex,.54)} L${p(sx,.92)} L${p(.28,1)} Q${p(0,neck)} ${p(-.28,1)}Z`;
}

/* Capa de arte (archivo subido o estampado) + texto, dentro del área imprimible del pecho */
function printLayerSVG(cut, { img, presetKey, text, font, textColor } = {}) {
  const w = CUTS[cut].w, a = Math.min(w * 80, 62), cx = 120, top = 46;
  const hasArt = !!img || (presetKey && presetKey !== 'ninguno' && PRESETS[presetKey] && PRESETS[presetKey].inner);
  let out = '';
  if (img) out += `<image href="${img}" x="${cx - a / 2}" y="${top}" width="${a}" height="${a}" preserveAspectRatio="xMidYMid meet"/>`;
  else if (presetKey && PRESETS[presetKey] && PRESETS[presetKey].inner) {
    out += `<svg x="${cx - a / 2}" y="${top}" width="${a}" height="${a}" viewBox="0 0 140 140">${PRESETS[presetKey].inner}</svg>`;
  }
  if (text) {
    const f = font || FONTS[0], ty = hasArt ? top + a + 14 : top + a / 2 + 6, fs = hasArt ? 11 : 13;
    out += `<text x="${cx}" y="${ty}" text-anchor="middle" font-family="${f.family}" font-weight="${f.weight}" font-style="${f.style}" font-size="${fs}" fill="${textColor || '#101B33'}">${escapeXML(text)}</text>`;
  }
  return out;
}

function shirtSVG(color, cut, opts = {}) {
  const { img, presetKey, side = 'front', text, font, textColor } = opts;
  const seam = side === 'back'
    ? `<line x1="120" y1="38" x2="120" y2="${(14 + (1 - (1 - CUTS[cut].L)) * 88).toFixed(1)}" stroke="#101B33" stroke-opacity=".22" stroke-width="1.5" stroke-dasharray="4,4"/>`
    : '';
  return `<svg viewBox="0 0 240 200" role="img" aria-label="Playera ${CUTS[cut].name}, ${side === 'back' ? 'espalda' : 'frente'}">
    <path d="${shirtPath(cut, side)}" fill="${color}" stroke="#101B33" stroke-width="2.5" stroke-linejoin="round"/>
    ${seam}
    ${printLayerSVG(cut, { img, presetKey, text, font, textColor })}</svg>`;
}
