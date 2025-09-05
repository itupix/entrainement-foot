// ---- Tabs ----
function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const views = Array.from(document.querySelectorAll(".view"));
  function activate(id) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.target === id));
    views.forEach(v => v.classList.toggle("active", v.id === id));
    document.getElementById("fab-menu").classList.remove("show");
    updateFabVisibility();
  }
  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.target)));
}

// FAB visibility: only show on list tabs (jeux/entrainements)
function updateFabVisibility() {
  const activeId = document.querySelector(".view.active")?.id;
  const fab = document.getElementById("fab");
  const menu = document.getElementById("fab-menu");
  const show = activeId === "view-jeux" || activeId === "view-entrainements";
  if (!show) menu.classList.remove("show");
  fab.style.display = show ? "flex" : "none";
}

// ---- Helpers ----
const toDateLabel = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

function renderBadges(container, list) {
  const div = document.createElement("div");
  div.className = "badges";
  if (list && list.length) {
    list.forEach(m => {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = m;
      div.appendChild(b);
    });
  } else {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = "Aucun matériel spécifique";
    div.appendChild(b);
  }
  container.appendChild(div);
}

function countUsages(calendar) {
  const counts = { jeux: new Map(), entr: new Map() };
  (calendar.items || []).forEach(it => {
    if (it.jeu?.id) counts.jeux.set(it.jeu.id, (counts.jeux.get(it.jeu.id) || 0) + 1);
    if (it.entrainement?.id) counts.entr.set(it.entrainement.id, (counts.entr.get(it.entrainement.id) || 0) + 1);
  });
  return counts;
}

