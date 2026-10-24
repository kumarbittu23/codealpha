const crypto = require("node:crypto");

function csrfProtection(request, response, next) {
  const supplied = request.get("X-CSRF-Token");
  const expected = request.session.csrfToken;
  if (!supplied || !expected) {
    return response.status(403).json({ error: "Your session has expired. Refresh the page and try again." });
  }
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return response.status(403).json({ error: "Your session has expired. Refresh the page and try again." });
  }
  next();
}

module.exports = csrfProtection;
