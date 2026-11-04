const assert = require("node:assert/strict");
const test = require("node:test");
const { createAccountStore } = require("../src/config/account-store");

function temporaryEnvironment(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("account store defaults to SQLite and rejects unknown backends", async () => {
  const restore = temporaryEnvironment({ ACCOUNT_DATABASE_BACKEND: undefined });
  try {
    const database = {
      exec: () => {},
      prepare: () => ({ get: () => 1 })
    };
    const store = createAccountStore({ database });
    assert.equal(store.backend, "sqlite");
    await store.check();
  } finally {
    restore();
  }

  const restoreUnknown = temporaryEnvironment({ ACCOUNT_DATABASE_BACKEND: "mysql" });
  try {
    assert.throws(() => createAccountStore({ database: {} }), /sqlite or postgresql/);
  } finally {
    restoreUnknown();
  }
});

test("PostgreSQL account store requires DATABASE_URL", () => {
  const restore = temporaryEnvironment({ ACCOUNT_DATABASE_BACKEND: "postgresql", POSTGRES_ACCOUNT_CUTOVER: "complete", DATABASE_URL: undefined });
  try {
    assert.throws(() => createAccountStore({ database: {} }), /DATABASE_URL/);
  } finally {
    restore();
  }
});
