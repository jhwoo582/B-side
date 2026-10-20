"""디깅 에이전트 웹앱 API.

    .venv/bin/uvicorn app.api.main:app --port 8000 --reload

브리프·위키는 파일(briefs/*.json, wiki/artists/*.md)이 원본이고 API는 그걸 읽고 쓴다.
"""

from __future__ import annotations

import asyncio
import json
from datetime import date
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from digger import audit, taste
from digger.config import BRIEFS, LOGS, ROOT, Settings
from digger.pipeline import run as run_pipeline
from digger.sources.common import ToolFailure
from digger.sources.yt import YouTubeMusic
from digger.wiki import Wiki

app = FastAPI(title="Digging Agent")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
wiki = Wiki()


# ---------- 브리프 ----------

def _brief_path(d: str) -> Path:
    p = BRIEFS / f"{d}.json"
    if not p.exists() or p.parent != BRIEFS:
        raise HTTPException(404, f"브리프 없음: {d}")
    return p


@app.get("/api/briefs")
def list_briefs() -> list[dict[str, Any]]:
    out = []
    for p in sorted(BRIEFS.glob("*.json"), reverse=True):
        b = json.loads(p.read_text(encoding="utf-8"))
        out.append({"date": b["date"], "count": len(b["candidates"]), "run": b["run"]})
    return out


@app.get("/api/briefs/latest")
def latest_brief() -> dict[str, Any]:
    files = sorted(BRIEFS.glob("*.json"))
    if not files:
        raise HTTPException(404, "아직 브리프가 없습니다.")
    # 새 아티스트가 하나도 없는 밤(실패한 디깅)은 건너뛰고, 판이 있는 가장 최근 브리프를 연다
    for f in reversed(files):
        b = json.loads(f.read_text(encoding="utf-8"))
        if any(c.get("kind") == "new" for c in b.get("candidates", [])):
            return b
    return json.loads(files[-1].read_text(encoding="utf-8"))


@app.get("/api/briefs/{d}")
def get_brief(d: str) -> dict[str, Any]:
    return json.loads(_brief_path(d).read_text(encoding="utf-8"))


# ---------- 피드백 (HITL) ----------

class Feedback(BaseModel):
    date: str
    artist: str
    reaction: Literal["like", "dislike", "known"] | None = None
    aspects: dict[str, int] = Field(default_factory=dict)       # {"보컬": 1, "가사": -1}
    next: Literal["more", "later", "stop"] | None = None
    source_good: bool = False
    reason: str = Field("", max_length=500)


_taste_job: asyncio.Task | None = None


def _schedule_taste_refresh() -> None:
    """반응이 연달아 들어오면 마지막 것 기준으로 한 번만 정리한다 (4초 디바운스)."""
    global _taste_job
    if _taste_job and not _taste_job.done():
        _taste_job.cancel()

    async def job():
        await asyncio.sleep(4)
        await taste.refresh()
    _taste_job = asyncio.create_task(job())


@app.post("/api/feedback")
async def feedback(f: Feedback) -> dict[str, Any]:
    p = _brief_path(f.date)
    brief = json.loads(p.read_text(encoding="utf-8"))
    target = next((c for c in brief["candidates"] if c["artist"] == f.artist), None)
    if not target:
        raise HTTPException(404, f"브리프에 없는 아티스트: {f.artist}")
    target["feedback"] = {"reaction": f.reaction, "aspects": f.aspects, "next": f.next, "source_good": f.source_good,
                          "reason": f.reason, "at": date.today().isoformat()}
    p.write_text(json.dumps(brief, ensure_ascii=False, indent=1), encoding="utf-8")
    wiki_page = None
    if target["kind"] == "new":
        try:
            wiki_page = wiki.record_feedback(f.artist, f.reaction, f.reason, f.date, f.aspects, f.next, f.source_good)
        except ValueError as e:
            raise HTTPException(400, str(e))
        _schedule_taste_refresh()
    marked = None
    if f.reaction == "known":  # 취향 지도에도 남겨 다음 디깅에서 known으로 판정되게
        try:
            yt = YouTubeMusic()
            m = await yt.resolve_artist(f.artist)
            yt.taste.mark_known(m["channel_id"], m["name"])
            marked = m["name"]
        except ToolFailure:
            pass
    audit.emit("feedback", artist=f.artist, reaction=f.reaction, reason=f.reason)
    return {"ok": True, "status": (wiki_page or {}).get("status"), "taste_marked": marked}


