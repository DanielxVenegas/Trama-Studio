/* Personalizar: diseño, corte, color y envío del pedido */
const q = new URLSearchParams(location.search), saved = readDesign();
const st = {
  cut: CUTS[q.get('cut')] ? q.get('cut') : (CUTS[saved.cut] ? saved.cut : 'regular'),
  color: /^[0-9a-f]{6}$/i.test(q.get('color') || '') ? '#' + q.get('color') : (saved.color || '#2F4BFF'),
  img: saved.img || null
};
const $ = id => document.getElementById(id), status = $('status');

function render() {
  $('preview').innerHTML = shirtSVG(st.color, st.cut, st.img);
  $('preview-note').textContent = st.img ? 'Vista previa. Ajustamos la posición contigo por WhatsApp.' : 'Elige corte y color. Tu diseño aparecerá aquí.';
  $('cuts').innerHTML = cutsHTML(st.cut);
  $('swatches').innerHTML = swatchesHTML(st.color);
  saveDesign(st);
}
$('cuts').addEventListener('click', e => { const b = e.target.closest('[data-cut]'); if (b) { st.cut = b.dataset.cut; render(); } });
$('swatches').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { st.color = b.dataset.color; render(); } });
$('file').addEventListener('change', async e => {
  try { st.img = await loadDesign(e.target.files[0]); status.className = 'status'; status.textContent = 'Diseño cargado.'; render(); }
  catch (err) { status.className = 'status err'; status.textContent = err; }
});
$('to3d').addEventListener('click', () => { saveDesign(st); location.href = 'visor-3d.html'; });
$('form').addEventListener('submit', e => {
  e.preventDefault();
  if (!$('form').reportValidity()) return;
  if (!st.img) { status.className = 'status err'; status.textContent = 'Sube tu diseño antes de enviar el pedido.'; return; }
  const f = new FormData($('form')), color = (COLORS.find(c => c.hex.toLowerCase() === st.color.toLowerCase()) || { name: st.color }).name;
  const msg = `Hola, soy ${f.get('nombre')}. Quiero ${f.get('cant')} playera(s) personalizada(s).\nCorte: ${CUTS[st.cut].name}\nColor: ${color}\nTalla: ${f.get('talla')}\nNotas: ${f.get('notas') || 'Sin notas'}\nTe mando mi diseño por este chat.`;
  status.className = 'status'; status.textContent = 'Abrimos WhatsApp. Adjunta tu diseño en el chat.';
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
});
render();
