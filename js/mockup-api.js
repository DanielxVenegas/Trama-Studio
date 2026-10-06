/* Foto realista con la API de Dynamic Mockups (a través de nuestro servidor; la llave nunca llega al navegador) */
(async () => {
  const btn = document.getElementById('real'); if (!btn) return;
  let on = false;
  try { on = (await (await fetch('/api/config')).json()).mockup; } catch (e) {}
  if (!on) return;               /* sin servidor o sin configurar: el botón sigue oculto */
  btn.hidden = false;
  const dlg = document.getElementById('real-dlg'), img = document.getElementById('real-img'), msg = document.getElementById('msg');
  document.getElementById('real-x').addEventListener('click', () => dlg.close());
  btn.addEventListener('click', async () => {
    const d = readDesign(); msg.textContent = '';
    if (!d.img) { msg.textContent = 'Sube tu diseño para generar la foto.'; return; }
    btn.disabled = true; btn.textContent = 'Generando foto...';
    try {
      const r = await fetch('/api/mockup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ img: d.img, color: d.color }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'No se pudo generar la foto.');
      img.src = j.url; document.getElementById('real-dl').href = j.url; dlg.showModal();
    } catch (e) { msg.textContent = e.message; }
    btn.disabled = false; btn.textContent = 'Ver foto realista';
  });
})();
