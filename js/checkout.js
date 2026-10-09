/* Checkout: valida datos, muestra resumen del carrito y registra el pedido en el servidor.
   El pago sigue simulado (no hay cobro real); si no hay servidor de pedidos disponible,
   se conserva el flujo simulado anterior. */
const $ = id => document.getElementById(id);

let ordersEnabled = false;
(async () => { try { ordersEnabled = !!(await (await fetch('/api/config')).json()).orders; } catch (e) {} })();

function itemThumbSVG(it) {
  if (it.kind === 'custom') {
    const font = FONTS.find(f => f.id === it.fontId);
    return shirtSVG(it.color, it.cut, { img: it.thumb, presetKey: it.presetKey, text: it.text, font, textColor: it.textColor, side: it.side });
  }
  return shirtSVG(it.color, it.cut);
}

function renderSummary() {
  const items = Cart.items(), t = Cart.totals();

  $('summary-items').innerHTML = items.length ? items.map(it => `
    <div class="summary-item">
      <div class="summary-thumb">${itemThumbSVG(it)}</div>
      <div class="summary-item-info"><strong>${it.name}</strong><span class="meta">Talla ${it.size} &times;${it.qty}</span></div>
      <span class="summary-item-price">$${it.price * it.qty}</span>
    </div>`).join('') : '<p class="meta">No hay prendas en el carrito.</p>';

  const promoLine = t.promo ? `<div class="cart-totals-row cobalt"><span>Código ${t.promo}</span><span>-$${t.discount}</span></div>` : '';
  $('summary-totals').innerHTML = `
    <div class="cart-totals-row"><span>Subtotal</span><span>$${t.subtotal}</span></div>
    ${promoLine}
    <div class="cart-totals-row"><span>Envío</span><span>${t.shipping === 0 ? 'Gratis' : '$' + t.shipping}</span></div>
    <div class="cart-totals-row total"><span>Total</span><span>$${t.total}</span></div>`;
}

function toggleEmpty() {
  const empty = Cart.items().length === 0;
  $('checkout-empty').hidden = !empty;
  $('checkout-content').hidden = empty;
}

/* Alterna los campos de tarjeta según el método de pago elegido */
document.querySelectorAll('input[name="pay"]').forEach(r => r.addEventListener('change', () => {
  document.querySelectorAll('.pay-opt').forEach(l => l.classList.toggle('active', l.querySelector('input').checked));
  $('card-fields').hidden = document.querySelector('input[name="pay"]:checked').value !== 'card';
}));

/* Validación con mensajes por campo (sin alertas genéricas) */
function setErr(inputId, errId, msg) {
  const field = $(inputId), err = $(errId);
  if (msg) { field.setAttribute('aria-invalid', 'true'); err.textContent = msg; }
  else { field.removeAttribute('aria-invalid'); err.textContent = ''; }
  return !msg;
}

function validate() {
  const email = $('ck-email').value.trim();
  const okEmail = setErr('ck-email', 'err-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'Ingresa un correo válido.');
  const okFirst = setErr('ck-first', 'err-first', $('ck-first').value.trim() ? '' : 'Escribe tu nombre.');
  const okLast = setErr('ck-last', 'err-last', $('ck-last').value.trim() ? '' : 'Escribe tus apellidos.');
  const okAddr = setErr('ck-address', 'err-address', $('ck-address').value.trim() ? '' : 'Escribe tu calle y número.');
  const okCity = setErr('ck-city', 'err-city', $('ck-city').value.trim() ? '' : 'Escribe tu ciudad.');
  const okState = setErr('ck-state', 'err-state', $('ck-state').value.trim() ? '' : 'Escribe tu estado.');
  const okZip = setErr('ck-zip', 'err-zip', /^\d{5}$/.test($('ck-zip').value.trim()) ? '' : 'El código postal debe tener 5 dígitos.');
  const okPhone = setErr('ck-phone', 'err-phone', $('ck-phone').value.replace(/\D/g, '').length >= 10 ? '' : 'Escribe un teléfono a 10 dígitos.');
  return okEmail && okFirst && okLast && okAddr && okCity && okState && okZip && okPhone;
}

function showSuccess(orderId, email) {
  $('success-id').textContent = orderId;
  $('success-detail').textContent = `Guarda tu folio. Te enviaremos la confirmación del pedido a ${email}.`;
  $('success-backdrop').hidden = false;
  document.body.classList.add('no-scroll');
}
function closeSuccess() { $('success-backdrop').hidden = true; document.body.classList.remove('no-scroll'); }
$('success-backdrop').addEventListener('click', e => { if (e.target === $('success-backdrop')) closeSuccess(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('success-backdrop').hidden) closeSuccess(); });

/* Arma el cuerpo de /api/orders a partir del carrito: solo los datos necesarios,
   nunca el precio (el servidor lo recalcula con sus propias reglas) */
function buildOrderPayload() {
  const payMethod = (document.querySelector('input[name="pay"]:checked') || {}).value || 'card';
  return {
    customer: {
      email: $('ck-email').value.trim(), firstName: $('ck-first').value.trim(), lastName: $('ck-last').value.trim(),
      address: $('ck-address').value.trim(), city: $('ck-city').value.trim(), state: $('ck-state').value.trim(),
      zip: $('ck-zip').value.trim(), phone: $('ck-phone').value.trim()
    },
    payMethod, promo: Cart.totals().promo || '',
    items: Cart.items().map(it => it.kind === 'stock'
      ? { kind: 'stock', id: it.id, size: it.size, qty: it.qty }
      : {
          kind: 'custom', cut: it.cut, color: it.color, size: it.size, qty: it.qty, text: it.text || '',
          fontId: it.fontId, textColor: it.textColor, presetKey: it.presetKey || null, thumb: it.thumb || null, notes: it.notes || ''
        })
  };
}

function finishOrder(orderId, email) {
  showSuccess(orderId, email);
  Cart.clear();
  renderSummary(); toggleEmpty();
  $('checkout-form').reset(); $('card-fields').hidden = false;
  document.querySelectorAll('.pay-opt').forEach((l, i) => l.classList.toggle('active', i === 0));
}

$('checkout-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (Cart.items().length === 0) return;
  if (!validate()) { $('checkout-status').className = 'status err'; $('checkout-status').textContent = 'Revisa los campos marcados en rojo.'; return; }

  const btn = $('checkout-submit'), original = btn.textContent, email = $('ck-email').value.trim();
  $('checkout-status').className = 'status'; $('checkout-status').textContent = '';

  if (ordersEnabled) {
    btn.disabled = true; btn.textContent = 'Registrando pedido...';
    try {
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildOrderPayload()) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo registrar el pedido.');
      finishOrder(j.folio, email);
    } catch (err) {
      $('checkout-status').className = 'status err'; $('checkout-status').textContent = err.message || 'No se pudo registrar el pedido. Intenta de nuevo.';
    }
    btn.disabled = false; btn.textContent = original;
    return;
  }

  /* Sin servidor de pedidos disponible: se conserva la simulación anterior */
  btn.disabled = true; btn.textContent = 'Procesando pago simulado...';
  setTimeout(() => {
    btn.disabled = false; btn.textContent = original;
    finishOrder('TS-' + Math.floor(10000 + Math.random() * 90000), email);
  }, 1100);
});

renderSummary();
toggleEmpty();
