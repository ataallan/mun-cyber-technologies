-- MC Chat Bot: handoff / connect-to-team fields (status values are free-form TEXT)

ALTER TABLE chat_threads ADD COLUMN visitor_phone TEXT;
ALTER TABLE chat_threads ADD COLUMN handoff_note TEXT;
ALTER TABLE chat_threads ADD COLUMN handoff_at TEXT;
