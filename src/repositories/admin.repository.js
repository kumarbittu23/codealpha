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

function productSkuExists(sku, exceptId = 0) {
  return Boolean(database.prepare("SELECT 1 FROM products WHERE sku = ? AND id != ?").get(sku, exceptId));
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

function updateSeller(id, status) {
  return database.prepare(`
    UPDATE sellers
    SET status = ?, approved_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE approved_at END
    WHERE id = ? AND platform_owned = 0
  `).run(status, status, id).changes > 0;
}

function updateCommission(basisPoints) {
  database.prepare("UPDATE marketplace_settings SET commission_basis_points = ? WHERE id = 1").run(basisPoints);
}

function recordPayout(sellerId, reference, notes, paidByUserId) {
  return database.transaction(() => {
    const seller = database.prepare("SELECT id, status, platform_owned FROM sellers WHERE id = ?").get(sellerId);
    if (!seller || seller.platform_owned) return { error: "seller_not_found" };
    if (seller.status !== "active") return { error: "seller_inactive" };
    const items = database.prepare(`
      SELECT order_items.id, order_items.seller_payout_paise
      FROM order_items JOIN orders ON orders.id = order_items.order_id
      WHERE order_items.seller_id = ? AND orders.payment_status = 'paid'
        AND orders.status != 'cancelled' AND order_items.payout_status = 'pending'
    `).all(sellerId);
    const amountPaise = items.reduce((sum, item) => sum + item.seller_payout_paise, 0);
    if (amountPaise <= 0) return { error: "no_balance" };
    const result = database.prepare(`
      INSERT INTO seller_payouts (seller_id, amount_paise, reference, notes, paid_by_user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(sellerId, amountPaise, reference, notes, paidByUserId);
    const markPaid = database.prepare("UPDATE order_items SET payout_status = 'paid' WHERE id = ? AND payout_status = 'pending'");
    for (const item of items) markPaid.run(item.id);
    return { payout: { id: Number(result.lastInsertRowid), sellerId, amountPaise, reference } };
  });
}

function createCoupon(coupon) {
  const result = database.prepare(`
    INSERT INTO coupons (code, discount_basis_points, min_order_paise, max_discount_paise, usage_limit, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(coupon.code, coupon.discountBasisPoints, coupon.minOrderPaise, coupon.maxDiscountPaise, coupon.usageLimit, coupon.expiresAt);
  return { id: Number(result.lastInsertRowid), code: coupon.code };
}

function listCoupons() {
  return database.prepare(`
    SELECT id, code, discount_basis_points AS discountBasisPoints,
      min_order_paise AS minOrderPaise, max_discount_paise AS maxDiscountPaise,
      usage_limit AS usageLimit, usage_count AS usageCount, expires_at AS expiresAt, active
    FROM coupons ORDER BY id DESC
  `).all();
}

function updateCoupon(id, active) {
  return database.prepare("UPDATE coupons SET active = ? WHERE id = ?").run(active ? 1 : 0, id).changes > 0;
}

function findReturnStatus(id) {
  return database.prepare("SELECT status FROM return_requests WHERE id = ?").get(id)?.status || null;
}

function updateReturn(id, status, resolvedByUserId) {
  database.prepare(`
    UPDATE return_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ?
    WHERE id = ?
  `).run(status, resolvedByUserId, id);
}

function getOrderForAdminUpdate(id) {
  return database.prepare("SELECT id, status, payment_status AS paymentStatus FROM orders WHERE id = ?").get(id);
}

function hasShippedFulfillment(id) {
  return Boolean(database.prepare(`
    SELECT 1 FROM seller_fulfillments WHERE order_id = ? AND status IN ('shipped', 'delivered') LIMIT 1
  `).get(id));
}

function getOrderItemsForRestock(id) {
  return database.prepare("SELECT product_id AS productId, quantity FROM order_items WHERE order_id = ?").all(id);
}

function restockProduct(productId, quantity) {
  database.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(quantity, productId);
}

function cancelOrder(id) {
  database.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'cancelled' WHERE id = ?").run(id);
  database.prepare(`
    UPDATE seller_fulfillments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?
  `).run(id);
}

function markOrderDelivered(id, trackingCarrier, trackingCode) {
  database.prepare(`
    UPDATE orders SET status = 'delivered',
      tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
      tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
      payment_status = CASE WHEN payment_method = 'cash_on_delivery' THEN 'paid' ELSE payment_status END
    WHERE id = ?
  `).run(trackingCarrier, trackingCode, id);
  database.prepare(`
    UPDATE seller_fulfillments SET status = 'delivered',
      tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
      tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
      updated_at = CURRENT_TIMESTAMP
    WHERE order_id = ?
  `).run(trackingCarrier, trackingCode, id);
}

function updateOrderStatus(id, status, trackingCarrier, trackingCode) {
  database.prepare(`
    UPDATE orders SET status = ?,
      tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
      tracking_code = COALESCE(NULLIF(?, ''), tracking_code)
    WHERE id = ?
  `).run(status, trackingCarrier, trackingCode, id);
  database.prepare(`
    UPDATE seller_fulfillments SET status = ?,
      tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
      tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
      updated_at = CURRENT_TIMESTAMP
    WHERE order_id = ?
  `).run(status, trackingCarrier, trackingCode, id);
}

function transaction(callback) {
  return database.transaction(callback);
}

module.exports = {
  getOverview,
  productSkuExists,
  findCategory,
  categorySlugExists,
  hasActiveCategoryParent,
  isCategoryDescendant,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  updateProduct,
  deleteProduct,
  updateSeller,
  updateCommission,
  recordPayout,
  createCoupon,
  listCoupons,
  updateCoupon,
  findReturnStatus,
  updateReturn,
  getOrderForAdminUpdate,
  hasShippedFulfillment,
  getOrderItemsForRestock,
  restockProduct,
  cancelOrder,
  markOrderDelivered,
  updateOrderStatus,
  transaction
};
