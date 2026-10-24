const database = require("../config/database");
const {
  readCategories,
  categoryById,
  additionalProductImages,
  saveAdditionalProductImages,
  adminProductQuery
} = require("../services/marketplace.shared");

function getOverview() {
  const products = database.prepare(`${adminProductQuery()} ORDER BY products.id DESC`).all();
  const orders = database.prepare(`
    SELECT orders.id, orders.total_paise AS totalPaise, orders.shipping_name AS shippingName,
      orders.shipping_address AS shippingAddress, orders.status, orders.payment_method AS paymentMethod,
      orders.payment_status AS paymentStatus, orders.discount_paise AS discountPaise,
      orders.coupon_code AS couponCode, orders.tracking_carrier AS trackingCarrier,
      orders.tracking_code AS trackingCode, orders.created_at AS createdAt,
      users.name AS customerName, users.email AS customerEmail
    FROM orders JOIN users ON users.id = orders.user_id
    ORDER BY orders.id DESC
  `).all();
  const orderItems = database.prepare(`
    SELECT order_items.product_name AS productName, order_items.quantity,
      order_items.price_paise AS pricePaise, order_items.commission_paise AS commissionPaise,
      order_items.seller_payout_paise AS sellerPayoutPaise, order_items.payout_status AS payoutStatus,
      sellers.store_name AS sellerName
    FROM order_items LEFT JOIN sellers ON sellers.id = order_items.seller_id
    WHERE order_items.order_id = ?
  `);
  const sellers = database.prepare(`
    SELECT sellers.id, sellers.store_name AS storeName, sellers.phone, sellers.gstin,
      sellers.status, sellers.platform_owned AS platformOwned, sellers.created_at AS createdAt,
      users.name AS ownerName, users.email AS ownerEmail,
      COALESCE(SUM(CASE WHEN orders.payment_status = 'paid' AND orders.status != 'cancelled'
        AND order_items.payout_status = 'pending' THEN order_items.seller_payout_paise ELSE 0 END), 0) AS pendingPaise
    FROM sellers JOIN users ON users.id = sellers.user_id
    LEFT JOIN order_items ON order_items.seller_id = sellers.id
    LEFT JOIN orders ON orders.id = order_items.order_id
    GROUP BY sellers.id ORDER BY sellers.platform_owned DESC, sellers.id DESC
  `).all();
  const reviews = database.prepare(`
    SELECT reviews.id, reviews.rating, reviews.body, reviews.status,
      CASE WHEN reviews.image_data IS NULL THEN 0 ELSE 1 END AS hasImage,
      reviews.created_at AS createdAt, products.name AS productName,
      users.name AS reviewerName
    FROM reviews
    JOIN products ON products.id = reviews.product_id
    JOIN users ON users.id = reviews.user_id
    ORDER BY CASE reviews.status WHEN 'hidden' THEN 0 ELSE 1 END, reviews.id DESC
    LIMIT 100
  `).all();
  const returnRequests = database.prepare(`
    SELECT return_requests.id, return_requests.order_id AS orderId, return_requests.reason,
      return_requests.status, return_requests.created_at AS createdAt,
      users.name AS customerName, users.email AS customerEmail,
      orders.total_paise AS totalPaise, orders.payment_method AS paymentMethod
    FROM return_requests
    JOIN users ON users.id = return_requests.user_id
    JOIN orders ON orders.id = return_requests.order_id
    ORDER BY CASE return_requests.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      return_requests.id DESC
    LIMIT 100
  `).all();
  const categories = readCategories(true);
  const categoryLabels = new Map();
  const addLabels = (nodes, prefix = []) => {
    for (const category of nodes) {
      const labels = [...prefix, category.name];
      categoryLabels.set(category.id, labels.join(" / "));
      addLabels(category.children, labels);
    }
  };
  addLabels(categories);
  const productsWithImages = products.map((product) => {
    const productImages = additionalProductImages(product.id);
    return {
      ...product,
      categoryPathLabel: categoryLabels.get(product.categoryId) || product.category,
      productImages,
      additionalImageUrls: productImages.map((image) => image.imageUrl)
    };
  });
  return {
    products: productsWithImages,
    categories,
    orders: orders.map((order) => ({ ...order, items: orderItems.all(order.id) })),
    sellers,
    reviews,
    returnRequests,
    commissionBasisPoints: database.prepare("SELECT commission_basis_points FROM marketplace_settings WHERE id = 1").get().commission_basis_points
  };
}

