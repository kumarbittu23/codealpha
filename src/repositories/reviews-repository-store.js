const sqliteRepository = require("./reviews.repository");
let pool;
let postgresRepository;

function getReviewsRepository() {
  if ((process.env.ACCOUNT_DATABASE_BACKEND || "sqlite") !== "postgresql") return sqliteRepository;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PostgreSQL reviews repository requires DATABASE_URL.");
    const { Pool } = require("pg");
    pool = new Pool({ connectionString });
    postgresRepository = require("./postgres-reviews.repository")(pool);
  }
  return postgresRepository;
}

module.exports = { getReviewsRepository };
