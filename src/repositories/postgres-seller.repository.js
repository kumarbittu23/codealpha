function createPostgresSellerRepository(database) {
  async function query(sql, parameters = [], target = database) {
    return (await target.query(sql, parameters)).rows;
  }
  return {
    async findSellerByUserId(userId) {
      const rows = await query("SELECT id, store_name AS \"storeName\", phone, gstin, status FROM sellers WHERE user_id = $1", [userId]);
      return rows[0] || null;
    },
    async submitApplication(userId, application) {
      const current = await this.findSellerByUserId(userId);
      if (current?.status === "rejected") {
        await query("UPDATE sellers SET store_name=$1, phone=$2, gstin=$3, status='pending', approved_at=NULL WHERE id=$4 AND platform_owned=0 AND status='rejected'", [application.storeName, application.phone, application.gstin, current.id]);
        return { statusCode: 200, seller: { id: current.id, ...application, status: "pending" } };
      }
      if (current) return { conflictStatus: current.status };
      const rows = await query("INSERT INTO sellers (user_id, store_name, phone, gstin, status) VALUES ($1,$2,$3,$4,'pending') RETURNING id", [userId, application.storeName, application.phone, application.gstin]);
      return { statusCode: 201, seller: { id: Number(rows[0].id), ...application, status: "pending" } };
    },
    async getOverview(sellerId) {
      let products = await query("SELECT id,name,sku,category,category_id AS \"categoryId\",description,price_paise AS \"pricePaise\",image_url AS \"imageUrl\",stock,featured FROM products WHERE seller_id=$1 ORDER BY id DESC", [sellerId]);
      for (const product of products) {
        const images = await query("SELECT image_url AS \"imageUrl\", model_profile AS \"modelProfile\", view_label AS \"viewLabel\" FROM product_images WHERE product_id=$1 ORDER BY display_order,id", [product.id]);
        product.productImages = images;
        product.additionalImageUrls = images.map((image) => image.imageUrl);
      }
      const orders = await query(`SELECT orders.id,orders.total_paise AS \"totalPaise\",orders.shipping_name AS \"shippingName\",orders.shipping_address AS \"shippingAddress\",
        orders.status AS \"orderStatus\",orders.payment_method AS \"paymentMethod\",orders.payment_status AS \"paymentStatus\",seller_fulfillments.status,
        seller_fulfillments.tracking_carrier AS \"trackingCarrier\",seller_fulfillments.tracking_code AS \"trackingCode\",orders.created_at AS \"createdAt\"
        FROM seller_fulfillments JOIN orders ON orders.id=seller_fulfillments.order_id WHERE seller_fulfillments.seller_id=$1 ORDER BY orders.id DESC`, [sellerId]);
      for (const order of orders) {
        order.items = await query(`SELECT order_items.product_name AS \"productName\",order_items.quantity,order_items.price_paise AS \"pricePaise\",
          order_items.seller_payout_paise AS \"sellerPayoutPaise\",products.name AS \"currentProductName\"
          FROM order_items LEFT JOIN products ON products.id=order_items.product_id WHERE order_items.order_id=$1 AND order_items.seller_id=$2`, [order.id, sellerId]);
      }
      const paid = await query("SELECT COALESCE(SUM(seller_payout_paise),0)::integer AS \"paidPaise\" FROM order_items JOIN orders ON orders.id=order_items.order_id WHERE seller_id=$1 AND orders.payment_status='paid' AND payout_status='paid'", [sellerId]);
      const pending = await query("SELECT COALESCE(SUM(seller_payout_paise),0)::integer AS \"pendingPaise\" FROM order_items JOIN orders ON orders.id=order_items.order_id WHERE seller_id=$1 AND orders.payment_status='paid' AND orders.status!='cancelled' AND payout_status='pending'", [sellerId]);
      const settings = await query("SELECT commission_basis_points FROM marketplace_settings WHERE id=1", []);
      const payouts = await query("SELECT id,amount_paise AS \"amountPaise\",reference,notes,created_at AS \"createdAt\" FROM seller_payouts WHERE seller_id=$1 ORDER BY id DESC LIMIT 20", [sellerId]);
      return { products, orders, paidPaise: Number(paid[0].paidPaise), pendingPaise: Number(pending[0].pendingPaise), commissionBasisPoints: settings[0]?.commission_basis_points || 0, payouts };
    },
    async updateFulfillment({ orderId, sellerId, nextStatus, trackingCarrier, trackingCode }) {
      const client = database.connect ? await database.connect() : null;
      const db = client || database;
      try {
        if (client) await db.query("BEGIN");
        const current = await query("SELECT seller_fulfillments.status,orders.status AS \"orderStatus\",orders.payment_method AS \"paymentMethod\",orders.payment_status AS \"paymentStatus\" FROM seller_fulfillments JOIN orders ON orders.id=seller_fulfillments.order_id WHERE seller_fulfillments.order_id=$1 AND seller_fulfillments.seller_id=$2", [orderId, sellerId], db);
        const shipment = current[0];
        if (!shipment) throw new Error("SELLER_ORDER_NOT_FOUND");
        if (shipment.orderStatus === "cancelled") throw new Error("ORDER_CANCELLED");
        if (shipment.paymentMethod !== "cash_on_delivery" && shipment.paymentStatus !== "paid") throw new Error("PAYMENT_NOT_CONFIRMED");
        const allowed = { placed:["processing"], processing:["shipped"], shipped:["delivered"], delivered:[], pending_payment:[], cancelled:[] };
        if (!allowed[shipment.status]?.includes(nextStatus)) throw new Error(`FULFILLMENT_TRANSITION:${shipment.status}:${nextStatus}`);
        await db.query("UPDATE seller_fulfillments SET status=$1,tracking_carrier=COALESCE(NULLIF($2,''),tracking_carrier),tracking_code=COALESCE(NULLIF($3,''),tracking_code),updated_at=CURRENT_TIMESTAMP WHERE order_id=$4 AND seller_id=$5", [nextStatus,trackingCarrier,trackingCode,orderId,sellerId]);
        const shipments = (await db.query("SELECT status FROM seller_fulfillments WHERE order_id=$1", [orderId])).rows;
        const orderStatus = shipments.every((item) => item.status === "delivered") ? "delivered" : shipments.some((item) => ["shipped","delivered"].includes(item.status)) ? "shipped" : shipments.some((item) => item.status === "processing") ? "processing" : "placed";
        await db.query("UPDATE orders SET status=$1,payment_status=CASE WHEN $1='delivered' AND payment_method='cash_on_delivery' THEN 'paid' ELSE payment_status END WHERE id=$2", [orderStatus, orderId]);
        if (client) await db.query("COMMIT");
        return { orderId, status: nextStatus, orderStatus };
      } catch (error) {
        if (client) await db.query("ROLLBACK");
        throw error;
      } finally {
        if (client) client.release();
      }
    },
    async saveSellerProduct(sellerId, product, productId = null) {
      if (productId === null) {
        const rows = await query("INSERT INTO products (name,sku,category,category_id,description,price_paise,image_url,stock,featured,seller_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9) RETURNING id", [product.name,product.sku,product.category,product.categoryId,product.description,product.pricePaise,product.imageUrl,product.stock,sellerId]);
        return { id: Number(rows[0].id), ...product, featured: 0, sellerId };
      }
      const rows = await query("UPDATE products SET name=$1,sku=$2,category=$3,category_id=$4,description=$5,price_paise=$6,image_url=$7,stock=$8 WHERE id=$9 AND seller_id=$10 RETURNING id", [product.name,product.sku,product.category,product.categoryId,product.description,product.pricePaise,product.imageUrl,product.stock,productId,sellerId]);
      return rows.length ? { id: productId, ...product, featured: 0, sellerId } : null;
    },
    async deleteSellerProduct(sellerId, productId) {
      const product = await query("SELECT id FROM products WHERE id=$1 AND seller_id=$2", [productId, sellerId]);
      if (!product.length) return "not_found";
      const ordered = await query("SELECT 1 FROM order_items WHERE product_id=$1 LIMIT 1", [productId]);
      if (ordered.length) return "has_orders";
      await query("DELETE FROM products WHERE id=$1 AND seller_id=$2", [productId, sellerId]);
      return "deleted";
    }
  };
}
module.exports = createPostgresSellerRepository;
