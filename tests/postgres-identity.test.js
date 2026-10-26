const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const test = require("node:test");
const createPostgresUsersRepository = require("../src/repositories/postgres-users.repository");
const PostgresSessionStore = require("../src/middleware/postgresSessionStore");
const { createAuthService } = require("../src/services/auth.service");

function storeCall(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

async function createDatabase() {
  const postgres = new PGlite();
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "database", "postgresql", "001-initial-schema.sql"),
    "utf8"
  );
  await postgres.exec(schema);
  return postgres;
}

test("PostgreSQL identity repository supports registration, case-insensitive login, and profile updates", async () => {
  const postgres = await createDatabase();
  try {
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
  const postgres = await createDatabase();
  try {
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

test("PostgreSQL identity retains seller and order references and cascades user-owned data", async () => {
  const postgres = await createDatabase();
  try {
    await postgres.exec(`
      INSERT INTO users (id, name, email, password_hash) VALUES
        (1, 'Store Owner', 'owner@example.test', 'hash'),
        (2, 'Customer', 'customer@example.test', 'hash');
      INSERT INTO sellers (id, user_id, store_name, phone, status)
        VALUES (10, 1, 'Store One', '0000000000', 'active');
      INSERT INTO categories (id, name, slug) VALUES (20, 'Category', 'category');
      INSERT INTO products (id, name, category, description, price_paise, image_url, stock, seller_id, category_id)
        VALUES (30, 'Item', 'Category', 'A test product description.', 1000, 'https://example.test/item.jpg', 1, 10, 20);
      INSERT INTO orders (id, user_id, total_paise, shipping_name, shipping_address)
        VALUES (40, 2, 1000, 'Customer', 'Address');
      INSERT INTO order_items (order_id, product_id, product_name, quantity, price_paise, seller_id)
        VALUES (40, 30, 'Item', 1, 1000, 10);
      INSERT INTO saved_addresses (user_id, recipient_name, phone, line1, city, state, postal_code)
        VALUES (2, 'Customer', '9999999999', 'Address', 'Mumbai', 'Maharashtra', '400001');
      INSERT INTO wishlists (user_id, product_id) VALUES (2, 30);
      INSERT INTO return_requests (order_id, user_id, reason) VALUES (40, 2, 'Item issue');
    `);

    await assert.rejects(postgres.query("DELETE FROM users WHERE id = 1"), (error) => error.code === "23503");
    await assert.rejects(postgres.query("DELETE FROM users WHERE id = 2"), (error) => error.code === "23503");

    await postgres.query("DELETE FROM return_requests WHERE order_id = 40");
    await postgres.query("DELETE FROM order_items WHERE order_id = 40");
    await postgres.query("DELETE FROM orders WHERE id = 40");
    await postgres.query("DELETE FROM users WHERE id = 2");
    const userOwnedData = await postgres.query(`
      SELECT
        (SELECT COUNT(*) FROM saved_addresses WHERE user_id = 2) AS addresses,
        (SELECT COUNT(*) FROM wishlists WHERE user_id = 2) AS wishlists
    `);
    assert.equal(userOwnedData.rows[0].addresses, 0);
    assert.equal(userOwnedData.rows[0].wishlists, 0);
    const sellerOwner = await postgres.query("SELECT user_id FROM sellers WHERE id = 10");
    assert.equal(sellerOwner.rows[0].user_id, 1);
  } finally {
    await postgres.close();
  }
});

test("PostgreSQL session store persists, refreshes, expires, and destroys sessions", async () => {
  const postgres = await createDatabase();
  const store = new PostgresSessionStore({
    query: (sql, values) => postgres.query(sql, values)
  }, 60 * 60 * 1000);
  try {
    const sessionData = {
      user: { id: 8, role: "customer" },
      csrfToken: "session-csrf-token",
      cookie: { maxAge: 60000, expires: new Date(Date.now() + 60000).toISOString() }
    };
    await storeCall(store, "set", "session-one", sessionData);
    assert.deepEqual(await storeCall(store, "get", "session-one"), sessionData);

    const renewed = {
      ...sessionData,
      cookie: { ...sessionData.cookie, expires: new Date(Date.now() + 120000).toISOString() }
    };
    await storeCall(store, "touch", "session-one", renewed);
    const expiry = await postgres.query("SELECT expires_at > NOW() AS is_future FROM sessions WHERE session_id = $1", ["session-one"]);
    assert.equal(expiry.rows[0].is_future, true);

    await storeCall(store, "set", "expired-session", {
      cookie: { expires: new Date(Date.now() - 1000).toISOString() }
    });
    assert.equal(await storeCall(store, "get", "expired-session"), null);

    await storeCall(store, "destroy", "session-one");
    assert.equal(await storeCall(store, "get", "session-one"), null);
  } finally {
    store.close();
    await postgres.close();
  }
});
