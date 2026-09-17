-- Service payment tracking: Stripe session id + payment outcome statuses (status TEXT)
ALTER TABLE orders ADD COLUMN stripe_session_id TEXT;
