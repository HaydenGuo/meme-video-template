-- Direct email/password registration does not claim control of the inbox.
-- Keep previously verified credentials intact while allowing NULL for new registrations.
CREATE TABLE email_credentials_new (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  verified_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO email_credentials_new (user_id, password_hash, verified_at, updated_at)
SELECT user_id, password_hash, verified_at, updated_at FROM email_credentials;

DROP TABLE email_credentials;
ALTER TABLE email_credentials_new RENAME TO email_credentials;
