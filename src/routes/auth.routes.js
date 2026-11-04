const express = require("express");
const createAuthController = require("../controllers/auth.controller");

function createAuthRouter({ csrfProtection, isProduction, authService }) {
  const router = express.Router();
  const controller = createAuthController(isProduction, authService);
  router.post("/api/auth/register", csrfProtection, controller.register);
  router.post("/api/auth/login", csrfProtection, controller.login);
  router.post("/api/admin/login", csrfProtection, controller.adminLogin);
  router.post("/api/auth/logout", csrfProtection, controller.logout);
  return router;
}

module.exports = createAuthRouter;
