import {
  addRedirect,
  deleteRedirect,
  listRedirects,
  purgeExpiredSessions,
  listUsers,
  createUser,
  deleteUser,
  updateUserPassword,
  updateUserEmailAuth,
} from "./db";
import {
  clearSessionCookie,
  hashPassword,
  login,
  logout,
  requireAuth,
  sessionCookie,
} from "./auth";
import type { RateLimit } from "./db";
import type { D1Database } from "@cloudflare/workers-types";

export async function handleDashboard(db: D1Database, rateLimiter: RateLimit, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, ""); // strip trailing slash

  // Login page
  if (path === "/_/login" && request.method === "GET") {
    return renderLogin();
  }

  // Process login
  if (path === "/_/login" && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success: allowed } = await rateLimiter.limit({ key: ip });
    if (!allowed) {
      return renderLogin("Too many attempts. Please wait a minute and try again.");
    }

    const form = await request.formData();
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");
    const token = await login(db, username, password);
    if (!token) {
      return renderLogin("Invalid username or password.");
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/_/",
        "Set-Cookie": sessionCookie(token),
      },
    });
  }

  // Logout
  if (path === "/_/logout" && request.method === "POST") {
    await logout(db, request);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/_/login",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  }

  // All routes below require auth
  const session = await requireAuth(db, request);
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/_/login" },
    });
  }

  // Add redirect
  if (path === "/_/add" && request.method === "POST") {
    const form = await request.formData();
    const slug = String(form.get("slug") ?? "").trim().toLowerCase();
    const redirectUrl = String(form.get("url") ?? "").trim();
    const label = String(form.get("label") ?? "").trim() || null;

    if (!slug || !redirectUrl) {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Slug and URL are required.");
    }

    // Basic URL validation
    try {
      new URL(redirectUrl);
    } catch {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Invalid URL format.");
    }

    // Disallow reserved namespace
    if (slug.startsWith("_")) {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, 'Slug cannot start with "_".');
    }

    try {
      await addRedirect(db, slug, redirectUrl, label);
    } catch {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, `Slug "${slug}" already exists.`);
    }

    return new Response(null, { status: 302, headers: { Location: "/_/" } });
  }

  // Delete redirect
  if (path === "/_/delete" && request.method === "POST") {
    const form = await request.formData();
    const slug = String(form.get("slug") ?? "");
    if (slug) await deleteRedirect(db, slug);
    return new Response(null, { status: 302, headers: { Location: "/_/" } });
  }

  // Add user
  if (path === "/_/users/add" && request.method === "POST") {
    const form = await request.formData();
    const newUsername = String(form.get("username") ?? "").trim().toLowerCase();
    const newPassword = String(form.get("password") ?? "");

    if (!newUsername || !newPassword) {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Username and password are required.");
    }
    if (newPassword.length < 8) {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Password must be at least 8 characters.");
    }

    const hash = await hashPassword(newPassword);
    try {
      await createUser(db, newUsername, hash);
    } catch {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, `Username "${newUsername}" already exists.`);
    }
    return new Response(null, { status: 302, headers: { Location: "/_/" } });
  }

  // Delete user
  if (path === "/_/users/delete" && request.method === "POST") {
    const form = await request.formData();
    const targetUsername = String(form.get("username") ?? "");

    // Cannot delete yourself or the admin account
    if (targetUsername === session.username || targetUsername === "admin") {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Cannot delete this user.");
    }

    await deleteUser(db, targetUsername);
    return new Response(null, { status: 302, headers: { Location: "/_/" } });
  }

  // Update user email auth (authorized_senders + email_secret)
  if (path === "/_/users/update-auth" && request.method === "POST") {
    const form = await request.formData();
    const targetUsername = String(form.get("username") ?? "");
    const authorizedSenders = String(form.get("authorized_senders") ?? "").trim();
    const emailSecret = String(form.get("email_secret") ?? "").trim();

    if (emailSecret && emailSecret.length < 8) {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Email secret must be at least 8 characters.");
    }

    await updateUserEmailAuth(db, targetUsername, authorizedSenders, emailSecret);
    return new Response(null, { status: 302, headers: { Location: "/_/" } });
  }

  // Update user password
  if (path === "/_/users/update-password" && request.method === "POST") {
    const form = await request.formData();
    const targetUsername = String(form.get("username") ?? "");
    const newPassword = String(form.get("password") ?? "");

    if (!newPassword || newPassword.length < 8) {
      const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
      return renderDashboard(redirects, users, session.username, "Password must be at least 8 characters.");
    }

    const hash = await hashPassword(newPassword);
    await updateUserPassword(db, targetUsername, hash);
    return new Response(null, { status: 302, headers: { Location: "/_/" } });
  }

  // Dashboard index
  if (path === "/_" || path === "/_/") {
    await purgeExpiredSessions(db); // opportunistic cleanup
    const [redirects, users] = await Promise.all([listRedirects(db), listUsers(db)]);
    return renderDashboard(redirects, users, session.username);
  }

  return new Response("Not found", { status: 404 });
}