async function updateDay(date, payload) {
  const res = await fetch(`/api/day/${date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Erreur serveur");
  return data.calendar;
}

// ---- Planning (liste) ----
function renderPlanning(calendar, catalog, rerenderAll) {
  const stack = document.getElementById("stack");
  stack.innerHTML = "";

  const usages = countUsages(calendar);

  calendar.items.forEach((it) => {
    const card = renderDayCard(it, calendar, catalog, usages, rerenderAll);
    stack.appendChild(card);
  });
}

// ---- Calendrier mensuel ----
function monthLabel(y, mZeroBased) {
  return new Date(Date.UTC(y, mZeroBased, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}
function startOfMonth(y, m0) { return new Date(Date.UTC(y, m0, 1)); }
function endOfMonth(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)); }
function toIsoUTC(d) { return d.toISOString().slice(0, 10); }

// Construit les 42 cellules (6 lignes x 7 colonnes) pour un mois, en commençant un LUNDI
function buildMonthCells(year, month0) {
  const first = startOfMonth(year, month0);
  const last = endOfMonth(year, month0);

  // JS: 0=Dim...6=Sam | On veut 1=Lun..7=Dim
  let wd = first.getUTCDay(); if (wd === 0) wd = 7;
  const offsetDays = wd - 1; // nb de jours à remonter pour tomber sur lundi

  const start = new Date(first.getTime() - offsetDays * 24 * 3600 * 1000);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 24 * 3600 * 1000);
    cells.push(d);
  }
  return { cells, first, last };
}

// État de sélection persisté (facultatif mais sympa)
const LS_MODE = "planningMode"; // on peut le laisser au cas où
const LS_SELECTED = "calendarSelectedDate";
const LS_YEARMONTH = "calendarYearMonth";

function saveYM(y, m0) { localStorage.setItem(LS_YEARMONTH, JSON.stringify([y, m0])); }
function loadYM() {
  try { const v = JSON.parse(localStorage.getItem(LS_YEARMONTH)); if (Array.isArray(v) && v.length === 2) return v; } catch { }
  const now = new Date(); return [now.getUTCFullYear(), now.getUTCMonth()];
}

function renderCalendar(calendar, catalog, rerenderAll, state) {
  const calendarEl = document.getElementById("calendar");
  const titleEl = document.getElementById("cal-title");
  const dayPane = document.getElementById("day-pane-content");

  // état
  const [year, month0] = state.currentYM;
  titleEl.textContent = monthLabel(year, month0);

  // construire les cellules
  const { cells, first, last } = buildMonthCells(year, month0);

  // indexation des items par date
  const byDate = new Map();
  (calendar.items || []).forEach(x => byDate.set(x.date, x));

  // sélection par défaut: aujourd'hui si dans mois courant, sinon 1er du mois
  if (!state.selectedDate) {
    const today = todayIso();
    const inRange = (dIso) => {
      const d = new Date(dIso + "T00:00:00Z");
      return d >= startOfMonth(year, month0) && d <= endOfMonth(year, month0);
    };
    state.selectedDate = inRange(today) ? today : toIsoUTC(first);
  }

  // Dessin
  // On enlève les anciennes cellules (en gardant les headers)
  // headers = 7 .cal-header déjà dans le HTML
  // donc on supprime tout ce qui suit
  Array.from(calendarEl.querySelectorAll(".cal-cell")).forEach(n => n.remove());

  const usages = countUsages(calendar);

  cells.forEach(d => {
    const iso = toIsoUTC(d);
    const isOut = (d < first || d > last);

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (isOut) cell.classList.add("cal-out");
    if (iso === todayIso()) cell.classList.add("cal-today");
    if (iso === state.selectedDate) cell.classList.add("cal-selected");

    // infos
    const dayNum = document.createElement("div");
    dayNum.className = "cal-daynum";
    dayNum.textContent = d.getUTCDate();
    cell.appendChild(dayNum);

    const item = byDate.get(iso);
    if (item) {
      const icon = document.createElement("div");
      icon.className = "cal-icon";

      if (item.cancelled?.is) {
        cell.classList.add("cal-cancelled");
        icon.textContent = "🚫";
      } else if (item.weekday === "mercredi" || (item.weekday === "samedi" && item.type === "entrainement")) {
        cell.classList.add("cal-training");
        icon.textContent = "⚽";
      } else if (item.weekday === "samedi" && item.type === "plateau") {
        icon.textContent = "🏟️";
      } else if (item.weekday === "samedi" && item.type === "libre") {
        icon.textContent = "💤";
      }

      cell.appendChild(icon);
    }

    cell.addEventListener("click", () => {
      state.selectedDate = iso;
      localStorage.setItem(LS_SELECTED, state.selectedDate);
      renderCalendar(calendar, catalog, rerenderAll, state);
      // panneau droit
      dayPane.innerHTML = "";
      if (item) {
        const card = renderDayCard(item, calendar, catalog, usages, (cal) => {
          rerenderAll(cal);
          // après mutation, re-rendre panneau (pour garder la date en cours)
          const updated = (cal.items || []).find(x => x.date === state.selectedDate);
          dayPane.innerHTML = "";
          if (updated) {
            const usages2 = countUsages(cal);
            dayPane.appendChild(renderDayCard(updated, cal, catalog, usages2, rerenderAll));
          }
          // et le calendrier (pour badges/annulation)
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

  // panneau droit au premier rendu / au changement de mois
  const selectedItem = byDate.get(state.selectedDate);
  dayPane.innerHTML = "";
  if (selectedItem) {
    const card = renderDayCard(selectedItem, calendar, catalog, usages, (cal) => {
      rerenderAll(cal);
      // rafraîchir panneau et calendrier après action
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

// ---- Rendu d’une carte de jour (réutilisé par vue liste ET vue jour) ----
function renderDayCard(it, calendar, catalog, usages, rerenderAll) {
  const card = document.createElement("div");
  card.className = "card";

  // Annulation
  const cancelControls = document.createElement("div");
  cancelControls.className = "typebar";
  const cancelSelect = document.createElement("select");
  ["", "climat", "absence", "vacances"].forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v ? `Raison: ${v}` : "Raison…";
    cancelSelect.appendChild(opt);
  });
  cancelSelect.value = it.cancelled?.reason || "";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = it.cancelled?.is ? "Retirer l'annulation" : "Annuler cette séance";
  cancelBtn.addEventListener("click", async () => {
    try {
      const nextIs = !it.cancelled?.is;
      const reason = nextIs ? (cancelSelect.value || "climat") : null;
      const cal = await updateDay(it.date, { cancelled: { is: nextIs, reason } });
      rerenderAll(cal);
    } catch (e) { alert(e.message || e); }
  });

  cancelControls.appendChild(cancelBtn);
  cancelControls.appendChild(cancelSelect);
  if (it.cancelled?.is) {
    const cancelBadge = document.createElement("div");
    cancelBadge.className = "cancel";
    cancelBadge.textContent = `Séance annulée (${it.cancelled.reason})`;
    card.appendChild(cancelBadge);
  }
  card.appendChild(cancelControls);

  // Date
  const dateEl = document.createElement("div");
  dateEl.className = "date";
  dateEl.textContent = toDateLabel(it.date) + (it.weekday === "samedi" ? " • Samedi" : "");
  card.appendChild(dateEl);

  // Samedi: type & lieu
  if (it.weekday === "samedi") {
    const typeBar = document.createElement("div");
    typeBar.className = "typebar";
    const pill = document.createElement("span");
    pill.className = "pill-type";
    pill.textContent = `Type: ${it.type}`;
    typeBar.appendChild(pill);

    ["entrainement", "plateau", "libre"].forEach(t => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      b.disabled = it.type === t;
      b.addEventListener("click", async () => {
        try {
          const cal = await updateDay(it.date, { type: t });
          rerenderAll(cal);
        } catch (e) { alert(e.message || e); }
      });
      typeBar.appendChild(b);
    });

    if (it.type === "plateau") {
      const lieuInput = document.createElement("input");
      lieuInput.className = "lieu-input";
      lieuInput.placeholder = "Lieu du plateau…";
      lieuInput.value = it.samedi?.lieu || "";
      const saveLieu = document.createElement("button");
      saveLieu.className = "btn";
      saveLieu.textContent = "Enregistrer le lieu";
      saveLieu.addEventListener("click", async () => {
        try {
          const cal = await updateDay(it.date, { samedi: { lieu: lieuInput.value } });
          rerenderAll(cal);
        } catch (e) { alert(e.message || e); }
      });
      typeBar.appendChild(lieuInput);
      typeBar.appendChild(saveLieu);
    }

    card.appendChild(typeBar);
  }

  // Plan + Choisir jeu/exo si entrainement
  const planEl = document.createElement("div");
  planEl.className = "plan";

  const steps = Array.isArray(it.plan) ? it.plan : [];
  if (steps.length === 0) {
    const p = document.createElement("p");
    p.textContent = it.weekday === "samedi" && it.type === "entrainement"
      ? "Plan non initialisé — choisissez un jeu ou un entraînement."
      : "Aucun plan pour ce jour.";
    planEl.appendChild(p);
  }
  steps.forEach((s, idx) => {
    const block = document.createElement("div");
    block.className = `block t-${s.type}`;
    const band = document.createElement("div");
    band.className = "band";
    block.appendChild(band);

    const h3 = document.createElement("h3");
    const leftTitle = document.createElement("span");
    leftTitle.textContent = `${s.label} • ${s.minutes} min`;
    const rightBtns = document.createElement("span");

    const canChoose = (it.weekday === "mercredi" || (it.weekday === "samedi" && it.type === "entrainement"));

    if (canChoose && s.type === "individuel") {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Choisir l'entraînement";
      btn.addEventListener("click", () => openChooser({
        kind: "entr", date: it.date, catalog, calendar, usages, rerenderAll
      }));
      rightBtns.appendChild(btn);
    }
    if (canChoose && s.type === "jeu") {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Choisir le jeu";
      btn.addEventListener("click", () => openChooser({
        kind: "jeux", date: it.date, catalog, calendar, usages, rerenderAll
      }));
      rightBtns.appendChild(btn);
    }

    h3.appendChild(leftTitle);
    h3.appendChild(rightBtns);

    const p = document.createElement("p");
    if (s.type === "individuel" || s.type === "jeu") {
      const t = s.details;
      p.innerHTML = `<strong>${t.nom}</strong> — ${t.description}`;
    } else {
      p.textContent = s.details.description;
    }

    block.appendChild(h3);
    block.appendChild(p);
    renderBadges(block, s.details.materiel);
    planEl.appendChild(block);

    if (idx < it.plan.length - 1) {
      const pause = document.createElement("div");
      pause.className = "pause";
      pause.textContent = "Pause (5 min)";
      planEl.appendChild(pause);
    }
  });

  card.appendChild(planEl);
  return card;
}

// ---- Modal chooser (inchangé) ----
function openChooser({ kind, date, catalog, calendar, usages, rerenderAll }) {
  const modal = document.getElementById("chooser");
  const title = document.getElementById("chooser-title");
  const search = document.getElementById("chooser-search");
  const grid = document.getElementById("chooser-grid");
  const closeBtn = document.getElementById("chooser-close");

  title.textContent = kind === "jeux" ? "Choisir un jeu collectif" : "Choisir un entrainement individuel";
  modal.classList.add("show");
  search.value = "";
  grid.innerHTML = "";

  const list = kind === "jeux" ? (catalog.jeuxFoot || []) : (catalog.entrainements || []);
  const counts = kind === "jeux" ? usages.jeux : usages.entr;

  function render() {
    grid.innerHTML = "";
    const q = search.value.trim().toLowerCase();
    list
      .filter(it => !q || it.id.toLowerCase().includes(q) || it.nom.toLowerCase().includes(q) || it.description.toLowerCase().includes(q))
      .forEach(obj => {
        const wrap = document.createElement("div");
        wrap.className = "item";
        if (!counts.get(obj.id)) wrap.classList.add("unused");

        const band = document.createElement("div");
        band.className = "band " + (kind === "jeux" ? "t-jeu" : "t-individuel");
        band.style.width = "6px"; band.style.position = "absolute"; band.style.left = "0"; band.style.top = "0"; band.style.bottom = "0";
        wrap.appendChild(band);

        const pill = document.createElement("div");
        pill.className = "pill";
        pill.textContent = kind === "jeux" ? "Jeu collectif" : "Entrainement individuel";

        const h3 = document.createElement("h3");
        const left = document.createElement("span");
        left.textContent = `${obj.nom} (${obj.id})`;
        const right = document.createElement("span");
        right.className = "count";
        right.textContent = `${counts.get(obj.id) || 0} utilisation(s)`;
        h3.appendChild(left);
        h3.appendChild(right);

        const p = document.createElement("p");
        p.textContent = obj.description;

        const select = document.createElement("button");
        select.className = "btn primary select-btn";
        select.textContent = "Choisir";
        select.addEventListener("click", async () => {
          try {
            const payload = kind === "jeux" ? { jeuId: obj.id } : { entrainementId: obj.id };
            const res = await fetch(`/api/day/${date}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || "Erreur serveur");
            rerenderAll(data.calendar);
            modal.classList.remove("show");
          } catch (e) { alert("Impossible de mettre à jour le jour: " + (e?.message || e)); }
        });

        wrap.appendChild(pill);
        wrap.appendChild(h3);
        wrap.appendChild(p);
        renderBadges(wrap, obj.materiel);
        wrap.appendChild(select);
        grid.appendChild(wrap);
      });
  }

  render();
  search.oninput = render;
  closeBtn.onclick = () => modal.classList.remove("show");
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("show"); };
}

