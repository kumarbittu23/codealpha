const { getSellerRepository } = require("../repositories/seller-repository-store");
const sellerService = require("../services/seller.service");
const { readAdminProduct } = require("../services/marketplace.shared");

function createSellerController() {
  return {
    async apply(request, response, next) {
      try {
      const validation = sellerService.validateApplication(request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const result = await getSellerRepository().submitApplication(request.session.user.id, validation.value);
      if (result.conflictStatus) {
        return response.status(409).json({
          error: `A seller application already exists with status: ${result.conflictStatus}.`
        });
      }
      response.status(result.statusCode).json(result.seller);
      } catch (error) { next(error); }
    },
    async getOverview(request, response, next) {
      try {
      const repository = getSellerRepository();
      const seller = await repository.findSellerByUserId(request.session.user.id);
      if (!seller) return response.status(404).json({ error: "Submit a seller application to get started." });
      if (seller.status !== "active") return response.status(403).json({ error: `Your seller account is ${seller.status}.` });
      response.json(await sellerService.getSellerOverview(seller));
      } catch (error) { next(error); }
    },
    async updateFulfillment(request, response, next) {
      const validation = sellerService.validateFulfillment(request.body, request.params.id);
      if (validation.error) return response.status(400).json({ error: validation.error });
      try {
        const result = await getSellerRepository().updateFulfillment({
          ...validation.value,
          sellerId: request.seller.id
        });
        response.json(result);
      } catch (error) {
        if (error.message === "SELLER_ORDER_NOT_FOUND") {
          return response.status(404).json({ error: "Order not found in your seller account." });
        }
        if (error.message === "ORDER_CANCELLED") return response.status(409).json({ error: "Cancelled orders cannot be fulfilled." });
        if (error.message === "PAYMENT_NOT_CONFIRMED") {
          return response.status(409).json({ error: "Online payment must be confirmed before you fulfill this order." });
        }
        if (error.message.startsWith("FULFILLMENT_TRANSITION:")) {
          const [, currentStatus, attemptedStatus] = error.message.split(":");
          return response.status(409).json({ error: `Your shipment cannot move from ${currentStatus} to ${attemptedStatus}.` });
        }
        next(error);
      }
    },
    async createProduct(request, response, next) {
      try {
      const input = await readAdminProduct(request.body);
      if (input.error) return response.status(400).json({ error: input.error });
      response.status(201).json(await getSellerRepository().saveSellerProduct(request.seller.id, input.product));
      } catch (error) { next(error); }
    },
    async updateProduct(request, response, next) {
      try {
      const productId = Number(request.params.id);
      if (!Number.isSafeInteger(productId) || productId < 1) return response.status(400).json({ error: "Invalid product ID." });
      const input = await readAdminProduct(request.body, productId);
      if (input.error) return response.status(400).json({ error: input.error });
      const product = await getSellerRepository().saveSellerProduct(request.seller.id, input.product, productId);
      if (!product) return response.status(404).json({ error: "Product not found in your seller catalog." });
      response.json(product);
      } catch (error) { next(error); }
    },
    async deleteProduct(request, response, next) {
      try {
      const productId = Number(request.params.id);
      if (!Number.isSafeInteger(productId) || productId < 1) return response.status(400).json({ error: "Invalid product ID." });
      const result = await getSellerRepository().deleteSellerProduct(request.seller.id, productId);
      if (result === "not_found") return response.status(404).json({ error: "Product not found in your seller catalog." });
      if (result === "has_orders") {
        return response.status(409).json({ error: "This product is part of an order and cannot be deleted. Set its stock to zero instead." });
      }
      response.status(204).end();
      } catch (error) { next(error); }
    }
  };
}

module.exports = createSellerController;
