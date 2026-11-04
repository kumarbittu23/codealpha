const assert = require("node:assert/strict");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const createPostgresCatalogRepository = require("../src/repositories/postgres-catalog.repository");

test("PostgreSQL catalog repository lists and reads products", async () => {
  const postgres = new PGlite();
  await postgres.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, active SMALLINT);
    CREATE TABLE sellers (id INTEGER PRIMARY KEY, store_name TEXT, status TEXT);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, sku TEXT, category TEXT, category_id INTEGER,
      description TEXT, price_paise INTEGER, image_url TEXT, stock INTEGER, featured BOOLEAN, seller_id INTEGER);
    CREATE TABLE reviews (id INTEGER PRIMARY KEY, product_id INTEGER, rating INTEGER, status TEXT, body TEXT,
      created_at TIMESTAMP, image_mime TEXT, image_data BYTEA, user_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE product_images (id INTEGER PRIMARY KEY, product_id INTEGER, image_url TEXT, model_profile TEXT,
      view_label TEXT, display_order INTEGER);
  `);
  await postgres.query("INSERT INTO categories VALUES (1,'Electronics','electronics',1)");
  await postgres.query("INSERT INTO sellers VALUES (1,'Corner Seller','active')");
  await postgres.query("INSERT INTO products VALUES (1,'Phone','PHONE-1','Electronics',1,'Test phone',12000,'phone.jpg',4,true,1)");
  await postgres.query("INSERT INTO product_images VALUES (1,1,'phone.jpg',NULL,'Front',1)");
  const repository = createPostgresCatalogRepository(postgres);
  const list = await repository.listProducts({ search: "phone" });
  assert.equal(list.products.length, 1);
  assert.equal(list.products[0].name, "Phone");
  const product = await repository.getProductById(1);
  assert.equal(product.sellerName, "Corner Seller");
  assert.equal(product.additionalImageUrls[0], "phone.jpg");
});
