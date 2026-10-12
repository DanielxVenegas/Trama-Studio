/* Ticket de compra en PDF, sin dependencias. Solo construye el archivo (Uint8Array); no toca el DOM,
   así que funciona igual en el navegador y en las pruebas de Node.
   Usa las fuentes estándar del PDF (Helvetica, sin incrustar) y los colores y el estilo "costura" del sitio. */
(function (root) {
  'use strict';

  const PAGE = { w: 612, h: 792 };                     /* Carta */
  const CARD = { x: 36, y: 36, w: 540, h: 720 };       /* "tarjeta" del ticket, con borde punteado como .stitch */
  const L = CARD.x + 28, R = CARD.x + CARD.w - 28;     /* márgenes interiores del contenido */
  const LIMIT = CARD.y + CARD.h - 42;                  /* y máxima del contenido (debajo va el pie) */

  const COLOR = {
    ink: '#101B33', cobalt: '#2F4BFF', sun: '#FFD23F', paper: '#EEF1F5', chalk: '#FFFFFF',
    muted: '#56627A', soft: '#E8ECFF', thumb: '#E3E8F2', line: '#C9D1E3'
  };

  /* ---------- Métricas de Helvetica (unidades por 1000 em), caracteres ASCII 32 a 126 ---------- */
  const W_REG = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    334, 260, 334, 584
  ];
  const W_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    333, 333, 584, 584, 584, 611, 975,
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    333, 278, 333, 584, 556, 333,
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
    389, 280, 389, 584
  ];
  /* Caracteres no ASCII frecuentes (regular, negrita) */
  const W_EXTRA = {
    '¿': [611, 611], '¡': [333, 333], '·': [278, 278], '×': [584, 584], '°': [400, 400], '–': [556, 556], '—': [1000, 1000],
    '“': [333, 500], '”': [333, 500], '‘': [222, 278], '’': [222, 278], '•': [350, 350], '…': [1000, 1000], '€': [556, 556], '©': [737, 737]
  };

  /* ---------- Codificación WinAnsi (cp1252): un byte por caracter ---------- */
  const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
  function winAnsi(cp) {
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
    const ch = String.fromCodePoint(cp);
    return CP1252[ch] || 0x3f;
  }
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ');

  function textWidth(str, size, bold) {
    let w = 0;
    for (const ch of clean(str)) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c <= 126) { w += (bold ? W_BOLD : W_REG)[c - 32]; continue; }
      if (W_EXTRA[ch]) { w += W_EXTRA[ch][bold ? 1 : 0]; continue; }
      const base = ch.normalize('NFD').charCodeAt(0);          /* á, ñ, ü... miden como a, n, u */
      w += (base >= 32 && base <= 126) ? (bold ? W_BOLD : W_REG)[base - 32] : 556;
    }
    return w * size / 1000;
  }

  /* Parte un texto en líneas que caben en maxW (rompe palabras más largas que la línea) */
  function wrapText(str, maxW, size, bold) {
    const words = clean(str).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean), lines = [];
    let cur = '';
    for (let w of words) {
      while (textWidth(w, size, bold) > maxW && w.length > 1) {
        let i = 1; while (i < w.length - 1 && textWidth(w.slice(0, i + 1), size, bold) <= maxW) i++;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, i)); w = w.slice(i);
      }
      if (!w) continue;
      const t = cur ? cur + ' ' + w : w;
      if (!cur || textWidth(t, size, bold) <= maxW) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  /* ---------- Utilidades de dibujo ---------- */
  const n = v => String(Math.round(v * 100) / 100);
  const Y = y => PAGE.h - y;                                   /* coordenadas con origen arriba a la izquierda */
  const rgb = hex => [1, 3, 5].map(i => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

  function pdfString(s) {
    let out = '';
    for (const ch of clean(s)) {
      const b = winAnsi(ch.codePointAt(0));
      out += (b === 0x5c || b === 0x28 || b === 0x29) ? '\\' + String.fromCharCode(b) : String.fromCharCode(b);
    }
    return out;
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    const k = r * 0.5523, x0 = x, x1 = x + w, y0 = Y(y), y1 = Y(y + h);
    return [
      `${n(x0 + r)} ${n(y0)} m`, `${n(x1 - r)} ${n(y0)} l`,
      `${n(x1 - r + k)} ${n(y0)} ${n(x1)} ${n(y0 - r + k)} ${n(x1)} ${n(y0 - r)} c`, `${n(x1)} ${n(y1 + r)} l`,
      `${n(x1)} ${n(y1 + r - k)} ${n(x1 - r + k)} ${n(y1)} ${n(x1 - r)} ${n(y1)} c`, `${n(x0 + r)} ${n(y1)} l`,
      `${n(x0 + r - k)} ${n(y1)} ${n(x0)} ${n(y1 + r - k)} ${n(x0)} ${n(y1 + r)} c`, `${n(x0)} ${n(y0 - r)} l`,
      `${n(x0)} ${n(y0 - r + k)} ${n(x0 + r - k)} ${n(y0)} ${n(x0 + r)} ${n(y0)} c`, 'h'
    ].join('\n');
  }

  class Page {
    constructor() { this.ops = []; }
    paint(path, o) {
      const ops = ['q'];
      if (o.fill) ops.push(`${rgb(o.fill)} rg`);
      if (o.stroke) {
        ops.push(`${rgb(o.stroke)} RG`, `${n(o.lineWidth || 1)} w`);
        if (o.dash) ops.push(`[${o.dash.join(' ')}] 0 d`);
      }
      ops.push(path, o.fill && o.stroke ? 'B' : o.fill ? 'f' : o.stroke ? 'S' : 'n', 'Q');
      this.ops.push(ops.join('\n'));
    }
    rect(x, y, w, h, o = {}) { this.paint(o.radius ? roundRectPath(x, y, w, h, o.radius) : `${n(x)} ${n(Y(y + h))} ${n(w)} ${n(h)} re`, o); }
    circle(cx, cy, r, o = {}) { this.paint(roundRectPath(cx - r, cy - r, 2 * r, 2 * r, r), o); }
    line(x1, y1, x2, y2, o = {}) { this.paint(`${n(x1)} ${n(Y(y1))} m ${n(x2)} ${n(Y(y2))} l`, { stroke: COLOR.ink, ...o }); }
    text(s, x, y, o = {}) {
      s = clean(s); if (!s) return 0;
      const size = o.size || 10, bold = !!o.bold, w = textWidth(s, size, bold);
      const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      this.ops.push(`BT\n/${bold ? 'F2' : 'F1'} ${n(size)} Tf\n${rgb(o.color || COLOR.ink)} rg\n${n(px)} ${n(Y(y))} Td\n(${pdfString(s)}) Tj\nET`);
      return w;
    }
    image(name, x, y, w, h, radius) {
      this.ops.push(`q\n${radius ? roundRectPath(x, y, w, h, radius) + '\nW n\n' : ''}${n(w)} 0 0 ${n(h)} ${n(x)} ${n(Y(y + h))} cm\n/${name} Do\nQ`);
    }
  }

  const latin1 = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  const isJPEG = d => d && d.length > 4 && d[0] === 0xff && d[1] === 0xd8;

  /* Ensambla el archivo: catálogo, fuentes, imágenes JPEG, páginas y tabla de referencias cruzadas */
  function assemble(pages, images, meta) {
    const parts = [], offsets = [];
    let size = 0;
    const put = u8 => { parts.push(u8); size += u8.length; };
    const putStr = s => put(latin1(s));
    const FIRST_IMG = 6, firstPage = FIRST_IMG + images.length;
    const total = firstPage + pages.length * 2;          /* numero de objetos + 1 */

    putStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const begin = id => { offsets[id] = size; putStr(`${id} 0 obj\n`); };
    const end = () => putStr('endobj\n');
    const simple = (id, body) => { begin(id); putStr(body + '\n'); end(); };
    const stream = (id, dict, data) => {
      begin(id); putStr(`<< ${dict} /Length ${data.length} >>\nstream\n`); put(data); putStr('\nendstream\n'); end();
    };

    simple(1, '<< /Type /Catalog /Pages 2 0 R /Lang (es-MX) /ViewerPreferences << /DisplayDocTitle true >> >>');
    simple(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>`);
    simple(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    simple(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    simple(5, `<< /Title (${pdfString(meta.title)}) /Author (Trama Studio) /Creator (Trama Studio) /Producer (Trama Studio) /CreationDate (${meta.created}) >>`);

    images.forEach((im, i) => stream(FIRST_IMG + i,
      `/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, im.data));

    const xobjects = images.length ? ` /XObject << ${images.map((_, i) => `/Im${i + 1} ${FIRST_IMG + i} 0 R`).join(' ')} >>` : '';
    pages.forEach((p, i) => {
      const pageId = firstPage + i * 2, contentId = pageId + 1;
      simple(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Contents ${contentId} 0 R ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> >>`);
      stream(contentId, '', latin1(p.ops.join('\n')));
    });

    const xref = size;
    putStr(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let id = 1; id < total; id++) putStr(String(offsets[id]).padStart(10, '0') + ' 00000 n \n');
    putStr(`trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(size); let pos = 0;
    for (const u8 of parts) { out.set(u8, pos); pos += u8.length; }
    return out;
  }

  /* ---------- Contenido del ticket ---------- */
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const pad = v => String(v).padStart(2, '0');
  const money = v => '$' + String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /* order = {
       folio, date, testMode, contactEmail,
       customer: { firstName, lastName, email, phone, address, city, state, zip },
       items: [{ name, details: [texto], qty, price, image: { data: Uint8Array JPEG, width, height } }],
       totals: { subtotal, discount, promo, promoRate, shipping, total } } */
  function buildTicketPDF(order = {}) {
    const customer = order.customer || {}, items = Array.isArray(order.items) ? order.items : [], t = order.totals || {};
    const folio = clean(order.folio).trim() || 'SIN-FOLIO';
    const date = order.date ? new Date(order.date) : new Date(); const when = isNaN(date) ? new Date() : date;
    const dayText = `${when.getDate()} de ${MESES[when.getMonth()]} de ${when.getFullYear()}`, timeText = `${pad(when.getHours())}:${pad(when.getMinutes())} h`;

    const subtotal = Number(t.subtotal) || items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const discount = Number(t.discount) || 0, shipping = Number(t.shipping) || 0;
    const total = t.total != null ? Number(t.total) : Math.max(0, subtotal - discount + shipping);

    const pages = [], images = [];
    const imageName = im => {
      if (!im || !isJPEG(im.data) || !(im.width > 0) || !(im.height > 0)) return null;
      images.push(im); return 'Im' + images.length;
    };
    let page, y;

    const frame = p => {
      p.rect(0, 0, PAGE.w, PAGE.h, { fill: COLOR.paper });
      p.rect(CARD.x, CARD.y, CARD.w, CARD.h, { fill: COLOR.chalk, stroke: COLOR.ink, lineWidth: 1.5, dash: [5, 4], radius: 16 });
    };
    /* Línea punteada con muescas en los bordes, como un ticket que se arranca */
    const tear = yy => {
      page.circle(CARD.x, yy, 9, { fill: COLOR.paper });
      page.circle(CARD.x + CARD.w, yy, 9, { fill: COLOR.paper });
      page.line(CARD.x + 16, yy, CARD.x + CARD.w - 16, yy, { stroke: COLOR.ink, lineWidth: 1, dash: [4, 4] });
    };
    /* Título de sección con círculo numerado, igual que los pasos de "Personalizar" */
    const step = (num, label, x, yy) => {
      page.circle(x + 9, yy, 9, { fill: COLOR.ink });
      page.text(String(num), x + 9, yy + 3.3, { bold: true, size: 9.5, color: COLOR.sun, align: 'center' });
      page.text(label, x + 26, yy + 4.6, { bold: true, size: 13 });
    };

    const startPage = first => {
      page = new Page(); pages.push(page); frame(page);
      if (first) {
        page.text('Trama Studio', L, 80, { bold: true, size: 28 });
        page.text('Playeras en stock y hechas a tu diseño.', L, 96, { size: 9.5, color: COLOR.muted });
        page.rect(R - 124, 54, 124, 24, { fill: COLOR.cobalt, radius: 12 });
        page.text('TICKET DE COMPRA', R - 62, 70.2, { bold: true, size: 9, color: COLOR.chalk, align: 'center' });

        page.rect(L, 110, R - L, 60, { fill: COLOR.soft, radius: 12 });
        page.text('FOLIO', L + 16, 128, { bold: true, size: 8, color: COLOR.muted });
        page.text(folio, L + 16, 157, { bold: true, size: 24 });
        page.text('FECHA', L + 196, 128, { bold: true, size: 8, color: COLOR.muted });
        page.text(dayText, L + 196, 146, { bold: true, size: 10.5 });
        page.text(timeText, L + 196, 160, { size: 9.5, color: COLOR.muted });
        page.text('ESTADO', R - 62, 128, { bold: true, size: 8, color: COLOR.muted, align: 'center' });
        page.rect(R - 100, 134, 76, 24, { fill: COLOR.sun, radius: 12 });
        page.text('PAGADO', R - 62, 150.2, { bold: true, size: 10, align: 'center' });
        tear(186);
        y = 212;
      } else {
        page.text('Trama Studio', L, 80, { bold: true, size: 18 });
        page.text(`Ticket ${folio} (continuación)`, R, 79, { size: 9.5, color: COLOR.muted, align: 'right' });
        page.line(L, 96, R, 96, { stroke: COLOR.line, lineWidth: 1, dash: [3, 3] });
        y = 122;
      }
    };
    const ensure = (h, redraw) => { if (y + h > LIMIT) { startPage(false); if (redraw) redraw(); } };

    startPage(true);

    /* 1 y 2: contacto y envío */
    const colW = 226, x2 = L + 252;
    step(1, 'Contacto', L, y); step(2, 'Dirección de envío', x2, y);
    const name = `${clean(customer.firstName)} ${clean(customer.lastName)}`.trim();
    const left = [];
    wrapText(name || 'Cliente', colW, 11, true).forEach(l => left.push([l, true, COLOR.ink]));
    wrapText(customer.email, colW, 10, false).forEach(l => left.push([l, false, COLOR.ink]));
    if (customer.phone) left.push([`Tel. ${clean(customer.phone)}`, false, COLOR.muted]);
    const right = [];
    wrapText(customer.address, colW, 10, false).forEach(l => right.push([l, false, COLOR.ink]));
    const cityLine = [customer.city, customer.state].map(clean).filter(Boolean).join(', ');
    if (cityLine) wrapText(cityLine, colW, 10, false).forEach(l => right.push([l, false, COLOR.ink]));
    if (customer.zip) right.push([`C.P. ${clean(customer.zip)}`, false, COLOR.muted]);
    left.forEach(([s, b, c], i) => page.text(s, L, y + 28 + i * 13.5, { size: b ? 11 : 10, bold: b, color: c }));
    right.forEach(([s, b, c], i) => page.text(s, x2, y + 28 + i * 13.5, { size: 10, bold: b, color: c }));
    y += 20 + Math.max(left.length, right.length) * 13.5 + 16;

    /* 3: tu pedido */
    const COL = { thumb: L + 8, desc: L + 72, descW: 256, qty: R - 134, price: R - 86, amount: R - 8 };
    const tableHeader = () => {
      page.rect(L, y, R - L, 22, { fill: COLOR.ink, radius: 11 });
      const o = { bold: true, size: 8, color: COLOR.chalk };
      page.text('PRENDA', COL.thumb + 4, y + 14.5, o);
      page.text('CANT.', COL.qty, y + 14.5, { ...o, align: 'center' });
      page.text('PRECIO', COL.price, y + 14.5, { ...o, align: 'right' });
      page.text('IMPORTE', COL.amount, y + 14.5, { ...o, align: 'right' });
      y += 28;
    };
    ensure(24 + 28 + 56);
    step(3, 'Tu pedido', L, y + 4); y += 24;
    tableHeader();

    const THUMB_W = 52, THUMB_H = 43;
    if (!items.length) { page.text('Sin prendas registradas.', L + 8, y + 12, { size: 10, color: COLOR.muted }); y += 28; }
    items.forEach(it => {
      const nameLines = wrapText(it.name || 'Prenda', COL.descW, 10.5, true);
      const detail = [];
      (Array.isArray(it.details) ? it.details : []).forEach(d => wrapText(d, COL.descW, 9, false).forEach(l => detail.push(l)));
      const shown = detail.slice(0, 7), textH = nameLines.length * 13 + shown.length * 11.5;
      const rowH = Math.max(THUMB_H + 14, textH + 14);
      ensure(rowH, tableHeader);

      page.rect(COL.thumb, y + 7, THUMB_W, THUMB_H, { fill: COLOR.thumb, radius: 7 });
      const img = imageName(it.image);
      if (img) page.image(img, COL.thumb, y + 7, THUMB_W, THUMB_H, 7);

      let ty = y + 7 + 10;
      nameLines.forEach(l => { page.text(l, COL.desc, ty, { bold: true, size: 10.5 }); ty += 13; });
      shown.forEach(l => { page.text(l, COL.desc, ty, { size: 9, color: COLOR.muted }); ty += 11.5; });

      const qty = Number(it.qty) || 0, price = Number(it.price) || 0, first = y + 7 + 10;
      page.text(String(qty), COL.qty, first, { size: 10.5, align: 'center' });
      page.text(money(price), COL.price, first, { size: 10.5, align: 'right' });
      page.text(money(price * qty), COL.amount, first, { size: 10.5, bold: true, align: 'right' });

      page.line(L, y + rowH, R, y + rowH, { stroke: COLOR.line, lineWidth: 0.75, dash: [3, 3] });
      y += rowH;
    });

    /* Totales (derecha) y pago (izquierda) */
    const rows = [['Subtotal', money(subtotal), COLOR.ink]];
    if (discount > 0) {
      const rate = Number(t.promoRate) > 0 ? ` (-${Math.round(t.promoRate * 100)}%)` : '';
      rows.push([`Código ${clean(t.promo)}${rate}`, '-' + money(discount), COLOR.cobalt]);
    }
    rows.push(['Envío', shipping > 0 ? money(shipping) : 'Gratis', COLOR.ink]);
    const payLines = ['Método: Tarjeta (Stripe) en MXN', 'Estado: Pagado'];
    const note = order.testMode ? wrapText('Pago de prueba: no se realizó ningún cargo real.', 250, 8.5, false) : [];
    const payH = 32 + payLines.length * 13.5 + (note.length ? 6 + note.length * 11 : 0);
    const totalsH = 8 + rows.length * 17 + 36;
    const thanks = `Guarda tu folio ${folio} para cualquier aclaración.` +
      (order.contactEmail ? ` Escríbenos a ${clean(order.contactEmail)}.` : '');
    const thanksLines = wrapText(thanks, R - L - 32, 9.5, false), closeH = 38 + thanksLines.length * 12;
    const zoneH = Math.max(payH, totalsH);
    ensure(14 + zoneH + 12 + closeH);        /* totales y cierre viajan juntos: nunca queda el cierre solo */

    y += 14;
    const bx = R - 232;
    step(4, 'Pago', L, y + 6);
    payLines.forEach((s, i) => page.text(s, L, y + 32 + i * 13.5, { size: 10 }));
    note.forEach((s, i) => page.text(s, L, y + 32 + payLines.length * 13.5 + 6 + i * 11, { size: 8.5, color: COLOR.muted }));

    rows.forEach(([label, value, color], i) => {
      page.text(label, bx, y + 10 + i * 17, { size: 10, color: color === COLOR.cobalt ? color : COLOR.muted });
      page.text(value, R, y + 10 + i * 17, { size: 10, bold: true, color, align: 'right' });
    });
    const barY = y + 8 + rows.length * 17;
    page.rect(bx, barY, 232, 36, { fill: COLOR.cobalt, radius: 12 });
    page.text('TOTAL', bx + 16, barY + 22.5, { bold: true, size: 10, color: COLOR.chalk });
    page.text(`${money(total)} MXN`, R - 16, barY + 23.5, { bold: true, size: 16, color: COLOR.chalk, align: 'right' });
    y += zoneH + 12;

    /* Cierre */
    page.rect(L, y, R - L, closeH, { fill: COLOR.soft, radius: 12 });
    page.text('¡Gracias por tu compra!', L + 16, y + 23, { bold: true, size: 13 });
    thanksLines.forEach((s, i) => page.text(s, L + 16, y + 39 + i * 12, { size: 9.5, color: COLOR.muted }));
    y += closeH;

    /* Pie de cada página */
    pages.forEach((p, i) => {
      p.text('Comprobante de compra. No es una factura fiscal.', L, CARD.y + CARD.h - 22, { size: 8, color: COLOR.muted });
      p.text(`Página ${i + 1} de ${pages.length}`, R, CARD.y + CARD.h - 22, { size: 8, color: COLOR.muted, align: 'right' });
    });

    const created = `D:${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
    return assemble(pages, images, { title: `Ticket de compra ${folio} - Trama Studio`, created });
  }

  const api = { buildTicketPDF, textWidth, wrapText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.buildTicketPDF = buildTicketPDF;
})(typeof self !== 'undefined' ? self : globalThis);
