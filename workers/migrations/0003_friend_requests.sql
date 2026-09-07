-- フレンドを「片方が追加したら即つながる」一方向から、
-- 「申請→承認」の相互承認方式に変更する。
-- 旧friendsテーブルは使わなくなるが、データはそのまま残しておく（削除しない）。

CREATE TABLE friendships (
  requester_code TEXT NOT NULL,
  recipient_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_code, recipient_code)
);
CREATE INDEX idx_friendships_recipient ON friendships (recipient_code, status);
CREATE INDEX idx_friendships_requester ON friendships (requester_code, status);
