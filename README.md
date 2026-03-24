# fwd

A minimal URL redirector that runs on Cloudflare Workers + D1. Map short slugs to any URL — internal or external — and manage them through a lightweight dashboard.

```
yourdomain.com/survey-q1  →  https://forms.google.com/very-long-url
yourdomain.com/docs       →  https://notion.so/your-workspace/...
```

---

## Features

- **Slug → URL redirects** (302) backed by Cloudflare D1 (SQLite)
- **Password-protected dashboard** — list, add, and delete redirects
- **Session auth** with PBKDF2-hashed passwords (no external deps)
- **Single Worker** — no build step, no frontend framework
- **Two deployment modes**: standalone subdomain or behind a reverse proxy

---

## What you're setting up

`fwd` has two parts that live inside your Cloudflare account:

1. **A Worker** — the code that handles redirects and the dashboard. Think of it as a tiny server.
2. **A D1 database** — a SQLite database that stores your slugs and URLs. Think of it as a spreadsheet Cloudflare hosts for you.

You'll create both of these in the steps below.

---

## Prerequisites

Before starting, make sure you have:

- [Node.js](https://nodejs.org/) v18+ — check with `node -v`
- [Yarn](https://yarnpkg.com/) — install with `npm install -g yarn`
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) — free tier is fine

---

## Setup (step by step)

### Step 1 — Get the code

```bash
git clone https://github.com/your-username/fwd.git
cd fwd
yarn install
```

> `yarn install` downloads all the dependencies the project needs. You only run this once.

---

### Step 2 — Log in to Cloudflare

This connects your terminal to your Cloudflare account. It will open a browser window asking you to approve access.

```bash
yarn wrangler login
```

To confirm it worked:

```bash
yarn wrangler whoami
```

You should see your Cloudflare account name and email.

---

### Step 3 — Create the database in Cloudflare

This creates a real D1 database inside your Cloudflare account. It doesn't contain any tables yet — just an empty database.

```bash
yarn wrangler d1 create fwd
```

The output will include a block like this:

```
[[d1_databases]]
binding = "FWD_DB"
database_name = "fwd"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` value.** You'll need it in the next step.

---

### Step 4 — Connect the code to the database

Open `wrangler.toml` in a text editor and replace the placeholder with your database ID:

```toml
[[d1_databases]]
binding = "FWD_DB"
database_name = "fwd"
database_id = "paste-your-id-here"   # ← replace this
```

Save the file. The code now knows which database to talk to.

---

### Step 5 — Create the tables

This runs a migration that creates the `redirects`, `users`, and `sessions` tables inside your Cloudflare database.

```bash
yarn db:migrate
```

Type `y` when prompted. You should see:

```
┌───────────────┬────────┐
│ name          │ status │
├───────────────┼────────┤
│ 0001_init.sql │ ✅     │
└───────────────┴────────┘
```

> **Gotcha (wrangler v4):** If the output says "Executing on local database" instead of mentioning your database ID, the migration ran locally by mistake. Make sure you're running `yarn db:migrate` (not `yarn db:migrate:local`).

---

### Step 6 — Deploy the Worker

This publishes your code to Cloudflare. After this, your redirector is live on the internet.

```bash
yarn deploy
```

At the end of the output you'll see a URL like:

```
https://fwd.<your-subdomain>.workers.dev
```

That's your live redirector.

---

### Step 7 — Create your admin user

This creates the username and password you'll use to log into the dashboard.

> **Important:** the `--silent` flag is required. Without it, yarn prints extra text that breaks the command.

```bash
yarn wrangler d1 execute fwd --remote --command "$(yarn --silent tsx scripts/create-user.ts admin yourpassword)"
```

Replace `admin` and `yourpassword` with your own credentials. You can run this multiple times to add more users.

---

### Step 8 — Open the dashboard

Visit:

```
https://fwd.<your-subdomain>.workers.dev/_/
```

Sign in with the credentials from Step 7. Add a redirect, then test it by visiting:

```
https://fwd.<your-subdomain>.workers.dev/your-slug
```

You should be bounced to the destination URL.

---

## Deployment modes

### Standalone subdomain

Point a subdomain (e.g. `go.yourdomain.com`) at the Worker via a Cloudflare Worker route. No extra configuration needed — just set the route in the Cloudflare dashboard.

```
go.yourdomain.com/survey-q1  →  Worker  →  302 redirect
go.yourdomain.com/_/          →  Worker  →  dashboard
```

### Behind a reverse proxy (namespace routing)

If you have an existing Cloudflare Worker acting as a reverse proxy, reserve a namespace (e.g. `/fwd/*`) and forward those requests to the `fwd` Worker:

```ts
// In your router Worker
if (url.pathname.startsWith("/fwd/")) {
  const forwardUrl = new URL(request.url);
  forwardUrl.pathname = url.pathname.replace("/fwd", "");
  return fetch(new Request(forwardUrl, request));
}
```

---

## Dashboard reference

| Action | Path |
|--------|------|
| Login | `/_/login` |
| Dashboard | `/_/` |
| Add redirect | POST `/_/add` |
| Delete redirect | POST `/_/delete` |
| Logout | POST `/_/logout` |

Slugs must be alphanumeric (hyphens and underscores allowed). They cannot start with `_` (reserved for the dashboard).

---

## Day-to-day commands

| Command | What it does |
|---------|-------------|
| `yarn dev` | Start local dev server at http://localhost:8787 |
| `yarn deploy` | Deploy to Cloudflare |
| `yarn db:migrate` | Apply DB migrations to production (Cloudflare) |
| `yarn db:migrate:local` | Apply DB migrations locally |

---

## Schema

```sql
redirects (slug TEXT PK, url TEXT, label TEXT, created_at TEXT)
users     (username TEXT PK, password_hash TEXT, created_at TEXT)
sessions  (token TEXT PK, username TEXT, expires_at TEXT)
```

Sessions expire after 24 hours and are pruned on each dashboard load.

---

## License

MIT
