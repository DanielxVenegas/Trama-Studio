/* Servidor de Trama Studio: sirve el sitio y protege la llave de la API (Dynamic Mockups).
   Sin dependencias. Requiere Node 18 o superior. Uso: npm start */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), TMP = path.join(__dirname, 'tmp');
try { /* lee .env sin librerías */
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}
const { DM_API_KEY, DM_MOCKUP_UUID, DM_SMART_OBJECT_UUID, DM_COLOR_OBJECT_UUID, PUBLIC_URL } = process.env;
const PORT = process.env.PORT || 3000, API = 'https://app.dynamicmockups.com/api/v1';
const enabled = () => !!(DM_API_KEY && DM_MOCKUP_UUID && DM_SMART_OBJECT_UUID && PUBLIC_URL);
fs.mkdirSync(TMP, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const hits = new Map(); /* tope: 10 renders por hora por IP, para cuidar tus créditos */
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 36e5); if (a.length >= 10) return true; a.push(n); hits.set(ip, a); return false; };
const readBody = (req, max) => new Promise((ok, fail) => {
  let n = 0; const c = [];
  req.on('data', d => { n += d.length; if (n > max) { fail(new Error('Archivo demasiado grande')); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c))); req.on('error', fail);
});
const sendFile = (res, f) => fs.readFile(f, (err, buf) => {
  if (err) { res.writeHead(404); return res.end('No encontrado'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/config') return json(res, 200, { mockup: enabled() });

    /* Ayuda para encontrar tus UUID: abre /api/mockups en el navegador */
    if (url.pathname === '/api/mockups' && DM_API_KEY) {
      const r = await fetch(API + '/mockups', { headers: { 'x-api-key': DM_API_KEY, Accept: 'application/json' } });
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(await r.text());
    }

    if (url.pathname === '/api/mockup' && req.method === 'POST') {
      if (!enabled()) return json(res, 503, { error: 'La API de fotos realistas no está configurada.' });
      if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'Demasiados intentos. Prueba más tarde.' });
      const { img, color } = JSON.parse((await readBody(req, 12e6)).toString());
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(img || '');
      if (!m) return json(res, 400, { error: 'Imagen inválida.' });
      const id = crypto.randomUUID() + '.png', file = path.join(TMP, id);
      fs.writeFileSync(file, Buffer.from(m[1], 'base64')); setTimeout(() => fs.unlink(file, () => {}), 10 * 60e3);
      const so = [{ uuid: DM_SMART_OBJECT_UUID, asset: { url: PUBLIC_URL.replace(/\/$/, '') + '/tmp/' + id, fit: 'contain' } }];
      if (DM_COLOR_OBJECT_UUID && /^#[0-9a-f]{6}$/i.test(color || '')) so.push({ uuid: DM_COLOR_OBJECT_UUID, color });
      const r = await fetch(API + '/renders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': DM_API_KEY },
        body: JSON.stringify({ mockup_uuid: DM_MOCKUP_UUID, smart_objects: so, export_options: { image_format: 'webp', image_size: 1400, mode: 'view' } })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.data || !d.data.export_path) return json(res, 502, { error: d.message || 'No se pudo generar la imagen.' });
      return json(res, 200, { url: d.data.export_path });
    }

    if (url.pathname.startsWith('/tmp/')) { /* imagen temporal que la API descarga */
      const n = path.basename(url.pathname); return /^[\w-]+\.png$/.test(n) ? sendFile(res, path.join(TMP, n)) : (res.writeHead(404), res.end());
    }

    let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p), rel = path.relative(ROOT, f);
    if (rel.startsWith('..') || /(^|[\\/])(server|node_modules|\.[^\\/]*)([\\/]|$)/.test(rel)) { res.writeHead(404); return res.end('No encontrado'); }
    sendFile(res, f);
  } catch (e) { json(res, 500, { error: 'Error del servidor.' }); }
}).listen(PORT, () => console.log(`Trama Studio en http://localhost:${PORT}  (fotos realistas: ${enabled() ? 'activas' : 'sin configurar'})`));
