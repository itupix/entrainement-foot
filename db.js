// db.js
// Fallback local (fichiers) si DATABASE_URL manquante.
// En prod (Render), utilisation de Postgres via DATABASE_URL.

const hasUrl = typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0;

if (!hasUrl) {
  // ------------- MODE FICHIERS (local) -------------
  const path = require("path");
  const fs = require("fs");

  const DATA_DIR = path.join(__dirname, "data");
  fs.mkdirSync(DATA_DIR, { recursive: true });

  async function ensureTable() { /* no-op */ }

  async function getJSON(key) {
    const p = path.join(DATA_DIR, `${key}.json`);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }

  async function setJSON(key, value) {
    const p = path.join(DATA_DIR, `${key}.json`);
    fs.writeFileSync(p, JSON.stringify(value, null, 2), "utf8");
  }

  module.exports = { pool: null, useFs: true, ensureTable, getJSON, setJSON };
} else {
  // ------------- MODE POSTGRES (Render/Prod) -------------
  const { Pool } = require("pg");

  // Validation stricte de l'URL (évite "searchParams of undefined")
  const RAW_URL = String(process.env.DATABASE_URL).trim();

  // Quelques vérifs lisibles :
  const looksLikePg =
    RAW_URL.startsWith("postgres://") || RAW_URL.startsWith("postgresql://");

  if (!looksLikePg) {
    const redacted = RAW_URL.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
    throw new Error(
      `DATABASE_URL invalide (doit commencer par postgres://). Reçue: ${redacted}`
    );
  }

  // Création du Pool en passant directement la connectionString.
  // (Pas de parse manuel → évite les bugs liés à URL/searchParams)
  const pool = new Pool({
    connectionString: RAW_URL,
    ssl: { rejectUnauthorized: false }, // requis sur Render PG free
    // Optionnel: augmente un peu les timeouts si besoin
    // idleTimeoutMillis: 30000,
    // connectionTimeoutMillis: 10000,
  });

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_kv (
        k TEXT PRIMARY KEY,
        v JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async function getJSON(key) {
    const { rows } = await pool.query("SELECT v FROM app_kv WHERE k = $1", [key]);
    return rows[0]?.v ?? null;
  }

  async function setJSON(key, value) {
    await pool.query(
      `INSERT INTO app_kv (k, v) VALUES ($1, $2::jsonb)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }

  module.exports = { pool, useFs: false, ensureTable, getJSON, setJSON };
}