// HTML rendering

function renderLogin(error?: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="/favicon.png" type="image/png">
  <title>fwd — Login</title>
  ${styles()}
</head>
<body>
  <div class="container narrow">
    <h1 class="brand">
      <img src="/logo.svg" alt="Forward logo" class="brand-logo">
      <span>fwd</span>
    </h1>
    <p class="subtitle">URL Redirector</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="/_/login">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function renderDashboard(
  redirects: import("./db").Redirect[],
  users: Omit<import("./db").User, "password_hash">[],
  username: string,
  error?: string
): Response {
  const rows = redirects.length
    ? redirects
        .map(
          (r) => `
      <tr>
        <td><code>${escapeHtml(r.slug)}</code></td>
        <td>${r.label ? escapeHtml(r.label) : '<span class="muted">—</span>'}</td>
        <td class="url-cell"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a></td>
        <td class="muted">${r.created_at.slice(0, 10)}</td>
        <td>
          <form method="POST" action="/_/delete" onsubmit="return confirm('Delete /${escapeHtml(r.slug)}?')">
            <input type="hidden" name="slug" value="${escapeHtml(r.slug)}">
            <button type="submit" class="btn-delete" aria-label="Delete redirect ${escapeHtml(r.slug)}">Delete</button>
          </form>
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted center">No redirects yet.</td></tr>`;

  const userRows = users
    .map((u) => {
      const isProtected = u.username === "admin" || u.username === username;
      return `
    <tr>
      <td><code>${escapeHtml(u.username)}</code>${u.username === username ? ' <span class="badge">you</span>' : ""}</td>
      <td>
        <details>
          <summary class="edit-link">Edit email auth</summary>
          <form method="POST" action="/_/users/update-auth" class="inline-form">
            <input type="hidden" name="username" value="${escapeHtml(u.username)}">
            <div class="inline-field">
              <label for="authorized-senders-${escapeHtml(u.username)}">Authorized senders <span class="muted">(comma-separated emails)</span></label>
              <input id="authorized-senders-${escapeHtml(u.username)}" type="text" name="authorized_senders" value="${escapeHtml(u.authorized_senders)}" placeholder="you@example.com,colleague@example.com" aria-label="Authorized sender email addresses">
            </div>
            <div class="inline-field">
              <label for="email-secret-${escapeHtml(u.username)}">Email secret <span class="muted">(min 8 chars)</span></label>
              <input id="email-secret-${escapeHtml(u.username)}" type="text" name="email_secret" value="${escapeHtml(u.email_secret)}" placeholder="min 8 characters" aria-label="Email secret">
            </div>
            <button type="submit">Save</button>
          </form>
        </details>
      </td>
      <td>
        <details>
          <summary class="edit-link">Change password</summary>
          <form method="POST" action="/_/users/update-password" class="inline-form">
            <input type="hidden" name="username" value="${escapeHtml(u.username)}">
            <div class="inline-field">
              <label for="new-password-${escapeHtml(u.username)}">New password <span class="muted">(min 8 chars)</span></label>
              <input id="new-password-${escapeHtml(u.username)}" type="password" name="password" placeholder="new password" required minlength="8" aria-label="New password">
            </div>
            <button type="submit">Update</button>
          </form>
        </details>
      </td>
      <td>
        ${isProtected
          ? '<span class="muted">—</span>'
          : `<form method="POST" action="/_/users/delete" onsubmit="return confirm('Delete user ${escapeHtml(u.username)}?')">
              <input type="hidden" name="username" value="${escapeHtml(u.username)}">
              <button type="submit" class="btn-delete" aria-label="Delete user ${escapeHtml(u.username)}">Delete</button>
            </form>`
        }
      </td>
    </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.png" type="image/png">
  <title>fwd — Dashboard</title>
  ${styles()}
</head>
<body>
  <div class="container">
    <header>
      <h1 class="brand">
        <img src="/logo.svg" alt="Forward logo" class="brand-logo">
        <span>fwd</span>
      </h1>
      <div class="header-right">
        <span class="muted">${escapeHtml(username)}</span>
        <form method="POST" action="/_/logout" style="display:inline">
          <button type="submit" class="btn-logout">Sign out</button>
        </form>
      </div>
    </header>

    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}

    <section class="add-form">
      <h2>Add redirect</h2>
      <form method="POST" action="/_/add">
        <div class="form-row">
          <div class="field">
            <label for="slug">Slug</label>
            <input id="slug" name="slug" type="text" placeholder="survey-q1" required pattern="[a-zA-Z0-9_-]+">
          </div>
          <div class="field grow">
            <label for="url">Destination URL</label>
            <input id="url" name="url" type="url" placeholder="https://example.com" required>
          </div>
          <div class="field">
            <label for="label">Label <span class="muted">(optional)</span></label>
            <input id="label" name="label" type="text" placeholder="Q1 Survey">
          </div>
          <div class="field submit-field">
            <button type="submit" aria-label="Add redirect">Add</button>
          </div>
        </div>
      </form>
    </section>

    <section>
      <h2>Redirects <span class="count">${redirects.length}</span></h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Slug</th>
              <th scope="col">Label</th>
              <th scope="col">Destination</th>
              <th scope="col">Created</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <section class="users-section">
      <h2>Users <span class="count">${users.length}</span></h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Email auth</th>
              <th scope="col">Password</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>${userRows}</tbody>
        </table>
      </div>

      <div class="add-user-form">
        <h3>Add user</h3>
        <form method="POST" action="/_/users/add">
          <div class="form-row">
            <div class="field">
              <label for="new-username">Username</label>
              <input id="new-username" name="username" type="text" placeholder="username" required pattern="[a-zA-Z0-9_-]+">
            </div>
            <div class="field">
              <label for="new-password">Password <span class="muted">(min 8 chars)</span></label>
              <input id="new-password" name="password" type="password" placeholder="password" required minlength="8">
            </div>
            <div class="field submit-field">
              <button type="submit" aria-label="Add user">Add user</button>
            </div>
          </div>
        </form>
      </div>
    </section>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function styles(): string {
  return `<style>
    :root {
      --bg: #F1EFE9;
      --brand-main: #833ab4;
      --brand-main-hover: #6f2f9c;
      --brand-soft: rgba(131, 58, 180, 0.14);
      --text-main: #000;
      --text-muted: #000;
      --surface: #fff;
      --surface-soft: #f8f9fa;
      --border: #dee2e6;
      --border-strong: #ced4da;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 14px; background: var(--bg); color: var(--text-main); }
    a { color: #000; }
    code { font-family: monospace; background: #e9ecef; padding: 2px 5px; border-radius: 3px; font-size: 13px; }

    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    .container.narrow { max-width: 380px; padding-top: 80px; }

    h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
    h3 { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #000; }
    .subtitle { color: var(--text-muted); margin-top: 4px; margin-bottom: 28px; }
    .brand { display: inline-flex; align-items: center; gap: 10px; }
    .brand-logo { width: 34px; height: auto; display: block; }

    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .header-right { display: flex; align-items: center; gap: 12px; }

    .error { background: #f8d7da; color: #000; border: 1px solid #f5c2c7; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
    .muted { color: var(--text-muted); font-size: 13px; }
    .center { text-align: center; }
    .count { font-weight: 400; color: var(--text-muted); }
    .badge { font-size: 11px; background: #e9ecef; color: var(--text-muted); border-radius: 4px; padding: 1px 6px; vertical-align: middle; }

    label { display: block; font-size: 12px; font-weight: 500; color: #000; margin-bottom: 4px; }
    input[type="text"], input[type="url"], input[type="password"] {
      display: block; width: 100%; padding: 8px 10px; border: 1px solid var(--border-strong);
      border-radius: 6px; font-size: 14px; background: var(--surface);
    }
    input:focus { outline: none; border-color: var(--brand-main); box-shadow: 0 0 0 3px var(--brand-soft); }

    button[type="submit"] {
      padding: 8px 16px; background: var(--brand-main); color: #000; border: none;
      border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;
    }
    button[type="submit"]:hover { background: var(--brand-main-hover); }
    .btn-delete { padding: 4px 10px; background: transparent; color: #000; border: 1px solid #dc3545; border-radius: 5px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .btn-delete:hover { background: #dc3545; color: #000; }
    .btn-logout { padding: 6px 12px; background: transparent; color: #000; border: 1px solid var(--brand-main); border-radius: 5px; font-size: 13px; cursor: pointer; }
    .btn-logout:hover { background: var(--brand-soft); }

    .add-form { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 28px; }
    .form-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; min-width: 140px; }
    .field.grow { flex: 1; }
    .submit-field { justify-content: flex-end; }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 10px 14px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); background: var(--surface-soft); border-bottom: 1px solid var(--border); }
    td { padding: 10px 14px; border-bottom: 1px solid #f1f3f5; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--surface-soft); }
    .url-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .users-section { margin-top: 36px; }
    .add-user-form { margin-top: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; }

    details summary { cursor: pointer; font-size: 12px; color: #000; list-style: none; user-select: none; }
    details summary::-webkit-details-marker { display: none; }
    details summary::before { content: "+ "; }
    details[open] summary::before { content: "− "; }
    .inline-form { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--surface-soft); border-radius: 6px; border: 1px solid #e9ecef; }
    .inline-form button[type="submit"] { align-self: flex-start; padding: 6px 14px; font-size: 13px; }
    .inline-field { display: flex; flex-direction: column; gap: 4px; }
    .inline-field input { max-width: 360px; }
    ::placeholder { color: #000; opacity: 1; }

    .container.narrow form { display: flex; flex-direction: column; gap: 14px; }
    .container.narrow button[type="submit"] { margin-top: 4px; }
    .submit-field { padding-top: 22px; }
  </style>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
