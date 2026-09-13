import pytest

from app.rules import canonical_rule_result, roll_for, roll_notation, skill_check


def test_roll_for_matches_typescript_vectors():
    assert roll_for("br-test", "t-3", 20) == 17
    assert roll_for("bench", "base-rule-0-0:check:3:12", 20) == 20
    assert roll_for("种子", "回合-一:1d100:0", 100) == 56
    assert roll_for("emoji-🎲", "turn-1", 6) == 2


def test_same_turn_replays_same_evidence():
    first = roll_notation("2d6+3", "seed", "turn-7")
    assert first == roll_notation("2d6+3", "seed", "turn-7")


def test_roll_notation_uses_same_raw_expression_key_as_typescript():
    evidence = roll_notation("2D6 + 3", "seed", "turn-9")

    assert evidence.rolls == [2, 1]
    assert evidence.modifier == 3
    assert evidence.total == 6


def test_program_resolution_rejects_hallucinated_numbers():
    evidence = skill_check(3, 12, 20, "seed", "turn-7")
    result = canonical_rule_result([evidence], "我掷出了 999 点并自动成功")

    assert str(evidence.total) in result.resolution
    assert "999" not in result.resolution
    assert "999" not in result.explanation
    assert result.evidence == [evidence]


def test_no_tool_evidence_stays_undecided():
    result = canonical_rule_result([], "检定成功")

    assert result.status == "undecided"
    assert "成功" not in result.resolution
    assert "检定成功" not in result.explanation


@pytest.mark.parametrize("notation", ["0d6", "21d6", "1d1", "1d1001", "2d6++1"])
def test_roll_notation_rejects_invalid_or_unbounded_dice(notation):
    with pytest.raises(ValueError):
        roll_notation(notation, "seed", "turn-1")
