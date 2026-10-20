"""작성 — 검수를 통과한 근거로 '이 판이 왜 왔는지'를 문장으로 쓴다.

LLM은 주어진 사실(연결, 검수 통과 인용, 그 인용의 원문 맥락)만 보고 쓴다.
쓴 글은 코드가 다시 확인한다: 글 속 따옴표 인용은 원문에 글자 그대로 있어야 하고, 하나라도 어긋나면
그 글을 버리고 사실만으로 만든 기본 문장을 쓴다(근거 없는 문장을 내보내지 않는다).

기존 브리프에 다시 쓰기: python -m digger.writer --date 2026-10-12
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from typing import Any

from . import audit
from .config import BRIEFS
from .llm import LLM
from .sources.common import ToolFailure
from .sources.web import Web
from .verifier import normalize, verbatim

WRITER_MODEL = os.environ.get("DIGGER_WRITER_MODEL", "deepseek/deepseek-v4.1-flash")
# '좋아할 것 같은 이유'는 화면의 핵심 문장이라 더 좋은 모델로 쓴다 (판당 1센트 미만)
WHY_MODEL = os.environ.get("DIGGER_WHY_MODEL", os.environ.get("DIGGER_LOCAL_MODEL", "google/gemma-4-31b-it"))   # 취향 노트·대화를 읽는다 → 로컬
_AWKWARD = re.compile(r"견뎌|견디|\bThe\b|하실|드실|으실|끌리실|좋아하셨|꼽으셨|원하셨")
_QUOTED = re.compile(r"[“\"「『]([^”\"」』]{10,})[”\"」』]")

SYSTEM = """너는 동네 레코드 가게 점원이다. 손님은 이 판의 근거가 된 원문을 이미 읽었다.
그 아래 '좋아할 것 같은 이유' 칸에 두 문장을 쓴다.

1문장: 근거가 이 음악에 대해 말한 핵심을 네 말로 짧게. (원문을 다시 인용하지 말고 따옴표도 쓰지 않는다)
2문장: 손님의 취향 기록(my_taste)과 이어서 "그래서 좋아할 것 같다"를 말한다.
  - my_taste에 있는 것만 근거로 든다: 손님이 대화에서 직접 한 말(said_in_chat), 취향 노트, 좋아한 판과 그때 고른 측면(보컬·사운드·분위기·가사), 원래 좋아하던 아티스트(from).
  - said_in_chat이 이 판과 닿으면 그걸 가장 먼저 쓴다. 예: "요즘 조용한 게 좋다고 했으니, 이 곡의 나른한 결이 잘 맞을 것 같아요." (내 말이 추천에 반영됐다는 게 보이게)
    예: "세이수미에서 사운드와 분위기를 꼽았던 걸 보면, 이 음악의 몽롱한 질감도 반가울 거예요."
  - 취향 기록과 이어지는 게 마땅치 않으면 from(손님이 원래 좋아하던 아티스트)과의 연결로 말한다.
  - 기록에 없는 취향을 지어내지 않는다. "~하실 거예요"처럼 단정하지 말고 짐작하는 말투로.
  - already_said는 같은 날 앞 판들에 쓴 문장이다. 거기서 든 취향 근거(같은 판·같은 측면)와 같은 문형("~걸 보면", "반가울 것 같아요")을 되풀이하지 않는다.
    다른 취향 기록을 고르거나, 마땅한 게 없으면 from과의 연결로 말한다. 끝맺음도 매번 다르게.
  - 지금 추천하는 이 아티스트 자신을 취향 근거로 들지 않는다.

규칙:
- 사실은 아래 JSON에 있는 것만 쓴다. 장르·연도·멤버·수상·다른 아티스트 이름을 지어내지 않는다.
- '판'이라고 쓰지 않는다(음악·곡·앨범으로). '원문·근거·추천' 같은 딱딱한 말도 피한다.
- 짧고 담백한 해요체. 높임 '-시-'는 쓰지 않는다 (좋아하셨던 ✗ → 좋아했던 ○, 끌리실 ✗ → 끌릴 ○).
- 두 문장 합쳐 130자 안팎. 과장·홍보 문구, "그래서 추천해요" 같은 맺음말, '견디다' 같은 부정적인 말 금지.

