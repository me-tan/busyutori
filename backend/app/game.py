"""対戦ルールのロジック。

ネットワークやWebSocketには一切触れない、純粋な関数とデータクラスだけで
構成する。テストしやすくするための意図的な分離（backend/tests/test_game.py）。
"""
import random
from dataclasses import dataclass, field
from typing import Literal

from . import data as gamedata

RADICAL_CHOICES = 5
ANSWER_SECONDS = 20

Level = Literal["low", "elem", "all"]
RejectReason = Literal["used", "out_of_grade", "not_in_radical"]


@dataclass
class BattleState:
    level: Level
    attacker: str
    defender: str
    used: set[str] = field(default_factory=set)
    recent_radicals: list[str] = field(default_factory=list)
    current_radical: str | None = None
    last_offer: list[str] = field(default_factory=list)


def available_radicals(state: BattleState) -> list[str]:
    """まだ1字以上未使用の漢字が残っている部首の一覧。"""
    grades = gamedata.grades_for(state.level)
    out = []
    for r in gamedata.radicals():
        pool = gamedata.pool_of(r, grades)
        if any(k not in state.used for k in pool):
            out.append(r)
    return out


def offer_radicals(state: BattleState) -> list[str]:
    """攻撃側に見せる部首の候補（最大5つ）。直近に投げた部首は避ける。"""
    candidates = available_radicals(state)
    fresh = [r for r in candidates if r not in state.recent_radicals]
    pool = fresh if fresh else candidates
    pool = pool[:]
    random.shuffle(pool)
    choices = pool[:RADICAL_CHOICES]
    state.last_offer = choices
    return choices


def is_valid_answer(state: BattleState, radical: str, kanji: str) -> tuple[bool, RejectReason | None]:
    """サーバー権威の正解判定。(合格か, 不合格なら理由)"""
    grades = gamedata.grades_for(state.level)
    in_range = set(gamedata.pool_of(radical, grades))

    if kanji in in_range:
        if kanji in state.used:
            return False, "used"
        return True, None

    all_pool = set(gamedata.pool_of(radical, gamedata.ALL_GRADES))
    if kanji in all_pool:
        return False, "out_of_grade"
    return False, "not_in_radical"


def apply_answer(state: BattleState, kanji: str) -> None:
    """正解確定後の状態更新。使用済みに追加し、攻守を交代する。"""
    state.used.add(kanji)
    state.attacker, state.defender = state.defender, state.attacker
    if state.current_radical:
        state.recent_radicals.append(state.current_radical)
        if len(state.recent_radicals) > 2:
            state.recent_radicals.pop(0)
    state.current_radical = None


def reveal(state: BattleState, radical: str) -> dict:
    """結果画面用: 指定した部首について使った字・使わなかった字の一覧。"""
    grades = gamedata.grades_for(state.level)
    pool = gamedata.pool_of(radical, grades)
    return {
        "radical": radical,
        "unused": [k for k in pool if k not in state.used],
        "got": [k for k in pool if k in state.used],
    }
