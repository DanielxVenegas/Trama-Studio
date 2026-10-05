/* Inicio: hero, stock con filtro y catálogo de cortes */
document.getElementById('hero-art').innerHTML =
  shirtSVG('#2F4BFF', 'regular') + shirtSVG('#FFFFFF', 'oversize') + shirtSVG('#101B33', 'slim');

const grid = document.getElementById('grid'), chips = document.getElementById('chips');
const card = p => `<article class="card stitch"><div class="card-art">${shirtSVG(p.color, p.cut)}</div>
  <div class="card-body"><h3>${p.name}</h3><p class="meta">Corte ${CUTS[p.cut].name}</p><p class="meta">Tallas: ${p.sizes}</p>
  <div class="row"><span class="price">$${p.price}</span><span class="badge ${p.stock <= 5 ? 'low' : ''}">${p.stock <= 5 ? 'Quedan ' + p.stock : 'En stock'}</span></div>
  <a class="btn btn-ghost" href="personalizar.html?cut=${p.cut}&color=${p.color.slice(1)}">Personalizar esta</a></div></article>`;

function show(cut) {
  const list = PRODUCTS.filter(p => cut === 'all' || p.cut === cut);
  grid.innerHTML = list.map(card).join('');
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.cut === cut));
}
chips.innerHTML = [['all', 'Todos'], ...Object.entries(CUTS).map(([k, c]) => [k, c.name])]
  .map(([k, t]) => `<button class="chip" data-cut="${k}" aria-pressed="false">${t}</button>`).join('');
chips.addEventListener('click', e => e.target.dataset.cut && show(e.target.dataset.cut));
show('all');

document.getElementById('cuts').innerHTML = Object.entries(CUTS).map(([k, c]) =>
  `<article class="card stitch"><div class="card-art">${shirtSVG('#E3E8F2', k)}</div>
  <div class="card-body"><h3>${c.name}</h3><p class="meta">${c.desc}</p>
  <a class="btn btn-ghost" href="visor-3d.html?cut=${k}">Verlo en 3D</a></div></article>`).join('');
