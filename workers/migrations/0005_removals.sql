-- フレンド解除を相手に知らせるための簡易メールボックス（invitesと同じ考え方）。
-- 削除する側がフレンドを消した瞬間に、消された側あてに1件書き込む。
-- 消された側がフレンド画面を開いたときにポーリングで確認し、確認後は削除する。

CREATE TABLE removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_code TEXT NOT NULL,
  from_nickname TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_removals_to ON removals (to_code, created_at);
