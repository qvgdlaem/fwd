import PostalMime from "postal-mime";
import { addRedirect, findUserByAuthorizedSender } from "./db";
import type { Env } from "./db";

const MIN_SECRET_LENGTH = 8;

/**
 * Optional email-to-redirect handler.
 * Requires Cloudflare Email Routing pointed at this Worker.
 * Silently does nothing if no user has authorized_senders configured.
 *
 * Email format (body, any order — subject may also contain the secret):
 *   short=your-slug        (or slug=)
 *   url=https://dest.com   (or destination=)
 *
 * The user's email_secret must appear somewhere in the subject or body.
 */
export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const senderEmail = message.from.toLowerCase();

  // Find a user whose authorized_senders includes this sender
  const user = await findUserByAuthorizedSender(env.FWD_DB, senderEmail);
  if (!user) return;

  // User must have a secret configured and it must meet minimum length
  if (!user.email_secret || user.email_secret.length < MIN_SECRET_LENGTH) return;

  // Parse the raw email
  const raw = new Response(message.raw);
  const parsed = await PostalMime.parse(await raw.arrayBuffer());

  const subject = parsed.subject ?? "";
  const bodyText = (parsed.text ?? parsed.html ?? "").replace(/<[^>]+>/g, "");
  const fullText = `${subject}\n${bodyText}`;

  // Secret must appear somewhere in subject or body
  if (!fullText.includes(user.email_secret)) return;

  // Parse slug (short= or slug=) and url (url= or destination=)
  const slug = extractField(fullText, "short") ?? extractField(fullText, "slug");
  const url = extractField(fullText, "url") ?? extractField(fullText, "destination");

  if (!slug || !url) return;

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return;
  }

  // Disallow reserved dashboard namespace
  if (slug.startsWith("_")) return;

  // Write to D1 — silently ignore duplicate slugs
  try {
    await addRedirect(env.FWD_DB, slug, url, null);
  } catch {
    // Slug already exists — ignore
  }
}

function extractField(text: string, field: string): string | null {
  const match = text.match(new RegExp(`^${field}\\s*=\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}
