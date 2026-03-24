/**
 * Create an initial admin user for the fwd dashboard.
 *
 * Usage (local):
 *   yarn wrangler d1 execute fwd --local --command "$(yarn tsx scripts/create-user.ts admin yourpassword)"
 *
 * Usage (remote):
 *   yarn wrangler d1 execute fwd --command "$(yarn tsx scripts/create-user.ts admin yourpassword)"
 *
 * Or run directly to print the SQL:
 *   yarn tsx scripts/create-user.ts <username> <password>
 */

import { hashPassword } from "../src/auth";

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Usage: yarn tsx scripts/create-user.ts <username> <password>");
  process.exit(1);
}

(async () => {
  const hash = await hashPassword(password);
  const sql = `INSERT OR REPLACE INTO users (username, password_hash) VALUES ('${username}', '${hash}');`;
  console.log(sql);
})();
