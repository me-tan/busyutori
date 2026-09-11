# 対戦バックエンド API仕様

対戦（オンラインバトル）のルーム管理と試合進行を担うAPI。`backend/app/` に実装。
状態はプロセスのメモリ上のみ（DBなし）。サーバー再起動で進行中の対戦は消える。

## 全体の流れ

```
1. ホストが部屋を作る          POST /api/rooms          → room code, host の player_id
2. ゲストが部屋に入る          POST /api/rooms/{code}/join → guest の player_id
3. 両者がWebSocketに接続        GET  /ws/rooms/{code}?player_id=...
4. 2人揃った時点でサーバーが試合開始を通知し、最初の部首候補を送る
5. 以降は WebSocket 上のメッセージだけで進行する
```

## REST

### `POST /api/rooms`

部屋を作成する（ホスト側）。

リクエスト:
```json
{ "level": "low" | "elem" | "all" }
```

レスポンス:
```json
{ "code": "AB3XZ", "player_id": "..." }
```

### `POST /api/rooms/{code}/join`

部屋に参加する（ゲスト側）。`code` は大文字小文字を区別しない。

レスポンス:
```json
{ "code": "AB3XZ", "player_id": "...", "level": "elem" }
```

存在しない・満員・すでに開始済みの部屋には `404` を返す。

### `POST /api/quickmatch`

ランダムマッチング。同じ難易度で待っている部屋があれば参加し、なければ
新しく部屋を作って待つ側になる（部屋コードは画面に出さない）。

リクエスト:
```json
{ "level": "low" | "elem" | "all" }
```

レスポンス:
```json
{ "code": "AB3XZ", "player_id": "...", "level": "elem", "is_host": true }
```

`is_host: true` なら相手を待つ側（`GET /api/health`同様、あとはWebSocketに
接続して2人揃うのを待つだけ）。`false` なら即マッチ成立（相手は既に接続を待っている）。

### `DELETE /api/rooms/{code}?player_id=...`

ランダムマッチングで一定時間相手が見つからずあきらめた場合の後始末。
まだ相手がついていない・自分がホストの部屋しか消せない（他人の部屋や
既にマッチ済みの部屋を消そうとすると `{"ok": false}` を返すだけで何も起きない）。

## WebSocket

`GET /ws/rooms/{code}?player_id=<REST応答で受け取ったplayer_id>`

`player_id` がその部屋のホスト/ゲストのどちらかと一致しないと `4004` で閉じる。
2人分の接続が揃った時点でサーバー側が試合状態を初期化し、以下を順番に送る。

### サーバー→クライアント

| type | 内容 |
|---|---|
| `start` | 試合開始。`attacker`, `defender`（player_id）, `level` |
| `offer` | 攻撃側への部首候補。`attacker`, `choices: [{radical, name, meaning}]`（最大5件）, `used`（使用済み漢字の一覧） |
| `defend` | 攻撃側が部首を投げた。`radical`, `defender`, `seconds`（制限時間、30固定） |
| `answer_rejected` | 防御側にだけ送る、不正解の通知。`reason: "used" \| "not_in_radical"`, `kanji` |
| `turn_result` | 正解が確定した。`radical`, `kanji`, `next_attacker`, `used` |
| `game_over` | 試合終了。`reason: "timeout" \| "give_up" \| "disconnect" \| "exhausted"`, `loser`（player_idまたはnull）, `reveal: {radical, unused, got} \| null` |
| `rematch_requested` | どちらか一方が再戦を希望した（`game_over`後のみ）。`by`（希望したplayer_id） |
| `rematch_declined` | 相手が再戦せずに抜けた（`game_over`後のみ）。以後この部屋は消える |

### クライアント→サーバー

| type | 送信できるのは | 内容 |
|---|---|---|
| `throw` | 現在の攻撃側 | `{"type": "throw", "radical": "氵"}`。直前の `offer` の `choices` に含まれる部首以外は無視される |
| `answer` | 現在の防御側 | `{"type": "answer", "kanji": "海"}`。KanjiCanvasの認識候補の中からプレイヤーが選んだ1文字を送る |
| `give_up` | 現在の防御側 | `{"type": "give_up"}`。時間内でも自主的に負けを認める |
| `rematch` | `game_over`後の両者 | `{"type": "rematch"}`。両者が送ると同じ部屋・同じ難易度で試合が再開し `start` が届く |
| `leave` | `game_over`後の両者 | `{"type": "leave"}`。再戦せずに部屋を抜ける。相手に `rematch_declined` が届く |

### 正解判定はサーバーが最終決定する

`answer` を受け取ったら、サーバーは以下の順で判定する（`backend/app/game.py` の
`is_valid_answer`）。

1. 出題された部首を含む漢字プールに入っているか（学年は問わない。入っていなければ `not_in_radical`）
2. 既に使われていれば `used`

難易度（`low`/`elem`/`all`）は出題する部首の絞り込みにのみ使う。選んだ難易度より
上の学年の字で答えても、その部首を含んでいて未使用なら正解になる。

クライアント側（`frontend/`）でも同じロジックのミニ版で候補を絞り込んで見せて
いるが、それはあくまでUXのため。**改造されたクライアントから不正な `answer`
が来てもサーバー側で弾く**ことを前提に設計している。

### タイマーはサーバー側が管理する

`throw` を受けてからサーバーが30秒（`ANSWER_SECONDS`）のタイマーを起動する。
時間内に正しい `answer` が来なければ `game_over(reason="timeout")` を送る。
クライアント側のカウントダウン表示はあくまで見た目で、判定には使わない。

### 使用済み漢字はルーム内で共有

`used` は試合全体で1つ。攻撃側・防御側どちらが書いた字も、同じ試合中は
二度と使えない。

## デプロイ

フロントエンドとバックエンドは別ホストにデプロイする想定。

### フロントエンド: Cloudflare Pages

`frontend/` をそのまま静的サイトとして公開する。ビルドコマンドは不要
（Build command: 空、Build output directory: `frontend`）。

### バックエンド: Render / Railway / Fly.io など

WebSocketで長時間接続を維持する必要があるため、常駐プロセスとして動く
Pythonホストを使う。`backend/Dockerfile` を使ってデプロイできる
（**ビルドコンテキストはリポジトリのルート**に設定すること。
`frontend/data/radicals.json` を読み込むため）。

**Cloudflare Workers（Pythonサポート）は今回は採用しない。** 理由:

- Cloudflare WorkersのPythonランタイムはPyodide（WebAssembly）ベースで、
  対応しているpipパッケージが限定されている。FastAPI + Uvicornのような
  ASGIサーバーをそのまま動かす想定の作りになっていない
- 本APIはルームごとに30秒タイマーの `asyncio.Task` を張り続ける常駐処理が
  前提。Workersのようなリクエスト単位の実行モデルとは相性が悪い
- 2026年時点でまだベータ段階であり、実運用のWebSocketゲームサーバーとしての
  実績が薄い

フロントエンドは静的配信なのでCloudflare Pagesの無料枠と非常に相性が良い。
バックエンドだけ別ホストに分ける構成が、Pythonに不慣れな状態でも詰まりにくい。

### 環境変数

デプロイ後、`frontend/js/config.js` の `API_BASE` を実際のバックエンドURLに
書き換える（`https://xxxx.onrender.com` など）。バックエンド側でCORSを
特定オリジンに絞りたい場合は `backend/app/main.py` の `allow_origins=["*"]`
を変更する。
