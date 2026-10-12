const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadBackend, sampleBody } = require('./helpers');

const ROOT = path.join(__dirname, '..');

/* js/data.js está escrito para el navegador: se evalúa en un sandbox y se extraen FONTS y fitText */
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8') + '\n;this.__x = { FONTS, fitText };', sandbox, { filename: 'data.js' });
const { FONTS, fitText } = sandbox.__x;

const primary = f => /'([^']+)'/.exec(f.family)[1];
const display = FONTS.find(f => f.id === 'display');

test('las tipografías son familias distintas entre sí y con datos completos', () => {
  assert.ok(FONTS.length >= 5);
  assert.equal(new Set(FONTS.map(f => f.id)).size, FONTS.length, 'ids repetidos');
  assert.equal(new Set(FONTS.map(primary)).size, FONTS.length, 'dos opciones comparten la misma familia');
  for (const f of FONTS) {
    assert.ok(f.name && f.family && f.weight, `faltan datos en ${f.id}`);
    assert.ok(f.avg > 0 && f.avg < 1, `avg inválido en ${f.id}`);
    assert.ok(f.lh >= 1, `lh inválido en ${f.id}`);
    assert.equal(f.style, 'normal', `${f.id} depende de una cursiva sintética del navegador`);
  }
});

test('cada tipografía está pedida en el <link> de Google Fonts de las páginas que muestran texto personalizado', () => {
  for (const page of ['index.html', 'checkout.html', 'personalizar.html', '404.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const href = /href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/.exec(html);
    assert.ok(href, `${page} no carga Google Fonts`);
    for (const f of FONTS) {
      assert.ok(href[1].includes('family=' + primary(f).replace(/ /g, '+')), `${page} no pide ${primary(f)}`);
    }
  }
});

test('el servidor acepta todas las tipografías del catálogo y descarta las desconocidas', () => {
  const be = loadBackend();
  try {
    const item = fontId => ({ kind: 'custom', cut: 'regular', color: '#2F4BFF', size: 'L', qty: 1, text: 'Hola', fontId, unitPrice: 1 });
    for (const f of FONTS) {
      assert.equal(be.orders.prepareOrder(sampleBody({ items: [item(f.id)] })).items[0].fontId, f.id);
    }
    assert.equal(be.orders.prepareOrder(sampleBody({ items: [item('inventada')] })).items[0].fontId, null);
  } finally { be.close(); }
});

test('fitText: una palabra corta usa el tamaño máximo y un solo renglón', () => {
  const r = fitText('Hola', display, 580, 400, 150);
  assert.deepEqual([...r.lines], ['Hola']);
  assert.equal(r.fs, 150);
});

test('fitText: una frase se reparte en dos renglones cuando así crece al menos 15 %', () => {
  const unRenglon = 580 / ('HECHO A MANO'.length * display.avg);
  const r = fitText('HECHO A MANO', display, 580, 400, 150);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines.join(' '), 'HECHO A MANO');
  assert.ok(r.fs >= unRenglon * 1.15, `fs ${r.fs} no mejora lo bastante sobre ${unRenglon}`);
});

test('fitText: una palabra larga sin espacios se queda en un renglón y cabe en el ancho', () => {
  const t = 'ABCDEFGHIJKLMNOPQRSTUVWX';
  const r = fitText(t, display, 580, 400, 150);
  assert.deepEqual([...r.lines], [t]);
  assert.ok(t.length * display.avg * r.fs <= 580 + 1e-6);
});

test('fitText: sin texto devuelve null y normaliza espacios sobrantes', () => {
  assert.equal(fitText('', display, 580, 400, 150), null);
  assert.equal(fitText('   ', display, 580, 400, 150), null);
  assert.equal(fitText(null, display, 580, 400, 150), null);
  assert.equal(fitText('  Hola   mundo ', display, 580, 400, 150).lines.join(' '), 'Hola mundo');
});

test('fitText usa la función de medida cuando se le da una', () => {
  const r = fitText('Hola', display, 100, 1000, 1000, () => 2);
  assert.equal(r.fs, 50); // 100 / 2 em
});

test('fitText nunca se sale de la caja con ninguna tipografía ni longitud', () => {
  const textos = ['A', 'Hola', 'HECHO A MANO', 'Yo amo las playeras bien', 'Mi equipo 2026', 'Ñandú ¡qué bien!', 'x y z w v u t s r q p o'];
  for (const f of FONTS) for (const t of textos) for (const [w, h, max] of [[580, 400, 150], [580, 150, 72], [90, 90, 23]]) {
    const r = fitText(t, f, w, h, max);
    const ancho = Math.max(...r.lines.map(l => l.length * f.avg)) * r.fs;
    assert.ok(r.fs <= max + 1e-9, `${f.id} "${t}" supera el máximo`);
    assert.ok(ancho <= w + 1e-6, `${f.id} "${t}" se sale del ancho (${ancho} > ${w})`);
    assert.ok(r.lines.length * r.fs * r.lh <= h + 1e-6, `${f.id} "${t}" se sale del alto`);
    assert.equal(r.lines.join(' '), t.replace(/\s+/g, ' ').trim());
  }
});