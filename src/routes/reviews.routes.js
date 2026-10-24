const express = require("express");
const csrfProtection = require("../middleware/csrf");
const { requireUser } = require("../middleware/authenticate");
const { requireAdmin } = require("../middleware/authorize");
const createReviewsController = require("../controllers/reviews.controller");

const router = express.Router();
const controller = createReviewsController();

router.get("/api/products/:id/reviews", controller.listForProduct);
router.get("/api/reviews/:id/image", controller.getPublicImage);
router.get("/api/admin/reviews/:id/image", requireUser, requireAdmin, controller.getAdminImage);
router.post("/api/products/:id/reviews", csrfProtection, requireUser, controller.create);
router.patch("/api/admin/reviews/:id", csrfProtection, requireUser, requireAdmin, controller.moderate);

module.exports = router;
