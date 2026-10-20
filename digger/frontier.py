"""미개척지 — 리서처가 디깅하면서 보고 지나친 이름들.

지도에는 흐린 별로 남고, 사용자가 '오늘 밤 여기로'를 누르면 다음 디깅이 그 방향으로 출발한다.
지도가 '에이전트가 한 일의 기록'이 아니라 '사용자가 다음 갈 곳을 고르는 화면'이 되게 하는 장치다.

- 뿌리(root): 시드 아티스트 본인이 인터뷰에서 영향받았다·좋아한다고 말한 이름 (시드보다 앞선 음악)
- 곁가지(branch): 평론 지도에서 같은 해 같은 부문에 나란히 오른 이름, 인터뷰에 그냥 언급된 이름

LLM은 인터뷰 문장에서 이름을 뽑을 때만 쓰고, 뽑힌 이름이 문장에 글자 그대로 있는지 코드가 다시 확인한다.
출처 문장은 원문 그대로 저장한다 (미개척지 카드의 근거).

실행:
    python -m digger.frontier --scan            # 지금 시드로 미개척지를 채운다 (디깅 없이 탐색만)
    python -m digger.frontier --list
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import time
from datetime import date
from typing import Any

from . import anon, audit, taste
from .config import BRIEFS, HOME, Settings
from .llm import LLM
from .sources.common import ToolFailure, norm_name

PATH = HOME / "wiki" / "frontier.json"
EXTRACT_MODEL = os.environ.get("DIGGER_WRITER_MODEL", "deepseek/deepseek-v4.1-flash")
MAX_PER_SOURCE = 6          # 한 출발점 둘레에 남길 미개척지 수 (너무 많으면 지도가 안개로 덮인다)
MAX_TRIES = 2               # '오늘 밤 여기로'를 눌렀는데 근거를 못 찾은 횟수 한도

EXTRACT_SYSTEM = """음악 인터뷰 문장 목록을 받는다. 각 문장에 나온 다른 음악가(아티스트·밴드) 이름을 문장에 적힌 표기 그대로 뽑는다.
- 인터뷰 대상(subject) 자신과 그 멤버 이름은 뽑지 않는다. 곡·앨범·장르·회사·매체 이름은 뽑지 않는다.
- influence: 인터뷰 대상 본인이 그 음악가에게 영향받았다·좋아한다·즐겨 듣는다고 말한 문장이면 true.
  기자의 설명·질문, 단순 비교·나열이면 false.
