"""OpenRouter(OpenAI 호환) 클라이언트. 호출마다 토큰·비용을 누적해 예산 판단에 쓴다.

OpenRouter는 같은 오픈웨이트 가중치를 올려 둔 여러 추론 제공자에게 요청을 넘겨준다(= 남의 서버를 빌린 온프레미스).
기본으로 데이터를 저장·학습하지 않는(ZDR) 제공자만 쓰고, fp4 이하로 줄인 가중치는 피한다.
끄려면 DIGGER_ZDR=0."""

from __future__ import annotations

import asyncio
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from openai import APIError, AsyncOpenAI

from . import audit
from .config import OPENROUTER_URL, secret

# 제공자 고르기: 데이터 비저장 + 양자화 하한 (같은 모델이라도 제공자마다 정밀도가 달라 비교가 흔들린다)
PROVIDER = {"data_collection": "deny", "zdr": True,
            "quantizations": ["bf16", "fp16", "fp8", "int8", "fp32", "unknown"]} if os.environ.get("DIGGER_ZDR", "1") != "0" else None


@dataclass
class Usage:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    by_model: dict[str, float] = field(default_factory=dict)


class LLM:
    def __init__(self) -> None:
        self.client = AsyncOpenAI(
            base_url=OPENROUTER_URL,
            api_key=secret("openrouter_api_key", "OPENROUTER_API_KEY"),
            default_headers={"X-Title": "Digging Agent (MVP)"},
            timeout=180,
        )
        self.usage = Usage()

    async def chat(self, model: str, messages: list[dict[str, Any]], *, role: str,
                   tools: list[dict[str, Any]] | None = None, json_mode: bool = False,
                   temperature: float = 0.3, max_tokens: int = 4000, reasoning: bool | None = None) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature,
                                  "max_tokens": max_tokens, "extra_body": {"usage": {"include": True}}}
        if PROVIDER and not model.startswith(("anthropic/", "openai/", "google/gemini")):
            kwargs["extra_body"]["provider"] = PROVIDER
        if tools:
            kwargs["tools"] = tools
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if reasoning is not None:  # 생각 과정이 토큰 한도를 다 쓰고 본문이 비는 것을 막을 때 끈다
            kwargs["extra_body"]["reasoning"] = {"enabled": reasoning}
        started = time.monotonic()
        for attempt in range(1, 4):
            try:
                r = await self.client.chat.completions.create(**kwargs)
                if not r.choices:
                    raise APIError("빈 응답", request=None, body=None)  # type: ignore[arg-type]
                break
            except APIError as e:
                audit.emit("llm_error", role=role, model=model, attempt=attempt, error=str(e)[:300])
                if attempt == 3:
                    raise
                await asyncio.sleep(2 ** attempt)
        u = r.usage
        cost = float(getattr(u, "cost", 0) or (u.model_extra or {}).get("cost", 0) or 0) if u else 0.0
        self.usage.calls += 1
        self.usage.prompt_tokens += u.prompt_tokens if u else 0
        self.usage.completion_tokens += u.completion_tokens if u else 0
        self.usage.cost_usd += cost
        self.usage.by_model[model] = self.usage.by_model.get(model, 0) + cost
        audit.emit("llm", role=role, model=model, provider=(r.model_extra or {}).get("provider"), ms=round((time.monotonic() - started) * 1000),
                   prompt_tokens=u.prompt_tokens if u else None, completion_tokens=u.completion_tokens if u else None,
                   cost_usd=round(cost, 6))
        msg = r.choices[0].message.model_dump()
        if msg.get("content"):
            msg["content"] = strip_thinking(msg["content"])
        return msg


# 일부 오픈웨이트 모델(Gemma 등)은 생각 과정 표시를 본문에 섞어 보낸다: <|channel>thought … <channel|>, <think>…</think>
_THINK = re.compile(r"<\|?channel\|?>.*?<\|?channel\|?>|<think>.*?</think>|^\s*<\|?channel\|?>\w*", re.S)


def strip_thinking(text: str) -> str:
    return _THINK.sub("", text).strip()
