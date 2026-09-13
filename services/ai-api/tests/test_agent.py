from fastapi.testclient import TestClient

from app.config import Settings
from app.gateway import make_rule_tools
from app.main import create_app
from app.rules import RollEvidence, canonical_rule_result


class FakeRuleGateway:
    rag_ready = False

    async def resolve_rules(self, action: str, seed: str, turn_id: str):
        evidence = RollEvidence(
            tool="skill_check",
            notation="1d20+3",
            rolls=[14],
            modifier=3,
            total=17,
            target=12,
            succeeded=True,
        )
        return canonical_rule_result([evidence], "依据骰点 14，检定成功。")


class NoToolRuleGateway(FakeRuleGateway):
    async def resolve_rules(self, action: str, seed: str, turn_id: str):
        return canonical_rule_result([], "模型自行宣称检定成功")


def _settings(tmp_path):
    return Settings(database_url=f"sqlite:///{tmp_path / 'api.db'}", _env_file=None)


def test_rule_tools_keep_seed_and_turn_id_out_of_llm_schema():
    tools = make_rule_tools("private-seed", "turn-7", [])

    schemas = {item.name: set(item.args) for item in tools}
    assert schemas == {
        "roll_dice": {"notation"},
        "run_skill_check": {"attribute", "difficulty", "sides"},
    }


def test_agent_endpoint_separates_resolution_evidence_and_explanation(tmp_path):
    with TestClient(
        create_app(settings=_settings(tmp_path), gateway=FakeRuleGateway())
    ) as client:
        response = client.post(
            "/v1/agent/rules",
            json={"action": "撬锁", "seed": "campaign", "turn_id": "turn-7"},
        )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "resolved"
    assert body["evidence"][0]["total"] == 17
    assert "结果为成功" in body["resolution"]
    assert body["explanation"] == "依据骰点 14，检定成功。"


def test_agent_without_executed_tool_cannot_claim_success(tmp_path):
    with TestClient(
        create_app(settings=_settings(tmp_path), gateway=NoToolRuleGateway())
    ) as client:
        response = client.post(
            "/v1/agent/rules",
            json={"action": "撬锁", "seed": "campaign", "turn_id": "turn-8"},
        )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "undecided"
    assert body["evidence"] == []
    assert "成功" not in body["resolution"]
    assert "模型自行宣称" not in body["explanation"]
