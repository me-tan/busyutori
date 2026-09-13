# ぶしゅとり

提示された部首を含む漢字を、手書きで書き出す対戦型の漢字学習ゲーム。

既存の漢字ドリルは「書けた字」を採点するだけになりがちです。本作はその逆で、
**負けた瞬間に「書けなかった字」を見せる**ことを中心機能にしています。
一度使った漢字は同じ試合中は二度と使えないため、続けるほど自分の語彙の底が
試され、部首から意味を連想する感覚も自然に身につきます。

## モード

| モード | 内容 |
|---|---|
| オンライン対戦 | 別々の端末にいる相手と、部首を投げ合う対戦（後述） |
| タイムアタック | 30秒以内に次々と出題に答える。何連続で書けるか |
| 部首マスター | 1つの部首の漢字を、制限時間なしですべて書き出す |
| 漢字辞書 | 学年→部首→漢字と降りて、書き順・意味・音訓・使い方を調べる（ゲームではない） |

### 対戦のルール（概要）

1. 手番プレイヤー（攻撃側）に部首の候補が5つ提示され、1つを選んで相手に投げる
2. 受けた側（防御側）は30秒以内に、その部首を含む漢字を手書きで答える
   （`backend/app/game.py` の `ANSWER_SECONDS`）
3. 書ければ攻守交代。書けなければ攻撃側の勝ち
4. 一度使われた漢字は、その試合中は二度と使えない
5. 決着がついたら、最後に投げられた部首でまだ使われていなかった漢字を提示する

詳細なルール・データ仕様は [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)、
対戦バックエンドのAPI仕様は [docs/BACKEND.md](docs/BACKEND.md) を参照。

対象年齢は小学生〜高校生。学年配当（初級/中級/上級）は出題する部首の絞り込みに
使うだけで、答え自体の学年は問わない。

### フレンド機能

なまえ・ユーザー名・パスワードでアカウントを作って使う（メールアドレスは不要。
アカウントを作るまでは他の画面に進めない）。端末を変えても、ユーザー名と
パスワードで入り直せば記録とフレンドが引き継がれる。フレンドは
アカウントごとに発行されるコードで申請し、相手が承認するとつながる相互方式。
つながると、タイムアタックの難易度別ベストストリークを見せ合え、
フレンド＋自分だけのランキングも見られる。部首マスターの達成状況も
アカウントに保存される。フレンド一覧から1タップで対戦に誘うこともできる
（対戦の部屋コードをフレンドに渡すだけの仕組みで、フレンド画面を開いたときに
確認する。リアルタイムのプッシュ通知ではない）。API仕様は
[docs/USERS.md](docs/USERS.md) を参照。

## 技術構成

