"""Model gateway: one place that talks to OpenRouter (and later NVIDIA / local llama.cpp).

Design points from the blueprint (Section 4.3):
- The OpenRouter free tier limits *requests* (20/min, 50 or 1,000/day), so callers batch work.
- Nemotron 3 Ultra's free endpoint has no `response_format`, so structured output uses one
  forced tool call whose parameters are a JSON Schema (`call_tool_json`).
- Every request is logged (metadata only, never prompt text or the API key) to
  D:\\ChumpsLabStudio\\logs\\llm-requests.jsonl, so request and token budgets can be measured.
"""

from __future__ import annotations

import json
import os
import random
import time
from pathlib import Path
from typing import Any

import httpx

from cls_sidecar.paths import STUDIO_ROOT

BASE_URL = "https://openrouter.ai/api/v1"
# The planner model (forced tool calls + a reasoning budget). Inkling 2 Small (thinkingmachines/inkling-2-small:free) was tried in its place on
# 10 Nov 2026 but its free endpoint often answers HTTP 403 "only available on agentic harnesses" to API clients, so planning stays on Nemotron 3 Ultra.
PLANNER_FREE = "nvidia/nemotron-3-ultra-550b-a55b:free"
ULTRA_FREE = PLANNER_FREE  # old name, kept so older scripts still import
SUPER_VL_FREE = "nvidia/nemotron-3.5-super-vl:free"
LOG_PATH = STUDIO_ROOT / "logs" / "llm-requests.jsonl"

RETRY_STATUS = {408, 429, 500, 502, 503, 504}


class GatewayError(RuntimeError):
    pass


PROJECT_ROOT = Path(__file__).resolve().parents[3]
PROJECT_KEY_VAR = "CLS_OPENROUTER_API_KEY"


def _read_dotenv(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE reader for the repo-root .env (git-ignored)."""
    out: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve_api_key() -> tuple[str | None, str]:
    """This project's own key wins over the machine-wide one.

    Order: CLS_OPENROUTER_API_KEY env var → CLS_OPENROUTER_API_KEY in <repo>/.env → OPENROUTER_API_KEY env var.
    Returns (key, source) — the source is safe to print, the key is not.
    """
    if os.environ.get(PROJECT_KEY_VAR):
        return os.environ[PROJECT_KEY_VAR], f"{PROJECT_KEY_VAR} environment variable"
    dotenv = _read_dotenv(PROJECT_ROOT / ".env")
    if dotenv.get(PROJECT_KEY_VAR):
        return dotenv[PROJECT_KEY_VAR], f"{PROJECT_KEY_VAR} in {PROJECT_ROOT / '.env'}"
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"], "OPENROUTER_API_KEY environment variable (shared key)"
    return None, "none"


class OpenRouterGateway:
    def __init__(self, api_key: str | None = None, timeout_s: float = 600.0, max_retries: int = 4):
        key, self.key_source = (api_key, "argument") if api_key else resolve_api_key()
        if not key:
            raise GatewayError(f"No OpenRouter key: set {PROJECT_KEY_VAR} (or add it to {PROJECT_ROOT / '.env'})")
        self._client = httpx.Client(
            base_url=BASE_URL,
            timeout=httpx.Timeout(timeout_s, connect=20.0),
            headers={"Authorization": f"Bearer {key}", "X-Title": "Chumps Lab Studio"},
        )
        self.max_retries = max_retries
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ plumbing
    def _log(self, entry: dict) -> None:
        entry["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def _post(self, path: str, body: dict) -> dict:
        for attempt in range(self.max_retries + 1):
            t0 = time.perf_counter()
            resp = self._client.post(path, json=body)
            latency = round(time.perf_counter() - t0, 2)
            data = _json_or_text(resp)
            usage = data.get("usage", {}) if isinstance(data, dict) else {}
            self._log({
                "path": path, "model": body.get("model"), "status": resp.status_code,
                "attempt": attempt, "latency_s": latency,
                "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
                "provider": data.get("provider") if isinstance(data, dict) else None,
            })
            if resp.status_code == 200 and isinstance(data, dict) and "error" not in data:
                return data
            # OpenRouter sometimes reports an upstream failure (e.g. 504) inside an HTTP 200 body.
            code = resp.status_code
            if isinstance(data, dict) and isinstance(data.get("error"), dict):
                try:
                    code = int(data["error"].get("code") or code)
                except (TypeError, ValueError):
                    pass
            if code in RETRY_STATUS and attempt < self.max_retries:
                wait = float(resp.headers.get("Retry-After") or 0) or (2**attempt * 5 + random.uniform(0, 3))
                time.sleep(min(wait, 120))
                continue
            raise GatewayError(f"{path} failed with HTTP {resp.status_code}: {_short(data)}")
        raise GatewayError("unreachable")

    # ------------------------------------------------------------------ API
    def key_info(self) -> dict:
        """Limits for this key (free-model daily ceiling, credits). Never includes the key itself."""
        resp = self._client.get("/key")
        resp.raise_for_status()
        return resp.json().get("data", {})

    def chat(self, model: str, messages: list[dict], **params: Any) -> dict:
        return self._post("/chat/completions", {"model": model, "messages": messages, **params})

    def call_tool_json(
        self, model: str, messages: list[dict], name: str, schema: dict, description: str = "", **params: Any
    ) -> tuple[dict, dict]:
        """Force the model to answer through one tool call; return (arguments, raw response)."""
        tool = {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}
        body = {"tools": [tool], "tool_choice": {"type": "function", "function": {"name": name}}, **params}
        raw = self.chat(model, messages, **body)
        message = raw["choices"][0]["message"]
        calls = message.get("tool_calls") or []
        if not calls:
            raise GatewayError(f"model returned no tool call (finish_reason={raw['choices'][0].get('finish_reason')})")
        return json.loads(calls[0]["function"]["arguments"]), raw

    def json_schema_chat(self, model: str, messages: list[dict], name: str, schema: dict, **params: Any) -> tuple[dict, dict]:
        """Structured output via response_format (for endpoints that support it, e.g. Super VL free)."""
        fmt = {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}
        raw = self.chat(model, messages, response_format=fmt, **params)
        content = raw["choices"][0]["message"].get("content") or ""
        return json.loads(_strip_fences(content)), raw


def image_part(path: Path, max_side: int = 1600, quality: int = 85) -> dict:
    """An OpenAI-style image content part (base64 JPEG), downscaled so the long side <= max_side."""
    import base64
    import io

    from PIL import Image

    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}


def _json_or_text(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return resp.text[:500]


def _short(data: Any) -> str:
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        meta = err.get("metadata") or {}
        detail = meta.get("raw") or meta.get("reasons") or ""
        return f"{err.get('code')}: {err.get('message')} {str(detail)[:600]}".strip()
    return str(data)[:300]


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    return text.strip()