// ---------- Catalog (édition par item) ----------
function csvToArray(s) { return (s || "").split(",").map(x => x.trim()).filter(Boolean); }
function arrayToCsv(a) { return (a || []).join(", "); }
function nextId(existing, prefix) {
  let max = 0;
  existing.forEach(it => {
    const m = String(it.id || "").match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1].toUpperCase().startsWith(prefix.toUpperCase())) {
      max = Math.max(max, parseInt(m[2], 10));
    }
  });
  const num = String(max + 1).padStart(2, "0");
  return prefix.toUpperCase() + num;
}
async function saveCatalog(catalog) {
  const res = await fetch("/api/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(catalog)
  });
  if (!res.ok) throw new Error(await res.text());
  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.error || "Échec serveur");
}

function makeReadCard(obj, typeLabel, count, onEdit, onDelete) {
  const wrap = document.createElement("div"); wrap.className = "item";
  if (!count) wrap.classList.add("unused");
  const band = document.createElement("div");
  band.className = `band ${typeLabel.includes("Jeu") ? "t-jeu" : "t-individuel"}`;
  band.style.width = "6px"; band.style.position = "absolute"; band.style.left = "0"; band.style.top = "0"; band.style.bottom = "0";
  wrap.appendChild(band);

  const pill = document.createElement("div"); pill.className = "pill"; pill.textContent = typeLabel;
  const h3 = document.createElement("h3");
  const left = document.createElement("span"); left.textContent = `${obj.nom} (${obj.id})`;
  const right = document.createElement("span"); right.className = "count"; right.textContent = `${count || 0} utilisation(s)`;
  h3.appendChild(left); h3.appendChild(right);
  const p = document.createElement("p"); p.textContent = obj.description;

  const actions = document.createElement("div"); actions.className = "actions";
  const editBtn = document.createElement("button"); editBtn.className = "btn primary"; editBtn.textContent = "Modifier"; editBtn.addEventListener("click", onEdit);
  const delBtn = document.createElement("button"); delBtn.className = "btn"; delBtn.textContent = "Supprimer"; delBtn.addEventListener("click", onDelete);
  actions.appendChild(editBtn); actions.appendChild(delBtn);

  wrap.appendChild(pill); wrap.appendChild(h3); wrap.appendChild(p); renderBadges(wrap, obj.materiel); wrap.appendChild(actions);
  return wrap;
}

