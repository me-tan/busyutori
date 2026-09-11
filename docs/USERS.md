# フレンド・ユーザー機能 API仕様

ニックネームとフレンドの記録を扱うAPI。`workers/` に実装（Cloudflare Workers + D1）。
対戦（`backend/`, FastAPI）とは完全に別サービスで、フロントエンドと同じCloudflare
プロジェクトに同居する（`wrangler.jsonc`の`main`/`assets`/`d1_databases`を参照）。
`/api/` 以外のパスはWorkerからそのまま静的フロントエンド（`env.ASSETS`）に委譲される
ため、フロントから見るとAPIは同一オリジンの相対パスで呼べる。

なぜ対戦バックエンドと別サービスにしたか、なぜCloudflare Workersを対戦には使わない
ことにしたかは[BACKEND.md](BACKEND.md)を参照。この機能はルームの20〜30秒タイマーの
ような常駐処理を必要としないリクエスト完結型のCRUDなので、Workers + D1が素直に合う。

## 認証モデル：ログイン用の username/password と、フレンド用の code を分離

ログインする鍵（username/password）と、フレンドに教える公開コード（code）を
別物にしている。code はフレンドに気軽に教える前提の識別子なので、これをログイン
の鍵にも使ってしまうと「フレンドに教える＝パスワードを教える」ことになってしまう
ため。

- `username` / `password`: アカウント作成時に決める、ログイン用の認証情報。
  `password`はPBKDF2（ユーザーごとのランダムsalt、SHA-256、`PBKDF2_ITERATIONS`回）
  でハッシュ化してD1に保存し、平文は保持しない。パスワードを忘れると復旧手段は
  ない（メール・SMSを持たないため。対象年齢・スコープ的にこの割り切りを採用）。
- `code`: 6文字の公開コード（英数字。0/O・1/Iなど紛らわしい文字は除く）。
  フレンドに教えて追加してもらうための識別子で、ログインには使えない。
- `token`: ログイン（`POST /api/players`での新規登録、または`POST /api/login`）の
  たびに新しく発行される秘密トークン。ブラウザのlocalStorageにだけ保存し、自分の
  データを変更するリクエストで`Authorization: Bearer <token>`として送る。サーバー
  はSHA-256ハッシュだけをD1に保存し、生のトークンは保存しない。ログインし直すと
  古いtokenは上書きされて無効になる。

フレンドは申請→承認の相互方式（`friendships`テーブル、`status: pending|accepted`）。
コードを入れると相手に申請が届き、相手が承認して初めてフレンドになる。両者が
互いに申請し合っていた場合はクロスしたとみなして即承認になる。ランキングは
見知らぬ相手のニックネームを公開しないよう、自分とフレンドだけの範囲に
限定している（全体ランキングは今回作らない）。

対戦への招待は、対戦バックエンド（`backend/`, FastAPI）の部屋コードをこのAPI経由で
フレンドに渡すだけの「メールボックス」。リアルタイムのプッシュ通知はできないため、
招待された側がフレンド画面を開いたときにポーリングで確認する方式（`invites`テーブル、
作成から10分で表示対象から外れる）。

フレンド解除も同じ考え方の「メールボックス」（`removals`テーブル）。承認済みの
フレンド関係を解除すると、解除された側に通知が1件残り、フレンド画面を開いたときに
表示される（3日で表示対象から外れる）。まだ承認していない申請を取り消した場合は
通知しない。

対戦の誘いを断られたときも同様（`invite_declines`テーブル）。誘った側に通知が
1件残る（1日で表示対象から外れる）。参加して誘いが消える場合（`DELETE
/api/invites/:id`）は通知しない。`room_code`を持たせているのは、フロント側で
「今まさに送っている誘い」と紐付けて自動でキャンセル状態にするため。これが
無いと、過去の未確認の通知が新しい誘いまで巻き込んで誤ってキャンセル扱いに
してしまう（実際に起きた不具合）。

逆に、誘った側が返事を待たずに自分の誘いを取り消した場合（`DELETE
/api/invites/room/:room_code`）は、誘われていた側に`invite_cancels`テーブルで
通知が残る（1日で表示対象から外れる）。誘いのレコード自体も同時に削除される
ので、相手の「対戦の誘い」一覧からは自動で消えるが、黙って消えると
分かりにくいため、明示的な通知も残している。

通知バッジは2色に集約している。赤（`friendReqBadge`）はフレンド関連（申請が
来ている・フレンド解除された）、緑（`inviteBadge`）は対戦の誘い関連（誘いが
来ている・自分の誘いが断られた）で、それぞれ複数の通知種別をまとめて判定する。

## API

