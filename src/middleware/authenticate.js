function requireUser(request, response, next) {
  if (!request.session.user) return response.status(401).json({ error: "Please sign in to continue." });
  next();
}

module.exports = { requireUser };
