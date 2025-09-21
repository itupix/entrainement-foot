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

async function fetchAttendance(dateIso) {
  const r = await fetch(`/api/attendance/${dateIso}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Erreur chargement présences");
  return (await r.json()).items || [];
}

async function saveAttendance(dateIso, statuses, notes) {
  const r = await fetch(`/api/attendance/${dateIso}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statuses, notes })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "Erreur enregistrement présences");
  }
  return (await r.json());
}

function ensureAttendanceDom() {
  // HTML déjà inclus
}

function openAttendanceModal(dateIso, players, onSaved) {
  ensureAttendanceDom();

  const modal = document.getElementById("attendance-modal");
  const btnClose = document.getElementById("att-close");
  const btnSave = document.getElementById("att-save");
  const title = document.getElementById("att-title");
  const list = document.getElementById("att-list");
  const search = document.getElementById("att-search");
  const counters = document.getElementById("att-counters");

  const display = computeRosterDisplay(players); // tu l’as déjà en place
  const mapP = new Map(players.map(p => [p.id, p]));

  let state = {
    statuses: {}, // player_id -> "present"|"absent"|"excuse"
    notes: {},    // player_id -> string
    filteredIds: display.map(d => d.id)
  };

  title.textContent = `Présences — ${dateIso}`;

  function recomputeCounters() {
    const vals = Object.values(state.statuses);
    const present = vals.filter(v => v === "present").length;
    const absent = vals.filter(v => v === "absent").length;
    const excuse = vals.filter(v => v === "excuse").length;
    counters.textContent = `Présents: ${present} · Absents: ${absent} · Excusés: ${excuse}`;
  }

  function render() {
    list.innerHTML = "";
    const dispMap = new Map(display.map(d => [d.id, d]));
    state.filteredIds.forEach(id => {
      const d = dispMap.get(id);
      const full = mapP.get(id);
      const cur = state.statuses[id] || "";

      const row = document.createElement("div");
      row.className = "att-row";

      const left = document.createElement("div");
      left.className = "att-left";
      left.innerHTML = `<div class="att-name">${d.display}</div><div class="roster-meta">${d.full}</div>`;

      const right = document.createElement("div");
      right.className = "att-actions";

      // segment radios
      const seg = document.createElement("div");
      seg.className = "seg";
      ["present", "absent", "excuse"].forEach(val => {
        const idInput = `att_${id}_${val}`;
        const inp = document.createElement("input");
        inp.type = "radio"; inp.name = `att_${id}`; inp.id = idInput; inp.checked = (cur === val);
        inp.onchange = () => { state.statuses[id] = val; recomputeCounters(); };
        const lab = document.createElement("label");
        lab.htmlFor = idInput;
        lab.textContent = (val === "present" ? "Présent" : val === "absent" ? "Absent" : "Excusé");
        seg.appendChild(inp); seg.appendChild(lab);
      });

      // note (facultatif)
      const note = document.createElement("input");
      note.placeholder = "Note (facultatif)";
      note.value = state.notes[id] || "";
      note.oninput = (e) => { state.notes[id] = e.target.value; };

      right.appendChild(seg);
      right.appendChild(note);

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });
    recomputeCounters();
  }

  function applySearch(q) {
    const ql = q.trim().toLowerCase();
    if (!ql) { state.filteredIds = display.map(d => d.id); render(); return; }
    state.filteredIds = display
      .filter(d => d.display.toLowerCase().includes(ql) || d.full.toLowerCase().includes(ql))
      .map(d => d.id);
    render();
  }

  // Charger présences existantes
  (async () => {
    try {
      const items = await fetchAttendance(dateIso);
      items.forEach(it => {
        state.statuses[it.player_id] = it.status;
        if (it.note) state.notes[it.player_id] = it.note;
      });
      render();
    } catch (e) {
      console.warn("attendance load:", e.message);
      render(); // rendu “vide” si pas de data
    }
  })();

  // events
  function close() { modal.classList.remove("show"); modal.style.display = "none"; }
  btnClose.onclick = close;
  modal.addEventListener("click", (ev) => { if (ev.target === modal) close(); });
  btnSave.onclick = async () => {
    try {
      await saveAttendance(dateIso, state.statuses, state.notes);
      if (typeof onSaved === "function") onSaved();
      close();
    } catch (e) { alert(e.message); }
  };
  search.oninput = () => applySearch(search.value);

  // open
  modal.style.display = "flex";
  modal.classList.add("show");
}

