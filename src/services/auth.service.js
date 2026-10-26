const bcrypt = require("bcryptjs");
const usersRepository = require("../repositories/users.repository");

function createAuthService(repository) {
  async function register({ name, email, password }) {
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPassword = typeof password === "string" ? password : "";

    if (normalizedName.length < 2 || normalizedName.length > 80) {
      return { error: "Enter a name between 2 and 80 characters." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      return { error: "Enter a valid email address." };
    }
    if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
      return { error: "Password must be between 8 and 128 characters." };
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 12);
    const result = await repository.createUser(normalizedName, normalizedEmail, passwordHash);
    const id = result.id ?? result.lastInsertRowid;
    return {
      user: { id: Number(id), name: normalizedName, email: normalizedEmail, role: "customer" }
    };
  }

  async function authenticate(email, password) {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPassword = typeof password === "string" ? password : "";
    const user = await repository.findUserByEmail(normalizedEmail);
    const passwordMatches = user ? await bcrypt.compare(normalizedPassword, user.password_hash) : false;
    return passwordMatches ? user : null;
  }

  return { register, authenticate };
}

const defaultAuthService = createAuthService(usersRepository);

module.exports = {
  createAuthService,
  register: (...args) => defaultAuthService.register(...args),
  authenticate: (...args) => defaultAuthService.authenticate(...args)
};
