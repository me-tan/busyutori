-- 部首マスター（コンプリート）で達成した部首の記録。
-- 端末に保存すると、リロードで消えたり、同じ端末で別の人がログインしたときに
-- 前の人の達成が見えてしまうため、アカウントに紐づけてサーバーに持つ。

CREATE TABLE cleared (
  player_code TEXT NOT NULL,
  level TEXT NOT NULL,      -- low | elem | all
  radical TEXT NOT NULL,    -- 表示形（"水/氵" のように2字形をまとめたものもある）
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_code, level, radical)
);
