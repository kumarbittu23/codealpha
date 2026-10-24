const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const path = require("node:path");
const csrfProtection = require("./middleware/csrf");
const errorHandler = require("./middleware/errorHandler");
const createPagesRouter = require("./routes/pages.routes");
const createAuthRouter = require("./routes/auth.routes");
const marketplaceRoutes = require("./routes/marketplace.routes");

const app = express();
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be configured in production.");
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "https:", "data:"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "https://checkout.razorpay.com"],
      connectSrc: ["'self'", "https://api.razorpay.com"],
      frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use((request, response, next) => {
  const limit = request.method === "POST" && /^\/api\/products\/\d+\/reviews$/.test(request.path) ? "1100kb" : "20kb";
  express.json({ limit })(request, response, next);
});
app.use(session({
  name: "corner.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
const publicDirectory = path.join(__dirname, "..", "public");
app.use(createPagesRouter(publicDirectory));
app.use(express.static(publicDirectory));
app.use(createAuthRouter({ csrfProtection, isProduction }));

app.use(marketplaceRoutes);

app.use(errorHandler);

module.exports = app;
