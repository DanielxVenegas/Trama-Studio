/* Pruebas de integración del servidor HTTP: arranca server/server.js como proceso hijo desde una copia
   temporal del proyecto (su base SQLite queda en esa copia) y le hace peticiones reales. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function copyProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trama-http-'));
  for (const dir of ['server', 'js', 'css']) {
    fs.cpSync(path.join(SRC, dir), path.join(root, dir), { recursive: true, filter: src => path.basename(src) !== 'data' });
  }
  for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.html'))) fs.copyFileSync(path.join(SRC, file), path.join(root, file));
  return root;
}

const freePort = () => new Promise((ok, fail) => {
  const probe = net.createServer();
  probe.on('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});

async function startServer(env = {}) {
  const root = copyProject(), port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
    cwd: root, stdio: 'ignore',
    env: {
      ...process.env, PORT: String(port), LOG_LEVEL: 'silent', PUBLIC_URL: '', TRUST_PROXY: '',
      ADMIN_PASSWORD: 'clave-de-prueba', SESSION_SECRET: 'secreto-de-prueba', ...env
    }
  });
  let exited = false;
  child.on('exit', () => { exited = true; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (exited) throw new Error('El servidor terminó antes de estar listo');
    try { if ((await fetch(`${base}/api/config`)).ok) break; } catch (e) { /* aún no escucha */ }
    await sleep(100);
  }
  return {
    base, port,
    async stop() {
      if (!exited) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (e) {}
    }
  };
}

const rawStatus = (port, requestPath) => new Promise((ok, fail) => {
  http.get({ host: '127.0.0.1', port, path: requestPath }, res => { res.resume(); res.on('end', () => ok(res.statusCode)); }).on('error', fail);
});

const loginStatuses = async (base, forwardedFor) => {
  const out = [];
  for (const xff of forwardedFor) {
    const r = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: JSON.stringify({ password: 'incorrecta' })
    });
    out.push(r.status);
  }
  return out;
};

let plain;
before(async () => { plain = await startServer(); });
after(async () => { await plain.stop(); });

test('/api/config informa si los pagos con Stripe están configurados', async () => {
  const config = await (await fetch(`${plain.base}/api/config`)).json();
  assert.equal(typeof config.payments, 'boolean');
  assert.equal('email' in config, false);
});

test('todas las respuestas llevan cabeceras de seguridad y la API no se cachea', async () => {
  for (const url of ['/', '/api/config', '/no-existe']) {
    const r = await fetch(plain.base + url);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/, url);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', url);
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', url);
    assert.equal(r.headers.get('strict-transport-security'), null, 'sin https no debe enviarse HSTS');
  }
  assert.equal((await fetch(`${plain.base}/api/config`)).headers.get('cache-control'), 'no-store');
});

test('las rutas desconocidas devuelven la página 404 del sitio', async () => {
  const r = await fetch(`${plain.base}/ruta/que/no-existe`);
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /No encontramos esa página/);
});

test('los recursos inexistentes, la API y las rutas internas no devuelven HTML ni archivos del servidor', async () => {
  const css = await fetch(`${plain.base}/css/no-existe.css`);
  assert.equal(css.status, 404);
  assert.match(css.headers.get('content-type'), /text\/plain/);

  const api = await fetch(`${plain.base}/api/no-existe`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /application\/json/);
  assert.equal((await api.json()).error, 'Ruta no encontrada.');

  for (const blocked of ['/server/server.js', '/server/data/trama.db', '/tests/helpers.js', '/.env', '/.env.example']) {
    assert.equal((await fetch(plain.base + blocked)).status, 404, blocked);
  }
});

test('solo se aceptan GET y HEAD para archivos estáticos', async () => {
  const r = await fetch(`${plain.base}/index.html`, { method: 'POST' });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'GET, HEAD');
});

test('una URL inválida responde 400 y no tira el servidor', async () => {
  assert.equal(await rawStatus(plain.port, '//'), 400);
  assert.equal(await rawStatus(plain.port, '/%E0%A4%A'), 404);
  assert.equal((await fetch(`${plain.base}/`)).status, 200);
});

test('sin TRUST_PROXY el límite de login ignora X-Forwarded-For (no se puede falsear)', async () => {
  const statuses = await loginStatuses(plain.base, ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', '6.6.6.6']);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test('con TRUST_PROXY=1 cada cliente real tiene su propio límite y HSTS se activa con https', async () => {
  const proxied = await startServer({ TRUST_PROXY: '1', PUBLIC_URL: 'https://tienda.example.com' });
  try {
    const distinct = await loginStatuses(proxied.base, ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', '6.6.6.6']);
    assert.deepEqual(distinct, [401, 401, 401, 401, 401, 401]);

    /* Un cliente que antepone IPs falsas sigue contando como la IP que añadió el proxy (la de más a la derecha) */
    const spoofed = await loginStatuses(proxied.base, ['a1, 9.9.9.9', 'a2, 9.9.9.9', 'a3, 9.9.9.9', 'a4, 9.9.9.9', 'a5, 9.9.9.9', 'a6, 9.9.9.9']);
    assert.deepEqual(spoofed, [401, 401, 401, 401, 401, 429]);

    assert.equal((await fetch(`${proxied.base}/`)).headers.get('strict-transport-security'), 'max-age=15552000');
  } finally { await proxied.stop(); }
});
