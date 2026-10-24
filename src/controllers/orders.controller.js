const crypto = require("node:crypto");
const ordersService = require("../services/orders.service");

function createOrdersController() {
  return {
    cancel(request, response, next) {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid order ID." });
      try {
        ordersService.cancelCustomerOrder(id, request.session.user.id);
        response.json({ id, status: "cancelled" });
      } catch (error) {
        if (error.message === "ORDER_NOT_FOUND") return response.status(404).json({ error: "Order not found." });
        if (error.message === "ORDER_NOT_CANCELLABLE") {
          return response.status(409).json({
            error: "Only a COD order that has not started processing can be cancelled here. Contact the store for help."
          });
        }
        next(error);
      }
    },
    requestReturn(request, response, next) {
      const validation = ordersService.validateReturnRequest(request.params.id, request.body.reason);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const { id, reason } = validation.value;
      const order = ordersService.findCustomerOrder(id, request.session.user.id);
      if (!order) return response.status(404).json({ error: "Order not found." });
      if (order.status !== "delivered") return response.status(409).json({ error: "A return can be requested after the order is delivered." });
      try {
        const result = ordersService.createReturnRequest(id, request.session.user.id, reason);
        response.status(201).json({ id: Number(result.lastInsertRowid), orderId: id, status: "pending" });
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          return response.status(409).json({ error: "A return request already exists for this order." });
        }
        next(error);
      }
    },
    quoteCoupon(request, response, next) {
      const validation = ordersService.validateCouponQuote(request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const { code, quantities } = validation.value;
      try {
        const quote = ordersService.calculateCartQuote(quantities, code);
        response.json({
          code: quote.coupon.code,
          subtotalPaise: quote.subtotalPaise,
          discountPaise: quote.discountPaise,
          totalPaise: quote.totalPaise
        });
      } catch (error) {
        if (error.message.includes("not have enough stock") || error.message.includes("no longer available")) {
          return response.status(409).json({ error: error.message });
        }
        if (error.message.startsWith("Coupon code") || error.message.startsWith("That coupon") || error.message.startsWith("Your cart must total")) {
          return response.status(400).json({ error: error.message });
        }
        next(error);
      }
    },
    createCodOrder(request, response, next) {
      const input = ordersService.validateOrderInput(request.body);
      if (input.error) return response.status(400).json({ error: input.error });
      try {
        const order = ordersService.saveOrder({
          userId: request.session.user.id,
          ...input,
          paymentMethod: "cash_on_delivery",
          paymentStatus: "pending"
        });
        response.status(201).json(order);
      } catch (error) {
        if (ordersService.handleOrderError(error, response)) return;
        next(error);
      }
    },
    async createRazorpayOrder(request, response, next) {
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return response.status(503).json({ error: "Online payments are not configured yet. Please choose cash on delivery." });
      }
      const input = ordersService.validateOrderInput(request.body);
      if (input.error) return response.status(400).json({ error: input.error });
      try {
        const estimated = ordersService.calculateCartQuote(input.quantities, input.couponCode).totalPaise;
        if (!Number.isSafeInteger(estimated) || estimated < 100) {
          return response.status(400).json({ error: "Razorpay online orders must total at least ₹1." });
        }
        const gatewayOrder = await ordersService.callRazorpayApi("/orders", {
          method: "POST",
          body: JSON.stringify({
            amount: estimated,
            currency: "INR",
            receipt: `corner-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
          })
        });
        if (gatewayOrder.currency !== "INR" || gatewayOrder.amount !== estimated || !gatewayOrder.id) {
          throw new Error("Online payment provider returned an invalid order.");
        }
        const order = ordersService.saveOrder({
          userId: request.session.user.id,
          ...input,
          paymentMethod: "razorpay",
          paymentStatus: "pending",
          razorpayOrderId: gatewayOrder.id,
          expectedTotalPaise: estimated
        });
        response.status(201).json({
          ...order,
          currency: "INR",
          razorpayOrderId: gatewayOrder.id,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID
        });
      } catch (error) {
        if (ordersService.handleOrderError(error, response)) return;
        if (error.message.startsWith("Online payment service") || error.message === "Online payment provider returned an invalid order.") {
          return response.status(502).json({ error: error.message });
        }
        next(error);
      }
    },
    async verifyRazorpayPayment(request, response, next) {
      const validation = ordersService.validatePaymentDetails(request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const { localOrderId, razorpayOrderId, razorpayPaymentId, suppliedSignature } = validation.value;
      if (!ordersService.verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, suppliedSignature })) {
        return response.status(400).json({ error: "Payment could not be verified. If money was deducted, contact the store before trying again." });
      }
      try {
        const order = ordersService.findPaymentOrder(localOrderId, request.session.user.id);
        if (!order || order.paymentMethod !== "razorpay" || order.razorpayOrderId !== razorpayOrderId) {
          return response.status(404).json({ error: "Payment order not found." });
        }
        if (order.paymentStatus === "paid") {
          return response.json({ id: order.id, totalPaise: order.totalPaise, paymentStatus: "paid" });
        }
        if (order.status !== "pending_payment" || order.paymentStatus !== "pending") {
          return response.status(409).json({ error: "This order is no longer awaiting payment. Contact the store if payment was deducted." });
        }
        const payment = await ordersService.callRazorpayApi(`/payments/${encodeURIComponent(razorpayPaymentId)}`);
        if (payment.order_id !== razorpayOrderId || payment.amount !== order.totalPaise ||
            payment.currency !== "INR" || payment.status !== "captured") {
          return response.status(409).json({ error: "Payment is not captured yet. Please wait a moment and try again." });
        }
        const updated = ordersService.markPaymentCaptured(order.id, request.session.user.id, razorpayPaymentId);
        if (updated.paymentStatus !== "paid") {
          return response.status(409).json({ error: "Payment is being reconciled. Please check your orders in a moment." });
        }
        response.json({ id: order.id, totalPaise: order.totalPaise, paymentStatus: updated.paymentStatus });
      } catch (error) {
        if (error.message.startsWith("Online payment service")) return response.status(502).json({ error: error.message });
        next(error);
      }
    }
  };
}

module.exports = createOrdersController;