function makeEditCard(obj, typeLabel, onSave, onCancel) {
  const wrap = document.createElement("div"); wrap.className = "item";
  const band = document.createElement("div");
  band.className = `band ${typeLabel.includes("Jeu") ? "t-jeu" : "t-individuel"}`;
  band.style.width = "6px"; band.style.position = "absolute"; band.style.left = "0"; band.style.top = "0"; band.style.bottom = "0";
  wrap.appendChild(band);

  const pill = document.createElement("div"); pill.className = "pill"; pill.textContent = `${typeLabel} • édition`;

  const row = document.createElement("div"); row.className = "row";
  const idInput = document.createElement("input"); idInput.value = obj.id || ""; idInput.placeholder = "ID (ex: J01 / E01)";
  const nomInput = document.createElement("input"); nomInput.value = obj.nom || ""; nomInput.placeholder = "Nom";
  const descInput = document.createElement("textarea"); descInput.value = obj.description || ""; descInput.placeholder = "Description"; descInput.rows = 3;
  const matInput = document.createElement("input"); matInput.value = arrayToCsv(obj.materiel || []); matInput.placeholder = "Matériel (séparé par des virgules)";

  const actions = document.createElement("div"); actions.className = "actions";
  const saveBtn = document.createElement("button"); saveBtn.className = "btn primary"; saveBtn.textContent = "Enregistrer";
  saveBtn.addEventListener("click", () => onSave({ id: idInput.value.trim(), nom: nomInput.value.trim(), description: descInput.value.trim(), materiel: csvToArray(matInput.value) }));
  const cancelBtn = document.createElement("button"); cancelBtn.className = "btn"; cancelBtn.textContent = "Annuler"; cancelBtn.addEventListener("click", onCancel);
  actions.appendChild(saveBtn); actions.appendChild(cancelBtn);

  row.appendChild(idInput); row.appendChild(nomInput); row.appendChild(descInput); row.appendChild(matInput);
  wrap.appendChild(pill); wrap.appendChild(row); wrap.appendChild(actions);
  return wrap;
}

