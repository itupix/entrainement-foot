// public/app.js

// -----------------------
// Utilitaires généraux
// -----------------------
function todayIso() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function countUsages(calendar) {
  const usages = { jeux: {}, entr: {}, mob: {} };
  if (!calendar || !Array.isArray(calendar.items)) return usages;
  calendar.items.forEach((day) => {
    if (day.jeu?.id) usages.jeux[day.jeu.id] = (usages.jeux[day.jeu.id] || 0) + 1;
    if (day.entrainement?.id)
      usages.entr[day.entrainement.id] = (usages.entr[day.entrainement.id] || 0) + 1;
    if (day.mobilite?.id) usages.mob[day.mobilite.id] = (usages.mob[day.mobilite.id] || 0) + 1;
  });
  return usages;
}

function nextId(list, prefix) {
  list = Array.isArray(list) ? list : [];
  let n = 1;
  while (list.some((x) => x.id === prefix + String(n).padStart(2, "0"))) n++;
  return prefix + String(n).padStart(2, "0");
}

async function saveCatalog(catalog) {
  const res = await fetch("/api/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(catalog),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Erreur sauvegarde catalog");
  return res.json();
}

async function updateDay(date, payload) {
  const res = await fetch(`/api/day/${date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Erreur mise à jour du jour");
  return j;
}

// -----------------------
// Onglets
// -----------------------
function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      tab.classList.add("active");
      const view = document.getElementById(tab.dataset.target);
      if (view) view.classList.add("active");
      updateFabVisibility();
    });
  });
}

// -----------------------
// FAB (+)
// -----------------------
// ⬇️ Ajout d'un 3e handler pour l'onglet Mobilité
function initFab(getActiveTabId, addJeu, addEntr, addMob) {
  const fab = document.getElementById("fab");
  if (!fab) return;
  fab.addEventListener("click", () => {
    const active = getActiveTabId();
    if (active === "view-jeux") return addJeu();
    if (active === "view-entrainements") return addEntr();
    if (active === "view-mobilite") return addMob();
  });
}

function updateFabVisibility() {
  const fab = document.getElementById("fab");
  if (!fab) return;
  const activeId = document.querySelector(".view.active")?.id;
  fab.style.display =
    activeId === "view-jeux" ||
      activeId === "view-entrainements" ||
      activeId === "view-mobilite"
      ? "block"
      : "none";
}

// === Rendu SVG (vignette) depuis un diagram JSON du nouvel éditeur ===
function diagramToSVG(model, opts = {}) {
  if (!model || !Array.isArray(model.items)) return "";
  const W = model.width || 1000, H = model.height || 600;

  // Génère les éléments SVG
  const els = model.items.map(item => {
    if (item.type === "plot") {
      const r = item.r ?? 8, c = item.color || "#ef4444";
      return `<circle cx="${item.x}" cy="${item.y}" r="${r}" fill="${c}" />`;
    }
    if (item.type === "cerceau") {
      const r = item.r ?? 18, c = item.color || "#3b82f6";
      return `<circle cx="${item.x}" cy="${item.y}" r="${r}" fill="none" stroke="${c}" stroke-width="3" />`;
    }
    if (item.type === "poteau") {
      const c = item.color || "#10b981";
      return `<rect x="${item.x - 3}" y="${item.y - 20}" width="6" height="40" fill="${c}" />`;
    }
    if (item.type === "echelle") {
      const w = item.w || 120, h = item.h || 40, steps = item.steps || 4, c = item.color || "#f59e0b";
      const x = item.x - w / 2, y = item.y - h / 2;
      let g = `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${c}" stroke-width="2" />`;
      for (let i = 1; i < steps; i++) {
        const lx = x + (w / steps) * i;
        g += `<line x1="${lx}" y1="${y}" x2="${lx}" y2="${y + h}" stroke="${c}" stroke-width="2" />`;
      }
      g += `</g>`;
      return g;
    }
    if (item.type === "fleche") {
      const c = item.color || "#111827";
      return `<defs>
        <marker id="thumbArrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="${c}"></polygon>
        </marker>
      </defs>
      <line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}"
        stroke="${c}" stroke-width="3" marker-end="url(#thumbArrow)"/>`;
    }
    if (item.type === "texte") {
      const c = item.color || "#111827", size = item.size || 14;
      const text = (item.text || "Texte").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<text x="${item.x}" y="${item.y}" fill="${c}" font-size="${size}">${text}</text>`;
    }
    return "";
  }).join("");

  // Option vignette : fond quadrillé léger (comme l’éditeur)
  const showGrid = opts.grid ?? false;
  const grid = showGrid ? `
    <defs>
      <pattern id="gridThumb" width="25" height="25" patternUnits="userSpaceOnUse">
        <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e5e7eb" stroke-width="1"/>
      </pattern>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#gridThumb)"></rect>
  ` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    ${grid}
    ${els}
  </svg>`;
}

function diagramToDataUrl(model, opts = {}) {
  const svg = diagramToSVG(model, opts);
  if (!svg) return "";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// -----------------------
// Grilles éditables (Jeux/Entraînements/Mobilité)
// -----------------------
function renderEditableGrid(containerId, items, typeLabel, idPrefix, catalogRef, calendarRef, rerenderAll) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  items = Array.isArray(items) ? items : [];

  const usages = countUsages(calendarRef());
  const counts =
    typeLabel.includes("Jeu") ? usages.jeux :
      typeLabel.includes("Entrainement") ? usages.entr : usages.mob;

  items.forEach((obj) => {
    const card = document.createElement("div");
    card.className = "item";

    const band = document.createElement("div");
    band.className = "band";
    card.appendChild(band);

    const h = document.createElement("h3");
    h.textContent = obj.nom || "(sans titre)";
    card.appendChild(h);

    const p = document.createElement("p");
    p.textContent = obj.description || "";
    card.appendChild(p);

    const usage = counts[obj.id] || 0;
    const badge = document.createElement("div");
    badge.className = "pill";
    badge.textContent = usage ? `${usage} fois utilisé` : "Jamais utilisé";
    card.appendChild(badge);

    const nom = document.createElement("input");
    nom.value = obj.nom || "";
    nom.placeholder = typeLabel + " nom";
    nom.addEventListener("input", (e) => obj.nom = e.target.value);
    card.appendChild(nom);

    const desc = document.createElement("textarea");
    desc.value = obj.description || "";
    desc.placeholder = "Description";
    desc.addEventListener("input", (e) => obj.description = e.target.value);
    card.appendChild(desc);

    const save = document.createElement("button");
    save.className = "btn";
    save.textContent = "Enregistrer";
    save.onclick = async () => {
      try { await saveCatalog(catalogRef()); rerenderAll(); }
      catch (e) { alert(e.message); }
    };
    card.appendChild(save);

    // Vignette si un diagram est attaché
    if (obj.diagram && typeof obj.diagram === "object") {
      const img = document.createElement("img");
      img.className = "diagram-thumb";
      img.alt = "Diagramme";
      img.src = diagramToDataUrl(obj.diagram, { grid: false }); // grid:true si tu veux le quadrillage
      card.appendChild(img);
    }

    container.appendChild(card);
  });
}

// -----------------------
// Modale Chooser (réutilisable)
// -----------------------
function ensureChooserDom() {
  if (document.getElementById("chooser")) return;
  const el = document.createElement("div");
  el.innerHTML = `
  <div class="modal" id="chooser" style="display:none;">
    <div class="modal-card">
      <div class="modal-head" style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
        <strong id="chooser-title">Choisir</strong>
        <input id="chooser-search" placeholder="Rechercher..." />
        <button class="btn" id="chooser-close">Fermer</button>
      </div>
      <div class="grid" id="chooser-grid"></div>
    </div>
  </div>`;
  document.body.appendChild(el.firstElementChild);
}

function openChooser(title, items, onChoose) {
  ensureChooserDom();

  const modal = document.getElementById("chooser");
  const titleEl = document.getElementById("chooser-title");
  const grid = document.getElementById("chooser-grid");
  const search = document.getElementById("chooser-search");
  const closeBtn = document.getElementById("chooser-close");

  titleEl.textContent = title;
  grid.innerHTML = "";
  search.value = "";

  const render = (q = "") => {
    grid.innerHTML = "";
    const ql = q.trim().toLowerCase();
    (Array.isArray(items) ? items : [])
      .filter(x => !ql || x.nom.toLowerCase().includes(ql) || x.description.toLowerCase().includes(ql))
      .forEach(x => {
        const card = document.createElement("div");
        card.className = "item";
        card.innerHTML = `
          <div class="band"></div>
          <h3>${x.nom}</h3>
          <p>${x.description}</p>
        `;
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "Choisir";
        btn.onclick = () => { close(); onChoose(x); };
        card.appendChild(btn);
        grid.appendChild(card);
      });
  };

  function close() { modal.classList.remove("show"); modal.style.display = "none"; }
  closeBtn.onclick = close;
  search.oninput = () => render(search.value);

  render();
  modal.style.display = "flex";
  modal.classList.add("show");
}

// -----------------------
// Carte du jour (avec Mobilité)
// -----------------------
function renderDayCard(it, calendar, catalog, usages, rerenderAll) {
  const card = document.createElement("div");
  card.className = "card";

  const h = document.createElement("h2");
  const dateStr = new Date(it.date).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  h.textContent = dateStr;
  card.appendChild(h);

  // Annulé
  if (it.cancelled?.is) {
    const p = document.createElement("p");
    p.textContent = "Séance annulée (" + (it.cancelled.reason || "raison inconnue") + ")";
    card.appendChild(p);
    return card;
  }

  const isTraining = (it.weekday === "mercredi") || (it.weekday === "samedi" && it.type === "entrainement");

  if (!isTraining) {
    const p = document.createElement("p");
    p.textContent = it.weekday === "samedi" ? `Samedi : ${it.type || "libre"}` : "Aucune séance";
    card.appendChild(p);

    if (it.weekday === "samedi") {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Basculer en entraînement";
      btn.onclick = async () => {
        try { const { calendar: cal } = await updateDay(it.date, { type: "entrainement" }); rerenderAll(cal); }
        catch (e) { alert(e.message); }
      };
      card.appendChild(btn);
    }
    return card;
  }

  // Section Echauffement
  const ech = document.createElement("div");
  ech.className = "block t-echauffement";
  ech.innerHTML = `
    <div class="band"></div>
    <h3>Echauffement</h3>
  `;
  card.appendChild(ech);

  // Section Mobilité
  const mob = document.createElement("div");
  mob.className = "block t-mobilite";
  mob.innerHTML = `
    <div class="band"></div>
    <h3>Mobilité</h3>
    <p>${it.mobilite?.nom ? it.mobilite.nom : "<i>non défini</i>"}</p>
  `;
  const btnMob = document.createElement("button");
  btnMob.className = "btn";
  btnMob.textContent = "Choisir mobilité";
  btnMob.onclick = () => {
    const list = (catalog && Array.isArray(catalog.mobilite)) ? catalog.mobilite : [];
    if (!list.length) return alert("Aucun exercice de mobilité dans le catalogue.");
    openChooser("Choisir une mobilité", list, async (x) => {
      try {
        const payload = { mobiliteId: x.id };
        if (it.weekday === "samedi" && it.type !== "entrainement") payload.type = "entrainement";
        const { calendar: cal } = await updateDay(it.date, payload);
        rerenderAll(cal);
      } catch (e) { alert(e.message); }
    });
  };
  mob.appendChild(btnMob);

  // thumb Mobilité si dispo
  if (it.mobilite?.diagram) {
    const img = document.createElement("img");
    img.className = "diagram-thumb";
    img.alt = "Diagramme Mobilité";
    img.src = diagramToDataUrl(it.mobilite.diagram, { grid: false });
    mob.appendChild(img);
  }

  card.appendChild(mob);

  // Section Entrainement individuel
  const ind = document.createElement("div");
  ind.className = "block t-individuel";
  ind.innerHTML = `
    <div class="band"></div>
    <h3>Entrainement individuel</h3>
    <p>${it.entrainement?.nom ? it.entrainement.nom : "<i>non défini</i>"}</p>
  `;
  const btnInd = document.createElement("button");
  btnInd.className = "btn";
  btnInd.textContent = "Choisir entraînement";
  btnInd.onclick = () => {
    const list = (catalog && Array.isArray(catalog.entrainements)) ? catalog.entrainements : [];
    if (!list.length) return alert("Aucun entraînement individuel dans le catalogue.");
    openChooser("Choisir un entraînement", list, async (x) => {
      try {
        const payload = { entrainementId: x.id };
        if (it.weekday === "samedi" && it.type !== "entrainement") payload.type = "entrainement";
        const { calendar: cal } = await updateDay(it.date, payload);
        rerenderAll(cal);
      } catch (e) { alert(e.message); }
    });
  };
  ind.appendChild(btnInd);

  if (it.entrainement?.diagram) {
    const img = document.createElement("img");
    img.className = "diagram-thumb";
    img.alt = "Diagramme Entrainement";
    img.src = diagramToDataUrl(it.entrainement.diagram, { grid: false });
    ind.appendChild(img);
  }

  card.appendChild(ind);

  // Section tactique
  const tactic = document.createElement("div");
  tactic.className = "block t-tactique";
  tactic.innerHTML = `
    <div class="band"></div>
    <h3>Tactique</h3>
  `;
  card.appendChild(tactic);

  // Section Jeu collectif
  const jeu = document.createElement("div");
  jeu.className = "block t-jeu";
  jeu.innerHTML = `
    <div class="band"></div>
    <h3>Jeu collectif</h3>
    <p>${it.jeu?.nom ? it.jeu.nom : "<i>non défini</i>"}</p>
  `;
  const btnJeu = document.createElement("button");
  btnJeu.className = "btn";
  btnJeu.textContent = "Choisir jeu";
  btnJeu.onclick = () => {
    const list = (catalog && Array.isArray(catalog.jeuxFoot)) ? catalog.jeuxFoot : [];
    if (!list.length) return alert("Aucun jeu collectif dans le catalogue.");
    openChooser("Choisir un jeu", list, async (x) => {
      try {
        const payload = { jeuId: x.id };
        if (it.weekday === "samedi" && it.type !== "entrainement") payload.type = "entrainement";
        const { calendar: cal } = await updateDay(it.date, payload);
        rerenderAll(cal);
      } catch (e) { alert(e.message); }
    });
  };
  jeu.appendChild(btnJeu);

  if (it.jeu?.diagram) {
    const img = document.createElement("img");
    img.className = "diagram-thumb";
    img.alt = "Diagramme Jeu";
    img.src = diagramToDataUrl(it.jeu.diagram, { grid: false });
    jeu.appendChild(img);
  }

  card.appendChild(jeu);

  // Section Match
  const match = document.createElement("div");
  match.className = "block t-match";
  match.innerHTML = `
    <div class="band"></div>
    <h3>Match</h3>
  `;
  card.appendChild(match);

  return card;
}

// -----------------------
// Calendrier (mois + icônes)
// -----------------------
function isTrainingDay(item) {
  if (item.cancelled?.is) return false;
  if (item.weekday === "mercredi") return true;
  if (item.weekday === "samedi") return item.type === "entrainement";
  return false;
}

function monthLabel(y, m0) {
  return new Date(Date.UTC(y, m0, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}
function startOfMonth(y, m0) { return new Date(Date.UTC(y, m0, 1)); }
function endOfMonth(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)); }
function toIsoUTC(d) { return d.toISOString().slice(0, 10); }

function buildMonthCells(year, month0) {
  const first = startOfMonth(year, month0);
  const last = endOfMonth(year, month0);
  let wd = first.getUTCDay(); if (wd === 0) wd = 7;
  const offsetDays = wd - 1;
  const start = new Date(first.getTime() - offsetDays * 24 * 3600 * 1000);
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(start.getTime() + i * 24 * 3600 * 1000));
  return { cells, first, last };
}

