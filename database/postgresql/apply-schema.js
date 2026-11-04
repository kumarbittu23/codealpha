const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function applyPostgresSchema({ targetUrl, clientFactory = (url) => new Client({ connectionString: url }), confirmEmptyTarget = false }) {
  if (!targetUrl) throw new Error("Set DATABASE_URL to the PostgreSQL target.");
  const schemaPath = path.join(__dirname, "001-initial-schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const client = clientFactory(targetUrl);
  await client.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`
      SELECT COUNT(*)::int AS count FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
    `);
    if (existing.rows[0].count > 0 && !confirmEmptyTarget) {
      throw new Error("PostgreSQL target is not empty. Pass --confirm-empty-target for a disposable database.");
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const checksum = crypto.createHash("sha256").update(schema).digest("hex");
    const applied = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", ["001-initial-schema"]);
    if (applied.rows.length && applied.rows[0].checksum !== checksum) {
      throw new Error("The initial PostgreSQL schema has changed since it was applied. Create a new migration instead.");
    }
    if (!applied.rows.length) {
      await client.query(schema);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", ["001-initial-schema", checksum]);
    }
    await client.query("COMMIT");
    return { checksum, applied: applied.rows.length === 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const confirmEmptyTarget = process.argv.slice(2).includes("--confirm-empty-target");
  const unexpected = process.argv.slice(2).filter((argument) => argument !== "--confirm-empty-target");
  if (unexpected.length) throw new Error("Usage: npm run postgres:schema -- --confirm-empty-target");
  const result = await applyPostgresSchema({ targetUrl: process.env.DATABASE_URL, confirmEmptyTarget });
  console.log(result.applied ? "PostgreSQL schema applied and recorded." : "PostgreSQL schema already matches the recorded migration.");
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { applyPostgresSchema };
