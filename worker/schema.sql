-- Datenbank des Workers (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  link TEXT NOT NULL,
  link_norm TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  eta_sec INTEGER,
  error TEXT,
  meta TEXT,
  speakers TEXT,
  speaker_count INTEGER,
  results TEXT,
  notion_meta TEXT,
  transcript TEXT,
  seg_index TEXT,
  notion_page_id TEXT,
  notion_page_url TEXT,
  notion_modes TEXT NOT NULL DEFAULT '[]',
  notion_last TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS episodes_user ON episodes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS episodes_link ON episodes (user_id, link_norm);

CREATE TABLE IF NOT EXISTS qa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL,
  q TEXT NOT NULL,
  found INTEGER NOT NULL,
  answer TEXT NOT NULL,
  cites TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qa_episode ON qa (episode_id, id);

CREATE TABLE IF NOT EXISTS spend (
  month TEXT PRIMARY KEY,
  usd REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, at);
