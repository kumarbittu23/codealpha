const repository = require("../repositories/admin.repository");
const { makeCategorySlug, readAdminProduct } = require("./marketplace.shared");

function readProduct(body, currentProductId = 0) {
  return readAdminProduct(body, currentProductId, repository.productSkuExists);
}

function validateCategory(body, existing = null, id = null) {
  const name = body.name === undefined && existing
    ? existing.name
    : typeof body.name === "string" ? body.name.trim() : "";
  const description = body.description === undefined && existing
    ? existing.description
    : typeof body.description === "string" ? body.description.trim() : "";
  const imageUrl = body.imageUrl === undefined && existing
    ? existing.imageUrl
    : typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  const slugInput = body.slug === undefined && existing
    ? existing.slug
    : typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : name;
  const slug = makeCategorySlug(slugInput);
  const parentId = body.parentId === undefined && existing
    ? existing.parentId
    : body.parentId === null || body.parentId === "" || body.parentId === undefined
      ? null : Number(body.parentId);
  const active = existing
    ? body.active === undefined ? existing.active : body.active === true ? 1 : body.active === false ? 0 : null
    : 1;
  const displayOrder = body.displayOrder === undefined
    ? existing ? existing.displayOrder : 0
    : Number(body.displayOrder);

  if (name.length < 2 || name.length > 80) {
    return { error: existing ? "Provide a valid category name, slug, and description." : "Category name must be 2 to 80 characters.", status: 400 };
  }
  if (!slug || slug.length > 80) {
    return { error: existing ? "Provide a valid category name, slug, and description." : "Enter a valid category URL slug.", status: 400 };
  }
  if (description.length > 500) {
    return { error: existing ? "Provide a valid category name, slug, and description." : "Category description must be 500 characters or fewer.", status: 400 };
  }
  if (active === null) return { error: "Category active must be true or false.", status: 400 };
  if (imageUrl) {
    try {
      if (new URL(imageUrl).protocol !== "https:" || imageUrl.length > 500) throw new Error("invalid image URL");
    } catch {
      return { error: "Category image URL must use HTTPS and be under 500 characters.", status: 400 };
    }
  }
  if (parentId !== null && (!Number.isSafeInteger(parentId) || !repository.hasActiveCategoryParent(parentId))) {
    return { error: "Choose an active parent category.", status: 400 };
  }
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0 || displayOrder > 100000) {
    return { error: "Display order must be a whole number between 0 and 100,000.", status: 400 };
  }
  if (id !== null && (parentId === id || (parentId !== null && repository.isCategoryDescendant(id, parentId)))) {
    return { error: "A category cannot be its own ancestor.", status: 400 };
  }
  if (repository.categorySlugExists(slug, id)) {
    return { error: "That category URL slug is already in use.", status: 409 };
  }
  return { category: { name, slug, parentId, description, imageUrl, active, displayOrder } };
}

function createCategory(body) {
  return validateCategory(body);
}

function updateCategory(id, body) {
  const existing = repository.findCategory(id);
  if (!existing) return { error: "Category not found.", status: 404 };
  return validateCategory(body, existing, id);
}

function updateSeller(sellerId, body) {
  if (!Number.isSafeInteger(sellerId) || sellerId < 1) return { error: "Invalid seller ID.", status: 400 };
  const status = typeof body.status === "string" ? body.status : "";
  if (!["active", "rejected", "suspended"].includes(status)) {
    return { error: "Choose a valid seller status.", status: 400 };
  }
  if (!repository.updateSeller(sellerId, status)) return { error: "Seller application not found.", status: 404 };
  return { result: { id: sellerId, status } };
}

function updateCommission(body) {
  const percent = Number(body.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 50 || Math.round(percent * 100) !== percent * 100) {
    return { error: "Commission must be between 0 and 50%, with up to two decimal places.", status: 400 };
  }
  const basisPoints = Math.round(percent * 100);
  repository.updateCommission(basisPoints);
  return { result: { commissionBasisPoints: basisPoints } };
}

function createPayout(sellerId, body, paidByUserId) {
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!Number.isSafeInteger(sellerId) || sellerId < 1) return { error: "Invalid seller ID.", status: 400 };
  if (reference.length < 3 || reference.length > 100) {
    return { error: "Enter the bank transfer UTR/reference (3–100 characters).", status: 400 };
  }
  if (notes.length > 500) return { error: "Payout notes must be 500 characters or fewer.", status: 400 };
  const result = repository.recordPayout(sellerId, reference, notes, paidByUserId);
  if (result.error === "seller_not_found") return { error: "Seller not found.", status: 404 };
  if (result.error === "seller_inactive") return { error: "Seller must be active before a payout is recorded.", status: 409 };
  if (result.error === "no_balance") return { error: "No paid seller balance is available for payout.", status: 409 };
  return { result: result.payout };
}