class Listen(BaseModel):
    artist: str
    signal: Literal["full", "skip"]
    seconds: int = Field(0, ge=0, le=7200)


@app.post("/api/listen")
def listen(x: Listen) -> dict[str, Any]:
    """턴테이블 청취 자동 기록 (끝까지 들음 / 30초 안에 넘김)."""
    page = wiki.record_listen(x.artist, x.signal, x.seconds)
    if page:
        audit.emit("listen", artist=x.artist, signal=x.signal, seconds=x.seconds)
        _schedule_taste_refresh()
    return {"recorded": bool(page)}


# ---------- 취향 노트 (기억) ----------

class NoteEdit(BaseModel):
    text: str = Field(min_length=1, max_length=200)


@app.get("/api/taste")
def taste_notes() -> dict[str, Any]:
    return {**taste.get_notes(), "refreshing": bool(_taste_job and not _taste_job.done())}


@app.post("/api/taste/refresh")
async def taste_refresh() -> dict[str, Any]:
    return await taste.refresh()


@app.delete("/api/taste/signal/{sid}")
def taste_signal_remove(sid: str) -> dict[str, Any]:
    try:
        taste.remove_signal(sid)
    except KeyError:
        raise HTTPException(404, "없는 취향 신호예요")
    _schedule_taste_refresh()
    return taste.get_notes()


@app.patch("/api/taste/{note_id}")
def taste_edit(note_id: str, body: NoteEdit) -> dict[str, Any]:
    try:
        return taste.edit(note_id, body.text)
    except KeyError:
        raise HTTPException(404, "메모 없음")


@app.delete("/api/taste/{note_id}")
def taste_remove(note_id: str) -> dict[str, Any]:
    try:
        return taste.remove(note_id)
    except KeyError:
        raise HTTPException(404, "메모 없음")


# ---------- 디깅 경로 공유 (스토리) ----------

@app.get("/api/trail/{d}")
def trail(d: str) -> dict[str, Any]:
    """그날 판 길: 시드 → 판 (연결 종류, 원문 한 줄, 출처). 스토리 카드와 '이 길 이어서 파기'에 쓴다."""
    brief = json.loads(_brief_path(d).read_text(encoding="utf-8"))
    hops = []
    for c in brief["candidates"]:
        if c["kind"] != "new" or not c.get("path"):
            continue
        h = c["path"][0]
        seed = wiki.load(h["from"])
        cl = c["claims"][0]
        quote = cl["quote"] if len(cl["quote"]) <= 70 else cl["quote"][:68].rstrip() + "…"
        hops.append({"from": h["from"], "from_thumb": (seed or {}).get("meta", {}).get("thumb"),
                     "to": c["artist"], "to_ko": c.get("artist_ko"), "to_thumb": (c.get("track") or {}).get("thumb"),
                     "edge": h["edge"], "quote": quote,
                     "source": " · ".join(x for x in (cl.get("source_name"), cl.get("source_type")) if x),
                     "reaction": (c.get("feedback") or {}).get("reaction"), "reply_to": bool(c.get("reply_to"))})
    # 그날 밤 읽은 곳 (시작 화면에서 그냥 넘어가는 LP들에 흐리게 찍힌다)
    from urllib.parse import urlparse
    visited: list[str] = []
    log = LOGS / f"{d}.jsonl"
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            host = urlparse(e.get("url") or "").netloc.removeprefix("www.").removeprefix("m.")
            if e.get("kind") == "fetch" and host and host not in visited:
                visited.append(host)
    run = brief.get("run") or {}
    return {"date": d, "hops": hops, "ends": [h["to"] for h in hops], "visited": visited[:60],
            "pages": run.get("pages_read"), "picked": len(brief["candidates"])}


# ---------- 지도 겹치기 (친구 지도와 비교) ----------

@app.get("/api/map/export")
def map_export(owner: str = "나"):
    from fastapi.responses import JSONResponse
    from digger.compare import export_map
    return JSONResponse(export_map(owner[:30]), headers={"Content-Disposition": 'attachment; filename="digging-map.json"'})


@app.get("/api/friends")
def friends() -> list[dict[str, Any]]:
    from digger.compare import list_friends
    return list_friends()


