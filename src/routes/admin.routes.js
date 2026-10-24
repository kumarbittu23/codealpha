const express = require("express");
const csrfProtection = require("../middleware/csrf");
const { requireUser } = require("../middleware/authenticate");
const { requireAdmin } = require("../middleware/authorize");
const createAdminController = require("../controllers/admin.controller");

const router = express.Router();
const controller = createAdminController();

router.get("/api/admin/overview", requireUser, requireAdmin, controller.getOverview);
router.post("/api/admin/categories", csrfProtection, requireUser, requireAdmin, controller.createCategory);
router.patch("/api/admin/categories/:id", csrfProtection, requireUser, requireAdmin, controller.updateCategory);
router.delete("/api/admin/categories/:id", csrfProtection, requireUser, requireAdmin, controller.deleteCategory);
router.post("/api/admin/products", csrfProtection, requireUser, requireAdmin, controller.createProduct);
router.put("/api/admin/products/:id", csrfProtection, requireUser, requireAdmin, controller.updateProduct);
router.delete("/api/admin/products/:id", csrfProtection, requireUser, requireAdmin, controller.deleteProduct);
router.patch("/api/admin/sellers/:id", csrfProtection, requireUser, requireAdmin, controller.updateSeller);
router.patch("/api/admin/settings/commission", csrfProtection, requireUser, requireAdmin, controller.updateCommission);
router.post("/api/admin/sellers/:id/payouts", csrfProtection, requireUser, requireAdmin, controller.createPayout);
router.post("/api/admin/coupons", csrfProtection, requireUser, requireAdmin, controller.createCoupon);
router.get("/api/admin/coupons", requireUser, requireAdmin, controller.listCoupons);
router.patch("/api/admin/coupons/:id", csrfProtection, requireUser, requireAdmin, controller.updateCoupon);
router.patch("/api/admin/returns/:id", csrfProtection, requireUser, requireAdmin, controller.updateReturn);
router.patch("/api/admin/orders/:id", csrfProtection, requireUser, requireAdmin, controller.updateOrder);

module.exports = router;
