const bcrypt = require("bcryptjs");
const database = require("./config/database");

async function main() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || name.length < 2 || name.length > 80) {
    throw new Error("Set ADMIN_NAME to a name between 2 and 80 characters.");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Set ADMIN_EMAIL to a valid email address.");
  }
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error("Set ADMIN_PASSWORD to a unique password between 12 and 128 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  database.prepare(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES (?, ?, ?, 'admin')
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = 'admin'
  `).run(name, email, passwordHash);
  console.log(`Administrator account ready for ${email}. Sign in at /admin.html.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => database.close());