function makeAttendanceBar(dateIso, afterUpdate) {
  const bar = document.createElement("div");
  bar.style.display = "flex";
  bar.style.justifyContent = "space-between";
  bar.style.alignItems = "center";
  bar.style.gap = "8px";
  bar.style.marginBottom = "8px";

  const pill = document.createElement("div");
  pill.className = "pill";
  pill.textContent = "Présences: —";
  bar.appendChild(pill);

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Présences";
  btn.onclick = async () => {
    try {
      const players = await __loadPlayersSafe();
      if (typeof openAttendanceModal === "function") {
        openAttendanceModal(dateIso, players, async () => {
          // après sauvegarde, rafraîchir le résumé
          try {
            const items = await fetchAttendance(dateIso);
            const present = items.filter(i => i.status === "present").length;
            const absent = items.filter(i => i.status === "absent").length;
            const excuse = items.filter(i => i.status === "excuse").length;
            pill.textContent = `Présences: ${present} · Absents: ${absent} · Excusés: ${excuse}`;
            if (typeof afterUpdate === "function") afterUpdate();
          } catch (e) { /* silencieux */ }
        });
      } else {
        alert("Modale de présences indisponible.");
      }
    } catch (e) { alert(e.message); }
  };
  bar.appendChild(btn);

  // premier remplissage du résumé
  (async () => {
    try {
      const items = await fetchAttendance(dateIso);
      const present = items.filter(i => i.status === "present").length;
      const absent = items.filter(i => i.status === "absent").length;
      const excuse = items.filter(i => i.status === "excuse").length;
      pill.textContent = `Présences: ${present} · Absents: ${absent} · Excusés: ${excuse}`;
    } catch (e) { /* pas grave si vide */ }
  })();

  return bar;
}

function capitalize(s) { return s ? s.slice(0, 1).toUpperCase() + s.slice(1) : ""; }

