-- invite_declines に room_code を追加する。
-- これまでは「断られた通知が1件でもあれば今の誘いを取り消す」という雑な判定だったため、
-- 過去の未確認の通知が新しい誘いまで巻き込んで誤ってキャンセル扱いにしてしまうバグがあった。
-- room_codeで紐付けて、今送っている誘いの部屋と一致する場合だけ反応するようにする。

ALTER TABLE invite_declines ADD COLUMN room_code TEXT;
