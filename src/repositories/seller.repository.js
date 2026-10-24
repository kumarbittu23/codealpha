const database = require("../config/database");
const { saveAdditionalProductImages } = require("../services/marketplace.shared");

function findSellerByUserId(userId) {
  return database.prepare("SELECT id, store_name AS storeName, phone, gstin, status FROM sellers WHERE user_id = ?").get(userId);
}

function submitApplication(userId, application) {
  const current = findSellerByUserId(userId);
  if (current?.status === "rejected") {
    database.prepare(`
      UPDATE sellers SET store_name = ?, phone = ?, gstin = ?, status = 'pending', approved_at = NULL
      WHERE id = ? AND platform_owned = 0 AND status = 'rejected'
    `).run(application.storeName, application.phone, application.gstin, current.id);
    return {
      statusCode: 200,
      seller: { id: current.id, ...application, status: "pending" }
    };
  }
  if (current) return { conflictStatus: current.status };
  const result = database.prepare(`
    INSERT INTO sellers (user_id, store_name, phone, gstin, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(userId, application.storeName, application.phone, application.gstin);
  return {
    statusCode: 201,
    seller: { id: Number(result.lastInsertRowid), ...application, status: "pending" }
  };
}

function getOverview(sellerId) {
  let products = database.prepare(`
    SELECT id, name, sku, category, category_id AS categoryId, description, price_paise AS pricePaise, image_url AS imageUrl,
      stock, featured
    FROM products WHERE seller_id = ? ORDER BY id DESC
  `).all(sellerId);
  products = products.map((product) => {
    const productImages = database.prepare(`
      SELECT image_url AS imageUrl, model_profile AS modelProfile, view_label AS viewLabel
      FROM product_images WHERE product_id = ? ORDER BY display_order, id
    `).all(product.id);
    return { ...product, productImages, additionalImageUrls: productImages.map((image) => image.imageUrl) };
  });
  const orders = database.prepare(`
    SELECT orders.id, orders.total_paise AS totalPaise, orders.shipping_name AS shippingName,
      orders.shipping_address AS shippingAddress, orders.status AS orderStatus, orders.payment_method AS paymentMethod,
      orders.payment_status AS paymentStatus, seller_fulfillments.status,
      seller_fulfillments.tracking_carrier AS trackingCarrier,
      seller_fulfillments.tracking_code AS trackingCode, orders.created_at AS createdAt
    FROM seller_fulfillments JOIN orders ON orders.id = seller_fulfillments.order_id
    WHERE seller_fulfillments.seller_id = ? ORDER BY orders.id DESC
  `).all(sellerId);
  const items = database.prepare(`
    SELECT order_items.product_name AS productName, order_items.quantity,
      order_items.price_paise AS pricePaise, order_items.seller_payout_paise AS sellerPayoutPaise,
      products.name AS currentProductName
    FROM order_items LEFT JOIN products ON products.id = order_items.product_id
    WHERE order_items.order_id = ? AND order_items.seller_id = ?
  `);
  const sales = database.prepare(`
    SELECT COALESCE(SUM(order_items.seller_payout_paise), 0) AS paidPaise
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE order_items.seller_id = ? AND orders.payment_status = 'paid' AND order_items.payout_status = 'paid'
  `).get(sellerId);
  const pending = database.prepare(`
    SELECT COALESCE(SUM(order_items.seller_payout_paise), 0) AS pendingPaise
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE order_items.seller_id = ? AND orders.payment_status = 'paid'
      AND orders.status != 'cancelled' AND order_items.payout_status = 'pending'
  `).get(sellerId);
  return {
    products,
    orders: orders.map((order) => ({ ...order, items: items.all(order.id, sellerId) })),
    paidPaise: sales.paidPaise,
    pendingPaise: pending.pendingPaise,
    commissionBasisPoints: database.prepare("SELECT commission_basis_points FROM marketplace_settings WHERE id = 1").get().commission_basis_points,
    payouts: database.prepare(`
      SELECT id, amount_paise AS amountPaise, reference, notes, created_at AS createdAt
      FROM seller_payouts WHERE seller_id = ? ORDER BY id DESC LIMIT 20
    `).all(sellerId)
  };
}

function updateFulfillment({ orderId, sellerId, nextStatus, trackingCarrier, trackingCode }) {
  return database.transaction(() => {
    const current = database.prepare(`
      SELECT seller_fulfillments.status, orders.status AS orderStatus,
        orders.payment_method AS paymentMethod, orders.payment_status AS paymentStatus
      FROM seller_fulfillments JOIN orders ON orders.id = seller_fulfillments.order_id
      WHERE seller_fulfillments.order_id = ? AND seller_fulfillments.seller_id = ?
    `).get(orderId, sellerId);
    if (!current) throw new Error("SELLER_ORDER_NOT_FOUND");
    if (current.orderStatus === "cancelled") throw new Error("ORDER_CANCELLED");
    if (current.paymentMethod !== "cash_on_delivery" && current.paymentStatus !== "paid") {
      throw new Error("PAYMENT_NOT_CONFIRMED");
    }
    const allowedTransitions = {
      placed: ["processing"],
      processing: ["shipped"],
      shipped: ["delivered"],
      delivered: [],
      pending_payment: [],
      cancelled: []
    };
    if (!allowedTransitions[current.status]?.includes(nextStatus)) {
      throw new Error(`FULFILLMENT_TRANSITION:${current.status}:${nextStatus}`);
    }
    database.prepare(`
      UPDATE seller_fulfillments SET status = ?,
        tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
        tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
        updated_at = CURRENT_TIMESTAMP
      WHERE order_id = ? AND seller_id = ?
    `).run(nextStatus, trackingCarrier, trackingCode, orderId, sellerId);

    const shipments = database.prepare("SELECT status FROM seller_fulfillments WHERE order_id = ?").all(orderId);
    const orderStatus = shipments.every((shipment) => shipment.status === "delivered")
      ? "delivered"
      : shipments.some((shipment) => ["shipped", "delivered"].includes(shipment.status))
        ? "shipped"
        : shipments.some((shipment) => shipment.status === "processing") ? "processing" : "placed";
    database.prepare(`
      UPDATE orders SET status = ?,
        payment_status = CASE WHEN ? = 'delivered' AND payment_method = 'cash_on_delivery' THEN 'paid' ELSE payment_status END
      WHERE id = ?
    `).run(orderStatus, orderStatus, orderId);
    return { orderId, status: nextStatus, orderStatus };
  });
}

function saveSellerProduct(sellerId, product, productId = null) {
  if (productId === null) {
    const result = database.prepare(`
      INSERT INTO products (name, sku, category, category_id, description, price_paise, image_url, stock, featured, seller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(product.name, product.sku, product.category, product.categoryId, product.description, product.pricePaise, product.imageUrl, product.stock, sellerId);
    const id = Number(result.lastInsertRowid);
    saveAdditionalProductImages(id, product.productImages);
    return { id, ...product, featured: 0, sellerId };
  }
  const result = database.prepare(`
    UPDATE products SET name = ?, sku = ?, category = ?, category_id = ?, description = ?, price_paise = ?, image_url = ?, stock = ?
    WHERE id = ? AND seller_id = ?
  `).run(product.name, product.sku, product.category, product.categoryId, product.description, product.pricePaise, product.imageUrl, product.stock, productId, sellerId);
  if (result.changes === 0) return null;
  saveAdditionalProductImages(productId, product.productImages);
  return { id: productId, ...product, featured: 0, sellerId };
}

function deleteSellerProduct(sellerId, productId) {
  const product = database.prepare("SELECT id FROM products WHERE id = ? AND seller_id = ?").get(productId, sellerId);
  if (!product) return "not_found";
  const hasOrders = database.prepare("SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1").get(productId);
  if (hasOrders) return "has_orders";
  database.prepare("DELETE FROM products WHERE id = ? AND seller_id = ?").run(productId, sellerId);
  return "deleted";
}

module.exports = {
  findSellerByUserId,
  submitApplication,
  getOverview,
  updateFulfillment,
  saveSellerProduct,
  deleteSellerProduct
};
