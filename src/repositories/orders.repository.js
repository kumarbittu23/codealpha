const database = require("../config/database");
const formatRupees = require("../utils/currency");

function cancelCustomerOrder(orderId, userId) {
  return database.transaction(() => {
    const order = database.prepare(`
      SELECT id, status, payment_method AS paymentMethod
      FROM orders WHERE id = ? AND user_id = ?
    `).get(orderId, userId);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status !== "placed" || order.paymentMethod !== "cash_on_delivery") {
      throw new Error("ORDER_NOT_CANCELLABLE");
    }
    const items = database.prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?").all(orderId);
    const restock = database.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
    for (const item of items) restock.run(item.quantity, item.product_id);
    database.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'cancelled' WHERE id = ?").run(orderId);
  });
}

function findCustomerOrder(orderId, userId) {
  return database.prepare("SELECT id, status FROM orders WHERE id = ? AND user_id = ?").get(orderId, userId);
}

function createReturnRequest(orderId, userId, reason) {
  return database.prepare("INSERT INTO return_requests (order_id, user_id, reason) VALUES (?, ?, ?)").run(orderId, userId, reason);
}

function findPaymentOrder(orderId, userId) {
  return database.prepare(`
    SELECT id, total_paise AS totalPaise, status, payment_status AS paymentStatus,
      payment_method AS paymentMethod, razorpay_order_id AS razorpayOrderId
    FROM orders WHERE id = ? AND user_id = ?
  `).get(orderId, userId);
}

function markPaymentCaptured(orderId, userId, razorpayPaymentId) {
  database.transaction(() => {
    database.prepare(`
      UPDATE orders SET status = 'placed', payment_status = 'paid', razorpay_payment_id = ?
      WHERE id = ? AND user_id = ? AND status = 'pending_payment' AND payment_status = 'pending'
    `).run(razorpayPaymentId, orderId, userId);
    database.prepare(`
      UPDATE seller_fulfillments SET status = 'placed', updated_at = CURRENT_TIMESTAMP
      WHERE order_id = ? AND status = 'pending_payment'
    `).run(orderId);
  });
  return database.prepare("SELECT status, payment_status AS paymentStatus FROM orders WHERE id = ?").get(orderId);
}

function calculateCartQuote(quantities, couponCode = "") {
  const subtotalPaise = database.transaction(() => {
    let total = 0;
    for (const [productId, quantity] of quantities) {
      const product = database.prepare(`
        SELECT products.price_paise, products.stock, products.name
        FROM products JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
          JOIN categories ON categories.id = products.category_id AND categories.active = 1
        WHERE products.id = ?
      `).get(productId);
      if (!product) throw new Error("A product is no longer available.");
      if (product.stock < quantity) throw new Error(`${product.name} does not have enough stock available.`);
      total += product.price_paise * quantity;
    }
    return total;
  });
  const { coupon, discountPaise } = readCoupon(couponCode, subtotalPaise);
  return { coupon, subtotalPaise, discountPaise, totalPaise: subtotalPaise - discountPaise };
}

function readCoupon(code, subtotal) {
  if (!code) return { coupon: null, discountPaise: 0 };
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error("Coupon code is invalid.");
  const coupon = database.prepare(`
    SELECT id, code, discount_basis_points AS discountBasisPoints, min_order_paise AS minOrderPaise,
      max_discount_paise AS maxDiscountPaise, usage_limit AS usageLimit, usage_count AS usageCount,
      expires_at AS expiresAt
    FROM coupons WHERE code = ? AND active = 1
  `).get(code);
  if (!coupon || (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) ||
      (coupon.expiresAt && Date.parse(`${coupon.expiresAt}T23:59:59Z`) < Date.now())) {
    throw new Error("That coupon is invalid or expired.");
  }
  if (subtotal < coupon.minOrderPaise) {
    throw new Error(`Your cart must total at least ${formatRupees(coupon.minOrderPaise)} to use this coupon.`);
  }
  const discountPaise = Math.min(
    Math.floor(subtotal * coupon.discountBasisPoints / 10000),
    coupon.maxDiscountPaise ?? subtotal
  );
  return { coupon, discountPaise };
}