function renderEditableGrid(containerId, items, typeLabel, idPrefix, catalogRef, calendarRef, rerenderAll) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  // ✅ toujours un tableau
  items = Array.isArray(items) ? items : [];

  const usages = countUsages(calendarRef());
  const counts = typeLabel.includes("Jeu") ? usages.jeux : usages.entr;

  items.forEach((obj, idx) => {
    let editing = false;
    const mount = () => { container.replaceChild(render(), node); };
    const onEdit = () => { editing = true; mount(); };
    const onCancel = () => { editing = false; mount(); };
    const onSave = async (updated) => {
      items[idx] = updated;
      if (!updated.id || !updated.nom || !updated.description || !Array.isArray(updated.materiel)) {
        alert("Chaque entrée doit avoir id, nom, description, materiel[]"); return;
      }
      try { await saveCatalog(catalogRef()); rerenderAll(); } catch (e) { alert("Erreur: " + (e?.message || e)); }
    };
    const onDelete = async () => {
      if (!confirm("Supprimer cet item ?")) return;
      items.splice(idx, 1);
      try { await saveCatalog(catalogRef()); rerenderAll(); } catch (e) { alert("Erreur: " + (e?.message || e)); }
    };

    const render = () => editing
      ? makeEditCard(items[idx], typeLabel, onSave, onCancel)
      : makeReadCard(items[idx], typeLabel, counts.get(obj.id) || 0, onEdit, onDelete);

    const node = render();
    container.appendChild(node);
  });
}

