from __future__ import annotations

import re
import unicodedata
from typing import Any

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class ToolFailure(Exception):
    """모델에게 그대로 보여줄 수 있는, 원인이 구체적인 실패."""


def clean_text(value: Any, limit: int = 200) -> str | None:
    """외부 자유 텍스트를 데이터로만 쓰기 위한 최소 정리."""
    if value is None:
        return None
    text = _CONTROL_RE.sub(" ", str(value)).strip()
    return (text[:limit] + "…") if len(text) > limit else (text or None)


def norm_name(name: str) -> str:
    return re.sub(r"[\s\W_]+", "", unicodedata.normalize("NFKC", name or "")).casefold()
