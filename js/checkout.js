/* Checkout: valida datos, muestra el resumen y abre Stripe Checkout en modo de prueba. */
const $ = id => document.getElementById(id);

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

/* Arma el cuerpo de /api/checkout/sessions a partir del carrito: solo los datos necesarios,
   nunca el precio (el servidor lo recalcula con sus propias reglas) */
function buildOrderPayload() {
  return {
    customer: {
      email: $('ck-email').value.trim(), firstName: $('ck-first').value.trim(), lastName: $('ck-last').value.trim(),
      address: $('ck-address').value.trim(), city: $('ck-city').value.trim(), state: $('ck-state').value.trim(),
      zip: $('ck-zip').value.trim(), phone: $('ck-phone').value.trim()
    },
    payMethod: 'card', promo: Cart.totals().promo || '',
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
  $('checkout-form').reset();
}

$('checkout-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (Cart.items().length === 0) return;
  if (!validate()) { $('checkout-status').className = 'status err'; $('checkout-status').textContent = 'Revisa los campos marcados en rojo.'; return; }

  const btn = $('checkout-submit'), original = btn.textContent, email = $('ck-email').value.trim();
  $('checkout-status').className = 'status'; $('checkout-status').textContent = '';

  btn.disabled = true; btn.textContent = 'Conectando con Stripe...';
  try {
    const r = await fetch('/api/checkout/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildOrderPayload())
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo iniciar el pago.');
    window.location.assign(j.url);
  } catch (err) {
    $('checkout-status').className = 'status err'; $('checkout-status').textContent = err.message || 'No se pudo iniciar el pago. Intenta de nuevo.';
    btn.disabled = false; btn.textContent = original;
  }
});

renderSummary();
toggleEmpty();

const checkoutParams = new URLSearchParams(window.location.search);
if (checkoutParams.get('payment') === 'cancelled') {
  $('checkout-status').textContent = 'Pago cancelado. Tu carrito sigue disponible para intentarlo de nuevo.';
}
const sessionId = checkoutParams.get('session_id');
if (sessionId) {
  const btn = $('checkout-submit');
  btn.disabled = true; btn.textContent = 'Verificando pago...';
  fetch('/api/checkout/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId })
  }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo confirmar el pago.');
    window.history.replaceState(null, '', window.location.pathname);
    finishOrder(j.folio, j.email);
  }).catch(err => {
    $('checkout-status').className = 'status err'; $('checkout-status').textContent = err.message || 'No se pudo confirmar el pago.';
  }).finally(() => {
    btn.disabled = false; btn.textContent = 'Confirmar pedido';
  });
}