@app.post("/api/friends")
async def add_friend(data: dict[str, Any]) -> dict[str, Any]:
    from digger.compare import save_friend
    try:
        return {"slug": save_friend(data)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/compare/{slug}")
async def compare_maps(slug: str) -> dict[str, Any]:
    from digger.compare import FRIENDS, compare
    if not (FRIENDS / f"{slug}.json").exists():
        raise HTTPException(404, "친구 지도가 없습니다")
    return await compare(slug)


# ---------- 위키 ----------

@app.get("/api/wiki/graph")
def wiki_graph() -> dict[str, Any]:
    return wiki.graph()


@app.get("/api/wiki/{slug}")
def wiki_page(slug: str) -> dict[str, Any]:
    page = wiki.load(slug)
    if not page:
        raise HTTPException(404, f"위키 페이지 없음: {slug}")
    return page


# ---------- 실행 (수동 디깅 + 실시간 로그) ----------

_run_task: asyncio.Task | None = None
_subscribers: set[asyncio.Queue] = set()


def _fanout(event: dict[str, Any]) -> None:
    for q in list(_subscribers):
        q.put_nowait(event)


audit.subscribe(_fanout)


class RunRequest(BaseModel):
    target: int = Field(8, ge=1, le=10)
    playlist: bool = False
    seeds: list[str] | None = Field(None, max_length=8)   # '이 길 이어서 파기': 공유받은 경로의 끝에서 출발
    note: str | None = Field(None, max_length=200)


@app.post("/api/run")
async def start_run(req: RunRequest) -> dict[str, Any]:
    global _run_task
    if _run_task and not _run_task.done():
        raise HTTPException(409, "이미 디깅 중이에요.")
    s = Settings()
    s.budget.new_artists = req.target
    _run_task = asyncio.create_task(run_pipeline(s, playlist=req.playlist, tag="trail" if req.seeds else "web",
                                                 seeds_override=req.seeds, context_note=req.note))
    return {"started": True}


class Retort(BaseModel):
    date: str
    artist: str
    objection: str = Field(min_length=2, max_length=300)


@app.post("/api/retort")
async def retort(r: Retort) -> dict[str, Any]:
    """말대꾸: 반박을 받아 한 판을 더 판다. 진행 상황은 /api/run/stream으로 흐른다."""
    global _run_task
    if _run_task and not _run_task.done():
        raise HTTPException(409, "지금 다른 음악을 찾는 중이에요. 조금 뒤에 다시 말해 주세요.")
    _brief_path(r.date)
    from digger.retort import redig
    _run_task = asyncio.create_task(redig(r.date, r.artist, r.objection))
    return {"started": True}


# ---------- 디깅 도우미 (지도 위 대화) ----------

class ChatMsg(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatReq(BaseModel):
    messages: list[ChatMsg] = Field(min_length=1, max_length=30)
    now: dict[str, Any] | None = None   # 지금 듣던 판 {artist, signal}


@app.post("/api/chat")
async def chat(req: ChatReq):
    """지도 위 대화: 도구 진행(step) → 지도에서 비출 이름(focus) → 지도에 올린 별(lead) → 답(answer)을 SSE로."""
    from digger.chat import Chat

    def start_dig(direction: str, said: str) -> str | None:
        global _run_task
        if _run_task and not _run_task.done():
            return "이미 다른 음악을 찾고 있어요. 끝나면 다시 말해 주세요."
        from digger.steer import dig
        _run_task = asyncio.create_task(dig(direction, said))
        _schedule_taste_refresh()
        return None

    async def gen():
        try:
            async for e in Chat(start_dig=start_dig, now=req.now).run([m.model_dump() for m in req.messages]):
                if e["event"] == "signal":
                    _schedule_taste_refresh()   # 받아 적은 취향으로 요약 문장·노트를 다시 다듬는다
                yield {"event": e["event"], "data": json.dumps(e, ensure_ascii=False, default=str)}
        except Exception as e:  # 모델·네트워크 오류도 대화창에 보이게
            yield {"event": "error", "data": json.dumps({"error": str(e)[:300]}, ensure_ascii=False)}

    return EventSourceResponse(gen())


# ---------- 미개척지 (지도의 흐린 별) ----------

@app.get("/api/frontier")
def frontier_list() -> list[dict[str, Any]]:
    from digger import frontier
    return frontier.visible()


class LeadStatus(BaseModel):
    status: Literal["open", "queued", "dismissed"]


@app.post("/api/frontier/{lead_id}")
def frontier_set(lead_id: str, body: LeadStatus) -> dict[str, Any]:
    from digger import frontier
    try:
        return frontier.set_status(lead_id, body.status)
    except KeyError:
        raise HTTPException(404, "없는 곳이에요")


class QueueOrder(BaseModel):
    ids: list[str] = Field(max_length=3)


@app.put("/api/frontier-queue")
def frontier_queue(body: QueueOrder) -> list[dict[str, Any]]:
    """오늘 밤 큐: 순서까지 통째로 저장한다."""
    from digger import frontier
    try:
        return frontier.set_queue(body.ids)
    except KeyError:
        raise HTTPException(404, "없는 곳이에요")


# ---------- 점원이 먼저 묻는 질문 ----------

class Answer(BaseModel):
    choice: int | None = None
    text: str = Field("", max_length=120)


@app.get("/api/questions")
def questions() -> list[dict[str, Any]]:
    from digger import ask
    return ask.questions()


@app.post("/api/questions/{qid:path}")
def answer(qid: str, body: Answer) -> dict[str, Any]:
    from digger import ask
    try:
        out = ask.answer(qid, body.choice, body.text)
    except KeyError:
        raise HTTPException(404, "지난 질문이에요")
    except ValueError as e:
        raise HTTPException(400, str(e))
    if out.get("signals"):
        _schedule_taste_refresh()
    return out


@app.post("/api/frontier-dig")
async def frontier_dig() -> dict[str, Any]:
    """'오늘 밤 여기로' 고른 곳으로 지금 바로 판다. 진행 상황은 /api/run/stream으로 흐른다."""
    global _run_task
    from digger import frontier
    if not frontier.queued():
        raise HTTPException(400, "먼저 지도에서 갈 곳을 골라 주세요.")
    if _run_task and not _run_task.done():
        raise HTTPException(409, "이미 디깅 중이에요.")
    _run_task = asyncio.create_task(frontier.dig())
    return {"started": True}


@app.get("/api/run/status")
def run_status() -> dict[str, Any]:
    if not _run_task:
        return {"running": False}
    if not _run_task.done():
        return {"running": True}
    exc = _run_task.exception()
    if exc:
        return {"running": False, "error": str(exc)}
    res = _run_task.result()
    return {"running": False, "error": None, "result": res if isinstance(res, dict) and "reply" in res else None}


@app.get("/api/run/stream")
async def run_stream():
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.add(q)

    async def gen():
        try:
            while True:
                e = await q.get()
                yield {"event": e["kind"], "data": json.dumps(e, ensure_ascii=False, default=str)}
        finally:
            _subscribers.discard(q)

    return EventSourceResponse(gen(), ping=15)


@app.get("/api/logs/{d}")
def run_log(d: str, kinds: str = "run_start,seeds,tool,think,verify,candidate,retry,budget_stop,playlist_created,run_end") -> list[dict[str, Any]]:
    """영업 일지: 그날 실행의 이벤트. 웹앱이 '어젯밤 에이전트가 한 일'을 재생한다."""
    p = LOGS / f"{d}.jsonl"
    if not p.exists() or p.parent != LOGS:
        raise HTTPException(404, "로그 없음")
    want = set(kinds.split(","))
    events = [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
    # 마지막 실행만 (벤치·시험 실행이 섞여 있을 수 있다)
    starts = [i for i, e in enumerate(events) if e["kind"] == "run_start" and not str(e.get("tag", "")).startswith("bench")]
    if starts:
        events = events[starts[-1]:]
    return [e for e in events if e["kind"] in want][:2000]


# ---------- 앨범아트 프록시 (WebGL 텍스처는 CORS가 필요하다) ----------

IMG_HOSTS = ("lh3.googleusercontent.com", "yt3.ggpht.com", "yt3.googleusercontent.com", "i.ytimg.com")
_img_cache: dict[str, tuple[bytes, str]] = {}


@app.get("/api/img")
async def img(url: str):
    from urllib.parse import urlparse
    from fastapi.responses import Response
    if urlparse(url).scheme != "https" or urlparse(url).hostname not in IMG_HOSTS:
        raise HTTPException(400, "허용하지 않는 이미지 주소")
    if url not in _img_cache:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url)
        if r.status_code != 200:
            raise HTTPException(502, "이미지를 가져오지 못했습니다")
        _img_cache[url] = (r.content, r.headers.get("content-type", "image/jpeg"))
    body, ctype = _img_cache[url]
    return Response(body, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


# ---------- 빌드된 웹앱 ----------

DIST = ROOT / "app" / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() and DIST in f.resolve().parents else DIST / "index.html")
