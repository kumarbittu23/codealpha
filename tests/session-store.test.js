const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const netPath = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const SQLiteSessionStore = require("../src/middleware/sqliteSessionStore");

function storeCall(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

test("SQLite sessions survive store restart and expired sessions are not returned", async () => {
  const directory = await mkdtemp(netPath.join(os.tmpdir(), "corner-sessions-test-"));
  const databasePath = netPath.join(directory, "sessions.sqlite");
  let database = new DatabaseSync(databasePath);
  let store = new SQLiteSessionStore(database, 60 * 60 * 1000);

  try {
    const sessionData = {
      user: { id: 42, role: "seller" },
      csrfToken: "test-token",
      cookie: { originalMaxAge: 60000, maxAge: 60000, expires: new Date(Date.now() + 60000) }
    };
    await storeCall(store, "set", "persistent-session", sessionData);
    store.close();
    database.close();

    database = new DatabaseSync(databasePath);
    store = new SQLiteSessionStore(database, 60 * 60 * 1000);
    assert.deepEqual(
      await storeCall(store, "get", "persistent-session"),
      JSON.parse(JSON.stringify(sessionData))
    );

    await storeCall(store, "set", "expired-session", {
      user: { id: 7 },
      cookie: { expires: new Date(Date.now() - 1000) }
    });
    assert.equal(await storeCall(store, "get", "expired-session"), null);

    await storeCall(store, "destroy", "persistent-session");
    assert.equal(await storeCall(store, "get", "persistent-session"), null);
  } finally {
    store.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
