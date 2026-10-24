const express = require("express");
const router = express.Router();
router.use(require("./catalog.routes"));
router.use(require("./account.routes"));
router.use(require("./seller.routes"));
router.use(require("./orders.routes"));
router.use(require("./reviews.routes"));
router.use(require("./admin.routes"));

module.exports = router;
