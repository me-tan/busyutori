# データ生成には以下の外部ソースが必要（このリポジトリには含まれない）:
#   kanjidic2.xml      - https://www.edrdg.org/kanjidic/kanjidic2.xml.gz
#                         （学年・読み・「本当の部首」= 康熙部首番号）
#   cjkvi-ids-master/  - https://github.com/cjkvi/cjkvi-ids の ids.txt
#                         （へん・かんむり等の字形の振り分けにのみ使用）
# 入手して SOURCE_DIR 以下に配置してから実行する。
import json, re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent / 'sources'

# ---- KANJIDIC2: 学年・読み・康熙部首番号 ----
JOYO = (1, 2, 3, 4, 5, 6, 8)

tree = ET.parse(SOURCE_DIR / 'kanjidic2.xml')
joyo = {}
for c in tree.getroot().findall('character'):
    grade_el = c.find('misc/grade')
    if grade_el is None or int(grade_el.text) not in JOYO:
        continue
    lit = c.find('literal').text
    rad_el = c.find('radical/rad_value[@rad_type="classical"]')
    on = [r.text for r in c.findall('reading_meaning/rmgroup/reading[@r_type="ja_on"]')]
    kun = [r.text for r in c.findall('reading_meaning/rmgroup/reading[@r_type="ja_kun"]')]
    joyo[lit] = {
        'grade': int(grade_el.text),
        'radical': int(rad_el.text),
        'readings_on': on,
        'readings_kun': kun,
    }

# ---- CHISE IDS: 字形分解（へん・かんむり等の表示形の振り分けにのみ使用） ----
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
  "⺮":"竹", "糸":"糹", "⺡":"氵", "⺘":"扌",
  "⺅":"亻", "⺾":"艹", "艸":"艹", "⻌":"辶", "辵":"辶",
  "⺖":"忄", "⺬":"礻", "⻂":"衤", "⻖":"阝", "⻏":"阝",
  "⺩":"王", "玉":"王", "⺨":"犭", "⺵":"罒",
  "⺣":"灬", "⺼":"月", "⺈":"刂", "⺉":"刂", "刀":"刂",
  "攴":"攵", "⺙":"攵", "⺧":"牛", "牜":"牛",
}
def norm_comp(c):
    return VARIANT.get(c, c)

def components(ch):
    """直接の構成部品のみ（1階層）。異体字を統合する。"""
    return {norm_comp(c) for c in direct(ch)}

# ---- 出題部首の手動キュレーション ----
# 康熙部首番号 -> 出題に使う表示形。
# タプルの場合は「その字形（へん・かんむり等）を実際に含む字だけ」を割り当て、
# 含まない字は2つめの表示形（基本形）に落とす。
# 一般に部首として認識されるものだけを明示的に列挙する（一・丿・亠等は除外）。
RADICALS = {
  85:  {"氵": ("さんずい",   "水に関係する"), "水": ("みず", "水の形が入っている")},
  9:   {"亻": ("にんべん",   "人に関係する"), "人": ("ひと", "人の形が入っている")},
  64:  {"扌": ("てへん",     "手の動作に関係する"), "手": ("て", "手の形が入っている")},
  75:  "木",
  149: "言",
  30:  "口",
  32:  "土",
  120: "糹",
  72:  "日",
  74:  "月",
  162: "辶",
  140: "艹",
  40:  "宀",
  61:  {"忄": ("りっしんべん","心に関係する"), "心": ("こころ", "心や感情に関係する")},
  154: "貝",
  38:  "女",
  167: "金",
  115: "禾",
  60:  "彳",
  18:  "刂",
  118: "竹",
  53:  "广",
  102: "田",
  181: "頁",
  112: "石",
  109: "目",
  86:  {"火": ("ひ", "火に関係する"), "灬": ("れっか", "火に関係する")},
  159: "車",
  117: "立",
  119: "米",
  173: "雨",
  184: "食",
  187: "馬",
  195: "魚",
  169: "門",
  15:  "冫",
  116: "穴",
  137: "舟",
  19:  "力",
  50:  "巾",
  66:  "攵",
  172: "隹",
  157: "足",
  166: "里",
  104: "疒",
  145: {"衤": ("ころもへん", "衣服に関係する"), "衣": ("ころも", "衣の形が入っている")},
  113: {"礻": ("しめすへん", "神事に関係する"), "示": ("しめす", "示の形が入っている")},
  (170, 163): "阝",  # こざとへん(170)・おおざと(163) は形が同じなので出題上は統合
  96:  "王",
  94:  {"犭": ("けものへん", "動物に関係する"), "犬": ("いぬ", "犬の形が入っている")},
  93:  "牛",
  128: "耳",
  108: "皿",
  142: "虫",
  164: "酉",
}
NAMES = {
  "木": ("き", "木の形が入っている"), "言": ("ごんべん", "言葉に関係する"),
  "口": ("くち", "口の形が入っている"), "土": ("つち", "土の形が入っている"),
  "糹": ("いと", "糸や布に関係する"), "日": ("にち", "日の形が入っている"),
  "月": ("つき", "月の形が入っている"), "辶": ("しんにょう", "道や進むことに関係する"),
  "艹": ("くさかんむり", "草や植物に関係する"), "宀": ("うかんむり", "家や建物に関係する"),
  "貝": ("かい", "お金や財産に関係する"), "女": ("おんな", "女性に関係する"),
  "金": ("かね", "金属に関係する"), "禾": ("のぎへん", "穀物に関係する"),
  "彳": ("ぎょうにんべん", "行くことに関係する"), "刂": ("りっとう", "刀で切ることに関係する"),
  "竹": ("たけ", "竹に関係する"), "广": ("まだれ", "建物に関係する"),
  "田": ("た", "田の形が入っている"), "頁": ("おおがい", "頭や顔に関係する"),
  "石": ("いし", "石の形が入っている"), "目": ("め", "目の形が入っている"),
  "車": ("くるま", "車や乗り物に関係する"), "立": ("たつ", "立つことに関係する"),
  "米": ("こめ", "米や穀物に関係する"), "雨": ("あめかんむり", "天気に関係する"),
  "食": ("しょく", "食べることに関係する"), "馬": ("うま", "馬に関係する"),
  "魚": ("うお", "魚に関係する"), "門": ("もんがまえ", "門や出入口に関係する"),
  "冫": ("にすい", "氷や冷たさに関係する"), "穴": ("あなかんむり", "穴に関係する"),
  "舟": ("ふね", "船に関係する"), "力": ("ちから", "力に関係する"),
  "巾": ("はば", "布に関係する"), "攵": ("のぶん", "動作に関係する"),
  "隹": ("ふるとり", "鳥に関係する"), "足": ("あし", "足に関係する"),
  "里": ("さと", "里の形が入っている"), "疒": ("やまいだれ", "病気に関係する"),
  "阝": ("こざと・おおざと", "丘や場所に関係する"), "王": ("おう", "王の形が入っている"),
  "牛": ("うし", "牛に関係する"), "耳": ("みみ", "耳や聞くことに関係する"),
  "皿": ("さら", "器に関係する"), "虫": ("むし", "虫に関係する"),
  "酉": ("ひよみのとり", "酒や発酵に関係する"),
}