// ---- Floating Add Button ----
function initFab(getActiveTabId, addJeu, addEntr) {
  const fab = document.getElementById("fab");
  const menu = document.getElementById("fab-menu");
  const addJ = document.getElementById("fab-add-jeu");
  const addE = document.getElementById("fab-add-entr");

  fab.addEventListener("click", () => {
    const active = getActiveTabId();
    if (active === "view-jeux") { addJeu(); return; }
    if (active === "view-entrainements") { addEntr(); return; }
    menu.classList.toggle("show");
  });
  addJ.addEventListener("click", () => { addJeu(); menu.classList.remove("show"); });
  addE.addEventListener("click", () => { addEntr(); menu.classList.remove("show"); });
}

// ---- Vue JOUR : logique ----
function isTrainingDay(item) {
  if (item.cancelled?.is) return false;
  if (item.weekday === "mercredi") return true;
  if (item.weekday === "samedi") return item.type === "entrainement";
  return false;
}

function todayIso() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function findNextTraining(calendar) {
  const today = todayIso();
  return (calendar.items || [])
    .filter(it => it.date >= today && isTrainingDay(it))
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

function renderDayView(calendar, catalog, rerenderAll, targetDate) {
  const dayWrap = document.getElementById("day-container");
  dayWrap.innerHTML = "";

  const item = (calendar.items || []).find(x => x.date === targetDate);
  if (!item) {
    const msg = document.createElement("p");
    msg.textContent = "Aucune séance à cette date.";
    dayWrap.appendChild(msg);
    return;
  }
  const usages = countUsages(calendar);
  const card = renderDayCard(item, calendar, catalog, usages, rerenderAll);
  dayWrap.appendChild(card);
}

// ---- Mode switch (liste/jour) ----
function initPlanningModes(calendarRef, catalogRef, rerenderAll) {
  const btnList = document.getElementById("btn-mode-list");
  const btnDay = document.getElementById("btn-mode-day");
  const dayControls = document.getElementById("day-controls");
  const stack = document.getElementById("stack");
  const dayContainer = document.getElementById("day-container");
  const input = document.getElementById("day-input");
  const btnToday = document.getElementById("day-today");

  // --- Récupère préférences utilisateur ---
  let currentMode = localStorage.getItem("planningMode") || "day"; // <-- JOUR par défaut
  let selectedDate = localStorage.getItem("planningSelectedDate") || null;

  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem("planningMode", mode); // <-- persiste le mode

    btnList.classList.toggle("active", mode === "list");
    btnDay.classList.toggle("active", mode === "day");
    dayControls.style.display = mode === "day" ? "flex" : "none";
    stack.style.display = mode === "list" ? "grid" : "none";
    dayContainer.style.display = mode === "day" ? "block" : "none";

    if (mode === "day") {
      // si aucune date sélectionnée, prendre le prochain entraînement
      if (!selectedDate) {
        const next = findNextTraining(calendarRef());
        selectedDate = next ? next.date : (calendarRef().items[0]?.date || todayIso());
      }
      input.value = selectedDate;
      renderDayView(calendarRef(), catalogRef(), rerenderAll, selectedDate);
    }
  }

  btnList.addEventListener("click", () => setMode("list"));
  btnDay.addEventListener("click", () => setMode("day"));

  input.addEventListener("change", () => {
    selectedDate = input.value;
    localStorage.setItem("planningSelectedDate", selectedDate); // <-- persiste la date choisie
    if (selectedDate) renderDayView(calendarRef(), catalogRef(), rerenderAll, selectedDate);
  });

  btnToday.addEventListener("click", () => {
    const next = findNextTraining(calendarRef());
    selectedDate = next ? next.date : (calendarRef().items[0]?.date || todayIso());
    localStorage.setItem("planningSelectedDate", selectedDate); // <-- persiste aussi ce choix
    input.value = selectedDate;
    renderDayView(calendarRef(), catalogRef(), rerenderAll, selectedDate);
  });

  // Initialise directement avec le mode mémorisé (par défaut: "day")
  setMode(currentMode);

  return {
    refreshOnCalendarChange() {
      // Si la vue Jour est active, on re-render ce jour (utile après un changement)
      if (currentMode === "day" && selectedDate) {
        renderDayView(calendarRef(), catalogRef(), rerenderAll, selectedDate);
      }
    }
  };
}

