from __future__ import annotations

import json
import sys

import pytest

from tools.lora.evaluate_style import (
    evaluate_rows,
    generate_openai,
    main,
    score_outputs,
    write_report,
)


def test_score_outputs_reports_deterministic_style_rates():
    outputs = [
        "你听见门轴发出细响。" + "潮湿的冷风沿着石墙钻进来。" * 4 + "你要怎么做？",
        "调查员掷出了18点，检定成功。接下来怎么办？",
    ]

    metrics = score_outputs(outputs)

    assert metrics.second_person_rate == 0.5
    assert metrics.action_hook_rate == 0.5
    assert metrics.illegal_roll_rate == 0.5
    assert metrics.length_pass_rate == 0.5


def test_score_outputs_returns_zero_rates_for_empty_input():
    metrics = score_outputs([])

    assert metrics.second_person_rate == 0.0
    assert metrics.action_hook_rate == 0.0
    assert metrics.illegal_roll_rate == 0.0
    assert metrics.length_pass_rate == 0.0


@pytest.mark.parametrize(
    "output",
    [
        "你投出了18点，判定通过。",
        "你掷出D100，检定失败。",
        "你掷了18点，门锁没有发出声音。",
        "调查员掷出了07点，检定成功。",
        "检定成功，你发现窗框上的划痕。",
        "判定通过，你看清了纸上的字迹。",
        "判定失败，你踩响了门后的机关。",
        "你的侦查检定结果为成功，可以看清脚印。",
        "如果你愿意，可以观察。检定成功，你发现墙后的暗门。",
        "如果你愿意，可以观察；检定成功，你发现墙后的暗门。",
    ],
)
def test_illegal_roll_detects_declared_player_rolls(output):
    assert score_outputs([output]).illegal_roll_rate == 1.0


@pytest.mark.parametrize(
    "output",
    [
        "若你的侦查检定成功，你会注意到窗框上的划痕。",
        "如果调查员检定失败，可以改为询问守卫。",
        "当检定成功时，再向玩家公开墙后的声响。",
        "侦查检定成功时，你会注意到窗框上的划痕。",
        "检定失败的话，你仍可以询问守卫。",
        "只要你的侦查检定成功，就能看清地面的脚印。",
        "如果你仔细观察，检定成功，就能发现脚印。",
        "如果你仔细观察、检定成功，就能发现脚印。",
        "只要你做好准备，检定成功便能发现机关。",
        "侦查检定成功以后，你会注意到窗框上的划痕。",
        "守卫把飞刀掷出了窗外，随即转身逃走。",
        "你看见守卫掷出18点，随即收起骰子。",
        "你听见守卫掷出18点，骰子撞上木桌。",
        "你发现守卫掷出18点，随后拿走了骰子。",
        "你注意到守卫掷出18点，却没有宣布结果。",
    ],
)
def test_illegal_roll_ignores_conditional_advice_and_non_player_throws(output):
    assert score_outputs([output]).illegal_roll_rate == 0.0


def test_evaluate_rows_preserves_source_fields_and_raw_output():
    rows = [
        {
            "prompt": "描述封闭的档案室。",
            "reference_output": "参考答案",
            "source": "human-authored",
            "group": "seed:human:1",
        }
    ]

    report = evaluate_rows(rows, lambda prompt: f"你面对{prompt}，门缝里透出一道冷光。你要怎么做？")

    assert report["sample_count"] == 1
    assert report["samples"] == [
        {
            "index": 1,
            "prompt": "描述封闭的档案室。",
            "reference_output": "参考答案",
            "source": "human-authored",
            "group": "seed:human:1",
            "output": "你面对描述封闭的档案室。，门缝里透出一道冷光。你要怎么做？",
        }
    ]
    assert report["metrics"]["action_hook_rate"] == 1.0


def test_evaluate_rows_rejects_missing_prompt_before_generation():
    called = False

    def generate(_: str) -> str:
        nonlocal called
        called = True
        return "不会执行"

    with pytest.raises(ValueError, match="prompt"):
        evaluate_rows([{"prompt": "   "}], generate)

    assert called is False


def test_generate_openai_calls_chat_completions_and_returns_message():
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def read(self):
            return json.dumps(
                {"choices": [{"message": {"content": "你看见一扇门。你要怎么做？"}}]},
                ensure_ascii=False,
            ).encode("utf-8")

    def open_request(request, timeout):
        assert request.full_url == "http://localhost:8000/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-key"
        assert timeout == 12.0
        body = json.loads(request.data.decode("utf-8"))
        assert body == {
            "model": "qwen-test",
            "messages": [{"role": "user", "content": "描述门后的动静。"}],
            "temperature": 0.0,
        }
        return Response()

    output = generate_openai(
        "描述门后的动静。",
        base_url="http://localhost:8000/v1/",
        model="qwen-test",
        api_key="test-key",
        timeout=12.0,
        opener=open_request,
    )

    assert output == "你看见一扇门。你要怎么做？"


def test_write_report_keeps_raw_outputs_in_json_and_markdown(tmp_path):
    report = {
        "sample_count": 1,
        "metrics": {
            "second_person_rate": 1.0,
            "action_hook_rate": 1.0,
            "illegal_roll_rate": 0.0,
            "length_pass_rate": 0.0,
        },
        "samples": [
            {
                "index": 1,
                "prompt": "描述房间。",
                "reference_output": "参考文本",
                "source": "synthetic-template",
                "group": "demo:room:1",
                "output": "你看见空房间。你要怎么做？",
            }
        ],
    }
    prefix = tmp_path / "report-style-test"

    write_report(
        report,
        prefix,
        mode="test",
        model="qwen-test",
        base_url="http://localhost:8000/v1",
        data_path="test.prompts.jsonl",
    )

    written_json = json.loads(prefix.with_suffix(".json").read_text(encoding="utf-8"))
    written_markdown = prefix.with_suffix(".md").read_text(encoding="utf-8")
    assert written_json["run"]["mode"] == "test"
    assert written_json["run"]["model"] == "qwen-test"
    assert written_json["run"]["base_url"] == "http://localhost:8000/v1"
    assert written_json["samples"][0]["output"] == "你看见空房间。你要怎么做？"
    assert "你看见空房间。你要怎么做？" in written_markdown


def test_cli_rejects_empty_test_data_without_writing_reports(tmp_path, monkeypatch):
    data_path = tmp_path / "test.prompts.jsonl"
    data_path.write_text("", encoding="utf-8")
    out_prefix = tmp_path / "report-style-empty"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "evaluate_style.py",
            "--data",
            str(data_path),
            "--mode",
            "base",
            "--out",
            str(out_prefix),
            "--base-url",
            "http://localhost:8000/v1",
            "--model",
            "qwen-test",
        ],
    )

    with pytest.raises(ValueError, match="测试数据不能为空"):
        main()

    assert not out_prefix.with_suffix(".json").exists()
    assert not out_prefix.with_suffix(".md").exists()
