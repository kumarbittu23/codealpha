const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function verifyRestoredDatabase(destinationArgument) {
  if (!destinationArgument) throw new Error("Provide the SQLite backup file to verify.");
  const backupPath = path.resolve(destinationArgument);
  if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile()) {
    throw new Error(`Backup file does not exist: ${backupPath}`);
  }
  const database = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
    const foreignKeyIssue = database.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyIssue) throw new Error("SQLite restore contains a foreign-key violation.");
    const requiredTables = ["users", "sellers", "products", "orders", "order_items"];
    const existing = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const missing = requiredTables.filter((table) => !existing.has(table));
    if (missing.length) throw new Error(`SQLite restore is missing required tables: ${missing.join(", ")}.`);
    return {
      backupPath,
      counts: Object.fromEntries(requiredTables.map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]))
    };
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try {
    const result = verifyRestoredDatabase(process.argv[2]);
    console.log(`SQLite backup verified for restore: ${result.backupPath}`);
    for (const [table, count] of Object.entries(result.counts)) console.log(`  ${table}: ${count}`);
  } catch (error) {
    console.error(`SQLite restore verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyRestoredDatabase };
