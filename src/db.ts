export interface Redirect {
  slug: string;
  url: string;
  label: string | null;
  created_at: string;
}

export interface User {
  username: string;
  password_hash: string;
  created_at: string;
}

export interface Session {
  token: string;
  username: string;
  expires_at: string;
}

export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  FWD_DB: D1Database;
  LOGIN_RATE_LIMITER: RateLimit;
  PREFIXES: string; // comma-separated list, e.g. "/fwd,/win,/go". Leave empty for standalone subdomain.
}

// Redirects

export async function getRedirect(db: D1Database, slug: string): Promise<Redirect | null> {
  return db.prepare("SELECT * FROM redirects WHERE slug = ?").bind(slug).first<Redirect>();
}

export async function listRedirects(db: D1Database): Promise<Redirect[]> {
  const result = await db.prepare("SELECT * FROM redirects ORDER BY created_at DESC").all<Redirect>();
  return result.results;
}

export async function addRedirect(
  db: D1Database,
  slug: string,
  url: string,
  label: string | null
): Promise<void> {
  await db
    .prepare("INSERT INTO redirects (slug, url, label) VALUES (?, ?, ?)")
    .bind(slug, url, label)
    .run();
}

export async function deleteRedirect(db: D1Database, slug: string): Promise<void> {
  await db.prepare("DELETE FROM redirects WHERE slug = ?").bind(slug).run();
}

// Users

export async function getUser(db: D1Database, username: string): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<User>();
}

export async function createUser(
  db: D1Database,
  username: string,
  passwordHash: string
): Promise<void> {
  await db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .bind(username, passwordHash)
    .run();
}

// Sessions

export async function createSession(
  db: D1Database,
  token: string,
  username: string,
  expiresAt: string
): Promise<void> {
  await db
    .prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)")
    .bind(token, username, expiresAt)
    .run();
}

export async function getSession(db: D1Database, token: string): Promise<Session | null> {
  return db
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first<Session>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
