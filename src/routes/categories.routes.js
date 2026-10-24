const express = require("express");

function createCategoriesRouter(readCategories) {
  const router = express.Router();
  router.get("/api/categories", (request, response) => response.json(readCategories()));
  return router;
}

module.exports = createCategoriesRouter;
