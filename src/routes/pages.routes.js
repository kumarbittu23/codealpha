const express = require("express");
const path = require("node:path");

function createPagesRouter(publicDirectory) {
  const router = express.Router();
  const pages = {
    "/": ["customer", "index.html"],
    "/index.html": ["customer", "index.html"],
    "/account.html": ["customer", "account.html"],
    "/cart.html": ["customer", "cart.html"],
    "/product.html": ["customer", "product.html"],
    "/seller.html": ["seller", "index.html"],
    "/admin.html": ["admin", "index.html"],
    "/styles.css": ["css", "styles.css"]
  };

  for (const [url, segments] of Object.entries(pages)) {
    router.get(url, (request, response) => response.sendFile(path.join(publicDirectory, ...segments)));
  }
  for (const script of ["common", "shop", "product", "cart", "account", "seller", "admin"]) {
    router.get(`/${script}.js`, (request, response) =>
      response.sendFile(path.join(publicDirectory, "js", `${script}.js`))
    );
  }
  router.get("/category/*", (request, response) =>
    response.sendFile(path.join(publicDirectory, "customer", "category.html"))
  );

  return router;
}

module.exports = createPagesRouter;
