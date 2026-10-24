const express = require("express");
const csrfProtection = require("../middleware/csrf");
const { requireUser } = require("../middleware/authenticate");
const createAccountController = require("../controllers/account.controller");

const router = express.Router();
const controller = createAccountController();

router.get("/api/orders", requireUser, controller.listOrders);
router.patch("/api/account/profile", csrfProtection, requireUser, controller.updateProfile);
router.get("/api/account/rewards", requireUser, controller.getRewards);
router.get("/api/account/addresses", requireUser, controller.listAddresses);
router.post("/api/account/addresses", csrfProtection, requireUser, controller.createAddress);
router.delete("/api/account/addresses/:id", csrfProtection, requireUser, controller.deleteAddress);
router.get("/api/wishlist", requireUser, controller.listWishlist);
router.post("/api/wishlist/:productId", csrfProtection, requireUser, controller.addWishlistItem);
router.delete("/api/wishlist/:productId", csrfProtection, requireUser, controller.removeWishlistItem);

module.exports = router;
