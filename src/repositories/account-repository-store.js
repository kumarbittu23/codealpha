const { Pool } = require("pg");
const sqliteRepository = require("./account.repository");

let postgresPool;
let postgresRepository;

function resolveConnectionUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) return null;
  const port = process.env.PGPORT || "5432";
  const sslMode = process.env.PGSSLMODE;
  return `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${port}/${encodeURIComponent(PGDATABASE)}${sslMode ? `?sslmode=${encodeURIComponent(sslMode)}` : ""}`;
}

function getAccountRepository() {
  if ((process.env.ACCOUNT_DATABASE_BACKEND || "sqlite") !== "postgresql") return sqliteRepository;
  if (!postgresPool) {
    const connectionString = resolveConnectionUrl();
    if (!connectionString) throw new Error("PostgreSQL account repository requires database connection settings.");
    postgresPool = new Pool({ connectionString });
    postgresRepository = require("./postgres-account.repository")(postgresPool);
  }
  return postgresRepository;
}

module.exports = { getAccountRepository };
