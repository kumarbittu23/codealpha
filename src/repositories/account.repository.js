const database = require("../config/database");

function listOrders(userId) {
  const orders = database.prepare(`
    SELECT orders.id, orders.total_paise AS totalPaise, orders.shipping_name AS shippingName,
      orders.shipping_address AS shippingAddress, orders.status, orders.payment_method AS paymentMethod,
      orders.payment_status AS paymentStatus, orders.tracking_carrier AS trackingCarrier,
      orders.tracking_code AS trackingCode, orders.created_at AS createdAt,
      return_requests.status AS returnStatus, return_requests.reason AS returnReason
    FROM orders LEFT JOIN return_requests ON return_requests.order_id = orders.id AND return_requests.user_id = orders.user_id
    WHERE orders.user_id = ? ORDER BY orders.id DESC
  `).all(userId);
  const items = database.prepare(`
    SELECT order_items.product_id AS productId, order_items.product_name AS productName,
      order_items.quantity, order_items.price_paise AS pricePaise,
      products.name AS currentProductName, products.stock AS currentStock
    FROM order_items LEFT JOIN products ON products.id = order_items.product_id
    WHERE order_items.order_id = ?
  `);
  const shipments = database.prepare(`
    SELECT sellers.store_name AS sellerName, seller_fulfillments.status,
      seller_fulfillments.tracking_carrier AS trackingCarrier,
      seller_fulfillments.tracking_code AS trackingCode
    FROM seller_fulfillments
    JOIN sellers ON sellers.id = seller_fulfillments.seller_id
    WHERE seller_fulfillments.order_id = ?
    ORDER BY sellers.store_name COLLATE NOCASE
  `);
  return orders.map((order) => ({ ...order, items: items.all(order.id), shipments: shipments.all(order.id) }));
}

function findPasswordHash(userId) {
  return database.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
}

function updateProfile(userId, { name, email, passwordHash }) {
  database.prepare("UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?")
    .run(name, email, passwordHash, userId);
}

function getRewardTotals(userId) {
  return database.prepare(`
    SELECT COALESCE(SUM(orders.total_paise), 0) AS deliveredTotalPaise,
      COUNT(orders.id) AS deliveredOrderCount
    FROM orders
    WHERE orders.user_id = ? AND orders.status = 'delivered'
      AND NOT EXISTS (
        SELECT 1 FROM return_requests
        WHERE return_requests.order_id = orders.id AND return_requests.status = 'refunded'
      )
  `).get(userId);
}

function listAddresses(userId) {
  return database.prepare(`
    SELECT id, recipient_name AS recipientName, phone, line1, line2, city, state,
      postal_code AS postalCode, is_default AS isDefault
    FROM saved_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC
  `).all(userId);
}

function createAddress(userId, address, isDefault) {
  return database.transaction(() => {
    if (isDefault) database.prepare("UPDATE saved_addresses SET is_default = 0 WHERE user_id = ?").run(userId);
    const result = database.prepare(`
      INSERT INTO saved_addresses
        (user_id, recipient_name, phone, line1, line2, city, state, postal_code, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, address.recipientName, address.phone, address.line1,
      address.line2, address.city, address.state, address.postalCode, isDefault ? 1 : 0
    );
    return { id: Number(result.lastInsertRowid), ...address, isDefault: isDefault ? 1 : 0 };
  });
}

function deleteAddress(userId, addressId) {
  const address = database.prepare("SELECT is_default FROM saved_addresses WHERE id = ? AND user_id = ?").get(addressId, userId);
  if (!address) return false;
  database.transaction(() => {
    database.prepare("DELETE FROM saved_addresses WHERE id = ? AND user_id = ?").run(addressId, userId);
    if (address.is_default) {
      database.prepare(`
        UPDATE saved_addresses SET is_default = 1
        WHERE id = (SELECT id FROM saved_addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1)
      `).run(userId);
    }
  });
  return true;
}

function listWishlist(userId) {
  return database.prepare(`
    SELECT products.id, products.name, products.category, products.category_id AS categoryId, products.price_paise AS pricePaise,
      products.image_url AS imageUrl, products.stock, sellers.store_name AS sellerName
    FROM wishlists
    JOIN products ON products.id = wishlists.product_id
    JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
    JOIN categories ON categories.id = products.category_id AND categories.active = 1
    WHERE wishlists.user_id = ? ORDER BY wishlists.created_at DESC
  `).all(userId);
}

function isWishlistProductAvailable(productId) {
  return database.prepare(`
    SELECT products.id FROM products
    JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
    JOIN categories ON categories.id = products.category_id AND categories.active = 1
    WHERE products.id = ?
  `).get(productId);
}

function addToWishlist(userId, productId) {
  database.prepare("INSERT OR IGNORE INTO wishlists (user_id, product_id) VALUES (?, ?)").run(userId, productId);
}

function removeFromWishlist(userId, productId) {
  database.prepare("DELETE FROM wishlists WHERE user_id = ? AND product_id = ?").run(userId, productId);
}

module.exports = {
  listOrders,
  findPasswordHash,
  updateProfile,
  getRewardTotals,
  listAddresses,
  createAddress,
  deleteAddress,
  listWishlist,
  isWishlistProductAvailable,
  addToWishlist,
  removeFromWishlist
};
