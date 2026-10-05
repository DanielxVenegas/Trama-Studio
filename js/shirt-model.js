/* Modelo de playera: silueta real inflada. Dos paneles (frente y espalda) unidos por costuras;
   cuello, dobladillo y puños quedan abiertos. No depende de three.js. */
function shirtModel(c) {
  const { w, L, s } = c, sx = w + .04, ex = sx + s * 1.1, bx = ex - .17, hem = 1 - L, R = .28, HM = .17, dx = .03;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const half = [[.28, 1], [sx, .92], [ex, .60], [bx, .36], [w, .42], [w, hem]], seam = [1, 1, 0, 1, 1];
  const E = [], add = (a, b, sm) => E.push({ a, b, sm }), Lf = half.map(p => [-p[0], p[1]]);
  for (let i = 0; i < 5; i++) add(Lf[i], Lf[i + 1], seam[i]);
  add(Lf[5], half[5], 0);
  for (let i = 5; i > 0; i--) add(half[i], half[i - 1], seam[i - 1]);
  const nk = []; for (let i = 0; i <= 8; i++) { const x = .28 - .56 * i / 8; nk.push([x, 1 - .09 * (1 - (x / .28) ** 2)]); }
  for (let i = 0; i < 8; i++) add(nk[i], nk[i + 1], 0);
  const poly = E.map(e => e.a);

  const proj = (x, y, a, b) => { const ux = b[0] - a[0], uy = b[1] - a[1], t = cl(((x - a[0]) * ux + (y - a[1]) * uy) / (ux * ux + uy * uy), 0, 1); return [a[0] + t * ux, a[1] + t * uy]; };
  const near = (x, y, onlySeam) => {
    let best = 1e9, bp = null;
    for (const e of E) { if (onlySeam && !e.sm) continue; const p = proj(x, y, e.a, e.b), d = Math.hypot(x - p[0], y - p[1]); if (d < best) { best = d; bp = p; } }
    return [best, bp];
  };
  const inside = (x, y) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) r = !r;
    }
    return r;
  };
  /* Grosor de la tela: cero en las costuras, redondeado hacia el centro, con pliegues suaves */
  const height = (x, y) => {
    const t = Math.min(near(x, y, true)[0] / R, 1);
    return HM * Math.sqrt(1 - (1 - t) * (1 - t)) + .007 * Math.sin(y * 10 + x * 4) * t * (y < .6 ? 1 : .3);
  };

  const x0 = -ex - dx, y0 = hem - dx, nx = Math.ceil(2 * (ex + dx) / dx), ny = Math.ceil((1 - hem + 2 * dx) / dx);
  const V = [], ok = [];
  for (let i = 0; i <= ny; i++) for (let j = 0; j <= nx; j++) {
    const x = x0 + j * dx, y = y0 + i * dx, ins = inside(x, y);
    V.push(ins ? [x, y] : near(x, y, false)[1]); ok.push(ins);
  }
  const map = new Int32Array(V.length).fill(-1), front = { pos: [], uv: [], idx: [] }, back = { pos: [], uv: [], idx: [] };
  const use = k => {
    if (map[k] < 0) {
      map[k] = front.pos.length / 3; const [x, y] = V[k], h = height(x, y), u = x / 2.6 + .5, v = y / 2 + .5;
      front.pos.push(x, y, h); back.pos.push(x, y, -h); front.uv.push(u, v); back.uv.push(u, v);
    }
    return map[k];
  };
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const a = i * (nx + 1) + j, b = a + 1, c = a + nx + 1, d = c + 1;
    if (ok[a] + ok[b] + ok[c] + ok[d] < 2) continue;
    const A = use(a), B = use(b), C = use(c), D = use(d);
    front.idx.push(A, B, C, B, D, C); back.idx.push(A, C, B, B, C, D);
  }

  /* Orillas (cuello, dobladillo, puños) como lazos cerrados: frente y espalda */
  const loop = pts => {
    const f = pts.map(p => [p[0], p[1], height(p[0], p[1])]), bk = pts.slice(1, -1).reverse().map(p => [p[0], p[1], -height(p[0], p[1])]);
    return f.concat(bk);
  };
  const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return { front, back, height, hem, sx, collar: loop(nk), hemLoop: loop(line([-w, hem], [w, hem], 28)),
    cuffs: [loop(line([-ex, .60], [-bx, .36], 8)), loop(line([ex, .60], [bx, .36], 8))] };
}
if (typeof module !== 'undefined') module.exports = { shirtModel };
