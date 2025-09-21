// server.js
require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());
const path = require("path");

const { ensureTable, getJSON, setJSON, useFs } = require("./db");
const { pool } = require("./db");
// --- Bornes de saison ---
const START_DATE = "2025-09-03";
const END_DATE = "2026-07-01";

// ===== Stats / Club config =====
const CLUB_NAME = process.env.CLUB_NAME || "Mon Club U8";
// Pour compter V/N/D sur un entraînement interne (matchs en 2 équipes),
// choisis le côté que l'on considère comme "nous" : "teamA" | "teamB" | null
const TRAINING_INTERNAL_CLUB_SIDE = process.env.TRAINING_INTERNAL_CLUB_SIDE || null;
// =================================

// --- Utilitaires date ---
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const toUTCDate = (yyyymmdd) => {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toYYYYMMDD = (date) => date.toISOString().slice(0, 10);

// Liste tous les mercredis + samedis inclus
function listTrainingDays(startStr, endStr) {
  const start = toUTCDate(startStr);
  const end = toUTCDate(endStr);
  const out = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    const dow = d.getUTCDay(); // 0=dim..6=sam
    if (dow === 3 || dow === 6) {
      out.push({
        date: toYYYYMMDD(d),
        weekday: dow === 3 ? "mercredi" : "samedi",
      });
    }
  }
  return out;
}

// --- Construit un plan de séance type ---
function makePlan(jeu, entrainement, mobilite) {
  const steps = [
    {
      type: "echauffement", label: "Échauffement", minutes: 10,
      details: { description: "Activation générale + mobilité", materiel: [] }
    },
    {
      type: "mobilite", label: "Mobilité", minutes: 10,
      details: mobilite ? { id: mobilite.id, nom: mobilite.nom, description: mobilite.description } :
        { nom: "non défini", description: "" }
    },
    {
      type: "individuel", label: "Entrainement individuel", minutes: 10,
      details: entrainement ? { id: entrainement.id, nom: entrainement.nom, description: entrainement.description } :
        { nom: "non défini", description: "" }
    },
    {
      type: "jeu", label: "Jeu collectif", minutes: 10,
      details: jeu ? { id: jeu.id, nom: jeu.nom, description: jeu.description } :
        { nom: "non défini", description: "" }
    },
    {
      type: "tactique", label: "Tactique", minutes: 5,
      details: { description: "Principe du jour (placement, pressing, relance courte)" }
    },
    {
      type: "match_assiste", label: "Match assisté", minutes: 10,
      details: { description: "Coaching direct sur consignes du jour" }
    },
    {
      type: "match", label: "Match", minutes: 10,
      details: { description: "Jeu libre pour ancrer les automatismes" }
    },
  ];
  let t = 0;
  return steps.map(s => {
    const withTimes = { ...s, startMin: t, endMin: t + s.minutes };
    t += s.minutes;
    return withTimes;
  });
}

// --- Construit le calendrier initial ---
function buildCalendar(catalog, startDate = START_DATE, endDate = END_DATE) {
  const dates = listTrainingDays(startDate, endDate);
  const jeux = catalog.jeuxFoot;
  const entr = catalog.entrainements;
  const mobi = catalog.mobilite;        // 🆕
  if (!Array.isArray(mobi) || mobi.length === 0) {
    throw new Error("catalog.mobilite est requis et ne doit pas être vide");
  }

  const items = dates.map((d, i) => {
    if (d.weekday === "mercredi") {
      const j = jeux[i % jeux.length];
      const e = entr[i % entr.length];
      const m = mobi[i % mobi.length];  // 🆕
      const plan = makePlan(j, e, m);
      return {
        date: d.date,
        weekday: "mercredi",
        totalMinutes: plan[plan.length - 1].endMin,
        jeu: { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel },
        entrainement: { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel },
        mobilite: { id: m.id, nom: m.nom, description: m.description, materiel: m.materiel }, // 🆕
        plan,
        cancelled: { is: false, reason: null },
      };
    } else {
      return {
        date: d.date,
        weekday: "samedi",
        type: "libre",
        lieu: null,
        cancelled: { is: false, reason: null },
      };
    }
  });

  return { generatedAt: new Date().toISOString(), startDate, endDate, total: items.length, items };
}

