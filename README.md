# 部首アタック

提示された部首を含む漢字を、手書きで書き出す対戦型の漢字学習ゲーム。

既存の漢字ドリルは「書けた字」を採点するだけになりがちです。本作はその逆で、
**負けた瞬間に「書けなかった字」を見せる**ことを中心機能にしています。
一度使った漢字は同じ試合中は二度と使えないため、続けるほど自分の語彙の底が
試され、部首から意味を連想する感覚も自然に身につきます。

## モード

| モード | 内容 |
|---|---|
| タイムアタック | 30秒以内に次々と出題に答える。何連続で書けるか |
| コンプリート | 1つの部首の漢字を、制限時間なしですべて書き出す |
| オンライン対戦 | 別々の端末にいる相手と、部首を投げ合う対戦（後述） |

### 対戦のルール（概要）

1. 手番プレイヤー（攻撃側）に部首の候補が5つ提示され、1つを選んで相手に投げる
2. 受けた側（防御側）は20秒以内に、その部首を含む漢字を手書きで答える
3. 書ければ攻守交代。書けなければ攻撃側の勝ち
4. 一度使われた漢字は、その試合中は二度と使えない
5. 決着がついたら、最後に投げられた部首でまだ使われていなかった漢字を提示する

詳細なルール・データ仕様は [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)、
対戦バックエンドのAPI仕様は [docs/BACKEND.md](docs/BACKEND.md) を参照。

対象年齢は小学生〜高校生。学年配当（初級/中級/上級）に応じて出題範囲を切り替える。

## 技術構成

| 項目 | 内容 |
|---|---|
| フロントエンド | 静的サイト（HTML/CSS/バニラJS、ビルド不要） |
| 手書き認識 | [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas)（クライアントサイドJS、MIT） |
| バックエンド | Python + [FastAPI](https://fastapi.tiangolo.com/)（対戦のルーム管理・WebSocket） |
| データ | `radicals.json`（CHISE IDS + KANJIDIC2由来、`scripts/build_radicals.py` で生成） |
| データ永続化 | なし（対戦の状態はサーバーのメモリ上のみ。試合が終われば破棄） |

タイムアタック・コンプリートの2モードはサーバー不要で完全にオフラインで動く。
サーバーが必要なのはオンライン対戦モードのみ。

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
│   └── DEVLOG.md                  既知の課題・未確定事項
├── frontend/                      静的サイト（そのままどこにでもデプロイ可能）
│   ├── index.html                 メイン画面（HTML/CSS/JSの本体）
│   ├── js/
│   │   ├── vendor/                外部ライブラリ（KanjiCanvas）
│   │   ├── config.js              バックエンドAPIのURL設定
│   │   └── net.js                 オンライン対戦の通信クライアント
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

フロントエンドとバックエンドは別々にデプロイする。詳細は
[docs/BACKEND.md](docs/BACKEND.md) の「デプロイ」の節を参照。

- フロントエンド: Cloudflare Pages（静的ファイルをそのまま公開、無料枠が大きい）
- バックエンド: Render / Railway / Fly.io など、Pythonプロセスを常駐させられるホスト
  （WebSocketを使うため、Cloudflare WorkersのPythonサポートは現状不向き。理由はdocs/BACKEND.md参照）

## ライセンス

本プロジェクトは [LICENSE](LICENSE)（MIT）。
同梱している [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) は
[third_party-licenses/kanjicanvas-LICENSE.TXT](third_party-licenses/kanjicanvas-LICENSE.TXT)
（MIT、バックリンク条項あり）に従う。
