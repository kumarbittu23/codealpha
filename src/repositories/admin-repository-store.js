const sqliteRepository = require("./admin.repository");
let pool;
let postgresRepository;

function getAdminRepository() {
  if ((process.env.ACCOUNT_DATABASE_BACKEND || "sqlite") !== "postgresql") return sqliteRepository;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PostgreSQL admin repository requires DATABASE_URL.");
    const { Pool } = require("pg");
    pool = new Pool({ connectionString });
    postgresRepository = require("./postgres-admin.repository")(pool);
  }
  return postgresRepository;
}

module.exports = { getAdminRepository };
