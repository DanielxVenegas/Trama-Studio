/* Vista 3D de la playera (Three.js): luz de estudio, tela con relieve, gancho metálico y diseño curvado.
   createShirtViewer(stage) devuelve null si no hay WebGL o si Three.js no cargó; en ese caso
   la página usa la vista previa plana (SVG) como respaldo. */
function createShirtViewer(stage) {
  if (typeof THREE === 'undefined' || typeof shirtModel !== 'function') return null;

  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const st = { cut: null, color: null, side: 'front' };

  let renderer, scene, cam, group, fabric;
  try {
    /* Render, tono cinematográfico y luz de estudio */
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(30, 1, .1, 50); cam.position.set(0, .1, 6);
    const env = new THREE.Scene(); env.background = new THREE.Color(.22, .24, .3);
    [[0, 6, 2, 8, 4, 6], [-6, 1, 3, 3, 5, 3.5], [6, 2, -2, 3, 5, 2.5], [0, 1, 7, 5, 4, 1.6]].forEach(([x, y, z, w, h, i]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i * 1.05), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    });
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env, .03).texture;
    const key = new THREE.DirectionalLight(0xffffff, .55); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe7ff, .35); rim.position.set(-3, 3, -4); scene.add(rim);
    group = new THREE.Group(); scene.add(group);

    /* Relieve de tela */
    fabric = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) { const v = (90 + Math.random() * 90) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1); }
      for (let i = 0; i < 256; i += 2) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(i, 0, 1, 256); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, i, 256, 1); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 8); return t;
    })();
  } catch (e) {
    if (renderer) renderer.dispose();
    return null;
  }
  stage.prepend(renderer.domElement);

  let shirt, hanger, dmesh, tex, model;

  const rod = (a, b, r, m) => {
    const d = new THREE.Vector3().subVectors(b, a), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 14), m);
    o.position.copy(a).addScaledVector(d, .5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return o;
  };
  const tube = (pts, r, m) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), true), pts.length * 3, r, 10, true), m);
  const sheet = d => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setIndex(d.idx); g.computeVertexNormals(); return g;
  };

  function build() {
    [shirt, hanger].forEach(o => { if (o) { group.remove(o); o.traverse(m => m.geometry && m.geometry.dispose()); } });
    if (dmesh) dmesh.material.dispose();
    dmesh = null;
    model = shirtModel(CUTS[st.cut]);
    const col = new THREE.Color(st.color).convertSRGBToLinear();
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: .9, bumpMap: fabric, bumpScale: .6, side: THREE.DoubleSide, envMapIntensity: .8 });
    const trim = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(.86), roughness: 1, bumpMap: fabric, bumpScale: .8, envMapIntensity: .6 });
    shirt = new THREE.Group();
    shirt.add(new THREE.Mesh(sheet(model.front), mat), new THREE.Mesh(sheet(model.back), mat));
    shirt.add(tube(model.collar, .028, trim), tube(model.hemLoop, .018, trim));
    model.cuffs.forEach(c => shirt.add(tube(c, .02, trim)));
    shirt.position.y = -(1 + model.hem) / 2; group.add(shirt);

    /* Gancho metálico */
    const top = (1 - model.hem) / 2, metal = new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: .95, roughness: .28 });
    hanger = new THREE.Group();
    hanger.add(rod(new THREE.Vector3(0, top - .02, 0), new THREE.Vector3(0, top + .1, 0), .011, metal));
    const hook = new THREE.Mesh(new THREE.TorusGeometry(.05, .011, 10, 28, Math.PI * 1.5), metal); hook.rotation.z = Math.PI * 1.5; hook.position.set(0, top + .15, 0); hanger.add(hook);
    [-1, 1].forEach(k => hanger.add(rod(new THREE.Vector3(0, top - .02, 0), new THREE.Vector3(k * (model.sx - .03), top - .09, 0), .012, metal)));
    group.add(hanger);
    decal();
  }

  /* Diseño pegado a la tela del pecho o la espalda */
  function decal() {
    if (dmesh) { shirt.remove(dmesh); dmesh.geometry.dispose(); dmesh.material.dispose(); dmesh = null; }
    if (!tex) return;
    const back = st.side === 'back', ar = tex.image.height / tex.image.width, top = .78, hem = model.hem;
    let ww = .7, hh = ww * ar; const maxH = Math.min(top - (hem + .12), .9);
    if (hh > maxH) { hh = maxH; ww = hh / ar; }
    const g = new THREE.PlaneGeometry(ww, hh, 40, 40), p = g.attributes.position, yc = top - hh / 2;
    for (let n = 0; n < p.count; n++) {
      const x = p.getX(n), y = yc + p.getY(n), X = back ? -x : x;
      p.setXYZ(n, X, y, (back ? -1 : 1) * (model.height(X, y) + .008));
    }
    g.computeVertexNormals();
    dmesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: .85, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shirt.add(dmesh);
  }

  function setTexture(t) {
    const old = tex; tex = t; decal();
    if (old && old !== t) old.dispose();
  }

  /* Combina el arte (archivo o estampado) y el texto en una sola imagen para la calcomanía.
     Si llegan dos cambios seguidos solo se aplica el último. */
  let seq = 0;
  function setPrint(opts) {
    const n = ++seq;
    return composePrint(opts).then(src => new Promise((ok, fail) => {
      if (n !== seq) return ok();
      if (!src) { setTexture(null); return ok(); }
      new THREE.TextureLoader().load(src, t => {
        if (n !== seq) { t.dispose(); return ok(); }
        t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; setTexture(t); ok();
      }, undefined, () => fail('No se pudo generar el diseño.'));
    }));
  }

  /* Cámara: arrastrar, zoom con Ctrl + rueda (la rueda sola desplaza la página), vistas y giro suave */
  let drag = false, lx = 0, ly = 0, idle = 0, target = null, spin = false, baseZ = 6;
  const turnTo = t => { const c = group.rotation.y; target = Math.round((c - t) / (2 * Math.PI)) * 2 * Math.PI + t; };
  stage.addEventListener('pointerdown', e => { drag = true; target = null; lx = e.clientX; ly = e.clientY; stage.setPointerCapture(e.pointerId); });
  const endDrag = () => { drag = false; idle = performance.now(); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    group.rotation.y += (e.clientX - lx) * .01; group.rotation.x = cl(group.rotation.x + (e.clientY - ly) * .006, -.5, .5); lx = e.clientX; ly = e.clientY;
  });
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); baseZ = cl(baseZ + e.deltaY * .004, 3.2, 9); cam.position.z = baseZ;
  }, { passive: false });
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    baseZ = w / h < .9 ? 6 / (w / h) * .8 : 6; cam.position.z = baseZ; cam.updateProjectionMatrix();
  }).observe(stage);
  (function loop() {
    if (target !== null) { const d = target - group.rotation.y; group.rotation.y += d * .12; group.rotation.x *= .9; if (Math.abs(d) < .003) target = null; }
    else if (!drag && spin && !still && performance.now() - idle > 2500) group.rotation.y += .005;
    group.position.y = Math.sin(performance.now() / 1400) * (still ? 0 : .015);
    renderer.render(scene, cam); requestAnimationFrame(loop);
  })();

  return {
    /* Reconstruye la prenda solo si cambió el corte o el color */
    setModel(cut, color) {
      if (shirt && cut === st.cut && color === st.color) return;
      st.cut = cut; st.color = color; build();
    },
    setPrint,
    /* Lado donde va el diseño; la prenda gira para mostrarlo */
    setSide(side) {
      if (side === st.side) return;
      st.side = side; decal(); turnTo(side === 'back' ? Math.PI : 0);
    },
    setBackground(name) { stage.dataset.bg = name; },
    setSpin(on) { spin = !!on; },
    turnTo,
    capture() { renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); }
  };
}
