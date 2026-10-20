"""대화로 방향 틀기 — 디깅 도우미와 나눈 말을 방향으로 삼아 지금 한 판을 더 판다.

도우미가 손님 말에서 취향 신호를 받아 적고(taste.add_signals), 손님이 '지금 찾아 줘'라고 하면 이 함수가 돈다.
찾은 판은 최신 브리프 끝에 붙고(from_chat: 손님이 한 말), '좋아할 것 같은 이유'는 그 말을 근거로 쓰인다.
같은 신호는 오늘 밤 디깅에도 들어간다(taste.for_researcher).
"""

from __future__ import annotations

import json
import time
from datetime import date
from typing import Any

from . import anon, audit, taste
from .config import BRIEFS, Settings
from .llm import LLM
from .sources.common import ToolFailure, norm_name


async def dig(direction: str, said: str, seeds: list[str] | None = None) -> dict[str, Any]:
    from .pipeline import save_brief
    from .researcher import Researcher
    from .sources.yt import YouTubeMusic
    from .verifier import Verifier
    from .wiki import Wiki
    from .writer import write_why
    from .evidence import enrich
    started = time.monotonic()
    briefs = sorted(BRIEFS.glob("*.json"))
    path = briefs[-1] if briefs else BRIEFS / f"{date.today().isoformat()}.json"
    brief = json.loads(path.read_text(encoding="utf-8")) if path.exists() else \
        {"date": date.today().isoformat(), "seeds": [], "run": {}, "candidates": [], "rejections": [], "playlist": None}

    s = Settings()
    s.budget.new_artists = 1
    s.budget.max_tool_calls = 30
    s.budget.max_seconds = 5 * 60
    s.budget.max_cost_usd = 0.25
    llm, yt, wiki = LLM(), YouTubeMusic(), Wiki()
    verifier = Verifier(llm, s.models.judge)
    if not seeds:   # 출발점: 좋아한 판 + 원래 좋아하던 아티스트
        seeds = [m["name"] for m in wiki.pages() if m.get("role") == "seed"
                 or (m.get("reactions") or [{}])[-1].get("reaction") == "like"][:5]
    audit.emit("run_start", date=brief["date"], models=vars(s.models), tag="steer", direction=direction, said=said)
    in_brief = {norm_name(c["artist"]) for c in brief["candidates"]}
    researcher = Researcher(s, llm, yt, verifier, wiki.excluded() | in_brief, wiki.seen() | in_brief)
    context = {
        "mode": "손님이 대화로 방향을 틀었다 — 한 판만",
        "target_new_artists": 1,
        "seeds": seeds,
        "direction": await anon.scrub(llm, [said, direction]),   # 손님 말은 익명화한 방향으로만
        "rule": "direction을 반드시 따른다. 근거 원문에 그 방향(손님이 말한 결)이 드러나는 후보를 고른다. 오늘 브리프에 있는 아티스트는 다시 내지 않는다.",
        "memory": await anon.research_memory(llm),
        "budget": {"tool_calls": s.budget.max_tool_calls},
    }
    try:
        state = await researcher.run(context, max_turns=25)
    finally:
        await researcher.aclose()
        await verifier.aclose()

    found = None
    if state.accepted:
        c = state.accepted[0]
        try:
            c["track"] = await yt.listen_link(c["artist_query"], c.get("track_hint"))
        except ToolFailure as e:
            c["track"], c["track_note"] = None, str(e)
        c["from_chat"] = {"said": said, "direction": direction}
        await write_why(llm, c)
        try:
            await enrich([c], llm)
        except Exception:
            pass
        brief = json.loads(path.read_text(encoding="utf-8")) if path.exists() else brief
        brief["candidates"].append(c)
        save_brief(brief)
        thumbs = {}
        for name in {h["from"] for h in c.get("path", [])}:
            try:
                thumbs[name] = (await yt.resolve_artist(name))["thumb"]
            except ToolFailure:
                pass
        wiki.record_brief({"date": brief["date"], "candidates": [c]}, thumbs)
        found = c["artist"]
    audit.emit("run_end", tag="steer", accepted=1 if found else 0, artist=found, stop_reason=state.stop_reason,
               tool_calls=state.tool_calls, cost_usd=round(llm.usage.cost_usd, 4), seconds=round(time.monotonic() - started))
    return {"found": found, "date": brief["date"]}
