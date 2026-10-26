function safeUserId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("PostgreSQL user ID is outside the application's supported integer range.");
  }
  return id;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: safeUserId(row.id),
    name: row.name,
    email: row.email,
    password_hash: row.password_hash,
    role: row.role
  };
}

function createPostgresUsersRepository(pool) {
  return {
    async createUser(name, email, passwordHash) {
      const result = await pool.query(`
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [name, email, passwordHash]);
      return { id: safeUserId(result.rows[0].id) };
    },

    async findUserByEmail(email) {
      const result = await pool.query(`
        SELECT id, name, email, password_hash, role
        FROM users
        WHERE lower(email) = lower($1)
      `, [email]);
      return mapUser(result.rows[0]);
    },

    async findPasswordHash(userId) {
      const result = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [safeUserId(userId)]
      );
      return result.rows[0] || null;
    },

    async updateProfile(userId, { name, email, passwordHash }) {
      const result = await pool.query(`
        UPDATE users SET name = $1, email = $2, password_hash = $3
        WHERE id = $4
        RETURNING id
      `, [name, email, passwordHash, safeUserId(userId)]);
      return result.rowCount > 0;
    }
  };
}

module.exports = createPostgresUsersRepository;
