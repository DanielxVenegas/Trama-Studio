/* Inicio: hero, stock con filtro y catálogo de cortes */
document.getElementById('hero-art').innerHTML =
  shirtSVG('#2F4BFF', 'regular') + shirtSVG('#FFFFFF', 'oversize') + shirtSVG('#101B33', 'slim');

const grid = document.getElementById('grid'), chips = document.getElementById('chips');
const card = p => {
  const sizes = p.sizes.split(',').map(s => s.trim());
  return `<article class="card stitch"><div class="card-art">${shirtSVG(p.color, p.cut)}</div>
  <div class="card-body"><h3>${p.name}</h3><p class="meta">Corte ${CUTS[p.cut].name}</p>
  <div class="row"><span class="price">$${p.price}</span><span class="badge ${p.stock <= 5 ? 'low' : ''}">${p.stock <= 5 ? 'Quedan ' + p.stock : 'En stock'}</span></div>
  <div class="card-buy">
    <label class="visually-hidden" for="size-${p.id}">Talla</label>
    <select id="size-${p.id}" class="size-select">${sizes.map(s => `<option value="${s}">${s}</option>`).join('')}</select>
    <button type="button" class="btn btn-primary btn-add" data-id="${p.id}">Agregar</button>
  </div>
  <a class="btn btn-ghost" href="personalizar.html?cut=${p.cut}&color=${p.color.slice(1)}">Personalizar esta</a></div></article>`;
};

let activeCut = 'all';
function show(cut) {
  activeCut = cut;
  const list = PRODUCTS.filter(p => cut === 'all' || p.cut === cut);
  grid.innerHTML = list.map(card).join('');
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.cut === cut));
}

grid.addEventListener('click', e => {
  const btn = e.target.closest('.btn-add'); if (!btn) return;
  const id = btn.dataset.id, p = PRODUCTS.find(x => x.id === id); if (!p) return;
  const size = document.getElementById('size-' + id).value;
  const added = Cart.add({ key: p.id + '|' + size, kind: 'stock', id: p.id, name: p.name, cut: p.cut, color: p.color, size, price: p.price, qty: 1, stock: p.stock });
  if (added) { toast(`${p.name} (talla ${size}) agregada al carrito.`); Cart.open(); }
});
chips.innerHTML = [['all', 'Todos'], ...Object.entries(CUTS).map(([k, c]) => [k, c.name])]
  .map(([k, t]) => `<button class="chip" data-cut="${k}" aria-pressed="false">${t}</button>`).join('');
chips.addEventListener('click', e => e.target.dataset.cut && show(e.target.dataset.cut));
show('all');

/* Si hay servidor, trae el stock real (lo edita el panel del administrador) y refresca las tarjetas */
(async () => {
  try {
    const stock = await (await fetch('/api/stock')).json();
    PRODUCTS.forEach(p => { if (Number.isInteger(stock[p.id])) p.stock = stock[p.id]; });
    show(activeCut);
  } catch (e) {}
})();

document.getElementById('cuts').innerHTML = Object.entries(CUTS).map(([k, c]) =>
  `<article class="card stitch"><div class="card-art">${shirtSVG('#E3E8F2', k)}</div>
  <div class="card-body"><h3>${c.name}</h3><p class="meta">${c.desc}</p>
  <a class="btn btn-ghost" href="visor-3d.html?cut=${k}">Verlo en 3D</a></div></article>`).join('');