JSON 하나만 출력: {"why": "..."}"""


def my_taste(exclude: str | None = None, exclude_ko: str | None = None) -> dict[str, Any]:
    """작성용 취향 기록: 취향 노트 + 좋아한 판(고른 측면, 메모). 지금 쓰는 판 자신의 반응은 뺀다."""
    from . import taste
    from .wiki import Wiki
    liked = []
    for r in Wiki().reactions():
        if r.get("reaction") == "like" and r.get("artist") != exclude:
            liked.append({"artist": r.get("artist_ko") or r["artist"], "aspects": [k for k, v in (r.get("aspects") or {}).items() if v > 0],
                          "memo": r.get("reason") or None})
    seen, uniq = set(), []
    for x in reversed(liked):   # 최근 반응 우선, 아티스트당 하나
        if x["artist"] not in seen:
            seen.add(x["artist"]); uniq.append(x)
    me = [x.casefold() for x in (exclude, exclude_ko) if x]
    notes = [n["text"] for n in taste.get_notes()["notes"] if not any(m in n["text"].casefold() for m in me)]   # 이 판 자신 얘기는 근거로 쓰지 않는다
    said = [{"kind": {"like": "좋아함", "less": "덜", "mood": "요즘"}[x["kind"]], "text": x["text"], "said": x.get("said"), "date": x["date"]}
            for x in taste.signals()]
    return {"taste_notes": notes[:6], "liked": [x for x in uniq if x["artist"].casefold() not in me][:6],
            "said_in_chat": said[-6:]}   # 손님이 대화에서 직접 한 말 (가장 강한 근거)


def excerpt(context: str, quote: str) -> dict[str, str]:
    """원문 맥락을 문장 경계에서 잘라 '앞 · 근거 문장 · 뒤'로 나눈다. 화면은 근거 문장만 형광펜으로 칠한다."""
    ok, pos = verbatim(quote, context)
    q = normalize(quote)
    if not ok:
        return {"before": "", "quote": quote, "after": ""}
    before, after = context[:pos], context[pos + len(q):]
    split = lambda t: [x.strip() for x in re.split(r"(?<=[.!?。])\s+", t) if x.strip()]
    prose = lambda x: not re.search(r"https?:|\]\(|!\[|\.svg|\.png|\.jpg", x)
    b = split(before)[1:]        # 맨 앞 조각은 잘린 반쪽 문장일 수 있다
    a = split(after)
    a = a[:-1] if a and not re.search(r"[.!?。]$", a[-1]) else a
    b = [x for x in b if prose(x)][-3:]   # 근거 문장 앞뒤로 3문장까지
    a = [x for x in a if prose(x)][:3]
    return {"before": " ".join(b), "quote": q, "after": " ".join(a)}


def parse_why(text: str) -> str | None:
    """JSON 우선. 모델이 본문에 따옴표를 이스케이프 없이 넣어 JSON이 깨지면 "why": 뒤 본문을 통째로 건진다."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    try:
        return str(json.loads(re.search(r"\{.*\}", text, re.S).group(0))["why"]).strip()  # type: ignore[union-attr]
    except (AttributeError, KeyError, json.JSONDecodeError):
        pass
    m = re.search(r'"why"\s*:\s*"(.*)"\s*\}?\s*$', text, re.S)
    return m.group(1).replace('\\"', '"').strip() if m else None


HIDDEN_LINES = [
    "자주 듣는 {a}, 그런데 이 곡은 아직이었죠?",
    "{a} 노래 중에 아직 안 들은 게 남아 있었어요.",
    "늘 듣던 {a}에서, 아직 못 만난 한 곡.",
    "새 음악들 사이에 아는 목소리 하나. {a}의 이 곡은 처음일 거예요.",
]


