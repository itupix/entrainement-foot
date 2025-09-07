// public/editor.js
(function () {
  // --- RÉFÉRENCES DOM (dans la modale) ---
  const modal = document.getElementById("editor-modal");
  const svg = document.getElementById("editor-stage");
  const layer = document.getElementById("editor-layer");
  if (!modal || !svg || !layer) return; // HTML manquant

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
  const gridBg = document.getElementById("grid-bg");

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
    grid: 25
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
    return {
      x: clamp(x, 0, model.width),
      y: clamp(y, 0, model.height)
    };
  };

  const pushHistory = () => {
    state.history.push(JSON.stringify(model));
    if (state.history.length > 100) state.history.shift();
    state.future = [];
  };

  const nsvg = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
  const itemById = (id) => model.items.find(i => i.id === id);

  function applyTransform(el, item, centerOverride) {
    const rot = nz(item.rot, 0);
    if (!rot) return;
    const cx = centerOverride?.cx ?? item.x;
    const cy = centerOverride?.cy ?? item.y;
    el.setAttribute("transform", `rotate(${rot} ${cx} ${cy})`);
  }

  // --- RENDU ---
  function render() {
    // Ajuste le pattern de la grille
    const pat = svg.querySelector('pattern#grid');
    if (pat) { pat.setAttribute("width", state.grid); pat.setAttribute("height", state.grid); }

    layer.innerHTML = "";
    model.items.forEach(item => {
      let el = null;
      if (item.type === "plot") {
        el = nsvg("circle");
        el.setAttribute("cx", item.x);
        el.setAttribute("cy", item.y);
        el.setAttribute("r", nz(item.r, 8));
        el.setAttribute("fill", item.color || "#ef4444");
        applyTransform(el, item);
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
        el = nsvg("line");
        el.setAttribute("x1", item.x1);
        el.setAttribute("y1", item.y1);
        el.setAttribute("x2", item.x2);
        el.setAttribute("y2", item.y2);
        el.setAttribute("stroke", item.color || "#111827");
        el.setAttribute("stroke-width", 3);
        el.setAttribute("marker-end", "url(#arrowHead)");
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
      itm?.type === "plot" ? nz(itm.r, 8) :
        itm?.type === "cerceau" ? nz(itm.r, 18) :
          itm?.type === "texte" ? nz(itm.size, 14) :
            itm?.type === "echelle" ? nz(itm.w, 120) : ""
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

  // --- SOURIS / INTERACTIONS (drag FIX) ---
  svg.addEventListener("mousedown", (evt) => {
    const p = getMouse(evt);
    const id = evt.target?.dataset?.id;

    if (state.tool === "select") {
      if (id) {
        const itm = itemById(id);
        if (!itm) return;
        state.draggingId = id;
        state.dragStart = p;

        // Offset FIXE (correctif du bug de déplacement)
        if (itm.type === "fleche") {
          state.dragOffset = { x: p.x - itm.x1, y: p.y - itm.y1 };
        } else {
          state.dragOffset = { x: p.x - (itm.x ?? 0), y: p.y - (itm.y ?? 0) };
        }

        selectById(id);
      } else {
        selectById(null);
      }
      return;
    }

    // Créations
    if (state.tool === "plot") {
      addItem({ id: uid("p_"), type: "plot", x: snapFn(p.x), y: snapFn(p.y), r: 8, color: "#ef4444", rot: 0 });
    } else if (state.tool === "cerceau") {
      addItem({ id: uid("c_"), type: "cerceau", x: snapFn(p.x), y: snapFn(p.y), r: 18, color: "#3b82f6", rot: 0 });
    } else if (state.tool === "poteau") {
      addItem({ id: uid("t_"), type: "poteau", x: snapFn(p.x), y: snapFn(p.y), color: "#10b981", rot: 0 });
    } else if (state.tool === "echelle") {
      addItem({ id: uid("l_"), type: "echelle", x: snapFn(p.x), y: snapFn(p.y), w: 120, h: 40, steps: 4, color: "#f59e0b", rot: 0 });
    } else if (state.tool === "texte") {
      addItem({ id: uid("tx_"), type: "texte", x: snapFn(p.x), y: snapFn(p.y), text: "Texte", size: 14, color: "#111827", rot: 0 });
    } else if (state.tool === "fleche") {
      const id = uid("a_");
      pushHistory();
      const obj = { id, type: "fleche", x1: snapFn(p.x), y1: snapFn(p.y), x2: snapFn(p.x), y2: snapFn(p.y), color: "#111827" };
      model.items.push(obj);
      state.drawingArrow = { id, x1: obj.x1, y1: obj.y1 };
      render();
    }
  });

  svg.addEventListener("mousemove", (evt) => {
    const p = getMouse(evt);
    if (state.draggingId) {
      const itm = itemById(state.draggingId);
      if (!itm) return;

      if (itm.type === "fleche") {
        // déplacement de toute la flèche (conserve sa forme)
        const newX1 = snapFn(p.x - state.dragOffset.x);
        const newY1 = snapFn(p.y - state.dragOffset.y);
        const dx = newX1 - itm.x1;
        const dy = newY1 - itm.y1;
        itm.x1 = clamp(newX1, 0, model.width);
        itm.y1 = clamp(newY1, 0, model.height);
        itm.x2 = clamp(itm.x2 + dx, 0, model.width);
        itm.y2 = clamp(itm.y2 + dy, 0, model.height);
      } else {
        // position = souris - offset (SNAP + CLAMP)
        itm.x = clamp(snapFn(p.x - state.dragOffset.x), 0, model.width);
        itm.y = clamp(snapFn(p.y - state.dragOffset.y), 0, model.height);
      }
      render();
      return;
    }

    if (state.drawingArrow) {
      const obj = itemById(state.drawingArrow.id);
      if (!obj) return;
      obj.x2 = clamp(snapFn(p.x), 0, model.width);
      obj.y2 = clamp(snapFn(p.y), 0, model.height);
      render();
    }
  });

  svg.addEventListener("mouseup", () => {
    if (state.draggingId || state.drawingArrow) pushHistory();
    state.draggingId = null; state.drawingArrow = null; state.dragStart = null;
  });

  // --- ÉDITION RAPIDE TEXTE ---
  svg.addEventListener("dblclick", (evt) => {
    const id = evt.target?.dataset?.id;
    if (!id) return;
    const itm = itemById(id);
    if (!itm) return;
    if (itm.type === "texte") {
      const val = prompt("Texte :", itm.text || "");
      if (val != null) { itm.text = val; render(); pushHistory(); }
    }
  });

  // --- CLAVIER (suppr / undo / redo / rotation fine) ---
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("show")) return; // n'agit que si la modale est ouverte
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectionId) {
      e.preventDefault(); deleteSelection();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); btnUndo?.click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); btnRedo?.click(); }

    if (state.selectionId && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "e")) {
      const itm = itemById(state.selectionId);
      if (itm && itm.type !== "fleche") {
        itm.rot = (nz(itm.rot, 0) + (e.key.toLowerCase() === "q" ? -5 : 5)) % 360;
        render(); pushHistory();
      }
    }
  });

  // Rotation Alt + molette
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
  propRot.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm || itm.type === "fleche") return;
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
    if (itm.type === "plot" || itm.type === "cerceau") itm.r = v;
    else if (itm.type === "texte") itm.size = v;
    else if (itm.type === "echelle") itm.w = v;
    render(); pushHistory();
  });

  // --- SAUVEGARDE DIRECTE DANS LE CATALOG ---
  btnSaveEx?.addEventListener("click", async () => {
    if (!currentEdit.id) return alert("Aucun exercice chargé.");
    const selKind = (kindSel?.value || currentEdit.kind);
    const newKind = (selKind === "jeu") ? "jeux" : selKind; // alias tolérant

    try {
      const res = await fetch("/api/catalog", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      if (!res.ok) throw new Error("Impossible de charger le catalog");
      const catalog = await res.json();

      const byKind = {
        jeux: catalog.jeuxFoot || [],
        entr: catalog.entrainements || [],
        mob: catalog.mobilite || []
      };
      byKind.jeu = byKind.jeux; // alias sécurité

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

      // réécrit dans catalog
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

      // ferme la modale et feedback
      modal.classList.remove("show"); modal.style.display = "none";
      alert("Exercice enregistré !");
    } catch (e) { alert(e.message); }
  });

  // --- API PUBLIQUE POUR OUVRIR UN EXERCICE ---
  window.editorLoadExercise = (payload) => {
    // payload: { kind, id, name, description, diagram }
    currentEdit.kind = (payload.kind === "jeu") ? "jeux" : payload.kind; // alias
    currentEdit.id = payload.id;

    const base = (payload.diagram && Array.isArray(payload.diagram.items)) ? payload.diagram : { width: 1000, height: 600, items: [] };
    model = {
      width: base.width || 1000,
      height: base.height || 600,
      name: payload.name || base.name || "",
      description: payload.description || base.description || "",
      items: Array.isArray(base.items) ? base.items : []
    };

    // I/O init
    if (exName) exName.value = model.name || "";
    if (exDesc) exDesc.value = model.description || "";
    if (kindSel) kindSel.value = currentEdit.kind || "jeux";

    state.history = []; state.future = []; state.selectionId = null;

    // Tool par défaut: select
    toolButtons.forEach(x => x.classList.remove("active"));
    const btnSel = document.querySelector('#editor-modal .tools button[data-tool="select"]');
    if (btnSel) { btnSel.classList.add("active"); state.tool = "select"; }

    render();
  };

  // (optionnel) pour compat : expose aussi ces 2 helpers
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