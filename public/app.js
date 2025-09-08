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

function makeDetailsButton(item) {
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Détails";
  if (item && (item.nom || item.description || item.diagram)) {
    btn.onclick = () => openExerciseDetails(item);
  } else {
    btn.disabled = true;
    btn.title = "Aucun exercice sélectionné";
  }
  return btn;
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
// Sélection par défaut : prochain jour planifié
// -----------------------
function isoToUTCDate(iso) {
  return new Date(iso + "T00:00:00Z");
}
function isPlannableCalendarItem(it) {
  if (!it) return false;
  if (it.cancelled && it.cancelled.is) return false;
  // Jour d'entraînement par conception: mercredis et tous les samedis (entrainement, plateau ou libre)
  return it.weekday === "mercredi" || it.weekday === "samedi";
}
function findNextPlannedDate(calendar, fromIso) {
  const items = (calendar && Array.isArray(calendar.items)) ? calendar.items.slice() : [];
  const planned = items.filter(isPlannableCalendarItem).sort((a, b) => a.date.localeCompare(b.date));
  if (planned.length === 0) return null;
  const fromTs = isoToUTCDate(fromIso).getTime();
  const future = planned.find(d => isoToUTCDate(d.date).getTime() >= fromTs);
  if (future) return future.date;
  // sinon: aucun futur, on prend le dernier planifié (le plus récent passé)
  return planned[planned.length - 1].date;
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
function updateFabVisibility() {
  const fab = document.getElementById("fab");
  if (!fab) return;
  // visible uniquement sur l’onglet Exercices
  fab.style.display = (getActiveTabId() === "view-exercices") ? "block" : "none";
}

function wireFab(catalogRef) {
  const fab = document.getElementById("fab");
  if (!fab) return;
  fab.onclick = () => {
    const cat = catalogRef ? catalogRef() : { jeuxFoot: [], entrainements: [], mobilite: [] };
    const kind = getSelectedExerciseCategory(); // "jeux" | "entr" | "mob"

    // génère un ID lisible et unique par catégorie
    let id;
    if (kind === "jeux") {
      id = nextId(cat.jeuxFoot || [], "J");
    } else if (kind === "entr") {
      id = nextId(cat.entrainements || [], "E");
    } else {
      id = nextId(cat.mobilite || [], "M");
    }

    openNewExerciseInEditor(kind, id);
  };
}

// --- Vignette: diagram (éditeur) -> SVG string ---
// API: diagramToSVG(diagram, {width=280, height=168, bg="#f8fafc"})
function diagramToSVG(diagram, opts = {}) {
  const W = opts.width || 280;
  const H = opts.height || 168;
  const BG = opts.bg ?? "#f8fafc";

  const model = (diagram && Array.isArray(diagram.items))
    ? diagram
    : { width: 1000, height: 600, items: [] };

  const vw = model.width || 1000;
  const vh = model.height || 600;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));
  const col = (c, d) => (c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) ? c : d;
  const rotAttr = (rot, cx, cy) => rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : "";

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">`);
  out.push(`<rect x="0" y="0" width="${vw}" height="${vh}" fill="${esc(BG)}" />`);
  out.push(`
    <defs>
      <marker id="tnArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#111827" />
      </marker>
    </defs>
  `);

  // ---- primitives ----
  function drawCone(it) {
    const R = it.r ?? 12;
    const cx = it.x, cy = it.y;
    const h = R * 1.8;
    const yTop = cy - R - h * 0.6;
    const yBase = cy - R * 0.2;
    const c = col(it.color, "#ef4444");

    const leftBase = cx - R * 0.9;
    const rightBase = cx + R * 0.9;
    const qCtrlY = yBase + R * 0.2;

    const shine_x1 = cx - R * 0.15;
    const shine_y1 = yTop + h * 0.25;
    const shine_x2 = cx - R * 0.35;
    const shine_y2 = yBase - R * 0.25;
    const shine_qx = cx - R * 0.15;
    const shine_qy = yBase - R * 0.15;
    const shine_x3 = cx - R * 0.05;
    const shine_y3 = yTop + h * 0.3;

    return `
      <g${rotAttr(it.rot, cx, cy)}>
        <path d="M ${cx} ${yTop} L ${leftBase} ${yBase} Q ${cx} ${qCtrlY} ${rightBase} ${yBase} Z"
              fill="${c}" stroke="#222" stroke-width="0.5"/>
        <path d="M ${shine_x1} ${shine_y1} L ${shine_x2} ${shine_y2}
                 Q ${shine_qx} ${shine_qy} ${shine_x3} ${shine_y3} Z"
              fill="#ffffff22"/>
        <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${R * 0.35}" fill="${c}" stroke="#222" stroke-width="0.5"/>
      </g>`;
  }

  function drawPlayer(it) {
    const R = it.r ?? 14;
    const c = col(it.color, "#2563eb");
    const cx = it.x, cy = it.y;
    const w = R * 2.2, h = R * 2.2;
    const x0 = cx - w / 2, y0 = cy - h / 2 + 6;

    return `
      <g${rotAttr(it.rot, cx, cy)}>
        <path d="M ${x0} ${y0 + h * 0.35} Q ${cx} ${y0} ${x0 + w} ${y0 + h * 0.35}
                 L ${x0 + w} ${y0 + h * 0.85} Q ${cx} ${y0 + h} ${x0} ${y0 + h * 0.85} Z"
              fill="${c}" stroke="#1f2937" stroke-width="0.8"/>
        <rect x="${x0 - R * 0.35}" y="${y0 + h * 0.38}" width="${R * 0.6}" height="${R * 0.7}"
              fill="${c}" stroke="#1f2937" stroke-width="0.6"/>
        <rect x="${x0 + w - R * 0.25}" y="${y0 + h * 0.38}" width="${R * 0.6}" height="${R * 0.7}"
              fill="${c}" stroke="#1f2937" stroke-width="0.6"/>
        <circle cx="${cx}" cy="${y0}" r="${R * 0.6}" fill="#fde68a" stroke="#1f2937" stroke-width="0.8"/>
      </g>`;
  }

  function drawBall(it) {
    const R = it.r ?? 10;
    const c = col(it.color, "#111827");
    const x = it.x, y = it.y;

    const sx = R * 0.6, sd = R * 0.42;
    return `
      <g${rotAttr(it.rot, x, y)}>
        <circle cx="${x}" cy="${y}" r="${R}" fill="#fff" stroke="#1f2937" stroke-width="1"/>
        <line x1="${x - sx}" y1="${y}" x2="${x + sx}" y2="${y}" stroke="${c}" stroke-width="1"/>
        <line x1="${x}" y1="${y - sx}" x2="${x}" y2="${y + sx}" stroke="${c}" stroke-width="1"/>
        <line x1="${x - sd}" y1="${y - sd}" x2="${x + sd}" y2="${y + sd}" stroke="${c}" stroke-width="1"/>
        <line x1="${x - sd}" y1="${y + sd}" x2="${x + sd}" y2="${y - sd}" stroke="${c}" stroke-width="1"/>
      </g>`;
  }

  function drawGoal(it) {
    const w = it.w ?? 100, h = it.h ?? 56;
    const c = col(it.color, "#6b7280");
    const cx = it.x, cy = it.y;
    const x = cx - w / 2, y = cy - h / 2;
    const pad = 6, nx = 8, ny = 6;

    const nets = [];
    for (let i = 0; i <= nx; i++) {
      const lx = x + pad + (w - 2 * pad) * (i / nx);
      nets.push(`<line x1="${lx}" y1="${y + pad}" x2="${lx}" y2="${y + h}" stroke="#cbd5e1" stroke-width="0.7"/>`);
    }
    for (let j = 0; j <= ny; j++) {
      const ly = y + pad + (h - pad) * (j / ny);
      nets.push(`<line x1="${x + pad}" y1="${ly}" x2="${x + w - pad}" y2="${ly}" stroke="#cbd5e1" stroke-width="0.7"/>`);
    }
    for (let d = 0; d < ny; d++) {
      const y1 = y + pad + d * ((h - pad) / ny);
      const x2 = x + pad + d * ((w - 2 * pad) / ny);
      nets.push(`<line x1="${x + pad}" y1="${y1}" x2="${x2}" y2="${y + h}" stroke="#e5e7eb" stroke-width="0.6"/>`);
    }

    return `
      <g${rotAttr(it.rot, cx, cy)}>
        <rect x="${x}" y="${y}" width="6" height="${h}" fill="${c}"/>
        <rect x="${x + w - 6}" y="${y}" width="6" height="${h}" fill="${c}"/>
        <rect x="${x}" y="${y}" width="${w}" height="6" fill="${c}"/>
        <g opacity="0.9">${nets.join("")}</g>
      </g>`;
  }

  function drawHurdle(it) {
    const w = it.w ?? 50, h = it.h ?? 14;
    const x = it.x - w / 2, y = it.y - h / 2;
    const c = col(it.color, "#e11d48");

    const legW = h / 7;
    return `
      <g${rotAttr(it.rot, it.x, it.y)}>
        <rect x="${x}" y="${y}" width="${w}" height="${h / 3}" fill="${c}"/>
        <rect x="${x}" y="${y + h / 3}" width="${legW}" height="${h * 0.7}" fill="#4b5563"/>
        <rect x="${x + w - legW}" y="${y + h / 3}" width="${legW}" height="${h * 0.7}" fill="#4b5563"/>
      </g>`;
  }

  function drawDisc(it) {
    const R = it.r ?? 10;
    const cx = it.x, cy = it.y;
    const c = col(it.color, "#f59e0b");
    const ry = R * 0.35;

    return `
      <g${rotAttr(it.rot, cx, cy)}>
        <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${ry}" fill="${c}" stroke="#92400e" stroke-width="0.5"/>
      </g>`;
  }

  function drawRect(it) {
    const w = it.w ?? 60;
    const h = it.h ?? Math.round(w * 2 / 3);
    const cx = it.x, cy = it.y;
    const x = cx - w / 2, y = cy - h / 2;
    const c = col(it.color, "#6366f1");

    return `<g${rotAttr(it.rot, cx, cy)}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" opacity="0.85" stroke="#111827" stroke-width="1"/></g>`;
  }

  function drawCircle(it) {
    const R = it.r ?? 16;
    const cx = it.x, cy = it.y;
    const c = col(it.color, "#22c55e");
    return `<g${rotAttr(it.rot, cx, cy)}><circle cx="${cx}" cy="${cy}" r="${R}" fill="${c}" opacity="0.9" stroke="#0f172a" stroke-width="1"/></g>`;
  }

  function drawTriangle(it) {
    const a = it.a ?? 40;
    const h = a * Math.sqrt(3) / 2;
    const cx = it.x, cy = it.y;
    const p1x = cx, p1y = cy - h / 2;
    const p2x = cx - a / 2, p2y = cy + h / 2;
    const p3x = cx + a / 2, p3y = cy + h / 2;
    const c = col(it.color, "#06b6d4");

    return `<g${rotAttr(it.rot, cx, cy)}><path d="M ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} Z" fill="${c}" opacity="0.85" stroke="#0f172a" stroke-width="1"/></g>`;
  }

  function drawCross(it) {
    const s = it.s ?? 14;
    const cx = it.x, cy = it.y;
    const c = col(it.color, "#ef4444");
    const rot = (it.rot == null ? 45 : it.rot);

    const h1x = cx - s, h1y = cy - 3, h1w = s * 2, h1h = 6;
    const v1x = cx - 3, v1y = cy - s, v1w = 6, v1h = s * 2;

    return `<g${rotAttr(rot, cx, cy)}><rect x="${h1x}" y="${h1y}" width="${h1w}" height="${h1h}" fill="${c}"/><rect x="${v1x}" y="${v1y}" width="${v1w}" height="${v1h}" fill="${c}"/></g>`;
  }

  function drawRing(it) {
    const R = it.r ?? 18;
    const cx = it.x, cy = it.y;
    const c = col(it.color, "#3b82f6");
    return `<g${rotAttr(it.rot, cx, cy)}><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c}" stroke-width="3"/></g>`;
  }

  function drawPost(it) {
    const cx = it.x, cy = it.y;
    return `<g${rotAttr(it.rot, cx, cy)}><rect x="${cx - 3}" y="${cy - 20}" width="6" height="40" fill="${col(it.color, "#10b981")}"/></g>`;
  }

  function drawLadder(it) {
    const w = it.w ?? 120, h = it.h ?? 40, steps = it.steps ?? 4;
    const cx = it.x, cy = it.y;
    const x = cx - w / 2, y = cy - h / 2;
    const c = col(it.color, "#f59e0b");

    const seg = [];
    seg.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${c}" stroke-width="2"/>`);
    for (let i = 1; i < steps; i++) {
      const lx = x + (w / steps) * i;
      seg.push(`<line x1="${lx}" y1="${y}" x2="${lx}" y2="${y + h}" stroke="${c}" stroke-width="2"/>`);
    }
    return `<g${rotAttr(it.rot, cx, cy)}>${seg.join("")}</g>`;
  }

  function drawArrow(it) {
    const mx = (it.x1 + it.x2) / 2;
    const my = (it.y1 + it.y2) / 2;
    const stroke = col(it.color, "#111827");
    return `
      <g${rotAttr(it.rot || 0, mx, my)}>
        <line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}"
              stroke="${stroke}" stroke-width="5" stroke-linecap="round" marker-end="url(#tnArrow)"/>
      </g>`;
  }

  function drawText(it) {
    const fs = it.size ?? 14;
    const cx = it.x, cy = it.y;
    const c = col(it.color, "#111827");
    return `<g${rotAttr(it.rot, cx, cy)}><text x="${cx}" y="${cy}" fill="${c}" font-size="${fs}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial">${esc(it.text || "Texte")}</text></g>`;
  }

  const drawMap = {
    plot: drawCone,
    joueur: drawPlayer,
    ballon: drawBall,
    but: drawGoal,
    haie: drawHurdle,
    coupelle: drawDisc,
    rect: drawRect,
    rond: drawCircle,
    triangle: drawTriangle,
    croix: drawCross,
    cerceau: drawRing,
    poteau: drawPost,
    echelle: drawLadder,
    fleche: drawArrow,
    texte: drawText
  };

  (model.items || []).forEach(it => {
    const fn = drawMap[it.type];
    if (fn) out.push(fn(it));
  });

  out.push(`</svg>`);
  return out.join("");
}