| 項目 | 内容 |
|---|---|
| フロントエンド | 静的サイト（HTML/CSS/バニラJS、ビルド不要） |
| 手書き認識 | [DaKanji単漢字CNN](https://github.com/CaptainDario/DaKanji-Single-Kanji-Recognition)（ONNX 2.2MB、MIT）を[ONNX Runtime Web](https://onnxruntime.ai/)でブラウザ内実行。描画とストローク記録は[KanjiCanvas](https://github.com/asdfjkl/kanjicanvas)（MIT） |
| バックエンド | Python 3.10以上 + [FastAPI](https://fastapi.tiangolo.com/)（対戦のルーム管理・WebSocket） |
| アカウント・フレンド機能 | Cloudflare Workers + D1（`workers/`。アカウント・フレンド・記録の永続化。パスワードはPBKDF2でハッシュ化） |
| データ | `radicals.json`（CHISE IDS + KANJIDIC2由来、`scripts/build_radicals.py` で生成）／`kanji-dict.json`・`strokes/`（KANJIDIC2 + JMdict + KanjiVG由来、`scripts/build_dict.py` で生成） |
| データ永続化 | 対戦の状態はサーバーのメモリ上のみ（試合が終われば破棄）。フレンド機能まわりだけD1に永続化 |

タイムアタック・部首マスター・漢字辞書の3つは、遊ぶこと自体はブラウザの中だけで
完結する（手書き認識もブラウザ内で動くので、対戦サーバーは要らない）。
ただしアカウントを作るまで最初の画面から先に進めないため、
**起動にはCloudflare Workers/D1が必要**。記録・達成・フレンドの保存も同じAPIを使う。
オンライン対戦だけが、これに加えてFastAPIサーバーを必要とする。

## ディレクトリ構成

```
kanjibattle/
├── README.md
├── LICENSE                        本プロジェクトのライセンス（MIT）
├── third_party-licenses/          同梱物のライセンス（ライブラリ・認識モデル・辞書データ・音源）
├── docs/
│   ├── GAME_DESIGN.md             ルール・データ仕様・設計判断の理由
│   ├── BACKEND.md                 対戦APIのプロトコル仕様
│   ├── USERS.md                   フレンド・ユーザー機能APIの仕様
│   └── DEVLOG.md                  既知の課題・未確定事項
├── frontend/                      静的サイト（そのままどこにでもデプロイ可能）
│   ├── index.html                 画面のHTML/CSSと、ひとり用・フレンドのJS
│   ├── js/
│   │   ├── vendor/                外部ライブラリ（KanjiCanvas、ONNX Runtime Web）
│   │   ├── recognizer.js          手書き漢字の認識（CNNモデルを動かす）
│   │   ├── config.js              対戦バックエンドAPIのURL設定
│   │   ├── net.js                 オンライン対戦の通信クライアント
│   │   ├── battle.js              オンライン対戦の進行（部屋づくり〜勝敗まで）
│   │   ├── dict.js                漢字辞書（学年→部首→漢字→くわしく）
│   │   ├── furigana.js            画面の文字にふりがなを振る
│   │   ├── audio.js               効果音・BGMの再生
│   │   └── players.js             フレンド機能のクライアント（/api/* は同一オリジン）
│   ├── assets/                    効果音・BGM（Kenney, CC0）とマスコットの絵
│   ├── models/                    手書き認識のCNNモデルとラベル
│   ├── data/
│   │   ├── radicals.json          部首・漢字データ
│   │   ├── kanji-dict.json        漢字辞書（画数・音訓・利用例・意味）
│   │   ├── strokes/               書き順（部首ごとに分割。辞書で開いたときだけ読む）
│   │   └── stroke-counts.json     字→画数（手書き認識の誤受理対策に使用）
│   └── dev/                       手書き判定ロジックの検証用ページ（公開しない）
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
│   └── migrations/                D1スキーマ（0001〜。番号順にすべて適用する）
├── wrangler.jsonc                 フロント配信+workers/+D1のCloudflare設定
└── scripts/
    ├── build_radicals.py          radicals.json の生成
    ├── build_dict.py              kanji-dict.json・strokes/ の生成
    ├── kanji-meanings.json        漢字の意味（人が書いたデータ。生成物ではない）
    ├── check_meanings.py          ↑の検査（読めない漢字を使っていないか等）
    └── lower_audio_volume.py      効果音・BGMの音量を下げ直す
```

## ローカルで動かす

アカウントを作るまで最初の画面から先に進めないので、**静的サーバーだけでは
遊べない**（`python3 -m http.server` では `/api/*` が無く、アカウント作成が
501で失敗する）。ローカルで通しで動かすには `wrangler dev` を使う。

### アカウント機能ごと動かす（タイムアタック・部首マスター・漢字辞書）

```bash
# 初回だけ: ローカルD1にスキーマを入れる（workers/migrations/ を番号順にすべて）
for f in workers/migrations/*.sql; do
  npx wrangler d1 execute kanjinage-users --local --file="$f"
done

npx wrangler dev
# 表示された http://localhost:8787/ を開く
```

静的ファイルの配信と `/api/*` の両方を `wrangler dev` が受け持つ（`wrangler.jsonc`
の `assets` と `main`）。Cloudflareアカウントは不要で、D1はローカルのSQLiteが使われる。

### 画面だけ確認する（ログインの先には進めない）

```bash
cd frontend
python3 -m http.server 8000
# http://localhost:8000/ を開く
```

ログイン画面までしか進めないが、データの読み込みや見た目の確認には使える。
`data/radicals.json` を `fetch` するため、`file://` を直接開いても動かない。

### 対戦モードも試す場合

バックエンドは `X | None` 形式の型ヒントを使っているため **Python 3.10以上**が必要（3.9以下では起動時に`TypeError`になる）。`python3 --version` で確認し、古い場合は3.10以上を別途インストールして読み替えること。

```bash
# 1. 対戦バックエンドを起動
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. 別ターミナルでフロントエンド＋アカウント機能を起動
npx wrangler dev --port 5500
# http://localhost:5500/ を開く
```

対戦はアカウントが要るので、ここでも `wrangler dev` を使う（上の手順でローカルD1に
スキーマを入れてあること）。1台のPCで試すときは、通常のウィンドウとシークレット
ウィンドウで別々のアカウントを作り、部屋コードで待ち合わせる。

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

本プロジェクトは [LICENSE](LICENSE)（MIT）。同梱物はそれぞれ以下に従う。

| 同梱物 | ライセンス |
|---|---|
| [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) | [kanjicanvas-LICENSE.TXT](third_party-licenses/kanjicanvas-LICENSE.TXT)（MIT、バックリンク条項あり） |
| [DaKanji単漢字認識モデル](https://github.com/CaptainDario/DaKanji-Single-Kanji-Recognition) | [dakanji-single-kanji-recognition-LICENSE.TXT](third_party-licenses/dakanji-single-kanji-recognition-LICENSE.TXT)（MIT） |
| [ONNX Runtime Web](https://onnxruntime.ai/) | [onnxruntime-LICENSE.TXT](third_party-licenses/onnxruntime-LICENSE.TXT)（MIT） |
| [KANJIDIC2・JMdict](https://www.edrdg.org/)（学年・音訓・画数・利用例） | [edrdg-CREDIT.TXT](third_party-licenses/edrdg-CREDIT.TXT)（CC BY-SA 4.0） |
| [KanjiVG](https://kanjivg.tagaini.net/)（書き順） | [kanjivg-CREDIT.TXT](third_party-licenses/kanjivg-CREDIT.TXT)（CC BY-SA 3.0） |
| [CHISE IDS](http://www.chise.org/)（字形分解） | [chise-ids-CREDIT.TXT](third_party-licenses/chise-ids-CREDIT.TXT)（GPLv2） |
| 効果音・BGM（Kenney ほか） | [kenney-sfx-CREDIT.TXT](third_party-licenses/kenney-sfx-CREDIT.TXT)（CC0、表記義務なし） |

コードはMITだが、`frontend/data/`配下の生成データは元データの
CC BY-SA（KANJIDIC2・JMdict・KanjiVG）を引き継ぐ。
