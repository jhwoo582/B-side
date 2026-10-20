"""말대꾸 — 사용자가 판의 이유에 반박하면, 사장님이 답하고 방향을 바꿔 한 판을 더 판다.

1. 계획(LLM 한 번): 반박을 읽고 사장님의 한 줄 답과, 리서처에게 줄 새 방향을 정한다.
2. 리서처(ReAct): 그 방향으로 한 판만 찾는다. 검수·곡 선정·작성은 밤 파이프라인과 같다.
3. 기록: 새 판은 오늘 브리프에서 원래 판 바로 뒤에 꽂히고(reply_to), 반박은 위키에 남아 취향 노트의 근거가 된다.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from . import anon, audit, taste
from .config import BRIEFS, Settings
from .llm import LLM
from .researcher import Researcher
from .sources.common import ToolFailure, norm_name
from .sources.yt import YouTubeMusic
from .verifier import Verifier
from .wiki import Wiki
from .writer import write_why

PLAN_MODEL = os.environ.get("DIGGER_RETORT_MODEL", os.environ.get("DIGGER_LOCAL_MODEL", "google/gemma-4-31b-it"))   # 손님의 반박을 읽는다 → 로컬

PLAN_SYSTEM = """너는 동네 레코드 가게 사장님이다. 손님이 네가 고른 판의 이유에 말대꾸를 했다.
1) 손님에게 한 줄로 답한다: 반박을 받아들이고 이번엔 어느 쪽으로 가볼지 말한다. 해요체로 담백하게, 50자 안팎. 변명하지 않는다. '판' 대신 음악·곡이라고 한다.
2) 리서처에게 줄 지시(direction)를 쓴다: 무엇을 피하고 어떤 연결·근거를 찾을지 구체적으로.
   예: '평론 지도는 쓰지 말고, 원래 판의 출발점(from) 아티스트 인터뷰에서 본인이 언급한 아티스트를 찾는다'.
3) 출발점(start_from)을 정한다: 원래 판의 from, 원래 판 아티스트 자신, 또는 둘 다.
JSON 하나만: {"reply": "...", "direction": "...", "start_from": ["..."]}"""


async def plan(llm: LLM, base: dict[str, Any], objection: str) -> dict[str, Any]:
    hop = (base.get("path") or [{}])[0]
    facts = {"판": base["artist"], "from": hop.get("from"), "edge": hop.get("edge"), "connection": hop.get("connection"),
             "추천 이유": base.get("why"), "손님의 말대꾸": objection}
    msg = await llm.chat(PLAN_MODEL, [{"role": "system", "content": PLAN_SYSTEM},
                                      {"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
                         role="retort_plan", json_mode=True, temperature=0.4, max_tokens=500, reasoning=False)
    try:
        p = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))  # type: ignore[union-attr]
    except (AttributeError, json.JSONDecodeError):
        p = {}
    start = [s for s in (p.get("start_from") or []) if isinstance(s, str)] or [x for x in (hop.get("from"), base["artist"]) if x]
    return {"reply": str(p.get("reply") or "알겠어요, 다른 길로 한 곡 더 찾아볼게요.")[:120],
            "direction": str(p.get("direction") or objection)[:400], "start_from": start[:3]}


async def redig(brief_date: str, artist: str, objection: str) -> dict[str, Any]:
    started = time.monotonic()
    path = BRIEFS / f"{brief_date}.json"
    brief = json.loads(path.read_text(encoding="utf-8"))
    idx = next(i for i, c in enumerate(brief["candidates"]) if c["artist"] == artist)
    base = brief["candidates"][idx]

    s = Settings()
    s.budget.new_artists = 1
    s.budget.max_tool_calls = 30
    s.budget.max_seconds = 5 * 60
    s.budget.max_cost_usd = 0.25
    llm, yt, wiki = LLM(), YouTubeMusic(), Wiki()
    verifier = Verifier(llm, s.models.judge)
    audit.emit("run_start", date=brief_date, models=vars(s.models), tag="retort", artist=artist, objection=objection)

    p = await plan(llm, base, objection)
    audit.emit("retort_reply", artist=artist, reply=p["reply"], direction=p["direction"], start_from=p["start_from"])
    wiki.record_retort(artist, objection, p["reply"], brief_date)

    in_brief = {norm_name(c["artist"]) for c in brief["candidates"]}
    researcher = Researcher(s, llm, yt, verifier, wiki.excluded() | in_brief, wiki.seen() | in_brief)
    context = {
        "mode": "말대꾸 답장 — 한 판만",
        "target_new_artists": 1,
        "seeds": p["start_from"],
        "objection": {"판": artist, "원래 연결": (base.get("path") or [{}])[0].get("edge")},
        "direction": await anon.scrub(llm, [objection, p["direction"]]) or p["direction"],
        "rule": "direction을 반드시 따른다. 원래 판과 같은 종류의 연결(edge)·같은 출처로 가지 않는다. 오늘 브리프에 있는 아티스트는 다시 내지 않는다.",
        "memory": await anon.research_memory(llm),
        "budget": {"tool_calls": s.budget.max_tool_calls},
    }
    try:
        state = await researcher.run(context, max_turns=25)
    finally:
        await researcher.aclose()
        await verifier.aclose()
    if not state.accepted:
        audit.emit("run_end", tag="retort", accepted=0, stop_reason=state.stop_reason,
                   cost_usd=round(llm.usage.cost_usd, 4), seconds=round(time.monotonic() - started))
        return {"reply": p["reply"], "candidate": None, "reason": state.stop_reason or "꼭 맞는 음악을 못 찾았어요"}

    c = state.accepted[0]
    try:
        c["track"] = await yt.listen_link(c["artist_query"], c.get("track_hint"))
    except ToolFailure as e:
        c["track"], c["track_note"] = None, str(e)
    c["reply_to"] = {"artist": artist, "objection": objection, "reply": p["reply"]}
    await write_why(llm, c)

    # 최신 브리프를 다시 읽고(그 사이 반응이 저장됐을 수 있다) 원래 판 바로 뒤에 꽂는다
    brief = json.loads(path.read_text(encoding="utf-8"))
    idx = next(i for i, x in enumerate(brief["candidates"]) if x["artist"] == artist)
    brief["candidates"].insert(idx + 1, c)
    from .pipeline import save_brief
    save_brief(brief)
    thumbs = {}
    for name in {h["from"] for h in c.get("path", [])}:
        try:
            thumbs[name] = (await yt.resolve_artist(name))["thumb"]
        except ToolFailure:
            pass
    wiki.record_brief({"date": brief_date, "candidates": [c]}, thumbs)
    audit.emit("run_end", tag="retort", accepted=1, artist=c["artist"], stop_reason=state.stop_reason,
               cost_usd=round(llm.usage.cost_usd, 4), tool_calls=state.tool_calls, seconds=round(time.monotonic() - started))
    return {"reply": p["reply"], "candidate": c}
