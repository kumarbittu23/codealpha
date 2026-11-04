const { Pool } = require("pg");
const { createAuthService } = require("../services/auth.service");
const usersRepository = require("../repositories/users.repository");
const createPostgresUsersRepository = require("../repositories/postgres-users.repository");
const PostgresSessionStore = require("../middleware/postgresSessionStore");
const SQLiteSessionStore = require("../middleware/sqliteSessionStore");

function createSqliteAccountStore(database, authService) {
  return {
    backend: "sqlite",
    authService: authService || createAuthService(usersRepository),
    sessionStore: new SQLiteSessionStore(database),
    async check() {
      database.prepare("SELECT 1").get();
    },
    async close() {}
  };
}

function createPostgresAccountStore(databaseUrl, authService) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set when ACCOUNT_DATABASE_BACKEND=postgresql.");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = createPostgresUsersRepository(pool);
  return {
    backend: "postgresql",
    authService: authService || createAuthService(repository),
    sessionStore: new PostgresSessionStore(pool),
    async check() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    }
  };
}

function createAccountStore({ database, authService } = {}) {
  const backend = process.env.ACCOUNT_DATABASE_BACKEND || "sqlite";
  if (backend === "sqlite") {
    return createSqliteAccountStore(database, authService);
  }
  if (backend === "postgresql") {
    if (process.env.POSTGRES_ACCOUNT_CUTOVER !== "complete") {
      throw new Error("PostgreSQL account runtime is locked until the complete marketplace database boundary passes its cutover tests.");
    }
    return createPostgresAccountStore(process.env.DATABASE_URL, authService);
  }
  throw new Error("ACCOUNT_DATABASE_BACKEND must be sqlite or postgresql.");
}

module.exports = { createAccountStore, createPostgresAccountStore };
