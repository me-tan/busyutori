-- 対戦の誘いが取り消されたことを、誘われた側に知らせるための簡易メールボックス
-- （invite_declinesの逆方向。誘った側が自分の誘いを取り消すと、誘われた側に通知が残る）。

CREATE TABLE invite_cancels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_code TEXT NOT NULL,       -- 元の誘われた人（通知を受け取る側）
  from_nickname TEXT NOT NULL, -- 取り消した人のニックネーム
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invite_cancels_to ON invite_cancels (to_code, created_at);
