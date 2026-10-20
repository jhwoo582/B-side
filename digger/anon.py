"""개인 데이터 경계 — 손님 데이터를 외부 리서처에게 넘기기 전에, 로컬 모델이 '음악적 방향'으로 바꾼다.

리서처(외부 대형 모델)는 시드 아티스트 이름, 공개 글, 그리고 여기서 만든 방향만 받는다.
대화 원문·반박 문장·취향 노트 원문은 이 경계 밖으로 나가지 않는다.
- 모델: Settings().models.local (온프레미스에 올릴 수 있는 크기, 2026-10-14 벤치에서 개인 사정 유출 0/6)
- 안전장치: 결과에 손님 원문이 12자 이상 그대로 남으면 한 번 더 쓰게 하고, 그래도 남으면 방향을 비운다.
"""

from __future__ import annotations

import json
import re
from typing import Any

from . import audit, taste
from .config import Settings
from .llm import LLM

SYSTEM = """너는 개인정보 경계에 서 있는 로컬 모델이다. 손님이 대화에서 한 말과 취향 메모를 받아,
외부 리서처에게 넘길 '디깅 방향'만 쓴다. 외부로 나가는 글이다.
- 손님의 원래 문장을 옮기지 않는다. 개인 사정(시험·학교·회사·건강·가족·연애·장소·날짜·사람 이름)은 절대 쓰지 않는다.
- 손님이 무엇을 하며 듣는지(공부·일·야근·운동·출퇴근·잠들기 전 등)도 쓰지 않는다. 그 상황이 뜻하는 음악적 특징으로만 바꾼다.
  예: '시험 공부하면서 들을 조용한 거' → '조용하고 가사가 적어 집중을 방해하지 않는 음악'
- 음악적 방향만 남긴다: 에너지(조용/강렬), 분위기, 보컬·사운드·가사 중 무엇을 중시하는지, 피할 것.
  찾는 방법에 대한 요청(예: 평론 말고 아티스트 본인이 한 말로, 더 낯선 쪽으로)도 남긴다.
- 아티스트·앨범·매체 이름은 공개 정보라 남겨도 된다.
JSON 하나만: {"direction": "한두 문장", "avoid": ["피할 것", ...]}"""

MIN_LEAK = 12   # 손님 원문이 이만큼(공백 빼고) 그대로 남으면 샌 것으로 본다


def leaks(text: str, said: list[str]) -> list[str]:
    out = re.sub(r"\s+", "", text)
    hits = []
    for s in said:
        t = re.sub(r"\s+", "", s or "")
        if any(t[i:i + MIN_LEAK] in out for i in range(0, max(0, len(t) - MIN_LEAK + 1))):
            hits.append(s[:30])
    return hits


async def direction(llm: LLM, extra_said: list[str] | None = None) -> dict[str, Any]:
    """손님 데이터 → {direction, avoid}. extra_said = 이번 요청에서 손님이 한 말(반박, 대화)."""
    mem = taste.for_researcher()
    said = [s["said"] for s in mem["signals"] if s.get("said")] + [s for s in (extra_said or []) if s]
    if not said and not mem["taste_notes"]:
        return {"direction": "", "avoid": []}
    payload = {"said_in_chat": said[-8:], "signals": [{"kind": s["kind"], "text": s["text"]} for s in mem["signals"]][-8:],
               "taste_notes": mem["taste_notes"][:6], "summary": mem.get("summary")}
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]
    model = Settings().models.local
    for attempt in range(2):
        msg = await llm.chat(model, messages, role="anon", json_mode=True, temperature=0.2, max_tokens=400, reasoning=False)
        try:
            d = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))  # type: ignore[union-attr]
        except (AttributeError, json.JSONDecodeError):
            continue
        out = {"direction": str(d.get("direction") or "")[:300], "avoid": [str(x)[:60] for x in (d.get("avoid") or [])][:5]}
        hit = leaks(out["direction"] + " " + " ".join(out["avoid"]), said)
        audit.emit("anon", ok=not hit, attempt=attempt + 1, leaked=len(hit))
        if not hit:
            return out
        messages.append({"role": "assistant", "content": msg.get("content") or ""})
        messages.append({"role": "user", "content": "손님 원문이 그대로 남아 있다. 원문 표현과 개인 사정을 빼고 음악적 방향으로만 다시 써라."})
    return {"direction": "", "avoid": []}   # 끝까지 새면 아무것도 내보내지 않는다


async def scrub(llm: LLM, texts: list[str]) -> str:
    """이번 요청에서 손님이 한 말(반박·대화로 준 방향)만 익명화한 방향 한두 문장. 취향 노트는 섞지 않는다."""
    texts = [t for t in texts if t]
    if not texts:
        return ""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps({"said_in_chat": texts}, ensure_ascii=False)}]
    for attempt in range(2):
        msg = await llm.chat(Settings().models.local, messages, role="anon", json_mode=True, temperature=0.2, max_tokens=400, reasoning=False)
        try:
            d = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))  # type: ignore[union-attr]
        except (AttributeError, json.JSONDecodeError):
            continue
        out = (str(d.get("direction") or "") + (" 피할 것: " + ", ".join(map(str, d.get("avoid") or [])) if d.get("avoid") else ""))[:400]
        hit = leaks(out, texts)
        audit.emit("anon", ok=not hit, attempt=attempt + 1, leaked=len(hit), scope="request")
        if not hit:
            return out
        messages.append({"role": "assistant", "content": msg.get("content") or ""})
        messages.append({"role": "user", "content": "손님 원문이 그대로 남아 있다. 원문 표현과 개인 사정을 빼고 음악적 방향으로만 다시 써라."})
    return ""


async def research_memory(llm: LLM, extra_said: list[str] | None = None) -> dict[str, Any]:
    """리서처 문맥의 'memory' 칸. 취향 노트·대화 원문 대신 익명화된 방향과 공개 정보(좋아한 매체)만."""
    d = await direction(llm, extra_said)
    return {"direction": d["direction"], "avoid": d["avoid"], "liked_sources": taste.for_researcher()["liked_sources"],
            "note": "손님 취향은 로컬 모델이 익명화한 방향으로만 전달된다. direction을 따르고 avoid는 피한다."}
