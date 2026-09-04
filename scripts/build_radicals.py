# データ生成には以下の外部ソースが必要（このリポジトリには含まれない）:
#   kd.json            - KANJIDIC2由来の学年・読みデータ
#   cjkvi-ids-master/  - https://github.com/cjkvi/cjkvi-ids の ids.txt
# 入手して SOURCE_DIR 以下に配置してから実行する。
import json, re
from collections import defaultdict
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent / 'sources'

kd = json.load(open(SOURCE_DIR / 'kd.json'))
JOYO = (1,2,3,4,5,6,8)
joyo = {k:v for k,v in kd.items() if v.get('grade') in JOYO}

IDC = set(chr(c) for c in range(0x2FF0, 0x2FFC))
ids = {}
for line in open(SOURCE_DIR / 'cjkvi-ids-master' / 'ids.txt', encoding='utf-8'):
    if line.startswith('#'): continue
    p = line.rstrip('\n').split('\t')
    if len(p) < 3: continue
    ids[p[1]] = re.sub(r'\[[A-Z]+\]', '', p[2])

def direct(ch):
    d = ids.get(ch)
    if not d or d == ch: return []
    return [c for c in d if c not in IDC and c != ch]

# 異体字の統合（IDSは部品によって表記ゆれがある）
VARIANT = {
  # 字形のゆれを統一する（同じ形なのにコードが違うものだけ）
  "⺮":"竹", "糸":"糹", "⺡":"氵", "⺘":"扌",
  "⺅":"亻", "⺾":"艹", "艸":"艹", "⻌":"辶", "辵":"辶",
  "⺖":"忄", "⺬":"礻", "⻂":"衤", "⻖":"阝", "⻏":"阝",
  "⺩":"王", "玉":"王", "⺨":"犭", "⺵":"罒",
  "⺣":"灬", "⺼":"月", "⺈":"刂", "⺉":"刂", "刀":"刂",
  "攴":"攵", "⺙":"攵", "⺧":"牛", "牜":"牛",
  # 肉は「腐」1字のみなので月には統合せず、そのまま扱う
}
def norm_comp(c):
    return VARIANT.get(c, c)

def components(ch):
    """直接の構成部品のみ（1階層）。異体字を統合する。"""
    return {norm_comp(c) for c in direct(ch)}

# ---- 出題部首の手動キュレーション ----
# 機械的な集計には「一」「丿」「亠」等の直感的でない部品が混ざるため、
# 一般に部首として認識されるものだけを明示的に列挙する。
RADICALS = {
  "氵": ("さんずい",   "水に関係する"),
  "水": ("みず",       "水の形が入っている"),
  "亻": ("にんべん",   "人に関係する"),
  "人": ("ひと",       "人の形が入っている"),
  "扌": ("てへん",     "手の動作に関係する"),
  "手": ("て",         "手の形が入っている"),
  "木": ("き",         "木の形が入っている"),
  "言": ("ごんべん",   "言葉に関係する"),
  "口": ("くち",       "口の形が入っている"),
  "土": ("つち",       "土の形が入っている"),
  "糹": ("いと",       "糸や布に関係する"),
  "日": ("にち",       "日の形が入っている"),
  "月": ("つき",       "月の形が入っている"),
  "辶": ("しんにょう", "道や進むことに関係する"),
  "艹": ("くさかんむり","草や植物に関係する"),
  "宀": ("うかんむり", "家や建物に関係する"),
  "忄": ("りっしんべん","心に関係する"),
  "心": ("こころ",     "心や感情に関係する"),
  "貝": ("かい",       "お金や財産に関係する"),
  "女": ("おんな",     "女性に関係する"),
  "金": ("かね",       "金属に関係する"),
  "禾": ("のぎへん",   "穀物に関係する"),
  "彳": ("ぎょうにんべん","行くことに関係する"),
  "刂": ("りっとう",   "刀で切ることに関係する"),
  "竹": ("たけ",       "竹に関係する"),
  "广": ("まだれ",     "建物に関係する"),
  "田": ("た",         "田の形が入っている"),
  "頁": ("おおがい",   "頭や顔に関係する"),
  "石": ("いし",       "石の形が入っている"),
  "目": ("め",         "目の形が入っている"),
  "火": ("ひ",         "火に関係する"),
  "灬": ("れっか",     "火に関係する"),
  "車": ("くるま",     "車や乗り物に関係する"),
  "立": ("たつ",       "立つことに関係する"),
  "米": ("こめ",       "米や穀物に関係する"),
  "雨": ("あめかんむり","天気に関係する"),
  "食": ("しょく",     "食べることに関係する"),
  "馬": ("うま",       "馬に関係する"),
  "魚": ("うお",       "魚に関係する"),
  "門": ("もんがまえ", "門や出入口に関係する"),
  "冫": ("にすい",     "氷や冷たさに関係する"),
  "穴": ("あなかんむり","穴に関係する"),
  "舟": ("ふね",       "船に関係する"),
  "力": ("ちから",     "力に関係する"),
  "巾": ("はば",       "布に関係する"),
  "攵": ("のぶん",     "動作に関係する"),
  "隹": ("ふるとり",   "鳥に関係する"),
  "足": ("あし",       "足に関係する"),
  "里": ("さと",       "里の形が入っている"),
  "疒": ("やまいだれ", "病気に関係する"),
  "衤": ("ころもへん", "衣服に関係する"),
  "衣": ("ころも",     "衣の形が入っている"),
  "礻": ("しめすへん", "神事に関係する"),
  "示": ("しめす",     "示の形が入っている"),
  "阝": ("こざと・おおざと", "丘や場所に関係する"),
  "王": ("おう",       "王の形が入っている"),
  "犭": ("けものへん", "動物に関係する"),
  "犬": ("いぬ",       "犬の形が入っている"),
  "牛": ("うし",       "牛に関係する"),
  "耳": ("みみ",       "耳や聞くことに関係する"),
  "皿": ("さら",       "器に関係する"),
  "虫": ("むし",       "虫に関係する"),
  "酉": ("ひよみのとり","酒や発酵に関係する"),
}