# 各部首の成り立ち（結果画面の解説文に使う）。表示形の文字をキーにする
# （name_meaning()のようなへん/基本形の振り分けはせず、フラットに引く）。
ORIGIN = {
  "口": "人の口を四角く描いた象形文字。",
  "心": "心臓の形をそのまま描いた象形文字。",
  "扌": "「手」がへんの位置に来るときに形が変わったもの。指を広げた手のひらの形がもと。",
  "土": "土を盛り上げた塚（つか）の形からできた字。",
  "宀": "屋根の形を描いた字。家や建物を表す部首になった。",
  "日": "太陽を丸く描いた形が、後に四角くなった字。",
  "木": "枝と根を持つ木の形をそのまま描いた象形文字。",
  "門": "両開きの門の形をそのまま描いた字。",
  "人": "人が横を向いて立っている姿を描いた字。",
  "亻": "「人」が漢字の左側に来るときに形が変わったもの。",
  "女": "両手を前で重ねてひざまずく女性の姿を描いた字。",
  "火": "燃え上がる炎の形を描いた象形文字。",
  "田": "区切られた田んぼを上から見た形。",
  "禾": "穂を垂れた稲の形を描いた字。",
  "糹": "よりあわせた糸束の形を描いた字。",
  "艹": "地面から芽を出した草が2本並んだ形を描いた字。",
  "辶": "十字路と足あとを組み合わせた字で、道を行くことを表す。",
  "食": "食器に盛ったごはんにふたをした形を描いた字。",
  "氵": "水が流れる様子を描いた「水」が、へんの位置で形を変えたもの。",
  "阝": "山や丘が積み重なった形。左につくと丘、右につくと人の住む場所を表す。",
  "雨": "空から水滴が落ちてくる様子を描いた字。",
  "水": "水が流れる筋を描いた象形文字。",
  "言": "口から言葉が出てくる様子を描いた字。",
  "金": "土の中に金属の粒が埋まっている様子を描いた字。",
  "疒": "ベッドに人が横になっている形で、病気を表す。",
  "皿": "台のついた器の形を描いた字。",
  "馬": "たてがみのある馬を横から見た形を描いた字。",
  "魚": "魚を横から見た形を描いた象形文字（尾びれの部分が点4つになった）。",
  "忄": "「心」が漢字の左側に来るときに形が変わったもの。",
  "犭": "「犬」が漢字の左側に来るときに形が変わったもの。",
  "彳": "十字路の左半分を描いた字で、道を行くことを表す。",
  "力": "力を入れて働く腕、または田を耕すすきの形を描いた字。",
  "礻": "神をまつる台の形を描いた「示」が、へんの位置で形を変えたもの。",
  "竹": "葉をつけた竹が2本並んだ形を描いた字。",
  "貝": "貝殻の形を描いた字。昔は貝がお金として使われたため財産を表す。",
  "虫": "とぐろを巻いたヘビの形からできた字。後にいろいろな虫を表すようになった。",
  "隹": "尾の短いずんぐりした鳥を描いた象形文字。",
  "攵": "手に道具を持ってたたく様子を描いた字。",
  "石": "がけの下に転がる石の形を描いた字。",
  "車": "車輪と軸のある乗り物を上から見た形。",
  "頁": "大きな頭を持つ人を横から見た形を描いた字。",
  "刂": "「刀」が漢字の右側に来るときに形が変わったもの。",
  "衤": "「衣」が漢字の左側に来るときに形が変わったもの。",
  "王": "天・地・人をつなぐ大きなまさかり（斧）を持つ者の形からできた字。",
  "目": "人の目を描いた形が、後に縦向きになった字。",
  "舟": "丸木舟の形を描いた象形文字。",
  "巾": "布を棒に垂らした形を描いた字。",
  "月": "満ちる前の三日月の形を描いた字。",
  "牛": "牛の顔と角を正面から描いた字。",
  "穴": "洞穴の入り口の形を描いた字。",
  "手": "5本の指を広げた手のひらの形を描いた字。",
  "足": "ひざから下の、すねと足の形を描いた字。",
  "立": "地面に人がまっすぐ立つ姿を描いた字。",
  "冫": "氷が張ってひび割れた模様を描いた字。",
  "示": "神へのお供え物をのせる台の形を描いた字。",
  "灬": "「火」が漢字の下に来るときに形が変わったもの。点4つで燃える炎を表す。",
  "犬": "耳が立ち尾を巻いた犬を横から見た形を描いた字。",
  "广": "片流れの屋根と柱を描いた字で、家や建物を表す。",
  "酉": "酒を入れるつぼの形を描いた字。",
  "衣": "着物のえりを合わせた形を描いた字。",
  "里": "田んぼ（田）と土地（土）を組み合わせて、人が住む集落を表す字。",
  "米": "穂から実がこぼれ落ちる様子を描いた字。",
  "耳": "人の耳の形をそのまま描いた象形文字。",
}

