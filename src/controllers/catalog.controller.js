const crypto = require("node:crypto");
const catalogService = require("../services/catalog.service");

function createCatalogController() {
  return {
    getSession(request, response) {
      if (!request.session.csrfToken) request.session.csrfToken = crypto.randomBytes(32).toString("hex");
      response.json({
        csrfToken: request.session.csrfToken,
        user: request.session.user || null
      });
    },
    getPaymentOptions(request, response) {
      response.json({
        currency: "INR",
        razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || null
      });
    },
    listProducts(request, response) {
      const result = catalogService.listProducts(request.query);
      if (result.categoryNotFound) return response.status(404).json({ error: "Category not found." });
      response.json(result);
    },
    getProduct(request, response) {
      const product = catalogService.getProduct(Number(request.params.id));
      if (!product) return response.status(404).json({ error: "Product not found." });
      response.json(product);
    }
  };
}

module.exports = createCatalogController;
