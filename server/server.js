/* Servidor de Trama Studio: sirve el sitio y expone la API de pedidos y del administrador.
   Sin dependencias externas. Requiere Node 22.13 o superior (usa node:sqlite). Uso: npm start */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
try { /* lee .env sin librerías */
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const PORT = process.env.PORT || 3000;

const log = require('./log');
const orders = require('./orders');
const { OrderError } = orders;
const payments = require('./payments');
const admin = require('./admin');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
const NOT_FOUND_PAGE = path.join(ROOT, '404.html');

/* Cabeceras de seguridad en todas las respuestas. La CSP permite solo lo que el sitio usa hoy:
   scripts propios y Three.js desde cdnjs, estilos propios (con style inline) y Google Fonts. */
const HTTPS = /^https:/i.test(process.env.PUBLIC_URL || '');
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  ...(HTTPS ? { 'Strict-Transport-Security': 'max-age=15552000' } : {})
};

/* Detrás de Nginx, Caddy o un PaaS todas las conexiones llegan desde el proxy. Con TRUST_PROXY=N
   (número de proxies de confianza) se toma la IP real de X-Forwarded-For contando desde la derecha,
   así un cliente no puede falsear su IP para saltarse los límites. Sin TRUST_PROXY se usa la conexión directa. */
const TRUST_PROXY = Math.max(0, parseInt(process.env.TRUST_PROXY, 10) || 0);
function clientIp(req) {
  const direct = req.socket.remoteAddress || 'desconocida';
  if (!TRUST_PROXY) return direct;
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return (hops.length ? hops[Math.max(0, hops.length - TRUST_PROXY)] : direct).slice(0, 64);
}

const json = (res, code, o, headers) => {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(o));
};

function limiter(max, windowMs) {
  const hits = new Map();
  return ip => {
    const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return true;
    arr.push(now); hits.set(ip, arr);
    if (hits.size > 5000) for (const [key, times] of hits) if (!times.some(t => now - t < windowMs)) hits.delete(key);
    return false;
  };
}
const orderLimited = limiter(10, 36e5);
const completionLimited = limiter(30, 36e5);

const readBody = (req, max) => new Promise((ok, fail) => {
  let n = 0; const c = [];
  req.on('data', d => { n += d.length; if (n > max) { fail(new Error('Cuerpo demasiado grande')); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c))); req.on('error', fail);
});
const readJSON = async (req, max) => JSON.parse((await readBody(req, max)).toString() || '{}');
const isJSON = req => /^application\/json/i.test(req.headers['content-type'] || '');

/* Las rutas sin extensión o .html reciben la página 404 del sitio; los recursos (css, js, imágenes) un texto simple */
const wantsPage = p => ['', '.html'].includes(path.extname(p));
function notFound(res, asPage) {
  if (!asPage) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
  fs.readFile(NOT_FOUND_PAGE, (err, buf) => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(err ? 'No encontrado' : buf);
  });
}

const sendFile = (res, f) => fs.readFile(f, (err, buf) => {
  if (err) return notFound(res, wantsPage(f));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
});

const ORDER_BODY_MAX = 6e6;
const ADMIN_BODY_MAX = 2e6;
const ORDER_DETAIL_RE = /^\/api\/admin\/orders\/([^/]+)$/;
const STOCK_ITEM_RE = /^\/api\/admin\/stock\/([^/]+)$/;

const sendKnownError = (res, e, ErrClass) => {
  if (e instanceof ErrClass) { json(res, e.status, { error: e.message }); return true; }
  return false;
};

