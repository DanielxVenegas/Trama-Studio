/* Panel del administrador: login por contraseña, listado/detalle de pedidos (con cambio de estado)
   y edición de stock. Usa toast() (de components.js) y fetch con cookies de sesión. */
const $ = id => document.getElementById(id);

const STATUS_LABELS = {
  pendiente: 'Pendiente', pagado: 'Pagado', en_produccion: 'En producción',
  enviado: 'Enviado', entregado: 'Entregado', cancelado: 'Cancelado'
};

const state = { status: '', q: '', page: 1 };

async function api(path, options) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Ocurrió un error.'); err.status = r.status; throw err; }
  return j;
}

function formatDate(s) {
  try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch (e) { return s; }
}

function showLogin() { $('admin-login').hidden = false; $('admin-panel').hidden = true; }
function showPanel() { $('admin-login').hidden = true; $('admin-panel').hidden = false; }

function markUnconfigured(msg) {
  showLogin();
  $('login-status').className = 'status err'; $('login-status').textContent = msg;
  $('admin-password').setAttribute('disabled', 'true');
  $('login-submit').setAttribute('disabled', 'true');
}

/* --- Pestañas --- */
function selectTab(tab) {
  const isOrders = tab === 'orders';
  $('tab-orders').setAttribute('aria-selected', String(isOrders));
  $('tab-stock').setAttribute('aria-selected', String(!isOrders));
  $('panel-orders').hidden = !isOrders;
  $('panel-stock').hidden = isOrders;
  if (isOrders) loadOrders(); else loadStock();
}
$('tab-orders').addEventListener('click', () => selectTab('orders'));
$('tab-stock').addEventListener('click', () => selectTab('stock'));

/* --- Login / logout --- */
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('login-submit'), original = btn.textContent;
  $('login-status').className = 'status'; $('login-status').textContent = '';
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value }) });
    $('admin-password').value = '';
    showPanel(); selectTab('orders');
  } catch (err) {
    if (err.status === 503) { markUnconfigured(err.message); return; }
    $('login-status').className = 'status err'; $('login-status').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

$('logout-btn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
  showLogin();
});

/* --- Pedidos --- */
function orderRow(o) {
  return `<tr>
    <td>${o.folio}</td>
    <td>${formatDate(o.created_at)}</td>
    <td>${o.first_name} ${o.last_name}<br><span class="meta">${o.email}</span></td>
    <td>$${o.total}</td>
    <td><span class="status-badge status-${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td>
    <td><button type="button" class="btn btn-ghost btn-sm" data-folio="${o.folio}">Ver</button></td>
  </tr>`;
}

async function loadOrders() {
  $('orders-status').className = 'status'; $('orders-status').textContent = 'Cargando pedidos...';
  try {
    const params = new URLSearchParams({ page: state.page });
    if (state.status) params.set('status', state.status);
    if (state.q) params.set('q', state.q);
    const data = await api('/api/admin/orders?' + params.toString());
    $('orders-status').textContent = '';
    $('orders-body').innerHTML = data.rows.length
      ? data.rows.map(orderRow).join('')
      : '<tr><td colspan="6" class="admin-empty">No hay pedidos con esos filtros.</td></tr>';
    renderPagination(data.page, data.pages);
  } catch (err) {
    $('orders-status').className = 'status err'; $('orders-status').textContent = err.message;
    $('orders-body').innerHTML = ''; $('orders-pagination').innerHTML = '';
  }
}

