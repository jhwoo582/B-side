"""밤 파이프라인: 출발점 → 리서처(+검수) → 곡 선정 → 브리프 → 위키 → 플레이리스트.

LLM은 리서처와 검수 판정에만 쓰고 나머지는 코드다.

실행:
    python -m digger.pipeline                 # 브리프·위키만 (플레이리스트 없음)
    python -m digger.pipeline --playlist      # 플레이리스트까지
    python -m digger.pipeline --nightly       # 야간 배치 (= --playlist, 위임된 범위에서 자동 실행)
    python -m digger.pipeline --target 3 --model deepseek/deepseek-v4-pro-0813
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import date
from typing import Any

from . import anon, audit
from .config import BRIEFS, Settings
from .llm import LLM
from .researcher import Researcher
from .sources.common import ToolFailure, norm_name
from .sources.yt import YouTubeMusic
from .verifier import Verifier
from .wiki import Wiki
from .writer import write_all
from . import frontier, taste


async def run(settings: Settings, *, playlist: bool, write: bool = True, brief_date: str | None = None,
              tag: str = "", seeds_override: list[str] | None = None, context_note: str | None = None) -> dict[str, Any]:
    d = brief_date or date.today().isoformat()
    started = time.monotonic()
    fetched: set[str] = set()
    unsub = audit.subscribe(lambda e: fetched.add(e["url"]) if e["kind"] == "fetch" else None)
    llm, yt, wiki = LLM(), YouTubeMusic(), Wiki()
    verifier = Verifier(llm, settings.models.judge)
    audit.emit("run_start", date=d, models=vars(settings.models), budget=vars(settings.budget), tag=tag)
    try:
        # 1. 출발점
        await yt.sync_taste()
        # 로그인이 (일부라도) 풀리면 좋아요·청취기록을 못 읽는다 → 조용히 넘기지 않고 경고를 남긴다
        sync_errors = getattr(yt.taste, "sync_errors", [])
        auth_warning = None
        if yt.offline or any(e.startswith(("liked", "history")) for e in sync_errors):
            auth_warning = "YouTube Music 로그인이 만료됐어요. 저장된 취향 지도로 디깅했고, 플레이리스트는 만들지 못해요."
            audit.emit("auth_warning", message=auth_warning, errors=sync_errors or [yt.offline])
        liked = await yt.liked_artists(5)
        queue = wiki.queue()[:4]
        seeds = [a["name"] for a in liked] + [q for q in queue if norm_name(q) not in {norm_name(a["name"]) for a in liked}]
        if seeds_override:  # 공유받은 디깅 경로의 끝에서 이어서 판다
            seeds = list(dict.fromkeys(seeds_override))
        audit.emit("seeds", seeds=seeds, from_liked=[a["name"] for a in liked], from_wiki=queue)

        # 기억: 반응 기록 → 취향 노트 (리서처의 판단 입력)
        try:
            if write:   # 벤치(저장 안 함)는 취향 노트를 덮어쓰지 않는다
                await taste.refresh(llm)
        except Exception as e:  # 노트 정리 실패가 디깅을 막으면 안 된다
            audit.emit("taste_refresh", ok=False, error=str(e)[:200])
        memory = await anon.research_memory(llm)   # 개인 데이터 경계: 취향 원문 대신 익명화된 방향만

        # 2. 리서처 (+ 검수)
        researcher = Researcher(settings, llm, yt, verifier, wiki.excluded(), wiki.seen())
        context = {
            "date": d, "target_new_artists": settings.budget.new_artists,
            "seeds": seeds,
            "seed_note": "seeds = 최근 좋아요를 많이 누른 아티스트 + 지난번 👍한 후보. connected_from 후보로 쓴다.",
            "budget": {"tool_calls": settings.budget.max_tool_calls},
            "memory": memory,
            **({"trail_note": context_note} if context_note else {}),
            **({"requested_leads": frontier.for_researcher()} if frontier.queued() else {}),
            "memory_note": "memory.direction = 손님 취향을 익명화한 방향. 후보를 고를 때 이 방향을 따르고 avoid는 피한다. "
                           "liked_sources = 사용자가 좋다고 한 출처(매체·평론가). 근거를 찾을 때 먼저 찾아본다.",
        }
        state = await researcher.run(context)
        await researcher.aclose()
        # 미개척지: 고른 곳의 결과를 정리하고, 이번에 보고 지나친 이름을 지도에 남긴다
        if write:   # 벤치는 '오늘 밤 여기로' 상태를 건드리지 않는다
            frontier.settle(state.accepted)

        # 3. 곡 선정: 인용에 나온 곡/앨범 우선, 없으면 대표곡
        candidates: list[dict[str, Any]] = []
        for c in state.accepted:
            try:
                t = await yt.listen_link(c["artist_query"], c.get("track_hint"))
                c["track"] = t
                c["artist"] = c["artist"] or t["artist"]
            except ToolFailure as e:
                c["track"] = None
                c["track_note"] = str(e)
            candidates.append(c)

        # 4. 숨은 곡: 아는 아티스트(시드)의, 청취기록에 없는 곡
        hidden = []
        for a in liked:
            if len(hidden) >= settings.budget.hidden_tracks:
                break
            try:
                t = await yt.hidden_track(a["channel_id"], a["name"])
            except ToolFailure:
                t = None
            if t:
                hidden.append({"kind": "hidden_track", "artist": a["name"], "track": {**t, "channel_id": a["channel_id"],
                               "artist": a["name"]}, "path": [], "claims": [],
                               "note": "아는 아티스트의, 최근 기록에 없는 곡 (원문 근거 예외)"})
        ordered = hidden[:1] + candidates + hidden[1:]

        # 5. 작성: 검수 통과한 근거로 선정 이유를 문장으로 (글 속 인용은 코드가 다시 대조)
        await write_all(llm, ordered)
        # 6. 더 읽을 근거: 판마다 인터뷰·리뷰 원문 문장을 1~2개 더 (원문 글자 대조 통과분만)
        from .evidence import enrich
        try:
            await enrich(candidates, llm)
        except Exception as e:
            audit.emit("evidence", ok=False, error=str(e)[:200])

        brief: dict[str, Any] = {
            "date": d,
            "seeds": seeds,
            "run": {
                "models": vars(settings.models),
                "tool_calls": state.tool_calls, "tool_errors": state.tool_errors,
                "llm_calls": llm.usage.calls, "cost_usd": round(llm.usage.cost_usd, 4),
                "seconds": round(time.monotonic() - started), "pages_read": len(fetched),
                "accepted": len(state.accepted), "rejected": len(state.rejections),
                "verbatim_failures": sum(1 for r in state.rejections for c in r.get("claims", []) if not c.get("verbatim")),
                "stop_reason": state.stop_reason, "tag": tag, "streaming_offline": yt.offline,
                "auth_warning": auth_warning,
            },
            "candidates": ordered,
            "rejections": state.rejections,
            "playlist": None,
        }

        # 6. 플레이리스트 (위임된 범위: 새 비공개 플레이리스트 생성만)
        if playlist and auth_warning:
            brief["playlist"] = {"error": auth_warning}
        elif playlist:
            ids = [c["track"]["video_id"] for c in ordered if c.get("track") and c["track"].get("video_id")]
            desc = "디깅 에이전트가 만든 오늘의 디깅. " + " / ".join(
                f"{c['artist']}: {c['path'][0]['connection']}" for c in candidates if c.get("path"))
            try:
                brief["playlist"] = await yt.create_playlist(f"Digging {d}", ids, desc)
            except ToolFailure as e:
                brief["playlist"] = {"error": str(e)}
                audit.emit("playlist_error", error=str(e))

        if write:
            save_brief(brief)
            seed_thumbs = {}
            for name in {h["from"] for c in candidates for h in c.get("path", [])}:
                try:
                    seed_thumbs[name] = (await yt.resolve_artist(name))["thumb"]
                except ToolFailure:
                    pass
            n = wiki.record_brief(brief, seed_thumbs)
            audit.emit("wiki_recorded", pages=n)
            try:   # 이번에 보고 지나친 이름을 지도의 흐린 별로 (새 별이 위키에 오른 뒤라야 매달 곳이 있다)
                await frontier.harvest(llm, yt, researcher)
            except Exception as e:
                audit.emit("frontier", ok=False, error=str(e)[:200])
            try:   # 오늘 읽은 원문·새 위키 페이지를 원문 저장소(RAG) 색인에 넣는다 (새 청크만 임베딩)
                from . import rag
                await asyncio.to_thread(rag.build)
            except Exception as e:
                audit.emit("rag_build", ok=False, error=str(e)[:200])
        audit.emit("run_end", **brief["run"])
        return brief
    finally:
        unsub()
        await verifier.aclose()


def save_brief(brief: dict[str, Any]) -> None:
    BRIEFS.mkdir(parents=True, exist_ok=True)
    (BRIEFS / f"{brief['date']}.json").write_text(json.dumps(brief, ensure_ascii=False, indent=1), encoding="utf-8")
    (BRIEFS / f"{brief['date']}.md").write_text(render_md(brief), encoding="utf-8")


def render_md(b: dict[str, Any]) -> str:
    r = b["run"]
    lines = [f"# 오늘의 디깅 — {b['date']}", "",
             f"시드: {', '.join(b['seeds'])}",
             f"구성: 새 아티스트 {sum(c['kind'] == 'new' for c in b['candidates'])} + 숨은 곡 "
             f"{sum(c['kind'] == 'hidden_track' for c in b['candidates'])}",
             f"실행: 도구 {r['tool_calls']}회 · 페이지 {r['pages_read']}곳 · 검수 반려 {r['rejected']}건 "
             f"(글자 불일치 {r['verbatim_failures']}) · ${r['cost_usd']} · {r['seconds']}초",
             f"모델: 리서처 {r['models']['researcher']} / 검수 {r['models']['judge']}", ""]
    if b.get("playlist") and b["playlist"].get("url"):
        lines += [f"플레이리스트: {b['playlist']['url']}", ""]
    for i, c in enumerate(b["candidates"], 1):
        t = c.get("track") or {}
        tag = "새 아티스트" if c["kind"] == "new" else "숨은 곡"
        lines.append(f"## {i}. [{tag}] {c['artist']} — {t.get('title', '(곡 없음)')}")
        if c.get("why"):
            lines.append(f"> {c['why']}")
        for p in c.get("path", []):
            lines.append(f"- 경로: {p['from']} —[{p['edge']}]→ {p['to']} ({p.get('connection', '')})")
        for cl in c.get("claims", []):
            lines.append(f"- 근거: \"{cl['quote']}\"")
            lines.append(f"  - 출처: {cl['source_url']} ({cl.get('source_name') or ''} {cl.get('source_type') or ''}) ✅ 원문 대조 통과")
        if c.get("note"):
            lines.append(f"- {c['note']}")
        if t.get("url"):
            lines.append(f"- 듣기: {t['url']}")
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nightly", action="store_true", help="야간 배치 (플레이리스트 포함)")
    ap.add_argument("--playlist", action="store_true")
    ap.add_argument("--target", type=int, help="새 아티스트 목표 수")
    ap.add_argument("--model", help="리서처 모델")
    ap.add_argument("--judge", help="검수 판정 모델")
    ap.add_argument("--date")
    ap.add_argument("--dry", action="store_true", help="브리프·위키를 저장하지 않음")
    args = ap.parse_args()
    s = Settings()
    if args.target:
        s.budget.new_artists = args.target
    if args.model:
        s.models.researcher = args.model
    if args.judge:
        s.models.judge = args.judge
    audit.subscribe(lambda e: print(_line(e), flush=True))
    brief = asyncio.run(run(s, playlist=args.nightly or args.playlist, write=not args.dry, brief_date=args.date,
                            tag="nightly" if args.nightly else "manual"))
    print(json.dumps(brief["run"], ensure_ascii=False, indent=1))
    if brief["run"].get("auth_warning"):
        print("AUTH_WARNING " + brief["run"]["auth_warning"])


def _line(e: dict[str, Any]) -> str:
    k = e["kind"]
    if k == "tool":
        return f"  🔧 {e['tool']} {json.dumps(e['args'], ensure_ascii=False)[:140]} → {e['status']} ({e['ms']}ms)"
    if k == "verify":
        mark = "✅" if e["verbatim"] and e["supports"] else "❌"
        return f"  🔎 검수 {mark} {e['candidate']}: {e['reason'][:120]}"
    if k == "candidate":
        return f"  {'🎉 통과' if e['status'] == 'accepted' else '↩️ 반려'} {e['artist']} ({e.get('stage', '')})"
    if k == "llm":
        return f"  🤖 {e['role']} {e['model']} {e['ms']}ms ${e['cost_usd']}"
    if k == "think":
        return f"  💭 {e['text'][:160]}"
    return f"[{k}] " + json.dumps({x: y for x, y in e.items() if x not in ('ts', 'kind')}, ensure_ascii=False, default=str)[:300]


if __name__ == "__main__":
    main()
