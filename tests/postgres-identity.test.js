const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const test = require("node:test");
const createPostgresUsersRepository = require("../src/repositories/postgres-users.repository");
const { createAuthService } = require("../src/services/auth.service");

test("PostgreSQL identity repository supports registration, case-insensitive login, and profile updates", async () => {
  const postgres = new PGlite();
  try {
    const schema = fs.readFileSync(
      path.join(__dirname, "..", "database", "postgresql", "001-initial-schema.sql"),
      "utf8"
    );
    await postgres.exec(schema);

    const repository = createPostgresUsersRepository({
      async query(sql, values) {
        const result = await postgres.query(sql, values);
        return { ...result, rowCount: result.affectedRows };
      }
    });
    const auth = createAuthService(repository);

    const registration = await auth.register({
      name: "  Example Customer  ",
      email: "  SHOPPER@EXAMPLE.TEST ",
      password: "correct-horse-battery"
    });
    assert.deepEqual(registration.user, {
      id: 1,
      name: "Example Customer",
      email: "shopper@example.test",
      role: "customer"
    });

    const authenticated = await auth.authenticate(" Shopper@Example.Test ", "correct-horse-battery");
    assert.deepEqual(authenticated, {
      ...registration.user,
      password_hash: authenticated.password_hash
    });
    assert.equal(await auth.authenticate("shopper@example.test", "wrong-password"), null);

    const passwordRecord = await repository.findPasswordHash(registration.user.id);
    assert.equal(passwordRecord.password_hash, authenticated.password_hash);
    assert.equal(await repository.updateProfile(registration.user.id, {
      name: "Updated Customer",
      email: "updated@example.test",
      passwordHash: passwordRecord.password_hash
    }), true);
    assert.equal((await repository.findUserByEmail("UPDATED@example.test")).name, "Updated Customer");
    assert.equal(await repository.findPasswordHash(999), null);
  } finally {
    await postgres.close();
  }
});

test("PostgreSQL identity repository propagates duplicate email and rejects unsafe IDs", async () => {
  const postgres = new PGlite();
  try {
    const schema = fs.readFileSync(
      path.join(__dirname, "..", "database", "postgresql", "001-initial-schema.sql"),
      "utf8"
    );
    await postgres.exec(schema);
    const repository = createPostgresUsersRepository({
      async query(sql, values) {
        const result = await postgres.query(sql, values);
        return { ...result, rowCount: result.affectedRows };
      }
    });

    await repository.createUser("First Customer", "same@example.test", "hash");
    await assert.rejects(
      repository.createUser("Second Customer", "SAME@example.test", "hash"),
      (error) => error.code === "23505"
    );
    await assert.rejects(repository.findPasswordHash(Number.MAX_SAFE_INTEGER + 1), /supported integer range/i);
  } finally {
    await postgres.close();
  }
});
