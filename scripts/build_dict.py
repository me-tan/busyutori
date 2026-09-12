# 漢字辞書（frontend/data/kanji-dict.json と frontend/data/strokes/）を作る。
#
# データ生成には以下の外部ソースが必要（このリポジトリには含まれない）:
#   kanjidic2.xml - https://www.edrdg.org/kanjidic/kanjidic2.xml.gz
#                   （画数・音読み・訓読み。訓読みは送り仮名付きの形で使う）
#   JMdict_e      - http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
#                   （利用例に出す熟語とその読み）
#   kanjivg/      - https://github.com/KanjiVG/kanjivg の releases から
#                   kanjivg-YYYYMMDD-main.zip を展開してできる kanji/ を
#                   scripts/sources/kanjivg/ に置く（書き順）
# 入手して SOURCE_DIR 以下に配置してから実行する。
#
# 漢字の意味（日本語）はどの外部データにも無いため、scripts/kanji-meanings.json に
# 人手で用意し、ここで読み込んで混ぜている。生成をやり直しても消えないよう、
# 生成物ではなく別ファイルに置いている。
import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path(__file__).resolve().parent / 'sources'
MEANINGS = Path(__file__).resolve().parent / 'kanji-meanings.json'
OUT_DICT = ROOT / 'frontend' / 'data' / 'kanji-dict.json'
OUT_STROKES = ROOT / 'frontend' / 'data' / 'strokes'

# 対象の漢字と部首は radicals.json に合わせる（辞書とゲームで字が食い違わないように）
radicals_json = json.load(open(ROOT / 'frontend' / 'data' / 'radicals.json', encoding='utf-8'))
TARGET = set(radicals_json['kanji'])

# ---- KANJIDIC2: 画数・音読み・訓読み ----
# 訓読みは "つか.える" のように送り仮名が . の後ろに入っている。
# ゲーム側（radicals.json）は判定に使うので . より前だけを持っているが、
# 辞書では「つか(える)」と見せたいので、ここでは丸ごと残す。
info = {}
for c in ET.parse(SOURCE_DIR / 'kanjidic2.xml').getroot().findall('character'):
    lit = c.find('literal').text
    if lit not in TARGET:
        continue
    stroke_el = c.find('misc/stroke_count')  # 複数ある場合の先頭が標準的な画数
    info[lit] = {
        'strokes': int(stroke_el.text) if stroke_el is not None else 0,
        'on': [r.text for r in c.findall('reading_meaning/rmgroup/reading[@r_type="ja_on"]')],
        'kun': [r.text for r in c.findall('reading_meaning/rmgroup/reading[@r_type="ja_kun"]')],
    }

missing = TARGET - set(info)
if missing:
    raise SystemExit(f'KANJIDIC2に無い字があります: {sorted(missing)}')

# ---- JMdict: 利用例に出す熟語 ----
# JMdictの ke_pri（news1/ichi1 等）は「よく使われる語」の印。これが付いた語だけを
# 拾うことで、小学生が見ても意味の分かる語に寄せる。
PRI = {'news1', 'ichi1', 'spec1', 'spec2', 'gai1'}
# 表記や語そのものが学習向けでないもの。gloss側ではなく注記で弾く
BAD_KE_INF = ('irregular', 'rarely', 'out-dated', 'ateji')
BAD_MISC = ('vulgar', 'slang', 'derogatory', 'obsolete', 'archaic', 'rare', 'obscure')
MIN_LEN = 2     # 1字だけの「語」（氷→こおり）は訓読みと同じで用例にならない
MAX_LEN = 5     # これより長い語は用例として長すぎる
MAX_WORDS = 6   # 1字あたりに出す用例の数

candidates = defaultdict(list)  # 漢字 -> [(優先度, 語の長さ, 語, よみ)]


def collect(entry, require_pri, only=None):
    misc = ' '.join(m.text or '' for m in entry.findall('sense/misc'))
    if any(b in misc for b in BAD_MISC):
        return
    for k_ele in entry.findall('k_ele'):
        word = k_ele.findtext('keb') or ''
        if not (MIN_LEN <= len(word) <= MAX_LEN):
            continue
        inf = ' '.join(i.text or '' for i in k_ele.findall('ke_inf'))
        if any(b in inf for b in BAD_KE_INF):
            continue
        pri = {p.text for p in k_ele.findall('ke_pri')} & PRI
        if require_pri and not pri:
            continue
        reading = pick_reading(entry, word)
        if not reading:
            continue
        for ch in set(word):
            if ch in TARGET and (only is None or ch in only):
                candidates[ch].append((-len(pri), len(word), word, reading))


