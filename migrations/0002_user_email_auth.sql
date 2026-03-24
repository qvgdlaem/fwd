-- Add per-user email authorization fields
ALTER TABLE users ADD COLUMN authorized_senders TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN email_secret TEXT NOT NULL DEFAULT '';
