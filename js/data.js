/* Datos del sitio: edita aquí stock, cortes, colores y número de WhatsApp */
const WHATSAPP = '520000000000'; // lada país + número, sin + ni espacios

const CUTS = {
  regular:  { name: 'Regular',  desc: 'Caída clásica, cómoda para todo el día.', w: .60, L: 1.80, s: .30 },
  oversize: { name: 'Oversize', desc: 'Hombros caídos y mangas largas. Look urbano.', w: .78, L: 1.95, s: .45 },
  slim:     { name: 'Slim',     desc: 'Ajustada al cuerpo, mangas cortas.', w: .50, L: 1.75, s: .22 },
  crop:     { name: 'Crop',     desc: 'Corte corto, justo arriba de la cadera.', w: .62, L: 1.35, s: .30 }
};

const COLORS = [
  { name: 'Blanco',  hex: '#FFFFFF' }, { name: 'Negro',  hex: '#1B1B1F' },
  { name: 'Cobalto', hex: '#2F4BFF' }, { name: 'Arena',  hex: '#E6D5B8' },
  { name: 'Bosque',  hex: '#2F5D50' }, { name: 'Rojo',   hex: '#D7263D' },
  { name: 'Gris',    hex: '#9AA3AF' }
];

const PRODUCTS = [
  { name: 'Básica Cobalto',  cut: 'regular',  color: '#2F4BFF', stock: 24, price: 189, sizes: 'S, M, L, XL' },
  { name: 'Básica Negra',    cut: 'regular',  color: '#1B1B1F', stock: 31, price: 189, sizes: 'S, M, L, XL' },
  { name: 'Street Arena',    cut: 'oversize', color: '#E6D5B8', stock: 12, price: 239, sizes: 'M, L, XL' },
  { name: 'Street Bosque',   cut: 'oversize', color: '#2F5D50', stock: 4,  price: 239, sizes: 'M, L' },
  { name: 'Fit Blanca',      cut: 'slim',     color: '#FFFFFF', stock: 18, price: 199, sizes: 'S, M, L' },
  { name: 'Fit Gris',        cut: 'slim',     color: '#9AA3AF', stock: 9,  price: 199, sizes: 'S, M, L' },
  { name: 'Crop Roja',       cut: 'crop',     color: '#D7263D', stock: 5,  price: 209, sizes: 'S, M' },
  { name: 'Crop Blanca',     cut: 'crop',     color: '#FFFFFF', stock: 14, price: 209, sizes: 'S, M, L' }
];

/* Silueta SVG de una playera según el corte */
function shirtPath(k) {
  const { w, L, s } = CUTS[k], sx = w + .04, ex = sx + s, bx = ex - .22;
  const p = (x, y) => (120 + x * 88).toFixed(1) + ' ' + (14 + (1 - y) * 88).toFixed(1);
  return `M${p(-.28,1)} L${p(-sx,.92)} L${p(-ex,.54)} L${p(-bx,.3)} L${p(-w,.3)} L${p(-w,1-L)} L${p(w,1-L)} L${p(w,.3)} L${p(bx,.3)} L${p(ex,.54)} L${p(sx,.92)} L${p(.28,1)} Q${p(0,.7)} ${p(-.28,1)}Z`;
}
function shirtSVG(color, cut, img) {
  const w = CUTS[cut].w, a = Math.min(w * 80, 62);
  return `<svg viewBox="0 0 240 200" role="img" aria-label="Playera ${CUTS[cut].name}">
    <path d="${shirtPath(cut)}" fill="${color}" stroke="#101B33" stroke-width="2.5" stroke-linejoin="round"/>
    ${img ? `<image href="${img}" x="${120 - a / 2}" y="46" width="${a}" height="${a}" preserveAspectRatio="xMidYMin meet"/>` : ''}</svg>`;
}