function renderCalendar(calendar, catalog, rerenderAll, state) {
  const calendarEl = document.getElementById("calendar");
  const titleEl = document.getElementById("cal-title");
  const dayPane = document.getElementById("day-pane-content");
  if (!calendarEl || !titleEl || !dayPane) return;

  const [year, month0] = state.currentYM;
  titleEl.textContent = monthLabel(year, month0);

  const { cells, first, last } = buildMonthCells(year, month0);
  const byDate = new Map();
  (calendar.items || []).forEach((x) => byDate.set(x.date, x));

  if (!state.selectedDate) {
    const today = todayIso();
    const inRange = (dIso) => {
      const d = new Date(dIso + "T00:00:00Z");
      return d >= first && d <= last;
    };
    state.selectedDate = inRange(today) ? today : toIsoUTC(first);
  }

  Array.from(calendarEl.querySelectorAll(".cal-cell")).forEach((n) => n.remove());

  const usages = countUsages(calendar);

  cells.forEach((d) => {
    const iso = toIsoUTC(d);
    const isOut = d < first || d > last;

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (isOut) cell.classList.add("cal-out");
    if (iso === todayIso()) cell.classList.add("cal-today");
    if (iso === state.selectedDate) cell.classList.add("cal-selected");

    const dayNum = document.createElement("div");
    dayNum.className = "cal-daynum";
    dayNum.textContent = d.getUTCDate();
    cell.appendChild(dayNum);

    const item = byDate.get(iso);
    if (item) {
      const icon = document.createElement("div");
      icon.className = "cal-icon";
      if (item.cancelled?.is) {
        cell.classList.add("cal-cancelled"); icon.textContent = "🚫";
      } else if (item.weekday === "mercredi" || (item.weekday === "samedi" && item.type === "entrainement")) {
        cell.classList.add("cal-training"); icon.textContent = "⚽";
      } else if (item.weekday === "samedi" && item.type === "plateau") {
        icon.textContent = "🏟️";
      } else if (item.weekday === "samedi" && item.type === "libre") {
        icon.textContent = "💤";
      }
      cell.appendChild(icon);
    }

    cell.addEventListener("click", () => {
      state.selectedDate = iso;
      renderCalendar(calendar, catalog, rerenderAll, state);
      dayPane.innerHTML = "";
      if (item) {
        const card = renderDayCard(item, calendar, catalog, usages, (cal) => {
          rerenderAll(cal);
          const updated = (cal.items || []).find(x => x.date === state.selectedDate);
          dayPane.innerHTML = "";
          if (updated) {
            const usages2 = countUsages(cal);
            dayPane.appendChild(renderDayCard(updated, cal, catalog, usages2, rerenderAll));
          }
          renderCalendar(cal, catalog, rerenderAll, state);
        });
        dayPane.appendChild(card);
      } else {
        const p = document.createElement("p");
        p.textContent = "Aucune séance ce jour.";
        dayPane.appendChild(p);
      }
    });

    calendarEl.appendChild(cell);
  });

  const selectedItem = byDate.get(state.selectedDate);
  dayPane.innerHTML = "";
  if (selectedItem) {
    const card = renderDayCard(selectedItem, calendar, catalog, usages, (cal) => {
      rerenderAll(cal);
      const updated = (cal.items || []).find(x => x.date === state.selectedDate);
      dayPane.innerHTML = "";
      if (updated) {
        const usages2 = countUsages(cal);
        dayPane.appendChild(renderDayCard(updated, cal, catalog, usages2, rerenderAll));
      }
      renderCalendar(cal, catalog, rerenderAll, state);
    });
    dayPane.appendChild(card);
  } else {
    const p = document.createElement("p");
    p.textContent = "Aucune séance ce jour.";
    dayPane.appendChild(p);
  }
}

