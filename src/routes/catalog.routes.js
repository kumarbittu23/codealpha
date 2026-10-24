const express = require("express");
const createCategoriesRouter = require("./categories.routes");
const { readCategories } = require("../services/marketplace.shared");
const createCatalogController = require("../controllers/catalog.controller");

const router = express.Router();
const controller = createCatalogController();

router.use(createCategoriesRouter(readCategories));
router.get("/api/session", controller.getSession);
router.get("/api/payment-options", controller.getPaymentOptions);
router.get("/api/products", controller.listProducts);
router.get("/api/products/:id", controller.getProduct);

module.exports = router;
