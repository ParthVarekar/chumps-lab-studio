"""Show which OpenRouter key the studio will use and its limits. Prints no secrets, sends no model request.

Run:  uv run python -m cls_sidecar.key_check
"""

import json

from cls_sidecar.gateway import OpenRouterGateway


def main() -> None:
    gw = OpenRouterGateway()
    info = gw.key_info()
    print("key source:", gw.key_source)
    print(json.dumps({k: info.get(k) for k in ("label", "is_free_tier", "limit", "limit_remaining", "usage_daily", "free_model_daily_requests")}, indent=1))


if __name__ == "__main__":
    main()
