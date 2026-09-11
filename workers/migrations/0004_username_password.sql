-- ログインをユーザー名＋パスワードに分離する。
-- code（フレンドに教える公開コード）はそのまま。ログインの鍵にはしない。
-- 既存の行（0001〜0003で作られたプロフィール）はusernameがNULLのままになり、
-- ユーザー名・パスワードでのログイン対象からは外れる（作り直しが必要）。

ALTER TABLE players ADD COLUMN username TEXT;
ALTER TABLE players ADD COLUMN password_hash TEXT;
ALTER TABLE players ADD COLUMN password_salt TEXT;

-- SQLiteのUNIQUE INDEXはNULL同士を重複とみなさないため、
-- username未設定の既存行があっても問題なく作成できる。
CREATE UNIQUE INDEX idx_players_username ON players (username);
