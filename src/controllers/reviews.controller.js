const { getReviewsRepository } = require("../repositories/reviews-repository-store");
const reviewsRepository = getReviewsRepository();
const reviewsService = require("../services/reviews.service");

function sendReviewImage(response, review, cacheControl) {
  if (!review?.imageData || !["image/jpeg", "image/png", "image/webp"].includes(review.imageMime)) {
    return response.status(404).end();
  }
  response.set("Content-Type", review.imageMime);
  response.set("X-Content-Type-Options", "nosniff");
  response.set("Cache-Control", cacheControl);
  response.send(Buffer.from(review.imageData, "base64"));
}

function createReviewsController() {
  return {
    async listForProduct(request, response, next) {
      try { response.json(await reviewsRepository.listProductReviews(Number(request.params.id))); }
      catch (error) { next(error); }
    },
    async getPublicImage(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(404).end();
      try { sendReviewImage(response, await reviewsRepository.findReviewImage(id), "public, max-age=300"); }
      catch (error) { next(error); }
    },
    async getAdminImage(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(404).end();
      try { sendReviewImage(response, await reviewsRepository.findReviewImage(id, true), "private, no-store"); }
      catch (error) { next(error); }
    },
    async create(request, response, next) {
      const productId = Number(request.params.id);
      const validation = reviewsService.validateReview(request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const purchase = await reviewsRepository.findReviewablePurchase(productId, request.session.user.id);
      if (!purchase) {
        if (await reviewsRepository.hasDeliveredPurchase(productId, request.session.user.id)) {
          return response.status(409).json({ error: "You have already reviewed this product for each delivered order." });
        }
        return response.status(403).json({ error: "Reviews are available after this product has been delivered to you." });
      }
      try {
        const { rating, body, imageMime, imageData } = validation.value;
        const result = await reviewsRepository.createReview({
          userId: request.session.user.id,
          productId,
          orderId: purchase.orderId,
          rating,
          body,
          imageMime,
          imageData
        });
        response.status(201).json({ id: Number(result.lastInsertRowid), rating, body, hasImage: Boolean(imageData) });
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") {
          return response.status(409).json({ error: "You have already reviewed this product for that order." });
        }
        next(error);
      }
    },
    async moderate(request, response, next) {
      const validation = reviewsService.validateModeration(request.params.id, request.body.status);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const { id, status } = validation.value;
      try {
        const result = await reviewsRepository.moderateReview(id, status);
        if (!result.changes) return response.status(404).json({ error: "Review not found." });
        response.json({ id, status });
      } catch (error) { next(error); }
    }
  };
}

module.exports = createReviewsController;
