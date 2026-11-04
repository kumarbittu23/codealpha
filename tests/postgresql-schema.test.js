const assert = require("node:assert/strict");
const test = require("node:test");
const { applyPostgresSchema } = require("../database/postgresql/apply-schema");

function fakeClientFactory(tableCount = 0) {
  let migrations = [];
  return () => ({
    async connect() {},
    async query(sql, values) {
      if (sql.includes("COUNT(*)::int AS count")) return { rows: [{ count: tableCount }] };
      if (sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) return { rows: [] };
      if (sql.includes("FROM schema_migrations WHERE name")) return { rows: migrations };
      if (sql.includes("INSERT INTO schema_migrations")) { migrations = [{ checksum: values[1] }]; return { rows: [] }; }
      return { rows: [] };
    },
    async end() {}
  });
}

test("PostgreSQL schema refuses a non-empty disposable target without confirmation", async () => {
  await assert.rejects(
    applyPostgresSchema({ targetUrl: "postgresql://example.test/corner", clientFactory: fakeClientFactory(1) }),
    /not empty/
  );
});

test("PostgreSQL schema is recorded with its checksum", async () => {
  const result = await applyPostgresSchema({
    targetUrl: "postgresql://example.test/corner",
    confirmEmptyTarget: true,
    clientFactory: fakeClientFactory(0)
  });
  assert.equal(result.applied, true);
  assert.match(result.checksum, /^[a-f0-9]{64}$/);
});
