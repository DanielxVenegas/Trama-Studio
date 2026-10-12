const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildTicketPDF, textWidth, wrapText } = require(path.join(__dirname, '..', 'js', 'ticket-pdf.js'));

/* El PDF se escribe en un byte por caracter (latin1), así que se puede inspeccionar como texto */
const asText = u8 => Buffer.from(u8).toString('latin1');
const pageCount = pdf => (pdf.match(/\/Type \/Page\b(?!s)/g) || []).length;

const sample = (overrides = {}) => ({
  folio: 'TS-00042', date: new Date(2026, 9, 12, 12, 6), testMode: true, contactEmail: 'hola@tramastudio.com',
  customer: {
    firstName: 'Ana María', lastName: 'Pérez Núñez', email: 'ana@example.com', phone: '5512345678',
    address: 'Av. Insurgentes Sur 1234, Col. Del Valle', city: 'Ciudad de México', state: 'CDMX', zip: '03100'
  },
  items: [
    { name: 'Básica Cobalto', details: ['Corte Regular · Color Cobalto · Talla M'], qty: 2, price: 189 },
    { name: 'Playera Oversize personalizada', details: ['Texto: "HECHO A MANO"', 'Estampado: Rayo'], qty: 1, price: 259 }
  ],
  totals: { subtotal: 637, discount: 64, promo: 'TRAMA10', promoRate: 0.1, shipping: 79, total: 652 },
  ...overrides
});

test('el archivo es un PDF válido: encabezado, final y tabla xref con los desplazamientos correctos', () => {
  const bytes = buildTicketPDF(sample()), pdf = asText(bytes);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  assert.ok(pdf.endsWith('%%EOF\n'));

  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)[1]);
  assert.equal(pdf.slice(startxref, startxref + 5), 'xref\n');
  const [, count] = /^xref\n0 (\d+)\n/.exec(pdf.slice(startxref));
  const entries = pdf.slice(startxref).split('\n').slice(2, 2 + Number(count));
  assert.equal(entries.length, Number(count));
  entries.slice(1).forEach((line, i) => {
    assert.equal(line.length, 19, 'cada entrada xref mide 20 bytes con el salto de línea');
    const offset = Number(line.slice(0, 10)), id = i + 1;
    assert.ok(pdf.startsWith(`${id} 0 obj\n`, offset), `el objeto ${id} está en el desplazamiento indicado`);
  });
  assert.match(pdf, new RegExp(`/Size ${count} /Root 1 0 R`));
});

test('los acentos y la ñ se codifican en WinAnsi y los datos del pedido aparecen en el contenido', () => {
  const pdf = asText(buildTicketPDF(sample()));
  assert.ok(pdf.includes('(TS-00042) Tj'));
  assert.ok(pdf.includes('(Ana Mar\xEDa P\xE9rez N\xFA\xF1ez) Tj'), 'í, é, ú y ñ como bytes latin1');
  assert.ok(pdf.includes('(Direcci\xF3n de env\xEDo) Tj'));
  assert.ok(pdf.includes('(12 de octubre de 2026) Tj'));
  assert.ok(pdf.includes('(12:06 h) Tj'));
  assert.ok(pdf.includes('($652 MXN) Tj'));
  assert.ok(pdf.includes('(C\xF3digo TRAMA10 \\(-10%\\)) Tj'), 'etiqueta del código con su porcentaje');
  assert.ok(pdf.includes('(-$64) Tj'));
  assert.ok(pdf.includes('/BaseFont /Helvetica /Encoding /WinAnsiEncoding'));
});

test('los paréntesis y diagonales invertidas del texto se escapan para no romper el contenido', () => {
  const pdf = asText(buildTicketPDF(sample({ items: [{ name: 'Camisa (edición) \\ ñandú', details: [], qty: 1, price: 100 }] })));
  assert.ok(pdf.includes('(Camisa \\(edici\xF3n\\) \\\\ \xF1and\xFA) Tj'));
});

test('los caracteres que WinAnsi no tiene se sustituyen por ? y no rompen el archivo', () => {
  const pdf = asText(buildTicketPDF(sample({ items: [{ name: 'Playera ✓ 😀', details: [], qty: 1, price: 100 }] })));
  assert.ok(pdf.includes('(Playera ? ?) Tj'));
});

test('muestra "Gratis" cuando el envío es gratis y omite la fila de código si no hay descuento', () => {
  const pdf = asText(buildTicketPDF(sample({ totals: { subtotal: 1000, discount: 0, shipping: 0, total: 1000 } })));
  assert.ok(pdf.includes('(Gratis) Tj'));
  assert.ok(!pdf.includes('C\xF3digo'));
  assert.ok(pdf.includes('($1,000 MXN) Tj'), 'separador de miles');
});

