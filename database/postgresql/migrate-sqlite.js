const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Client } = require("pg");

const tableOrder = [
  "users",
  "categories",
  "sellers",
  "products",
  "product_images",
  "orders",
  "order_items",
  "seller_fulfillments",
  "marketplace_settings",
  "seller_payouts",
  "saved_addresses",
  "wishlists",
  "reviews",
  "coupons",
  "return_requests"
];
const identityTables = tableOrder.filter((table) => !["marketplace_settings", "wishlists"].includes(table));
const schemaPath = path.join(__dirname, "001-initial-schema.sql");

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function inspectSource(source) {
  const integrity = source.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") {
    throw new Error(`Source SQLite integrity check failed: ${integrity.integrity_check}`);
  }
  const foreignKeyIssues = source.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyIssues.length) {
    throw new Error(`Source SQLite database has ${foreignKeyIssues.length} foreign-key violation(s).`);
  }

  const existingTables = new Set(source.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => row.name));
  const missingTables = tableOrder.filter((table) => !existingTables.has(table));
  if (missingTables.length) {
    throw new Error(`Source database is missing required table(s): ${missingTables.join(", ")}.`);
  }

  const counts = new Map();
  for (const table of tableOrder) {
    counts.set(table, source.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
  }
  return counts;
}

async function migrateSqliteToPostgres({
  sourcePath,
  targetUrl,
  confirmEmptyTarget = false,
  clientFactory = (connectionString) => new Client({ connectionString })
}) {
  if (!confirmEmptyTarget) {
    throw new Error("Pass --confirm-empty-target to confirm the PostgreSQL database is disposable and empty.");
  }
  if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Source SQLite database file does not exist: ${sourcePath || "(not specified)"}`);
  }
  if (!targetUrl) throw new Error("Set MIGRATION_DATABASE_URL to the disposable PostgreSQL target.");

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let client;
  let connected = false;
  let transactionStarted = false;
  try {
    source.exec("BEGIN");
    const sourceCounts = inspectSource(source);
    client = clientFactory(targetUrl);
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    transactionStarted = true;

    const existing = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      LIMIT 1
    `);
    if (existing.rows.length) {
      throw new Error("PostgreSQL target is not empty. Migration stopped without changing it.");
    }

    await client.query(fs.readFileSync(schemaPath, "utf8"));
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    for (const table of tableOrder) {
      const columns = source.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((column) => column.name);
      const select = source.prepare(`SELECT * FROM ${quoteIdentifier(table)}`);
      const rows = select.all();
      if (!rows.length) continue;
      const columnList = columns.map(quoteIdentifier).join(", ");
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const insert = `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${placeholders})`;
      for (const row of rows) {
        await client.query(insert, columns.map((column) => row[column]));
      }
    }

    for (const table of tableOrder) {
      const result = await client.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
      const targetCount = Number(result.rows[0].count);
      const sourceCount = sourceCounts.get(table);
      if (targetCount !== sourceCount) {
        throw new Error(`Row-count mismatch for ${table}: source ${sourceCount}, target ${targetCount}.`);
      }
    }

    for (const table of identityTables) {
      if (!sourceCounts.get(table)) continue;
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${quoteIdentifier(table)}), true)`,
        [table]
      );
    }

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
    transactionStarted = false;
    source.exec("COMMIT");
    return Object.fromEntries(sourceCounts);
  } catch (error) {
    if (connected && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    source.close();
    if (connected) await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const confirmEmptyTarget = args.includes("--confirm-empty-target");
  const unexpectedArgs = args.filter((argument) => argument !== "--confirm-empty-target");
  if (unexpectedArgs.length) {
    throw new Error("Usage: npm run migrate:postgres -- --confirm-empty-target");
  }
  const counts = await migrateSqliteToPostgres({
    sourcePath: process.env.DATABASE_PATH || path.join(__dirname, "..", "..", "store.sqlite"),
    targetUrl: process.env.MIGRATION_DATABASE_URL,
    confirmEmptyTarget
  });
  console.log("SQLite data copied and verified in PostgreSQL:");
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
  console.log("SQLite source was opened read-only and has not been modified.");
  console.log("Session rows are intentionally not copied; all users will need to sign in again.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`PostgreSQL migration rehearsal failed: ${error.message}`);
    if (error.rollbackError) console.error(`Rollback also failed: ${error.rollbackError.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateSqliteToPostgres, tableOrder };