| メソッド/パス | 認証 | 内容 |
|---|---|---|
| `POST /api/players` | 不要 | `{username, password, nickname}` → 新規登録。`{code, token, nickname}`を返す |
| `POST /api/login` | 不要 | `{username, password}` → ログインし直し、新しいtokenを発行する。`{code, token, nickname}`を返す |
| `GET /api/players/me` | 必要 | `{code, nickname, best}` → 自分のプロフィール画面用 |
| `GET /api/players/:code` | 不要 | `{code, nickname}`。コードからの照会用 |
| `PATCH /api/players/me` | 必要 | `{nickname}` → 改名 |
| `POST /api/friends` | 必要 | `{code}` → フレンド申請を送る（相手が先に送っていればクロス承認）。`{code, nickname, status: "pending"\|"accepted"}`を返す |
| `GET /api/friends` | 必要 | `{friends: [{code, nickname, best: {low?, elem?, all?}}]}`。承認済みのみ |
| `GET /api/friends/requests` | 必要 | `{requests: [{code, nickname, created_at}]}`。自分あての未承認の申請 |
| `POST /api/friends/:code/accept` | 必要 | `code`からの申請を承認する |
| `POST /api/friends/:code/decline` | 必要 | `code`からの申請を断る |
| `DELETE /api/friends/:code` | 必要 | フレンド解除（承認済み・未承認どちらでも）。承認済みの関係を解除した場合のみ、相手に`removals`で通知を残す |
| `GET /api/removals` | 必要 | `{removals: [{id, from_nickname, created_at}]}`。自分がフレンド解除された、まだ確認していない通知（3日以内） |
| `DELETE /api/removals/:id` | 必要 | 解除通知を確認済みにする |
| `POST /api/scores` | 必要 | `{level, streak}` → タイムアタック結果を記録（追記のみ。ベストは`MAX(streak)`で都度計算） |
| `GET /api/ranking?level=elem` | 必要 | `{ranking: [{code, nickname, best, isMe}]}`（自分＋フレンドのみ、best降順） |
| `POST /api/invites` | 必要 | `{code, room_code, level}` → `code`のフレンドを対戦に誘う（`code`がフレンドでないと400） |
| `DELETE /api/invites/room/:room_code` | 必要 | 誘った側が、相手の返事を待たずに自分の誘いを取り消す。誘われていた側に`invite_cancels`で通知を残す |
| `GET /api/invite-cancels` | 必要 | `{cancels: [{id, from_nickname, created_at}]}`。自分あての誘いが取り消された、まだ確認していない通知（1日以内） |
| `DELETE /api/invite-cancels/:id` | 必要 | 通知を確認済みにする |
| `GET /api/invites` | 必要 | `{invites: [{id, from_code, from_nickname, room_code, level, created_at}]}`。自分あての新しい誘い（10分以内） |
| `DELETE /api/invites/:id` | 必要 | 誘いを消す（参加した後の後始末。通知は残さない） |
| `POST /api/invites/:id/decline` | 必要 | 誘いを断る。誘った側に`invite_declines`で通知を残す |
| `GET /api/invite-declines` | 必要 | `{declines: [{id, from_nickname, room_code, created_at}]}`。自分が送った誘いが断られた、まだ確認していない通知（1日以内）。`room_code`でどの誘いが断られたか特定できる |
| `DELETE /api/invite-declines/:id` | 必要 | 通知を確認済みにする |

認証は`Authorization: Bearer <token>`をSHA-256でハッシュ化し、`players.token_hash`と
一致する行を探すだけ（`workers/src/index.js`の`requireAuth`）。

## データ

スキーマは`workers/migrations/`（`0001_init.sql`: players/friends/scores、
`0002_invites.sql`: invites、`0003_friend_requests.sql`: friendships、
`0004_username_password.sql`: players に username/password_hash/password_salt を追加、
`0005_removals.sql`: removals、`0006_invite_declines.sql`: invite_declines、
`0007_invite_declines_room.sql`: invite_declines に room_code を追加、
`0008_invite_cancels.sql`: invite_cancels）。
`friends`テーブルは`0003`で使わなくなったが、データはそのまま残してある
（削除していない）。D1無料枠は1日あたり読み取り500万行・書き込み10万行・
容量5GB（2026年9月時点、超過するとその日はエラーになる）。この規模のアプリなら十分。

## セットアップ・デプロイ

1. `wrangler login` でCloudflareにログインする（対話的なブラウザ認証が必要）。
2. `wrangler d1 create kanjinage-users` を実行し、返ってきた`database_id`を
   `wrangler.jsonc`の`d1_databases[0].database_id`に書き込む。
3. `workers/migrations/`配下のファイルを番号順にすべて適用する
   （`wrangler d1 execute kanjinage-users --remote --file=workers/migrations/0001_init.sql`、
   続けて`0002_invites.sql`、`0003_friend_requests.sql`、`0004_username_password.sql`、
   `0005_removals.sql`、`0006_invite_declines.sql`、`0007_invite_declines_room.sql`、
   `0008_invite_cancels.sql`も）。
4. `wrangler deploy` でフロントエンド（`frontend/`）とWorker（`workers/src/index.js`）を
   まとめてデプロイする。

新しいマイグレーションを追加したときは、ローカルD1・本番D1の両方に
`--local`/`--remote`それぞれで同じファイルを適用すること（片方だけ適用すると
「テーブルが無い」エラーになる）。

ローカルでの動作確認は`--local`を付ける（ローカルD1が使われ、実際のCloudflare
アカウントには一切触れない）:

```
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0001_init.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0002_invites.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0003_friend_requests.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0004_username_password.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0005_removals.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0006_invite_declines.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0007_invite_declines_room.sql
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0008_invite_cancels.sql
wrangler dev --local
```
