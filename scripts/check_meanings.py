# scripts/kanji-meanings.json（漢字の意味。人手で書いたもの）を検査する。
#
# 意味は人が書く唯一のデータなので、書いたあとに必ずこれを通す。
# 外部ソース（kanjidic2.xml）が必要。build_dict.py と同じ場所に置いてから実行する。
#
#   .venv/bin/python scripts/check_meanings.py
#
# 見ているのは4点:
#   1. 対象の1542字に過不足がないか
#   2. その字を習う学年の子が読めない漢字を説明に使っていないか
#      （初級=小3まで、中級=小6まで、上級=制限なし。上級も常用漢字の範囲に収める）
#   3. 訓読みをなぞるだけの説明になっていないか
#      （意味の欄のすぐ下に訓読みが出るので、それでは情報が増えない）
#   4. 日本語以外の文字がまぎれこんでいないか
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path(__file__).resolve().parent / 'sources'

radicals = json.load(open(ROOT / 'frontend' / 'data' / 'radicals.json', encoding='utf-8'))
dic = json.load(open(ROOT / 'frontend' / 'data' / 'kanji-dict.json', encoding='utf-8'))['kanji']
meanings = json.load(open(Path(__file__).resolve().parent / 'kanji-meanings.json', encoding='utf-8'))

grade_of = {}
for c in ET.parse(SOURCE_DIR / 'kanjidic2.xml').getroot().findall('character'):
    g = c.find('misc/grade')
    if g is not None:
        grade_of[c.find('literal').text] = int(g.text)

# その字を習う学年 -> 説明に使ってよい漢字の上限学年（8＝中学以降は制限なし）
LIMIT = {1: 3, 2: 3, 3: 3, 4: 6, 5: 6, 6: 6, 8: 8}
KANJI = re.compile(r'[一-龥𠮟]')


def label(grade):
    return '中学以降' if grade == 8 else f'小{grade}'


OK_CHARS = re.compile(r'[ぁ-んァ-ヴ一-龥々ー、。・…「」]')

problems = []

# 1. 過不足
target = set(radicals['kanji'])
for k in sorted(target - set(meanings)):
    problems.append(f'{k}: 意味が書かれていない')
for k in sorted(set(meanings) - target):
    problems.append(f'{k}: 対象外の字の意味が書かれている')

for k, text in meanings.items():
    if k not in radicals['kanji']:
        continue
    # 2. 読めない漢字を説明に使っていないか
    limit = LIMIT[radicals['kanji'][k]['grade']]
    for ch in text:
        if not KANJI.match(ch):
            continue
        g = grade_of.get(ch)
        if g is None:
            problems.append(f'{k}「{text}」: 常用漢字でない「{ch}」を使っている')
        elif g > limit:
            problems.append(f'{k}「{text}」: {label(g)}で習う「{ch}」を使っている'
                            f'（この字の説明は{label(limit)}まで）')

    # 3. 訓読みのなぞりになっていないか
    parts = [p for p in re.split(r'[。、]', text) if p]
    stems = {r.replace('-', '').split('.')[0] for r in dic[k]['kun']} - {''}
    if len(parts) == 1 and any(parts[0].startswith(s) for s in stems):
        problems.append(f'{k}「{text}」: 訓読みをなぞっただけで、訓読み欄と重なる')

    # 4. 日本語以外の文字
    for ch in text:
        if not OK_CHARS.match(ch):
            problems.append(f'{k}「{text}」: 使えない文字「{ch}」がまじっている')

if problems:
    print(f'問題 {len(problems)}件:')
    for p in problems:
        print(' ', p)
    sys.exit(1)

lengths = [len(v) for v in meanings.values()]
print(f'問題なし。{len(meanings)}字 / 長さ 最短{min(lengths)}・最長{max(lengths)}・'
      f'平均{sum(lengths) / len(lengths):.1f}')