test('el aviso de pago de prueba solo aparece si testMode está activo', () => {
  assert.ok(asText(buildTicketPDF(sample())).includes('Pago de prueba'));
  assert.ok(!asText(buildTicketPDF(sample({ testMode: false }))).includes('Pago de prueba'));
});

test('un pedido corto cabe en una página y uno largo continúa en otra con numeración de páginas', () => {
  const one = asText(buildTicketPDF(sample()));
  assert.equal(pageCount(one), 1);
  assert.ok(one.includes('(P\xE1gina 1 de 1) Tj'));

  const items = Array.from({ length: 12 }, (_, i) => ({ name: `Playera personalizada ${i + 1}`, details: ['Corte Slim · Color Negro · Talla M'], qty: 1, price: 239 }));
  const many = asText(buildTicketPDF(sample({ items, totals: { subtotal: 2868, discount: 0, shipping: 0, total: 2868 } })));
  assert.ok(pageCount(many) >= 2);
  assert.ok(many.includes('(Ticket TS-00042 \\(continuaci\xF3n\\)) Tj'));
  assert.ok(many.includes(`(P\xE1gina 2 de ${pageCount(many)}) Tj`));
  assert.ok(many.includes('(Playera personalizada 12) Tj'), 'ninguna prenda se pierde al paginar');
});

test('las miniaturas JPEG se incrustan como XObject; los datos que no son JPEG se ignoran', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const withImage = sample();
  withImage.items[0].image = { data: jpeg, width: 360, height: 300 };
  withImage.items[1].image = { data: Uint8Array.from([1, 2, 3, 4, 5, 6]), width: 10, height: 10 };
  const bytes = buildTicketPDF(withImage), pdf = asText(bytes);

  assert.equal((pdf.match(/\/Filter \/DCTDecode/g) || []).length, 1, 'solo la imagen válida se incrusta');
  assert.match(pdf, /\/Subtype \/Image \/Width 360 \/Height 300 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 11 >>\nstream\n/);
  assert.ok(pdf.includes('/XObject << /Im1 6 0 R >>'));
  assert.ok(pdf.includes('/Im1 Do'));
  assert.ok(asText(bytes).includes('\xFF\xD8\xFF\xE0\x01\x02\x03\x04\x05\xFF\xD9'), 'los bytes del JPEG van intactos');

  assert.ok(!asText(buildTicketPDF(sample())).includes('/XObject'), 'sin imágenes no hay XObject');
});

test('un pedido casi vacío no lanza errores y usa valores por defecto', () => {
  assert.doesNotThrow(() => buildTicketPDF());
  const pdf = asText(buildTicketPDF({}));
  assert.ok(pdf.includes('(SIN-FOLIO) Tj'));
  assert.ok(pdf.includes('(Sin prendas registradas.) Tj'));
  assert.ok(pdf.includes('($0 MXN) Tj'));
});

test('textWidth usa las métricas de Helvetica y las letras acentuadas miden como su base', () => {
  assert.equal(textWidth('Hola', 10, false), (722 + 556 + 222 + 556) * 10 / 1000);
  assert.equal(textWidth('W', 1000, false), 944);
  assert.equal(textWidth('W', 1000, true), 944);
  assert.equal(textWidth('i', 1000, false), 222);
  assert.equal(textWidth('á', 1000, false), textWidth('a', 1000, false));
  assert.equal(textWidth('Ñ', 1000, true), textWidth('N', 1000, true));
  assert.ok(textWidth('Hola', 10, true) > textWidth('Hola', 10, false));
});

test('wrapText parte por palabras y rompe las palabras que no caben en una línea', () => {
  const lines = wrapText('Av. Insurgentes Sur 1234 Col. Del Valle', 100, 10, false);
  assert.ok(lines.length > 1);
  lines.forEach(l => assert.ok(textWidth(l, 10, false) <= 100, `"${l}" cabe en el ancho`));
  assert.equal(lines.join(' '), 'Av. Insurgentes Sur 1234 Col. Del Valle');

  const long = wrapText('a'.repeat(200), 60, 10, false);
  assert.ok(long.length > 1);
  long.forEach(l => assert.ok(textWidth(l, 10, false) <= 60));
  assert.equal(long.join(''), 'a'.repeat(200));

  assert.deepEqual(wrapText('', 100, 10, false), ['']);
  assert.deepEqual(wrapText('  uno \n  dos ', 500, 10, false), ['uno dos']);
});
