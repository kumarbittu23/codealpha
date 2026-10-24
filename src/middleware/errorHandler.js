function errorHandler(error, request, response, next) {
  console.error(error);
  if (response.headersSent) return next(error);
  if (error.type === "entity.too.large") {
    return response.status(413).json({ error: "Request is too large. Review photos must be smaller than 700 KB." });
  }
  response.status(500).json({ error: "Something went wrong. Please try again." });
}

module.exports = errorHandler;
