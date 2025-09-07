// public/editor.js
(function () {
  // --- RÉFÉRENCES DOM (dans la modale) ---
  const modal = document.getElementById("editor-modal");
  const svg = document.getElementById("editor-stage");
  const layer = document.getElementById("editor-layer");
  if (!modal || !svg || !layer) return;

  // Toolbar outils
  const toolButtons = Array.from(document.querySelectorAll('#editor-modal .tools button'));

  // Propriétés exercice
  const exName = document.getElementById("ex-name");
  const exDesc = document.getElementById("ex-desc");
  const kindSel = document.getElementById("ex-kind"); // "jeux" | "entr" | "mob"
  const btnSaveEx = document.getElementById("btn-save-ex");

  // Grille / snap
  const snapToggle = document.getElementById("snap-toggle");
  const gridSizeInp = document.getElementById("grid-size");

  // Panneau propriétés élément
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
    drawingArrow: null, // { id, x1,y1 }
    history: [],
    future: [],
    snap: true,
    grid: 25,
    resizingArrow: null, // { id, end: "start"|"end" }
  };

  let model = { width: 1000, height: 600, name: "", description: "", items: [] };
  let currentEdit = { kind: null, id: null }; // "jeux" | "entr" | "mob", et id de l'exercice

  // --- UTILS ---
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);
  const nz = (v, d) => (v == null ? d : v);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const snapFn = (v) => state.snap ? Math.round(v / state.grid) * state.grid : v;

  const getMouse = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: clamp(x, 0, model.width), y: clamp(y, 0, model.height) };
  };

  const pushHistory = () => {
    state.history.push(JSON.stringify(model));
    if (state.history.length > 100) state.history.shift();
    state.future = [];
  };

  function isTypingInField() {
    const a = document.activeElement;
    return a && (
      a.tagName === "INPUT" ||
      a.tagName === "TEXTAREA" ||
      a.isContentEditable
    );
  }

  const nsvg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
  const itemById = (id) => model.items.find(i => i.id === id);

  function applyTransform(el, item, centerOverride) {
    const rot = nz(item.rot, 0);
    if (!rot) return;
    const cx = centerOverride?.cx ?? item.x;
    const cy = centerOverride?.cy ?? item.y;
    el.setAttribute("transform", `rotate(${rot} ${cx} ${cy})`);
  }

  // --- DÉTECTION CIBLE ROBUSTE (évite duplications) ---
  function getTargetId(evt) {
    // 1) composedPath : meilleur cas
    if (typeof evt.composedPath === "function") {
      const path = evt.composedPath();
      for (const n of path) {
        if (n && n.dataset && n.dataset.id) return n.dataset.id;
        if (n === svg) break;
      }
    }
    // 2) remonter le DOM depuis target
    let n = evt.target;
    while (n && n !== svg) {
      if (n.dataset && n.dataset.id) return n.dataset.id;
      n = n.parentNode;
    }
    // 3) fallback : hit-test écran (si un overlay capte le clic)
    const el = document.elementFromPoint(evt.clientX, evt.clientY);
    n = el;
    while (n && n !== svg) {
      if (n.dataset && n.dataset.id) return n.dataset.id;
      n = n.parentNode;
    }
    return null;
  }

  function dist2(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; }

  // --- VISUELS SPÉCIAUX ---
  function makeConeGroup(item) {
    const g = nsvg("g");
    const color = item.color || "#ef4444";
    const R = nz(item.r, 12);
    const cx = item.x, cy = item.y;
    const h = R * 1.8;
    const yTop = cy - R - h * 0.6;
    const yBase = cy - R * 0.2;

    const body = nsvg("path");
    const d = [
      `M ${cx} ${yTop}`,
      `L ${cx - R * 0.9} ${yBase}`,
      `Q ${cx} ${yBase + R * 0.2} ${cx + R * 0.9} ${yBase}`,
      "Z"
    ].join(" ");
    body.setAttribute("d", d);
    body.setAttribute("fill", color);
    body.setAttribute("stroke", "#222");
    body.setAttribute("stroke-width", "0.5");
    g.appendChild(body);

    const shine = nsvg("path");
    const sd = [
      `M ${cx - R * 0.15} ${yTop + h * 0.25}`,
      `L ${cx - R * 0.35} ${yBase - R * 0.25}`,
      `Q ${cx - R * 0.15} ${yBase - R * 0.15} ${cx - R * 0.05} ${yTop + h * 0.3}`,
      "Z"
    ].join(" ");
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
    const d = [
      `M ${x0} ${y0 + h * 0.35}`,
      `Q ${cx} ${y0} ${x0 + w} ${y0 + h * 0.35}`,
      `L ${x0 + w} ${y0 + h * 0.85}`,
      `Q ${cx} ${y0 + h} ${x0} ${y0 + h * 0.85}`,
      "Z"
    ].join(" ");
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

  // --- RENDU ---
  function render() {
    const pat = svg.querySelector('pattern#grid');
    if (pat) { pat.setAttribute("width", state.grid); pat.setAttribute("height", state.grid); }

    layer.innerHTML = "";
    model.items.forEach(item => {
      let el = null;

      if (item.type === "plot") {
        const g = makeConeGroup(item);
        g.dataset.id = item.id;
        g.classList.add("draggable");
        if (item.id === state.selectionId) g.classList.add("selected");
        applyTransform(g, item);
        layer.appendChild(g);
        return;
      } else if (item.type === "joueur") {
        const g = makePlayerGroup(item);
        g.dataset.id = item.id;
        g.classList.add("draggable");
        if (item.id === state.selectionId) g.classList.add("selected");
        applyTransform(g, item);
        layer.appendChild(g);
        return;
      } else if (item.type === "cerceau") {
        el = nsvg("circle");
        el.setAttribute("cx", item.x);
        el.setAttribute("cy", item.y);
        el.setAttribute("r", nz(item.r, 18));
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", item.color || "#3b82f6");
        el.setAttribute("stroke-width", 3);
        applyTransform(el, item);
      } else if (item.type === "poteau") {
        el = nsvg("rect");
        el.setAttribute("x", item.x - 3);
        el.setAttribute("y", item.y - 20);
        el.setAttribute("width", 6);
        el.setAttribute("height", 40);
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

        // Groupe rotatable, porteur du data-id => facilite la sélection
        const g = nsvg("g");
        g.dataset.id = item.id;
        g.classList.add("draggable");
        if (item.id === state.selectionId) g.classList.add("selected");
        if (item.rot) g.setAttribute("transform", `rotate(${item.rot} ${midx} ${midy})`);

        // Ligne : pointer-events sur le STROKE pour une hitbox confortable
        const line = nsvg("line");
        line.setAttribute("x1", item.x1);
        line.setAttribute("y1", item.y1);
        line.setAttribute("x2", item.x2);
        line.setAttribute("y2", item.y2);
        line.setAttribute("stroke", item.color || "#111827");
        line.setAttribute("stroke-width", 6);                 // <- hitbox généreuse
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("pointer-events", "stroke");        // <- clics sur le trait
        line.setAttribute("marker-end", "url(#arrowHead)");
        line.dataset.id = item.id;                            // sécurité

        g.appendChild(line);

        // Petits "poignées" invisibles mais cliquables sur les extrémités
        const handleR = 10; // rayon clic (invisible)
        const mkHandle = (cx, cy) => {
          const h = nsvg("circle");
          h.setAttribute("cx", cx); h.setAttribute("cy", cy); h.setAttribute("r", handleR);
          h.setAttribute("fill", "transparent");
          h.setAttribute("pointer-events", "all"); // capte bien le clic
          h.dataset.id = item.id;
          h.classList.add("draggable");
          return h;
        };
        g.appendChild(mkHandle(item.x1, item.y1));
        g.appendChild(mkHandle(item.x2, item.y2));

        el = g;
      } else if (item.type === "texte") {
        el = nsvg("text");
        el.setAttribute("x", item.x);
        el.setAttribute("y", item.y);
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

    refreshPropPanel();
  }

  function refreshPropPanel() {
    const itm = state.selectionId ? itemById(state.selectionId) : null;
    propType.textContent = itm ? itm.type : "—";
    propX.value = itm?.x ?? itm?.x1 ?? "";
    propY.value = itm?.y ?? itm?.y1 ?? "";
    propRot.value = itm ? nz(itm.rot, 0) : "";
    propColor.value = toColor(itm?.color);
    propTextWrap.style.display = itm && itm.type === "texte" ? "block" : "none";
    propText.value = itm && itm.type === "texte" ? (itm.text || "") : "";
    propSize.value = (
      itm?.type === "plot" ? nz(itm.r, 12) :
        itm?.type === "cerceau" ? nz(itm.r, 18) :
          itm?.type === "texte" ? nz(itm.size, 14) :
            itm?.type === "echelle" ? nz(itm.w, 120) :
              itm?.type === "joueur" ? nz(itm.r, 14) : ""
    );
  }
  function toColor(c) { return (c && c.startsWith("#")) ? c : "#111827"; }

  function selectById(id) {
    state.selectionId = id || null;
    render();
  }

  function addItem(obj) {
    pushHistory();
    model.items.push(obj);
    selectById(obj.id);
  }

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

  function isNearAnyItem(p, tol = 8) {
    for (const it of model.items) {
      if (it.type === "fleche") continue;
      const cx = it.x ?? it.x1, cy = it.y ?? it.y1;
      if (cx == null || cy == null) continue;
      const dx = p.x - cx, dy = p.y - cy;
      if (Math.hypot(dx, dy) <= tol + (it.r ?? 0)) return true;
    }
    return false;
  }

  // --- SOURIS / INTERACTIONS (★ drag prioritaire, stop duplications) ---
  svg.addEventListener("mousedown", (evt) => {
    if (evt.button !== 0) return; // bouton gauche uniquement
    const p = getMouse(evt);
    const id = getTargetId(evt);

    // 1) Clic sur un élément => DRAG ou RESIZE
    if (id) {
      const itm = model.items.find(i => i.id === id);
      if (!itm) return;

      // Si flèche : check proximité des extrémités pour passer en mode "resize-end"
      if (itm.type === "fleche") {
        const tol2 = 14 * 14; // tolérance ~14px
        const nearStart = dist2(p.x, p.y, itm.x1, itm.y1) <= tol2;
        const nearEnd = dist2(p.x, p.y, itm.x2, itm.y2) <= tol2;
        if (nearStart) { state.resizingArrow = { id, end: "start" }; selectById(id); return; }
        if (nearEnd) { state.resizingArrow = { id, end: "end" }; selectById(id); return; }
        // sinon, drag de toute la flèche (translation comme avant)
        state.draggingId = id;
        state.dragStart = p;
        state.dragOffset = { x: p.x - itm.x1, y: p.y - itm.y1 }; // offset sur le point 1
        selectById(id);
        return;
      }

      // Autres types : drag normal
      state.draggingId = id;
      state.dragStart = p;
      state.dragOffset = { x: p.x - (itm.x ?? 0), y: p.y - (itm.y ?? 0) };
      selectById(id);
      return;
    }

    // 2) Clic dans le vide => création si outil ≠ select
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
      state.resizingArrow = { id: newId, end: "end" }; // on commence à tirer l’extrémité
      selectById(newId);
      render();
    } else if (state.tool === "joueur") {
      addItem({ id: uid("pl_"), type: "joueur", x: snapFn(p.x), y: snapFn(p.y), r: 14, color: "#2563eb", rot: 0 });
    }
  });

  svg.addEventListener("mousemove", (evt) => {
    const p = getMouse(evt);

    // Redimensionnement d'une extrémité de flèche
    if (state.resizingArrow) {
      const itm = model.items.find(i => i.id === state.resizingArrow.id);
      if (!itm || itm.type !== "fleche") return;
      if (state.resizingArrow.end === "start") {
        itm.x1 = clamp(snapFn(p.x), 0, model.width);
        itm.y1 = clamp(snapFn(p.y), 0, model.height);
      } else {
        itm.x2 = clamp(snapFn(p.x), 0, model.width);
        itm.y2 = clamp(snapFn(p.y), 0, model.height);
      }
      render();
      return;
    }

    // Drag d'un objet
    if (state.draggingId) {
      const itm = model.items.find(i => i.id === state.draggingId);
      if (!itm) return;

      if (itm.type === "fleche") {
        // translation de toute la flèche
        const newX1 = snapFn(p.x - state.dragOffset.x);
        const newY1 = snapFn(p.y - state.dragOffset.y);
        const dx = newX1 - itm.x1;
        const dy = newY1 - itm.y1;
        itm.x1 = clamp(newX1, 0, model.width);
        itm.y1 = clamp(newY1, 0, model.height);
        itm.x2 = clamp(itm.x2 + dx, 0, model.width);
        itm.y2 = clamp(itm.y2 + dy, 0, model.height);
      } else {
        itm.x = clamp(snapFn(p.x - state.dragOffset.x), 0, model.width);
        itm.y = clamp(snapFn(p.y - state.dragOffset.y), 0, model.height);
      }
      render();
      return;
    }
  });

  svg.addEventListener("mouseup", () => {
    if (state.draggingId || state.drawingArrow || state.resizingArrow) pushHistory();
    state.draggingId = null;
    state.drawingArrow = null;
    state.resizingArrow = null;
    state.dragStart = null;
  });

  // --- ÉDITION RAPIDE TEXTE ---
  svg.addEventListener("dblclick", (evt) => {
    const id = getTargetId(evt);
    if (!id) return;
    const itm = itemById(id);
    if (!itm) return;
    if (itm.type === "texte") {
      const val = prompt("Texte :", itm.text || "");
      if (val != null) { itm.text = val; render(); pushHistory(); }
    }
  });

  // --- CLAVIER ---
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("show")) return;

    // ⛔ Ne pas capter les raccourcis quand on tape dans un champ
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
    if (!itm || itm.type === "fleche") return;
    const delta = Math.sign(e.deltaY) * 5;
    itm.rot = (nz(itm.rot, 0) + delta) % 360;
    render();
  }, { passive: false });

  // --- PROPRIÉTÉS BINDINGS ---
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
  // clavier (extrait)
  if (state.selectionId) {
    const itm = model.items.find(i => i.id === state.selectionId);
    if (itm) { itm.rot = (nz(itm.rot, 0) + (e.key.toLowerCase() === "q" ? -5 : 5)) % 360; render(); pushHistory(); }
  }

  // propRot (extrait)
  propRot.addEventListener("change", () => {
    const itm = model.items.find(i => i.id === state.selectionId); if (!itm) return;
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
    if (itm.type === "plot" || itm.type === "cerceau" || itm.type === "joueur") itm.r = v;
    else if (itm.type === "texte") itm.size = v;
    else if (itm.type === "echelle") itm.w = v;
    render(); pushHistory();
  });

  // --- SAUVEGARDE DIRECTE DANS LE CATALOG ---
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

  // --- API PUBLIQUE POUR OUVRIR UN EXERCICE ---
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

  // Helpers legacy
  window.getDiagramJSON = () => JSON.parse(JSON.stringify(model));
  window.loadDiagram = (json) => {
    try {
      const base = (json && Array.isArray(json.items)) ? json : { width: 1000, height: 600, items: [] };
      model = {
        width: base.width || 1000,
        height: base.height || 600,
        name: base.name || "",
        description: base.description || "",
        items: Array.isArray(base.items) ? base.items : []
      };
      state.history = []; state.future = []; state.selectionId = null;
      render();
    } catch { alert("JSON invalide"); }
  };

  // --- INIT ---
  state.snap = !!(snapToggle?.checked);
  state.grid = Math.max(1, parseInt(gridSizeInp?.value || "25", 10));
  render();
})();