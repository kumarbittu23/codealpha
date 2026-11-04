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

test("PostgreSQL runtime rejects account-only cutover", () => {
  const restore = temporaryEnvironment({
    ACCOUNT_DATABASE_BACKEND: "postgresql",
    POSTGRES_ACCOUNT_CUTOVER: "complete",
    POSTGRES_MARKETPLACE_CUTOVER: undefined
  });
  try {
    assert.throws(() => createAccountStore({ database: {} }), /marketplace cutover guards/);
  } finally {
    restore();
  }
});

test("PostgreSQL account store accepts generated-secret connection fields", async () => {
  const restore = temporaryEnvironment({
    ACCOUNT_DATABASE_BACKEND: "postgresql",
    POSTGRES_ACCOUNT_CUTOVER: "complete",
    POSTGRES_MARKETPLACE_CUTOVER: "complete",
    DATABASE_URL: undefined,
    PGHOST: "database.internal",
    PGPORT: "5432",
    PGDATABASE: "corner_store",
    PGUSER: "corner_admin",
    PGPASSWORD: "test password",
    PGSSLMODE: "require"
  });
  try {
    const store = createAccountStore({ database: {} });
    assert.equal(store.backend, "postgresql");
    await store.close();
  } finally {
    restore();
  }
});

test("PostgreSQL account store requires DATABASE_URL or generated-secret fields", () => {
  const restore = temporaryEnvironment({ ACCOUNT_DATABASE_BACKEND: "postgresql", POSTGRES_ACCOUNT_CUTOVER: "complete", POSTGRES_MARKETPLACE_CUTOVER: "complete", DATABASE_URL: undefined, PGHOST: undefined, PGDATABASE: undefined, PGUSER: undefined, PGPASSWORD: undefined });
  try {
    assert.throws(() => createAccountStore({ database: {} }), /DATABASE_URL|PGHOST/);
  } finally {
    restore();
  }
});