- name_en: 그 음악가의 원어·영문 표기 (문장에 괄호로 있으면 그것, 없으면 널리 쓰이는 공식 표기. 예: 얼랜드 오어 → Erlend Øye).
- 확실하지 않으면 뽑지 않는다.
JSON 하나만: {"items": [{"i": 문장번호, "name": "문장 속 표기 그대로", "name_en": "...", "influence": true}]}"""


# ---------- 저장 ----------

def load() -> list[dict[str, Any]]:
    if not PATH.exists():
        return []
    return json.loads(PATH.read_text(encoding="utf-8"))


def save(leads: list[dict[str, Any]]) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(leads, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, PATH)


def _id(name: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "-", norm_name(name)).strip("-") or "lead"


def _names(lead: dict[str, Any]) -> set[str]:
    return {norm_name(x) for x in (lead["name"], lead.get("name_ko"), *(lead.get("aliases") or [])) if x}


def visible() -> list[dict[str, Any]]:
    """지도에 그릴 것: 아직 안 가 본 곳 + 고른 곳."""
    return [x for x in load() if x["status"] in ("open", "queued")]


def set_status(lead_id: str, status: str) -> dict[str, Any]:
    if status not in ("open", "queued", "dismissed"):
        raise ValueError("status는 open / queued / dismissed")
    leads = load()
    lead = next((x for x in leads if x["id"] == lead_id), None)
    if not lead:
        raise KeyError(lead_id)
    if status == "queued" and lead["status"] != "queued":
        lead["queued_at"] = date.today().isoformat()
        lead["rank"] = len([x for x in leads if x["status"] == "queued"])   # 맨 뒤에 선다
    lead["status"] = status
    if status != "queued":
        lead.pop("rank", None)
    save(leads)
    return lead


MAX_QUEUE = 3   # 오늘 밤 큐 칸 수


def set_queue(ids: list[str]) -> list[dict[str, Any]]:
    """오늘 밤 큐를 이 순서로 통째로 바꾼다. 빠진 곳은 다시 '안 가 본 곳'으로 돌아간다."""
    ids = list(dict.fromkeys(ids))[:MAX_QUEUE]
    leads = load()
    have = {x["id"] for x in leads}
    if missing := [i for i in ids if i not in have]:
        raise KeyError(missing[0])
    for x in leads:
        if x["id"] in ids:
            if x["status"] != "queued":
                x["queued_at"] = date.today().isoformat()
            x["status"], x["rank"] = "queued", ids.index(x["id"])
        elif x["status"] == "queued":
            x["status"] = "open"; x.pop("rank", None)
    save(leads)
    return queued()


def queued() -> list[dict[str, Any]]:
    """순서대로. 리서처는 앞에서부터 판다."""
    return sorted((x for x in load() if x["status"] == "queued"), key=lambda x: x.get("rank", 99))


def for_researcher() -> list[dict[str, Any]]:
    """리서처 context용: 사용자가 '오늘 밤 여기로'를 누른 곳."""
    return [{"artist": x["name"], "artist_ko": x.get("name_ko"), "from": x["from"],
             "direction": "뿌리" if x["direction"] == "root" else "곁가지",
             "hint": x["hint"], "source_url": x.get("url"), "seen_sentence": x.get("quote")} for x in queued()]


# ---------- 모으기 ----------

async def extract_interview(llm: LLM, seed: str, result: dict[str, Any]) -> list[dict[str, Any]]:
    """interview_mentions 결과 → 문장 속 다른 음악가 이름. 문장에 글자 그대로 있는 이름만 남긴다."""
    rows = [(iv["url"], iv.get("title") or "", s) for iv in result.get("interviews") or [] for s in iv.get("sentences") or []][:30]
    if not rows:
        return []
    payload = {"subject": seed, "sentences": [{"i": i, "text": s} for i, (_, _, s) in enumerate(rows)]}
    try:
        msg = await llm.chat(EXTRACT_MODEL, [{"role": "system", "content": EXTRACT_SYSTEM},
                                             {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                             role="frontier_extract", json_mode=True, temperature=0.1, max_tokens=1500, reasoning=False)
        items = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0)).get("items") or []  # type: ignore[union-attr]
    except (AttributeError, json.JSONDecodeError, ToolFailure):
        return []
    out = []
    for it in items:
        try:
            url, title, sent = rows[int(it["i"])]
        except (KeyError, ValueError, IndexError, TypeError):
            continue
        name = str(it.get("name") or "").strip()
        if not (2 <= len(name) <= 60) or name.casefold() not in sent.casefold() or norm_name(name) == norm_name(seed):
            continue
        root = bool(it.get("influence"))
        out.append({"name": name, "name_en": str(it.get("name_en") or "").strip()[:60] or None,
                    "from": seed, "kind": "interview", "direction": "root" if root else "branch",
                    "hint": f"{seed} 인터뷰에서 {'영향받은 음악으로 ' if root else ''}언급",
                    "quote": sent, "url": url, "source_name": title[:80]})
    return out


def from_critic(result: dict[str, Any], on_map: set[str] | None = None) -> list[dict[str, Any]]:
    """critic_picks 결과 → 아는 아티스트와 같은 부문에 오른 이름 (연결은 평론 지도 데이터로 확인된 사실).
    on_map이 있으면 지도에 있는 아는 아티스트를 출발점으로 고른다."""
    from .researcher import kma_category_ko
    out = []
    for p in result.get("picks") or []:
        pairs = [(n, k) for n in p.get("nominations") or [] for k in n.get("nominated_with_known") or []]
        pairs.sort(key=lambda nk: norm_name(nk[1]) not in (on_map or set()))
        if not pairs:
            continue
        nom, known = pairs[0]
        name = p.get("yt_name") or p["artist"]
        out.append({"name": name, "name_ko": p["artist"] if p["artist"] != name else None, "from": known,
                    "kind": "critic", "direction": "branch",
                    "hint": f"{nom['year']} 한국대중음악상 {kma_category_ko(nom['category'])} {nom['result']} — {known}와 같은 부문",
                    "quote": None, "url": nom.get("source_url"), "source_name": "한국대중음악상"})
    return out


async def add(new: list[dict[str, Any]], yt: Any | None = None) -> int:
    """미개척지에 더한다. 이미 위키에 있거나(만난 적 있음) 아는 아티스트, 치운 곳은 넣지 않는다."""
    from .wiki import Wiki
    leads = load()
    have = {k: x for x in leads for k in _names(x)}
    canon = {norm_name(n): m["name"] for m in Wiki().pages() for n in (m.get("name"), m.get("name_ko"), *(m.get("aliases") or [])) if n}
    wiki_names = set(canon)
    tm = None
    if yt is not None:
        try:
            tm = await yt.sync_taste()
        except ToolFailure:
            tm = None
    added = 0
    today = date.today().isoformat()
    for lead in new:
        keys = {norm_name(x) for x in (lead["name"], lead.get("name_ko")) if x}
        if keys & wiki_names or norm_name(lead["from"]) not in wiki_names:
            continue   # 이미 만난 아티스트, 또는 지도에 없는 출발점 (흐린 별을 매달 곳이 없다)
        lead = {**lead, "from": canon[norm_name(lead["from"])]}   # 지도의 별 이름과 맞춘다
        if any(k in have for k in keys):
            old = next(have[k] for k in keys if k in have)
            old["last_seen"] = today
            if lead["direction"] == "root" and old["direction"] != "root":   # 본인 발언이 나오면 뿌리로 올린다
                old.update({k: lead[k] for k in ("direction", "kind", "hint", "quote", "url", "source_name", "from")})
            continue
        if yt is not None:
            r = await _resolve(yt, lead)
            if r:
                if tm and (tm.lookup(r["channel_id"], r["name"]) or tm.lookup("", lead["name"])):
                    continue   # 이미 아는 아티스트
                same = next((x for x in leads if x.get("channel_id") == r["channel_id"]), None)
                if same:       # 표기만 다른 같은 사람 (얼랜드 오어 / Erlend Øye)
                    same["last_seen"] = today
                    if lead["direction"] == "root" and same["direction"] != "root":
                        same.update({k: lead[k] for k in ("direction", "kind", "hint", "quote", "url", "source_name", "from")})
                    continue
                lead = {**lead, "thumb": r.get("thumb"), "channel_id": r["channel_id"]}
                if norm_name(r["name"]) != norm_name(lead["name"]):   # 지도 이름표는 한글 표기, 검색은 원어 표기
                    lead = {**lead, "name": r["name"], "name_ko": lead.get("name_ko") or lead["name"]}
        same_from = [x for x in leads if x["from"] == lead["from"] and x["status"] == "open"]
        if len(same_from) >= MAX_PER_SOURCE and lead["direction"] != "root":
            continue
        lead.pop("name_en", None)
        x = {"id": _id(lead["name"]), "status": "open", "first_seen": today, "last_seen": today, "tries": 0,
             **{k: v for k, v in lead.items() if v is not None}}
        leads.append(x)
        for k in _names(x):
            have[k] = x
        added += 1
    save(leads)
    return added


async def harvest(llm: LLM, yt: Any, researcher: Any) -> int:
    """디깅이 끝난 뒤: 리서처가 본 인터뷰·평론 지도 결과에서 고르지 않은 이름을 미개척지로 남긴다."""
    new: list[dict[str, Any]] = []
    for seed, res in getattr(researcher, "raw_interviews", []):
        new += await extract_interview(llm, seed, res)
    on_map = _on_map()
    for res in getattr(researcher, "raw_critic", []):
        new += from_critic(res, on_map)
    accepted = {norm_name(x) for a in researcher.state.accepted for x in (a["artist"], a.get("artist_query"), a.get("artist_ko")) if x}
    new = [x for x in new if not ({norm_name(x["name"]), norm_name(x.get("name_ko") or "")} & accepted)]
    n = await add(new, yt)
    audit.emit("frontier", added=n, seen=len(new))
    return n


async def _resolve(yt: Any, lead: dict[str, Any]) -> dict[str, Any] | None:
    """YouTube Music 채널 찾기: 이름이 정확히 맞거나 원어 표기(name_en)와 맞을 때만 같은 사람으로 본다."""
    for q in dict.fromkeys(x for x in (lead["name"], lead.get("name_en")) if x):
        try:
            r = await yt.resolve_artist(q)
        except ToolFailure:
            continue
        if r.get("name_matches_query") or (lead.get("name_en") and norm_name(r["name"]) == norm_name(lead["name_en"])):
            return r
    return None


def _on_map() -> set[str]:
    from .wiki import Wiki
    return {norm_name(n) for m in Wiki().pages() for n in (m.get("name"), m.get("name_ko"), *(m.get("aliases") or [])) if n}


def settle(accepted: list[dict[str, Any]]) -> None:
    """'오늘 밤 여기로'를 누른 곳의 결과: 찾았으면 지도에서 별이 되고(dug), 못 찾으면 다시 열어 둔다."""
    got = {norm_name(x) for a in accepted for x in (a["artist"], a.get("artist_query"), a.get("artist_ko")) if x}
    leads = load()
    for x in leads:
        if x["status"] != "queued":
            continue
        if _names(x) & got:
            x["status"] = "dug"
        else:
            x["tries"] = x.get("tries", 0) + 1
            if x["tries"] >= MAX_TRIES:
                x["status"] = "open"
                x["note"] = "근거를 찾지 못했어요"
    save(leads)


# ---------- 탐색만 (지도 채우기) ----------

async def scan(seeds: list[str] | None = None) -> int:
    """디깅 없이 출발점 둘레만 둘러본다: 시드 인터뷰 + 평론 지도. 처음 미개척지를 채울 때."""
    from .sources.web import Web
    from .sources.yt import YouTubeMusic
    from .wiki import Wiki
    s = Settings()
    llm, yt, web = LLM(), YouTubeMusic(), Web()
    try:
        if not seeds:   # 시드 + 좋아한 판 (좋아한 판의 뿌리가 가장 궁금한 곳이다)
            seeds = [m["name"] for m in Wiki().pages() if m.get("role") == "seed"
                     or (m.get("reactions") or [{}])[-1].get("reaction") == "like"
                     or (m.get("reactions") or [{}])[-1].get("next") == "more"]
        new: list[dict[str, Any]] = []
        for seed in seeds:
            meta = Wiki().load(seed)
            ko = (meta or {}).get("meta", {}).get("name_ko")
            try:
                new += await extract_interview(llm, seed, await web.interview_mentions(seed, ko))
            except ToolFailure:
                pass
        try:
            new += from_critic(await yt.critic_picks(15, s.max_monthly_listeners, Wiki().excluded() | Wiki().seen()), _on_map())
        except ToolFailure:
            pass
        n = await add(new, yt)
        audit.emit("frontier", added=n, seen=len(new), tag="scan")
        return n
    finally:
        await web.aclose()


# ---------- 고른 곳으로 지금 디깅 ----------

async def dig() -> dict[str, Any]:
    """'오늘 밤 여기로' 고른 곳으로 지금 바로 판다. 찾은 판은 최신 브리프 끝에 붙는다(브리프를 덮어쓰지 않는다)."""
    from .pipeline import save_brief
    from .researcher import Researcher
    from .sources.yt import YouTubeMusic
    from .verifier import Verifier
    from .wiki import Wiki
    from .writer import write_why
    started = time.monotonic()
    leads = for_researcher()
    if not leads:
        raise ValueError("고른 곳이 없어요")
    briefs = sorted(BRIEFS.glob("*.json"))
    brief_path = briefs[-1] if briefs else BRIEFS / f"{date.today().isoformat()}.json"
    brief = json.loads(brief_path.read_text(encoding="utf-8")) if brief_path.exists() else \
        {"date": date.today().isoformat(), "seeds": [], "run": {}, "candidates": [], "rejections": [], "playlist": None}

    s = Settings()
    s.budget.new_artists = min(len(leads), 3)
    s.budget.max_tool_calls = 25 * s.budget.new_artists
    s.budget.max_seconds = 4 * 60 * s.budget.new_artists
    s.budget.max_cost_usd = 0.15 * s.budget.new_artists
    llm, yt, wiki = LLM(), YouTubeMusic(), Wiki()
    verifier = Verifier(llm, s.models.judge)
    audit.emit("run_start", date=brief["date"], models=vars(s.models), tag="frontier", leads=[x["artist"] for x in leads])
    in_brief = {norm_name(c["artist"]) for c in brief["candidates"]}
    researcher = Researcher(s, llm, yt, verifier, wiki.excluded() | in_brief, wiki.seen() | in_brief)
    context = {
        "mode": "손님이 고른 방향으로 — requested_leads만",
        "target_new_artists": s.budget.new_artists,
        "seeds": list(dict.fromkeys(x["from"] for x in leads)),
        "requested_leads": leads,
        "rule": "requested_leads의 아티스트만 후보로 낸다. 각 후보를 from과 잇는 원문 근거를 찾아 submit_candidate한다. "
                "direction이 뿌리면 from 아티스트 본인이 그 후보에게 영향받았다·좋아한다고 말한 문장을 찾고 direction='뿌리'로 낸다.",
        "memory": await anon.research_memory(llm),
        "budget": {"tool_calls": s.budget.max_tool_calls},
    }
    try:
        state = await researcher.run(context, max_turns=20 * s.budget.new_artists)
    finally:
        await researcher.aclose()
        await verifier.aclose()

    found = []
    for c in state.accepted:
        try:
            c["track"] = await yt.listen_link(c["artist_query"], c.get("track_hint"))
        except ToolFailure as e:
            c["track"], c["track_note"] = None, str(e)
        c["from_lead"] = True
        await write_why(llm, c)
        found.append(c)
    settle(state.accepted)
    if found:
        brief = json.loads(brief_path.read_text(encoding="utf-8")) if brief_path.exists() else brief
        brief["candidates"] += found
        save_brief(brief)
        thumbs = {}
        for name in {h["from"] for c in found for h in c.get("path", [])}:
            try:
                thumbs[name] = (await yt.resolve_artist(name))["thumb"]
            except ToolFailure:
                pass
        wiki.record_brief({"date": brief["date"], "candidates": found}, thumbs)
    try:   # 새 별이 지도에 오른 뒤에 정리해야 그 별 둘레의 흐린 별도 남는다
        await harvest(llm, yt, researcher)
    except Exception as e:  # 미개척지 정리 실패가 디깅 결과를 막으면 안 된다
        audit.emit("frontier", ok=False, error=str(e)[:200])
    audit.emit("run_end", tag="frontier", accepted=len(found), rejected=len(state.rejections), stop_reason=state.stop_reason,
               tool_calls=state.tool_calls, cost_usd=round(llm.usage.cost_usd, 4), seconds=round(time.monotonic() - started))
    return {"found": [c["artist"] for c in found], "date": brief["date"]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true", help="시드 둘레를 둘러보고 미개척지를 채운다")
    ap.add_argument("--seeds", nargs="*")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.scan:
        audit.subscribe(lambda e: print(f"[{e['kind']}] " + json.dumps({k: v for k, v in e.items() if k not in ('ts', 'kind')},
                                                                     ensure_ascii=False, default=str)[:200], flush=True))
        print("추가:", asyncio.run(scan(args.seeds)))
    for x in load() if args.list or args.scan else []:
        print(f"{x['status']:8} {x['direction']:6} {x['from']:>14} → {x['name']}  ({x['hint']})")


if __name__ == "__main__":
    main()
