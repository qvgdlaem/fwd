import { handleDashboard } from "./dashboard";
import { handleRedirect } from "./redirect";
import { handleEmail } from "./email";
import type { Env } from "./db";

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Strip routing prefix if configured.
    // PREFIXES is a comma-separated list, e.g. "/fwd,/win,/go".
    // Leave empty for standalone subdomain deployments.
    const prefixes = (env.PREFIXES ?? "").split(",").map(p => p.trim().replace(/\/+$/, "")).filter(Boolean);
    const matchedPrefix = prefixes.find(p => url.pathname === p || url.pathname.startsWith(p + "/"));
    const path = matchedPrefix
      ? url.pathname.slice(matchedPrefix.length) || "/"
      : url.pathname;

    // Dashboard namespace: all /_/* routes
    if (path === "/_" || path.startsWith("/_/")) {
      return handleDashboard(env.FWD_DB, env.LOGIN_RATE_LIMITER, request);
    }

    // Redirect: /:slug
    const slug = path.slice(1); // strip leading "/"
    return handleRedirect(env.FWD_DB, slug);
  },
} satisfies ExportedHandler<Env>;
