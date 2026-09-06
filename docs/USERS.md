# フレンド・ユーザー機能 API仕様

ニックネームとフレンドの記録を扱うAPI。`workers/` に実装（Cloudflare Workers + D1）。
対戦（`backend/`, FastAPI）とは完全に別サービスで、フロントエンドと同じCloudflare
プロジェクトに同居する（`wrangler.jsonc`の`main`/`assets`/`d1_databases`を参照）。
`/api/` 以外のパスはWorkerからそのまま静的フロントエンド（`env.ASSETS`）に委譲される
ため、フロントから見るとAPIは同一オリジンの相対パスで呼べる。

なぜ対戦バックエンドと別サービスにしたか、なぜCloudflare Workersを対戦には使わない
ことにしたかは[BACKEND.md](BACKEND.md)を参照。この機能はルームの20〜30秒タイマーの
ような常駐処理を必要としないリクエスト完結型のCRUDなので、Workers + D1が素直に合う。

## 認証モデル：ニックネーム＋コードのみ（パスワード・メール不要）

- `code`: 6文字の公開コード（英数字。0/O・1/Iなど紛らわしい文字は除く）。
  フレンドに教えて追加してもらうための識別子。
- `token`: プロフィール作成時に1度だけ発行される秘密トークン。ブラウザの
  localStorageにだけ保存し、自分のデータを変更するリクエストで
  `Authorization: Bearer <token>` として送る。サーバーはSHA-256ハッシュだけを
  D1に保存し、生のトークンは保存しない。
- パスワード・メールは持たない。**tokenを紛失するとそのプロフィールは復旧できない**
  （対象年齢・スコープ的にこの割り切りを採用している）。

フレンド追加は一方向・承認不要（コードを入れた時点で自分の一覧に載る。相手が
追加し返す必要はない）。

## API

| メソッド/パス | 認証 | 内容 |
|---|---|---|
| `POST /api/players` | 不要 | `{nickname}` → プロフィール作成。`{code, token, nickname}`を返す（tokenが渡るのはこの時だけ） |
| `GET /api/players/:code` | 不要 | `{code, nickname}`。コードからの照会用 |
| `PATCH /api/players/me` | 必要 | `{nickname}` → 改名 |
| `POST /api/friends` | 必要 | `{code}` → フレンド追加（既に追加済みでも200）。相手の`{code, nickname}`を返す |
| `GET /api/friends` | 必要 | `{friends: [{code, nickname, best: {low?, elem?, all?}}]}`。`best`はタイムアタックの難易度別ベストストリーク |
| `DELETE /api/friends/:code` | 必要 | フレンド解除 |
| `POST /api/scores` | 必要 | `{level, streak}` → タイムアタック結果を記録（追記のみ。ベストは`MAX(streak)`で都度計算） |

認証は`Authorization: Bearer <token>`をSHA-256でハッシュ化し、`players.token_hash`と
一致する行を探すだけ（`workers/src/index.js`の`requireAuth`）。

## データ

スキーマは`workers/migrations/0001_init.sql`。`players` / `friends` / `scores` の3テーブル。
D1無料枠は1日あたり読み取り500万行・書き込み10万行・容量5GB（2026年9月時点、
超過するとその日はエラーになる）。この規模のアプリなら十分。

## セットアップ・デプロイ

1. `wrangler login` でCloudflareにログインする（対話的なブラウザ認証が必要）。
2. `wrangler d1 create kanjinage-users` を実行し、返ってきた`database_id`を
   `wrangler.jsonc`の`d1_databases[0].database_id`に書き込む。
3. `wrangler d1 execute kanjinage-users --remote --file=workers/migrations/0001_init.sql`
   でスキーマを適用する。
4. `wrangler deploy` でフロントエンド（`frontend/`）とWorker（`workers/src/index.js`）を
   まとめてデプロイする。

ローカルでの動作確認は`--local`を付ける（ローカルD1が使われ、実際のCloudflare
アカウントには一切触れない）:

```
wrangler d1 execute kanjinage-users --local --file=workers/migrations/0001_init.sql
wrangler dev --local
```