// --- Met à jour un jour ---
function findDay(calendar, dateStr) {
  return calendar.items.find((x) => x.date === dateStr);
}

function updateDay(calendar, catalog, dateStr, { jeuId, entrainementId, mobiliteId, type, plateauLieu }) {
  const day = findDay(calendar, dateStr);
  if (!day) throw new Error("Date non trouvée dans le calendrier");

  // 1) Gestion du type pour les samedis (entrainement / plateau / libre)
  if (typeof type === "string") {
    if (["entrainement", "plateau", "libre"].includes(type)) {
      day.type = type;
      if (type !== "entrainement") {
        // Si pas un entrainement, on n'utilise pas de plan
        day.plan = [];
      }
      if (type === "plateau") {
        day.plateauLieu = plateauLieu || day.plateauLieu || "";
      } else {
        delete day.plateauLieu;
      }
    } else {
      throw new Error("type invalide (attendu: entrainement | plateau | libre)");
    }
  }

  // 2) Appliquer les choix d'IDs s'ils existent
  if (jeuId) {
    const j = catalog.jeuxFoot.find(x => x.id === jeuId);
    if (!j) throw new Error("jeuId inconnu");
    day.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel, diagram: j.diagram };
  }
  if (entrainementId) {
    const e = catalog.entrainements.find(x => x.id === entrainementId);
    if (!e) throw new Error("entrainementId inconnu");
    day.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel, diagram: e.diagram };
  }
  if (mobiliteId) {
    const m = (catalog.mobilite || []).find(x => x.id === mobiliteId);
    if (!m) throw new Error("mobiliteId inconnu");
    day.mobilite = { id: m.id, nom: m.nom, description: m.description, materiel: m.materiel, diagram: m.diagram };
  }

  // 3) Recalcul du plan uniquement si c'est une séance d'entraînement active
  const isTraining =
    day.cancelled?.is ? false :
      (day.weekday === "mercredi") || (day.weekday === "samedi" && day.type === "entrainement");

  if (isTraining) {
    const j = day.jeu || null;
    const e = day.entrainement || null;
    const m = day.mobilite || null;
    day.plan = makePlan(j, e, m);
    day.totalMinutes = day.plan.length ? day.plan[day.plan.length - 1].endMin : 0;
  } else {
    // pas d'entrainement -> pas de plan
    day.plan = [];
    day.totalMinutes = 0;
  }

  return day;
}

// --- Helpers stats ---

// Sanitize scorer labels for stats
function normalizeScorerLabel(scorer) {
  try {
    if (scorer == null) return 'Inconnu';
    if (typeof scorer === 'string') return scorer || 'Inconnu';
    if (typeof scorer === 'number' || typeof scorer === 'boolean') return String(scorer);
    // Objects: try common shapes
    if (typeof scorer === 'object') {
      if (typeof scorer.name === 'string' && scorer.name.trim()) return scorer.name.trim();
      const fn = typeof scorer.first_name === 'string' ? scorer.first_name.trim() : '';
      const ln = typeof scorer.last_name === 'string' ? scorer.last_name.trim() : '';
      if (fn || ln) return (fn + ' ' + ln).trim();
      if (typeof scorer.id === 'string' || typeof scorer.id === 'number') return String(scorer.id);
      return JSON.stringify(scorer);
    }
    return 'Inconnu';
  } catch { return 'Inconnu'; }
}