# 分割対象の部首番号 -> 優先して探す「へん・かんむり等」の字形。
# 見つかればその字形を使い、見つからなければもう一方（基本形）を使う。
SPLIT_VARIANT = {85: "氵", 9: "亻", 64: "扌", 61: "忄", 86: "灬", 145: "衤", 113: "礻", 94: "犭"}

def bucket_for(radical_number, kanji):
    """その漢字の康熙部首番号から、出題に使う表示形（部首の字）を1つ決める。"""
    spec = RADICALS.get(radical_number)
    if spec is None:
        return None
    if isinstance(spec, str):
        return spec
    # dict: 2つの表示形（へん形・基本形）のうち、実際に含む字形の方を選ぶ
    variant_char = SPLIT_VARIANT[radical_number]
    if variant_char in components(kanji):
        return variant_char
    other = [c for c in spec if c != variant_char][0]
    return other

def name_meaning(rad):
    spec_by_char = {}
    for spec in RADICALS.values():
        if isinstance(spec, dict):
            spec_by_char.update(spec)
    if rad in spec_by_char:
        return spec_by_char[rad]
    return NAMES[rad]

# 康熙部首番号 -> {kanji: bucket_char} の逆引き（数値キーのタプルを展開）
NUMBER_TO_KEY = {}
for key in RADICALS:
    nums = key if isinstance(key, tuple) else (key,)
    for n in nums:
        NUMBER_TO_KEY[n] = key

def norm_reading(r):
    """読みを正規化: 送り仮名マーカーを除去"""
    return r.split('.')[0].replace('-', '').strip()

# ---- 部首ごとの漢字収集 ----
radicals_out = {}
kanji_used = set()
by_bucket = defaultdict(lambda: defaultdict(list))  # bucket_char -> grade -> [kanji]

for k, v in joyo.items():
    key = NUMBER_TO_KEY.get(v['radical'])
    if key is None:
        continue  # 出題対象として未キュレーションの部首
    bucket = bucket_for(key, k)
    if bucket is None or k == bucket:
        continue  # 部首そのものは除外
    by_bucket[bucket][str(v['grade'])].append(k)
    kanji_used.add(k)

for rad, by_grade in by_bucket.items():
    total = sum(len(x) for x in by_grade.values())
    if total < 3:
        continue  # 漢字が少なすぎる部首は出題対象外
    name, meaning = name_meaning(rad)
    radicals_out[rad] = {
        "name": name,
        "meaning": meaning,
        "origin": ORIGIN.get(rad, ""),
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
        "source": "KANJIDIC2（康熙部首番号・学年・読み） + CHISE IDS（へん/かんむり等の表示形の判定）",
        "note": "部首はKANJIDIC2の康熙部首番号（辞書上の正式な部首）に基づく。字形が偶然似ているだけの誤爆は含まない",
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
