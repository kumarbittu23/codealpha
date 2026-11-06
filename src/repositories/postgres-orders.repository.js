function createPostgresOrdersRepository(database) {
  async function query(sql, parameters = []) { return (await database.query(sql, parameters)).rows; }
  async function connect() {
    if (typeof database.connect === "function") return database.connect();
    return { query: database.query.bind(database), release() {} };
  }
  return {
    async cancelCustomerOrder(orderId, userId) {
      const client = await connect();
      try {
        await client.query("BEGIN");
        const orderResult = await client.query("SELECT id,status,payment_method AS \"paymentMethod\" FROM orders WHERE id=$1 AND user_id=$2", [orderId,userId]);
        const order = orderResult.rows[0];
        if (!order) throw new Error("ORDER_NOT_FOUND");
        if (order.status !== "placed" || order.paymentMethod !== "cash_on_delivery") throw new Error("ORDER_NOT_CANCELLABLE");
        const items = (await client.query("SELECT product_id,quantity FROM order_items WHERE order_id=$1", [orderId])).rows;
        for (const item of items) {
          await client.query("UPDATE products SET stock=stock+$1 WHERE id=$2", [item.quantity,item.product_id]);
          await client.query("INSERT INTO inventory_movements (product_id,order_id,movement_type,quantity) VALUES ($1,$2,'release',$3)", [item.product_id,orderId,item.quantity]);
        }
        await client.query("UPDATE orders SET status='cancelled',payment_status='cancelled' WHERE id=$1", [orderId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async findCustomerOrder(orderId,userId) {
      const rows=await query("SELECT id,status FROM orders WHERE id=$1 AND user_id=$2",[orderId,userId]); return rows[0]||null;
    },
    async createReturnRequest(orderId,userId,reason) {
      const rows=await query("INSERT INTO return_requests (order_id,user_id,reason) VALUES ($1,$2,$3) RETURNING id",[orderId,userId,reason]); return { lastInsertRowid:Number(rows[0].id) };
    },
    async findPaymentOrder(orderId,userId) {
      const rows=await query("SELECT id,total_paise AS \"totalPaise\",status,payment_status AS \"paymentStatus\",payment_method AS \"paymentMethod\",razorpay_order_id AS \"razorpayOrderId\" FROM orders WHERE id=$1 AND user_id=$2",[orderId,userId]); return rows[0]||null;
    },
    async recordPaymentEvent({eventId,orderId,paymentId,eventType,payload}) {
      if(!eventId)return false;
      const result=await database.query("INSERT INTO payment_events (provider,provider_event_id,provider_order_id,provider_payment_id,event_type,payload) VALUES ('razorpay',$1,$2,$3,$4,$5) ON CONFLICT(provider_event_id) DO NOTHING",[eventId,orderId||null,paymentId||null,eventType,JSON.stringify(payload)]); return result.rowCount===1;
    },
    async findOrderByProviderOrderId(providerOrderId) {
      const rows=await query("SELECT id,status,payment_status AS \"paymentStatus\",user_id AS \"userId\",total_paise AS \"totalPaise\" FROM orders WHERE razorpay_order_id=$1",[providerOrderId]); return rows[0]||null;
    },
    async markProviderPaymentCaptured(orderId,paymentId,providerOrderId) {
      const client=await connect(); try {await client.query("BEGIN"); await client.query("UPDATE orders SET status='placed',payment_status='paid',razorpay_payment_id=$1 WHERE id=$2 AND razorpay_order_id=$3 AND status='pending_payment' AND payment_status='pending'",[paymentId,orderId,providerOrderId]); await client.query("UPDATE seller_fulfillments SET status='placed',updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND status='pending_payment'",[orderId]); await client.query("COMMIT");} catch(e){await client.query("ROLLBACK");throw e;} finally{client.release();}
    },
    async markProviderPaymentFailed(orderId,providerOrderId) {
      const client=await connect(); try {await client.query("BEGIN"); const result=await client.query("UPDATE orders SET status='cancelled',payment_status='failed' WHERE id=$1 AND razorpay_order_id=$2 AND status='pending_payment' AND payment_status='pending' RETURNING id",[orderId,providerOrderId]); if(result.rowCount===1){const items=(await client.query("SELECT product_id,quantity FROM order_items WHERE order_id=$1",[orderId])).rows; for(const item of items){await client.query("UPDATE products SET stock=stock+$1 WHERE id=$2",[item.quantity,item.product_id]); await client.query("INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity) VALUES($1,$2,'release',$3)",[item.product_id,orderId,item.quantity]);} await client.query("UPDATE seller_fulfillments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND status='pending_payment'",[orderId]);} await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    },
    async findOrderByProviderPaymentId(paymentId) {
      const rows=await query("SELECT id,total_paise AS \"totalPaise\" FROM orders WHERE razorpay_payment_id=$1",[paymentId]); return rows[0]||null;
    },
    async markProviderRefund(orderId,paymentId) {
      const order=(await query("SELECT total_paise AS \"totalPaise\" FROM orders WHERE id=$1",[orderId]))[0]; if(!order)return; const refund=(await query("SELECT COALESCE(SUM(amount_paise),0)::integer AS \"amountPaise\" FROM payment_refunds WHERE order_id=$1 AND provider_payment_id=$2 AND status='processed'",[orderId,paymentId]))[0]; await query("UPDATE orders SET payment_status=$1 WHERE id=$2 AND razorpay_payment_id=$3",[refund.amountPaise>=order.totalPaise?"refunded":"partially_refunded",orderId,paymentId]);
    },
    async recordProviderRefund({refundId,paymentId,orderId,amountPaise,currency,status}) {
      if(!refundId||!paymentId||!Number.isSafeInteger(amountPaise)||amountPaise<0)return false; const result=await database.query("INSERT INTO payment_refunds(provider,provider_refund_id,provider_payment_id,order_id,amount_paise,currency,status) VALUES('razorpay',$1,$2,$3,$4,$5,$6) ON CONFLICT(provider_refund_id) DO NOTHING",[refundId,paymentId,orderId||null,amountPaise,currency||"INR",status||"processed"]); return result.rowCount===1;
    },
    async markPaymentCaptured(orderId,userId,paymentId) {
      await query("UPDATE orders SET status='placed',payment_status='paid',razorpay_payment_id=$1 WHERE id=$2 AND user_id=$3 AND status='pending_payment' AND payment_status='pending'",[paymentId,orderId,userId]); await query("UPDATE seller_fulfillments SET status='placed',updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND status='pending_payment'",[orderId]); const rows=await query("SELECT status,payment_status AS \"paymentStatus\" FROM orders WHERE id=$1",[orderId]); return rows[0];
    },
    async calculateCartQuote(quantities,couponCode="") {
      let subtotalPaise=0;
      for(const [productId,quantity] of quantities){
        const products=await query("SELECT products.price_paise,products.stock,products.name FROM products JOIN sellers ON sellers.id=products.seller_id AND sellers.status='active' JOIN categories ON categories.id=products.category_id AND categories.active=1 WHERE products.id=$1",[productId]);
        const product=products[0]; if(!product)throw new Error("A product is no longer available."); if(Number(product.stock)<quantity)throw new Error(`${product.name} does not have enough stock available.`); subtotalPaise+=Number(product.price_paise)*quantity;
      }
      let coupon=null, discountPaise=0;
      if(couponCode){
        if(!/^[A-Z0-9_-]{3,32}$/.test(couponCode))throw new Error("Coupon code is invalid.");
        const rows=await query("SELECT id,code,discount_basis_points AS \"discountBasisPoints\",min_order_paise AS \"minOrderPaise\",max_discount_paise AS \"maxDiscountPaise\",usage_limit AS \"usageLimit\",usage_count AS \"usageCount\",expires_at AS \"expiresAt\" FROM coupons WHERE code=$1 AND active=1",[couponCode]); coupon=rows[0];
        if(!coupon||(coupon.usageLimit&&coupon.usageCount>=coupon.usageLimit)||(coupon.expiresAt&&Date.parse(`${coupon.expiresAt}T23:59:59Z`)<Date.now()))throw new Error("That coupon is invalid, inactive, or expired."); if(subtotalPaise<coupon.minOrderPaise)throw new Error(`Your cart must total at least ${coupon.minOrderPaise} paise to use that coupon.`); discountPaise=Math.min(Math.floor(subtotalPaise*coupon.discountBasisPoints/10000),coupon.maxDiscountPaise||Number.MAX_SAFE_INTEGER);
      }
      return {coupon,subtotalPaise,discountPaise,totalPaise:subtotalPaise-discountPaise};
    },
    async saveOrder(input) {
      const quote=await this.calculateCartQuote(input.quantities,input.couponCode); const client=await connect();
      try {await client.query("BEGIN"); const address=[input.shippingName,input.shippingAddress].filter(Boolean).join("\n"); const status=input.paymentMethod==="razorpay"?"pending_payment":"placed"; const setting=(await client.query("SELECT commission_basis_points FROM marketplace_settings WHERE id=1")).rows[0]; let subtotal=0; const items=[]; for(const [productId,quantity] of input.quantities){const product=(await client.query("SELECT id,name,price_paise,seller_id,platform_owned FROM products WHERE id=$1 FOR UPDATE",[productId])).rows[0]; if(!product)throw new Error("A product is no longer available."); const gross=Number(product.price_paise)*quantity; subtotal+=gross; const discount=Math.floor(quote.discountPaise*gross/quote.subtotalPaise); const net=gross-discount; const commission=product.platform_owned?net:Math.floor((net*setting.commission_basis_points+5000)/10000); items.push({...product,quantity,gross,discount,commission,sellerPayoutPaise:net-commission});} const order=(await client.query("INSERT INTO orders(user_id,total_paise,shipping_name,shipping_address,status,payment_method,payment_status,razorpay_order_id,discount_paise,coupon_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",[input.userId,quote.totalPaise,input.shippingName,address,status,input.paymentMethod,input.paymentStatus,input.razorpayOrderId||null,quote.discountPaise,quote.coupon?.code||null])).rows[0]; for(const item of items){await client.query("INSERT INTO order_items(order_id,product_id,product_name,quantity,price_paise,seller_id,commission_paise,seller_payout_paise,discount_paise) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[order.id,item.id,item.name,item.quantity,item.price_paise,item.seller_id,item.commission,item.sellerPayoutPaise,item.discount]); const stockResult=await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock>= $1 RETURNING id",[item.quantity,item.id]); const stock=stockResult.rowCount ?? stockResult.rows?.length ?? 0;if(stock!==1)throw new Error(`${item.name} does not have enough stock available.`); await client.query("INSERT INTO inventory_movements(product_id,order_id,movement_type,quantity) VALUES($1,$2,'reserve',$3)",[item.id,order.id,item.quantity]);} for(const sellerId of new Set(items.map((item)=>item.seller_id))){await client.query("INSERT INTO seller_fulfillments(order_id,seller_id,status) VALUES($1,$2,$3)",[order.id,sellerId,input.paymentMethod==="razorpay"?"pending_payment":"placed"]);} if(quote.coupon){const used=await client.query("UPDATE coupons SET usage_count=usage_count+1 WHERE id=$1 AND active=1 AND (usage_limit IS NULL OR usage_count<usage_limit)",[quote.coupon.id]);if(used.rowCount!==1)throw new Error("That coupon has reached its usage limit. Please refresh your cart.");} await client.query("COMMIT"); return {id:Number(order.id),subtotalPaise:subtotal,discountPaise:quote.discountPaise,totalPaise:quote.totalPaise,couponCode:quote.coupon?.code||null}; }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    }
  };
}
module.exports=createPostgresOrdersRepository;
