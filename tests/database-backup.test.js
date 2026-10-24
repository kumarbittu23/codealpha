const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const backupScript = path.join(__dirname, "..", "src", "backup-database.js");

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
