const database = require("../config/database");
const { readAdminProduct } = require("../services/marketplace.shared");
const adminRepository = require("../repositories/admin.repository");
const adminService = require("../services/admin.service");

function createAdminController() {
  return {
    getOverview(request, response) {
      response.json(adminRepository.getOverview());
    },
    createCategory(request, response) {
      const input = adminService.createCategory(request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.status(201).json(adminRepository.createCategory(input.category));
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: categories\.slug/.test(error.message)) {
          return response.status(409).json({ error: "That category URL slug is already in use." });
        }
        throw error;
      }
    },
    updateCategory(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid category ID." });
      const input = adminService.updateCategory(id, request.body);
      if (input.error) return response.status(input.status).json({ error: input.error });
      try {
        response.json(adminRepository.updateCategory(id, input.category));
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: categories\.slug/.test(error.message)) {
          return response.status(409).json({ error: "That category URL slug is already in use." });
        }
        throw error;
      }
    },
    deleteCategory(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid category ID." });
      if (!adminRepository.findCategory(id)) return response.status(404).json({ error: "Category not found." });
      const result = adminRepository.deleteCategory(id);
      if (!result.deleted) {
        return response.status(409).json({
          error: `Category cannot be deleted while it has ${result.childCount ? "subcategories" : ""}${result.childCount && result.productCount ? " or " : ""}${result.productCount ? "products" : ""}. Reassign products or deactivate the category instead.`
        });
      }
      response.status(204).end();
    },
    createProduct(request, response) {
  const input = readAdminProduct(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  const product = adminRepository.createProduct(input.product);
  if (!product) return response.status(503).json({ error: "Platform seller is not configured." });
  response.status(201).json(product);
    },
    updateProduct(request, response) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid product ID." });
  const input = readAdminProduct(request.body, id);
  if (input.error) return response.status(400).json({ error: input.error });
  const product = input.product;
  const updated = adminRepository.updateProduct(id, product);
  if (!updated) return response.status(404).json({ error: "Product not found." });
  response.json(updated);
    },
    deleteProduct(request, response) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid product ID." });
  const result = adminRepository.deleteProduct(id);
  if (result === "not_found") return response.status(404).json({ error: "Product not found." });
  if (result === "has_orders") return response.status(409).json({ error: "This product is part of an order and cannot be deleted. Set its stock to zero instead." });
  response.status(204).end();
    },
    updateSeller(request, response) {
  const sellerId = Number(request.params.id);
  const status = typeof request.body.status === "string" ? request.body.status : "";
  if (!Number.isSafeInteger(sellerId) || sellerId < 1) return response.status(400).json({ error: "Invalid seller ID." });
  if (!["active", "rejected", "suspended"].includes(status)) return response.status(400).json({ error: "Choose a valid seller status." });
  const result = database.prepare(`
    UPDATE sellers
    SET status = ?, approved_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE approved_at END
    WHERE id = ? AND platform_owned = 0
  `).run(status, status, sellerId);
  if (result.changes === 0) return response.status(404).json({ error: "Seller application not found." });
  response.json({ id: sellerId, status });
    },
    updateCommission(request, response) {
  const percent = Number(request.body.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 50 || Math.round(percent * 100) !== percent * 100) {
    return response.status(400).json({ error: "Commission must be between 0 and 50%, with up to two decimal places." });
  }
  const basisPoints = Math.round(percent * 100);
  database.prepare("UPDATE marketplace_settings SET commission_basis_points = ? WHERE id = 1").run(basisPoints);
  response.json({ commissionBasisPoints: basisPoints });
    },
    createPayout(request, response) {
  const sellerId = Number(request.params.id);
  const reference = typeof request.body.reference === "string" ? request.body.reference.trim() : "";
  const notes = typeof request.body.notes === "string" ? request.body.notes.trim() : "";
  if (!Number.isSafeInteger(sellerId) || sellerId < 1) return response.status(400).json({ error: "Invalid seller ID." });
  if (reference.length < 3 || reference.length > 100) return response.status(400).json({ error: "Enter the bank transfer UTR/reference (3–100 characters)." });
  if (notes.length > 500) return response.status(400).json({ error: "Payout notes must be 500 characters or fewer." });
  try {
    const payout = database.transaction(() => {
      const seller = database.prepare("SELECT id, status, platform_owned FROM sellers WHERE id = ?").get(sellerId);
      if (!seller || seller.platform_owned) throw new Error("SELLER_NOT_FOUND");
      if (seller.status !== "active") throw new Error("Seller must be active before a payout is recorded.");
      const items = database.prepare(`
        SELECT order_items.id, order_items.seller_payout_paise
        FROM order_items JOIN orders ON orders.id = order_items.order_id
        WHERE order_items.seller_id = ? AND orders.payment_status = 'paid'
          AND orders.status != 'cancelled' AND order_items.payout_status = 'pending'
      `).all(sellerId);
      const amountPaise = items.reduce((sum, item) => sum + item.seller_payout_paise, 0);
      if (amountPaise <= 0) throw new Error("No paid seller balance is available for payout.");
      const result = database.prepare(`
        INSERT INTO seller_payouts (seller_id, amount_paise, reference, notes, paid_by_user_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(sellerId, amountPaise, reference, notes, request.session.user.id);
      const markPaid = database.prepare("UPDATE order_items SET payout_status = 'paid' WHERE id = ? AND payout_status = 'pending'");
      for (const item of items) markPaid.run(item.id);
      return { id: Number(result.lastInsertRowid), sellerId, amountPaise, reference };
    });
    response.status(201).json(payout);
  } catch (error) {
    if (error.message === "SELLER_NOT_FOUND") return response.status(404).json({ error: "Seller not found." });
    if (error.message.startsWith("Seller must") || error.message.startsWith("No paid seller")) {
      return response.status(409).json({ error: error.message });
    }
    throw error;
  }
    },
    createCoupon(request, response) {
  const code = typeof request.body.code === "string" ? request.body.code.trim().toUpperCase() : "";
  const percent = Number(request.body.percent);
  const minOrderPaise = Number(request.body.minOrderPaise || 0);
  const maxDiscountPaise = request.body.maxDiscountPaise === "" || request.body.maxDiscountPaise == null ? null : Number(request.body.maxDiscountPaise);
  const usageLimit = request.body.usageLimit === "" || request.body.usageLimit == null ? null : Number(request.body.usageLimit);
  const expiresAt = typeof request.body.expiresAt === "string" && request.body.expiresAt ? request.body.expiresAt : null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return response.status(400).json({ error: "Coupon code must be 3–32 letters, numbers, hyphens, or underscores." });
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || Math.round(percent * 100) !== percent * 100) {
    return response.status(400).json({ error: "Discount must be greater than 0 and at most 100%, with up to two decimal places." });
  }
  if (!Number.isSafeInteger(minOrderPaise) || minOrderPaise < 0 ||
      (maxDiscountPaise !== null && (!Number.isSafeInteger(maxDiscountPaise) || maxDiscountPaise < 1)) ||
      (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1))) {
    return response.status(400).json({ error: "Coupon limits must be valid whole-number paise/uses." });
  }
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return response.status(400).json({ error: "Enter a valid coupon expiry date." });
  try {
    const result = database.prepare(`
      INSERT INTO coupons (code, discount_basis_points, min_order_paise, max_discount_paise, usage_limit, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(code, Math.round(percent * 100), minOrderPaise, maxDiscountPaise, usageLimit, expiresAt);
    response.status(201).json({ id: Number(result.lastInsertRowid), code });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return response.status(409).json({ error: "A coupon with this code already exists." });
    throw error;
  }
    },
    listCoupons(request, response) {
  response.json(database.prepare(`
    SELECT id, code, discount_basis_points AS discountBasisPoints,
      min_order_paise AS minOrderPaise, max_discount_paise AS maxDiscountPaise,
      usage_limit AS usageLimit, usage_count AS usageCount, expires_at AS expiresAt, active
    FROM coupons ORDER BY id DESC
  `).all());
    },
    updateCoupon(request, response) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof request.body.active !== "boolean") {
    return response.status(400).json({ error: "Provide a valid coupon and active state." });
  }
  const result = database.prepare("UPDATE coupons SET active = ? WHERE id = ?").run(request.body.active ? 1 : 0, id);
  if (!result.changes) return response.status(404).json({ error: "Coupon not found." });
  response.json({ id, active: request.body.active });
    },
    updateReturn(request, response) {
  const id = Number(request.params.id);
  const status = typeof request.body.status === "string" ? request.body.status : "";
  if (!Number.isSafeInteger(id) || id < 1 || !["approved", "rejected", "refunded"].includes(status)) {
    return response.status(400).json({ error: "Provide a valid return request ID and status." });
  }
  const resolved = database.prepare("SELECT status FROM return_requests WHERE id = ?").get(id);
  if (!resolved) return response.status(404).json({ error: "Return request not found." });
  if (status === "refunded" && resolved.status !== "approved") {
    return response.status(409).json({ error: "Approve the return before marking its external refund as completed." });
  }
  database.prepare(`
    UPDATE return_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ?
    WHERE id = ?
  `).run(status, request.session.user.id, id);
  response.json({ id, status });
    },
    updateOrder(request, response) {
  const id = Number(request.params.id);
  const nextStatus = typeof request.body.status === "string" ? request.body.status : "";
  const trackingCarrier = typeof request.body.trackingCarrier === "string" ? request.body.trackingCarrier.trim() : "";
  const trackingCode = typeof request.body.trackingCode === "string" ? request.body.trackingCode.trim() : "";
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid order ID." });
  if (!["processing", "shipped", "delivered", "cancelled"].includes(nextStatus)) {
    return response.status(400).json({ error: "Choose a valid order status." });
  }
  if (trackingCarrier.length > 100 || trackingCode.length > 100) return response.status(400).json({ error: "Tracking carrier and code must be 100 characters or fewer." });

  try {
    const order = database.transaction(() => {
      const current = database.prepare("SELECT id, status, payment_status FROM orders WHERE id = ?").get(id);
      if (!current) throw new Error("ORDER_NOT_FOUND");
      if (nextStatus === "cancelled" && current.payment_status === "paid") {
        throw new Error("Paid orders cannot be cancelled here. Process any refund in the payment provider first.");
      }
      if (nextStatus === "cancelled" && database.prepare(`
        SELECT 1 FROM seller_fulfillments WHERE order_id = ? AND status IN ('shipped', 'delivered') LIMIT 1
      `).get(id)) {
        throw new Error("An order with a shipped seller package cannot be cancelled.");
      }
      const allowedTransitions = {
        placed: ["processing", "cancelled"],
        pending_payment: ["cancelled"],
        processing: ["shipped", "cancelled"],
        shipped: ["delivered"],
        delivered: [],
        cancelled: []
      };
      if (!allowedTransitions[current.status]?.includes(nextStatus)) {
        throw new Error(`Order cannot move from ${current.status} to ${nextStatus}.`);
      }

      if (nextStatus === "cancelled") {
        const items = database.prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?").all(id);
        const restock = database.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
        for (const item of items) restock.run(item.quantity, item.product_id);
        database.prepare("UPDATE orders SET status = ?, payment_status = 'cancelled' WHERE id = ?").run(nextStatus, id);
        database.prepare(`
          UPDATE seller_fulfillments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?
        `).run(id);
      }
      else if (nextStatus === "delivered") {
        database.prepare(`
          UPDATE orders SET status = ?,
            tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
            tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
            payment_status = CASE
            WHEN payment_method = 'cash_on_delivery' THEN 'paid'
            ELSE payment_status
          END
          WHERE id = ?
        `).run(nextStatus, trackingCarrier, trackingCode, id);
        database.prepare(`
          UPDATE seller_fulfillments SET status = 'delivered',
            tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
            tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
            updated_at = CURRENT_TIMESTAMP
          WHERE order_id = ?
        `).run(trackingCarrier, trackingCode, id);
      } else {
        database.prepare(`
          UPDATE orders SET status = ?,
            tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
            tracking_code = COALESCE(NULLIF(?, ''), tracking_code)
          WHERE id = ?
        `).run(nextStatus, trackingCarrier, trackingCode, id);
        database.prepare(`
          UPDATE seller_fulfillments SET status = ?,
            tracking_carrier = COALESCE(NULLIF(?, ''), tracking_carrier),
            tracking_code = COALESCE(NULLIF(?, ''), tracking_code),
            updated_at = CURRENT_TIMESTAMP
          WHERE order_id = ?
        `).run(nextStatus, trackingCarrier, trackingCode, id);
      }
      return { id, status: nextStatus };
    });
    response.json(order);
  } catch (error) {
    if (error.message === "ORDER_NOT_FOUND") return response.status(404).json({ error: "Order not found." });
    if (error.message.startsWith("Order cannot move")) return response.status(409).json({ error: error.message });
    if (error.message.startsWith("Paid orders cannot")) return response.status(409).json({ error: error.message });
    if (error.message.startsWith("An order with a shipped")) return response.status(409).json({ error: error.message });
    throw error;
  }
    }
  };
}

module.exports = createAdminController;
