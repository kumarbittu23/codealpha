const sellerRepository = require("../repositories/seller.repository");
const { readCategories, flattenCategories } = require("./marketplace.shared");

function validateApplication(body) {
  const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
  const gstin = typeof body.gstin === "string" ? body.gstin.trim().toUpperCase() : "";
  if (storeName.length < 2 || storeName.length > 100) return { error: "Store name must be between 2 and 100 characters." };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: "Enter a valid 10-digit Indian mobile number." };
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { error: "Enter a valid 15-character GSTIN, or leave it blank for now." };
  }
  return { value: { storeName, phone, gstin } };
}

function validateFulfillment(body, rawOrderId) {
  const orderId = Number(rawOrderId);
  const nextStatus = typeof body.status === "string" ? body.status : "";
  const trackingCarrier = typeof body.trackingCarrier === "string" ? body.trackingCarrier.trim() : "";
  const trackingCode = typeof body.trackingCode === "string" ? body.trackingCode.trim() : "";
  if (!Number.isSafeInteger(orderId) || orderId < 1) return { error: "Invalid order ID." };
  if (!["processing", "shipped", "delivered"].includes(nextStatus)) {
    return { error: "Choose a valid fulfillment status." };
  }
  if (trackingCarrier.length > 100 || trackingCode.length > 100) {
    return { error: "Tracking carrier and code must be 100 characters or fewer." };
  }
  if (nextStatus === "shipped" && (!trackingCarrier || !trackingCode)) {
    return { error: "Enter the courier and tracking number before marking items shipped." };
  }
  return { value: { orderId, nextStatus, trackingCarrier, trackingCode } };
}

function getSellerOverview(seller) {
  const overview = sellerRepository.getOverview(seller.id);
  const categories = flattenCategories(readCategories());
  const categoryLabels = new Map(categories.map((category) => [category.id, category.pathLabel]));
  overview.products = overview.products.map((product) => ({
    ...product,
    categoryPathLabel: categoryLabels.get(product.categoryId) || product.category
  }));
  return {
    seller,
    categories: categories.filter((category) => !category.children.some((child) => child.active)),
    ...overview
  };
}

module.exports = {
  validateApplication,
  validateFulfillment,
  getSellerOverview
};