function openEditorModal() {
  const m = document.getElementById("editor-modal");
  m.style.display = "flex";
  m.classList.add("show");
}
function closeEditorModal() {
  const m = document.getElementById("editor-modal");
  m.classList.remove("show");
  m.style.display = "none";
}
document.getElementById("ed-close")?.addEventListener("click", closeEditorModal);

function openEditorForItem(kind, item, catalog, afterSave) {
  // Pré-remplir catégorie
  const kindSel = document.getElementById("ex-kind");
  if (kindSel) {
    kindSel.value = kind; // "jeux" | "entr" | "mob"
  }

  // Pré-remplir nom/desc
  const exName = document.getElementById("ex-name");
  const exDesc = document.getElementById("ex-desc");
  if (exName) exName.value = item.nom || "";
  if (exDesc) exDesc.value = item.description || "";

  // Charger le diagramme (avec nom/desc initialisés)
  if (typeof window.editorLoadExercise === "function") {
    window.editorLoadExercise({
      kind,                         // catégorie actuelle
      id: item.id,                  // id de l'exercice
      name: item.nom || "",
      description: item.description || "",
      diagram: item.diagram || { width: 1000, height: 600, items: [] }
    });
  }

  // Ouvrir la modale
  const m = document.getElementById("editor-modal");
  m.style.display = "flex";
  m.classList.add("show");
}

