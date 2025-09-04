const express = require("express");
const fs = require("fs");
const path = require("path");

// --- Bornes de saison ---
const START_DATE = "2025-09-03";
const END_DATE = "2026-07-01";

// Dossiers/fichiers
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");
const CALENDAR_PATH = path.join(DATA_DIR, "calendar.json");

// Utilitaires date (UTC)
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const toUTCDate = (yyyymmdd) => {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toYYYYMMDD = (date) => date.toISOString().slice(0, 10);

function listWeekday(startStr, endStr, weekday/*0-6*/) {
  const start = toUTCDate(startStr);
  const end = toUTCDate(endStr);
  let d = new Date(start);
  while (d.getUTCDay() !== weekday) d = new Date(d.getTime() + MS_PER_DAY);
  const out = [];
  for (; d <= end; d = new Date(d.getTime() + 7 * MS_PER_DAY)) out.push(toYYYYMMDD(d));
  return out;
}
const listWednesdays = (a, b) => listWeekday(a, b, 3); // 3=mercredi
const listSaturdays = (a, b) => listWeekday(a, b, 6); // 6=samedi

// Chargement du catalog
function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) throw new Error(`Fichier manquant: ${CATALOG_PATH}`);
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  if (!Array.isArray(catalog.jeuxFoot) || !Array.isArray(catalog.entrainements)) {
    throw new Error("catalog.json doit contenir { jeuxFoot: [], entrainements: [] }");
  }
  return catalog;
}

// Plans
function makePlanMercredi(jeu, entrainement) {
  const steps = [
    {
      type: "echauffement", label: "Échauffement", minutes: 10,
      details: { description: "Activation générale + mobilité" }
    }, // (pas de matériel)
    {
      type: "individuel", label: "Entrainement individuel", minutes: 15,
      details: { id: entrainement.id, nom: entrainement.nom, description: entrainement.description, materiel: entrainement.materiel }
    },
    {
      type: "jeu", label: "Jeu collectif", minutes: 15,
      details: { id: jeu.id, nom: jeu.nom, description: jeu.description, materiel: jeu.materiel }
    },
    {
      type: "tactique", label: "Tactique", minutes: 5,
      details: { description: "Principe du jour (placement, pressing, relance courte)", materiel: [] }
    },
    {
      type: "match_assiste", label: "Match assisté", minutes: 10,
      details: { description: "Coaching direct sur consignes du jour", materiel: ["buts", "chasubles", "ballon"] }
    },
    {
      type: "match", label: "Match", minutes: 10,
      details: { description: "Jeu libre pour ancrer les automatismes", materiel: ["buts", "chasubles", "ballon"] }
    },
  ];
  let t = 0;
  return steps.map(s => ({ ...s, startMin: (t), endMin: (t += s.minutes) }));
}

function makePlanSamedi(typeSamedi, { lieu } = {}, jeu, entrainement) {
  // 3 variantes de samedi : entrainement (plan identique au mercredi), plateau (sans timing strict), libre (vide)
  if (typeSamedi === "entrainement") {
    return makePlanMercredi(jeu, entrainement);
  }
  if (typeSamedi === "plateau") {
    // On met des blocs informatifs (minutes=0 pour ton rendu)
    return [
      { type: "plateau_info", label: "Plateau", minutes: 0, details: { description: lieu ? `Lieu : ${lieu}` : "Lieu à définir" } },
      { type: "plateau_jeu", label: "Rencontres", minutes: 0, details: { description: "Organisation selon club hôte" } },
    ].map((s, i) => ({ ...s, startMin: 0, endMin: 0 }));
  }
  // libre
  return [
    { type: "libre", label: "Libre", minutes: 0, details: { description: "Aucune activité programmée" } }
  ].map(s => ({ ...s, startMin: 0, endMin: 0 }));
}

