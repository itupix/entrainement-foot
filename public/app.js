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
    renderEditableGrid(
      "grid-jeux",
      (catalog && catalog.jeuxFoot) || [],
      "Jeu collectif",
      "J",
      catalogRef,
      calendarRef,
      rerenderAll
    );
    renderEditableGrid(
      "grid-entr",
      (catalog && catalog.entrainements) || [],
      "Entrainement individuel",
      "E",
      catalogRef,
      calendarRef,
      rerenderAll
    );
    // 🆕 Grille Mobilité
    renderEditableGrid(
      "grid-mob",
      (catalog && catalog.mobilite) || [],
      "Mobilité",
      "M",
      catalogRef,
      calendarRef,
      rerenderAll
    );
  };

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
})();