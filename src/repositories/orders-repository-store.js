const { Pool } = require("pg");
const sqliteRepository = require("./orders.repository");
let pool;
let postgresRepository;
function getOrdersRepository() {
  if ((process.env.ACCOUNT_DATABASE_BACKEND || "sqlite") !== "postgresql") return sqliteRepository;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PostgreSQL orders repository requires DATABASE_URL.");
    pool = new Pool({ connectionString });
    postgresRepository = require("./postgres-orders.repository")(pool);
  }
  return postgresRepository;
}
module.exports = { getOrdersRepository };