function findCategory(id) {
  return categoryById(id);
}

function categorySlugExists(slug, exceptId = null) {
  return exceptId === null
    ? database.prepare("SELECT 1 FROM categories WHERE slug = ?").get(slug)
    : database.prepare("SELECT 1 FROM categories WHERE slug = ? AND id != ?").get(slug, exceptId);
}

function hasActiveCategoryParent(id) {
  return Boolean(categoryById(id)?.active);
}

function isCategoryDescendant(parentId, categoryId) {
  return Boolean(database.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM categories WHERE parent_id = ?
      UNION ALL SELECT categories.id FROM categories JOIN descendants ON categories.parent_id = descendants.id
    ) SELECT 1 FROM descendants WHERE id = ?
  `).get(categoryId, parentId));
}

function createCategory(category) {
  const result = database.prepare(`
    INSERT INTO categories (name, slug, parent_id, description, image_url, active, display_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(category.name, category.slug, category.parentId, category.description, category.imageUrl, category.displayOrder);
  return categoryById(Number(result.lastInsertRowid));
}

function updateCategory(id, category) {
  database.prepare(`
    UPDATE categories SET name = ?, slug = ?, parent_id = ?, description = ?, image_url = ?, active = ?,
      display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(category.name, category.slug, category.parentId, category.description, category.imageUrl, category.active, category.displayOrder, id);
  return categoryById(id);
}

function deleteCategory(id) {
  const dependencies = database.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM categories WHERE id = ?
      UNION ALL SELECT categories.id FROM categories JOIN descendants ON categories.parent_id = descendants.id
    )
    SELECT
      (SELECT COUNT(*) FROM categories WHERE parent_id IN (SELECT id FROM descendants)) AS childCount,
      (SELECT COUNT(*) FROM products WHERE category_id IN (SELECT id FROM descendants)) AS productCount
  `).get(id);
  if (dependencies.childCount || dependencies.productCount) return { deleted: false, ...dependencies };
  database.prepare("DELETE FROM categories WHERE id = ?").run(id);
  return { deleted: true };
}

function createProduct(product) {
  const platformSeller = database.prepare("SELECT id FROM sellers WHERE platform_owned = 1 ORDER BY id LIMIT 1").get();
  if (!platformSeller) return null;
  const result = database.prepare(`
    INSERT INTO products (name, sku, category, category_id, description, price_paise, image_url, stock, featured, seller_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(product.name, product.sku, product.category, product.categoryId, product.description, product.pricePaise, product.imageUrl, product.stock, product.featured, platformSeller.id);
  const id = Number(result.lastInsertRowid);
  saveAdditionalProductImages(id, product.productImages);
  return { id, ...product };
}

function updateProduct(id, product) {
  const result = database.prepare(`
    UPDATE products SET name = ?, sku = ?, category = ?, category_id = ?, description = ?, price_paise = ?,
      image_url = ?, stock = ?, featured = ?
    WHERE id = ?
  `).run(product.name, product.sku, product.category, product.categoryId, product.description, product.pricePaise, product.imageUrl, product.stock, product.featured, id);
  if (!result.changes) return null;
  saveAdditionalProductImages(id, product.productImages);
  return { id, ...product };
}

function deleteProduct(id) {
  if (!database.prepare("SELECT id FROM products WHERE id = ?").get(id)) return "not_found";
  if (database.prepare("SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1").get(id)) return "has_orders";
  database.prepare("DELETE FROM products WHERE id = ?").run(id);
  return "deleted";
}

module.exports = {
  getOverview,
  findCategory,
  categorySlugExists,
  hasActiveCategoryParent,
  isCategoryDescendant,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  updateProduct,
  deleteProduct
};
