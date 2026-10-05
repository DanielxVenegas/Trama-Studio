/* Piezas compartidas: header, footer, carrito, notificaciones y utilidades de diseño */
(() => {
  const page = document.body.dataset.page;
  const links = [
    ['index.html', 'Inicio', 'home'], ['index.html#stock', 'Stock'], ['index.html#cortes', 'Cortes'],
    ['personalizar.html', 'Personalizar', 'custom'], ['visor-3d.html', 'Visor 3D', 'viewer']
  ];
  const h = document.getElementById('site-header');
  if (h) h.innerHTML = `<header class="site-header"><div class="wrap bar">
    <a class="brand" href="index.html">Trama Studio</a>
    <nav aria-label="Principal"><ul>${links.map(([u, t, k]) =>
      `<li><a href="${u}" ${k && k === page ? 'aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul></nav>
    <button type="button" class="cart-btn" id="cart-btn" aria-label="Abrir carrito de compras" aria-haspopup="dialog">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <path d="M16 10a4 4 0 0 1-8 0"></path>
      </svg>
      <span class="cart-count" id="cart-count" aria-live="polite">0</span>
    </button></div></header>`;
  const f = document.getElementById('site-footer');
  if (f) f.innerHTML = `<footer class="site-footer"><div class="wrap">
    <p><strong>Trama Studio</strong> Playeras en stock y hechas a tu diseño.</p>
    <p><a href="https://wa.me/${WHATSAPP}">Escríbenos por WhatsApp</a></p></div></footer>`;
  if (!document.getElementById('toast-root')) {
    document.body.insertAdjacentHTML('beforeend', '<div id="toast-root" class="toast-root" role="status"></div>');
  }
})();

/* Notificación breve no intrusiva (no interrumpe lectores de pantalla) */
function toast(msg, ms = 3200) {
  const root = document.getElementById('toast-root'); if (!root) return;
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, ms);
}

/* Guarda/lee el diseño entre páginas (sessionStorage) */
const saveDesign = o => { try { sessionStorage.setItem('trama:diseno', JSON.stringify(o)); } catch (e) {} };
const readDesign = () => { try { return JSON.parse(sessionStorage.getItem('trama:diseno')) || {}; } catch (e) { return {}; } };

/* Lee una imagen, la reduce a máx. 1024px y devuelve un dataURL PNG */
function loadDesign(file) {
  return new Promise((ok, fail) => {
    if (!file || !file.type.startsWith('image/')) return fail('Sube un archivo de imagen (PNG, JPG o SVG).');
    if (file.size > 8 * 1024 * 1024) return fail('La imagen pesa más de 8 MB. Usa una más ligera.');
    const r = new FileReader();
    r.onerror = () => fail('No se pudo leer el archivo.');
    r.onload = () => {
      const i = new Image();
      i.onerror = () => fail('No se pudo abrir la imagen.');
      i.onload = () => {
        const k = Math.min(1, 1024 / Math.max(i.width, i.height)), c = document.createElement('canvas');
        c.width = Math.round(i.width * k) || 1024; c.height = Math.round(i.height * k) || 1024;
        c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/png'));
      };
      i.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

/* Carga una imagen (URL o dataURL) como elemento <img> listo para dibujar en canvas */
function loadImage(src) {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail('No se pudo abrir la imagen.');
    i.src = src;
  });
}

/* Convierte un estampado prediseñado (SVG) en un PNG recortado, listo para usarse como "archivo subido" */
function presetToImage(key, size = 480) {
  return new Promise((ok, fail) => {
    const svg = presetStandaloneSVG(key);
    if (!svg) return ok(null);
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const i = new Image();
    i.onerror = () => fail('No se pudo generar el estampado.');
    i.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(i, 0, 0, size, size);
      ok(c.toDataURL('image/png'));
    };
    i.src = svg64;
  });
}

/* Une el arte (archivo o estampado) y el texto personalizado en un solo PNG.
   Se usa para la calcomanía 3D y para la foto realista, que solo pueden recibir una imagen. */
async function composePrint({ img, preset, text, font, textColor } = {}) {
  let src = img || null;
  if (!src && preset && preset !== 'ninguno') src = await presetToImage(preset, 480);
  if (!src && !text) return null;

  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}

  const C = 640, c = document.createElement('canvas'); c.width = c.height = C;
  const g = c.getContext('2d');

  if (src) {
    const im = await loadImage(src);
    const boxTop = 30, boxSize = text ? 440 : 560;
    const r = Math.min(boxSize / im.width, boxSize / im.height), iw = im.width * r, ih = im.height * r;
    g.drawImage(im, (C - iw) / 2, boxTop + (boxSize - ih) / 2, iw, ih);
  }

  if (text) {
    const f = font || FONTS[0], fs = src ? 46 : 64;
    g.font = `${f.style} ${f.weight} ${fs}px ${f.family}`;
    g.fillStyle = textColor || '#101B33';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, C / 2, src ? 572 : C / 2, C - 60);
  }

  return c.toDataURL('image/png');
}

/* Miniatura ligera de una imagen (dataURL), para no saturar el localStorage del carrito */
function thumb(src, size = 160) {
  return new Promise((ok, fail) => {
    if (!src) return ok(null);
    const i = new Image();
    i.onerror = () => fail('No se pudo generar la miniatura.');
    i.onload = () => {
      const k = Math.min(1, size / Math.max(i.width, i.height)), c = document.createElement('canvas');
      c.width = Math.round(i.width * k) || size; c.height = Math.round(i.height * k) || size;
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/png'));
    };
    i.src = src;
  });
}

/* Botones reutilizables: color, corte, talla, tipografía, color de texto y estampados */
const swatchesHTML = cur => COLORS.map(c =>
  `<button type="button" class="swatch" data-color="${c.hex}" style="--c:${c.hex}" aria-label="${c.name}" aria-pressed="${c.hex.toLowerCase() === cur.toLowerCase()}"></button>`).join('');

const cutsHTML = cur => Object.entries(CUTS).map(([k, c]) =>
  `<button type="button" class="cut-opt" data-cut="${k}" aria-pressed="${k === cur}"><span>${c.name}</span><small>${c.desc} · $${c.price}</small></button>`).join('');

const sizePillsHTML = cur => SIZES.map(s =>
  `<button type="button" class="size-pill" data-size="${s}" aria-pressed="${s === cur}">${s}</button>`).join('');

const fontsHTML = cur => FONTS.map(f =>
  `<button type="button" class="font-opt" data-font="${f.id}" aria-pressed="${f.id === cur}" style="font-family:${f.family};font-weight:${f.weight};font-style:${f.style}">${f.name}</button>`).join('');

const textColorsHTML = cur => TEXT_COLORS.map(c =>
  `<button type="button" class="swatch swatch-sm" data-textcolor="${c.hex}" style="--c:${c.hex}" aria-label="Texto ${c.name}" aria-pressed="${c.hex.toLowerCase() === (cur || '').toLowerCase()}"></button>`).join('');

const presetsHTML = cur => Object.entries(PRESETS).map(([k, p]) =>
  `<button type="button" class="preset-opt" data-preset="${k}" aria-pressed="${k === cur}" title="${p.name}">${presetIconSVG(k)}<small>${p.name}</small></button>`).join('');
