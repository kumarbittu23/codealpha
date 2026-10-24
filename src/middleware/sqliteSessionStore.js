const session = require("express-session");

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

class SQLiteSessionStore extends session.Store {
  constructor(database, cleanupIntervalMs = 1000 * 60 * 60) {
    super();
    this.database = database;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);
    this.cleanupTimer = setInterval(() => {
      try {
        this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
      } catch (error) {
        console.error("Could not remove expired sessions.", error);
      }
    }, cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    try {
      const row = this.database.prepare(`
        SELECT data FROM sessions WHERE session_id = ? AND expires_at > ?
      `).get(sessionId, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sessionId, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + (sessionData.cookie?.maxAge ?? DEFAULT_SESSION_TTL_MS);
      this.database.prepare(`
        INSERT INTO sessions (session_id, expires_at, data) VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data
      `).run(sessionId, expiresAt, JSON.stringify(sessionData));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sessionId, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + (sessionData.cookie?.maxAge ?? DEFAULT_SESSION_TTL_MS);
      this.database.prepare("UPDATE sessions SET expires_at = ? WHERE session_id = ?").run(expiresAt, sessionId);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sessionId, callback = () => {}) {
    try {
      this.database.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = SQLiteSessionStore;
