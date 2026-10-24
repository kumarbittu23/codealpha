const database = require("../config/database");

function listProductReviews(productId) {
  return database.prepare(`
    SELECT reviews.id, reviews.rating, reviews.body, reviews.created_at AS createdAt,
      CASE WHEN reviews.image_data IS NULL THEN 0 ELSE 1 END AS hasImage, users.name AS reviewerName
    FROM reviews JOIN users ON users.id = reviews.user_id
    WHERE reviews.product_id = ? AND reviews.status = 'approved'
    ORDER BY reviews.id DESC LIMIT 50
  `).all(productId);
}

function findReviewImage(reviewId, includeHidden = false) {
  return database.prepare(`
    SELECT image_mime AS imageMime, image_data AS imageData
    FROM reviews WHERE id = ? ${includeHidden ? "" : "AND status = 'approved'"}
  `).get(reviewId);
}

function findReviewablePurchase(productId, userId) {
  return database.prepare(`
    SELECT order_items.order_id AS orderId FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    WHERE order_items.product_id = ? AND orders.user_id = ? AND orders.status = 'delivered'
      AND NOT EXISTS (
        SELECT 1 FROM reviews
        WHERE reviews.product_id = order_items.product_id
          AND reviews.user_id = orders.user_id AND reviews.order_id = orders.id
      )
    ORDER BY orders.id DESC LIMIT 1
  `).get(productId, userId);
}

function hasDeliveredPurchase(productId, userId) {
  return database.prepare(`
    SELECT 1 FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE order_items.product_id = ? AND orders.user_id = ? AND orders.status = 'delivered' LIMIT 1
  `).get(productId, userId);
}

function createReview({ userId, productId, orderId, rating, body, imageMime, imageData }) {
  return database.prepare(`
    INSERT INTO reviews (user_id, product_id, order_id, rating, body, image_mime, image_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, productId, orderId, rating, body, imageMime, imageData);
}

function moderateReview(reviewId, status) {
  return database.prepare("UPDATE reviews SET status = ? WHERE id = ?").run(status, reviewId);
}

module.exports = {
  listProductReviews,
  findReviewImage,
  findReviewablePurchase,
  hasDeliveredPurchase,
  createReview,
  moderateReview
};
