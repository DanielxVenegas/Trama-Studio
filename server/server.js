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

const { createOrder, OrderError } = require('./orders');
const admin = require('./admin');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
const json = (res, code, o, headers) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(JSON.stringify(o)); };

function limiter(max, windowMs) {
  const hits = new Map();
  return ip => {
    const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return true;
    arr.push(now); hits.set(ip, arr);
    return false;
  };
}
const orderLimited = limiter(10, 36e5);

const readBody = (req, max) => new Promise((ok, fail) => {
  let n = 0; const c = [];
  req.on('data', d => { n += d.length; if (n > max) { fail(new Error('Cuerpo demasiado grande')); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c))); req.on('error', fail);
});
const readJSON = async (req, max) => JSON.parse((await readBody(req, max)).toString() || '{}');
const isJSON = req => /^application\/json/i.test(req.headers['content-type'] || '');

const sendFile = (res, f) => fs.readFile(f, (err, buf) => {
  if (err) { res.writeHead(404); return res.end('No encontrado'); }
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress;
  try {
    if (url.pathname === '/api/config') return json(res, 200, { orders: true });

    if (url.pathname === '/api/stock' && req.method === 'GET') {
      const map = {}; admin.listStock().forEach(p => { map[p.id] = p.qty; });
      return json(res, 200, map);
    }

    if (url.pathname === '/api/orders' && req.method === 'POST') {
      if (orderLimited(ip)) return json(res, 429, { error: 'Demasiados pedidos desde aquí. Prueba más tarde.' });
      if (!isJSON(req)) return json(res, 400, { error: 'Formato de petición inválido.' });
      let body;
      try { body = await readJSON(req, ORDER_BODY_MAX); } catch (e) { return json(res, 400, { error: 'No se pudo leer el pedido.' }); }
      try { return json(res, 201, createOrder(body)); }
      catch (e) { if (!sendKnownError(res, e, OrderError)) throw e; }
      return;
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
        try { return json(res, 200, admin.setOrderStatus(decodeURIComponent(orderMatch[1]), body.status)); }
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

    let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p), rel = path.relative(ROOT, f);
    if (rel.startsWith('..') || /(^|[\\/])(server|node_modules|\.[^\\/]*)([\\/]|$)/.test(rel)) { res.writeHead(404); return res.end('No encontrado'); }
    sendFile(res, f);
  } catch (e) { json(res, 500, { error: 'Error del servidor.' }); }
}).listen(PORT, () => console.log(
  `Trama Studio en http://localhost:${PORT}  (administrador: ${admin.configured() ? 'activo' : 'sin configurar'})`
));