// Générateur d'IDs uniques courts (pour matchs etc.)
function uid(prefix = 'm_') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// -----------------------
// Match: Modal + helpers (entrainement & plateau)
// -----------------------
function ensureMatchDom() {
  if (document.getElementById("match-modal")) return;
  const el = document.createElement("div");
  el.innerHTML = `
  <div class="modal" id="match-modal" style="display:none;">
    <div class="modal-card" style="max-width:920px;width:96%;max-height:92vh;display:flex;flex-direction:column;">
      <div class="modal-head" style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
        <h3 id="match-title" style="margin:0;">Match</h3>
        <button class="btn" id="match-close">Fermer</button>
      </div>
      <div id="match-body" style="display:flex;gap:12px;flex-wrap:wrap;">
        <!-- Left: config -->
        <div style="flex:1 1 340px;min-width:320px;">
          <div id="match-kind-info" class="pill" style="margin-bottom:8px;">Match</div>
          <div id="match-plateau-row" style="display:none;gap:6px;align-items:center;margin:6px 0;">
            <label style="min-width:90px;">Adversaire</label>
            <input id="match-opponent" placeholder="Nom de l'adversaire" style="flex:1;" />
          </div>
          <div style="display:flex;gap:8px;margin:8px 0;">
            <div style="flex:1;">
              <label>Score A / Nous</label>
              <input id="match-score-left" type="number" min="0" value="0" />
            </div>
            <div style="flex:1;">
              <label>Score B / Eux</label>
              <input id="match-score-right" type="number" min="0" value="0" />
            </div>
          </div>
          <div style="margin-top:8px;">
            <h4 style="margin:6px 0;">Buteurs</h4>
            <div id="match-scorers-list" style="display:flex;flex-direction:column;gap:6px;"></div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:6px;">
              <select id="match-scorer-player" style="flex:1;"></select>
              <select id="match-scorer-team" style="width:120px;"><option value="A">Équipe A/Nous</option><option value="B">Équipe B/Eux</option></select>
              <input id="match-scorer-minute" type="number" min="0" placeholder="Min" style="width:90px;"/>
              <button class="btn" id="match-add-scorer">Ajouter</button>
            </div>
          </div>
        </div>
        <!-- Right: squads -->
        <div style="flex:1 1 460px;min-width:340px;">
          <h4 style="margin:6px 0;">Effectifs</h4>
          <div id="match-squads" style="display:grid;grid-template-columns:repeat(2,minmax(160px,1fr));gap:8px;"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button class="btn" id="match-save">Enregistrer</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el.firstElementChild);
}

function summarizeName(p) {
  return `${capitalize(p.first_name)} ${capitalize(p.last_name).slice(0, 1)}.`;
}

function openMatchModal(dateIso, dayItem, players, onSaved, existingModel) {
  ensureMatchDom();
  const modal = document.getElementById("match-modal");
  const closeBtn = document.getElementById("match-close");
  const title = document.getElementById("match-title");
  const kindInfo = document.getElementById("match-kind-info");
  const plateauRow = document.getElementById("match-plateau-row");
  const inpOpp = document.getElementById("match-opponent");
  const scoreL = document.getElementById("match-score-left");
  const scoreR = document.getElementById("match-score-right");
  const squads = document.getElementById("match-squads");
  const scorersList = document.getElementById("match-scorers-list");
  const selScorer = document.getElementById("match-scorer-player");
  const selTeam = document.getElementById("match-scorer-team");
  const inpMinute = document.getElementById("match-scorer-minute");
  const btnAddScorer = document.getElementById("match-add-scorer");
  const btnSave = document.getElementById("match-save");

  const isTraining = (dayItem.weekday === "mercredi") || (dayItem.weekday === "samedi" && dayItem.type === "entrainement");
  const isPlateau = (dayItem.weekday === "samedi" && dayItem.type === "plateau");

  title.textContent = `Match — ${dateIso}`;
  kindInfo.textContent = isTraining ? "Match d'entraînement (A vs B)" : (isPlateau ? "Match de plateau (Nous vs Adversaire)" : "Match");
  plateauRow.style.display = isPlateau ? "flex" : "none";

  // seed model from existingModel if provided, else fallback to dayItem.match
  let model = existingModel ? JSON.parse(JSON.stringify(existingModel))
    : (dayItem.match && typeof dayItem.match === 'object' ? JSON.parse(JSON.stringify(dayItem.match)) : null);
  if (!model) {
    model = isTraining ? {
      kind: 'training',
      teamA: { starters: [], subs: [], score: 0 },
      teamB: { starters: [], subs: [], score: 0 },
      scorers: []
    } : {
      kind: 'plateau',
      opponent: dayItem.plateauLieu || '',
      our: { starters: [], subs: [] },
      score: { us: 0, them: 0 },
      scorers: []
    };
  }

  // fill score + opponent
  if (isTraining) {
    scoreL.value = Number(model.teamA?.score || 0);
    scoreR.value = Number(model.teamB?.score || 0);
    selTeam.innerHTML = `<option value="A">Équipe A</option><option value="B">Équipe B</option>`;
  } else {
    scoreL.value = Number(model.score?.us || 0);
    scoreR.value = Number(model.score?.them || 0);
    selTeam.innerHTML = `<option value="A">Nous</option><option value="B">Eux</option>`;
    inpOpp.value = model.opponent || dayItem.opponent || '';
  }

  // populate player select
  selScorer.innerHTML = players.map(p => `<option value="${p.id}">${summarizeName(p)}</option>`).join("");

  function renderScorers() {
    scorersList.innerHTML = "";
    const arr = Array.isArray(model.scorers) ? model.scorers : [];
    if (!arr.length) {
      const p = document.createElement('div');
      p.textContent = "Aucun buteur";
      p.style.color = '#6b7280';
      scorersList.appendChild(p);
      return;
    }
    arr.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'att-row';
      const left = document.createElement('div');
      left.className = 'att-left';
      const p = players.find(pp => pp.id === s.player_id);
      const who = p ? summarizeName(p) : s.player_id;
      left.innerHTML = `<div class="att-name">${who}</div><div class="roster-meta">${s.team === 'A' ? 'A/Nous' : 'B/Eux'} ${s.minute != null ? `· ${s.minute}\'` : ''}</div>`;
      const right = document.createElement('div');
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Suppr.';
      del.onclick = () => { model.scorers.splice(idx, 1); renderScorers(); };
      right.appendChild(del);
      row.appendChild(left); row.appendChild(right);
      scorersList.appendChild(row);
    });
  }

  function squadBox(title, list, onToggle) {
    const box = document.createElement('div');
    box.className = 'card';
    const h = document.createElement('h4'); h.textContent = title; h.style.marginTop = '0';
    box.appendChild(h);
    const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '6px';
    players.forEach(p => {
      const id = `sq_${title}_${p.id}`;
      const line = document.createElement('label'); line.style.display = 'flex'; line.style.alignItems = 'center'; line.style.gap = '6px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = list.includes(p.id);
      cb.onchange = () => onToggle(p.id, cb.checked);
      const span = document.createElement('span'); span.textContent = summarizeName(p);
      line.appendChild(cb); line.appendChild(span);
      wrap.appendChild(line);
    });
    box.appendChild(wrap);
    return box;
  }

  // render squads
  squads.innerHTML = '';
  if (isTraining) {
    const aStar = model.teamA.starters || [], aSubs = model.teamA.subs || [];
    const bStar = model.teamB.starters || [], bSubs = model.teamB.subs || [];
    squads.appendChild(squadBox('A - Titulaires', aStar, (pid, on) => { toggleList(aStar, pid, on); model.teamA.starters = aStar; }));
    squads.appendChild(squadBox('A - Remplaçants', aSubs, (pid, on) => { toggleList(aSubs, pid, on); model.teamA.subs = aSubs; }));
    squads.appendChild(squadBox('B - Titulaires', bStar, (pid, on) => { toggleList(bStar, pid, on); model.teamB.starters = bStar; }));
    squads.appendChild(squadBox('B - Remplaçants', bSubs, (pid, on) => { toggleList(bSubs, pid, on); model.teamB.subs = bSubs; }));
  } else {
    const ourStar = model.our.starters || [], ourSubs = model.our.subs || [];
    squads.appendChild(squadBox('Nous - Titulaires', ourStar, (pid, on) => { toggleList(ourStar, pid, on); model.our.starters = ourStar; }));
    squads.appendChild(squadBox('Nous - Remplaçants', ourSubs, (pid, on) => { toggleList(ourSubs, pid, on); model.our.subs = ourSubs; }));
  }

  function toggleList(arr, id, on) {
    const idx = arr.indexOf(id);
    if (on && idx === -1) arr.push(id);
    if (!on && idx !== -1) arr.splice(idx, 1);
  }

  btnAddScorer.onclick = () => {
    const pid = selScorer.value;
    const team = selTeam.value === 'B' ? 'B' : 'A';
    const minute = inpMinute.value ? parseInt(inpMinute.value, 10) : null;
    if (!pid) return;
    model.scorers.push({ player_id: pid, team, minute });
    renderScorers();
    inpMinute.value = '';
  };

  renderScorers();

  // save
  btnSave.onclick = async () => {
    try {
      if (!model.id) model.id = uid();
      if (isTraining) {
        model.kind = 'training';
        model.teamA.score = parseInt(scoreL.value || '0', 10) || 0;
        model.teamB.score = parseInt(scoreR.value || '0', 10) || 0;
      } else {
        model.kind = 'plateau';
        model.score.us = parseInt(scoreL.value || '0', 10) || 0;
        model.score.them = parseInt(scoreR.value || '0', 10) || 0;
        model.opponent = (inpOpp.value || '').trim();
      }
      const r = await updateDay(dateIso, { matchUpsert: model });
      if (typeof onSaved === 'function') onSaved(r.calendar);
      close();
    } catch (e) { alert(e.message); }
  };

  function close() { modal.classList.remove('show'); modal.style.display = 'none'; }
  function backdropClose(ev) { if (ev.target === modal) close(); }
  closeBtn.onclick = close;
  modal.addEventListener('click', backdropClose);

  modal.style.display = 'flex';
  modal.classList.add('show');
}

function makeMatchBar(dateIso, dayItem, afterUpdate) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.justifyContent = 'space-between';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.margin = '8px 0';

  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.textContent = 'Matchs: —';
  wrap.appendChild(pill);

  function lastSummary() {
    const arr = Array.isArray(dayItem.matches) ? dayItem.matches : (dayItem.match ? [dayItem.match] : []);
    if (!arr.length) return 'Matchs: 0';
    const m = arr[arr.length - 1];
    if (m.kind === 'training') {
      const a = Number(m.teamA?.score || 0), b = Number(m.teamB?.score || 0);
      return `Dernier: A–B ${a}-${b} · Total ${arr.length}`;
    } else {
      const us = Number(m.score?.us || 0), them = Number(m.score?.them || 0);
      const opp = m.opponent ? ` vs ${m.opponent}` : '';
      return `Dernier:${opp} ${us}-${them} · Total ${arr.length}`;
    }
  }
  pill.textContent = lastSummary();

  const btn = document.createElement('button');
  btn.className = 'btn'; btn.textContent = 'Gérer les matchs';
  btn.onclick = async () => {
    try {
      const players = await __loadPlayersSafe();
      openMatchesManager(dateIso, dayItem, players, (cal) => {
        if (cal && typeof afterUpdate === 'function') afterUpdate(cal);
        if (cal) {
          const updated = (cal.items || []).find(x => x.date === dateIso);
          if (updated) Object.assign(dayItem, updated);
        }
        pill.textContent = lastSummary();
      });
    } catch (e) { alert(e.message); }
  };
  wrap.appendChild(btn);

  return wrap;
}

// Gestionnaire de la liste des matchs (modale)
function openMatchesManager(dateIso, dayItem, players, onSaved) {
  // Simple manager using the existing chooser modal structure
  ensureChooserDom();
  const modal = document.getElementById('chooser');
  const titleEl = document.getElementById('chooser-title');
  const grid = document.getElementById('chooser-grid');
  const search = document.getElementById('chooser-search');
  const closeBtn = document.getElementById('chooser-close');

  function close() { modal.classList.remove('show'); modal.style.display = 'none'; }

  titleEl.textContent = `Matchs — ${dateIso}`;
  search.placeholder = 'Rechercher adversaire / type...';

  function summarize(m) {
    if (m.kind === 'training') {
      return `Entraînement · A–B ${Number(m.teamA?.score || 0)}-${Number(m.teamB?.score || 0)}`;
    } else {
      return `Plateau · ${m.opponent || 'Adversaire ?'} · ${Number(m.score?.us || 0)}-${Number(m.score?.them || 0)}`;
    }
  }

  function renderList(q = '') {
    grid.innerHTML = '';
    const list = Array.isArray(dayItem.matches) ? [...dayItem.matches] : (dayItem.match ? [dayItem.match] : []);
    const ql = q.trim().toLowerCase();
    list
      .filter(m => !ql || summarize(m).toLowerCase().includes(ql))
      .forEach(m => {
        const card = document.createElement('div');
        card.className = 'item';
        card.innerHTML = `<div class="band"></div><h3>${summarize(m)}</h3>`;
        const row = document.createElement('div');
        row.style.display = 'flex'; row.style.gap = '6px';

        const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'Modifier';
        edit.onclick = () => {
          close();
          openMatchModal(dateIso, dayItem, players, (cal) => { if (typeof onSaved === 'function') onSaved(cal); }, m);
        };

        const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Supprimer';
        del.onclick = async () => {
          if (!confirm('Supprimer ce match ?')) return;
          try {
            const r = await updateDay(dateIso, { matchDeleteId: m.id });
            if (typeof onSaved === 'function') onSaved(r.calendar);
            // refresh local snapshot
            if (r.calendar) {
              const updated = (r.calendar.items || []).find(x => x.date === dateIso);
              if (updated) Object.assign(dayItem, updated);
            }
            renderList(search.value);
          } catch (e) { alert(e.message); }
        };

        row.appendChild(edit); row.appendChild(del);
        card.appendChild(row);
        grid.appendChild(card);
      });

    // Bouton Nouveau
    const addCard = document.createElement('div');
    addCard.className = 'item';
    const h = document.createElement('h3'); h.textContent = 'Nouveau match';
    const p = document.createElement('p'); p.textContent = 'Créer un match d\'entraînement (A/B) ou de plateau (Nous vs adv.)';
    const addTrain = document.createElement('button'); addTrain.className = 'btn'; addTrain.textContent = 'Match d\'entrainement';
    addTrain.onclick = () => { close(); dayItem.match = { id: uid(), kind: 'training', teamA: { starters: [], subs: [], score: 0 }, teamB: { starters: [], subs: [], score: 0 }, scorers: [] }; openMatchModal(dateIso, dayItem, players, onSaved, dayItem.match); };
    const addPlat = document.createElement('button'); addPlat.className = 'btn'; addPlat.textContent = 'Match de plateau';
    addPlat.onclick = () => { close(); dayItem.match = { id: uid(), kind: 'plateau', opponent: '', our: { starters: [], subs: [] }, score: { us: 0, them: 0 }, scorers: [] }; openMatchModal(dateIso, dayItem, players, onSaved, dayItem.match); };
    addCard.appendChild(h); addCard.appendChild(p); addCard.appendChild(addTrain); addCard.appendChild(addPlat);
    grid.appendChild(addCard);
  }

  closeBtn.onclick = close;
  search.oninput = () => renderList(search.value);

  renderList();
  modal.style.display = 'flex'; modal.classList.add('show');
}

async function updatePlayer(id, first_name, last_name) {
  const r = await fetch(`/api/players/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_name, last_name })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "Erreur mise à jour");
  }
  return (await r.json()).player;
}

