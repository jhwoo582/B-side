"""지도 겹치기 — 친구의 디깅 지도와 내 지도를 비교한다.

숫자 하나(유사도 73%)가 아니라 이유가 보이게:
- 같은 판, 다른 길: 둘 다 도착한 아티스트인데 출발점·연결이 다른 경우
- 받을 판 / 줄 판: 한쪽이 좋아했는데 다른 쪽은 모르는 아티스트
- 유사도 = 아는 아티스트 겹침 + 디깅 스타일(연결 종류 분포) + 좋아한 측면(보컬·사운드…)
- 취향 노트끼리의 공통점·차이는 LLM이 두 노트만 보고 두 줄로 정리한다(노트에 없는 말 금지).

공유 파일 형식(export): {"owner", "exported", "artists": [...], "taste_notes": [...], "known": [...]}
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from datetime import date
from typing import Any

from . import taste
from .config import DATA, TASTE_PATH
from .llm import LLM
from .sources.common import norm_name
from .wiki import Wiki

FRIENDS = DATA / "friends"


def export_map(owner: str) -> dict[str, Any]:
    w = Wiki()
    artists = []
    for m in w.pages():
        last = (m.get("reactions") or [{}])[-1]
        artists.append({
            "name": m["name"], "name_ko": m.get("name_ko"), "channel_id": m.get("channel_id"), "role": m.get("role"),
            "thumb": m.get("thumb"), "reaction": last.get("reaction"), "aspects": last.get("aspects") or {},
            "paths": [{"from": p["from"], "edge": p["edge"], "quote": p["quote"][:120]} for p in m.get("paths") or []],
        })
    known = []
    if TASTE_PATH.exists():
        known = [a["name"] for a in json.loads(TASTE_PATH.read_text(encoding="utf-8"))["artists"].values()]
    return {"owner": owner, "exported": date.today().isoformat(), "artists": artists,
            "taste_notes": [n["text"] for n in taste.get_notes()["notes"]], "known": known}


def save_friend(data: dict[str, Any]) -> str:
    if not isinstance(data.get("artists"), list):
        raise ValueError("디깅 지도 파일이 아닙니다")
    FRIENDS.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^\w가-힣-]+", "_", str(data.get("owner") or "friend"))[:40] or "friend"
    (FRIENDS / f"{slug}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return slug


def list_friends() -> list[dict[str, Any]]:
    out = []
    for p in sorted(FRIENDS.glob("*.json")) if FRIENDS.exists() else []:
        d = json.loads(p.read_text(encoding="utf-8"))
        out.append({"slug": p.stem, "owner": d.get("owner"), "exported": d.get("exported"), "artists": len(d["artists"])})
    return out


def _keys(a: dict[str, Any]) -> set[str]:
    return {k for k in (norm_name(a.get("name") or ""), norm_name(a.get("name_ko") or ""), a.get("channel_id")) if k}


def _cosine(a: Counter, b: Counter) -> float:
    keys = set(a) | set(b)
    dot = sum(a[k] * b[k] for k in keys)
    na, nb = math.sqrt(sum(v * v for v in a.values())), math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


async def compare(friend_slug: str, llm: LLM | None = None) -> dict[str, Any]:
    friend = json.loads((FRIENDS / f"{friend_slug}.json").read_text(encoding="utf-8"))
    me = export_map("나")

    def index(m: dict[str, Any]) -> dict[str, dict[str, Any]]:
        out = {}
        for a in m["artists"]:
            for k in _keys(a):
                out[k] = a
        return out

    mine, theirs = index(me), index(friend)
    my_known = {norm_name(n) for n in me["known"]} | set(mine)
    their_known = {norm_name(n) for n in friend.get("known", [])} | set(theirs)

    # 같은 판, 다른 길
    same, seen = [], set()
    for k, a in mine.items():
        b = theirs.get(k)
        if not b or a["name"] in seen or a.get("role") != "candidate" or b.get("role") != "candidate":
            continue
        seen.add(a["name"])
        pa, pb = (a["paths"] or [{}])[0], (b["paths"] or [{}])[0]
        same.append({"artist": a["name"], "name_ko": a.get("name_ko"), "thumb": a.get("thumb") or b.get("thumb"),
                     "mine": {"from": pa.get("from"), "edge": pa.get("edge"), "reaction": a.get("reaction")},
                     "theirs": {"from": pb.get("from"), "edge": pb.get("edge"), "reaction": b.get("reaction")},
                     "different_path": norm_name(pa.get("from") or "") != norm_name(pb.get("from") or "")})

    def gifts(src: dict[str, Any], other_known: set[str]) -> list[dict[str, Any]]:
        out = []
        for a in src["artists"]:
            if a.get("role") != "candidate" or a.get("reaction") not in ("like",) or (_keys(a) & other_known):
                continue
            p = (a["paths"] or [{}])[0]
            out.append({"artist": a["name"], "name_ko": a.get("name_ko"), "thumb": a.get("thumb"),
                        "from": p.get("from"), "edge": p.get("edge"), "quote": p.get("quote"),
                        "liked_for": [k for k, v in (a.get("aspects") or {}).items() if v > 0]})
        return out[:6]

    # 유사도: 아는 아티스트 겹침(자카드) · 디깅 스타일(연결 종류 분포) · 좋아한 측면
    jacc = len(my_known & their_known) / max(1, len(my_known | their_known))
    style = _cosine(Counter(p["edge"] for a in me["artists"] for p in a["paths"]),
                    Counter(p["edge"] for a in friend["artists"] for p in a["paths"]))
    asp = _cosine(Counter(k for a in me["artists"] for k, v in (a.get("aspects") or {}).items() if v > 0),
                  Counter(k for a in friend["artists"] for k, v in (a.get("aspects") or {}).items() if v > 0))
    # 아는 아티스트 수는 사람마다 차이가 커서 자카드는 낮게 나온다 → 제곱근으로 펴서 섞는다
    score = round(100 * (0.45 * math.sqrt(jacc) + 0.3 * style + 0.25 * asp))

    notes_summary = None
    if me["taste_notes"] and friend.get("taste_notes"):
        llm = llm or LLM()
        msg = await llm.chat("deepseek/deepseek-v4.1-flash", [
            {"role": "system", "content": "두 사람의 취향 메모만 보고 공통점 한 줄, 차이 한 줄을 쓴다. 메모에 없는 말은 쓰지 않는다. 해요체, 각 40자 안팎. "
                                          'JSON: {"common": "...", "different": "..."}'},
            {"role": "user", "content": json.dumps({"나": me["taste_notes"], friend.get("owner") or "친구": friend["taste_notes"]}, ensure_ascii=False)}],
            role="compare", json_mode=True, temperature=0.3, max_tokens=300, reasoning=False)
        try:
            notes_summary = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))  # type: ignore[union-attr]
        except (AttributeError, json.JSONDecodeError):
            notes_summary = None

    return {
        "friend": {"owner": friend.get("owner"), "exported": friend.get("exported")},
        "score": score,
        "parts": {"known_overlap": {"value": round(jacc, 3), "shared": len(my_known & their_known)},
                  "digging_style": round(style, 3), "liked_aspects": round(asp, 3)},
        "same_record_different_path": same,
        "from_friend": gifts(friend, my_known),
        "to_friend": gifts(me, their_known),
        "notes": notes_summary,
    }
