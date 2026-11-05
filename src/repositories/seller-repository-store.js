const { Pool } = require("pg");
const sqliteRepository = require("./seller.repository");
let pool;
let postgresRepository;
function getSellerRepository() {
  if ((process.env.ACCOUNT_DATABASE_BACKEND || "sqlite") !== "postgresql") return sqliteRepository;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PostgreSQL seller repository requires DATABASE_URL.");
    pool = new Pool({ connectionString });
    postgresRepository = require("./postgres-seller.repository")(pool);
  }
  return postgresRepository;
}
module.exports = { getSellerRepository };