import { handleDashboard } from "./dashboard";
import { handleRedirect } from "./redirect";
import { handleEmail } from "./email";
import { FAVICON_B64 } from "./favicon";
import { LOGO_SVG_B64 } from "./logo";
import type { Env } from "./db";

// Decode favicon once at startup
const FAVICON_BYTES: Uint8Array = (() => {
  const bin = atob(FAVICON_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
})();

const LOGO_SVG_TEXT = atob(LOGO_SVG_B64);

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

    // Favicon
    if (path === "/favicon.ico" || path === "/favicon.png") {
      return new Response(FAVICON_BYTES, {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }

    if (path === "/logo.svg") {
      return new Response(LOGO_SVG_TEXT, {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
      });
    }

    // Robots — disallow all crawling
    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Dashboard namespace: all /_/* routes
    if (path === "/_" || path.startsWith("/_/")) {
      return handleDashboard(env.FWD_DB, env.LOGIN_RATE_LIMITER, request);
    }

    // Redirect: /:slug
    const slug = path.slice(1); // strip leading "/"
    return handleRedirect(env.FWD_DB, slug);
  },
} satisfies ExportedHandler<Env>;
