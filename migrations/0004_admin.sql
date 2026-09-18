-- Admin dashboard: products, orders, messages + seed catalog

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  points_json TEXT NOT NULL DEFAULT '[]',
  price_label TEXT NOT NULL DEFAULT 'Custom license',
  price_note TEXT NOT NULL DEFAULT 'License — contact for pricing',
  price_cents INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  product_id TEXT,
  product_slug TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  buyer_phone TEXT,
  organization TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  customer_note TEXT,
  admin_reply TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  to_email TEXT,
  to_phone TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- Seed products (idempotent)
INSERT OR IGNORE INTO products (
  id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at
) VALUES (
  'prod-ai-soc-assistant',
  'ai-soc-assistant',
  'AI-Powered SOC Assistant',
  'Helps security teams cut down false positives so analysts spend time on real alerts, not noise. Supports professionals; does not replace them.',
  '["Reduces false-positive alerts","Helps analysts focus on real threats","Supports SOC workflows without replacing people"]',
  'Custom license',
  'License — contact for pricing',
  NULL,
  1,
  datetime('now')
);

INSERT OR IGNORE INTO products (
  id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at
) VALUES (
  'prod-mun-cyber-eye',
  'mun-cyber-eye',
  'Mun Cyber Eye',
  'Camera-based detection that spots criminal activity such as fights and shootings, then reports instantly to security agencies, police, homeowners, and schools.',
  '["Detects fights, shootings, and related threats on camera","Instant alerts to security agencies and police","Also notifies homeowners and schools"]',
  'Custom license',
  'License — contact for pricing',
  NULL,
  1,
  datetime('now')
);
