const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function defaultBackupPath() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return path.join(__dirname, "..", "backups", `store-${timestamp}.sqlite`);
}

function backupDatabase(destinationArgument) {
  const sourcePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, "..", "store.sqlite"));
  const destinationPath = path.resolve(destinationArgument || defaultBackupPath());

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Database file does not exist: ${sourcePath}`);
  }
  if (sourcePath === destinationPath) {
    throw new Error("Backup destination must not be the source database.");
  }
  if (fs.existsSync(destinationPath)) {
    throw new Error(`Backup destination already exists: ${destinationPath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const database = new DatabaseSync(sourcePath);
  let backupCreated = false;
  try {
    database.prepare("VACUUM INTO ?").run(destinationPath);
    backupCreated = true;
    const backup = new DatabaseSync(destinationPath);
    try {
      const integrity = backup.prepare("PRAGMA integrity_check").get();
      if (integrity.integrity_check !== "ok") {
        throw new Error(`SQLite backup integrity check failed: ${integrity.integrity_check}`);
      }
      const foreignKeyIssue = backup.prepare("PRAGMA foreign_key_check").get();
      if (foreignKeyIssue) throw new Error("SQLite backup contains a foreign-key violation.");
    } finally {
      backup.close();
    }
  } catch (error) {
    if (backupCreated) fs.rmSync(destinationPath, { force: true });
    throw error;
  } finally {
    database.close();
  }

  return destinationPath;
}

try {
  if (process.argv.length > 3) {
    throw new Error("Usage: npm run backup -- [destination-file]");
  }
  const destinationPath = backupDatabase(process.argv[2]);
  console.log(`Database backup created and verified: ${destinationPath}`);
} catch (error) {
  console.error(`Database backup failed: ${error.message}`);
  process.exitCode = 1;
}
