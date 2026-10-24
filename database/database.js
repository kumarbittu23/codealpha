const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const migrateLegacyCurrency = require("./migrations/001-currency-to-paise");

const database = new DatabaseSync(process.env.DATABASE_PATH || path.join(__dirname, "..", "store.sqlite"));
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA foreign_keys = ON");
database.transaction = (callback) => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

database.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

const reviewColumns = database.prepare("PRAGMA table_info(reviews)").all();
if (!reviewColumns.some((column) => column.name === "image_mime")) {
  database.exec("ALTER TABLE reviews ADD COLUMN image_mime TEXT");
}
if (!reviewColumns.some((column) => column.name === "image_data")) {
  database.exec("ALTER TABLE reviews ADD COLUMN image_data TEXT");
}

migrateLegacyCurrency(database);

const userColumns = database.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "role")) {
  database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin'))");
}

const sellerColumns = database.prepare("PRAGMA table_info(sellers)").all();
if (!sellerColumns.some((column) => column.name === "platform_owned")) {
  database.exec("ALTER TABLE sellers ADD COLUMN platform_owned INTEGER NOT NULL DEFAULT 0");
}

const orderColumns = database.prepare("PRAGMA table_info(orders)").all();
if (!orderColumns.some((column) => column.name === "payment_method")) {
  database.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery'");
}
if (!orderColumns.some((column) => column.name === "payment_status")) {
  database.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending'");
}
if (!orderColumns.some((column) => column.name === "razorpay_order_id")) {
  database.exec("ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT");
}
if (!orderColumns.some((column) => column.name === "razorpay_payment_id")) {
  database.exec("ALTER TABLE orders ADD COLUMN razorpay_payment_id TEXT");
}
if (!orderColumns.some((column) => column.name === "discount_paise")) {
  database.exec("ALTER TABLE orders ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0");
}
if (!orderColumns.some((column) => column.name === "coupon_code")) {
  database.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT");
}
if (!orderColumns.some((column) => column.name === "tracking_carrier")) {
  database.exec("ALTER TABLE orders ADD COLUMN tracking_carrier TEXT");
}
if (!orderColumns.some((column) => column.name === "tracking_code")) {
  database.exec("ALTER TABLE orders ADD COLUMN tracking_code TEXT");
}

const productColumns = database.prepare("PRAGMA table_info(products)").all();
if (!productColumns.some((column) => column.name === "seller_id")) {
  database.exec("ALTER TABLE products ADD COLUMN seller_id INTEGER REFERENCES sellers(id)");
}
if (!productColumns.some((column) => column.name === "category_id")) {
  database.exec("ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT");
}
if (!productColumns.some((column) => column.name === "sku")) {
  database.exec("ALTER TABLE products ADD COLUMN sku TEXT");
}

const itemColumns = database.prepare("PRAGMA table_info(order_items)").all();
if (!itemColumns.some((column) => column.name === "seller_id")) {
  database.exec("ALTER TABLE order_items ADD COLUMN seller_id INTEGER REFERENCES sellers(id)");
}
if (!itemColumns.some((column) => column.name === "commission_paise")) {
  database.exec("ALTER TABLE order_items ADD COLUMN commission_paise INTEGER NOT NULL DEFAULT 0");
}
if (!itemColumns.some((column) => column.name === "seller_payout_paise")) {
  database.exec("ALTER TABLE order_items ADD COLUMN seller_payout_paise INTEGER NOT NULL DEFAULT 0");
}
if (!itemColumns.some((column) => column.name === "discount_paise")) {
  database.exec("ALTER TABLE order_items ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0");
}
if (!itemColumns.some((column) => column.name === "payout_status")) {
  database.exec("ALTER TABLE order_items ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'pending'");
}

