import {
  addRedirect,
  deleteRedirect,
  listRedirects,
  purgeExpiredSessions,
} from "./db";
import {
  clearSessionCookie,
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
      const redirects = await listRedirects(db);
      return renderDashboard(redirects, session.username, "Slug and URL are required.");
    }

    // Basic URL validation
    try {
      new URL(redirectUrl);
    } catch {
      const redirects = await listRedirects(db);
      return renderDashboard(redirects, session.username, "Invalid URL format.");
    }

    // Disallow reserved namespace
    if (slug.startsWith("_")) {
      const redirects = await listRedirects(db);
      return renderDashboard(redirects, session.username, 'Slug cannot start with "_".');
    }

    try {
      await addRedirect(db, slug, redirectUrl, label);
    } catch {
      const redirects = await listRedirects(db);
      return renderDashboard(redirects, session.username, `Slug "${slug}" already exists.`);
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

  // Dashboard index
  if (path === "/_" || path === "/_/") {
    await purgeExpiredSessions(db); // opportunistic cleanup
    const redirects = await listRedirects(db);
    return renderDashboard(redirects, session.username);
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
  <title>fwd — Login</title>
  ${styles()}
</head>
<body>
  <div class="container narrow">
    <h1>fwd</h1>
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
            <button type="submit" class="btn-delete">Delete</button>
          </form>
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted center">No redirects yet.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fwd — Dashboard</title>
  ${styles()}
</head>
<body>
  <div class="container">
    <header>
      <h1>fwd</h1>
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
            <label>&nbsp;</label>
            <button type="submit">Add</button>
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
              <th>Slug</th>
              <th>Label</th>
              <th>Destination</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function styles(): string {
  return `<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 14px; background: #f8f9fa; color: #212529; }
    a { color: #0d6efd; }
    code { font-family: monospace; background: #e9ecef; padding: 2px 5px; border-radius: 3px; font-size: 13px; }

    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    .container.narrow { max-width: 380px; padding-top: 80px; }

    h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
    .subtitle { color: #6c757d; margin-top: 4px; margin-bottom: 28px; }

    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .header-right { display: flex; align-items: center; gap: 12px; }

    .error { background: #f8d7da; color: #842029; border: 1px solid #f5c2c7; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
    .muted { color: #6c757d; font-size: 13px; }
    .center { text-align: center; }
    .count { font-weight: 400; color: #6c757d; }

    label { display: block; font-size: 12px; font-weight: 500; color: #495057; margin-bottom: 4px; }
    input[type="text"], input[type="url"], input[type="password"] {
      display: block; width: 100%; padding: 8px 10px; border: 1px solid #ced4da;
      border-radius: 6px; font-size: 14px; background: #fff;
    }
    input:focus { outline: none; border-color: #86b7fe; box-shadow: 0 0 0 3px rgba(13,110,253,.15); }

    button[type="submit"] {
      padding: 8px 16px; background: #0d6efd; color: #fff; border: none;
      border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;
    }
    button[type="submit"]:hover { background: #0b5ed7; }
    .btn-delete { padding: 4px 10px; background: transparent; color: #dc3545; border: 1px solid #dc3545; border-radius: 5px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .btn-delete:hover { background: #dc3545; color: #fff; }
    .btn-logout { padding: 6px 12px; background: transparent; color: #6c757d; border: 1px solid #dee2e6; border-radius: 5px; font-size: 13px; cursor: pointer; }
    .btn-logout:hover { background: #e9ecef; }

    .add-form { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin-bottom: 28px; }
    .form-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; min-width: 140px; }
    .field.grow { flex: 1; }
    .submit-field { justify-content: flex-end; }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 10px 14px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; background: #f8f9fa; border-bottom: 1px solid #dee2e6; }
    td { padding: 10px 14px; border-bottom: 1px solid #f1f3f5; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8f9fa; }
    .url-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .container.narrow form { display: flex; flex-direction: column; gap: 14px; }
    .container.narrow button[type="submit"] { margin-top: 4px; }
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
