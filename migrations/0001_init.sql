-- fwd: URL redirector schema

CREATE TABLE redirects (
  slug       TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);