// Retourne un tableau de { id, display, full } où display suit la règle : "Prénom N." (ou plus de lettres si prénoms identiques)
function computeRosterDisplay(players) {
  const byFirst = new Map();
  players.forEach(p => {
    const key = (p.first_name || "").trim().toLowerCase();
    if (!byFirst.has(key)) byFirst.set(key, []);
    byFirst.get(key).push(p);
  });

  const out = [];
  for (const group of byFirst.values()) {
    if (group.length === 1) {
      const p = group[0];
      const dn = `${capitalize(p.first_name)} ${capitalize(p.last_name).slice(0, 1)}.`;
      out.push({ id: p.id, display: dn, full: `${capitalize(p.first_name)} ${capitalize(p.last_name)}` });
      continue;
    }
    // Plusieurs joueurs avec le même prénom : on étend la longueur de l'initiale jusqu'à unicité
    const lastNames = group.map(p => (p.last_name || "").trim());
    const maxLen = Math.max(...lastNames.map(s => s.length));
    let k = 1;
    while (k <= maxLen) {
      const seen = new Set();
      const collision = group.some(p => {
        const key = (p.last_name || "").slice(0, k).toLowerCase();
        const dup = seen.has(key);
        seen.add(key);
        return dup;
      });
      if (!collision) break;
      k++;
    }
    // construire les affichages
    const seen2 = new Map();
    group.forEach(p => {
      const base = (p.last_name || "");
      let prefix = capitalize(base).slice(0, Math.max(1, k));
      if (!prefix) prefix = "";
      let label = `${capitalize(p.first_name)} ${prefix}${prefix ? "." : ""}`;
      // si même prénom ET même préfixe (même nom), suffixer un compteur
      const skey = `${p.first_name.toLowerCase()}|${prefix.toLowerCase()}`;
      const num = (seen2.get(skey) || 0) + 1;
      seen2.set(skey, num);
      if (num > 1) label = `${label}${num}`;
      out.push({ id: p.id, display: label, full: `${capitalize(p.first_name)} ${capitalize(p.last_name)}` });
    });
  }
  // conserver l'ordre d'entrée
  const order = new Map(players.map((p, i) => [p.id, i]));
  out.sort((a, b) => (order.get(a.id) - order.get(b.id)));
  return out;
}

