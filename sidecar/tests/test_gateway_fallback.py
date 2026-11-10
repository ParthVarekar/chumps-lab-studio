"""The planner prefers Inkling 2 Small (free). Its free endpoint often answers 403 "only available on agentic harnesses" to API clients;
the gateway must then re-send the SAME request on the backup, leave Inkling alone for a while, and try it again afterwards."""
import time

from cls_sidecar import gateway
from cls_sidecar.gateway import PLANNER_BACKUP, PLANNER_FREE, OpenRouterGateway


class FakeResp:
    def __init__(self, status: int, data: dict):
        self.status_code, self._data, self.headers, self.text = status, data, {}, str(data)

    def json(self):
        return self._data


REFUSED = FakeResp(403, {"error": {"code": 403, "message": f"{PLANNER_FREE} is only available on agentic harnesses. Try plugging it into a coding agent."}})
OK = FakeResp(200, {"choices": [{"message": {"content": "{}"}}], "usage": {}})


def make(responses):
    seen: list[str] = []

    class Client:
        def post(self, path, json):
            seen.append(json["model"])
            return responses(json["model"])

    gw = OpenRouterGateway.__new__(OpenRouterGateway)
    gw._client = Client()
    gw.max_retries = 3
    gw._log = lambda entry: None
    return gw, seen


def test_planner_is_inkling_and_has_a_backup():
    assert PLANNER_FREE == "thinkingmachines/inkling-2-small:free"
    assert gateway.ULTRA_FREE == PLANNER_FREE  # old name still imports
    assert gateway.FALLBACKS[PLANNER_FREE] == PLANNER_BACKUP


def test_a_403_is_retried_on_the_backup_and_inkling_is_left_alone_for_a_while(monkeypatch):
    monkeypatch.setattr(gateway, "_restricted_until", {})
    gw, seen = make(lambda model: REFUSED if model == PLANNER_FREE else OK)
    assert gw._post("/chat/completions", {"model": PLANNER_FREE, "messages": []}) is OK.json()
    assert seen == [PLANNER_FREE, PLANNER_BACKUP], "refused once, then the same request went to the backup"
    gw._post("/chat/completions", {"model": PLANNER_FREE, "messages": []})
    assert seen[2:] == [PLANNER_BACKUP], "within the cooldown Inkling is not asked again"


def test_a_picture_job_names_its_own_backup(monkeypatch):
    """The reviewer sends images: if Inkling refuses, the same request must go to a vision model, not the planner's text backup."""
    monkeypatch.setattr(gateway, "_restricted_until", {})
    gw, seen = make(lambda model: REFUSED if model == PLANNER_FREE else OK)
    gw._post("/chat/completions", {"model": PLANNER_FREE, "messages": [], "fallback_model": gateway.SUPER_VL_FREE})
    assert seen == [PLANNER_FREE, gateway.SUPER_VL_FREE]
    gw2, seen2 = make(lambda model: OK)
    gw2._post("/chat/completions", {"model": PLANNER_FREE, "messages": [], "fallback_model": gateway.SUPER_VL_FREE})
    assert "fallback_model" not in str(seen2), "the private hint never goes to OpenRouter"


def test_the_cooldown_is_a_minute():
    assert gateway.RESTRICTED_FOR_S == 60


def test_inkling_is_tried_again_after_the_cooldown(monkeypatch):
    monkeypatch.setattr(gateway, "_restricted_until", {PLANNER_FREE: time.time() - 1})
    gw, seen = make(lambda model: OK)
    gw._post("/chat/completions", {"model": PLANNER_FREE, "messages": []})
    assert seen == [PLANNER_FREE], "once the cooldown has passed it goes to Inkling first"


def test_other_errors_and_other_models_are_not_rerouted(monkeypatch):
    monkeypatch.setattr(gateway, "_restricted_until", {})
    gw, seen = make(lambda model: FakeResp(403, {"error": {"code": 403, "message": "bad key"}}))
    try:
        gw._post("/chat/completions", {"model": PLANNER_FREE, "messages": []})
        raise AssertionError("a 403 that is not the harness refusal must still raise")
    except gateway.GatewayError:
        pass
    assert seen == [PLANNER_FREE]
    gw2, seen2 = make(lambda model: REFUSED)
    try:
        gw2._post("/chat/completions", {"model": "nvidia/nemotron-3.5-super-vl:free", "messages": []})
    except gateway.GatewayError:
        pass
    assert seen2 == ["nvidia/nemotron-3.5-super-vl:free"], "only the planner model has a fallback"