def hidden_line(artist: str, title: str, offset: int = 0) -> str:
    """숨은 곡 한 줄: 이미 아는 아티스트의 안 들어 본 곡. 같은 문장만 반복되지 않게 이름으로 고른다 (조사 없이 쓸 수 있는 문장만).
    offset: 한 브리프 안의 몇 번째 숨은 곡인지 (같은 날 두 곡이 같은 문장을 받지 않게)."""
    k = (sum(map(ord, title)) + offset) % len(HIDDEN_LINES)
    return HIDDEN_LINES[k].format(a=artist)


def fallback_why(c: dict[str, Any]) -> str:
    hop = c["path"][0]
    cl = c["claims"][0]
    src = cl.get("source_name") or cl.get("source_type") or "출처"
    return f"{hop['from']}에서 이어진 음악이에요({hop.get('connection') or hop['edge']}). {src}에 남은 이야기를 따라왔어요."


def sources_of(c: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for cl in c.get("claims", []):
        label = " · ".join(x for x in (cl.get("source_name"), cl.get("source_type")) if x) or "원문"
        out.append({"label": label, "url": cl["source_url"], "quote": cl["quote"], "kind": "근거 원문",
                    "excerpt": excerpt(cl.get("context") or "", cl["quote"]) if cl.get("context") else
                    {"before": "", "quote": cl["quote"], "after": ""}})
    for hop in c.get("path", []):
        if hop.get("connection_source"):
            out.append({"label": "한국대중음악상 후보·수상 목록 (위키백과)", "url": hop["connection_source"],
                        "quote": None, "kind": "연결 확인"})
    return out


GROUND_SYSTEM = """너는 검수자다. '정리 문장'이 '사실'(연결, 근거 원문과 그 맥락, 손님의 취향 기록 my_taste)에 없는 내용을 지어냈는지 본다.
장르·연대·국적·멤버·수상·사운드 묘사 등이 사실에 없으면 지어낸 것이다. 손님 취향을 말할 때 my_taste에 없는 취향을 대면 지어낸 것이다.
사실을 짧게 바꿔 말한 것, "~것 같아요" 같은 짐작 표현은 괜찮다.
JSON 하나만: {"grounded": true|false, "invented": "지어낸 부분 (없으면 빈 문자열)"}"""


async def grounded(llm: LLM, why: str, facts: dict[str, Any]) -> tuple[bool, str]:
    from .config import Settings
    msg = await llm.chat(Settings().models.ground, [{"role": "system", "content": GROUND_SYSTEM},
                         {"role": "user", "content": json.dumps({"사실": facts, "정리 문장": why}, ensure_ascii=False)}],
                         role="writer_check", json_mode=True, temperature=0, max_tokens=300, reasoning=False)
    try:
        d = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))  # type: ignore[union-attr]
        return bool(d.get("grounded")), str(d.get("invented") or "")
    except (AttributeError, json.JSONDecodeError):
        return True, ""  # 판정 실패는 통과로 (인용 대조는 이미 통과했다)


HEAD_SYSTEM = """너는 음악 잡지 편집자다. 레코드 가게 추천 카드에 올릴 제목·풀 쿼트·바이라인을 뽑는다.
- title: title_facts(from·edge·connection)만 보고 12~20자로. 손님이 아는 아티스트에서 어떻게 이어졌는지.
  quote·context의 내용은 제목에 쓰지 않는다. 예: '실리카겔 드러머의 다른 밴드', '실리카겔과 같은 해 같은 부문 후보'.
- pull: 근거 인용(quote) 안에서 가장 와닿는 구절 하나를 '글자 그대로' 잘라낸다(15~60자, 바꾸거나 이어붙이지 말 것).
- speaker: 그 말을 한 사람 이름(평론가·심사위원·인터뷰한 멤버). context나 quote에 이름이 그대로 있을 때만. 없으면 빈 문자열.
- role: speaker의 역할(예: '한국대중음악상 선정위원', '세이수미 기타'). context에 근거가 있을 때만. 없으면 빈 문자열.
JSON 하나만: {"title": "...", "pull": "...", "speaker": "...", "role": "..."}"""


