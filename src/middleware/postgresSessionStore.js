const session = require("express-session");

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function expiresAtFor(sessionData) {
  const expiresAt = sessionData.cookie?.expires
    ? new Date(sessionData.cookie.expires)
    : new Date(Date.now() + (sessionData.cookie?.maxAge ?? DEFAULT_SESSION_TTL_MS));
  if (!Number.isFinite(expiresAt.getTime())) throw new Error("Session has an invalid expiry date.");
  return expiresAt;
}

class PostgresSessionStore extends session.Store {
  constructor(pool, cleanupIntervalMs = 1000 * 60 * 60) {
    super();
    this.pool = pool;
    this.cleanupTimer = setInterval(() => {
      this.pool.query("DELETE FROM sessions WHERE expires_at <= NOW()")
        .catch((error) => console.error("Could not remove expired PostgreSQL sessions.", error));
    }, cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool.query(`
      SELECT session_data FROM sessions WHERE session_id = $1 AND expires_at > NOW()
    `, [sessionId]).then(({ rows }) => {
      callback(null, rows[0]?.session_data ?? null);
    }).catch(callback);
  }

  set(sessionId, sessionData, callback = () => {}) {
    let expiresAt;
    try {
      expiresAt = expiresAtFor(sessionData);
    } catch (error) {
      callback(error);
      return;
    }
    this.pool.query(`
      INSERT INTO sessions (session_id, expires_at, session_data) VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (session_id) DO UPDATE
      SET expires_at = EXCLUDED.expires_at, session_data = EXCLUDED.session_data
    `, [sessionId, expiresAt, JSON.stringify(sessionData)])
      .then(() => callback(null))
      .catch(callback);
  }

  touch(sessionId, sessionData, callback = () => {}) {
    let expiresAt;
    try {
      expiresAt = expiresAtFor(sessionData);
    } catch (error) {
      callback(error);
      return;
    }
    this.pool.query("UPDATE sessions SET expires_at = $1 WHERE session_id = $2", [expiresAt, sessionId])
      .then(() => callback(null))
      .catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId])
      .then(() => callback(null))
      .catch(callback);
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = PostgresSessionStore;
