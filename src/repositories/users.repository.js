const database = require("../config/database");

function createUser(name, email, passwordHash) {
  return database.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(name, email, passwordHash);
}

function findUserByEmail(email) {
  return database.prepare("SELECT id, name, email, password_hash, role FROM users WHERE email = ?").get(email);
}

module.exports = { createUser, findUserByEmail };
