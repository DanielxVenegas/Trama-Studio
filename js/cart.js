/* Carrito de compras: estado persistente (localStorage), drawer accesible y totales con envío/promos */
const Cart = (() => {
  const KEY = 'trama:carrito', PROMO_KEY = 'trama:promo';
  let items = loadItems(), promo = loadPromo(), lastFocus = null;

  function loadItems() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function saveItems() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); }
    catch (e) { toast('No se pudo guardar el carrito: el almacenamiento está lleno.'); }
  }
  function loadPromo() { try { return localStorage.getItem(PROMO_KEY) || ''; } catch (e) { return ''; } }
  function savePromo() { try { localStorage.setItem(PROMO_KEY, promo); } catch (e) {} }

  const find = key => items.find(i => i.key === key);

  function add(item) {
    if (item.kind === 'stock') {
      const existing = find(item.key), already = existing ? existing.qty : 0, room = Math.max(0, item.stock - already);
      if (room <= 0) { toast('Ya tienes en el carrito todo el stock disponible de esa talla.'); return false; }
      const qty = Math.min(item.qty, room);
      if (existing) existing.qty += qty; else items.push({ ...item, qty });
      if (qty < item.qty) toast(`Solo agregamos ${qty} unidad(es) por el stock disponible.`);
    } else {
      items.push(item);
    }
    saveItems(); render(); return true;
  }

  function setQty(key, qty) {
    const it = find(key); if (!it) return;
    if (it.kind === 'stock' && qty > it.stock) { toast('No hay más stock disponible de esta talla.'); qty = it.stock; }
    if (qty <= 0) return remove(key);
    it.qty = qty; saveItems(); render();
  }

  function remove(key) { items = items.filter(i => i.key !== key); saveItems(); render(); toast('Prenda eliminada del carrito.'); }
  function clear() { items = []; promo = ''; saveItems(); savePromo(); render(); }

  function applyPromo(code) {
    const c = (code || '').trim().toUpperCase();
    if (!c) return toast('Escribe un código de descuento.');
    if (PROMOS[c] == null) return toast('Código inválido o expirado.');
    promo = c; savePromo(); render(); toast(`Código ${c} aplicado: ${Math.round(PROMOS[c] * 100)}% de descuento.`);
  }
  function removePromo() { promo = ''; savePromo(); render(); }

  function totals() {
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const count = items.reduce((s, i) => s + i.qty, 0);
    const rate = promo && PROMOS[promo] != null ? PROMOS[promo] : 0;
    const discount = Math.round(subtotal * rate);
    const shipping = subtotal === 0 ? 0 : (subtotal >= FREE_SHIPPING ? 0 : SHIPPING);
    const total = Math.max(0, subtotal - discount + shipping);
    return { subtotal, count, discount, shipping, total, promo };
  }

  /* --- Drawer en el DOM (se inyecta una sola vez por página) --- */
  function ensureDrawer() {
    if (document.getElementById('cart-drawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="cart-backdrop" id="cart-backdrop" hidden></div>
      <aside class="cart-drawer stitch" id="cart-drawer" role="dialog" aria-modal="true" aria-label="Carrito de compras" hidden>
        <div class="cart-head">
          <h2>Tu carrito</h2>
          <span class="cart-items-count" id="cart-items-count">0 prendas</span>
          <button type="button" class="cart-close" id="cart-close" aria-label="Cerrar carrito">&times;</button>
        </div>
        <div class="cart-ship">
          <div class="cart-ship-row"><span id="cart-ship-text"></span><span id="cart-ship-pct"></span></div>
          <div class="cart-ship-track"><div class="cart-ship-fill" id="cart-ship-fill"></div></div>
        </div>
        <div class="cart-body" id="cart-body"></div>
        <div class="cart-foot" id="cart-foot">
          <div class="cart-promo">
            <label for="cart-promo-input" class="visually-hidden">Código de descuento</label>
            <input type="text" id="cart-promo-input" placeholder="Código (ej. TRAMA10)">
            <button type="button" class="btn btn-ghost" id="cart-promo-btn">Aplicar</button>
          </div>
          <div class="cart-totals" id="cart-totals"></div>
          <a class="btn btn-primary" id="cart-checkout" href="checkout.html">Ir a pagar</a>
        </div>
      </aside>`);

    document.getElementById('cart-close').addEventListener('click', close);
    document.getElementById('cart-backdrop').addEventListener('click', close);
    document.getElementById('cart-promo-btn').addEventListener('click', () => applyPromo(document.getElementById('cart-promo-input').value));
    document.getElementById('cart-checkout').addEventListener('click', e => {
      if (items.length === 0) { e.preventDefault(); toast('Agrega al menos una prenda antes de pagar.'); }
    });
    document.getElementById('cart-body').addEventListener('click', e => {
      const row = e.target.closest('[data-key]'); if (!row) return;
      const key = row.dataset.key, it = find(key); if (!it) return;
      if (e.target.closest('.qty-minus')) setQty(key, it.qty - 1);
      else if (e.target.closest('.qty-plus')) setQty(key, it.qty + 1);
      else if (e.target.closest('.cart-item-remove')) remove(key);
    });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
  }

  const isOpen = () => { const d = document.getElementById('cart-drawer'); return !!d && !d.hidden; };

  function open() {
    ensureDrawer();
    lastFocus = document.activeElement;
    document.getElementById('cart-backdrop').hidden = false;
    document.getElementById('cart-drawer').hidden = false;
    requestAnimationFrame(() => {
      document.getElementById('cart-backdrop').classList.add('open');
      document.getElementById('cart-drawer').classList.add('open');
    });
    document.body.classList.add('no-scroll');
    document.getElementById('cart-close').focus();
  }

  function close() {
    const drawer = document.getElementById('cart-drawer'), backdrop = document.getElementById('cart-backdrop');
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('open'); backdrop.classList.remove('open');
    document.body.classList.remove('no-scroll');
    setTimeout(() => { drawer.hidden = true; backdrop.hidden = true; }, 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus(); else document.getElementById('cart-btn')?.focus();
  }

  function itemThumb(it) {
    if (it.kind === 'custom') {
      const font = FONTS.find(f => f.id === it.fontId);
      return shirtSVG(it.color, it.cut, { img: it.thumb, presetKey: it.presetKey, text: it.text, font, textColor: it.textColor, side: it.side });
    }
    return shirtSVG(it.color, it.cut);
  }

  function render() {
    const t = totals();
    const badge = document.getElementById('cart-count'); if (badge) badge.textContent = t.count;
    if (!document.getElementById('cart-drawer')) return;

    document.getElementById('cart-items-count').textContent = `${t.count} ${t.count === 1 ? 'prenda' : 'prendas'}`;

    const shipEl = document.getElementById('cart-ship-text'), pctEl = document.getElementById('cart-ship-pct'), fillEl = document.getElementById('cart-ship-fill');
    if (t.subtotal >= FREE_SHIPPING) {
      shipEl.innerHTML = '<strong>Envío gratis desbloqueado</strong>'; pctEl.textContent = '100%'; fillEl.style.width = '100%';
    } else {
      const pct = Math.min(100, Math.round(t.subtotal / FREE_SHIPPING * 100));
      shipEl.textContent = `Agrega $${FREE_SHIPPING - t.subtotal} para envío gratis`; pctEl.textContent = pct + '%'; fillEl.style.width = pct + '%';
    }

    const body = document.getElementById('cart-body');
    if (items.length === 0) {
      body.innerHTML = `<div class="cart-empty">
        <p>Tu carrito está vacío.</p>
        <a class="btn btn-ghost" href="personalizar.html">Personaliza tu playera</a>
        <a class="btn btn-ghost" href="index.html#stock">Ver stock</a>
      </div>`;
    } else {
      body.innerHTML = items.map(it => `
        <div class="cart-item" data-key="${it.key}">
          <div class="cart-item-thumb">${itemThumb(it)}</div>
          <div class="cart-item-info">
            <strong>${it.name}</strong>
            <p class="meta">Talla ${it.size}${it.text ? ` · "${it.text}"` : ''}</p>
            <div class="cart-item-row">
              <div class="qty">
                <button type="button" class="qty-minus" aria-label="Disminuir cantidad">-</button>
                <span>${it.qty}</span>
                <button type="button" class="qty-plus" aria-label="Aumentar cantidad">+</button>
              </div>
              <span class="cart-item-price">$${it.price * it.qty}</span>
              <button type="button" class="cart-item-remove" aria-label="Quitar prenda del carrito">Quitar</button>
            </div>
          </div>
        </div>`).join('');
    }

    const promoLine = t.promo ? `<div class="cart-totals-row cobalt"><span>Código ${t.promo} (-${Math.round(PROMOS[t.promo] * 100)}%)</span><span>-$${t.discount}</span></div>` : '';
    document.getElementById('cart-totals').innerHTML = `
      <div class="cart-totals-row"><span>Subtotal</span><span>$${t.subtotal}</span></div>
      ${promoLine}
      <div class="cart-totals-row"><span>Envío</span><span>${t.shipping === 0 ? 'Gratis' : '$' + t.shipping}</span></div>
      <div class="cart-totals-row total"><span>Total</span><span>$${t.total}</span></div>`;

    const checkoutBtn = document.getElementById('cart-checkout');
    if (items.length === 0) checkoutBtn.setAttribute('aria-disabled', 'true'); else checkoutBtn.removeAttribute('aria-disabled');
  }

  ensureDrawer();
  render();
  document.getElementById('cart-btn')?.addEventListener('click', open);

  return { add, setQty, remove, clear, applyPromo, removePromo, totals, items: () => items.slice(), open, close };
})();