def tail_clause(quote: str, limit: int = 90) -> str:
    """풀 쿼트를 못 뽑았을 때: 인용의 뒤쪽 절들(쉼표 기준)을 limit 안에서 이어 붙인다. 원문 글자 그대로다."""
    q = normalize(quote)
    if len(q) <= limit:
        return q
    parts = q.split(", ")
    out = parts[-1]
    for p in reversed(parts[:-1]):
        if len(p) + 2 + len(out) > limit:
            break
        out = p + ", " + out
    return out if len(out) >= 15 else q[:limit].rstrip() + "…"


async def headline(llm: LLM, c: dict[str, Any]) -> dict[str, Any]:
    """제목·풀 쿼트·바이라인. 풀 쿼트는 인용 안에 글자 그대로, 이름은 원문 맥락에 실제로 있을 때만 남긴다."""
    hop, cl = c["path"][0], c["claims"][0]
    facts = {"title_facts": {"from": hop["from"], "artist": c.get("artist_ko") or c["artist"], "edge": hop["edge"],
                             "connection": hop.get("connection")},
             "quote": cl["quote"], "context": (cl.get("context") or "")[:1600]}
    msg = await llm.chat(WRITER_MODEL, [{"role": "system", "content": HEAD_SYSTEM},
                                        {"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
                         role="writer_head", json_mode=True, temperature=0.3, max_tokens=300, reasoning=False)
    try:
        d = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))  # type: ignore[union-attr]
    except (AttributeError, json.JSONDecodeError):
        d = {}
    pull = str(d.get("pull") or "").strip(" “”\"'")
    ok = lambda p: 8 <= len(p) <= 90 and verbatim(p, cl["quote"])[0]
    if not ok(pull):  # 한 번 더: 문장 안에서 그대로 복사하라고 요청
        msg = await llm.chat(WRITER_MODEL, [
            {"role": "user", "content": "아래 문장에서 가장 와닿는 구절 하나를 한 글자도 바꾸지 말고 그대로 복사해 15~60자로 잘라 줘. "
                                        "괄호 설명은 빼고 자연스럽게 시작하는 지점에서 자른다. 구절만 출력.\n\n" + cl["quote"]}],
            role="writer_head", temperature=0, max_tokens=120, reasoning=False)
        pull = (msg.get("content") or "").strip().strip(" “”\"'")
    if not ok(pull):
        pull = tail_clause(cl["quote"])
    pool = normalize((cl.get("context") or "") + " " + cl["quote"])
    speaker = str(d.get("speaker") or "").strip()
    if speaker and normalize(speaker) not in pool:
        speaker = ""
    role = str(d.get("role") or "").strip() if speaker else ""
    title = str(d.get("title") or "").strip()[:30] or (hop.get("connection") or "")[:30]
    return {"title": title, "pull": pull, "speaker": speaker, "role": role[:30]}


def check_quotes(why: str, c: dict[str, Any]) -> list[str]:
    """글 속 따옴표 인용 중 원문(인용·맥락)에 글자 그대로 없는 것."""
    pool = " ".join((cl.get("context") or "") + " " + cl["quote"] for cl in c["claims"])
    return [q for q in _QUOTED.findall(why) if not verbatim(q, pool)[0]]


def without_names(why: str, c: dict[str, Any]) -> str:
    """어색한 표현 검사에서 고유명사는 뺀다: 'The Volunteers' 같은 이름의 The를 어색한 영어로 잡지 않게."""
    names = [c.get("artist"), c.get("artist_ko"), (c.get("track") or {}).get("title"), (c.get("track") or {}).get("album")]
    names += [h.get("from") for h in c.get("path") or []]
    for n in sorted({n for n in names if n}, key=len, reverse=True):
        why = why.replace(n, " ")
    return why


