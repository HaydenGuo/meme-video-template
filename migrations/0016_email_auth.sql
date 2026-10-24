-- 邮箱统一身份；密码与验证码不进入用户公开资料或积分流水。
CREATE UNIQUE INDEX users_email_normalized ON users(lower(trim(email)));

CREATE TABLE email_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE email_auth_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE(email, purpose)
);
CREATE INDEX email_auth_challenges_expiry ON email_auth_challenges(expires_at);

CREATE TABLE email_auth_limits (
  scope TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
