# 部首投げ

提示された部首を含む漢字を、手書きで書き出す対戦型の漢字学習ゲーム。

既存の漢字ドリルは「書けた字」を採点するだけになりがちです。本作はその逆で、
**負けた瞬間に「書けなかった字」を見せる**ことを中心機能にしています。
一度使った漢字は同じ試合中は二度と使えないため、続けるほど自分の語彙の底が
試され、部首から意味を連想する感覚も自然に身につきます。

## モード

| モード | 内容 |
|---|---|
| タイムアタック | 30秒以内に次々と出題に答える。何連続で書けるか |
| 部首マスター | 1つの部首の漢字を、制限時間なしですべて書き出す |
| オンライン対戦 | 別々の端末にいる相手と、部首を投げ合う対戦（後述） |

### 対戦のルール（概要）

1. 手番プレイヤー（攻撃側）に部首の候補が5つ提示され、1つを選んで相手に投げる
2. 受けた側（防御側）は20秒以内に、その部首を含む漢字を手書きで答える
3. 書ければ攻守交代。書けなければ攻撃側の勝ち
4. 一度使われた漢字は、その試合中は二度と使えない
5. 決着がついたら、最後に投げられた部首でまだ使われていなかった漢字を提示する

詳細なルール・データ仕様は [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)、
対戦バックエンドのAPI仕様は [docs/BACKEND.md](docs/BACKEND.md) を参照。

対象年齢は小学生〜高校生。学年配当（初級/中級/上級）は出題する部首の絞り込みに
使うだけで、答え自体の学年は問わない。

### フレンド機能

ニックネーム＋自動発行コードだけで使える（パスワード・メール不要）。フレンドの
コードを追加すると、タイムアタックの難易度別ベストストリークを見せ合える。
API仕様は [docs/USERS.md](docs/USERS.md) を参照。

## 技術構成

| 項目 | 内容 |
|---|---|
| フロントエンド | 静的サイト（HTML/CSS/バニラJS、ビルド不要） |
| 手書き認識 | [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas)（クライアントサイドJS、MIT） |
| バックエンド | Python 3.10以上 + [FastAPI](https://fastapi.tiangolo.com/)（対戦のルーム管理・WebSocket） |
| フレンド機能 | Cloudflare Workers + D1（`workers/`。ニックネーム・フレンド・記録の永続化） |
| データ | `radicals.json`（CHISE IDS + KANJIDIC2由来、`scripts/build_radicals.py` で生成） |
| データ永続化 | 対戦の状態はサーバーのメモリ上のみ（試合が終われば破棄）。フレンド機能まわりだけD1に永続化 |

タイムアタック・部首マスターの2モードはサーバー不要で完全にオフラインで動く。
オンライン対戦にはFastAPIサーバーが、フレンド機能にはCloudflare Workers/D1が必要。

## ディレクトリ構成

```
kanjibattle/
├── README.md
├── LICENSE                        本プロジェクトのライセンス（MIT）
├── third_party-licenses/
│   └── kanjicanvas-LICENSE.TXT    KanjiCanvasのライセンス（同梱必須）
├── docs/
│   ├── GAME_DESIGN.md             ルール・データ仕様・設計判断の理由
│   ├── BACKEND.md                 対戦APIのプロトコル仕様
│   ├── USERS.md                   フレンド・ユーザー機能APIの仕様
│   └── DEVLOG.md                  既知の課題・未確定事項
├── frontend/                      静的サイト（そのままどこにでもデプロイ可能）
│   ├── index.html                 メイン画面（HTML/CSS/JSの本体）
│   ├── js/
│   │   ├── vendor/                外部ライブラリ（KanjiCanvas）
│   │   ├── config.js              対戦バックエンドAPIのURL設定
│   │   ├── net.js                 オンライン対戦の通信クライアント
│   │   ├── audio.js               効果音・BGMの再生
│   │   └── players.js             フレンド機能のクライアント（/api/* は同一オリジン）
│   ├── assets/                    効果音・BGM（Kenney, CC0）
│   ├── data/
│   │   └── radicals.json          部首・漢字データ
│   └── dev/                       手書き判定ロジックの検証用ページ
├── backend/                       対戦サーバー（Python/FastAPI）
│   ├── app/
│   │   ├── main.py                REST + WebSocketエンドポイント
│   │   ├── rooms.py               ルーム（対戦部屋）の管理
│   │   ├── game.py                対戦ルールのロジック（純粋関数、テストしやすい）
│   │   ├── data.py                radicals.json の読み込み・検索
│   │   └── schemas.py             リクエスト/レスポンスの型定義
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── workers/                       フレンド機能API（Cloudflare Workers + D1）
│   ├── src/index.js               /api/* のルーティング・認証・D1アクセス
│   └── migrations/0001_init.sql   D1スキーマ
├── wrangler.jsonc                 フロント配信+workers/+D1のCloudflare設定
└── scripts/
    └── build_radicals.py          radicals.json の生成スクリプト
```

## ローカルで動かす

### フロントエンドのみ（タイムアタック・コンプリート）

```bash
cd frontend
python3 -m http.server 8000
# http://localhost:8000/ を開く
```

`data/radicals.json` を `fetch` するため、`file://` を直接開いても動かない。

### 対戦モードも試す場合

バックエンドは `X | None` 形式の型ヒントを使っているため **Python 3.10以上**が必要（3.9以下では起動時に`TypeError`になる）。`python3 --version` で確認し、古い場合は3.10以上を別途インストールして読み替えること。

```bash
# 1. バックエンドを起動
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. 別ターミナルでフロントエンドを起動
cd frontend
python3 -m http.server 5500
# http://localhost:5500/ を開く
```

`frontend/js/config.js` の `API_BASE` がバックエンドのURL（デフォルト
`http://localhost:8000`）を指しているか確認すること。

## デプロイ

対戦のFastAPIサーバーと、フロント+フレンド機能は別々にデプロイする。

- フロントエンド + フレンド機能: 同じCloudflareプロジェクトにまとめている
  （`wrangler.jsonc`。静的ファイルは`env.ASSETS`、`/api/*`は`workers/src/index.js`が処理）。
  `wrangler login`でログイン後、`wrangler d1 create` → マイグレーション適用 →
  `wrangler deploy`。詳しい手順は[docs/USERS.md](docs/USERS.md)の「セットアップ・デプロイ」を参照
- 対戦バックエンド: Render / Railway / Fly.io など、Pythonプロセスを常駐させられるホスト
  （WebSocketを使うため、Cloudflare WorkersのPythonサポートは現状不向き。理由は
  [docs/BACKEND.md](docs/BACKEND.md)参照。こちらは今回のフレンド機能とは無関係な
  別サービスのまま）

## ライセンス

本プロジェクトは [LICENSE](LICENSE)（MIT）。
同梱している [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) は
[third_party-licenses/kanjicanvas-LICENSE.TXT](third_party-licenses/kanjicanvas-LICENSE.TXT)
（MIT、バックリンク条項あり）に従う。