function createCoupon(body) {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const percent = Number(body.percent);
  const minOrderPaise = Number(body.minOrderPaise || 0);
  const maxDiscountPaise = body.maxDiscountPaise === "" || body.maxDiscountPaise == null ? null : Number(body.maxDiscountPaise);
  const usageLimit = body.usageLimit === "" || body.usageLimit == null ? null : Number(body.usageLimit);
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? body.expiresAt : null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return { error: "Coupon code must be 3–32 letters, numbers, hyphens, or underscores.", status: 400 };
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || Math.round(percent * 100) !== percent * 100) {
    return { error: "Discount must be greater than 0 and at most 100%, with up to two decimal places.", status: 400 };
  }
  if (!Number.isSafeInteger(minOrderPaise) || minOrderPaise < 0 ||
      (maxDiscountPaise !== null && (!Number.isSafeInteger(maxDiscountPaise) || maxDiscountPaise < 1)) ||
      (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1))) {
    return { error: "Coupon limits must be valid whole-number paise/uses.", status: 400 };
  }
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    return { error: "Enter a valid coupon expiry date.", status: 400 };
  }
  return {
    coupon: { code, discountBasisPoints: Math.round(percent * 100), minOrderPaise, maxDiscountPaise, usageLimit, expiresAt }
  };
}

function updateCoupon(id, body) {
  if (!Number.isSafeInteger(id) || id < 1 || typeof body.active !== "boolean") {
    return { error: "Provide a valid coupon and active state.", status: 400 };
  }
  if (!repository.updateCoupon(id, body.active)) return { error: "Coupon not found.", status: 404 };
  return { result: { id, active: body.active } };
}

function updateReturn(id, body, resolvedByUserId) {
  const status = typeof body.status === "string" ? body.status : "";
  if (!Number.isSafeInteger(id) || id < 1 || !["approved", "rejected", "refunded"].includes(status)) {
    return { error: "Provide a valid return request ID and status.", status: 400 };
  }
  const currentStatus = repository.findReturnStatus(id);
  if (!currentStatus) return { error: "Return request not found.", status: 404 };
  if (status === "refunded" && currentStatus !== "approved") {
    return { error: "Approve the return before marking its external refund as completed.", status: 409 };
  }
  repository.updateReturn(id, status, resolvedByUserId);
  return { result: { id, status } };
}

function updateOrder(id, body) {
  const nextStatus = typeof body.status === "string" ? body.status : "";
  const trackingCarrier = typeof body.trackingCarrier === "string" ? body.trackingCarrier.trim() : "";
  const trackingCode = typeof body.trackingCode === "string" ? body.trackingCode.trim() : "";
  if (!Number.isSafeInteger(id) || id < 1) return { error: "Invalid order ID.", status: 400 };
  if (!["processing", "shipped", "delivered", "cancelled"].includes(nextStatus)) {
    return { error: "Choose a valid order status.", status: 400 };
  }
  if (trackingCarrier.length > 100 || trackingCode.length > 100) {
    return { error: "Tracking carrier and code must be 100 characters or fewer.", status: 400 };
  }

  const outcome = repository.transaction(() => {
    const current = repository.getOrderForAdminUpdate(id);
    if (!current) return { error: "Order not found.", status: 404 };
    if (nextStatus === "cancelled" && current.paymentStatus === "paid") {
      return { error: "Paid orders cannot be cancelled here. Process any refund in the payment provider first.", status: 409 };
    }
    if (nextStatus === "cancelled" && repository.hasShippedFulfillment(id)) {
      return { error: "An order with a shipped seller package cannot be cancelled.", status: 409 };
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
      return { error: `Order cannot move from ${current.status} to ${nextStatus}.`, status: 409 };
    }
    if (nextStatus === "cancelled") {
      for (const item of repository.getOrderItemsForRestock(id)) {
        repository.restockProduct(item.productId, item.quantity);
      }
      repository.cancelOrder(id);
    } else if (nextStatus === "delivered") {
      repository.markOrderDelivered(id, trackingCarrier, trackingCode);
    } else {
      repository.updateOrderStatus(id, nextStatus, trackingCarrier, trackingCode);
    }
    return { result: { id, status: nextStatus } };
  });
  return outcome;
}

module.exports = {
  readProduct,
  createCategory,
  updateCategory,
  updateSeller,
  updateCommission,
  createPayout,
  createCoupon,
  updateCoupon,
  updateReturn,
  updateOrder
};
