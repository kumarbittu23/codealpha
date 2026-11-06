function createPostgresReviewsRepository(database) {
  async function query(sql, parameters = []) {
    return (await database.query(sql, parameters)).rows;
  }

  return {
    async listProductReviews(productId) {
      return query(`
        SELECT reviews.id, reviews.rating, reviews.body, reviews.created_at AS "createdAt",
          CASE WHEN reviews.image_data IS NULL THEN 0 ELSE 1 END AS "hasImage",
          users.name AS "reviewerName"
        FROM reviews JOIN users ON users.id = reviews.user_id
        WHERE reviews.product_id=$1 AND reviews.status='approved'
        ORDER BY reviews.id DESC LIMIT 50
      `, [productId]);
    },
    async findReviewImage(reviewId, includeHidden = false) {
      const rows = await query(`SELECT image_mime AS "imageMime", encode(image_data, 'base64') AS "imageData"
        FROM reviews WHERE id=$1 ${includeHidden ? "" : "AND status='approved'"}`, [reviewId]);
      return rows[0] || null;
    },
    async findReviewablePurchase(productId, userId) {
      const rows = await query(`
        SELECT order_items.order_id AS "orderId" FROM order_items
        JOIN orders ON orders.id=order_items.order_id
        WHERE order_items.product_id=$1 AND orders.user_id=$2 AND orders.status='delivered'
          AND NOT EXISTS (SELECT 1 FROM reviews WHERE reviews.product_id=order_items.product_id
            AND reviews.user_id=orders.user_id AND reviews.order_id=orders.id)
        ORDER BY orders.id DESC LIMIT 1
      `, [productId, userId]);
      return rows[0] || null;
    },
    async hasDeliveredPurchase(productId, userId) {
      const rows = await query(`SELECT 1 FROM order_items JOIN orders ON orders.id=order_items.order_id
        WHERE order_items.product_id=$1 AND orders.user_id=$2 AND orders.status='delivered' LIMIT 1`, [productId, userId]);
      return Boolean(rows[0]);
    },
    async createReview({ userId, productId, orderId, rating, body, imageMime, imageData }) {
      const rows = await query(`INSERT INTO reviews (user_id,product_id,order_id,rating,body,image_mime,image_data)
        VALUES ($1,$2,$3,$4,$5,$6,decode($7,'base64')) RETURNING id`,
      [userId, productId, orderId, rating, body, imageMime || null, imageData || null]);
      return { lastInsertRowid: Number(rows[0].id), changes: 1 };
    },
    async moderateReview(reviewId, status) {
      const result = await database.query("UPDATE reviews SET status=$1 WHERE id=$2", [status, reviewId]);
      return { changes: result.rowCount };
    }
  };
}

module.exports = createPostgresReviewsRepository;
