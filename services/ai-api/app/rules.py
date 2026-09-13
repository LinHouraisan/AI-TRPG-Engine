import re
from typing import Literal

from pydantic import BaseModel


class RollEvidence(BaseModel):
    tool: Literal["roll_dice", "skill_check"]
    notation: str
    rolls: list[int]
    modifier: int = 0
    total: int
    target: int | None = None
    succeeded: bool | None = None


class RuleResolution(BaseModel):
    status: Literal["resolved", "undecided"]
    resolution: str
    evidence: list[RollEvidence]
    explanation: str


def _utf16_units(text: str):
    raw = text.encode("utf-16-le", "surrogatepass")
    for offset in range(0, len(raw), 2):
        yield int.from_bytes(raw[offset : offset + 2], "little")


def _hash_text(text: str) -> int:
    value = 2166136261
    for unit in _utf16_units(text):
        value ^= unit
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _mulberry32_once(seed: int) -> float:
    value = (seed + 0x6D2B79F5) & 0xFFFFFFFF
    first = ((value ^ (value >> 15)) * (1 | value)) & 0xFFFFFFFF
    product = ((first ^ (first >> 7)) * (61 | first)) & 0xFFFFFFFF
    mixed = ((first + product) & 0xFFFFFFFF) ^ first
    mixed ^= mixed >> 14
    return (mixed & 0xFFFFFFFF) / 4294967296


def roll_for(seed: str, turn_id: str, sides: int) -> int:
    if not 2 <= sides <= 1000:
        raise ValueError("骰子面数必须在 2 到 1000 之间")
    value = _mulberry32_once(_hash_text(f"{seed}:{turn_id}"))
    return 1 + int(value * sides)


_NOTATION = re.compile(
    r"^(?P<count>\d+)d(?P<sides>\d+)\s*(?P<modifier>[+-]\s*\d+)?$",
    re.IGNORECASE,
)


def roll_notation(notation: str, seed: str, turn_id: str) -> RollEvidence:
    match = _NOTATION.fullmatch(notation.strip())
    if not match:
        raise ValueError("骰子表达式必须类似 2d6+3")
    count = int(match.group("count"))
    sides = int(match.group("sides"))
    modifier = int((match.group("modifier") or "0").replace(" ", ""))
    if not 1 <= count <= 20:
        raise ValueError("骰子数量必须在 1 到 20 之间")
    if not 2 <= sides <= 1000:
        raise ValueError("骰子面数必须在 2 到 1000 之间")

    rolls = [roll_for(seed, f"{turn_id}:{notation}:{index}", sides) for index in range(count)]
    return RollEvidence(
        tool="roll_dice",
        notation=notation,
        rolls=rolls,
        modifier=modifier,
        total=sum(rolls) + modifier,
    )


def skill_check(
    attribute: int,
    difficulty: int,
    sides: int,
    seed: str,
    turn_id: str,
) -> RollEvidence:
    roll = roll_for(seed, f"{turn_id}:check:{attribute}:{difficulty}", sides)
    total = roll + attribute
    return RollEvidence(
        tool="skill_check",
        notation=f"1d{sides}+{attribute}",
        rolls=[roll],
        modifier=attribute,
        total=total,
        target=difficulty,
        succeeded=total >= difficulty,
    )


def _canonical_text(evidence: list[RollEvidence]) -> str:
    parts: list[str] = []
    for item in evidence:
        rolls = "+".join(str(value) for value in item.rolls)
        if item.tool == "skill_check":
            outcome = "成功" if item.succeeded else "失败"
            parts.append(
                f"技能检定 {item.notation}：骰点 {rolls}，合计 {item.total}，"
                f"难度 {item.target}，结果为{outcome}。"
            )
        else:
            parts.append(f"掷骰 {item.notation}：骰点 {rolls}，合计 {item.total}。")
    return " ".join(parts)


def _safe_explanation(candidate: str, evidence: list[RollEvidence], fallback: str) -> str:
    allowed_numbers: set[int] = set()
    expected_outcomes: set[str] = set()
    for item in evidence:
        allowed_numbers.update(item.rolls)
        allowed_numbers.update((item.modifier, item.total))
        if item.target is not None:
            allowed_numbers.add(item.target)
        if item.succeeded is not None:
            expected_outcomes.add("成功" if item.succeeded else "失败")

    mentioned = {int(value) for value in re.findall(r"\d+", candidate)}
    has_wrong_number = not mentioned.issubset(allowed_numbers)
    has_wrong_outcome = any(
        word in candidate and word not in expected_outcomes for word in ("成功", "失败")
    )
    return fallback if not candidate.strip() or has_wrong_number or has_wrong_outcome else candidate.strip()


def canonical_rule_result(
    evidence: list[RollEvidence], candidate_explanation: str
) -> RuleResolution:
    if not evidence:
        undecided = "未执行规则工具，无法判定结果。"
        return RuleResolution(
            status="undecided",
            resolution=undecided,
            evidence=[],
            explanation=undecided,
        )

    resolution = _canonical_text(evidence)
    return RuleResolution(
        status="resolved",
        resolution=resolution,
        evidence=evidence,
        explanation=_safe_explanation(candidate_explanation, evidence, resolution),
    )
