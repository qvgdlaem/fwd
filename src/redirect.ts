import { getRedirect } from "./db";
import type { D1Database } from "@cloudflare/workers-types";

export async function handleRedirect(db: D1Database, slug: string): Promise<Response> {
  if (!slug) {
    return new Response("Not found", { status: 404 });
  }

  const redirect = await getRedirect(db, slug);
  if (!redirect) {
    return new Response(`No redirect found for "${slug}"`, { status: 404 });
  }

  return Response.redirect(redirect.url, 302);
}
