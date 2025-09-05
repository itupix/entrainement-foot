// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");

const { ensureTable, getJSON, setJSON, useFs } = require("./db");

// --- Bornes de saison ---
const START_DATE = "2025-09-03";
const END_DATE = "2026-07-01";

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
function makePlan(jeu, entrainement) {
  const steps = [
    {
      type: "echauffement",
      label: "Échauffement",
      minutes: 10,
      details: { description: "Activation générale + mobilité" },
    },
    {
      type: "individuel",
      label: "Entrainement individuel",
      minutes: 15,
      details: { id: entrainement.id, nom: entrainement.nom, description: entrainement.description, materiel: entrainement.materiel },
    },
    {
      type: "jeu",
      label: "Jeu collectif",
      minutes: 15,
      details: { id: jeu.id, nom: jeu.nom, description: jeu.description, materiel: jeu.materiel },
    },
    {
      type: "tactique",
      label: "Tactique",
      minutes: 5,
      details: { description: "Principe du jour (placement, pressing, relance courte)", materiel: [] },
    },
    {
      type: "match_assiste",
      label: "Match assisté",
      minutes: 10,
      details: { description: "Coaching direct sur consignes du jour", materiel: ["buts", "chasubles", "ballon"] },
    },
    {
      type: "match",
      label: "Match",
      minutes: 10,
      details: { description: "Jeu libre pour ancrer les automatismes", materiel: ["buts", "chasubles", "ballon"] },
    },
  ];
  let t = 0;
  return steps.map((s) => {
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

  const items = dates.map((d, i) => {
    if (d.weekday === "mercredi") {
      const j = jeux[i % jeux.length];
      const e = entr[i % entr.length];
      const plan = makePlan(j, e);
      return {
        date: d.date,
        weekday: "mercredi",
        totalMinutes: plan[plan.length - 1].endMin,
        jeu: { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel },
        entrainement: { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel },
        plan,
        cancelled: { is: false, reason: null },
      };
    } else {
      // samedi : par défaut "libre"
      return {
        date: d.date,
        weekday: "samedi",
        type: "libre",
        lieu: null,
        cancelled: { is: false, reason: null },
      };
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    total: items.length,
    items,
  };
}

// --- Met à jour un jour ---
function findDay(calendar, dateStr) {
  return calendar.items.find((x) => x.date === dateStr);
}

function updateDay(calendar, catalog, dateStr, { jeuId, entrainementId, type, lieu, cancelled }) {
  const day = findDay(calendar, dateStr);
  if (!day) throw new Error("Date non trouvée");

  if (day.weekday === "mercredi") {
    if (jeuId) {
      const j = catalog.jeuxFoot.find((x) => x.id === jeuId);
      if (!j) throw new Error("jeuId inconnu");
      day.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel };
    }
    if (entrainementId) {
      const e = catalog.entrainements.find((x) => x.id === entrainementId);
      if (!e) throw new Error("entrainementId inconnu");
      day.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel };
    }
    day.plan = makePlan(day.jeu, day.entrainement);
  } else if (day.weekday === "samedi") {
    if (type) {
      day.type = type; // "entrainement" | "plateau" | "libre"
      if (type === "entrainement") {
        // garantie d'avoir jeu/entrainement + plan
        if (!day.jeu) {
          const j = catalog.jeuxFoot?.[0];
          if (!j) throw new Error("Aucun jeu disponible dans le catalog");
          day.jeu = { id: j.id, nom: j.nom, description: j.description, materiel: j.materiel };
        }
        if (!day.entrainement) {
          const e = catalog.entrainements?.[0];
          if (!e) throw new Error("Aucun entrainement disponible dans le catalog");
          day.entrainement = { id: e.id, nom: e.nom, description: e.description, materiel: e.materiel };
        }
        day.plan = makePlan(day.jeu, day.entrainement);
        day.totalMinutes = day.plan[day.plan.length - 1].endMin;
      } else {
        // plateau/libre → pas de plan
        delete day.jeu;
        delete day.entrainement;
        delete day.plan;
        delete day.totalMinutes;
        if (type !== "plateau") day.lieu = null; // on garde le lieu seulement pour plateau
      }
    }
    if (lieu !== undefined) day.lieu = lieu;
  }

  // Permet de choisir J/E même pour un samedi (implique un entrainement)
  if (day.weekday === "samedi" && (jeuId || entrainementId)) {
    if (day.type !== "entrainement") day.type = "entrainement";
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
    day.plan = makePlan(day.jeu, day.entrainement);
    day.totalMinutes = day.plan[day.plan.length - 1].endMin;
  }


  if (cancelled) {
    day.cancelled = { is: true, reason: cancelled.reason || null };
  } else if (cancelled === false) {
    day.cancelled = { is: false, reason: null };
  }

  return day;
}

// --- App ---
const app = express();
app.use(express.json({ limit: "1mb" }));

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
    const { jeuxFoot, entrainements } = req.body || {};
    const valid = (x) =>
      x && typeof x.id === "string" && typeof x.nom === "string" &&
      typeof x.description === "string" && Array.isArray(x.materiel);
    if (!Array.isArray(jeuxFoot) || !Array.isArray(entrainements) ||
      jeuxFoot.some((x) => !valid(x)) || entrainements.some((x) => !valid(x))) {
      return res.status(400).json({ ok: false, error: "Format invalide: id, nom, description, materiel[]" });
    }
    await setJSON("catalog", { jeuxFoot, entrainements });
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

app.post("/api/day/:date", async (req, res) => {
  try {
    await ensureTable();
    const dateStr = req.params.date;
    const calendar = await getJSON("calendar");
    if (!calendar) return res.status(400).json({ ok: false, error: "calendar absent" });
    const catalog = await getJSON("catalog");
    if (!catalog) return res.status(400).json({ ok: false, error: "catalog absent" });

    updateDay(calendar, catalog, dateStr, req.body || {});
    await setJSON("calendar", calendar);
    res.json({ ok: true, calendar });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
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
    const { pool } = require("./db");
    const r = await pool.query("select now() as now");
    res.json({ ok: true, mode: "pg", now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

// --- STATIC + LISTEN ---
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await ensureTable();
    console.log(`[BOOT] Storage: ${useFs ? "filesystem (local)" : "Postgres (Render)"}`);
    app.listen(PORT, () => console.log(`➡️  http://localhost:${PORT}`));
  } catch (e) {
    console.error("[BOOT] Erreur DB:", e.message);
    process.exit(1);
  }
})();