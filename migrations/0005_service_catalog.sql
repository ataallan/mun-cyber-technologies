-- Service catalog: kind column + engagement deposit products (svc-*)

ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'product';

UPDATE products SET kind = 'product' WHERE kind IS NULL OR kind = '';

-- Seed service deposits (idempotent)
INSERT OR IGNORE INTO products (
  id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
) VALUES (
  'svc-awareness',
  'svc-awareness',
  'Cybersecurity Awareness',
  'Practical security awareness initiatives designed to help people recognize threats and make safer decisions.',
  '["Security awareness content","Phishing and social-engineering education","Security best-practice guidance"]',
  'Deposit $499',
  'Starting engagement deposit — balance invoiced after scope',
  49900,
  1,
  datetime('now'),
  'service'
);

INSERT OR IGNORE INTO products (
  id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
) VALUES (
  'svc-software',
  'svc-software',
  'Software Development',
  'Purpose-built software and intelligent workflows that address security, operational, and technology needs.',
  '["Security-focused applications","Automation and workflow tools","AI-assisted technology solutions"]',
  'Deposit $999',
  'Starting engagement deposit — balance invoiced after scope',
  99900,
  1,
  datetime('now'),
  'service'
);

INSERT OR IGNORE INTO products (
  id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
) VALUES (
  'svc-defensive',
  'svc-defensive',
  'Defensive Cyber Systems',
  'Technology focused on improving visibility, alert analysis, prioritization, and defensive response.',
  '["Threat detection concepts","Alert triage and prioritization","Defensive automation"]',
  'Deposit $799',
  'Starting engagement deposit — balance invoiced after scope',
  79900,
  1,
  datetime('now'),
  'service'
);

INSERT OR IGNORE INTO products (
  id, slug, name, summary, points_json, price_label, price_note, price_cents, active, updated_at, kind
) VALUES (
  'svc-ai-ops',
  'svc-ai-ops',
  'AI for Security Operations',
  'AI-assisted approaches that help security professionals process information, classify events, prioritize threats, and respond more efficiently.',
  '["AI-assisted security analysis","Alert prioritization support","Designed to support — not replace — professionals"]',
  'Deposit $899',
  'Starting engagement deposit — balance invoiced after scope',
  89900,
  1,
  datetime('now'),
  'service'
);
