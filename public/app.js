// ---- Tabs ----
function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const views = Array.from(document.querySelectorAll(".view"));
  function activate(id) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.target === id));
    views.forEach(v => v.classList.toggle("active", v.id === id));
    document.getElementById("fab-menu").classList.remove("show");
    updateFabVisibility(); // ← ajoute ceci
  }
  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.target)));
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

// ---- Planning (choix par jour) ----
function makeChooseButton(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderPlanning(calendar, catalog, rerenderAll) {
  const stack = document.getElementById("stack");
  stack.innerHTML = "";

  const usages = countUsages(calendar);

  calendar.items.forEach((it) => {
    const card = document.createElement("div");
    card.className = "card";

    const dateEl = document.createElement("div");
    dateEl.className = "date";
    dateEl.textContent = toDateLabel(it.date);

    const planEl = document.createElement("div");
    planEl.className = "plan";

    it.plan.forEach((s, idx) => {
      const block = document.createElement("div");
      block.className = `block t-${s.type}`;
      const band = document.createElement("div");
      band.className = "band";
      block.appendChild(band);

      const h3 = document.createElement("h3");

      const leftTitle = document.createElement("span");
      leftTitle.textContent = `${s.label} • ${s.minutes} min`;

      const rightBtns = document.createElement("span");

      // Boutons "Choisir" uniquement pour les deux étapes concernées
      if (s.type === "individuel") {
        rightBtns.appendChild(makeChooseButton("Choisir l'entraînement", () => openChooser({
          kind: "entr", date: it.date, catalog, calendar, usages, rerenderAll
        })));
      }
      if (s.type === "jeu") {
        rightBtns.appendChild(makeChooseButton("Choisir le jeu", () => openChooser({
          kind: "jeux", date: it.date, catalog, calendar, usages, rerenderAll
        })));
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

    card.appendChild(dateEl);
    card.appendChild(planEl);
    stack.appendChild(card);
  });
}

// ---- Modal chooser ----
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
            // Mettre à jour état local
            rerenderAll(data.calendar);
            modal.classList.remove("show");
          } catch (e) {
            alert("Impossible de mettre à jour le jour: " + (e?.message || e));
          }
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

// ---------- Catalog (édition par item + compteurs & mise en évidence) ----------
function csvToArray(s) {
  return (s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}
function arrayToCsv(a) {
  return (a || []).join(", ");
}
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
  const wrap = document.createElement("div");
  wrap.className = "item";
  if (!count) wrap.classList.add("unused");

  const band = document.createElement("div");
  band.className = `band ${typeLabel.includes("Jeu") ? "t-jeu" : "t-individuel"}`;
  band.style.width = "6px"; band.style.position = "absolute"; band.style.left = "0"; band.style.top = "0"; band.style.bottom = "0";
  wrap.appendChild(band);

  const pill = document.createElement("div");
  pill.className = "pill";
  pill.textContent = typeLabel;

  const h3 = document.createElement("h3");
  const left = document.createElement("span");
  left.textContent = `${obj.nom} (${obj.id})`;
  const right = document.createElement("span");
  right.className = "count";
  right.textContent = `${count || 0} utilisation(s)`;
  h3.appendChild(left);
  h3.appendChild(right);

  const p = document.createElement("p");
  p.textContent = obj.description;

  const actions = document.createElement("div");
  actions.className = "actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn primary";
  editBtn.textContent = "Modifier";
  editBtn.addEventListener("click", onEdit);

  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.textContent = "Supprimer";
  delBtn.addEventListener("click", onDelete);

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  wrap.appendChild(pill);
  wrap.appendChild(h3);
  wrap.appendChild(p);
  renderBadges(wrap, obj.materiel);
  wrap.appendChild(actions);

  return wrap;
}

function makeEditCard(obj, typeLabel, onSave, onCancel) {
  const wrap = document.createElement("div");
  wrap.className = "item";

  const band = document.createElement("div");
  band.className = `band ${typeLabel.includes("Jeu") ? "t-jeu" : "t-individuel"}`;
  band.style.width = "6px"; band.style.position = "absolute"; band.style.left = "0"; band.style.top = "0"; band.style.bottom = "0";
  wrap.appendChild(band);

  const pill = document.createElement("div");
  pill.className = "pill";
  pill.textContent = `${typeLabel} • édition`;

  const row = document.createElement("div");
  row.className = "row";

  const idInput = document.createElement("input");
  idInput.value = obj.id || "";
  idInput.placeholder = "ID (ex: J01 / E01)";

  const nomInput = document.createElement("input");
  nomInput.value = obj.nom || "";
  nomInput.placeholder = "Nom";

  const descInput = document.createElement("textarea");
  descInput.value = obj.description || "";
  descInput.placeholder = "Description";
  descInput.rows = 3;

  const matInput = document.createElement("input");
  matInput.value = arrayToCsv(obj.materiel || []);
  matInput.placeholder = "Matériel (séparé par des virgules)";

  const actions = document.createElement("div");
  actions.className = "actions";
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.textContent = "Enregistrer";
  saveBtn.addEventListener("click", () => {
    const updated = {
      id: idInput.value.trim(),
      nom: nomInput.value.trim(),
      description: descInput.value.trim(),
      materiel: csvToArray(matInput.value)
    };
    onSave(updated);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Annuler";
  cancelBtn.addEventListener("click", onCancel);

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);

  row.appendChild(idInput);
  row.appendChild(nomInput);
  row.appendChild(descInput);
  row.appendChild(matInput);

  wrap.appendChild(pill);
  wrap.appendChild(row);
  wrap.appendChild(actions);

  return wrap;
}

function renderEditableGrid(containerId, items, typeLabel, idPrefix, catalogRef, calendarRef, rerenderAll) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

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
      try {
        await saveCatalog(catalogRef());
        rerenderAll(); // re-render lists + planning (compteurs)
      } catch (e) {
        alert("Erreur: " + (e?.message || e));
      }
    };
    const onDelete = async () => {
      if (!confirm("Supprimer cet item ?")) return;
      items.splice(idx, 1);
      try {
        await saveCatalog(catalogRef());
        rerenderAll();
      } catch (e) {
        alert("Erreur: " + (e?.message || e));
      }
    };

    const render = () =>
      editing
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

// ---- Bootstrap ----
(async function () {
  initTabs();

  const [calRes, catRes] = await Promise.all([
    fetch("/api/calendar"),
    fetch("/api/catalog")
  ]);

  if (!calRes.ok) {
    document.getElementById("stack").innerHTML = "<p>Erreur: impossible de charger le calendrier.</p>";
    return;
  }

  let calendar = await calRes.json();
  if (!catRes.ok) return;
  let catalog = await catRes.json();

  const calendarRef = () => calendar;
  const catalogRef = () => catalog;

  const rerenderAll = (newCalendar) => {
    if (newCalendar) calendar = newCalendar;
    renderPlanning(calendar, catalog, rerenderAll);
    renderEditableGrid("grid-jeux", catalog.jeuxFoot, "Jeu collectif", "J", catalogRef, calendarRef, rerenderAll);
    renderEditableGrid("grid-entr", catalog.entrainements, "Entrainement individuel", "E", catalogRef, calendarRef, rerenderAll);
  };

  rerenderAll(calendar);

  // FAB: add blank entries then save catalog to persist
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

function updateFabVisibility() {
  const activeId = document.querySelector(".view.active")?.id;
  const fab = document.getElementById("fab");
  const menu = document.getElementById("fab-menu");
  const show = activeId === "view-jeux" || activeId === "view-entrainements";
  if (!show) menu.classList.remove("show");
  fab.style.display = show ? "flex" : "none";
}