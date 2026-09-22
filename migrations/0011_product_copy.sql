-- Public catalog copy: short commercial summaries (existing DBs keep INSERT OR IGNORE rows)

UPDATE products
SET
  summary = 'Cuts false positives so analysts focus on real alerts.',
  points_json = '["Fewer false-positive alerts","Faster triage for real threats","Supports SOC teams"]',
  updated_at = datetime('now')
WHERE slug = 'ai-soc-assistant';

UPDATE products
SET
  summary = 'Detects fights, shootings, and related threats, then alerts the right people.',
  points_json = '["Camera detection of fights and shootings","Instant alerts to police and security","Notifications for homes and schools"]',
  updated_at = datetime('now')
WHERE slug = 'mun-cyber-eye';