const initialCategories = [
  ["Fashion", "fashion", null, [
    ["Men", "men", [
      ["Clothing", "clothing", [["T-Shirts", "t-shirts"], ["Shirts", "shirts"], ["Jeans and Trousers", "jeans-trousers"], ["Jackets", "jackets"]]],
      ["Shoes", "shoes", []],
      ["Watches and Accessories", "watches-accessories", []]
    ]],
    ["Women", "women", [
      ["Clothing", "women-clothing", [["Dresses", "dresses"], ["Tops and Kurtis", "tops-kurtis"], ["Sarees and Ethnic Wear", "sarees-ethnic-wear"], ["Jeans and Trousers", "women-jeans-trousers"]]],
      ["Footwear", "footwear", []],
      ["Handbags and Accessories", "handbags-accessories", []]
    ]],
    ["Kids", "kids", [
      ["Boys' Clothing", "boys-clothing", []], ["Girls' Clothing", "girls-clothing", []],
      ["Kids' Footwear", "kids-footwear", []], ["Baby Clothing", "baby-clothing", []],
      ["Fashion Accessories", "fashion-accessories", []]
    ]]
  ]],
  ["Grocery", "grocery", null, [
    ["Fruits and Vegetables", "fruits-vegetables"], ["Dairy and Bakery", "dairy-bakery"],
    ["Rice, Atta and Pulses", "rice-atta-pulses"], ["Snacks and Packaged Foods", "snacks-packaged-foods"],
    ["Beverages", "grocery-beverages"], ["Household Essentials", "household-essentials"],
    ["Personal Care Essentials", "personal-care-essentials"]
  ]],
  ["Food and Beverages", "food-beverages", null, [
    ["Ready-to-Eat Food", "ready-to-eat"], ["Packaged Food", "packaged-food"],
    ["Snacks", "food-snacks"], ["Sweets and Chocolates", "sweets-chocolates"],
    ["Drinks and Beverages", "drinks-beverages"]
  ]],
  ["Electronics", "electronics", null, [
    ["Computers and Laptops", "computers-laptops"], ["Computer Accessories", "computer-accessories"],
    ["Cameras", "cameras"], ["Audio Devices", "audio-devices"], ["Home Appliances", "home-appliances"],
    ["Smart Home Devices", "smart-home-devices"], ["Electronic Accessories", "electronic-accessories"]
  ]],
  ["Mobiles", "mobiles", null, [
    ["Smartphones", "smartphones"], ["Feature Phones", "feature-phones"], ["Tablets", "tablets"],
    ["Mobile Accessories", "mobile-accessories"], ["Chargers and Cables", "chargers-cables"],
    ["Cases and Covers", "cases-covers"], ["Power Banks", "power-banks"]
  ]],
  ["Beauty and Personal Care", "beauty-personal-care", null, [
    ["Skincare", "skincare"], ["Haircare", "haircare"], ["Makeup", "makeup"], ["Fragrances", "fragrances"],
    ["Grooming Products", "grooming-products"], ["Bath and Body", "bath-body"], ["Beauty Tools", "beauty-tools"]
  ]],
  ["Home and Kitchen", "home-kitchen", null, [
    ["Kitchen Appliances", "kitchen-appliances"], ["Cookware and Dining", "cookware-dining"],
    ["Home Decor", "home-decor"], ["Furniture", "furniture"], ["Bedding and Furnishing", "bedding-furnishing"],
    ["Cleaning Supplies", "cleaning-supplies"], ["Storage and Organization", "storage-organization"]
  ]],
  ["Books and Stationery", "books-stationery", null, [
    ["Books", "books"], ["Educational Books", "educational-books"], ["Office Supplies", "office-supplies"],
    ["Notebooks and Diaries", "notebooks-diaries"], ["Art and Craft Supplies", "art-craft-supplies"]
  ]],
  ["Baby, Kids and Toys", "baby-kids-toys", null, [
    ["Baby Care", "baby-care"], ["Baby Gear", "baby-gear"], ["Educational Toys", "educational-toys"],
    ["Indoor Games", "indoor-games"], ["Outdoor Toys", "outdoor-toys"], ["Board Games", "board-games"],
    ["Dolls and Action Figures", "dolls-action-figures"]
  ]],
  ["Sports and Fitness", "sports-fitness", null, [
    ["Fitness Equipment", "fitness-equipment"], ["Sportswear", "sportswear"], ["Outdoor Sports", "outdoor-sports"],
    ["Exercise Accessories", "exercise-accessories"], ["Camping and Travel Gear", "camping-travel-gear"]
  ]],
  ["Other", "other", null, []]
];

const insertCategory = database.prepare(`
  INSERT OR IGNORE INTO categories (name, slug, parent_id, display_order)
  VALUES (?, ?, ?, ?)
`);
function seedCategoryTree(nodes, parentId = null) {
  nodes.forEach((node, index) => {
    const [name, slug, childrenOrParent, maybeChildren] = node;
    const children = Array.isArray(childrenOrParent) ? childrenOrParent : maybeChildren;
    const result = insertCategory.run(name, slug, parentId, index);
    const category = database.prepare("SELECT id FROM categories WHERE slug = ?").get(slug);
    if (children && children.length) seedCategoryTree(children, category.id);
    return result;
  });
}
seedCategoryTree(initialCategories);

database.exec("CREATE INDEX IF NOT EXISTS idx_categories_parent_active_order ON categories(parent_id, active, display_order)");
database.exec("CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id)");
const productImageColumns = database.prepare("PRAGMA table_info(product_images)").all();
if (!productImageColumns.some((column) => column.name === "model_profile")) {
  database.exec("ALTER TABLE product_images ADD COLUMN model_profile TEXT NOT NULL DEFAULT 'general'");
}
if (!productImageColumns.some((column) => column.name === "view_label")) {
  database.exec("ALTER TABLE product_images ADD COLUMN view_label TEXT NOT NULL DEFAULT 'Other view'");
}
database.exec("CREATE INDEX IF NOT EXISTS idx_product_images_product_order ON product_images(product_id, display_order, id)");
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique ON products(sku) WHERE sku IS NOT NULL AND sku != ''");

