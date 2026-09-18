CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  mfa_challenge_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_otp_mfa ON email_otp_challenges(mfa_challenge_id);
CREATE INDEX IF NOT EXISTS idx_email_otp_expires ON email_otp_challenges(expires_at);
