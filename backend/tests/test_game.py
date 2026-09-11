from app import data as gamedata
from app import game as gamerules


def make_state(level="elem"):
    return gamerules.BattleState(level=level, attacker="a", defender="b")


def test_pool_of_respects_grade_range():
    low_pool = gamedata.pool_of("氵", gamedata.GRADE_SETS["low"])
    all_pool = gamedata.pool_of("氵", gamedata.ALL_GRADES)
    assert "海" in low_pool  # 小2
    assert "汁" not in low_pool  # 中学以降
    assert "汁" in all_pool


def test_is_valid_answer_ok():
    state = make_state(level="elem")
    ok, reason = gamerules.is_valid_answer(state, "氵", "海")
    assert ok is True
    assert reason is None


def test_is_valid_answer_rejects_already_used():
    state = make_state(level="elem")
    state.used.add("海")
    ok, reason = gamerules.is_valid_answer(state, "氵", "海")
    assert ok is False
    assert reason == "used"


def test_is_valid_answer_accepts_kanji_above_chosen_level():
    # 難易度は出題する部首の絞り込みにのみ使う。答えの学年は問わない。
    state = make_state(level="low")  # 小1〜小3のみ
    ok, reason = gamerules.is_valid_answer(state, "氵", "汁")  # 中学以降
    assert ok is True
    assert reason is None


def test_is_valid_answer_rejects_wrong_radical():
    state = make_state(level="all")
    assert "犬" not in gamedata.pool_of("氵", gamedata.ALL_GRADES), (
        "テストの前提が崩れている: 犬が氵の対象漢字に含まれていないことを確認すること"
    )
    ok, reason = gamerules.is_valid_answer(state, "氵", "犬")
    assert ok is False
    assert reason == "not_in_radical"


def test_apply_answer_swaps_turn_and_records_used():
    state = make_state(level="elem")
    state.current_radical = "氵"
    gamerules.apply_answer(state, "海", "b")

    assert state.attacker == "b"
    assert state.defender == "a"
    assert "海" in state.used
    assert state.used_log == [("海", "b")]
    assert state.current_radical is None
    assert state.recent_radicals == ["氵"]


def test_recent_radicals_keeps_only_last_two():
    state = make_state(level="elem")
    for radical, kanji in [("氵", "海"), ("木", "森"), ("火", "炎")]:
        state.current_radical = radical
        gamerules.apply_answer(state, kanji, "b")
    assert state.recent_radicals == ["木", "火"]


def test_offer_radicals_returns_at_most_five_valid_choices():
    state = make_state(level="all")
    choices = gamerules.offer_radicals(state)
    assert 0 < len(choices) <= gamerules.RADICAL_CHOICES
    assert len(choices) == len(set(choices))  # 重複なし
    for r in choices:
        pool = gamedata.pool_of(r, gamedata.grades_for(state.level))
        assert any(k not in state.used for k in pool)
    assert state.last_offer == choices


def test_offer_radicals_avoids_recent_when_alternatives_exist():
    state = make_state(level="all")
    all_candidates = gamerules.available_radicals(state)
    assert len(all_candidates) > 5  # 前提: 選択肢を除外しても十分な代替がある

    avoided = all_candidates[0]
    state.recent_radicals = [avoided]
    choices = gamerules.offer_radicals(state)
    assert avoided not in choices


def test_reveal_splits_used_and_unused():
    state = make_state(level="elem")
    state.used.add("海")
    result = gamerules.reveal(state, "氵")

    pool = gamedata.pool_of("氵", gamedata.ALL_GRADES)
    assert result["radical"] == "氵"
    assert "海" in result["got"]
    assert "海" not in result["unused"]
    assert sorted(result["got"] + result["unused"]) == sorted(pool)