def pick_reading(entry, word):
    """その表記に対応する読みを選ぶ。re_restr が付いた読みは指定の表記専用。"""
    for r_ele in entry.findall('r_ele'):
        restr = [x.text for x in r_ele.findall('re_restr')]
        if restr and word not in restr:
            continue
        if r_ele.find('re_nokanji') is not None:
            continue
        return r_ele.findtext('reb') or ''
    return ''


def scan(require_pri, only=None):
    for _, el in ET.iterparse(SOURCE_DIR / 'JMdict_e'):
        if el.tag == 'entry':
            collect(el, require_pri, only)
            el.clear()  # 6万語ぶんを抱えたままにしないよう、読んだそばから捨てる


scan(require_pri=True)
# よく使う語が1つも無かった字（中学以降の難しい字に多い）は、印の有無を問わず拾い直す
short = {k for k in TARGET if not candidates[k]}
if short:
    scan(require_pri=False, only=short)

words = {}
for k in TARGET:
    seen, picked = set(), []
    for _, _, word, reading in sorted(candidates[k]):
        if word in seen:
            continue
        seen.add(word)
        # 「愛媛大」を出したあとに「愛媛大学」も出す、といった重複を避ける
        if any(word.startswith(p[0]) for p in picked):
            continue
        picked.append([word, reading])
        if len(picked) >= MAX_WORDS:
            break
    words[k] = picked

# ---- KanjiVG: 書き順 ----
# 1画が1つの <path> になっていて、並び順がそのまま書き順。
PATH_D = re.compile(r'<path [^>]*?\bd="([^"]+)"')


def strokes_of(ch):
    svg = (SOURCE_DIR / 'kanjivg' / ('%05x.svg' % ord(ch))).read_text(encoding='utf-8')
    return PATH_D.findall(svg)


# 書き順は1字1KBほどあるので、まとめて1ファイルにすると辞書を開くたびに重い。
# 部首ごとに分けて、その部首の漢字一覧に入ったときだけ読み込む。
# ファイル名は部首の1文字目のコードポイント（"刀/刂" のように / を含む部首名が
# あるため、部首名そのものはファイル名に使えない）。
OUT_STROKES.mkdir(parents=True, exist_ok=True)
for old in OUT_STROKES.glob('*.json'):
    old.unlink()

for rad, rdata in radicals_json['radicals'].items():
    shard = {}
    for kanji_list in rdata['kanji'].values():
        for k in kanji_list:
            shard[k] = strokes_of(k)
    name = '%05x.json' % ord(rad[0])
    (OUT_STROKES / name).write_text(
        json.dumps(shard, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# ---- 意味（人手で用意したもの）----
meanings = json.load(open(MEANINGS, encoding='utf-8')) if MEANINGS.exists() else {}

# ---- 書き出し ----
out = {}
for k in sorted(TARGET):
    e = {
        'strokes': info[k]['strokes'],
        'on': info[k]['on'],
        'kun': info[k]['kun'],
        'words': words[k],
    }
    if meanings.get(k):
        e['mean'] = meanings[k]
    out[k] = e

OUT_DICT.write_text(json.dumps({
    'meta': {
        'description': 'ぶしゅとり 漢字辞書',
        'source': 'KANJIDIC2（画数・音訓） + JMdict（利用例） + KanjiVG（書き順）',
        'note': '意味はscripts/kanji-meanings.jsonで人手で用意している',
        'kanjiCount': len(out),
        'meaningCount': sum(1 for e in out.values() if 'mean' in e),
    },
    'kanji': out,
}, ensure_ascii=False, indent=1), encoding='utf-8')

print(f'漢字 {len(out)}字 / 意味あり {sum(1 for e in out.values() if "mean" in e)}字')
print(f'用例ゼロ {sum(1 for k in TARGET if not words[k])}字')
print(f'{OUT_DICT.relative_to(ROOT)}: {OUT_DICT.stat().st_size // 1024}KB')
print(f'{OUT_STROKES.relative_to(ROOT)}/: {len(list(OUT_STROKES.glob("*.json")))}ファイル / '
      f'{sum(f.stat().st_size for f in OUT_STROKES.glob("*.json")) // 1024}KB')