// Resolve scorer display name using DB-loaded players map if available
function resolveScorerName(scorer, playersById) {
  // If scorer is already a string/number/bool, normalize and return
  if (typeof scorer === 'string' || typeof scorer === 'number' || typeof scorer === 'boolean') {
    return normalizeScorerLabel(scorer);
  }
  if (scorer && typeof scorer === 'object') {
    // If scorer carries a player_id, prefer the DB mapping
    if (scorer.player_id && playersById && playersById.has(scorer.player_id)) {
      return playersById.get(scorer.player_id);
    }
    // Otherwise fallback to name/first_name/last_name/id logic
    return normalizeScorerLabel(scorer);
  }
  return 'Inconnu';
}
function getFirstNumber(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

function normalizeForOutcomeFromMatch(match, playersById, playerNamesSet, type) {
  // 1) Score explicite (le plus fiable)
  if (typeof match?.ourScore === 'number' && typeof match?.theirScore === 'number') {
    return { hasOutcome: true, us: match.ourScore, them: match.theirScore, src: 'explicit_scores' };
  }
  // 1.b Score explicite via objet `score` { us, them }
  if (typeof match?.score?.us === 'number' && typeof match?.score?.them === 'number') {
    return { hasOutcome: true, us: match.score.us, them: match.score.them, src: 'score_object' };
  }
  // 2) Entraînement interne (deux équipes) – pas de V/N/D en UI, mais on renvoie us/them si côté défini
  if (match && match.teamA && match.teamB) {
    if (TRAINING_INTERNAL_CLUB_SIDE === 'teamA') return { hasOutcome: true, us: match.teamA.score || 0, them: match.teamB.score || 0, src: 'internal_teams' };
    if (TRAINING_INTERNAL_CLUB_SIDE === 'teamB') return { hasOutcome: true, us: match.teamB.score || 0, them: match.teamA.score || 0, src: 'internal_teams' };
    return { hasOutcome: false, src: 'internal_no_side' };
  }

  // 3) Formats alternatifs numériques (plateaux)
  let usNum = 0, themNum = 0;
  // top-level numeric hints
  usNum += getFirstNumber(match, ['ourGoals', 'goalsFor', 'scoreFor', 'us']);
  themNum += getFirstNumber(match, ['theirGoals', 'goalsAgainst', 'scoreAgainst', 'them', 'opponentGoals', 'conceded']);
  // nested under score {}
  usNum += getFirstNumber(match?.score || {}, ['ourGoals', 'goalsFor', 'scoreFor', 'us']);
  themNum += getFirstNumber(match?.score || {}, ['theirGoals', 'goalsAgainst', 'scoreAgainst', 'them', 'opponentGoals', 'conceded']);
  if (usNum + themNum > 0) return { hasOutcome: true, us: usNum, them: themNum, src: 'numeric_fallback' };

  // 4) Tableaux séparés
  let us = 0, them = 0;
  const sepUsKeys = ['ourScorers', 'scorersUs', 'buteurs', 'buteursNous'];
  const sepThemKeys = ['theirScorers', 'opponentScorers', 'adversaireScorers', 'butsAdverses', 'concededByUs'];
  for (const k of sepUsKeys) if (Array.isArray(match?.[k])) us += match[k].length;
  for (const k of sepThemKeys) if (Array.isArray(match?.[k])) them += match[k].length;
  if (us + them > 0) return { hasOutcome: true, us, them, src: 'separate_arrays' };

  // 5) Tableaux unifiés (events) : scorers, goals, events
  const unifiedArrays = [];
  if (Array.isArray(match?.scorers)) unifiedArrays.push(match.scorers);
  if (Array.isArray(match?.goals)) unifiedArrays.push(match.goals);
  if (Array.isArray(match?.events)) unifiedArrays.push(match.events.filter(ev => !ev.type || String(ev.type).toLowerCase() === 'goal'));

  if (unifiedArrays.length) {
    const maybeUsLabels = new Set(['us', 'nous', 'home', 'local', 'club', 'ours']);
    const maybeThemLabels = new Set(['them', 'adverse', 'away', 'visiteur', 'visitor', 'visitors', 'opponent', 'opp', 'ext']);

    for (const arr of unifiedArrays) {
      for (const ev of arr) {
        const ownGoal = !!(ev && (ev.own_goal === true || ev.ownGoal === true));
        const teamVal = ev && (ev.team ?? ev.side ?? ev.club ?? ev.for ?? ev.by);
        const tv = teamVal ? String(teamVal).toLowerCase() : '';
        const isUsTeam = maybeUsLabels.has(tv);
        const isThemTeam = maybeThemLabels.has(tv);
        const isOurId = !!(ev && ev.player_id && playersById && playersById.has(ev.player_id));

        if (type !== 'entrainement') { // V/N/D uniquement pour plateaux
          if (isUsTeam) {
            if (ownGoal) them++; else us++;
          } else if (isThemTeam) {
            if (ownGoal) us++; else them++;
          } else if (isOurId) {
            if (ownGoal) them++; else us++;
          } else if (typeof ev === 'string' || typeof ev === 'number' || typeof ev === 'boolean') {
            const label = String(ev).trim().toLowerCase();
            if (playerNamesSet && playerNamesSet.has(label)) us++; else them++;
          } else {
            // inconnu -> compter pour l'adversaire ; own_goal inverse
            if (ownGoal) us++; else them++;
          }
        }
      }
    }
    if (us + them > 0) return { hasOutcome: true, us, them, src: 'events_unified' };
  }

  return { hasOutcome: false, src: 'none' };
}

function collectScorersFromMatch(match, playersById) {
  // vs externe : privilégier ourScorers si présent, sinon filtrer scorers
  if (Array.isArray(match?.ourScorers) && match.ourScorers.length) {
    return match.ourScorers;
  }
  if (Array.isArray(match?.scorers) && match.scorers.length) {
    const ours = [];
    for (const ev of match.scorers) {
      if (ev && typeof ev === 'object' && ev.player_id && playersById && playersById.has(ev.player_id)) {
        ours.push(ev);
      } else if (ev && typeof ev === 'object') {
        const tv = ev.team ?? ev.side ?? ev.club ?? ev.for ?? ev.by;
        const ltv = tv ? String(tv).toLowerCase() : '';
        if (['us', 'nous', 'home', 'local', 'club', 'ours'].includes(ltv)) {
          ours.push(ev);
        }
      } else if (typeof ev === 'string' || typeof ev === 'number' || typeof ev === 'boolean') {
        ours.push(ev);
      }
    }
    return ours;
  }
  // entraînement interne : en fonction du côté suivi, sinon on agrège les deux
  if (match && match.teamA && match.teamB) {
    if (TRAINING_INTERNAL_CLUB_SIDE === 'teamA') return Array.isArray(match.teamA.scorers) ? match.teamA.scorers : [];
    if (TRAINING_INTERNAL_CLUB_SIDE === 'teamB') return Array.isArray(match.teamB.scorers) ? match.teamB.scorers : [];
    const a = Array.isArray(match.teamA.scorers) ? match.teamA.scorers : [];
    const b = Array.isArray(match.teamB.scorers) ? match.teamB.scorers : [];
    return [...a, ...b];
  }
  return [];
}

// Détermine le type d'un match ("plateau" | "entrainement") en s'appuyant
// d'abord sur match.type, sinon sur le contexte du jour.
function inferMatchType(match, day) {
  const mt = (match && typeof match.type === 'string') ? match.type : null;
  if (mt === 'plateau' || mt === 'entrainement') return mt;
  // Si le jour est un mercredi, on considère que c'est de l'entraînement
  if (day?.weekday === 'mercredi') return 'entrainement';
  // Si samedi avec day.type précisé, on le reprend
  if (day?.weekday === 'samedi' && (day.type === 'entrainement' || day.type === 'plateau')) return day.type;
  // Heuristique : présence d'un adversaire => plateau/externe
  if (match && (match.opponent || typeof match.theirScore === 'number')) return 'plateau';
  return 'entrainement';
}

function aggregateStatsOnCalendar(calendar, playersById, playerNamesSet) {
  if (!calendar || !Array.isArray(calendar.items)) {
    return {
      club: CLUB_NAME,
      trainingInternalSide: TRAINING_INTERNAL_CLUB_SIDE,
      training: { results: { wins: 0, draws: 0, losses: 0 }, countMatches: 0, topScorers: [] },
      plateau: { results: { wins: 0, draws: 0, losses: 0 }, countMatches: 0, topScorers: [] },
    };
  }
  const buckets = {
    entrainement: { wins: 0, draws: 0, losses: 0, countMatches: 0, scorerMap: new Map() },
    plateau: { wins: 0, draws: 0, losses: 0, countMatches: 0, scorerMap: new Map() },
  };

  const items = Array.isArray(calendar?.items) ? calendar.items : [];
  for (const day of items) {
    const matches = Array.isArray(day.matches) ? day.matches : [];
    for (const m of matches) {
      const type = inferMatchType(m, day);
      const bucket = buckets[type] || buckets.entrainement;
      bucket.countMatches++;

      const n = normalizeForOutcomeFromMatch(m, playersById, playerNamesSet, type);
      if (n.hasOutcome) {
        if (n.us > n.them) bucket.wins++;
        else if (n.us === n.them) bucket.draws++;
        else bucket.losses++;
      }

      const scorers = collectScorersFromMatch(m, playersById);
      for (const s of scorers) {
        const key = resolveScorerName(s, playersById);
        bucket.scorerMap.set(key, (bucket.scorerMap.get(key) || 0) + 1);
      }
    }
  }

  function finalizeBucket(bkt) {
    const topScorers = [...bkt.scorerMap.entries()]
      .sort((x, y) => (y[1] - x[1]) || String(x[0]).localeCompare(String(y[0])))
      .slice(0, 10)
      .map(([name, goals], i) => ({ rank: i + 1, name, goals }));
    return {
      results: { wins: bkt.wins, draws: bkt.draws, losses: bkt.losses },
      countMatches: bkt.countMatches,
      topScorers,
    };
  }

  return {
    club: CLUB_NAME,
    trainingInternalSide: TRAINING_INTERNAL_CLUB_SIDE,
    training: finalizeBucket(buckets.entrainement),
    plateau: finalizeBucket(buckets.plateau),
  };
}

app.use((req, res, next) => {
  if (req.path.startsWith("/api/catalog") || req.path.startsWith("/api/calendar")) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
  }
  next();
});

