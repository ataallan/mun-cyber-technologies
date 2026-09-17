-- MFA (TOTP) + roles/disabled + pending full_access sessions
-- Safe for D1/SQLite ADD COLUMN. If a column already exists from a partial run,
-- skip the failing ALTER manually or re-apply after fixing schema; wrangler tracks
-- applied migration filenames once the whole file succeeds.

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sessions ADD COLUMN full_access INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_id ON mfa_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires_at ON mfa_challenges(expires_at);
