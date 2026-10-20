"""감사로그와 실행 이벤트.

모든 도구 호출·LLM 호출·검수 판정을 logs/YYYY-MM-DD.jsonl에 남긴다(12주차 감사로그).
같은 이벤트를 구독자(웹앱 SSE)에게도 흘려보내, '지금 디깅 중' 화면이 실시간으로 그려지게 한다.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from typing import Any, Callable

from .config import LOGS

Listener = Callable[[dict[str, Any]], None]
_listeners: list[Listener] = []


def subscribe(fn: Listener) -> Callable[[], None]:
    _listeners.append(fn)
    return lambda: _listeners.remove(fn)


def emit(kind: str, **fields: Any) -> dict[str, Any]:
    event = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "kind": kind, **fields}
    try:
        LOGS.mkdir(parents=True, exist_ok=True)
        with (LOGS / f"{date.today().isoformat()}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
    except OSError as e:  # 로그 실패가 디깅 실패가 되면 안 된다
        print(f"[audit] 기록 실패: {e}", file=sys.stderr)
    for fn in list(_listeners):
        try:
            fn(event)
        except Exception:
            pass
    return event
