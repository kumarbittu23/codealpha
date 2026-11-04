function createPostgresAccountRepository(database) {
  async function query(sql, parameters = []) {
    const result = await database.query(sql, parameters);
    return result.rows;
  }

  return {
    async listOrders(userId) {
      const orders = await query(`
        SELECT orders.id, orders.total_paise AS "totalPaise", orders.shipping_name AS "shippingName",
          orders.shipping_address AS "shippingAddress", orders.status, orders.payment_method AS "paymentMethod",
          orders.payment_status AS "paymentStatus", orders.tracking_carrier AS "trackingCarrier",
          orders.tracking_code AS "trackingCode", orders.created_at AS "createdAt",
          return_requests.status AS "returnStatus", return_requests.reason AS "returnReason"
        FROM orders LEFT JOIN return_requests ON return_requests.order_id = orders.id AND return_requests.user_id = orders.user_id
        WHERE orders.user_id = $1 ORDER BY orders.id DESC`, [userId]);
      for (const order of orders) {
        order.items = await query(`
          SELECT order_items.product_id AS "productId", order_items.product_name AS "productName",
            order_items.quantity, order_items.price_paise AS "pricePaise",
            products.name AS "currentProductName", products.stock AS "currentStock"
          FROM order_items LEFT JOIN products ON products.id = order_items.product_id
          WHERE order_items.order_id = $1`, [order.id]);
        order.shipments = await query(`
          SELECT sellers.store_name AS "sellerName", seller_fulfillments.status,
            seller_fulfillments.tracking_carrier AS "trackingCarrier",
            seller_fulfillments.tracking_code AS "trackingCode"
          FROM seller_fulfillments JOIN sellers ON sellers.id = seller_fulfillments.seller_id
          WHERE seller_fulfillments.order_id = $1 ORDER BY sellers.store_name COLLATE "C"`, [order.id]);
      }
      return orders;
    },
    async findPasswordHash(userId) {
      const rows = await query("SELECT password_hash AS password_hash FROM users WHERE id = $1", [userId]);
      return rows[0] || null;
    },
    async updateProfile(userId, { name, email, passwordHash }) {
      await query("UPDATE users SET name = $1, email = $2, password_hash = $3 WHERE id = $4", [name, email, passwordHash, userId]);
    },
    async getRewardTotals(userId) {
      const rows = await query(`
        SELECT COALESCE(SUM(orders.total_paise), 0)::integer AS "deliveredTotalPaise",
          COUNT(orders.id)::integer AS "deliveredOrderCount"
        FROM orders WHERE orders.user_id = $1 AND orders.status = 'delivered'
          AND NOT EXISTS (SELECT 1 FROM return_requests WHERE return_requests.order_id = orders.id AND return_requests.status = 'refunded')`, [userId]);
      return rows[0];
    },
    async listAddresses(userId) {
      return query(`SELECT id, recipient_name AS "recipientName", phone, line1, line2, city, state,
        postal_code AS "postalCode", is_default AS "isDefault"
        FROM saved_addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC`, [userId]);
    },
    async createAddress(userId, address, isDefault) {
      if (isDefault) await query("UPDATE saved_addresses SET is_default = false WHERE user_id = $1", [userId]);
      const rows = await query(`INSERT INTO saved_addresses
        (user_id, recipient_name, phone, line1, line2, city, state, postal_code, is_default)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [userId, address.recipientName, address.phone, address.line1, address.line2, address.city, address.state, address.postalCode, isDefault ? true : false]);
      return { id: Number(rows[0].id), ...address, isDefault: isDefault ? 1 : 0 };
    },
    async deleteAddress(userId, addressId) {
      const address = await query("SELECT is_default FROM saved_addresses WHERE id = $1 AND user_id = $2", [addressId, userId]);
      if (!address.length) return false;
      await query("DELETE FROM saved_addresses WHERE id = $1 AND user_id = $2", [addressId, userId]);
      if (address[0].is_default) {
        await query(`UPDATE saved_addresses SET is_default = true WHERE id = (
          SELECT id FROM saved_addresses WHERE user_id = $1 ORDER BY id DESC LIMIT 1)`, [userId]);
      }
      return true;
    },
    async listWishlist(userId) {
      return query(`SELECT products.id, products.name, products.category, products.category_id AS "categoryId",
        products.price_paise AS "pricePaise", products.image_url AS "imageUrl", products.stock,
        sellers.store_name AS "sellerName"
        FROM wishlists JOIN products ON products.id = wishlists.product_id
        JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
        JOIN categories ON categories.id = products.category_id AND categories.active = true
        WHERE wishlists.user_id = $1 ORDER BY wishlists.created_at DESC`, [userId]);
    },
    async isWishlistProductAvailable(productId) {
      const rows = await query(`SELECT products.id FROM products
        JOIN sellers ON sellers.id = products.seller_id AND sellers.status = 'active'
        JOIN categories ON categories.id = products.category_id AND categories.active = true
        WHERE products.id = $1`, [productId]);
      return rows[0] || null;
    },
    async addToWishlist(userId, productId) {
      await query("INSERT INTO wishlists (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, productId]);
    },
    async removeFromWishlist(userId, productId) {
      await query("DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2", [userId, productId]);
    }
  };
}

module.exports = createPostgresAccountRepository;
