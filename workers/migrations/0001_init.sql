-- フレンド・ユーザー機能用のD1スキーマ。docs/USERS.md も参照。

CREATE TABLE players (
  code TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE friends (
  owner_code TEXT NOT NULL,
  friend_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_code, friend_code)
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_code TEXT NOT NULL,
  level TEXT NOT NULL,
  streak INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_scores_best ON scores (player_code, level, streak DESC);
