"""radicals.json の読み込みと検索。

フロントエンドの frontend/data/radicals.json を唯一の正とし、
バックエンドはそれをリポジトリ相対パスで直接読み込む（コピーを作らない）。
"""
import json
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[2] / "frontend" / "data" / "radicals.json"

ALL_GRADES = ["1", "2", "3", "4", "5", "6", "8"]
GRADE_SETS = {
    "low": ["1", "2", "3"],
    "elem": ["1", "2", "3", "4", "5", "6"],
    "all": ALL_GRADES,
}


@lru_cache
def load() -> dict:
    with DATA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def grades_for(level: str) -> list[str]:
    return GRADE_SETS[level]


def radicals() -> dict:
    return load()["radicals"]


def pool_of(radical: str, grades: list[str]) -> list[str]:
    entry = radicals().get(radical)
    if not entry:
        return []
    out: list[str] = []
    for g in grades:
        out.extend(entry["kanji"].get(g, []))
    return out


def kanji_grade(kanji: str) -> int | None:
    entry = load()["kanji"].get(kanji)
    return entry["grade"] if entry else None


GRADE_LABEL = {1: "小1", 2: "小2", 3: "小3", 4: "小4", 5: "小5", 6: "小6", 8: "中学以降"}
