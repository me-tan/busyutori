-- フレンドを対戦に誘う機能用（フレンド画面を開いたときにポーリングで確認する
-- 簡易な「メールボックス」方式。リアルタイムのプッシュ通知はしない）。

CREATE TABLE invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  room_code TEXT NOT NULL,
  level TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invites_to ON invites (to_code, created_at DESC);
