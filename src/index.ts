import { handleDashboard } from "./dashboard";
import { handleRedirect } from "./redirect";
import type { Env } from "./db";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Dashboard namespace: all /_/* routes
    if (path === "/_" || path.startsWith("/_/")) {
      return handleDashboard(env.FWD_DB, env.LOGIN_RATE_LIMITER, request);
    }

    // Redirect: /:slug
    const slug = path.slice(1); // strip leading "/"
    return handleRedirect(env.FWD_DB, slug);
  },
} satisfies ExportedHandler<Env>;
