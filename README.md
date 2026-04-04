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

If you have an existing Cloudflare Worker acting as a reverse proxy, reserve one or more path namespaces and forward the full request — **without stripping the prefix**. `fwd` handles that itself. We've <a href="https://github.com/qvgdlaem/cf-reverse-proxy">open-sourced a Cloudflare worker reverse proxy</a>

The router's only job is forwarding. `fwd` is responsible for understanding which namespaces it owns.

In your router Worker:
```ts
if (url.pathname.startsWith("/fwd/") || url.pathname.startsWith("/go/")) {
  return env.FWD.fetch(request); // full path forwarded as-is
}
```

In `fwd`'s `wrangler.toml`, list all namespaces the router sends to it:
```toml
[vars]
PREFIXES = "/fwd,/go"
```

`fwd` matches the incoming path against each prefix, strips the matching one, and resolves the slug. The dashboard is available at `/<any-prefix>/_/`.

#### Why multiple namespaces?

A single `fwd` instance can serve URLs with different semantic meanings — same slug → URL lookup under the hood, but the namespace communicates intent to the person clicking. For example:

- `/go/partner-page` — general-purpose short link (`/go` reads as "go to")
- `/win/spring-contest` — campaign-specific namespace (`/win` signals a contest or giveaway)

Both resolve through the same worker and dashboard. The namespace is purely cosmetic.

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

## Optional: add redirects by email

If your domain uses Cloudflare Email Routing, you can add new redirects by sending an email — no dashboard needed.

### How it works

Send an email from a whitelisted address to any address you've routed to the fwd Worker:

```
To: add@yourdomain.com
From: you@youremail.com

slug=spring-contest
url=https://yoursite.com/landing-page
secret=yourcodeword
```

Fields can appear in any order. The secret codeword can appear anywhere in the body. If the sender is not whitelisted or the codeword is missing, the email is silently ignored.

### Setup

> **Important:** deploying the fwd Worker does *not* automatically enable email. You must create the routing rule in the Cloudflare dashboard separately. The Worker will silently ignore all email until both the routing rule and per-user config are in place.

**1. Enable Cloudflare Email Routing** on your domain (or a subdomain — see note below).

**2. Create a routing rule** in the Cloudflare dashboard:
- Go to your domain → **Email → Email Routing → Routing rules**
- Add a rule: email address of your choice (e.g. `go@yourdomain.com`) → Action: **Send to Worker** → select your `fwd` Worker

**3. Configure per-user email auth in the fwd dashboard:**
- Log in at `/_/`
- Under **Users**, expand **Edit email auth** for your user
- Set **Authorized senders**: comma-separated list of email addresses allowed to create redirects
- Set **Email secret**: a codeword (min 8 chars) that must appear in the email body

No redeploy needed — these settings are stored in D1 and take effect immediately.

### Note: using a subdomain if your domain MX points elsewhere

If your domain's MX records point to Google Workspace, Outlook, etc., you can still use this feature by setting up Email Routing on a **subdomain** (e.g. `fwd.yourdomain.com`). Subdomain MX records are independent from your root domain's mail setup.

The email address would then be something like `add@fwd.yourdomain.com`.

### Semantic tip

Since fwd supports multiple namespaces (`/go`, `/win`, etc.), you can match your email address to your namespace for a coherent feel:

- `go@yourdomain.com` → adds a general-purpose redirect
- `win@yourdomain.com` → adds a contest/campaign redirect

Both write to the same fwd instance. The email address is purely cosmetic.

---

## Security

### Rate limiting

`fwd` uses Cloudflare's [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) to block brute-force attacks on the login endpoint. This is configured in `wrangler.toml` and enforced in code — no Cloudflare dashboard setup needed.

The default limit is **5 login attempts per minute per IP**. To change it, edit `wrangler.toml`:

```toml
[[unsafe.bindings]]
type = "ratelimit"
name = "LOGIN_RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 5, period = 60 }  # ← adjust limit and period (seconds)
```

### Password hashing

Passwords are hashed with PBKDF2 (100,000 iterations, SHA-256) using the Web Crypto API. No external dependencies.

### Sessions

Sessions are stored in D1, expire after 24 hours, and use HttpOnly + Secure + SameSite=Lax cookies.

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
