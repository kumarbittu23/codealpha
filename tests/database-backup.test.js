const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const backupScript = path.join(__dirname, "..", "src", "backup-database.js");
const restoreScript = path.join(__dirname, "..", "src", "restore-database.js");
const backupAndVerifyScript = path.join(__dirname, "..", "src", "backup-and-verify-database.js");

function requiredSchema(database) {
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE sellers (id INTEGER PRIMARY KEY);
    CREATE TABLE products (id INTEGER PRIMARY KEY);
    CREATE TABLE orders (id INTEGER PRIMARY KEY);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY);
  `);
}

test("database backup captures committed WAL data and refuses to overwrite", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-database-backup-"));
  const sourcePath = path.join(directory, "store.sqlite");
  const destinationPath = path.join(directory, "snapshot.sqlite");
  const source = new DatabaseSync(sourcePath);
  source.exec("PRAGMA journal_mode = WAL; CREATE TABLE backup_probe (value TEXT NOT NULL);");
  source.prepare("INSERT INTO backup_probe (value) VALUES (?)").run("committed-before-backup");

  try {
    const result = spawnSync(process.execPath, [backupScript, destinationPath], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_PATH: sourcePath }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /backup created and verified/i);

    const backup = new DatabaseSync(destinationPath);
    try {
      assert.equal(
        backup.prepare("SELECT value FROM backup_probe").get().value,
        "committed-before-backup"
      );
      assert.equal(backup.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally {
      backup.close();
    }

    const overwrite = spawnSync(process.execPath, [backupScript, destinationPath], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_PATH: sourcePath }
    });
    assert.notEqual(overwrite.status, 0);
    assert.match(overwrite.stderr, /already exists/i);
    assert.equal(fs.existsSync(sourcePath), true);
  } finally {
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("combined backup procedure creates and verifies a restorable snapshot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-backup-procedure-"));
  const sourcePath = path.join(directory, "source.sqlite");
  const backupPath = path.join(directory, "snapshot.sqlite");
  const source = new DatabaseSync(sourcePath);
  requiredSchema(source);
  source.close();

  try {
    const result = spawnSync(process.execPath, [backupAndVerifyScript, backupPath], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_PATH: sourcePath }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /backup and restore verification completed successfully/i);
    assert.match(result.stdout, /products: 0/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database restore verifier accepts valid backups and rejects common failures", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-database-restore-"));
  const validPath = path.join(directory, "valid.sqlite");
  const missingTablePath = path.join(directory, "missing-table.sqlite");
  const corruptPath = path.join(directory, "corrupt.sqlite");

  const valid = new DatabaseSync(validPath);
  requiredSchema(valid);
  valid.prepare("INSERT INTO users (id) VALUES (?)").run(1);
  valid.close();

  const missingTable = new DatabaseSync(missingTablePath);
  missingTable.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE sellers (id INTEGER PRIMARY KEY);
    CREATE TABLE products (id INTEGER PRIMARY KEY);
    CREATE TABLE orders (id INTEGER PRIMARY KEY);
  `);
  missingTable.close();

  await fs.promises.writeFile(corruptPath, "not a sqlite database");

  try {
    const validResult = spawnSync(process.execPath, [restoreScript, validPath], { encoding: "utf8" });
    assert.equal(validResult.status, 0, validResult.stderr);
    assert.match(validResult.stdout, /backup verified for restore/i);
    assert.match(validResult.stdout, /users: 1/i);

    const missingFile = spawnSync(process.execPath, [restoreScript, path.join(directory, "missing.sqlite")], { encoding: "utf8" });
    assert.notEqual(missingFile.status, 0);
    assert.match(missingFile.stderr, /does not exist/i);

    const missingTables = spawnSync(process.execPath, [restoreScript, missingTablePath], { encoding: "utf8" });
    assert.notEqual(missingTables.status, 0);
    assert.match(missingTables.stderr, /missing required tables: order_items/i);

    const corrupt = spawnSync(process.execPath, [restoreScript, corruptPath], { encoding: "utf8" });
    assert.notEqual(corrupt.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
