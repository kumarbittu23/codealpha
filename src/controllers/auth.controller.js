const crypto = require("node:crypto");
const authService = require("../services/auth.service");

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function createAuthController(isProduction) {
  function startSession(request, response, next, user, status = 200) {
    request.session.regenerate((error) => {
      if (error) return next(error);
      request.session.user = publicUser(user);
      request.session.csrfToken = crypto.randomBytes(32).toString("hex");
      response.status(status).json({ user: request.session.user, csrfToken: request.session.csrfToken });
    });
  }

  return {
    register: async (request, response, next) => {
      try {
        const result = await authService.register(request.body);
        if (result.error) return response.status(400).json({ error: result.error });
        startSession(request, response, next, result.user, 201);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") {
          return response.status(409).json({ error: "An account with that email already exists." });
        }
        next(error);
      }
    },
    login: async (request, response, next) => {
      try {
        const user = await authService.authenticate(request.body.email, request.body.password);
        if (!user) return response.status(401).json({ error: "Email or password is incorrect." });
        startSession(request, response, next, user);
      } catch (error) {
        next(error);
      }
    },
    adminLogin: async (request, response, next) => {
      try {
        const user = await authService.authenticate(request.body.email, request.body.password);
        if (!user || user.role !== "admin") {
          return response.status(401).json({ error: "Administrator email or password is incorrect." });
        }
        startSession(request, response, next, user);
      } catch (error) {
        next(error);
      }
    },
    logout: (request, response, next) => {
      request.session.destroy((error) => {
        if (error) return next(error);
        response.clearCookie("corner.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
        response.json({ success: true });
      });
    }
  };
}

module.exports = createAuthController;