const platformUser = database.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
let platformSeller = database.prepare("SELECT id FROM sellers WHERE user_id = ?").get(platformUser?.id || -1);
if (!platformSeller && platformUser) {
  const result = database.prepare(`
    INSERT INTO sellers (user_id, store_name, phone, platform_owned, status, approved_at)
    VALUES (?, 'Corner Store', '0000000000', 1, 'active', CURRENT_TIMESTAMP)
  `).run(platformUser.id);
  platformSeller = { id: Number(result.lastInsertRowid) };
}
if (platformSeller) database.prepare("UPDATE sellers SET platform_owned = 1 WHERE id = ?").run(platformSeller.id);

const productCount = database.prepare("SELECT COUNT(*) AS count FROM products").get().count;
if (productCount === 0) {
  const products = [
    ["Everyday Ceramic Mug", "Home", "A beautifully simple stoneware mug for slow mornings and long afternoons. Holds 12 oz and is dishwasher safe.", 39900, "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85", 24, 1],
    ["Linen Market Tote", "Accessories", "A sturdy, reusable tote cut from soft natural linen. Roomy enough for market finds, books, and daily essentials.", 79900, "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85", 18, 1],
    ["Amber Glass Bottle", "Home", "A refillable amber glass bottle with a clean silhouette and a leak-resistant stainless steel cap.", 49900, "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=85", 30, 0],
    ["Soft Knit Throw", "Home", "A lightweight, textured cotton throw made for a little extra comfort on the sofa or at the end of the bed.", 249900, "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85", 10, 1],
    ["Daily Notes Journal", "Stationery", "A thoughtfully made, lay-flat journal with 160 smooth, uncoated pages for ideas, lists, and everything in between.", 54900, "https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=900&q=85", 35, 0],
    ["Sculpted Candle", "Home", "A slow-burning soy wax candle with a subtle cedar and citrus scent, poured into a reusable ceramic vessel.", 89900, "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=900&q=85", 16, 0],
    ["Weekend Cap", "Accessories", "An easy everyday cap in washed cotton twill, finished with an adjustable brass clasp at the back.", 69900, "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=900&q=85", 14, 1],
    ["Botanical Hand Soap", "Bath", "A gentle, plant-based hand wash with aloe and a fresh botanical fragrance. Made for daily use.", 34900, "https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=900&q=85", 28, 0]
  ];
  const insert = database.prepare(`
    INSERT INTO products (name, category, description, price_paise, image_url, stock, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  database.transaction(() => products.forEach((item) => insert.run(...item)));
}

const legacyCategoryAssignments = new Map([
  ["Home", "home-decor"],
  ["Accessories", "fashion-accessories"],
  ["Stationery", "notebooks-diaries"],
  ["Bath", "bath-body"]
]);
const categoryBySlug = database.prepare("SELECT id, name FROM categories WHERE slug = ?");
const productsWithoutCategory = database.prepare("SELECT id, category FROM products WHERE category_id IS NULL").all();
const updateProductCategory = database.prepare("UPDATE products SET category_id = ? WHERE id = ?");
for (const product of productsWithoutCategory) {
  const slug = legacyCategoryAssignments.get(product.category) || product.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let category = categoryBySlug.get(slug);
  if (!category) category = database.prepare("SELECT id, name FROM categories WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1").get(product.category);
  if (category && database.prepare("SELECT 1 FROM categories WHERE parent_id = ? AND active = 1 LIMIT 1").get(category.id)) category = null;
  if (!category) {
    const otherCategory = categoryBySlug.get("other");
    const legacySlug = `legacy-${slug || product.id}`;
    database.prepare(`
      INSERT OR IGNORE INTO categories (name, slug, parent_id, display_order)
      VALUES (?, ?, ?, 100000)
    `).run(product.category, legacySlug, otherCategory.id);
    category = database.prepare("SELECT id, name FROM categories WHERE slug = ?").get(legacySlug);
  }
  updateProductCategory.run(category.id, product.id);
}

if (platformSeller) {
  database.prepare("UPDATE products SET seller_id = ? WHERE seller_id IS NULL").run(platformSeller.id);
  database.prepare(`
    UPDATE order_items
    SET seller_id = (SELECT seller_id FROM products WHERE products.id = order_items.product_id)
    WHERE seller_id IS NULL
  `).run();
  database.prepare(`
    UPDATE order_items
    SET commission_paise = CAST((price_paise * quantity * 1000 + 5000) / 10000 AS INTEGER),
        seller_payout_paise = price_paise * quantity - CAST((price_paise * quantity * 1000 + 5000) / 10000 AS INTEGER)
    WHERE commission_paise = 0 AND seller_payout_paise = 0
  `).run();
  database.prepare(`
    INSERT OR IGNORE INTO seller_fulfillments (order_id, seller_id, status, tracking_carrier, tracking_code)
    SELECT order_items.order_id, order_items.seller_id,
      CASE WHEN orders.status = 'pending_payment' THEN 'pending_payment' ELSE orders.status END,
      orders.tracking_carrier, orders.tracking_code
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE order_items.seller_id IS NOT NULL
    GROUP BY order_items.order_id, order_items.seller_id
  `).run();
}
database.exec("CREATE INDEX IF NOT EXISTS idx_seller_fulfillments_seller_status ON seller_fulfillments(seller_id, status, order_id)");

module.exports = database;
