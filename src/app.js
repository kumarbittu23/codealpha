const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const path = require("node:path");
const database = require("./config/database");
const csrfProtection = require("./middleware/csrf");
const errorHandler = require("./middleware/errorHandler");
const SQLiteSessionStore = require("./middleware/sqliteSessionStore");
const createPagesRouter = require("./routes/pages.routes");
const createAuthRouter = require("./routes/auth.routes");
const marketplaceRoutes = require("./routes/marketplace.routes");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined ? 0 : Number(process.env.TRUST_PROXY_HOPS);

if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative whole number.");
}
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
}

app.disable("x-powered-by");
app.set("trust proxy", trustProxyHops);
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
  store: new SQLiteSessionStore(database),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.get("/health/live", (request, response) => {
  response.json({ status: "ok" });
});
app.get("/health/ready", (request, response, next) => {
  try {
    database.prepare("SELECT 1").get();
    response.json({ status: "ready" });
  } catch (error) {
    next(error);
  }
});
const publicDirectory = path.join(__dirname, "..", "public");
app.use(createPagesRouter(publicDirectory));
app.use(express.static(publicDirectory));
app.use(createAuthRouter({ csrfProtection, isProduction }));

app.use(marketplaceRoutes);

app.use(errorHandler);

module.exports = app;