// --- ROUTES ---
// Catalog
app.get("/api/catalog", async (_req, res) => {
  try {
    await ensureTable();
    let catalog = await getJSON("catalog");
    if (!catalog) {
      return res.status(404).json({ error: "catalog absent. POST /api/catalog pour l'initialiser" });
    }
    res.json(catalog);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/catalog", async (req, res) => {
  try {
    const { jeuxFoot, entrainements, mobilite } = req.body || {};
    const validEntry = (x) => x && typeof x.id === "string" && typeof x.nom === "string" &&
      typeof x.description === "string" && Array.isArray(x.materiel);

    if (!Array.isArray(jeuxFoot) || !Array.isArray(entrainements) || !Array.isArray(mobilite)) {
      return res.status(400).json({ ok: false, error: "Format invalide: jeuxFoot[], entrainements[], mobilite[] requis" });
    }
    if (jeuxFoot.some(x => !validEntry(x)) || entrainements.some(x => !validEntry(x)) || mobilite.some(x => !validEntry(x))) {
      return res.status(400).json({ ok: false, error: "Chaque item doit avoir id, nom, description, materiel[]" });
    }

    await setJSON("catalog", { jeuxFoot, entrainements, mobilite });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Calendar
app.get("/api/calendar", async (_req, res) => {
  try {
    await ensureTable();
    let calendar = await getJSON("calendar");
    if (!calendar) {
      const catalog = await getJSON("catalog");
      if (!catalog) return res.status(400).json({ error: "catalog absent, initialisez-le avant" });
      calendar = buildCalendar(catalog);
      await setJSON("calendar", calendar);
    }
    res.json(calendar);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/players/:id  -> modifier prénom/nom
app.put("/api/players/:id", async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: "DB non initialisée" });
    const id = req.params.id;
    const fn = (req.body?.first_name || "").trim();
    const ln = (req.body?.last_name || "").trim();
    if (!fn || !ln) return res.status(400).json({ error: "Prénom et nom requis" });

    const { rows } = await pool.query(
      `UPDATE players
         SET first_name = $1, last_name = $2
       WHERE id = $3
       RETURNING id, first_name, last_name, created_at`,
      [fn, ln, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Joueur introuvable" });
    res.json({ player: rows[0] });
  } catch (e) {
    console.error("[players] PUT error:", e);
    res.status(500).json({ error: "Erreur mise à jour" });
  }
});

app.post("/api/day/:date", async (req, res) => {
  try {
    await ensureTable();
    const dateStr = req.params.date;
    const calendar = await getJSON("calendar");
    if (!calendar) return res.status(400).json({ ok: false, error: "calendar absent" });
    const catalog = await getJSON("catalog");
    if (!catalog) return res.status(400).json({ ok: false, error: "catalog absent" });

    const body = req.body || {};
    const day = findDay(calendar, dateStr);
    if (!day) return res.status(400).json({ ok: false, error: "jour inconnu" });

    // 1) Matches d'abord : upsert / delete / rétrocompat
    if (body.matchUpsert) {
      const m = body.matchUpsert;
      if (!day.matches) day.matches = [];
      const idx = day.matches.findIndex(x => x.id === m.id);
      if (idx === -1) day.matches.push(m);
      else day.matches[idx] = m;
    }
    if (body.matchDeleteId) {
      if (day.matches) {
        day.matches = day.matches.filter(x => x.id !== body.matchDeleteId);
      }
    }
    if (body.match) { // rétrocompat: un seul match -> on le normalise en tableau
      if (!day.matches) day.matches = [];
      const m = body.match.id ? body.match : { ...body.match, id: `m_${Date.now()}` };
      const idx = day.matches.findIndex(x => x.id === m.id);
      if (idx === -1) day.matches.push(m);
      else day.matches[idx] = m;
      delete day.match;
    }

    // 2) Appeler updateDay UNIQUEMENT si on modifie la planification
    const hasScheduleKeys = ["jeuId", "entrainementId", "mobiliteId", "type", "plateauLieu", "cancelled"]
      .some(k => Object.prototype.hasOwnProperty.call(body, k));

    if (hasScheduleKeys) {
      updateDay(calendar, catalog, dateStr, body);
    }

    await setJSON("calendar", calendar);
    res.json({ ok: true, calendar });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// -------- Players API --------

// GET /api/players : liste complète
app.get("/api/players", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, created_at
       FROM players
       ORDER BY lower(first_name), lower(last_name)`
    );
    res.json({ players: rows });
  } catch (e) {
    console.error("[players] GET error:", e);
    res.status(500).json({ error: "Erreur chargement effectif" });
  }
});

// POST /api/players : créer
// body: { first_name, last_name }
app.post("/api/players", async (req, res) => {
  try {
    const fn = (req.body?.first_name || "").trim();
    const ln = (req.body?.last_name || "").trim();
    if (!fn || !ln) return res.status(400).json({ error: "Prénom et nom requis" });

    const { rows } = await pool.query(
      `INSERT INTO players (first_name, last_name)
       VALUES ($1,$2)
       RETURNING id, first_name, last_name, created_at`,
      [fn, ln]
    );
    res.json({ player: rows[0] });
  } catch (e) {
    console.error("[players] POST error:", e);
    res.status(500).json({ error: "Erreur création joueur/joueuse" });
  }
});

// DELETE /api/players/:id : supprimer
app.delete("/api/players/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM players WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[players] DELETE error:", e);
    res.status(500).json({ error: "Erreur suppression" });
  }
});

// GET /api/attendance/:date  -> liste des statuts pour la date
app.get("/api/attendance/:date", async (req, res) => {
  const dateStr = req.params.date; // "YYYY-MM-DD"
  try {
    const { rows } = await pool.query(
      `SELECT a.player_id, a.status, a.note, p.first_name, p.last_name
       FROM attendance a
       JOIN players p ON p.id = a.player_id
       WHERE a.date = $1
       ORDER BY lower(p.first_name), lower(p.last_name)`,
      [dateStr]
    );
    res.json({ date: dateStr, items: rows });
  } catch (e) {
    console.error("[attendance] GET", e);
    res.status(500).json({ error: "Erreur chargement présences" });
  }
});

// POST /api/attendance/:date  -> upsert des statuts envoyés
// body: { statuses: { "<player_id>": "present"|"absent"|"excuse" }, notes?: { "<player_id>": "..." } }
app.post("/api/attendance/:date", async (req, res) => {
  const dateStr = req.params.date;
  const statuses = req.body?.statuses || {};
  const notes = req.body?.notes || {};
  const ids = Object.keys(statuses);
  if (ids.length === 0) return res.json({ ok: true, updated: 0 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let updated = 0;
    for (const pid of ids) {
      const st = statuses[pid];
      if (!["present", "absent", "excuse"].includes(st)) continue;
      const note = notes[pid] ?? null;
      await client.query(
        `INSERT INTO attendance(date, player_id, status, note)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (date, player_id)
         DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now()`,
        [dateStr, pid, st, note]
      );
      updated++;
    }
    await client.query("COMMIT");
    res.json({ ok: true, updated });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[attendance] POST", e);
    res.status(500).json({ error: "Erreur enregistrement présences" });
  } finally {
    client.release();
  }
});

// Debug
app.get("/api/debug/env", (_req, res) => {
  const raw = process.env.DATABASE_URL || null;
  const redacted = raw ? raw.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@") : null;
  res.json({ mode: useFs ? "fs" : "pg", hasDATABASE_URL: !!raw, DATABASE_URL_sample: redacted });
});

app.get("/api/debug/db", async (_req, res) => {
  try {
    if (useFs) return res.json({ ok: true, mode: "fs" });

    const r = await pool.query("select now() as now");
    res.json({ ok: true, mode: "pg", now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

// --- STATS API ---
app.get('/api/stats', async (_req, res) => {
  try {
    await ensureTable();
    const calendar = await getJSON('calendar');
    if (!calendar) return res.status(400).json({ error: 'calendar absent, initialisez-le avant' });
    // Load players to resolve scorer names
    let playersById = new Map();
    try {
      if (pool) {
        const r = await pool.query('SELECT id, first_name, last_name FROM players');
        for (const row of r.rows) {
          const name = `${row.first_name} ${row.last_name}`.trim();
          playersById.set(row.id, name);
        }
      }
    } catch (e) {
      console.warn('[stats] players lookup failed, continuing without names');
    }
    var playerNamesSet = new Set();
    for (const name of playersById.values()) {
      playerNamesSet.add(String(name).trim().toLowerCase());
    }
    const payload = aggregateStatsOnCalendar(calendar, playersById, playerNamesSet);
    res.json(payload);
  } catch (e) {
    console.error('[stats] GET /api/stats error:', e);
    res.status(500).json({ error: e.message || 'Failed to compute stats' });
  }
});

// --- STATS DEBUG API ---
app.get('/api/stats/debug', async (_req, res) => {
  try {
    await ensureTable();
    const calendar = await getJSON('calendar');
    if (!calendar) return res.status(400).json({ error: 'calendar absent' });

    // Load players to resolve names and build sets
    let playersById = new Map();
    try {
      if (pool) {
        const r = await pool.query('SELECT id, first_name, last_name FROM players');
        for (const row of r.rows) {
          const name = `${row.first_name} ${row.last_name}`.trim();
          playersById.set(row.id, name);
        }
      }
    } catch (e) {
      console.warn('[stats/debug] players lookup failed, continuing without names');
    }
    const playerNamesSet = new Set([...playersById.values()].map(n => String(n).trim().toLowerCase()));

    const debug = [];
    const items = Array.isArray(calendar?.items) ? calendar.items : [];
    for (const day of items) {
      const matches = Array.isArray(day.matches) ? day.matches : [];
      for (const m of matches) {
        const type = inferMatchType(m, day);
        const n = normalizeForOutcomeFromMatch(m, playersById, playerNamesSet, type);
        debug.push({
          date: day.date,
          weekday: day.weekday,
          type,
          id: m.id,
          opponent: m.opponent ?? null,
          ourScore: typeof m.ourScore === 'number' ? m.ourScore : null,
          theirScore: typeof m.theirScore === 'number' ? m.theirScore : null,
          computed: n,
          countersUsed: n && n.hasOutcome ? (n.src || 'unknown') : null,
        });
      }
    }

    res.json({ count: debug.length, items: debug });
  } catch (e) {
    console.error('[stats/debug] error:', e);
    res.status(500).json({ error: e.message || 'debug failed' });
  }
});

// --- STATS PAGE ---
app.get('/stats', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Stats — ${CLUB_NAME}</title>
  <style>
    :root { --bg:#0e1117; --card:#161b22; --muted:#8b949e; --fg:#c9d1d9; --acc:#2f81f7; }
    html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Helvetica Neue',Arial,'Noto Sans',sans-serif}
    .wrap{max-width:1000px;margin:24px auto;padding:0 16px}
    h1{font-size:24px;margin:0 0 16px}
    h2{font-size:18px;margin:24px 0 8px;color:var(--acc)}
    .grid{display:grid;grid-template-columns:1fr;gap:16px}
    @media(min-width:900px){.grid{grid-template-columns:1fr 1fr}}
    .card{background:var(--card);border:1px solid #30363d;border-radius:16px;padding:16px;box-shadow:0 1px 0 #30363d}
    .kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}
    .pill{border:1px solid #30363d;border-radius:999px;padding:6px 10px;font-size:14px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #30363d}
    th{color:var(--muted);font-weight:600}
    .muted{color:var(--muted);font-size:12px}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#1f6feb22;border:1px solid #1f6feb44}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Stats — ${CLUB_NAME}</h1>
    <div id="meta" class="muted"></div>
    <div class="grid">
      <div class="card">
        <h2>Matchs de plateaux</h2>
        <div class="kpis">
          <span class="pill" id="plat-w"></span>
          <span class="pill" id="plat-d"></span>
          <span class="pill" id="plat-l"></span>
          <span class="pill" id="plat-n"></span>
        </div>
        <div class="muted">Meilleurs buteurs</div>
        <table id="plat-scorers">
          <thead><tr><th>#</th><th>Joueur</th><th>Buts</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="card">
        <h2>Matchs d'entraînement</h2>
        <div class="kpis">
          <span class="pill" id="ent-n"></span>
        </div>
        <div class="muted">Meilleurs buteurs</div>
        <table id="ent-scorers">
          <thead><tr><th>#</th><th>Joueur</th><th>Buts</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>
<script>
async function loadStats(){
  const r = await fetch('/api/stats');
  const data = await r.json();

  const fmtKPIsPlateau = (stats) => {
    document.getElementById('plat-w').textContent = 'Victoires: ' + (stats.results.wins || 0);
    document.getElementById('plat-d').textContent = 'Nuls: ' + (stats.results.draws || 0);
    document.getElementById('plat-l').textContent = 'Défaites: ' + (stats.results.losses || 0);
    document.getElementById('plat-n').textContent = 'Matches: ' + (stats.countMatches || 0);
  };
  const fmtKPIsTraining = (stats) => {
    document.getElementById('ent-n').textContent = 'Séances: ' + (stats.countMatches || 0);
  };

  const fillTable = (tableId, rows) => {
    const tbody = document.querySelector('#'+tableId+' tbody');
    tbody.innerHTML = '';
    if(!rows || rows.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="muted">Aucun but encore enregistré</td>';
      tbody.appendChild(tr);
      return;
    }
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>'+r.rank+'</td><td>'+r.name+'</td><td><span class="badge">'+r.goals+'</span></td>';
      tbody.appendChild(tr);
    });
  };

  document.getElementById('meta').textContent = 'Côté entraînement interne suivi: ' + (data.trainingInternalSide || '—');

  fmtKPIsPlateau(data.plateau);
  fmtKPIsTraining(data.training);
  fillTable('plat-scorers', data.plateau.topScorers);
  fillTable('ent-scorers', data.training.topScorers);
}
loadStats();
</script>
</body>
</html>`);
});

// --- STATIC + LISTEN ---
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await ensureTable();
    console.log(`[BOOT] Storage: ${useFs ? "filesystem (local)" : "Postgres"}`);
    app.listen(PORT, () => console.log(`➡️  http://localhost:${PORT}`));
  } catch (e) {
    console.error("[BOOT] Erreur DB:", e.message);
    process.exit(1);
  }
})();