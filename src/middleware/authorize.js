const database = require("../config/database");

function requireAdmin(request, response, next) {
  if (request.session.user?.role !== "admin") {
    return response.status(request.session.user ? 403 : 401).json({
      error: request.session.user ? "Administrator access is required." : "Please sign in as an administrator."
    });
  }
  next();
}

function getSeller(userId) {
  return database.prepare("SELECT id, store_name AS storeName, phone, gstin, status FROM sellers WHERE user_id = ?").get(userId);
}

function requireActiveSeller(request, response, next) {
  const seller = getSeller(request.session.user.id);
  if (!seller || seller.status !== "active") {
    return response.status(403).json({
      error: seller?.status === "pending" ? "Your seller application is awaiting approval." : "An approved seller account is required."
    });
  }
  request.seller = seller;
  next();
}

module.exports = { requireAdmin, getSeller, requireActiveSeller };