def norm_reading(r):
    """読みを正規化: 送り仮名マーカーを除去"""
    return r.split('.')[0].replace('-', '').strip()

# ---- 部首ごとの漢字収集 ----
radicals_out = {}
kanji_used = set()

for rad, (name, meaning) in RADICALS.items():
    by_grade = defaultdict(list)
    for k, v in joyo.items():
        if k == rad:
            continue  # 部首そのものは除外
        if rad in components(k):
            by_grade[str(v['grade'])].append(k)
            kanji_used.add(k)
    total = sum(len(x) for x in by_grade.values())
    if total < 3:
        continue  # 漢字が少なすぎる部首は出題対象外
    radicals_out[rad] = {
        "name": name,
        "meaning": meaning,
        "kanji": {g: sorted(ks) for g, ks in sorted(by_grade.items())},
        "count": {
            "all": total,
            "elem": sum(len(by_grade.get(str(g), [])) for g in (1,2,3,4,5,6)),
            "low":  sum(len(by_grade.get(str(g), [])) for g in (1,2,3)),
        }
    }

# ---- 漢字マスタ（読みデータ） ----
kanji_out = {}
for k in sorted(kanji_used):
    v = joyo[k]
    on  = sorted({norm_reading(r) for r in v.get('readings_on', []) if norm_reading(r)})
    kun = sorted({norm_reading(r) for r in v.get('readings_kun', []) if norm_reading(r)})
    kanji_out[k] = {
        "grade": v['grade'],
        "on": on,
        "kun": kun,
        "readings": sorted(set(on) | set(kun)),
    }

out = {
    "meta": {
        "description": "部首アタック 部首マスタ",
        "source": "CHISE IDS (cjkvi-ids) + KANJIDIC2派生データ",
        "note": "部首は伝統的な部首分類ではなく、字形に含まれる部品として判定している",
        "grades": {"1":"小1","2":"小2","3":"小3","4":"小4","5":"小5","6":"小6","8":"中学以降"},
        "radicalCount": len(radicals_out),
        "kanjiCount": len(kanji_out),
    },
    "radicals": radicals_out,
    "kanji": kanji_out,
}

OUT_PATH = Path(__file__).resolve().parents[1] / 'frontend' / 'data' / 'radicals.json'
with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

# ---- 集計レポート ----
print(f"出題可能な部首: {len(radicals_out)}種")
print(f"収録漢字: {len(kanji_out)}字\n")

for lvl, key, thr in [("初級(小1-3)", "low", 8), ("中級(小1-6)", "elem", 12), ("上級(全常用)", "all", 20)]:
    ok = [r for r, d in radicals_out.items() if d['count'][key] >= thr]
    print(f"{lvl}: {thr}字以上を持つ部首 {len(ok)}種")
    print("  " + " ".join(ok))
    print()

print("部首別の漢字数（上位25）")
rank = sorted(radicals_out.items(), key=lambda x: -x[1]['count']['all'])[:25]
print(f"  {'部首':<4}{'名称':<12}{'全常用':>6}{'小6まで':>8}{'小3まで':>8}")
for r, d in rank:
    c = d['count']
    print(f"  {r:<4}{d['name']:<12}{c['all']:>6}{c['elem']:>8}{c['low']:>8}")
