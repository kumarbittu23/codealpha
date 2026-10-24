const express = require("express");
const csrfProtection = require("../middleware/csrf");
const { requireUser } = require("../middleware/authenticate");
const createOrdersController = require("../controllers/orders.controller");

const router = express.Router();
const controller = createOrdersController();

router.post("/api/orders/:id/cancel", csrfProtection, requireUser, controller.cancel);
router.post("/api/orders/:id/returns", csrfProtection, requireUser, controller.requestReturn);
router.post("/api/coupons/quote", csrfProtection, requireUser, controller.quoteCoupon);
router.post("/api/orders", csrfProtection, requireUser, controller.createCodOrder);
router.post("/api/payments/razorpay/orders", csrfProtection, requireUser, controller.createRazorpayOrder);
router.post("/api/payments/razorpay/verify", csrfProtection, requireUser, controller.verifyRazorpayPayment);

module.exports = router;
