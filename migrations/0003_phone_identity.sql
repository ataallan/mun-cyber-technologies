-- Email OR phone identity: nullable email, unique phone, at least one required.
-- SQLite/D1 cannot drop NOT NULL via ALTER COLUMN; rebuild users table.
-- Foreign keys from sessions/mfa_challenges reference users(id); disable briefly.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  name TEXT NOT NULL,
  organization TEXT,
  created_at TEXT NOT NULL,
  totp_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'customer',
  disabled INTEGER NOT NULL DEFAULT 0,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

INSERT INTO users_new (
  id, email, phone, password_hash, salt, name, organization, created_at,
  totp_secret, mfa_enabled, role, disabled
)
SELECT
  id, email, NULL, password_hash, salt, name, organization, created_at,
  totp_secret, mfa_enabled, role, disabled
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Partial unique indexes: uniqueness only when value is present
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;

PRAGMA foreign_keys = ON;