// Génère le calendrier initial (mercredis + samedis)
function buildCalendar(catalog, startDate = START_DATE, endDate = END_DATE) {
  const mercredis = listWednesdays(startDate, endDate);
  const samedis = listSaturdays(startDate, endDate);

  const jeux = catalog.jeuxFoot;
  const entr = catalog.entrainements;

  const items = [];

  // Mercredis: round-robin
  mercredis.forEach((date, i) => {
    const j = jeux[i % jeux.length];
    const e = entr[i % entr.length];
    const plan = makePlanMercredi(j, e);
    items.push({
      date,
      weekday: "mercredi",
      type: "entrainement", // fixe pour mercredi
      cancelled: { is: false, reason: null }, // {is:boolean, reason:'climat'|'absence'|'vacances'|null}
      jeu: { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel },
      entrainement: { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel },
      samedi: null, // champ non-pertinent
      plan
    });
  });

  // Samedis: par défaut "entrainement" avec round-robin aussi
  // Samedis: par défaut "libre"
  samedis.forEach((date) => {
    const typeSamedi = "libre";
    const plan = makePlanSamedi(typeSamedi, {}, null, null);
    items.push({
      date,
      weekday: "samedi",
      type: typeSamedi,
      cancelled: { is: false, reason: null },
      jeu: null,
      entrainement: null,
      samedi: { lieu: "" },
      plan
    });
  });

  // Trie chronologique
  items.sort((a, b) => a.date.localeCompare(b.date));

  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    total: items.length,
    items
  };
}

// Helpers
function findDay(calendar, dateStr) {
  return calendar.items.find(x => x.date === dateStr);
}
function isSaturday(dateStr) {
  const d = toUTCDate(dateStr);
  return d.getUTCDay() === 6;
}

// Met à jour un jour (choix jeu/entrainement et/ou type samedi + lieu et/ou annulation)
function updateDay(calendar, catalog, dateStr, payload) {
  const day = findDay(calendar, dateStr);
  if (!day) throw new Error("Date non trouvée dans le calendrier");

  // Annulation (optionnelle)
  if (payload && typeof payload.cancelled?.is === "boolean") {
    const r = payload.cancelled?.reason ?? null;
    const allowed = [null, "climat", "absence", "vacances"];
    if (!allowed.includes(r)) throw new Error("Raison d'annulation invalide");
    day.cancelled = { is: payload.cancelled.is, reason: payload.cancelled.is ? r : null };
  }

  // Choix jeu / entrainement (si entrainement)
  if (payload.jeuId) {
    const j = catalog.jeuxFoot.find(x => x.id === payload.jeuId);
    if (!j) throw new Error("jeuId inconnu");
    day.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel };
  }
  if (payload.entrainementId) {
    const e = catalog.entrainements.find(x => x.id === payload.entrainementId);
    if (!e) throw new Error("entrainementId inconnu");
    day.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel };
  }

  // Samedi: type + lieu
  if (isSaturday(dateStr)) {
    if (payload.type) {
      const allowed = ["entrainement", "plateau", "libre"];
      if (!allowed.includes(payload.type)) throw new Error("Type samedi invalide");
      day.type = payload.type;

      // 👉 Fallbacks si on bascule en "entrainement" depuis "libre"/"plateau"
      if (day.type === "entrainement") {
        if (!day.jeu) {
          const j = (catalog.jeuxFoot || [])[0];
          if (!j) throw new Error("Aucun jeu disponible dans le catalogue");
          day.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel };
        }
        if (!day.entrainement) {
          const e = (catalog.entrainements || [])[0];
          if (!e) throw new Error("Aucun entraînement disponible dans le catalogue");
          day.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel };
        }
      }
    }

    if (payload.samedi?.lieu !== undefined) {
      day.samedi = day.samedi || {};
      day.samedi.lieu = String(payload.samedi.lieu || "");
    }
  }

  // Recalcule plan selon type
  if (day.weekday === "mercredi") {
    day.plan = makePlanMercredi(day.jeu, day.entrainement);
  } else {
    day.plan = makePlanSamedi(day.type, { lieu: day.samedi?.lieu }, day.jeu, day.entrainement);
  }

  return day;
}

// S'assure que data/ existe
fs.mkdirSync(DATA_DIR, { recursive: true });

function indexByDate(items = []) {
  const m = new Map();
  items.forEach(it => m.set(it.date, it));
  return m;
}

function getJeuById(catalog, id) {
  return (catalog.jeuxFoot || []).find(x => x.id === id) || null;
}
function getEntrById(catalog, id) {
  return (catalog.entrainements || []).find(x => x.id === id) || null;
}

/**
 * Fusionne un calendrier nouvellement généré avec l'ancien:
 * - conserve cancelled.{is,reason}
 * - conserve type/lieu des samedis
 * - conserve les choix jeu/entrainement si IDs encore valides
 * - recalcule toujours le plan final
 */