async def write_why(llm: LLM, c: dict[str, Any], said: list[str] | None = None) -> None:
    c["sources"] = sources_of(c)
    if c["kind"] != "new" or not c.get("claims"):
        t = c.get("track") or {}
        c["why"] = hidden_line(c["artist"], t.get("title") or "")
        c["why_by"] = "template"
        return
    hop = c["path"][0]
    facts = {
        "artist": c["artist"], "artist_ko": c.get("artist_ko"), "from": hop["from"], "edge": hop["edge"],
        "connection": hop.get("connection"),
        "track": {k: (c.get("track") or {}).get(k) for k in ("title", "album")},
        "evidence": [{"quote": cl["quote"], "source": cl.get("source_name") or cl.get("source_type"),
                      "context": (cl.get("context") or "")[:1600]} for cl in c["claims"]],
        "my_taste": {**my_taste(c["artist"], c.get("artist_ko")), "from_is_favorite": hop["from"]},
        "already_said": (said or [])[-5:],
    }
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(facts, ensure_ascii=False)}]
    for attempt in range(3):
        msg = await llm.chat(WHY_MODEL, messages, role="writer", json_mode=True, temperature=0.5, max_tokens=500, reasoning=False)
        why = parse_why(msg.get("content") or "")
        if not why:
            audit.emit("write", artist=c["artist"], ok=False, error="응답 해석 실패", attempt=attempt + 1)
            continue
        bad = check_quotes(why, c) + ([f"어색한 표현: {m.group(0)}"] if (m := _AWKWARD.search(without_names(why, c))) else [])
        invented = ""
        if not bad:
            ok, invented = await grounded(llm, why, facts)
            if not ok:
                bad = [f"지어낸 내용: {invented}"]
        audit.emit("write", artist=c["artist"], ok=not bad, bad_quotes=bad[:2], chars=len(why), attempt=attempt + 1)
        if bad:   # 다음 시도에 떨어진 이유를 알려 준다 (같은 실수를 되풀이하지 않게)
            messages = messages[:2] + [{"role": "assistant", "content": msg.get("content") or ""},
                                       {"role": "user", "content": "이 문장은 검사에서 떨어졌다: " + "; ".join(bad[:2])
                                        + ". evidence와 my_taste에 있는 사실만으로 다시 써라. 원문이 음악을 묘사하지 않으면 음악을 묘사하지 말고 연결(누가 왜 꼽았는지)을 말해라."}]
        if not bad and 30 <= len(why) <= 400:
            c["why"], c["why_by"] = why, "writer"
            c["display"] = await headline(llm, c)
            return
    c["why"], c["why_by"] = fallback_why(c), "template"
    c["display"] = await headline(llm, c)


async def write_all(llm: LLM, candidates: list[dict[str, Any]]) -> None:
    said: list[str] = []
    for c in candidates:
        await write_why(llm, c, said)
        if c.get("why_by") == "writer":
            said.append(c["why"])
    hidden = [c for c in candidates if c["kind"] != "new" or not c.get("claims")]
    for j, c in enumerate(hidden):   # 같은 날 숨은 곡끼리는 다른 문장
        c["why"] = hidden_line(c["artist"], hidden[0].get("track", {}).get("title") or "", j) if c.get("why_by") == "template" else c["why"]


# ---------- 기존 브리프에 다시 쓰기 (원문 맥락이 없던 브리프용) ----------

async def backfill(date: str) -> None:
    p = BRIEFS / f"{date}.json"
    brief = json.loads(p.read_text(encoding="utf-8"))
    web, llm = Web(), LLM()
    for c in brief["candidates"]:
        for cl in c.get("claims", []):
            if cl.get("context"):
                continue
            try:
                text = normalize((await web.page(cl["source_url"]))["text"])
                ok, pos = verbatim(cl["quote"], text)
                if ok:
                    cl["context"] = text[max(0, pos - 700): pos + len(normalize(cl["quote"])) + 700]
            except ToolFailure:
                pass
        await write_why(llm, c)
        print(f"[{c.get('why_by')}] {c['artist']}: {c['why'][:120]}…")
    await web.aclose()
    from .pipeline import save_brief
    save_brief(brief)
    print(f"저장: {p} (${llm.usage.cost_usd:.4f})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    asyncio.run(backfill(ap.parse_args().date))
