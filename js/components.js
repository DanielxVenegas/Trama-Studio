/* Piezas compartidas: header, footer y utilidades de diseño */
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
      `<li><a href="${u}" ${k && k === page ? 'aria-current="page"' : ''}>${t}</a></li>`).join('')}</ul></nav></div></header>`;
  const f = document.getElementById('site-footer');
  if (f) f.innerHTML = `<footer class="site-footer"><div class="wrap">
    <p><strong>Trama Studio</strong> Playeras en stock y hechas a tu diseño.</p>
    <p><a href="https://wa.me/${WHATSAPP}">Escríbenos por WhatsApp</a></p></div></footer>`;
})();

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

/* Botones de color y de corte reutilizables */
const swatchesHTML = cur => COLORS.map(c =>
  `<button type="button" class="swatch" data-color="${c.hex}" style="--c:${c.hex}" aria-label="${c.name}" aria-pressed="${c.hex.toLowerCase() === cur.toLowerCase()}"></button>`).join('');
const cutsHTML = cur => Object.entries(CUTS).map(([k, c]) =>
  `<button type="button" class="cut-opt" data-cut="${k}" aria-pressed="${k === cur}"><span>${c.name}</span><small>${c.desc}</small></button>`).join('');