function renderPagination(page, pages) {
  if (pages <= 1) { $('orders-pagination').innerHTML = ''; return; }
  const btn = (p, label, disabled) => `<button type="button" class="btn btn-ghost btn-sm" data-page="${p}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  $('orders-pagination').innerHTML = `${btn(page - 1, 'Anterior', page <= 1)}<span class="meta">Página ${page} de ${pages}</span>${btn(page + 1, 'Siguiente', page >= pages)}`;
}

$('orders-pagination').addEventListener('click', e => {
  const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
  state.page = Number(b.dataset.page); loadOrders();
});

$('orders-body').addEventListener('click', e => {
  const b = e.target.closest('[data-folio]'); if (!b) return;
  openOrderDialog(b.dataset.folio);
});

let filterTimer = null;
$('filter-status').addEventListener('change', () => { state.status = $('filter-status').value; state.page = 1; loadOrders(); });
$('filter-q').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { state.q = $('filter-q').value.trim(); state.page = 1; loadOrders(); }, 350);
});

/* --- Detalle de pedido --- */
function itemRow(it) {
  const meta = [`Talla ${it.size}`, `x${it.qty}`, it.text ? `"${it.text}"` : ''].filter(Boolean).join(' · ');
  return `<div class="order-item">
    ${it.thumb ? `<img src="${it.thumb}" alt="" class="order-item-thumb">` : '<div class="order-item-thumb order-item-thumb-empty"></div>'}
    <div class="order-item-info">
      <strong>${it.name}</strong>
      <span class="meta">${meta}</span>
      ${it.notes ? `<span class="meta">Notas: ${it.notes}</span>` : ''}
    </div>
    <span class="order-item-price">$${it.unit_price * it.qty}</span>
  </div>`;
}

async function openOrderDialog(folio) {
  const dlg = $('order-dialog');
  $('order-dialog-title').textContent = folio;
  $('order-dialog-body').innerHTML = '<p class="meta">Cargando...</p>';
  dlg.showModal();
  try {
    const { order, items } = await api('/api/admin/orders/' + encodeURIComponent(folio));
    const statusOptions = Object.keys(STATUS_LABELS)
      .map(s => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('');

    $('order-dialog-body').innerHTML = `
      <div class="order-dialog-grid">
        <div>
          <p><strong>${order.first_name} ${order.last_name}</strong></p>
          <p class="meta">${order.email} · ${order.phone}</p>
          <p class="meta">${order.address}, ${order.city}, ${order.state} ${order.zip}</p>
          <p class="meta">Pago: ${order.pay_method}${order.promo_code ? ' · Código ' + order.promo_code : ''}</p>
        </div>
        <div class="order-status-field">
          <label for="order-status-select">Estado del pedido</label>
          <select id="order-status-select" ${order.status === 'cancelado' ? 'disabled' : ''}>${statusOptions}</select>
          <span class="status" id="order-status-msg" role="status"></span>
        </div>
      </div>
      <div class="order-items">${items.map(itemRow).join('')}</div>
      <div class="cart-totals-like">
        <div><span>Subtotal</span><span>$${order.subtotal}</span></div>
        ${order.discount ? `<div><span>Descuento</span><span>-$${order.discount}</span></div>` : ''}
        <div><span>Envío</span><span>${order.shipping === 0 ? 'Gratis' : '$' + order.shipping}</span></div>
        <div class="total"><span>Total</span><span>$${order.total}</span></div>
      </div>`;

    $('order-status-select').addEventListener('change', async e => {
      const select = e.target, next = select.value, msg = $('order-status-msg'), previous = order.status;
      select.disabled = true;
      msg.className = 'status'; msg.textContent = 'Guardando...';
      try {
        await api('/api/admin/orders/' + encodeURIComponent(folio), { method: 'PATCH', body: JSON.stringify({ status: next }) });
        order.status = next;
        msg.textContent = 'Estado actualizado.';
        select.disabled = next === 'cancelado';
        toast(`Pedido ${folio}: ${STATUS_LABELS[next]}.`);
        loadOrders();
      } catch (err) {
        msg.className = 'status err'; msg.textContent = err.message;
        select.value = previous; select.disabled = false;
      }
    });
  } catch (err) {
    $('order-dialog-body').innerHTML = `<p class="status err">${err.message}</p>`;
  }
}

$('order-dialog-close').addEventListener('click', () => $('order-dialog').close());
$('order-dialog').addEventListener('click', e => { if (e.target === $('order-dialog')) $('order-dialog').close(); });

/* --- Stock --- */
function stockRow(p) {
  return `<tr data-id="${p.id}">
    <td>${p.name}</td>
    <td>${p.cut}</td>
    <td>${p.sizes}</td>
    <td><input type="number" min="0" max="9999" value="${p.qty}" class="stock-input" aria-label="Existencias de ${p.name}"></td>
    <td><button type="button" class="btn btn-ghost btn-sm stock-save">Guardar</button></td>
  </tr>`;
}

async function loadStock() {
  $('stock-status').className = 'status'; $('stock-status').textContent = 'Cargando stock...';
  try {
    const rows = await api('/api/admin/stock');
    $('stock-status').textContent = '';
    $('stock-body').innerHTML = rows.length ? rows.map(stockRow).join('') : '<tr><td colspan="5" class="admin-empty">No hay productos.</td></tr>';
  } catch (err) {
    $('stock-status').className = 'status err'; $('stock-status').textContent = err.message;
    $('stock-body').innerHTML = '';
  }
}

$('stock-body').addEventListener('click', async e => {
  const btn = e.target.closest('.stock-save'); if (!btn) return;
  const row = btn.closest('tr'), id = row.dataset.id, input = row.querySelector('.stock-input');
  const qty = Number(input.value);
  btn.disabled = true; const original = btn.textContent; btn.textContent = 'Guardando...';
  try {
    await api('/api/admin/stock/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ qty }) });
    toast('Existencias actualizadas.');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

/* --- Arranque: si ya hay sesión activa (cookie vigente), entra directo al panel --- */
(async () => {
  try {
    await api('/api/admin/orders?page=1');
    showPanel(); selectTab('orders');
  } catch (err) {
    if (err.status === 503) markUnconfigured(err.message);
    else showLogin();
  }
})();
