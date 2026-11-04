const { Pool } = require("pg");
const sqliteRepository = require("./catalog.repository");
let pool;
let postgresRepository;

function getCatalogRepository() {
  if ((process.env.ACCOUNT_DATABASE_BACKEND || "sqlite") !== "postgresql") return sqliteRepository;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PostgreSQL catalog repository requires DATABASE_URL.");
    pool = new Pool({ connectionString });
    postgresRepository = require("./postgres-catalog.repository")(pool);
  }
  return postgresRepository;
}

module.exports = { getCatalogRepository };