const server = http.createServer(async (req, res) => {
  const started = Date.now(), ip = clientIp(req);
  let pathname = '(url inválida)';
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => res.setHeader(name, value));
  /* Se registran las llamadas a la API y cualquier respuesta con error; los archivos estáticos correctos no */
  res.on('finish', () => {
    if (!pathname.startsWith('/api/') && res.statusCode < 400) return;
    (res.statusCode >= 500 ? log.error : log.info)('http', `${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms ip=${ip}`);
  });

  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { return json(res, 400, { error: 'URL inválida.' }); }
  pathname = url.pathname;

  try {
    if (url.pathname === '/api/config') return json(res, 200, { payments: payments.configured() });

    if (url.pathname === '/api/stripe/webhook' && req.method === 'POST') {
      let raw;
      try { raw = (await readBody(req, 1e6)).toString(); }
      catch (e) { return json(res, 400, { error: 'No se pudo leer el webhook.' }); }
      try { return json(res, 200, await payments.handleWebhook(raw, req.headers['stripe-signature'])); }
      catch (e) {
        if (e instanceof payments.PaymentError || e instanceof OrderError) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (url.pathname === '/api/checkout/sessions' && req.method === 'POST') {
      if (orderLimited(ip)) return json(res, 429, { error: 'Demasiados intentos de pago. Prueba más tarde.' });
      if (!isJSON(req)) return json(res, 400, { error: 'Formato de petición inválido.' });
      let body;
      try { body = await readJSON(req, ORDER_BODY_MAX); } catch (e) { return json(res, 400, { error: 'No se pudo leer el pedido.' }); }
      try { return json(res, 201, await payments.createCheckoutSession(body)); }
      catch (e) {
        if (e instanceof payments.PaymentError || e instanceof OrderError) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (url.pathname === '/api/checkout/complete' && req.method === 'POST') {
      if (completionLimited(ip)) return json(res, 429, { error: 'Demasiados intentos de verificación. Prueba más tarde.' });
      if (!isJSON(req)) return json(res, 400, { error: 'Formato de petición inválido.' });
      let body;
      try { body = await readJSON(req, 2e3); } catch (e) { return json(res, 400, { error: 'No se pudo leer la petición.' }); }
      try { return json(res, 200, await payments.completeCheckout(body.sessionId)); }
      catch (e) {
        if (e instanceof payments.PaymentError || e instanceof OrderError) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    if (url.pathname === '/api/stock' && req.method === 'GET') {
      const map = {}; admin.listStock().forEach(p => { map[p.id] = p.qty; });
      return json(res, 200, map);
    }

    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      if (!isJSON(req)) return json(res, 400, { error: 'Formato de petición inválido.' });
      let body;
      try { body = await readJSON(req, ADMIN_BODY_MAX); } catch (e) { return json(res, 400, { error: 'No se pudo leer la petición.' }); }
      try { return json(res, 200, { ok: true }, { 'Set-Cookie': admin.login(body.password, ip) }); }
      catch (e) { if (!sendKnownError(res, e, admin.AdminError)) throw e; }
      return;
    }

    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': admin.clearSessionCookie() });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!admin.configured()) return json(res, 503, { error: 'El panel del administrador no está configurado.' });
      if (!admin.isAuthed(req)) return json(res, 401, { error: 'No autorizado.' });

      if (url.pathname === '/api/admin/orders' && req.method === 'GET') {
        return json(res, 200, admin.listOrders({
          status: url.searchParams.get('status') || '',
          q: url.searchParams.get('q') || '',
          page: url.searchParams.get('page') || '1'
        }));
      }

      const orderMatch = ORDER_DETAIL_RE.exec(url.pathname);
      if (orderMatch && req.method === 'GET') {
        try { return json(res, 200, admin.getOrder(decodeURIComponent(orderMatch[1]))); }
        catch (e) { if (!sendKnownError(res, e, admin.AdminError)) throw e; }
        return;
      }
      if (orderMatch && req.method === 'PATCH') {
        if (!isJSON(req)) return json(res, 400, { error: 'Formato de petición inválido.' });
        let body;
        try { body = await readJSON(req, ADMIN_BODY_MAX); } catch (e) { return json(res, 400, { error: 'No se pudo leer la petición.' }); }
        try { return json(res, 200, await admin.updateOrderStatus(decodeURIComponent(orderMatch[1]), body.status)); }
        catch (e) { if (!sendKnownError(res, e, admin.AdminError)) throw e; }
        return;
      }

      if (url.pathname === '/api/admin/stock' && req.method === 'GET') return json(res, 200, admin.listStock());

      const stockMatch = STOCK_ITEM_RE.exec(url.pathname);
      if (stockMatch && req.method === 'PUT') {
        if (!isJSON(req)) return json(res, 400, { error: 'Formato de petición inválido.' });
        let body;
        try { body = await readJSON(req, ADMIN_BODY_MAX); } catch (e) { return json(res, 400, { error: 'No se pudo leer la petición.' }); }
        try { return json(res, 200, admin.setStock(decodeURIComponent(stockMatch[1]), body.qty)); }
        catch (e) { if (!sendKnownError(res, e, admin.AdminError)) throw e; }
        return;
      }

      return json(res, 404, { error: 'Ruta del administrador no encontrada.' });
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta no encontrada.' });

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    let p;
    try { p = decodeURIComponent(url.pathname); } catch (e) { return notFound(res, true); }
    if (p.includes('\0')) return notFound(res, true);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p), rel = path.relative(ROOT, f);
    if (rel.startsWith('..') || path.isAbsolute(rel) || /(^|[\\/])(server|tests|node_modules|\.[^\\/]*)([\\/]|$)/.test(rel)) return notFound(res, wantsPage(p));
    sendFile(res, f);
  } catch (e) {
    log.error('http', `${req.method} ${pathname}\n${log.detail(e)}`);
    if (!res.headersSent) json(res, 500, { error: 'Error del servidor.' });
    else res.end();
  }
});

/* Limpia los borradores de pago sin pedido con más de 24 horas (al arrancar y cada 6 horas) */
function purgeStaleCheckouts() {
  try {
    const n = orders.purgeStaleCheckouts(24);
    if (n) log.info('orders', `Se eliminaron ${n} borradores de pago sin completar con más de 24 horas.`);
  } catch (e) { log.error('orders', log.detail(e)); }
}

process.on('unhandledRejection', e => log.error('process', `Promesa rechazada sin manejar: ${log.detail(e)}`));

server.listen(PORT, () => {
  log.info('server', `Trama Studio en http://localhost:${PORT}  (administrador: ${admin.configured() ? 'activo' : 'sin configurar'}, pagos: ${payments.configured() ? 'activos' : 'sin configurar'}${TRUST_PROXY ? `, proxies de confianza: ${TRUST_PROXY}` : ''})`);
  purgeStaleCheckouts();
  setInterval(purgeStaleCheckouts, 6 * 36e5).unref();
});
