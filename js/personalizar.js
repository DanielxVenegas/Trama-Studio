/* Estudio de personalización: corte, color, arte, texto, talla y cantidad, con precio en vivo */
const q = new URLSearchParams(location.search), saved = readDesign();
const st = {
  cut: CUTS[q.get('cut')] ? q.get('cut') : (CUTS[saved.cut] ? saved.cut : 'regular'),
  color: /^[0-9a-f]{6}$/i.test(q.get('color') || '') ? '#' + q.get('color') : (saved.color || '#2F4BFF'),
  img: saved.img || null,
  fileName: saved.fileName || '',
  presetKey: saved.img ? null : (saved.presetKey || 'ninguno'),
  text: saved.text || '',
  fontId: FONTS.some(f => f.id === saved.fontId) ? saved.fontId : FONTS[0].id,
  textColor: saved.textColor || TEXT_COLORS[0].hex,
  side: 'front',
  size: SIZES.includes(saved.size) ? saved.size : 'M',
  qty: saved.qty || 1
};
const $ = id => document.getElementById(id), status = $('status');

const currentFont = () => FONTS.find(f => f.id === st.fontId) || FONTS[0];
const unitPrice = () => CUTS[st.cut].price + PRINT_FEE;
const hasArt = () => !!st.img || (st.presetKey && st.presetKey !== 'ninguno') || !!st.text;

function markSide() { $('sides').querySelectorAll('[data-side]').forEach(b => b.setAttribute('aria-pressed', b.dataset.side === st.side)); }

function render() {
  $('preview').innerHTML = shirtSVG(st.color, st.cut, {
    img: st.img, presetKey: st.img ? null : st.presetKey, side: st.side,
    text: st.text, font: currentFont(), textColor: st.textColor
  });
  $('preview-note').textContent = hasArt() ? 'Vista previa de tu playera personalizada.' : 'Elige corte y color. Tu diseño aparecerá aquí.';
  markSide();

  $('cuts').innerHTML = cutsHTML(st.cut);
  $('swatches').innerHTML = swatchesHTML(st.color);
  $('color-note').innerHTML = `Color seleccionado: <strong>${(COLORS.find(c => c.hex.toLowerCase() === st.color.toLowerCase()) || {}).name || st.color}</strong>`;
  $('presets').innerHTML = presetsHTML(st.img ? null : st.presetKey);
  $('fonts').innerHTML = fontsHTML(st.fontId);
  $('text-colors').innerHTML = textColorsHTML(st.textColor);
  $('sizes').innerHTML = sizePillsHTML(st.size);
  $('qty-val').textContent = st.qty;
  $('price-total').textContent = `$${unitPrice() * st.qty}`;

  saveDesign(st);
}

$('sides').addEventListener('click', e => { const b = e.target.closest('[data-side]'); if (b) { st.side = b.dataset.side; render(); } });
$('cuts').addEventListener('click', e => { const b = e.target.closest('[data-cut]'); if (b) { st.cut = b.dataset.cut; render(); } });
$('swatches').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { st.color = b.dataset.color; render(); } });

$('file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    status.className = 'status'; status.textContent = '';
    st.img = await loadDesign(file);
    st.fileName = file.name;
    st.presetKey = null;
    $('file-name').textContent = file.name;
    $('file-loaded').hidden = false;
    render();
    toast('Diseño cargado.');
  } catch (err) { status.className = 'status err'; status.textContent = err; }
});
$('file-remove').addEventListener('click', () => {
  st.img = null; st.fileName = ''; st.presetKey = 'ninguno';
  $('file').value = ''; $('file-loaded').hidden = true;
  render();
});

$('presets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  st.presetKey = b.dataset.preset; st.img = null; st.fileName = '';
  $('file').value = ''; $('file-loaded').hidden = true;
  render();
});

$('text-input').value = st.text;
$('text-input').addEventListener('input', e => { st.text = e.target.value; render(); });
$('fonts').addEventListener('click', e => { const b = e.target.closest('[data-font]'); if (b) { st.fontId = b.dataset.font; render(); } });
$('text-colors').addEventListener('click', e => { const b = e.target.closest('[data-textcolor]'); if (b) { st.textColor = b.dataset.textcolor; render(); } });

$('sizes').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (b) { st.size = b.dataset.size; render(); } });
$('qty-minus').addEventListener('click', () => { if (st.qty > 1) { st.qty--; render(); } });
$('qty-plus').addEventListener('click', () => { if (st.qty < 20) { st.qty++; render(); } else toast('Máximo 20 piezas por pedido. Escríbenos para mayoreo.'); });

$('to3d').addEventListener('click', () => { saveDesign(st); location.href = 'visor-3d.html'; });

$('reset').addEventListener('click', () => {
  Object.assign(st, { cut: 'regular', color: '#2F4BFF', img: null, fileName: '', presetKey: 'ninguno', text: '', fontId: FONTS[0].id, textColor: TEXT_COLORS[0].hex, side: 'front', size: 'M', qty: 1 });
  $('text-input').value = ''; $('file').value = ''; $('file-loaded').hidden = true; $('notas').value = '';
  status.className = 'status'; status.textContent = '';
  render();
  toast('Opciones reiniciadas.');
});

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  status.className = 'status'; status.textContent = '';

  const thumbSrc = st.img ? await thumb(st.img, 160) : null;
  const cutName = CUTS[st.cut].name;
  const colorName = (COLORS.find(c => c.hex.toLowerCase() === st.color.toLowerCase()) || {}).name || st.color;

  Cart.add({
    key: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    kind: 'custom',
    name: `Playera ${cutName} personalizada`,
    cut: st.cut, color: st.color, colorName,
    size: st.size, qty: st.qty,
    price: unitPrice(),
    text: st.text || '',
    fontId: st.fontId,
    textColor: st.textColor,
    presetKey: st.img ? null : st.presetKey,
    thumb: thumbSrc,
    side: st.side,
    notes: $('notas').value.trim()
  });

  status.textContent = 'Agregada al carrito. Puedes seguir personalizando o ir a pagar.';
  toast('Playera agregada al carrito.');
  Cart.open();
});

if (st.img) { $('file-name').textContent = st.fileName || 'Imagen cargada'; $('file-loaded').hidden = false; }
render();