function diagramToDataUrl(model, opts = {}) {
  const svg = diagramToSVG(model, opts);
  return svg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) : "";
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
  < div class="modal" id = "chooser" style = "display:none;" >
    <div class="modal-card">
      <div class="modal-head" style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
        <strong id="chooser-title">Choisir</strong>
        <input id="chooser-search" placeholder="Rechercher..." />
        <button class="btn" id="chooser-close">Fermer</button>
      </div>
      <div class="grid" id="chooser-grid"></div>
    </div>
  </div > `;
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

function getActiveTabId() {
  return document.querySelector(".view.active")?.id || "";
}
function getSelectedExerciseCategory() {
  // doit matcher l’ID de ta liste déroulante de catégories dans l’onglet Exercices
  // valeurs attendues: "jeux", "entr", "mob"
  const sel = document.getElementById("ex-cat-select");
  return sel ? sel.value : "jeux";
}
function openNewExerciseInEditor(kind, id) {
  // kind: "jeux" | "entr" | "mob"
  // on ouvre l’éditeur SANS écrire le catalog ; l’éditeur créera/mettre à jour à la sauvegarde
  const payload = {
    kind, id,
    name: "", description: "",
    diagram: { width: 1000, height: 600, items: [] }
  };
  if (typeof window.editorLoadExercise === "function") {
    window.editorLoadExercise(payload);
    // affiche la modale si besoin
    const modal = document.getElementById("editor-modal");
    if (modal) { modal.style.display = "flex"; modal.classList.add("show"); }
  } else {
    alert("Éditeur indisponible (editorLoadExercise non trouvé).");
  }
}

const h = document.getElementById("calendar-date");

// -----------------------
// Carte du jour (avec Mobilité)
// -----------------------
function renderDayCard(it, calendar, catalog, usages, rerenderAll) {
  const card = document.createElement("div");
  card.className = "card";

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
    p.textContent = it.weekday === "samedi" ? `Samedi: ${it.type || "libre"} ` : "Aucune séance";
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
  const mobActions = document.createElement("div");
  mobActions.style.display = "flex";
  mobActions.style.gap = "8px";

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
  mobActions.appendChild(btnMob);
  mobActions.appendChild(makeDetailsButton(it.mobilite));
  mob.appendChild(mobActions);
  card.appendChild(mob);

  // Section Entrainement individuel
  const ind = document.createElement("div");
  ind.className = "block t-individuel";
  ind.innerHTML = `
  <div class="band"></div>
  <h3>Entrainement individuel</h3>
  <p>${it.entrainement?.nom ? it.entrainement.nom : "<i>non défini</i>"}</p>
