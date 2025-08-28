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

// Utilitaires date (UTC pour éviter fuseaux/DST)
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const toUTCDate = (yyyymmdd) => {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toYYYYMMDD = (date) => date.toISOString().slice(0, 10);

// Tous les mercredis inclus
function listWednesdays(startStr, endStr) {
  const start = toUTCDate(startStr);
  const end = toUTCDate(endStr);
  let d = new Date(start);
  while (d.getUTCDay() !== 3) d = new Date(d.getTime() + MS_PER_DAY);
  const out = [];
  for (; d <= end; d = new Date(d.getTime() + 7 * MS_PER_DAY)) out.push(toYYYYMMDD(d));
  return out;
}

// Chargement du catalog
function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Fichier manquant: ${CATALOG_PATH}`);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  if (!Array.isArray(catalog.jeuxFoot) || !Array.isArray(catalog.entrainements)) {
    throw new Error("catalog.json doit contenir { jeuxFoot: [], entrainements: [] }");
  }
  return catalog;
}

// Construit le plan du jour (fixe)
function makePlan(jeu, entrainement) {
  const steps = [
    {
      type: "echauffement", label: "Échauffement", minutes: 10,
      details: { description: "Activation générale + mobilité" }
    },
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
  return steps.map(s => {
    const withTimes = { ...s, startMin: t, endMin: t + s.minutes };
    t += s.minutes;
    return withTimes;
  });
}

// Génère le calendrier initial (sans seed) : simple round-robin sur l'ordre des listes
function buildCalendar(catalog, startDate = START_DATE, endDate = END_DATE) {
  const dates = listWednesdays(startDate, endDate);
  const jeux = catalog.jeuxFoot;
  const entr = catalog.entrainements;

  const items = dates.map((date, i) => {
    const j = jeux[i % jeux.length];
    const e = entr[i % entr.length];
    const plan = makePlan(j, e);
    return {
      date,
      totalMinutes: plan[plan.length - 1].endMin, // 65
      jeu: { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel },
      entrainement: { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel },
      plan
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    total: items.length,
    items
  };
}

// Trouver un item du calendar par date
function findDay(calendar, dateStr) {
  return calendar.items.find(x => x.date === dateStr);
}

// Met à jour un jour avec un jeu et/ou un entrainement par ID (puis recalc plan)
function updateDay(calendar, catalog, dateStr, { jeuId, entrainementId }) {
  const day = findDay(calendar, dateStr);
  if (!day) throw new Error("Date non trouvée dans le calendrier");

  if (jeuId) {
    const j = catalog.jeuxFoot.find(x => x.id === jeuId);
    if (!j) throw new Error("jeuId inconnu");
    day.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel };
  }
  if (entrainementId) {
    const e = catalog.entrainements.find(x => x.id === entrainementId);
    if (!e) throw new Error("entrainementId inconnu");
    day.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel };
  }

  // Recalcule le plan avec les nouveaux choix
  day.plan = makePlan(day.jeu, day.entrainement);
  return day;
}

// S'assure que data/ existe
fs.mkdirSync(DATA_DIR, { recursive: true });

// (Ré)génération initiale si besoin (on NE régénère PAS automatiquement sur modification de catalog pour préserver les choix manuels)
let calendar;
const force = process.env.FORCE_REGEN === "1";
try {
  const catalog = loadCatalog();
  if (!fs.existsSync(CALENDAR_PATH) || force) {
    calendar = buildCalendar(catalog);
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2), "utf8");
    console.log(force ? "Calendrier régénéré." : "Calendrier généré.");
  } else {
    calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"));
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
app.get("/api/calendar", (_req, res) => res.json(calendar));
app.get("/api/catalog", (_req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))); }
  catch { res.status(500).json({ error: "Impossible de lire catalog.json" }); }
});

// Écriture catalog (n'impacte PAS automatiquement le calendrier pour préserver les choix)
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

  // Sauvegarde seulement le catalog
  const newCatalog = { jeuxFoot, entrainements };
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(newCatalog, null, 2), "utf8");
  res.json({ ok: true });
});

// Mise à jour d'un jour (choix manuel)
app.post("/api/day/:date", (req, res) => {
  try {
    const dateStr = req.params.date; // YYYY-MM-DD
    const catalog = loadCatalog();
    const payload = req.body || {};
    updateDay(calendar, catalog, dateStr, payload);
    // Persiste le calendrier modifié
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