function saveOrder({
  userId, shippingName, shippingAddress, quantities, couponCode = "",
  paymentMethod, paymentStatus, razorpayOrderId = null, expectedTotalPaise
}) {
  return database.transaction(() => {
    const products = [];
    for (const [productId, quantity] of quantities) {
      const product = database.prepare(`
        SELECT products.id, products.name, products.price_paise, products.stock,
          products.seller_id AS sellerId, sellers.platform_owned AS platformOwned
        FROM products JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
          JOIN categories ON categories.id = products.category_id AND categories.active = 1
        WHERE products.id = ?
      `).get(productId);
      if (!product) throw new Error("One of the products in your cart is no longer available.");
      if (product.stock < quantity) throw new Error(`${product.name} does not have enough stock available.`);
      products.push({ ...product, quantity });
    }

    const subtotalPaise = products.reduce((total, product) => total + product.price_paise * product.quantity, 0);
    const { coupon, discountPaise } = readCoupon(couponCode, subtotalPaise);
    const totalPaise = subtotalPaise - discountPaise;
    if (!Number.isSafeInteger(totalPaise) || totalPaise < 1) throw new Error("The order amount is invalid.");
    if (expectedTotalPaise !== undefined && expectedTotalPaise !== totalPaise) {
      throw new Error("Your cart total changed while payment was starting. Review the total and try again.");
    }
    const setting = database.prepare("SELECT commission_basis_points FROM marketplace_settings WHERE id = 1").get();
    let discountAssigned = 0;
    const itemTotals = products.map((product, index) => {
      const grossPaise = product.price_paise * product.quantity;
      const allocation = index === products.length - 1
        ? discountPaise - discountAssigned
        : Math.floor(discountPaise * grossPaise / subtotalPaise);
      discountAssigned += allocation;
      const netPaise = grossPaise - allocation;
      const commissionPaise = product.platformOwned
        ? netPaise
        : Math.floor((netPaise * setting.commission_basis_points + 5000) / 10000);
      return { ...product, grossPaise, allocation, commissionPaise, sellerPayoutPaise: netPaise - commissionPaise };
    });
    const result = database.prepare(`
      INSERT INTO orders (
        user_id, total_paise, shipping_name, shipping_address, status,
        payment_method, payment_status, razorpay_order_id, discount_paise, coupon_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      totalPaise,
      shippingName,
      shippingAddress,
      paymentMethod === "razorpay" ? "pending_payment" : "placed",
      paymentMethod,
      paymentStatus,
      razorpayOrderId,
      discountPaise,
      coupon?.code || null
    );
    const orderId = Number(result.lastInsertRowid);
    const addItem = database.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, quantity, price_paise, seller_id,
        commission_paise, seller_payout_paise, discount_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = database.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?");
    for (const product of itemTotals) {
      addItem.run(
        orderId, product.id, product.name, product.quantity, product.price_paise,
        product.sellerId, product.commissionPaise, product.sellerPayoutPaise, product.allocation
      );
      const update = updateStock.run(product.quantity, product.id, product.quantity);
      if (update.changes !== 1) throw new Error(`${product.name} does not have enough stock available.`);
    }
    const addFulfillment = database.prepare(`
      INSERT INTO seller_fulfillments (order_id, seller_id, status)
      VALUES (?, ?, ?)
    `);
    for (const sellerId of new Set(itemTotals.map((product) => product.sellerId))) {
      addFulfillment.run(orderId, sellerId, paymentMethod === "razorpay" ? "pending_payment" : "placed");
    }
    if (coupon) {
      const used = database.prepare(`
        UPDATE coupons SET usage_count = usage_count + 1
        WHERE id = ? AND active = 1 AND (usage_limit IS NULL OR usage_count < usage_limit)
      `).run(coupon.id);
      if (used.changes !== 1) throw new Error("That coupon has reached its usage limit. Please refresh your cart.");
    }
    return { id: orderId, subtotalPaise, discountPaise, totalPaise, couponCode: coupon?.code || null };
  });
}

module.exports = {
  cancelCustomerOrder,
  findCustomerOrder,
  createReturnRequest,
  findPaymentOrder,
  markPaymentCaptured,
  calculateCartQuote,
  saveOrder
};