function renderExercisesList(catalog, category, calendar, rerenderAll) {
  const listEl = document.getElementById("ex-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const usages = countUsages(calendar);
  const arr = category === "jeux" ? (catalog.jeuxFoot || [])
    : category === "entr" ? (catalog.entrainements || [])
      : (catalog.mobilite || []);
  // on garde exactement les clés: "jeux" | "entr" | "mob"
  const kind = category;
  const usageMap = category === "jeux" ? usages.jeux : category === "entr" ? usages.entr : usages.mob;

  arr.forEach((obj) => {
    const card = document.createElement("div");
    card.className = "card-ex";

    // thumb
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb";
    const img = document.createElement("img");
    img.className = "diagram-thumb";
    img.alt = "Diagramme";
    img.src = obj.diagram ? diagramToDataUrl(obj.diagram, { grid: false }) : "";
    if (!obj.diagram) img.style.display = "none";
    thumbWrap.appendChild(img);
    card.appendChild(thumbWrap);

    // body
    const body = document.createElement("div");
    body.className = "body";
    const h3 = document.createElement("h3");
    h3.textContent = obj.nom || "(Sans titre)";
    const p = document.createElement("p");
    p.textContent = obj.description || "";
    const badge = document.createElement("div");
    badge.className = "pill";
    const c = usageMap[obj.id] || 0;
    badge.textContent = c ? `${c} fois utilisé` : "Jamais utilisé";
    body.appendChild(h3);
    body.appendChild(p);
    body.appendChild(badge);
    card.appendChild(body);

    // actions
    const actions = document.createElement("div");
    actions.className = "actions";
    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.textContent = "Modifier";
    btnEdit.onclick = () => openEditorForItem(kind, obj, catalog, () => {
      // option : callback post-save
      renderExercisesList(catalog, category, calendar, rerenderAll);
    });

    const btnDel = document.createElement("button");
    btnDel.className = "btn danger";
    btnDel.textContent = "Supprimer";
    btnDel.onclick = async () => {
      const used = usageMap[obj.id] || 0;
      const ok = confirm(
        used
          ? `Cet exercice est utilisé ${used} fois dans le planning.\nLe supprimer du catalogue n’affectera pas les séances déjà planifiées.\nConfirmer la suppression ?`
          : "Supprimer cet exercice du catalogue ?"
      );
      if (!ok) return;

      // ⚠️ suppression dans la bonne liste en fonction de "kind"
      if (kind === "jeux") {
        catalog.jeuxFoot = (catalog.jeuxFoot || []).filter(x => x.id !== obj.id);
      } else if (kind === "entr") {
        catalog.entrainements = (catalog.entrainements || []).filter(x => x.id !== obj.id);
      } else if (kind === "mob") {
        catalog.mobilite = (catalog.mobilite || []).filter(x => x.id !== obj.id);
      }

      try {
        // 1) Sauvegarde
        const r = await fetch("/api/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
          body: JSON.stringify(catalog),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Échec de la sauvegarde");
        }

        // 2) Recharger un catalog frais (anti-cache) et rerendre
        const r2 = await fetch("/api/catalog", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (r2.ok) {
          const fresh = await r2.json();
          // remplace la référence globale et rerend (comme pour l’éditeur)
          if (typeof window.__setCatalogFromEditor === "function") {
            window.__setCatalogFromEditor(fresh);
          } else {
            catalog = fresh;
            renderExercisesList(catalog, category, calendar, rerenderAll);
          }
        } else {
          // fallback : rerendre à partir de l'objet local
          renderExercisesList(catalog, category, calendar, rerenderAll);
        }
      } catch (e) {
        alert(e.message);
      }
    };

    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);
    card.appendChild(actions);

    listEl.appendChild(card);
  });

  if (arr.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Aucun exercice dans cette catégorie.";
    listEl.appendChild(empty);
  }
}

// -----------------------
// Bootstrap
// -----------------------
(async function () {
  initTabs();

  const [calRes, catRes] = await Promise.allSettled([
    fetch("/api/calendar"),
    fetch("/api/catalog"),
  ]);

  let calendar = { items: [] };
  if (calRes.status === "fulfilled" && calRes.value.ok) {
    calendar = await calRes.value.json();
  }

  let catalog = { jeuxFoot: [], entrainements: [], mobilite: [] };
  if (catRes.status === "fulfilled" && catRes.value.ok) {
    catalog = await catRes.value.json();
  } else {
    console.warn("Catalogue absent : ajoutez des éléments puis enregistrez.");
  }

  const calendarRef = () => calendar;
  const catalogRef = () => catalog;

  const state = {
    currentYM: [new Date().getUTCFullYear(), new Date().getUTCMonth()],
    selectedDate: null,
  };

  const rerenderAll = (newCalendar) => {
    if (newCalendar) calendar = newCalendar;
    renderCalendar(
      calendar || { items: [] },
      catalog || { jeuxFoot: [], entrainements: [], mobilite: [] },
      rerenderAll,
      state
    );
    // Vue Exercices : on rend selon la catégorie courante
    const catSel = document.getElementById("ex-cat");
    const cat = catSel ? catSel.value : "jeux";
    renderExercisesList(catalog, cat, calendar, rerenderAll);
  };


  document.getElementById("ex-cat")?.addEventListener("change", (e) => {
    renderExercisesList(catalog, e.target.value, calendar, rerenderAll);
  });

  // Quand on clique l’onglet Exercices, on rerend la liste
  document.querySelector('.tab[data-target="view-exercices"]')?.addEventListener("click", () => {
    const cat = document.getElementById("ex-cat")?.value || "jeux";
    renderExercisesList(catalog, cat, calendar, rerenderAll);
  });

  // (option) cache le FAB s'il existe
  function updateFabVisibility() {
    const fab = document.getElementById("fab");
    if (!fab) return;
    const activeId = document.querySelector(".view.active")?.id;
    fab.style.display = "none"; // plus de création via FAB dans cette UI
  }


  // Navigation mois
  const prevBtn = document.getElementById("cal-prev");
  const nextBtn = document.getElementById("cal-next");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    let [y, m0] = state.currentYM; m0 -= 1; if (m0 < 0) { m0 = 11; y -= 1; }
    state.currentYM = [y, m0]; renderCalendar(calendar, catalog, rerenderAll, state);
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    let [y, m0] = state.currentYM; m0 += 1; if (m0 > 11) { m0 = 0; y += 1; }
    state.currentYM = [y, m0]; renderCalendar(calendar, catalog, rerenderAll, state);
  });

  // Premier rendu
  rerenderAll(calendar);

  // FAB (+) – visible sur les 3 listes
  const getActiveTabId = () => (document.querySelector(".view.active")?.id || "view-planning");
  const addJeu = async () => {
    const id = nextId(catalog.jeuxFoot, "J");
    catalog.jeuxFoot.push({ id, nom: "", description: "", materiel: [] });
    try { await saveCatalog(catalog); rerenderAll(); document.querySelector('.tab[data-target="view-jeux"]')?.click(); }
    catch (e) { alert("Erreur: " + e.message); }
  };
  const addEntr = async () => {
    const id = nextId(catalog.entrainements, "E");
    catalog.entrainements.push({ id, nom: "", description: "", materiel: [] });
    try { await saveCatalog(catalog); rerenderAll(); document.querySelector('.tab[data-target="view-entrainements"]')?.click(); }
    catch (e) { alert("Erreur: " + e.message); }
  };
  // 🆕 Ajout d'un item Mobilité
  const addMob = async () => {
    catalog.mobilite = Array.isArray(catalog.mobilite) ? catalog.mobilite : [];
    const id = nextId(catalog.mobilite, "M");
    catalog.mobilite.push({ id, nom: "", description: "", materiel: [] });
    try { await saveCatalog(catalog); rerenderAll(); document.querySelector('.tab[data-target="view-mobilite"]')?.click(); }
    catch (e) { alert("Erreur: " + e.message); }
  };

  initFab(getActiveTabId, addJeu, addEntr, addMob);
  updateFabVisibility();

  // Permet à editor.js de pousser le catalog fraîchement sauvegardé
  window.__setCatalogFromEditor = (fresh) => {
    try {
      catalog = fresh;                 // ⚠️ remplacer la référence
      const isEx = document.getElementById("view-exercices")?.classList.contains("active");
      const catSel = document.getElementById("ex-cat");
      const cat = catSel ? catSel.value : "jeux";
      if (isEx) renderExercisesList(catalog, cat, calendar, rerenderAll);
      // rafraîchir aussi le planning pour les vignettes éventuelles
      rerenderAll(calendar);
    } catch (e) {
      console.warn("Refresh catalog after editor save failed:", e);
    }
  };
})();
