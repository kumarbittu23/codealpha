const reviewsRepository = require("../repositories/reviews.repository");
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
    listForProduct(request, response) {
      response.json(reviewsRepository.listProductReviews(Number(request.params.id)));
    },
    getPublicImage(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(404).end();
      sendReviewImage(response, reviewsRepository.findReviewImage(id), "public, max-age=300");
    },
    getAdminImage(request, response) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(404).end();
      sendReviewImage(response, reviewsRepository.findReviewImage(id, true), "private, no-store");
    },
    create(request, response, next) {
      const productId = Number(request.params.id);
      const validation = reviewsService.validateReview(request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const purchase = reviewsRepository.findReviewablePurchase(productId, request.session.user.id);
      if (!purchase) {
        if (reviewsRepository.hasDeliveredPurchase(productId, request.session.user.id)) {
          return response.status(409).json({ error: "You have already reviewed this product for each delivered order." });
        }
        return response.status(403).json({ error: "Reviews are available after this product has been delivered to you." });
      }
      try {
        const { rating, body, imageMime, imageData } = validation.value;
        const result = reviewsRepository.createReview({
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
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          return response.status(409).json({ error: "You have already reviewed this product for that order." });
        }
        next(error);
      }
    },
    moderate(request, response) {
      const validation = reviewsService.validateModeration(request.params.id, request.body.status);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const { id, status } = validation.value;
      const result = reviewsRepository.moderateReview(id, status);
      if (!result.changes) return response.status(404).json({ error: "Review not found." });
      response.json({ id, status });
    }
  };
}

module.exports = createReviewsController;