async function loadPlayers() {
  const r = await fetch("/api/players", { cache: "no-store" });
  if (!r.ok) throw new Error("Erreur chargement effectif");
  const j = await r.json();
  return j.players || [];
}

// Fallback loader for players (used by attendance bar)
async function __loadPlayersSafe() {
  if (typeof loadPlayers === "function") return await loadPlayers();
  const r = await fetch("/api/players", { cache: "no-store" });
  if (!r.ok) throw new Error("Erreur chargement effectif");
  const j = await r.json();
  return j.players || [];
}

async function addPlayer(first_name, last_name) {
  const r = await fetch("/api/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_name, last_name })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "Erreur ajout");
  }
  return (await r.json()).player;
}

async function deletePlayer(id) {
  const r = await fetch(`/api/players/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || "Erreur suppression");
  }
  return true;
}

function renderRosterList(players) {
  const list = document.getElementById("roster-list");
  if (!list) return;
  list.innerHTML = "";

  const display = computeRosterDisplay(players);
  const map = new Map(players.map(p => [p.id, p]));

  display.forEach(d => {
    const p = map.get(d.id);
    const row = document.createElement("div");
    row.className = "roster-item";

    const left = document.createElement("div");
    left.innerHTML = `<div class="roster-name">${d.display}</div>
                      <div class="roster-meta">${d.full}</div>`;
    const right = document.createElement("div");

    // boutons / inputs pour édition inline
    let editMode = false;
    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.textContent = "Modifier";

    const btnSave = document.createElement("button");
    btnSave.className = "btn";
    btnSave.textContent = "Enregistrer";
    btnSave.style.display = "none";

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn";
    btnCancel.textContent = "Annuler";
    btnCancel.style.display = "none";

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "Suppr.";

    const inFirst = document.createElement("input");
    const inLast = document.createElement("input");
    inFirst.style.display = "none";
    inLast.style.display = "none";
    inFirst.placeholder = "Prénom";
    inLast.placeholder = "Nom";
    inFirst.value = p.first_name || "";
    inLast.value = p.last_name || "";

    function setEdit(on) {
      editMode = on;
      // inputs visibles en mode édition
      inFirst.style.display = inLast.style.display = on ? "inline-block" : "none";
      // boutons
      btnEdit.style.display = on ? "none" : "inline-block";
      btnSave.style.display = btnCancel.style.display = on ? "inline-block" : "none";
      // texte
      left.innerHTML = on
        ? `<div class="roster-meta">Édition de ${d.full}</div>`
        : `<div class="roster-name">${d.display}</div><div class="roster-meta">${d.full}</div>`;
    }

    btnEdit.onclick = () => setEdit(true);
    btnCancel.onclick = () => {
      inFirst.value = p.first_name || "";
      inLast.value = p.last_name || "";
      setEdit(false);
    };
    btnSave.onclick = async () => {
      const fn = (inFirst.value || "").trim();
      const ln = (inLast.value || "").trim();
      if (!fn || !ln) return alert("Prénom et nom requis");
      try {
        await updatePlayer(p.id, fn, ln);
        const refreshed = await loadPlayers();
        renderRosterList(refreshed);
      } catch (e) { alert(e.message); }
    };
    del.onclick = async () => {
      if (!confirm(`Supprimer ${d.full} ?`)) return;
      try {
        await deletePlayer(p.id);
        const refreshed = await loadPlayers();
        renderRosterList(refreshed);
      } catch (e) { alert(e.message); }
    };

    right.style.display = "flex"; right.style.gap = "6px"; right.style.flexWrap = "wrap";
    right.appendChild(inFirst);
    right.appendChild(inLast);
    right.appendChild(btnSave);
    right.appendChild(btnCancel);
    right.appendChild(btnEdit);
    right.appendChild(del);
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });

  if (players.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Aucun joueur/joueuse pour le moment.";
    p.style.color = "#6b7280";
    list.appendChild(p);
  }
}

function wireRosterForm() {
  const iF = document.getElementById("rf-first");
  const iL = document.getElementById("rf-last");
  const btn = document.getElementById("rf-add");
  if (!iF || !iL || !btn) return;

  btn.onclick = async () => {
    const fn = (iF.value || "").trim();
    const ln = (iL.value || "").trim();
    if (!fn || !ln) return alert("Prénom et nom requis");
    try {
      await addPlayer(fn, ln);
      iF.value = ""; iL.value = "";
      const refreshed = await loadPlayers();
      renderRosterList(refreshed);
    } catch (e) { alert(e.message); }
  };
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
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      const view = document.getElementById(tab.dataset.target);
      if (view) view.classList.add('active');
      updateFabVisibility();
      if (tab.dataset.target === 'view-stats' && typeof renderStatsPage === 'function') {
        renderStatsPage();
      }
    });
  });
}

// Stats view (Plateaux & Entraînements)
// -----------------------
function renderStatsPage() {
  const root = document.getElementById('view-stats');
  if (!root) return;
  root.innerHTML = `<div class="card"><h3>Statistiques</h3><p id="stats-status">Chargement…</p></div>`;

  fetch('/api/stats', { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('Erreur chargement des statistiques'); return r.json(); })
    .then(data => {
      const emptyStats = { results: { wins: 0, draws: 0, losses: 0 }, countMatches: 0, topScorers: [] };
      const plat = data.plateau || emptyStats;
      const ent = data.training || { countMatches: 0, topScorers: [] };

      const kpiPlateau = (s) => `
        <div class="kpis">
          <span class="pill">Victoires: ${s.results?.wins || 0}</span>
          <span class="pill">Nuls: ${s.results?.draws || 0}</span>
          <span class="pill">Défaites: ${s.results?.losses || 0}</span>
          <span class="pill">Matches: ${s.countMatches || 0}</span>
        </div>`;
      const kpiTraining = (s) => `
        <div class="kpis">
          <span class="pill">Séances: ${s.countMatches || 0}</span>
        </div>`;
      const scorersList = (s) => {
        const arr = Array.isArray(s.topScorers) ? s.topScorers : [];
        if (!arr.length) return '<p>Aucun buteur pour l\u2019instant.</p>';
        return `<ol class="scorers">${arr.map(x => `<li>${x.name} — ${x.goals}</li>`).join('')}</ol>`;
      };

      root.innerHTML = `
        <div class="card">
          <h3>Plateaux</h3>
          ${kpiPlateau(plat)}
          <h4>Meilleurs buteurs</h4>
          ${scorersList(plat)}
        </div>
        <div class="card">
          <h3>Entraînements</h3>
          ${kpiTraining(ent)}
          <h4>Meilleurs buteurs</h4>
          ${scorersList(ent)}
          <p class="roster-meta">Les V/N/D ne sont pas comptés pour les entraînements.</p>
        </div>`;
    })
    .catch(e => {
      root.innerHTML = `<div class="card"><h3>Statistiques</h3><p style="color:#b91c1c;">${e.message || 'Erreur de chargement'}</p></div>`;
    });
}

// -----------------------

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
  const isPlateau = (it.weekday === "samedi" && it.type === "plateau");

  // --- Contrôles 'samedi' quand on est en mode entraînement ---
  if (isTraining && it.weekday === "samedi") {
    const saturdayBar = document.createElement("div");
    saturdayBar.style.display = "flex";
    saturdayBar.style.gap = "8px";
    saturdayBar.style.marginBottom = "8px";

    const info = document.createElement("div");
    info.className = "pill";
    info.textContent = "Samedi — Entraînement";
    saturdayBar.appendChild(info);

    const btnToPlateau = document.createElement("button");
    btnToPlateau.className = "btn";
    btnToPlateau.textContent = "Basculer en plateau…";
    btnToPlateau.onclick = async () => {
      const lieu = prompt("Lieu du plateau :", it.plateauLieu || "");
      if (lieu === null) return;
      try {
        const { calendar: cal } = await updateDay(it.date, { type: "plateau", plateauLieu: (lieu || "").trim() });
        rerenderAll(cal);
      } catch (e) { alert(e.message); }
    };
    saturdayBar.appendChild(btnToPlateau);

    const btnToLibre = document.createElement("button");
    btnToLibre.className = "btn";
    btnToLibre.textContent = "Basculer en libre";
    btnToLibre.onclick = async () => {
      if (!confirm("Basculer ce samedi en 'libre' ? Le plan de séance sera vidé.")) return;
      try {
        const { calendar: cal } = await updateDay(it.date, { type: "libre" });
        rerenderAll(cal);
      } catch (e) { alert(e.message); }
    };
    saturdayBar.appendChild(btnToLibre);

    card.appendChild(saturdayBar);

    // Résumé présences (mercredi et samedi entraînement)
    if (isTraining) {
      const attBar = makeAttendanceBar(it.date);
      card.appendChild(attBar);
    }
    // Barre Match (entraînement)
    card.appendChild(makeMatchBar(it.date, it, (cal) => { if (cal) rerenderAll(cal); }));
  }

  if (!isTraining) {
    const p = document.createElement("p");
    p.textContent = it.weekday === "samedi" ? `Samedi : ${it.type || "libre"}` : "Aucune séance";
    card.appendChild(p);

    if (it.weekday === "samedi") {
      // Détails 'plateau' (lieu + édition)
      if (it.type === "plateau") {
        const loc = document.createElement("p");
        loc.innerHTML = `Lieu du plateau : <strong>${it.plateauLieu || "—"}</strong>`;
        card.appendChild(loc);

        // Résumé présences pour plateau
        const attBar = makeAttendanceBar(it.date);
        card.appendChild(attBar);

        // Barre Match (plateau)
        card.appendChild(makeMatchBar(it.date, it, (cal) => { if (cal) rerenderAll(cal); }));

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.marginTop = "6px";

        const btnLieu = document.createElement("button");
        btnLieu.className = "btn";
        btnLieu.textContent = "Modifier le lieu";
        btnLieu.onclick = async () => {
          const nv = prompt("Nouveau lieu du plateau :", it.plateauLieu || "");
          if (nv === null) return;
          try {
            const { calendar: cal } = await updateDay(it.date, { type: "plateau", plateauLieu: (nv || "").trim() });
            rerenderAll(cal);
          } catch (e) { alert(e.message); }
        };
        row.appendChild(btnLieu);

        card.appendChild(row);
      }

      // Actions de bascule (entrainement / plateau / libre)
      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "8px";

      const btnToTraining = document.createElement("button");
      btnToTraining.className = "btn";
      btnToTraining.textContent = "Basculer en entraînement";
      btnToTraining.onclick = async () => {
        try { const { calendar: cal } = await updateDay(it.date, { type: "entrainement" }); rerenderAll(cal); }
        catch (e) { alert(e.message); }
      };
      actions.appendChild(btnToTraining);

      const btnToPlateau = document.createElement("button");
      btnToPlateau.className = "btn";
      btnToPlateau.textContent = "Basculer en plateau…";
      btnToPlateau.onclick = async () => {
        const lieu = prompt("Lieu du plateau :", it.plateauLieu || "");
        if (lieu === null) return;
        try {
          const { calendar: cal } = await updateDay(it.date, { type: "plateau", plateauLieu: (lieu || "").trim() });
          rerenderAll(cal);
        } catch (e) { alert(e.message); }
      };
      actions.appendChild(btnToPlateau);

      const btnToLibre = document.createElement("button");
      btnToLibre.className = "btn";
      btnToLibre.textContent = "Basculer en libre";
      btnToLibre.onclick = async () => {
        try {
          const { calendar: cal } = await updateDay(it.date, { type: "libre" });
          rerenderAll(cal);
        } catch (e) { alert(e.message); }
      };
      actions.appendChild(btnToLibre);

      card.appendChild(actions);
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

  // Résumé présences (mercredi et samedi entraînement)
  if (isTraining) {
    const attBar = makeAttendanceBar(it.date);
    card.appendChild(attBar);
    // Barre Match (entraînement / fin de carte)
    card.appendChild(makeMatchBar(it.date, it, (cal) => { if (cal) rerenderAll(cal); }));
  }

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


  let roster = [];
  async function refreshRoster() {
    try { roster = await loadPlayers(); renderRosterList(roster); }
    catch (e) { console.warn("Effectif: ", e.message); }
  }

  // Quand on clique l’onglet Effectif, on (re)charge
  document.querySelector('.tab[data-target="view-effectif"]')?.addEventListener("click", refreshRoster);

  // Premier wiring du formulaire
  wireRosterForm();

  // Optionnel: charger immédiatement une première fois
  refreshRoster();

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
