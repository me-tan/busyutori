-- 対戦の誘いを断られたことを、誘った側に知らせるための簡易メールボックス
-- （invites・removalsと同じ考え方）。

CREATE TABLE invite_declines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_code TEXT NOT NULL,       -- 元の誘った人（通知を受け取る側）
  from_nickname TEXT NOT NULL, -- 断った人のニックネーム
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invite_declines_to ON invite_declines (to_code, created_at);