// --- Bootstrap ---
(async function () {
  initTabs();

  const [calRes, catRes] = await Promise.all([
    fetch("/api/calendar"),
    fetch("/api/catalog")
  ]);
  if (!calRes.ok) { document.getElementById("stack")?.remove(); } // stack n'existe plus
  let calendar = await calRes.json();
  let catalog = await catRes.json();

  const calendarRef = () => calendar;
  const catalogRef = () => catalog;

  // état du calendrier (persisté)
  const savedYM = loadYM();
  const savedSel = localStorage.getItem(LS_SELECTED) || null;
  const state = { currentYM: savedYM, selectedDate: savedSel };

  // Rendu global (planning => calendrier maintenant)
  const rerenderAll = (newCalendar) => {
    if (newCalendar) calendar = newCalendar;
    renderCalendar(calendar || { items: [] }, catalog || { jeuxFoot: [], entrainements: [] }, rerenderAll, state);
    renderEditableGrid("grid-jeux", (catalog && catalog.jeuxFoot) || [], "Jeu collectif", "J", catalogRef, calendarRef, rerenderAll);
    renderEditableGrid("grid-entr", (catalog && catalog.entrainements) || [], "Entrainement individuel", "E", catalogRef, calendarRef, rerenderAll);
  };

  // Contrôles mois
  const prevBtn = document.getElementById("cal-prev");
  const nextBtn = document.getElementById("cal-next");
  prevBtn.addEventListener("click", () => {
    let [y, m0] = state.currentYM;
    m0 -= 1; if (m0 < 0) { m0 = 11; y -= 1; }
    state.currentYM = [y, m0];
    saveYM(y, m0);
    renderCalendar(calendar, catalog, rerenderAll, state);
  });
  nextBtn.addEventListener("click", () => {
    let [y, m0] = state.currentYM;
    m0 += 1; if (m0 > 11) { m0 = 0; y += 1; }
    state.currentYM = [y, m0];
    saveYM(y, m0);
    renderCalendar(calendar, catalog, rerenderAll, state);
  });

  // Premier rendu
  rerenderAll(calendar);

  // FAB (inchangé): visible seulement dans les onglets listes
  const getActiveTabId = () => (document.querySelector(".view.active")?.id || "view-planning");
  const addJeu = async () => {
    const id = nextId(catalog.jeuxFoot, "J");
    catalog.jeuxFoot.push({ id, nom: "", description: "", materiel: [] });
    try { await saveCatalog(catalog); rerenderAll(); document.querySelector('.tab[data-target="view-jeux"]').click(); }
    catch (e) { alert("Erreur: " + (e?.message || e)); }
  };
  const addEntr = async () => {
    const id = nextId(catalog.entrainements, "E");
    catalog.entrainements.push({ id, nom: "", description: "", materiel: [] });
    try { await saveCatalog(catalog); rerenderAll(); document.querySelector('.tab[data-target="view-entrainements"]').click(); }
    catch (e) { alert("Erreur: " + (e?.message || e)); }
  };
  initFab(getActiveTabId, addJeu, addEntr);
  updateFabVisibility();
})();