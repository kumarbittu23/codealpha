const express = require("express");
const csrfProtection = require("../middleware/csrf");
const { requireUser } = require("../middleware/authenticate");
const { requireActiveSeller } = require("../middleware/authorize");
const createSellerController = require("../controllers/seller.controller");

const router = express.Router();
const controller = createSellerController();

router.post("/api/seller/apply", csrfProtection, requireUser, controller.apply);
router.get("/api/seller/overview", requireUser, controller.getOverview);
router.patch("/api/seller/orders/:id", csrfProtection, requireUser, requireActiveSeller, controller.updateFulfillment);
router.post("/api/seller/products", csrfProtection, requireUser, requireActiveSeller, controller.createProduct);
router.put("/api/seller/products/:id", csrfProtection, requireUser, requireActiveSeller, controller.updateProduct);
router.delete("/api/seller/products/:id", csrfProtection, requireUser, requireActiveSeller, controller.deleteProduct);

module.exports = router;
