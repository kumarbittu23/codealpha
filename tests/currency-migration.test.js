const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

test("legacy USD demo database migrates amounts to INR paise", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "corner-currency-test-"));
  const databasePath = path.join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT NOT NULL, price_cents INTEGER NOT NULL, image_url TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      total_cents INTEGER NOT NULL, shipping_name TEXT NOT NULL, shipping_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL, price_cents INTEGER NOT NULL
    );
    INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Customer', 'customer@example.test', 'hash');
    INSERT INTO products (id, name, category, description, price_cents, image_url, stock)
      VALUES (1, 'Demo product', 'Home', 'A sample product for the migration test.', 1999, 'https://example.test/item.jpg', 4);
    INSERT INTO orders (id, user_id, total_cents, shipping_name, shipping_address)
      VALUES (1, 1, 3998, 'Customer', '123 Example Street');
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price_cents)
      VALUES (1, 1, 1, 'Demo product', 2, 1999);
  `);
  legacy.close();

  try {
    const migration = spawnSync(process.execPath, ["-e", `
      const database = require("./database");
      const result = {
        product: database.prepare("SELECT price_paise FROM products WHERE id = 1").get(),
        category: database.prepare("SELECT categories.slug FROM products JOIN categories ON categories.id = products.category_id WHERE products.id = 1").get(),
        order: database.prepare("SELECT total_paise, payment_method, payment_status FROM orders WHERE id = 1").get(),
        item: database.prepare("SELECT price_paise FROM order_items WHERE id = 1").get()
      };
      console.log(JSON.stringify(result));
      database.close();
    `], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr);
    const result = JSON.parse(migration.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(result.product.price_paise, 1999 * 83);
    assert.equal(result.category.slug, "home-decor");
    assert.equal(result.order.total_paise, 3998 * 83);
    assert.equal(result.item.price_paise, 1999 * 83);
    assert.equal(result.order.payment_method, "cash_on_delivery");
    assert.equal(result.order.payment_status, "pending");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