`;
  const indActions = document.createElement("div");
  indActions.style.display = "flex";
  indActions.style.gap = "8px";

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
  indActions.appendChild(btnInd);
  indActions.appendChild(makeDetailsButton(it.entrainement));
  ind.appendChild(indActions);
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
  const jeuActions = document.createElement("div");
  jeuActions.style.display = "flex";
  jeuActions.style.gap = "8px";

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
  jeuActions.appendChild(btnJeu);
  jeuActions.appendChild(makeDetailsButton(it.jeu));
  jeu.appendChild(jeuActions);
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

// Map type -> (libellé, icône)
const MATERIALS_MAP = {
  plot: { label: "Plots", icon: "🔺" },
  coupelle: { label: "Coupelles", icon: "🟠" },
  poteau: { label: "Poteaux", icon: "🟩" },
  ballon: { label: "Ballons", icon: "⚽" },
  cerceau: { label: "Cerceaux", icon: "🟦" },
  echelle: { label: "Échelles", icon: "🪜" },
  haie: { label: "Haies", icon: "🟪" },
  but: { label: "Buts", icon: "🧱" }
  // (on ignore les formes décoratives, flèches, texte, joueurs)
};

function computeMaterialsFromDiagram(diagram) {
  const counts = {};
  const items = (diagram && Array.isArray(diagram.items)) ? diagram.items : [];
  for (const it of items) {
    if (!it || !it.type) continue;
    if (MATERIALS_MAP[it.type]) {
      counts[it.type] = (counts[it.type] || 0) + 1;
    }
  }
  // retourne un tableau trié par label
  return Object.entries(counts)
    .map(([type, qty]) => ({ type, qty, ...MATERIALS_MAP[type] }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
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
    const next = findNextPlannedDate(calendar, today);
    const inRange = (dIso) => {
      const d = new Date(dIso + "T00:00:00Z");
      return d >= first && d <= last;
    };
    // si le "prochain planifié" est dans le mois affiché on le prend, sinon on retombe sur le début du mois
    state.selectedDate = (next && inRange(next)) ? next : (inRange(today) ? today : toIsoUTC(first));
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
      renderDate(state.selectedDate)
      toggleCalendar()
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

function renderDate(date) {
  const dateStr = new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).replace(/./, c => c.toUpperCase())

  h.textContent = dateStr;
}

// ---- Détails Exercice (lecture seule) ----
function ensureExerciseDetailsDom() {
  // déjà dans le HTML (section 1), donc rien à générer ici.
}

function openExerciseDetails(item, opts = {}) {
  ensureExerciseDetailsDom();

  const modal = document.getElementById("exercise-details-modal");
  const btnClose = document.getElementById("exdet-close");
  const elTitle = document.getElementById("exdet-title");
  const elDesc = document.getElementById("exdet-desc");
  const elMat = document.getElementById("exdet-mat");
  const elDiag = document.getElementById("exdet-diagram");

  // Sécurité valeurs
  const nom = item?.nom || "(Sans titre)";
  const desc = item?.description || "—";
  const mat = Array.isArray(item?.materiel) ? item.materiel : [];
  const diag = item?.diagram;

  elTitle.textContent = nom;
  elDesc.textContent = desc;

  // liste matériel
  // --- dans openExerciseDetails(item) ---
  // liste matériel (priorité au diagramme)
  elMat.innerHTML = "";

  const autoMat = computeMaterialsFromDiagram(diag);

  if (autoMat.length === 0) {
    // fallback: si tu veux, on peut ajouter ici item.materiel (manuel)
    // const manual = Array.isArray(item?.materiel) ? item.materiel : [];
    // if (manual.length) { manual.forEach(m => { const li=document.createElement("li"); li.textContent = m; elMat.appendChild(li); }); }
    // else {
    const li = document.createElement("li");
    li.textContent = "Aucun matériel détecté";
    li.style.color = "#6b7280";
    elMat.appendChild(li);
    // }
  } else {
    autoMat.forEach(({ icon, label, qty }) => {
      const li = document.createElement("li");
      li.textContent = `${icon ? icon + " " : ""}${label} × ${qty}`;
      elMat.appendChild(li);
    });
  }

  // diagramme (vignette)
  elDiag.innerHTML = "";
  try {
    // vignette (grand format ; sera downscalée en CSS si nécessaire)
    const svgStr = diagramToSVG(diag, { width: 1000, height: 600 });
    elDiag.innerHTML = svgStr;
  } catch (e) {
    const warn = document.createElement("div");
    warn.textContent = "Diagramme indisponible";
    warn.style.color = "#b91c1c";
    elDiag.appendChild(warn);
  }

  // open / close
  function close() {
    modal.classList.remove("show");
    modal.style.display = "none";
    btnClose.removeEventListener("click", close);
    modal.removeEventListener("click", backdropClose);
  }
  function backdropClose(ev) {
    if (ev.target === modal) close();
  }

  btnClose.addEventListener("click", close);
  modal.addEventListener("click", backdropClose);

  modal.style.display = "flex";
  modal.classList.add("show");
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

    const btnDetails = document.createElement("button");
    btnDetails.className = "btn";
    btnDetails.textContent = "Détails";
    btnDetails.onclick = () => openExerciseDetails(obj);


    const btnDel = document.createElement("button");
    btnDel.className = "btn danger";
    btnDel.textContent = "Supprimer";
    btnDel.onclick = async () => {
      const used = usageMap[obj.id] || 0;
      const ok = confirm(
        used
          ? `Cet exercice est utilisé ${used} fois dans le planning.\nLe supprimer du catalogue n’affectera pas les séances déjà planifiées.\nConfirmer la suppression ? `
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

    actions.appendChild(btnDetails);
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

const calToggle = document.getElementById('calendar-toggle')
function toggleCalendar() {
  calToggle.innerText = calToggle.innerText === "Fermer" ? "Changer" : "Fermer";
  document.getElementById('calendar-content').classList.toggle('visible')
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

  // Déterminer la date par défaut = prochain jour planifié (ou aujourd'hui si rien)
  const __defaultIso = findNextPlannedDate(calendar, todayIso()) || todayIso();
  const __d = new Date(__defaultIso + "T00:00:00Z");
  const state = {
    currentYM: [__d.getUTCFullYear(), __d.getUTCMonth()],
    selectedDate: __defaultIso,
  };

  renderDate(state.selectedDate)

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

  calToggle.addEventListener('click', toggleCalendar)

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

  // après rerenderAll(...)
  wireFab(catalogRef);
  updateFabVisibility();

  // quand on change d’onglet ou de catégorie : remettre à jour la visibilité
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", updateFabVisibility);
  });
  const catSel = document.getElementById("ex-cat-select");
  if (catSel) catSel.addEventListener("change", () => {/* rien de spécial ici, juste pour futur */ });

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