function mergeCalendar(newCal, oldCal, catalog) {
  if (!oldCal || !oldCal.items) return newCal;
  const oldByDate = indexByDate(oldCal.items);

  newCal.items = newCal.items.map((fresh) => {
    const prev = oldByDate.get(fresh.date);
    if (!prev) return fresh;

    // 1) Annulation
    if (prev.cancelled && typeof prev.cancelled.is === "boolean") {
      fresh.cancelled = {
        is: !!prev.cancelled.is,
        reason: prev.cancelled.is ? (prev.cancelled.reason ?? null) : null,
      };
    }

    // 2) Choix jeu/entrainement (si valides dans le catalog)
    if (prev.jeu?.id) {
      const j = getJeuById(catalog, prev.jeu.id);
      if (j) {
        fresh.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel };
      }
    }
    if (prev.entrainement?.id) {
      const e = getEntrById(catalog, prev.entrainement.id);
      if (e) {
        fresh.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel };
      }
    }

    // 3) Samedi: type & lieu
    if (prev.weekday === "samedi") {
      // garde le type précédent si présent
      if (prev.type) fresh.type = prev.type;
      // lieu (si plateau)
      const oldLieu = prev.samedi?.lieu ?? "";
      fresh.samedi = { ...(fresh.samedi || {}), lieu: oldLieu };
    }

    // 4) Recalcul du plan selon le type/choix actuels
    if (fresh.weekday === "mercredi") {
      fresh.plan = makePlanMercredi(fresh.jeu, fresh.entrainement);
    } else {
      fresh.plan = makePlanSamedi(fresh.type, { lieu: fresh.samedi?.lieu }, fresh.jeu, fresh.entrainement);
    }

    return fresh;
  });

  return newCal;
}

// (Ré)génération initiale — préserve les états manuels (annulations, types samedis, lieux, choix J/E)
let calendar;
const force = process.env.FORCE_REGEN === "1";
try {
  const catalog = loadCatalog();
  const hadOld = fs.existsSync(CALENDAR_PATH);
  const oldCal = hadOld ? JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8")) : null;

  if (!hadOld || force) {
    // build "neuf"
    const fresh = buildCalendar(catalog);
    // fusionne avec l'ancien si disponible
    const merged = mergeCalendar(fresh, oldCal, catalog);
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(merged, null, 2), "utf8");
    calendar = merged;
    console.log(force ? "Calendrier régénéré (états conservés)." : "Calendrier généré.");
  } else {
    calendar = oldCal;
    console.log("Calendrier chargé depuis data/calendar.json");
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// --- Serveur web ---
const app = express();
app.use(express.json({ limit: "1mb" }));

// Lecture
app.get("/api/calendar", (_req, res) => {
  try {
    // relit l'état persistant à chaque requête
    const onDisk = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"));
    calendar = onDisk; // garde la mémoire en phase (utile pour les autres endpoints)
    res.json(calendar);
  } catch (e) {
    res.status(500).json({ error: "Impossible de lire calendar.json" });
  }
});
app.get("/api/catalog", (_req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))); }
  catch { res.status(500).json({ error: "Impossible de lire catalog.json" }); }
});

// Écriture catalog (on n'écrase pas le calendrier existant)
app.post("/api/catalog", (req, res) => {
  const body = req.body || {};
  const { jeuxFoot, entrainements } = body;

  if (!Array.isArray(jeuxFoot) || !Array.isArray(entrainements)) {
    return res.status(400).json({ ok: false, error: "Format invalide: jeuxFoot[] et entrainements[] requis." });
  }

  const validEntry = (x) => x && typeof x.id === "string" && typeof x.nom === "string" &&
    typeof x.description === "string" && Array.isArray(x.materiel);
  if (jeuxFoot.some(x => !validEntry(x)) || entrainements.some(x => !validEntry(x))) {
    return res.status(400).json({ ok: false, error: "Chaque item doit avoir id, nom, description, materiel[]" });
  }

  fs.writeFileSync(CATALOG_PATH, JSON.stringify({ jeuxFoot, entrainements }, null, 2), "utf8");
  res.json({ ok: true });
});

// Mise à jour d'un jour (choix manuel + type samedi + lieu + annulation)
app.post("/api/day/:date", (req, res) => {
  try {
    const dateStr = req.params.date; // YYYY-MM-DD
    const catalog = loadCatalog();
    const payload = req.body || {};
    updateDay(calendar, catalog, dateStr, payload);
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2), "utf8");
    res.json({ ok: true, calendar });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.use("/data", express.static(DATA_DIR, { extensions: ["json"] }));
app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`➡️  http://localhost:${PORT}`));