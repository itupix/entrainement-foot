let currentEdit = { kind: null, id: null }; // "jeux" | "entr" | "mob", et id de l'exercice

(function () {
  const svg = document.getElementById("editor-stage");
  const layer = document.getElementById("editor-layer");
  if (!svg || !layer) return;

  // ---- État global éditeur
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

  // ---- Modèle (diagram)
  let model = {
    width: 1000, height: 600,
    name: "", description: "",
    items: []
  };

  // ---- DOM refs
  const gridBg = document.getElementById("grid-bg");
  const snapToggle = document.getElementById("snap-toggle");
  const gridSizeInp = document.getElementById("grid-size");
  const exName = document.getElementById("ex-name");
  const exDesc = document.getElementById("ex-desc");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnClear = document.getElementById("btn-clear");
  const btnDelSel = document.getElementById("btn-delete-selected");
  const btnExportJson = document.getElementById("btn-export-json");
  const btnExportSvg = document.getElementById("btn-export-svg");

  // Panneau propriétés
  const propType = document.getElementById("prop-type");
  const propX = document.getElementById("prop-x");
  const propY = document.getElementById("prop-y");
  const propRot = document.getElementById("prop-rot");
  const propSize = document.getElementById("prop-size");
  const propColor = document.getElementById("prop-color");
  const propText = document.getElementById("prop-text");
  const propTextWrap = document.getElementById("prop-text-wrap");

  // ---- Utils
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);
  const nz = (v, d) => (v == null ? d : v);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const toRad = (deg) => deg * Math.PI / 180;

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

  const itemById = (id) => model.items.find(i => i.id === id);

  // ---- Rendu SVG
  function render() {
    // grid step
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
        // rotation ignorée : la flèche est définie par 2 points
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

    // prop panel
    refreshPropPanel();
  }

  function nsvg(tag) { return document.createElementNS("http://www.w3.org/2000/svg", tag); }

  function applyTransform(el, item, centerOverride) {
    const rot = nz(item.rot, 0);
    if (!rot) return;
    const cx = centerOverride?.cx ?? item.x;
    const cy = centerOverride?.cy ?? item.y;
    el.setAttribute("transform", `rotate(${rot} ${cx} ${cy})`);
  }

  // ---- Sélection
  function selectById(id) {
    state.selectionId = id || null;
    render();
  }

  // ---- Création éléments
  function addItem(obj) {
    pushHistory();
    model.items.push(obj);
    selectById(obj.id);
  }

  // ---- Toolbar outils
  document.querySelectorAll('#editor-modal .tools button').forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll('#editor-modal .tools button').forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.tool = b.dataset.tool;
      if (state.tool !== "select") selectById(null);
    });
  });
  document.querySelector('#editor-modal .tools button[data-tool="select"]')?.classList.add("active");

  // ---- Nom / description exercice
  exName?.addEventListener("input", () => { model.name = exName.value; });
  exDesc?.addEventListener("input", () => { model.description = exDesc.value; });

  // ---- Grille / snap
  snapToggle?.addEventListener("change", () => {
    state.snap = !!snapToggle.checked;
  });
  gridSizeInp?.addEventListener("change", () => {
    state.grid = Math.max(1, parseInt(gridSizeInp.value || "25", 10));
    render();
  });

  // ---- Actions
  btnClear?.addEventListener("click", () => {
    if (!model.items.length) return;
    pushHistory();
    model.items = [];
    selectById(null);
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

  btnExportJson?.addEventListener("click", () => {
    const data = JSON.stringify(model, null, 2);
    dlBlob(data, "application/json", "diagram.json");
  });
  btnExportSvg?.addEventListener("click", () => {
    const clone = svg.cloneNode(true);
    clone.querySelector("#editor-layer").innerHTML = layer.innerHTML;
    const xml = new XMLSerializer().serializeToString(clone);
    dlBlob(xml, "image/svg+xml", "diagram.svg");
  });

  function dlBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const kindSel = document.getElementById("ex-kind");
  const btnSaveEx = document.getElementById("btn-save-ex");

  btnSaveEx?.addEventListener("click", async () => {
    if (!currentEdit.id) return alert("Aucun exercice chargé.");
    const newKind = kindSel?.value || currentEdit.kind;

    try {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("Impossible de charger le catalog");
      const catalog = await res.json();

      // Après avoir fait: const catalog = await (await fetch("/api/catalog", { cache:"no-store" })).json();
      const byKind = {
        jeux: catalog.jeuxFoot || [],
        entr: catalog.entrainements || [],
        mob: catalog.mobilite || []
      };
      // ✅ alias tolérant si jamais on reçoit "jeu" (singulier)
      byKind.jeu = byKind.jeux;

      const oldKind = (currentEdit.kind === "jeu") ? "jeux" : currentEdit.kind;
      const newKind = (kindSel?.value === "jeu") ? "jeux" : (kindSel?.value || currentEdit.kind);

      // retirer de l’ancienne catégorie si elle change
      if (oldKind !== newKind) {
        const oldArr = byKind[oldKind];
        const idx = oldArr.findIndex(x => x.id === currentEdit.id);
        if (idx >= 0) oldArr.splice(idx, 1);
      }

      // insérer / mettre à jour dans la nouvelle catégorie
      const arr = byKind[newKind];
      let obj = arr.find(x => x.id === currentEdit.id);
      if (!obj) {
        obj = { id: currentEdit.id, nom: "", description: "", materiel: [] };
        arr.push(obj);
      }
      obj.nom = model.name || "";
      obj.description = model.description || "";
      obj.diagram = model;

      // refléter dans le catalog (⚠️ on n’écrit que les clés officielles)
      catalog.jeuxFoot = byKind.jeux;
      catalog.entrainements = byKind.entr;
      catalog.mobilite = byKind.mob;

      // POST sans cache
      const save = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify(catalog)
      });
      if (!save.ok) {
        const j = await save.json().catch(() => ({}));
        throw new Error(j.error || "Échec de la sauvegarde");
      }

      // re-fetch frais et pousser à l'app
      const res2 = await fetch("/api/catalog", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      if (res2.ok) {
        const fresh = await res2.json();
        if (typeof window.__setCatalogFromEditor === "function") window.__setCatalogFromEditor(fresh);
      }

      if (!save.ok) {
        const j = await save.json().catch(() => ({}));
        throw new Error(j.error || "Échec de la sauvegarde");
      }

      // ⬇️ Essaye d'utiliser la réponse du POST si le backend la fournit
      let freshCatalog = null;
      try {
        const payload = await save.json(); // ex. { ok:true, catalog: {...} } ou { ok:true }
        if (payload && payload.catalog) freshCatalog = payload.catalog;
      } catch { }

      // Sinon refetch en "no-store" pour bypass tout cache
      if (!freshCatalog) {
        const res2 = await fetch("/api/catalog", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (res2.ok) freshCatalog = await res2.json();
      }

      if (freshCatalog && typeof window.__setCatalogFromEditor === "function") {
        window.__setCatalogFromEditor(freshCatalog);
      }

      // Fermer la modale + feedback
      const modal = document.getElementById("editor-modal");
      if (modal) { modal.classList.remove("show"); modal.style.display = "none"; }
      alert("Exercice enregistré !");
    } catch (e) {
      alert(e.message);
    }
  });

  // ---- Souris / interactions
  svg.addEventListener("mousedown", (evt) => {
    const p = getMouse(evt);
    const target = evt.target;
    const id = target?.dataset?.id;

    if (state.tool === "select") {
      if (id) {
        state.draggingId = id;
        state.dragStart = p;
        const itm = itemById(id);
        // offset pour les types "ancrés"
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
      // déplacement
      if (itm.type === "fleche") {
        const dx = snapFn(p.x - state.dragOffset.x) - itm.x1;
        const dy = snapFn(p.y - state.dragOffset.y) - itm.y1;
        itm.x1 += dx; itm.y1 += dy; itm.x2 += dx; itm.y2 += dy;
      } else {
        itm.x = snapFn(p.x - state.dragOffset.x + (itm.x ?? 0));
        itm.y = snapFn(p.y - state.dragOffset.y + (itm.y ?? 0));
      }
      render();
    } else if (state.drawingArrow) {
      const obj = itemById(state.drawingArrow.id);
      if (!obj) return;
      obj.x2 = snapFn(p.x); obj.y2 = snapFn(p.y);
      render();
    }
  });

  svg.addEventListener("mouseup", () => {
    if (state.draggingId || state.drawingArrow) pushHistory();
    state.draggingId = null; state.drawingArrow = null; state.dragStart = null;
  });

  // ---- Edition rapide du texte (double-clic)
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

  // ---- Clavier: supprimer, undo/redo, rotation fine
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectionId) {
      e.preventDefault(); deleteSelection();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault(); btnUndo?.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault(); btnRedo?.click();
    }
    // rotation: Alt + molette (géré sur wheel), ou raccourcis Q/E
    if (state.selectionId && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "e")) {
      const itm = itemById(state.selectionId);
      if (itm && itm.type !== "fleche") {
        itm.rot = (nz(itm.rot, 0) + (e.key.toLowerCase() === "q" ? -5 : 5)) % 360;
        render(); pushHistory();
      }
    }
  });

  // Rotation avec molette (Alt + scroll)
  svg.addEventListener("wheel", (e) => {
    if (!e.altKey || !state.selectionId) return;
    e.preventDefault();
    const itm = itemById(state.selectionId);
    if (!itm || itm.type === "fleche") return;
    const delta = Math.sign(e.deltaY) * 5;
    itm.rot = (nz(itm.rot, 0) + delta) % 360;
    render();
  }, { passive: false });

  function deleteSelection() {
    if (!state.selectionId) return;
    pushHistory();
    model.items = model.items.filter(i => i.id !== state.selectionId);
    selectById(null);
  }

  // ---- Panneau propriétés binding
  function refreshPropPanel() {
    const itm = state.selectionId ? itemById(state.selectionId) : null;
    propType.textContent = itm ? itm.type : "—";
    propX.value = itm?.x ?? itm?.x1 ?? "";
    propY.value = itm?.y ?? itm?.y1 ?? "";
    propRot.value = itm ? nz(itm.rot, 0) : "";
    propColor.value = toColor(itm?.color);
    propTextWrap.style.display = itm && itm.type === "texte" ? "block" : "none";
    propText.value = itm && itm.type === "texte" ? (itm.text || "") : "";
    // size
    propSize.value = (
      itm?.type === "plot" ? nz(itm.r, 8) :
        itm?.type === "cerceau" ? nz(itm.r, 18) :
          itm?.type === "texte" ? nz(itm.size, 14) :
            itm?.type === "echelle" ? nz(itm.w, 120) : ""
    );
  }

  function toColor(c) {
    const d = c || "#111827";
    // convertit éventuellement rgb/… en hex simple si besoin
    return d.startsWith("#") ? d : "#111827";
  }

  propX.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    const v = parseFloat(propX.value || "0");
    if (itm.type === "fleche") { itm.x2 += (v - itm.x1); itm.x1 = v; }
    else itm.x = v;
    render(); pushHistory();
  });
  propY.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    const v = parseFloat(propY.value || "0");
    if (itm.type === "fleche") { itm.y2 += (v - itm.y1); itm.y1 = v; }
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
    itm.color = propColor.value;
    render(); pushHistory();
  });
  propText.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm || itm.type !== "texte") return;
    itm.text = propText.value || "";
    render(); pushHistory();
  });
  propSize.addEventListener("change", () => {
    const itm = itemById(state.selectionId); if (!itm) return;
    const v = parseFloat(propSize.value || "0");
    if (itm.type === "plot" || itm.type === "cerceau") itm.r = v;
    else if (itm.type === "texte") itm.size = v;
    else if (itm.type === "echelle") itm.w = v; // largeur de l’échelle (simple)
    render(); pushHistory();
  });

  // ---- API publique
  window.getDiagramJSON = () => JSON.parse(JSON.stringify(model));
  window.loadDiagram = (json) => {
    try {
      const snap = !!snapToggle?.checked;
      model = JSON.parse(JSON.stringify(json));
      // champs facultatifs
      model.width = nz(model.width, 1000);
      model.height = nz(model.height, 600);
      model.name = nz(model.name, "");
      model.description = nz(model.description, "");
      model.items = Array.isArray(model.items) ? model.items : [];
      state.history = []; state.future = []; state.selectionId = null;
      state.snap = snap;
      render();
    } catch { alert("JSON invalide"); }
  };

  window.editorLoadExercise = (payload) => {
    // payload: { kind, id, name, description, diagram }
    currentEdit.kind = payload.kind;
    currentEdit.id = payload.id;

    // Construire le modèle à partir du diagram (ou neuf)
    const base = payload.diagram && payload.diagram.items ? payload.diagram : { width: 1000, height: 600, items: [] };
    model = {
      width: base.width || 1000,
      height: base.height || 600,
      name: payload.name || base.name || "",
      description: payload.description || base.description || "",
      items: Array.isArray(base.items) ? base.items : []
    };

    // Pré-remplir inputs
    if (exName) exName.value = model.name || "";
    if (exDesc) exDesc.value = model.description || "";

    state.history = [];
    state.future = [];
    state.selectionId = null;
    render();
  };

  // ---- Init
  render();
})();