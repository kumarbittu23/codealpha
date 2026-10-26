const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { mkdtemp, rm } = require("node:fs/promises");
const { DatabaseSync } = require("node:sqlite");
const { PGlite } = require("@electric-sql/pglite");
const test = require("node:test");
const { migrateSqliteToPostgres } = require("../database/postgresql/migrate-sqlite");

async function createSourceDatabase(directory, { missingUserName = false } = {}) {
  const sourcePath = path.join(directory, "source.sqlite");
  const source = new DatabaseSync(sourcePath);
  source.exec(fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8"));
  source.exec(`
    INSERT INTO users (id, name, email, password_hash, role)
      VALUES (11, 'Shop Owner', 'OWNER@example.test', 'stored-hash', 'customer');
    INSERT INTO categories (id, name, slug, parent_id)
      VALUES (21, 'Root', 'root', NULL);
    INSERT INTO sellers (id, user_id, store_name, phone, status)
      VALUES (31, 11, 'Example Store', '0000000000', 'active');
    INSERT INTO products (id, name, category, description, price_paise, image_url, stock, seller_id, category_id, sku)
      VALUES (41, 'Demo Item', 'Root', 'A demo product for migration tests.', 1999, 'https://example.test/item.jpg', 5, 31, 21, 'TEST-41');
    INSERT INTO product_images (id, product_id, image_url, model_profile, view_label)
      VALUES (51, 41, 'https://example.test/side.jpg', 'general', 'Side');
    INSERT INTO orders (id, user_id, total_paise, shipping_name, shipping_address)
      VALUES (61, 11, 1999, 'Shop Owner', '1 Example Street');
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price_paise, seller_id)
      VALUES (71, 61, 41, 'Demo Item', 1, 1999, 31);
    INSERT INTO seller_fulfillments (id, order_id, seller_id)
      VALUES (81, 61, 31);
    INSERT INTO seller_payouts (id, seller_id, amount_paise, reference, paid_by_user_id)
      VALUES (91, 31, 1500, 'TEST-UTR', 11);
    INSERT INTO saved_addresses (id, user_id, recipient_name, phone, line1, city, state, postal_code)
      VALUES (101, 11, 'Shop Owner', '0000000000', '1 Example Street', 'Mumbai', 'Maharashtra', '400001');
    INSERT INTO wishlists (user_id, product_id) VALUES (11, 41);
    INSERT INTO reviews (id, user_id, product_id, order_id, rating, body)
      VALUES (111, 11, 41, 61, 5, 'A verified product review.');
    INSERT INTO coupons (id, code, discount_basis_points)
      VALUES (121, 'WELCOME10', 1000);
    INSERT INTO return_requests (id, order_id, user_id, reason)
      VALUES (131, 61, 11, 'Test return reason');
  `);
  if (missingUserName) source.exec("ALTER TABLE users DROP COLUMN name");
  source.close();
  return sourcePath;
}

function createPostgresClient(database) {
  return {
    async connect() {},
    async end() {},
    async query(text, values = []) {
      if (text.includes("CREATE TABLE users")) {
        await database.exec(text);
        return { rows: [] };
      }
      const result = await database.query(text, values);
      return { rows: result.rows };
    }
  };
}

function createCorruptingPostgresClient(database) {
  const client = createPostgresClient(database);
  return {
    ...client,
    async query(text, values = []) {
      if (text.startsWith('INSERT INTO "products"')) {
        values = [...values];
        values[3] = "different value with the same row count";
      }
      return client.query(text, values);
    }
  };
}

test("SQLite migration rehearsal copies relational data and advances identity sequences", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-pg-migration-"));
  const sourcePath = await createSourceDatabase(directory);
  const postgres = new PGlite();

  try {
    const counts = await migrateSqliteToPostgres({
      sourcePath,
      targetUrl: "postgres://migration-test",
      confirmEmptyTarget: true,
      clientFactory: () => createPostgresClient(postgres)
    });
    assert.equal(counts.users, 1);
    assert.equal(counts.orders, 1);
    assert.equal(counts.marketplace_settings, 1);
    const sessions = await postgres.query("SELECT COUNT(*) AS count FROM sessions");
    assert.equal(sessions.rows[0].count, 0, "SQLite sessions are intentionally invalidated on a future cutover");

    const migratedProduct = await postgres.query(`
      SELECT id, price_paise, stock FROM products WHERE id = 41
    `);
    assert.deepEqual(migratedProduct.rows[0], { id: 41, price_paise: 1999, stock: 5 });

    const migratedEmail = await postgres.query("SELECT email FROM users WHERE id = 11");
    assert.equal(migratedEmail.rows[0].email, "OWNER@example.test");

    const nextIdentity = await postgres.query(`
      INSERT INTO users (name, email, password_hash) VALUES ('Next', 'next@example.test', 'hash')
      RETURNING id
    `);
    assert.equal(nextIdentity.rows[0].id, 12);
    const integrity = await postgres.query("SELECT COUNT(*) AS count FROM order_items WHERE order_id = 61 AND product_id = 41");
    assert.equal(integrity.rows[0].count, 1);
  } finally {
    await postgres.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration refuses nonempty targets and rolls back schema on an import error", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-pg-migration-"));
  const sourcePath = await createSourceDatabase(directory, { missingUserName: true });
  const postgres = new PGlite();

  try {
    await postgres.exec("CREATE TABLE keep_me (id INTEGER PRIMARY KEY)");
    await assert.rejects(
      migrateSqliteToPostgres({
        sourcePath,
        targetUrl: "postgres://migration-test",
        confirmEmptyTarget: true,
        clientFactory: () => createPostgresClient(postgres)
      }),
      /target is not empty/i
    );
    const preserved = await postgres.query("SELECT to_regclass('public.keep_me') AS table_name");
    assert.equal(preserved.rows[0].table_name, "keep_me");

    await postgres.exec("DROP TABLE keep_me");
    await assert.rejects(
      migrateSqliteToPostgres({
        sourcePath,
        targetUrl: "postgres://migration-test",
        confirmEmptyTarget: true,
        clientFactory: () => createPostgresClient(postgres)
      })
    );
    const rolledBack = await postgres.query("SELECT to_regclass('public.users') AS table_name");
    assert.equal(rolledBack.rows[0].table_name, null);
  } finally {
    await postgres.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration requires explicit confirmation before contacting PostgreSQL", async () => {
  let clientCreated = false;
  await assert.rejects(
    migrateSqliteToPostgres({
      sourcePath: "not-opened",
      targetUrl: "postgres://migration-test",
      clientFactory: () => {
        clientCreated = true;
        throw new Error("should not connect");
      }
    }),
    /confirm-empty-target/i
  );
  assert.equal(clientCreated, false);
});

test("migration detects altered rows even when table row counts match", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-pg-migration-"));
  const sourcePath = await createSourceDatabase(directory);
  const postgres = new PGlite();

  try {
    await assert.rejects(
      migrateSqliteToPostgres({
        sourcePath,
        targetUrl: "postgres://migration-test",
        confirmEmptyTarget: true,
        clientFactory: () => createCorruptingPostgresClient(postgres)
      }),
      /checksum mismatch for products/i
    );
    const rolledBack = await postgres.query("SELECT to_regclass('public.users') AS table_name");
    assert.equal(rolledBack.rows[0].table_name, null);
  } finally {
    await postgres.close();
    await rm(directory, { recursive: true, force: true });
  }
});
