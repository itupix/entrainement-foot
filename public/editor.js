// public/editor.js
(function () {
  // --- RÉFÉRENCES DOM ---
  const modal = document.getElementById("editor-modal");
  const svg = document.getElementById("editor-stage");
  const layer = document.getElementById("editor-layer");
  if (!modal || !svg || !layer) return;

  // Toolbar
  const toolButtons = Array.from(document.querySelectorAll('#editor-modal .tools button'));

  // Exercice (nom/desc) + save
  const exName = document.getElementById("ex-name");
  const exDesc = document.getElementById("ex-desc");
  const kindSel = document.getElementById("ex-kind");
  const btnSaveEx = document.getElementById("btn-save-ex");

  // Grille / snap
  const snapToggle = document.getElementById("snap-toggle");
  const gridSizeInp = document.getElementById("grid-size");

  // Panneau propriétés
  const propType = document.getElementById("prop-type");
  const propX = document.getElementById("prop-x");
  const propY = document.getElementById("prop-y");
  const propRot = document.getElementById("prop-rot");
  const propSize = document.getElementById("prop-size");
  const propColor = document.getElementById("prop-color");
  const propTextWrap = document.getElementById("prop-text-wrap");
  const propText = document.getElementById("prop-text");

  // Actions
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnClear = document.getElementById("btn-clear");
  const btnDelSel = document.getElementById("btn-delete-selected");

  // --- ÉTAT ---
  const state = {
    tool: "select",
    selectionId: null,
    draggingId: null,
    dragStart: null,
    dragOffset: { x: 0, y: 0 },
    drawingArrow: null,
    resizingArrow: null, // { id, end: "start"|"end" }
    // Nouveaux états de transform générique
    transform: null,     // { id, mode: "rotate"|"resize", cx, cy, handle?, start, startRot?, startGeom? }
    history: [],
    future: [],
    snap: true,
    grid: 25
  };

  let model = { width: 1000, height: 600, name: "", description: "", items: [] };
  let currentEdit = { kind: null, id: null }; // "jeux" | "entr" | "mob"

  // --- UTILS ---
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);
  const nz = (v, d) => (v == null ? d : v);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const snapFn = (v) => state.snap ? Math.round(v / state.grid) * state.grid : v;
  const nsvg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);

  const getMouse = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: clamp(x, 0, model.width), y: clamp(y, 0, model.height) };
  };
  const pushHistory = () => { state.history.push(JSON.stringify(model)); if (state.history.length > 100) state.history.shift(); state.future = []; };

  const itemById = (id) => model.items.find(i => i.id === id);
  function applyTransform(el, item, centerOverride) {
    const rot = nz(item.rot, 0); if (!rot) return;
    const cx = centerOverride?.cx ?? (item.x ?? (item.x1 + item.x2) / 2);
    const cy = centerOverride?.cy ?? (item.y ?? (item.y1 + item.y2) / 2);
    el.setAttribute("transform", `rotate(${rot} ${cx} ${cy})`);
  }

  function angle(cx, cy, px, py) { return Math.atan2(py - cy, px - cx); }
  function dist2(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; }

  function getTargetId(evt) {
    if (typeof evt.composedPath === "function") {
      for (const n of evt.composedPath()) {
        if (n && n.dataset && n.dataset.id) return n.dataset.id;
        if (n === svg) break;
      }
    }
    let n = evt.target;
    while (n && n !== svg) {
      if (n.dataset && n.dataset.id) return n.dataset.id;
      n = n.parentNode;
    }
    const el = document.elementFromPoint(evt.clientX, evt.clientY);
    n = el;
    while (n && n !== svg) {
      if (n.dataset && n.dataset.id) return n.dataset.id;
      n = n.parentNode;
    }
    return null;
  }
  function isTypingInField() {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  }

  // --- VISUELS (existants + nouveaux) ---
  function makeConeGroup(item) {
    const g = nsvg("g");
    const color = item.color || "#ef4444";
    const R = nz(item.r, 12);
    const cx = item.x, cy = item.y;
    const h = R * 1.8;
    const yTop = cy - R - h * 0.6;
    const yBase = cy - R * 0.2;

    const body = nsvg("path");
    const d = `M ${cx} ${yTop} L ${cx - R * 0.9} ${yBase} Q ${cx} ${yBase + R * 0.2} ${cx + R * 0.9} ${yBase} Z`;
    body.setAttribute("d", d);
    body.setAttribute("fill", color);
    body.setAttribute("stroke", "#222");
    body.setAttribute("stroke-width", "0.5");
    g.appendChild(body);

    const shine = nsvg("path");
    const sd = `M ${cx - R * 0.15} ${yTop + h * 0.25} L ${cx - R * 0.35} ${yBase - R * 0.25} Q ${cx - R * 0.15} ${yBase - R * 0.15} ${cx - R * 0.05} ${yTop + h * 0.3} Z`;
    shine.setAttribute("d", sd);
    shine.setAttribute("fill", "#ffffff22");
    g.appendChild(shine);

    const base = nsvg("ellipse");
    base.setAttribute("cx", cx);
    base.setAttribute("cy", cy);
    base.setAttribute("rx", R);
    base.setAttribute("ry", R * 0.35);
    base.setAttribute("fill", color);
    base.setAttribute("stroke", "#222");
    base.setAttribute("stroke-width", "0.5");
    g.appendChild(base);
    return g;
  }

  function makePlayerGroup(item) {
    const g = nsvg("g");
    const c = item.color || "#2563eb";
    const cx = item.x, cy = item.y;
    const R = nz(item.r, 14);
    const w = R * 2.2, h = R * 2.2;
    const x0 = cx - w / 2, y0 = cy - h / 2 + 6;

    const torso = nsvg("path");
    const d = `M ${x0} ${y0 + h * 0.35} Q ${cx} ${y0} ${x0 + w} ${y0 + h * 0.35} L ${x0 + w} ${y0 + h * 0.85} Q ${cx} ${y0 + h} ${x0} ${y0 + h * 0.85} Z`;
    torso.setAttribute("d", d);
    torso.setAttribute("fill", c);
    torso.setAttribute("stroke", "#1f2937");
    torso.setAttribute("stroke-width", "0.8");
    g.appendChild(torso);

    const sleeveL = nsvg("rect");
    sleeveL.setAttribute("x", x0 - R * 0.35);
    sleeveL.setAttribute("y", y0 + h * 0.38);
    sleeveL.setAttribute("width", R * 0.6);
    sleeveL.setAttribute("height", R * 0.7);
    sleeveL.setAttribute("fill", c);
    sleeveL.setAttribute("stroke", "#1f2937");
    sleeveL.setAttribute("stroke-width", "0.6");
    g.appendChild(sleeveL);

    const sleeveR = nsvg("rect");
    sleeveR.setAttribute("x", x0 + w - R * 0.25);
    sleeveR.setAttribute("y", y0 + h * 0.38);
    sleeveR.setAttribute("width", R * 0.6);
    sleeveR.setAttribute("height", R * 0.7);
    sleeveR.setAttribute("fill", c);
    sleeveR.setAttribute("stroke", "#1f2937");
    sleeveR.setAttribute("stroke-width", "0.6");
    g.appendChild(sleeveR);

    const head = nsvg("circle");
    head.setAttribute("cx", cx);
    head.setAttribute("cy", y0);
    head.setAttribute("r", R * 0.6);
    head.setAttribute("fill", "#fde68a");
    head.setAttribute("stroke", "#1f2937");
    head.setAttribute("stroke-width", "0.8");
    g.appendChild(head);
    return g;
  }

  // Ballon
  function makeBallGroup(item) {
    const g = nsvg("g");
    const R = nz(item.r, 10);
    const c = item.color || "#111827";
    const circle = nsvg("circle");
    circle.setAttribute("cx", item.x); circle.setAttribute("cy", item.y);
    circle.setAttribute("r", R);
    circle.setAttribute("fill", "#fff"); circle.setAttribute("stroke", "#1f2937"); circle.setAttribute("stroke-width", "1");
    g.appendChild(circle);
    const seam = (x1, y1, x2, y2) => { const l = nsvg("line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); l.setAttribute("stroke", c); l.setAttribute("stroke-width", "1"); g.appendChild(l); };
    seam(item.x - R * 0.6, item.y, item.x + R * 0.6, item.y);
    seam(item.x, item.y - R * 0.6, item.x, item.y + R * 0.6);
    seam(item.x - R * 0.42, item.y - R * 0.42, item.x + R * 0.42, item.y + R * 0.42);
    seam(item.x - R * 0.42, item.y + R * 0.42, item.x + R * 0.42, item.y - R * 0.42);
    return g;
  }

  // BUT : forme en U + filets
  function makeGoalGroup(item) {
    const g = nsvg("g");
    const w = nz(item.w, 100), h = nz(item.h, 56);
    const x = item.x - w / 2, y = item.y - h / 2;
    const c = item.color || "#6b7280";

    // Montants + barre transversale (pas de barre du bas)
    const postL = nsvg("rect");
    postL.setAttribute("x", x); postL.setAttribute("y", y);
    postL.setAttribute("width", 6); postL.setAttribute("height", h);
    postL.setAttribute("fill", c);
    g.appendChild(postL);

    const postR = nsvg("rect");
    postR.setAttribute("x", x + w - 6); postR.setAttribute("y", y);
    postR.setAttribute("width", 6); postR.setAttribute("height", h);
    postR.setAttribute("fill", c);
    g.appendChild(postR);

    const bar = nsvg("rect");
    bar.setAttribute("x", x); bar.setAttribute("y", y);
    bar.setAttribute("width", w); bar.setAttribute("height", 6);
    bar.setAttribute("fill", c);
    g.appendChild(bar);

    // Filets : hachures diagonales + verticales fines à l'intérieur
    const nets = nsvg("g");
    const pad = 6; // marge depuis les montants/barre
    const nx = 8, ny = 6; // densité
    for (let i = 0; i <= nx; i++) {
      const lx = x + pad + (w - 2 * pad) * (i / nx);
      const l = nsvg("line");
      l.setAttribute("x1", lx); l.setAttribute("y1", y + pad);
      l.setAttribute("x2", lx); l.setAttribute("y2", y + h);
      l.setAttribute("stroke", "#cbd5e1"); l.setAttribute("stroke-width", 0.7);
      nets.appendChild(l);
    }
    for (let j = 0; j <= ny; j++) {
      const ly = y + pad + (h - pad) * (j / ny);
      const l = nsvg("line");
      l.setAttribute("x1", x + pad); l.setAttribute("y1", ly);
      l.setAttribute("x2", x + w - pad); l.setAttribute("y2", ly);
      l.setAttribute("stroke", "#cbd5e1"); l.setAttribute("stroke-width", 0.7);
      nets.appendChild(l);
    }
    // Légère diagonale pour l'effet
    for (let d = 0; d < ny; d++) {
      const l = nsvg("line");
      l.setAttribute("x1", x + pad); l.setAttribute("y1", y + pad + d * ((h - pad) / ny));
      l.setAttribute("x2", x + pad + d * ((w - 2 * pad) / ny)); l.setAttribute("y2", y + h);
      l.setAttribute("stroke", "#e5e7eb"); l.setAttribute("stroke-width", 0.6);
      nets.appendChild(l);
    }
    nets.setAttribute("opacity", "0.9");
    g.appendChild(nets);

    return g;
  }

  // Haie
  function makeHurdleGroup(item) {
    const g = nsvg("g");
    const w = nz(item.w, 50), h = nz(item.h, 14);
    const c = item.color || "#e11d48";
    const x = item.x - w / 2, y = item.y - h / 2;

    const bar = nsvg("rect");
    bar.setAttribute("x", x); bar.setAttribute("y", y);
    bar.setAttribute("width", w); bar.setAttribute("height", h / 3);
    bar.setAttribute("fill", c);
    g.appendChild(bar);

    const legL = nsvg("rect");
    legL.setAttribute("x", x); legL.setAttribute("y", y + h / 3);
    legL.setAttribute("width", h / 7); legL.setAttribute("height", h * 0.7);
    legL.setAttribute("fill", "#4b5563");
    g.appendChild(legL);

    const legR = nsvg("rect");
    legR.setAttribute("x", x + w - h / 7); legR.setAttribute("y", y + h / 3);
    legR.setAttribute("width", h / 7); legR.setAttribute("height", h * 0.7);
    legR.setAttribute("fill", "#4b5563");
    g.appendChild(legR);

    return g;
  }

  // Coupelle
  function makeDiscGroup(item) {
    const g = nsvg("g");
    const R = nz(item.r, 10);
    const cx = item.x, cy = item.y;
    const c = item.color || "#f59e0b";

    const disc = nsvg("ellipse");
    disc.setAttribute("cx", cx);
    disc.setAttribute("cy", cy);
    disc.setAttribute("rx", R);
    disc.setAttribute("ry", R * 0.35);
    disc.setAttribute("fill", c);
    disc.setAttribute("stroke", "#92400e");
    disc.setAttribute("stroke-width", "0.5");
    g.appendChild(disc);
    return g;
  }

  // Rectangle générique
  function makeRectGroup(item) {
    const g = nsvg("g");
    const w = nz(item.w, 60), h = nz(item.h, Math.round(w * 2 / 3));
    const x = item.x - w / 2, y = item.y - h / 2;
    const c = item.color || "#6366f1";

    const r = nsvg("rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", w); r.setAttribute("height", h);
    r.setAttribute("fill", c); r.setAttribute("opacity", "0.8");
    r.setAttribute("stroke", "#111827"); r.setAttribute("stroke-width", "1");
    g.appendChild(r);
    return g;
  }

  // Rond (cercle plein)
  function makeCircleGroup(item) {
    const g = nsvg("g");
    const R = nz(item.r, 16);
    const c = item.color || "#22c55e";
    const circle = nsvg("circle");
    circle.setAttribute("cx", item.x); circle.setAttribute("cy", item.y);
    circle.setAttribute("r", R);
    circle.setAttribute("fill", c); circle.setAttribute("opacity", "0.9");
    circle.setAttribute("stroke", "#0f172a"); circle.setAttribute("stroke-width", "1");
    g.appendChild(circle);
    return g;
  }

  // Triangle équilatéral (taille = côté)
  function makeTriangleGroup(item) {
    const g = nsvg("g");
    const a = nz(item.a, 40);
    const c = item.color || "#06b6d4";
    const h = a * Math.sqrt(3) / 2;
    const cx = item.x, cy = item.y;
    const p1 = [cx, cy - h / 2];
    const p2 = [cx - a / 2, cy + h / 2];
    const p3 = [cx + a / 2, cy + h / 2];

    const path = nsvg("path");
    path.setAttribute("d", `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]} Z`);
    path.setAttribute("fill", c); path.setAttribute("opacity", "0.85");
    path.setAttribute("stroke", "#0f172a"); path.setAttribute("stroke-width", "1");
    g.appendChild(path);
    return g;
  }

  // Croix en X (par défaut rot=45°)
  function makeCrossGroup(item) {
    const g = nsvg("g");
    const s = nz(item.s, 14); // demi-bras
    const c = item.color || "#ef4444";
    const cx = item.x, cy = item.y;

    const h1 = nsvg("rect");
    h1.setAttribute("x", cx - s); h1.setAttribute("y", cy - 3);
    h1.setAttribute("width", s * 2); h1.setAttribute("height", 6);
    h1.setAttribute("fill", c); g.appendChild(h1);

    const v1 = nsvg("rect");
    v1.setAttribute("x", cx - 3); v1.setAttribute("y", cy - s);
    v1.setAttribute("width", 6); v1.setAttribute("height", s * 2);
    v1.setAttribute("fill", c); g.appendChild(v1);

    // on force visuellement l'X en rotation 45° par défaut si rot non défini
    if (item.rot == null) item.rot = 45;
    return g;
  }

  // --- DESSIN & SÉLECTION ---
  function drawSelectedOverlay(item) {
    // bounding box simple par type (non-rotée) + transform de rotation appliquée au groupe
    let cx = item.x ?? (item.x1 + item.x2) / 2;
    let cy = item.y ?? (item.y1 + item.y2) / 2;
    let w = 0, h = 0;

    if (item.type === "rect") { w = nz(item.w, 60); h = nz(item.h, Math.round(w * 2 / 3)); }
    else if (item.type === "rond") { const r = nz(item.r, 16); w = h = r * 2; }
    else if (item.type === "triangle") { const a = nz(item.a, 40); w = a; h = a * Math.sqrt(3) / 2; }
    else if (item.type === "croix") { const s = nz(item.s, 14); w = h = s * 2; }
    else if (item.type === "plot") { const r = nz(item.r, 12); w = r * 2; h = r * 2; }
    else if (item.type === "joueur") { const r = nz(item.r, 14); w = r * 2.2; h = r * 2.6; }
    else if (item.type === "ballon") { const r = nz(item.r, 10); w = h = r * 2; }
    else if (item.type === "coupelle") { const r = nz(item.r, 10); w = r * 2; h = r * 0.7; }
    else if (item.type === "haie") { w = nz(item.w, 50); h = nz(item.h, 14); }
    else if (item.type === "but") { w = nz(item.w, 100); h = nz(item.h, 56); }
    else if (item.type === "cerceau") { const r = nz(item.r, 18); w = h = r * 2; }
    else if (item.type === "echelle") { w = nz(item.w, 120); h = nz(item.h, 40); }
    else if (item.type === "fleche") {
      // pour la flèche on ne met que halo simple (poignées déjà gérées)
      const halos = nsvg("circle");
      halos.setAttribute("cx", cx); halos.setAttribute("cy", cy);
      halos.setAttribute("r", 18); halos.setAttribute("fill", "none");
      halos.setAttribute("stroke", "#3b82f6"); halos.setAttribute("stroke-width", "1.5");
      halos.setAttribute("class", "selected-outline");
      layer.appendChild(halos);
      return;
    }

    const g = nsvg("g");
    applyTransform(g, item, { cx, cy });

    const rect = nsvg("rect");
    rect.setAttribute("x", cx - w / 2);
    rect.setAttribute("y", cy - h / 2);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#3b82f6");
    rect.setAttribute("stroke-dasharray", "4,3");
    rect.setAttribute("stroke-width", "1.5");
    rect.setAttribute("class", "selected-outline");
    layer.appendChild(g);
    g.appendChild(rect);

    // Poignée rotation (au-dessus)
    const rot = nsvg("circle");
    rot.setAttribute("cx", cx);
    rot.setAttribute("cy", cy - h / 2 - 16);
    rot.setAttribute("r", 6);
    rot.setAttribute("fill", "#3b82f6");
    rot.setAttribute("class", "handle rotate");
    rot.dataset.role = "rotate";
    rot.dataset.id = item.id;
    g.appendChild(rot);

    // Poignées resize (coins) — pour formes basiques uniquement
    const resizable = ["rect", "rond", "triangle", "croix"];
    if (resizable.includes(item.type)) {
      const mk = (dx, dy, cursor) => {
        const c = nsvg("rect");
        const sz = 8;
        c.setAttribute("x", cx + (w / 2) * dx - sz / 2);
        c.setAttribute("y", cy + (h / 2) * dy - sz / 2);
        c.setAttribute("width", sz); c.setAttribute("height", sz);
        c.setAttribute("fill", "#fff"); c.setAttribute("stroke", "#3b82f6");
        c.setAttribute("stroke-width", "1");
        c.setAttribute("class", "handle resize");
        c.style.cursor = cursor;
        c.dataset.role = "resize";
        c.dataset.id = item.id;
        c.dataset.dir = `${dx},${dy}`;
        g.appendChild(c);
      };
      mk(-1, -1, "nwse-resize");
      mk(1, -1, "nesw-resize");
      mk(1, 1, "nwse-resize");
      mk(-1, 1, "nesw-resize");
    }
  }

  // --- RENDU ---
  function render() {
    const pat = svg.querySelector('pattern#grid');
    if (pat) { pat.setAttribute("width", state.grid); pat.setAttribute("height", state.grid); }

    layer.innerHTML = "";
    (model.items || []).forEach(item => {
      let el = null;

      const attach = (gLike) => {
        gLike.dataset.id = item.id; gLike.classList.add("draggable");
        if (item.id === state.selectionId) gLike.classList.add("selected");
        applyTransform(gLike, item);
        layer.appendChild(gLike);
      };

      if (item.type === "plot") { attach(makeConeGroup(item)); return; }
      if (item.type === "joueur") { attach(makePlayerGroup(item)); return; }
      if (item.type === "ballon") { attach(makeBallGroup(item)); return; }
      if (item.type === "but") { attach(makeGoalGroup(item)); return; }
      if (item.type === "haie") { attach(makeHurdleGroup(item)); return; }
      if (item.type === "coupelle") { attach(makeDiscGroup(item)); return; }
      if (item.type === "rect") { attach(makeRectGroup(item)); return; }
      if (item.type === "rond") { attach(makeCircleGroup(item)); return; }
      if (item.type === "triangle") { attach(makeTriangleGroup(item)); return; }
      if (item.type === "croix") { attach(makeCrossGroup(item)); return; }

      if (item.type === "cerceau") {
        el = nsvg("circle");
        el.setAttribute("cx", item.x); el.setAttribute("cy", item.y);
        el.setAttribute("r", nz(item.r, 18));
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", item.color || "#3b82f6");
        el.setAttribute("stroke-width", 3);
        applyTransform(el, item);
      } else if (item.type === "poteau") {
        el = nsvg("rect");
        el.setAttribute("x", item.x - 3); el.setAttribute("y", item.y - 20);
        el.setAttribute("width", 6); el.setAttribute("height", 40);
        el.setAttribute("fill", item.color || "#10b981");
        applyTransform(el, item, { cx: item.x, cy: item.y });
      } else if (item.type === "echelle") {
        const g = nsvg("g");
        const w = nz(item.w, 120), h = nz(item.h, 40), steps = nz(item.steps, 4);
        const x = item.x - w / 2, y = item.y - h / 2;
        const rect = nsvg("rect");
        rect.setAttribute("x", x); rect.setAttribute("y", y);
        rect.setAttribute("width", w); rect.setAttribute("height", h);
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", item.color || "#f59e0b");
        rect.setAttribute("stroke-width", 2);
        g.appendChild(rect);
        for (let i = 1; i < steps; i++) {
          const lx = x + (w / steps) * i;
          const line = nsvg("line");
          line.setAttribute("x1", lx); line.setAttribute("y1", y);
          line.setAttribute("x2", lx); line.setAttribute("y2", y + h);
          line.setAttribute("stroke", item.color || "#f59e0b");
          line.setAttribute("stroke-width", 2);
          g.appendChild(line);
        }
        el = g;
        applyTransform(el, item);
      } else if (item.type === "fleche") {
        const midx = (item.x1 + item.x2) / 2;
        const midy = (item.y1 + item.y2) / 2;
        const g = nsvg("g");
        g.dataset.id = item.id; g.classList.add("draggable");
        if (item.id === state.selectionId) g.classList.add("selected");
        if (item.rot) g.setAttribute("transform", `rotate(${item.rot} ${midx} ${midy})`);

        const line = nsvg("line");
        line.setAttribute("x1", item.x1); line.setAttribute("y1", item.y1);
        line.setAttribute("x2", item.x2); line.setAttribute("y2", item.y2);
        line.setAttribute("stroke", item.color || "#111827");
        line.setAttribute("stroke-width", 6);
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("pointer-events", "stroke");
        line.setAttribute("marker-end", "url(#arrowHead)");
        line.dataset.id = item.id;
        g.appendChild(line);

        const mkHandle = (cx, cy) => {
          const h = nsvg("circle");
          h.setAttribute("cx", cx); h.setAttribute("cy", cy); h.setAttribute("r", 10);
          h.setAttribute("fill", "transparent"); h.setAttribute("pointer-events", "all");
          h.dataset.id = item.id; h.classList.add("draggable");
          return h;
        };
        g.appendChild(mkHandle(item.x1, item.y1));
        g.appendChild(mkHandle(item.x2, item.y2));
        el = g;
      } else if (item.type === "texte") {
        el = nsvg("text");
        el.setAttribute("x", item.x); el.setAttribute("y", item.y);
        el.setAttribute("fill", item.color || "#111827");
        el.setAttribute("font-size", nz(item.size, 14));
        el.textContent = item.text || "Texte";
        applyTransform(el, item);
      }

      if (!el) return;
      el.classList.add("draggable");
      el.dataset.id = item.id;
      if (item.id === state.selectionId) el.classList.add("selected");
      layer.appendChild(el);
    });

    // Overlay de sélection (handles)
    if (state.selectionId) {
      const itm = itemById(state.selectionId);
      if (itm) drawSelectedOverlay(itm);
    }

    refreshPropPanel();
  }

  function refreshPropPanel() {
    const itm = state.selectionId ? itemById(state.selectionId) : null;
    propType.textContent = itm ? itm.type : "—";
    propX.value = itm?.x ?? itm?.x1 ?? "";
    propY.value = itm?.y ?? itm?.y1 ?? "";
    propRot.value = itm ? nz(itm.rot, 0) : "";
    propColor.value = (itm?.color && itm.color.startsWith("#")) ? itm.color : "#111827";
    propTextWrap.style.display = itm && itm.type === "texte" ? "block" : "none";
    propText.value = itm && itm.type === "texte" ? (itm.text || "") : "";

    propSize.value = (
      itm?.type === "plot" ? nz(itm.r, 12) :
        itm?.type === "cerceau" ? nz(itm.r, 18) :
          itm?.type === "texte" ? nz(itm.size, 14) :
            itm?.type === "echelle" ? nz(itm.w, 120) :
              itm?.type === "joueur" ? nz(itm.r, 14) :
                itm?.type === "ballon" ? nz(itm.r, 10) :
                  itm?.type === "coupelle" ? nz(itm.r, 10) :
                    itm?.type === "rect" ? nz(itm.w, 60) :
                      itm?.type === "rond" ? nz(itm.r, 16) :
                        itm?.type === "triangle" ? nz(itm.a, 40) :
                          itm?.type === "croix" ? nz(itm.s, 14) :
                            itm?.type === "haie" ? nz(itm.w, 50) :
                              itm?.type === "but" ? nz(itm.w, 100) : ""
    );
  }

  function selectById(id) { state.selectionId = id || null; render(); }
  function addItem(obj) { pushHistory(); model.items.push(obj); selectById(obj.id); }

  // --- OUTILS ---
  toolButtons.forEach(b => {
    b.addEventListener("click", () => {
      toolButtons.forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.tool = b.dataset.tool;
      if (state.tool !== "select") selectById(null);
    });
  });
  const defaultBtn = document.querySelector('#editor-modal .tools button[data-tool="select"]');
  if (defaultBtn) defaultBtn.classList.add("active");

  // --- NOM / DESCRIPTION EXERCICE ---
  exName?.addEventListener("input", () => { model.name = exName.value; });
  exDesc?.addEventListener("input", () => { model.description = exDesc.value; });

  // --- SNAP / GRID ---
  snapToggle?.addEventListener("change", () => { state.snap = !!snapToggle.checked; });
  gridSizeInp?.addEventListener("change", () => {
    state.grid = Math.max(1, parseInt(gridSizeInp.value || "25", 10));
    render();
  });

  // --- ACTIONS ---
  btnClear?.addEventListener("click", () => {
    if (!model.items.length) return;
    pushHistory(); model.items = []; selectById(null);
  });
  btnUndo?.addEventListener("click", () => {
    if (!state.history.length) return;
    state.future.push(JSON.stringify(model));
    model = JSON.parse(state.history.pop());
    selectById(null);
  });
  btnRedo?.addEventListener("click", () => {
    if (!state.future.length) return;
    state.history.push(JSON.stringify(model));
    model = JSON.parse(state.future.pop());
    selectById(null);
  });
  btnDelSel?.addEventListener("click", deleteSelection);
  function deleteSelection() {
    if (!state.selectionId) return;
    pushHistory();
    model.items = model.items.filter(i => i.id !== state.selectionId);
    selectById(null);
  }

  // --- SOURIS : DRAG / RESIZE / ROTATE + CRÉATIONS ---
  svg.addEventListener("mousedown", (evt) => {
    if (evt.button !== 0) return;
    const p = getMouse(evt);

    // Handles overlay ?
    const role = evt.target?.dataset?.role;
    const idFromHandle = evt.target?.dataset?.id;
    if (role && idFromHandle) {
      const itm = itemById(idFromHandle); if (!itm) return;

      // centre de rotation
      const cx = itm.x ?? (itm.x1 + itm.x2) / 2;
      const cy = itm.y ?? (itm.y1 + itm.y2) / 2;

      if (role === "rotate") {
        state.transform = {
          id: itm.id,
          mode: "rotate",
          cx, cy,
          start: p,
          startRot: nz(itm.rot, 0),
          startAngle: angle(cx, cy, p.x, p.y)
        };
        selectById(itm.id);
        return;
      }
      if (role === "resize") {
        // on capture géométrie initiale selon type
        state.transform = {
          id: itm.id,
          mode: "resize",
          cx, cy,
          start: p,
          handle: (evt.target.dataset.dir || "0,0"),
          startGeom: JSON.parse(JSON.stringify(itm))
        };
        selectById(itm.id);
        return;
      }
    }

    const id = getTargetId(evt);

    // 1) DRAG/RESIZE si on clique un item
    if (id) {
      const itm = itemById(id); if (!itm) return;

      if (itm.type === "fleche") {
        const tol2 = 14 * 14;
        const nearStart = dist2(p.x, p.y, itm.x1, itm.y1) <= tol2;
        const nearEnd = dist2(p.x, p.y, itm.x2, itm.y2) <= tol2;
        if (nearStart) { state.resizingArrow = { id, end: "start" }; selectById(id); return; }
        if (nearEnd) { state.resizingArrow = { id, end: "end" }; selectById(id); return; }
        state.draggingId = id; state.dragStart = p;
        state.dragOffset = { x: p.x - itm.x1, y: p.y - itm.y1 };
        selectById(id); return;
      }

      state.draggingId = id; state.dragStart = p;
      state.dragOffset = { x: p.x - (itm.x ?? 0), y: p.y - (itm.y ?? 0) };
      selectById(id); return;
    }

    // 2) Création si vide + outil ≠ select
    if (state.tool === "select") { selectById(null); return; }

    if (state.tool === "plot") {
      addItem({ id: uid("p_"), type: "plot", x: snapFn(p.x), y: snapFn(p.y), r: 12, color: "#ef4444", rot: 0 });
    } else if (state.tool === "cerceau") {
      addItem({ id: uid("c_"), type: "cerceau", x: snapFn(p.x), y: snapFn(p.y), r: 18, color: "#3b82f6", rot: 0 });
    } else if (state.tool === "poteau") {
      addItem({ id: uid("t_"), type: "poteau", x: snapFn(p.x), y: snapFn(p.y), color: "#10b981", rot: 0 });
    } else if (state.tool === "echelle") {
      addItem({ id: uid("l_"), type: "echelle", x: snapFn(p.x), y: snapFn(p.y), w: 120, h: 40, steps: 4, color: "#f59e0b", rot: 0 });
    } else if (state.tool === "texte") {
      addItem({ id: uid("tx_"), type: "texte", x: snapFn(p.x), y: snapFn(p.y), text: "Texte", size: 14, color: "#111827", rot: 0 });
    } else if (state.tool === "fleche") {
      const newId = uid("a_");
      pushHistory();
      const obj = { id: newId, type: "fleche", x1: snapFn(p.x), y1: snapFn(p.y), x2: snapFn(p.x), y2: snapFn(p.y), color: "#111827", rot: 0 };
      model.items.push(obj);
      state.resizingArrow = { id: newId, end: "end" };
      selectById(newId); render();
    } else if (state.tool === "joueur") {
      addItem({ id: uid("pl_"), type: "joueur", x: snapFn(p.x), y: snapFn(p.y), r: 14, color: "#2563eb", rot: 0 });
    } else if (state.tool === "ballon") {
      addItem({ id: uid("b_"), type: "ballon", x: snapFn(p.x), y: snapFn(p.y), r: 10, color: "#111827", rot: 0 });
    } else if (state.tool === "but") {
      addItem({ id: uid("g_"), type: "but", x: snapFn(p.x), y: snapFn(p.y), w: 100, h: 56, color: "#6b7280", rot: 0 });
    } else if (state.tool === "haie") {
      addItem({ id: uid("h_"), type: "haie", x: snapFn(p.x), y: snapFn(p.y), w: 50, h: 14, color: "#e11d48", rot: 0 });
    } else if (state.tool === "coupelle") {
      addItem({ id: uid("d_"), type: "coupelle", x: snapFn(p.x), y: snapFn(p.y), r: 10, color: "#f59e0b", rot: 0 });
    } else if (state.tool === "rect") {
      addItem({ id: uid("r_"), type: "rect", x: snapFn(p.x), y: snapFn(p.y), w: 60, h: 40, color: "#6366f1", rot: 0 });
    } else if (state.tool === "rond") {
      addItem({ id: uid("o_"), type: "rond", x: snapFn(p.x), y: snapFn(p.y), r: 16, color: "#22c55e", rot: 0 });
    } else if (state.tool === "triangle") {
      addItem({ id: uid("t3_"), type: "triangle", x: snapFn(p.x), y: snapFn(p.y), a: 40, color: "#06b6d4", rot: 0 });
    } else if (state.tool === "croix") {
      addItem({ id: uid("x_"), type: "croix", x: snapFn(p.x), y: snapFn(p.y), s: 14, color: "#ef4444", rot: 45 });
    }
  });

  svg.addEventListener("mousemove", (evt) => {
    const p = getMouse(evt);

    // Resize/Rotate générique
    if (state.transform) {
      const itm = itemById(state.transform.id); if (!itm) return;
      if (state.transform.mode === "rotate") {
        const a0 = state.transform.startAngle;
        const a1 = angle(state.transform.cx, state.transform.cy, p.x, p.y);
        let deg = (state.transform.startRot || 0) + (a1 - a0) * 180 / Math.PI;
        if (state.snap) deg = Math.round(deg / 5) * 5;
        itm.rot = deg % 360;
        render(); return;
      }
      if (state.transform.mode === "resize") {
        const [dx, dy] = (state.transform.handle || "0,0").split(",").map(Number);
        const start = state.transform.startGeom;

        if (itm.type === "rect") {
          const cos = Math.cos((nz(itm.rot, 0)) * Math.PI / 180);
          const sin = Math.sin((nz(itm.rot, 0)) * Math.PI / 180);
          // vecteur centre -> souris en coordonnées locales
          const vx = p.x - state.transform.cx, vy = p.y - state.transform.cy;
          const lx = (vx * cos + vy * sin);
          const ly = (-vx * sin + vy * cos);
          let w = Math.abs(lx) * 2, h = Math.abs(ly) * 2;
          if (state.snap) { w = Math.round(w / state.grid) * state.grid; h = Math.round(h / state.grid) * state.grid; }
          itm.w = Math.max(10, w);
          itm.h = Math.max(10, h);
        } else if (itm.type === "rond") {
          const d = Math.sqrt(dist2(state.transform.cx, state.transform.cy, p.x, p.y));
          let r = d;
          if (state.snap) r = Math.round(r / state.grid) * state.grid;
          itm.r = Math.max(4, r);
        } else if (itm.type === "triangle") {
          const d = Math.sqrt(dist2(state.transform.cx, state.transform.cy, p.x, p.y));
          let a = d * 1.15; // facteur empirique pour avoir un ressenti ok
          if (state.snap) a = Math.round(a / state.grid) * state.grid;
          itm.a = Math.max(8, a);
        } else if (itm.type === "croix") {
          const d = Math.sqrt(dist2(state.transform.cx, state.transform.cy, p.x, p.y));
          let s = d * 0.7;
          if (state.snap) s = Math.round(s / state.grid) * state.grid;
          itm.s = Math.max(6, s);
        }
        render(); return;
      }
    }

    // Redimensionnement de flèche
    if (state.resizingArrow) {
      const itm = itemById(state.resizingArrow.id);
      if (!itm || itm.type !== "fleche") return;
      if (state.resizingArrow.end === "start") {
        itm.x1 = clamp(snapFn(p.x), 0, model.width);
        itm.y1 = clamp(snapFn(p.y), 0, model.height);
      } else {
        itm.x2 = clamp(snapFn(p.x), 0, model.width);
        itm.y2 = clamp(snapFn(p.y), 0, model.height);
      }
      render(); return;
    }

    // Drag d'un objet
    if (state.draggingId) {
      const itm = itemById(state.draggingId); if (!itm) return;
      if (itm.type === "fleche") {
        const newX1 = snapFn(p.x - state.dragOffset.x);
        const newY1 = snapFn(p.y - state.dragOffset.y);
        const dx = newX1 - itm.x1, dy = newY1 - itm.y1;
        itm.x1 = clamp(newX1, 0, model.width);
        itm.y1 = clamp(newY1, 0, model.height);
        itm.x2 = clamp(itm.x2 + dx, 0, model.width);
        itm.y2 = clamp(itm.y2 + dy, 0, model.height);
      } else {
        itm.x = clamp(snapFn(p.x - state.dragOffset.x), 0, model.width);
        itm.y = clamp(snapFn(p.y - state.dragOffset.y), 0, model.height);
      }
      render(); return;
    }
  });

  svg.addEventListener("mouseup", () => {
    if (state.draggingId || state.drawingArrow || state.resizingArrow || state.transform) pushHistory();
    state.draggingId = null;
    state.drawingArrow = null;
    state.resizingArrow = null;
    state.transform = null;
    state.dragStart = null;
  });

  // Édition rapide du texte par double-clic
  svg.addEventListener("dblclick", (evt) => {
    const id = getTargetId(evt); if (!id) return;
    const itm = itemById(id); if (!itm) return;
    if (itm.type === "texte") {
      const val = prompt("Texte :", itm.text || "");
      if (val != null) { itm.text = val; render(); pushHistory(); }
    }
  });

  // --- CLAVIER ---
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("show")) return;
    if (isTypingInField()) return;

    if ((e.key === "Delete" || e.key === "Backspace") && state.selectionId) {
      e.preventDefault(); deleteSelection();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); btnUndo?.click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); btnRedo?.click(); }

    if (state.selectionId && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "e")) {
      const itm = itemById(state.selectionId);
      if (itm) {
        itm.rot = (nz(itm.rot, 0) + (e.key.toLowerCase() === "q" ? -5 : 5)) % 360;
        render(); pushHistory();
      }
    }
  });

  svg.addEventListener("wheel", (e) => {
    if (!modal.classList.contains("show")) return;
    if (!e.altKey || !state.selectionId) return;
    e.preventDefault();
    const itm = itemById(state.selectionId);
    if (!itm) return;
    const delta = Math.sign(e.deltaY) * 5;
    itm.rot = (nz(itm.rot, 0) + delta) % 360;
    render();
  }, { passive: false });

  // --- BIND PROPRIÉTÉS ---
  propX.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    const v = parseFloat(propX.value || "0");
    if (itm.type === "fleche") { const dx = v - itm.x1; itm.x1 = v; itm.x2 += dx; }
    else itm.x = v;
    render(); pushHistory();
  });
  propY.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    const v = parseFloat(propY.value || "0");
    if (itm.type === "fleche") { const dy = v - itm.y1; itm.y1 = v; itm.y2 += dy; }
    else itm.y = v;
    render(); pushHistory();
  });
  propRot.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    itm.rot = parseFloat(propRot.value || "0") % 360;
    render(); pushHistory();
  });
  propColor.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    itm.color = propColor.value; render(); pushHistory();
  });
  propText.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm || itm.type !== "texte") return;
    itm.text = propText.value || ""; render(); pushHistory();
  });
  propSize.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    const v = parseFloat(propSize.value || "0");

    if (["plot", "cerceau", "joueur", "ballon", "coupelle", "rond"].includes(itm.type)) {
      itm.r = v;
    } else if (itm.type === "texte") {
      itm.size = v;
    } else if (["echelle", "rect", "haie", "but"].includes(itm.type)) {
      itm.w = v;
      if (itm.type === "rect") itm.h = Math.max(10, Math.round(v * 2 / 3));
      if (itm.type === "haie") itm.h = 14;
      if (itm.type === "but") itm.h = Math.max(20, Math.round(v * 0.56));
    } else if (itm.type === "triangle") {
      itm.a = v;
    } else if (itm.type === "croix") {
      itm.s = v;
    }
    render(); pushHistory();
  });

  // --- SAUVEGARDE DANS LE CATALOG ---
  btnSaveEx?.addEventListener("click", async () => {
    if (!currentEdit.id) return alert("Aucun exercice chargé.");
    const selKind = (kindSel?.value || currentEdit.kind);
    const newKind = (selKind === "jeu") ? "jeux" : selKind;

    try {
      const res = await fetch("/api/catalog", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      if (!res.ok) throw new Error("Impossible de charger le catalog");
      const catalog = await res.json();

      const byKind = {
        jeux: catalog.jeuxFoot || [],
        entr: catalog.entrainements || [],
        mob: catalog.mobilite || []
      };
      byKind.jeu = byKind.jeux;

      const oldKind = (currentEdit.kind === "jeu") ? "jeux" : currentEdit.kind;

      if (oldKind !== newKind) {
        const oldArr = byKind[oldKind] || [];
        const idx = oldArr.findIndex(x => x.id === currentEdit.id);
        if (idx >= 0) oldArr.splice(idx, 1);
      }

      const arr = byKind[newKind] || [];
      let obj = arr.find(x => x.id === currentEdit.id);
      if (!obj) { obj = { id: currentEdit.id, nom: "", description: "", materiel: [] }; arr.push(obj); }

      obj.nom = model.name || "";
      obj.description = model.description || "";
      obj.diagram = model;

      catalog.jeuxFoot = byKind.jeux;
      catalog.entrainements = byKind.entr;
      catalog.mobilite = byKind.mob;

      const save = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify(catalog)
      });
      if (!save.ok) {
        const j = await save.json().catch(() => ({}));
        throw new Error(j.error || "Échec de la sauvegarde");
      }

      const res2 = await fetch("/api/catalog", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      if (res2.ok) {
        const fresh = await res2.json();
        if (typeof window.__setCatalogFromEditor === "function") window.__setCatalogFromEditor(fresh);
      }

      modal.classList.remove("show"); modal.style.display = "none";
      alert("Exercice enregistré !");
    } catch (e) { alert(e.message); }
  });

  // --- API PUBLIQUE ---
  window.editorLoadExercise = (payload) => {
    currentEdit.kind = (payload.kind === "jeu") ? "jeux" : payload.kind;
    currentEdit.id = payload.id;

    const base = (payload.diagram && Array.isArray(payload.diagram.items)) ? payload.diagram : { width: 1000, height: 600, items: [] };
    model = {
      width: base.width || 1000,
      height: base.height || 600,
      name: payload.name || base.name || "",
      description: payload.description || base.description || "",
      items: Array.isArray(base.items) ? base.items : []
    };

    if (exName) exName.value = model.name || "";
    if (exDesc) exDesc.value = model.description || "";
    if (kindSel) kindSel.value = currentEdit.kind || "jeux";

    state.history = []; state.future = []; state.selectionId = null;

    toolButtons.forEach(x => x.classList.remove("active"));
    const btnSel = document.querySelector('#editor-modal .tools button[data-tool="select"]');
    if (btnSel) { btnSel.classList.add("active"); state.tool = "select"; }

    render();
  };

  // INIT
  state.snap = !!(snapToggle?.checked);
  state.grid = Math.max(1, parseInt(gridSizeInp.value || "25", 10));
  render();
})();