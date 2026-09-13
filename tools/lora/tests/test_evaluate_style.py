from __future__ import annotations

import json

import pytest

from tools.lora.evaluate_style import evaluate_rows, generate_openai, score_outputs, write_report


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
