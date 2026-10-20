"""취향 노트 — '에이전트가 기억하는 너'.

위키에 쌓인 반응(측면 칩·다음 행동·메모)을 근거로 LLM이 취향을 몇 문장으로 정리한다.
- 문장마다 근거 반응 id가 붙는다. 없는 id를 댄 문장, 근거가 없는 문장은 코드가 버린다.
- 사용자가 고친 문장(by=user)은 LLM이 덮어쓰지 못한다. 사용자가 지운 문장은 '다시 쓰지 말 것'으로 넘긴다.
- 밤의 리서처는 이 노트를 읽고 시작한다 → 기억이 제외 목록이 아니라 에이전트의 판단 입력이 된다.

파일: wiki/취향_노트.md (사람이 읽는 본문 + frontmatter에 구조화된 노트).
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date
from typing import Any

import frontmatter

from . import audit
from .config import WIKI
from .llm import LLM
from .wiki import NEXT, Wiki

PATH = WIKI.parent / "취향_노트.md"
MODEL = os.environ.get("DIGGER_TASTE_MODEL", os.environ.get("DIGGER_LOCAL_MODEL", "google/gemma-4-31b-it"))   # 반응 기록 전체를 읽는다 → 로컬

SYSTEM = """너는 동네 레코드 가게 사장님이다. 단골손님이 남긴 반응 기록을 보고, 이 손님의 취향을 '가게 메모'로 정리한다.

규칙:
- 반응 기록에 있는 것만 쓴다. 각 메모에는 근거가 된 반응 id를 1개 이상 붙인다(evidence). 근거 없는 추측 금지.
- 장르 이름으로 뭉뚱그리지 말고, 손님이 실제로 짚은 것(보컬·기타 톤·리듬·가사·분위기·녹음 질감, 메모의 표현)으로 쓴다.
- kind=retort 기록은 손님이 추천 이유에 반박한 말이다. 무엇이 싫은지·어느 쪽을 원하는지 드러나는 강한 근거다.
- kind=listen 기록은 턴테이블 청취 자동 기록(끝까지 들음/넘김)이다. 약한 신호라 이것만으로 단정하지 말고,
  직접 누른 반응과 겹칠 때 근거를 보태는 용도로 쓴다.
- 좋아하는 것뿐 아니라 싫어하는 것, '이 길로 더 파줘'로 보인 방향, 좋아한 출처(매체·평론가)도 메모가 될 수 있다.
- 반응이 하나뿐이면 '아직 한 번' 같은 조심스러운 표현을 쓴다. 두 번 이상 겹치면 단정해도 된다.
- locked 메모는 손님이 직접 고친 것이라 그대로 두고, 그것과 겹치는 새 메모는 쓰지 않는다.
- rejected 메모는 손님이 틀렸다고 지운 것이다. 같은 내용을 다시 쓰지 않는다.
- 메모는 3~7개, 한 문장씩, 메모체(~함)로 짧게(40자 안팎).

JSON 하나만 출력: {"notes": [{"text": "...", "evidence": ["<반응 id>", ...]}]}"""


def _load() -> dict[str, Any]:
    if not PATH.exists():
        return {"notes": [], "rejected": [], "updated": None, "signals": [], "rejected_signals": [], "summary": None}
    meta = frontmatter.load(PATH).metadata
    return {"notes": meta.get("notes") or [], "rejected": meta.get("rejected") or [], "updated": meta.get("updated"),
            "signals": meta.get("signals") or [], "rejected_signals": meta.get("rejected_signals") or [],
            "summary": meta.get("summary")}


def _save(data: dict[str, Any]) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# 취향 노트 — 에이전트가 기억하는 너", "",
             "디깅 반응을 근거로 정리한 메모. 밤마다 리서처가 이 메모를 읽고 출발한다.", ""]
    for n in data["notes"]:
        tag = " (내가 고침)" if n.get("by") == "user" else ""
        lines.append(f"- {n['text']}{tag}")
        for e in n.get("evidence_view") or []:
            lines.append(f"  - 근거: {e}")
    if data.get("summary"):
        lines[3:3] = [f"> {data['summary']}", ""]
    sig = [x for x in data.get("signals") or [] if x.get("active", True)]
    if sig:
        lines += ["", "## 대화에서 받아 적은 취향", ""] + [f"- [{KIND_KO.get(x['kind'], x['kind'])}] {x['text']} — “{x.get('said') or ''}” ({x['date']})" for x in sig]
    if data["rejected"]:
        lines += ["", "## 틀렸다고 지운 메모", ""] + [f"- ~~{t}~~" for t in data["rejected"]]
    post = frontmatter.Post("\n".join(lines) + "\n", **data)
    PATH.write_text(frontmatter.dumps(post), encoding="utf-8")


def _evidence_view(r: dict[str, Any]) -> str:
    bits = [f"{r['artist']} ({r['date']})"]
    if r.get("kind") == "listen":
        return " · ".join(bits + [r["listen"]])
    if r.get("aspects"):
        bits.append(", ".join(f"{k}{'👍' if v > 0 else '👎'}" for k, v in r["aspects"].items()))
    if r.get("next"):
        bits.append(NEXT[r["next"]])
    if r.get("source_good") and r.get("source_name"):
        bits.append(f"출처 좋음: {r['source_name']}")
    if r.get("reason"):
        bits.append(f"“{r['reason']}”")
    return " · ".join(bits)


def get_notes() -> dict[str, Any]:
    data = _load()
    return {**data, "signals": [x for x in data["signals"] if _active(x)], "radar": radar(), "type": taste_type()}


async def refresh(llm: LLM | None = None) -> dict[str, Any]:
    """반응 기록으로 노트를 다시 정리한다. 사용자가 고친 노트는 유지."""
    llm = llm or LLM()
    data = _load()
    reactions = Wiki().reactions()
    if not reactions:
        return data
    by_id = {r["id"]: r for r in reactions}
    locked = [n for n in data["notes"] if n.get("by") == "user"]
    payload = {
        "reactions": [{k: r.get(k) for k in ("id", "artist", "date", "reaction", "aspects", "next", "source_good",
                                             "reason", "came_from", "edge", "source_name", "kind", "listen")} for r in reactions],
        "locked": [n["text"] for n in locked],
        "rejected": data["rejected"],
    }
    msg = await llm.chat(MODEL, [{"role": "system", "content": SYSTEM},
                                 {"role": "user", "content": json.dumps(payload, ensure_ascii=False, default=str)}],
                         role="taste", json_mode=True, temperature=0.3, max_tokens=1500, reasoning=False)
    try:
        raw = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))["notes"]  # type: ignore[union-attr]
    except (AttributeError, KeyError, json.JSONDecodeError):
        audit.emit("taste_refresh", ok=False, error="응답 해석 실패")
        return data
    fresh, dropped = [], 0
    for n in raw[:7]:
        ev = [e for e in n.get("evidence") or [] if e in by_id]
        text = str(n.get("text", "")).strip()[:120]
        if not ev or not text or text in data["rejected"]:
            dropped += 1  # 근거 없는 메모는 버린다
            continue
        fresh.append({"id": uuid.uuid4().hex[:8], "text": text, "evidence": ev, "by": "agent",
                      "evidence_view": [_evidence_view(by_id[e]) for e in ev]})
    for n in locked:  # 고친 메모의 근거 표시는 최신으로
        n["evidence_view"] = [_evidence_view(by_id[e]) for e in n.get("evidence") or [] if e in by_id]
    data["notes"] = locked + fresh
    data["updated"] = date.today().isoformat()
    _save(data)
    audit.emit("taste_refresh", ok=True, notes=len(data["notes"]), dropped=dropped, locked=len(locked))
    await summarize(llm)
    return _load()


def edit(note_id: str, text: str) -> dict[str, Any]:
    data = _load()
    for n in data["notes"]:
        if n["id"] == note_id:
            n["text"], n["by"] = text.strip()[:200], "user"
            _save(data)
            return data
    raise KeyError(note_id)


def remove(note_id: str) -> dict[str, Any]:
    data = _load()
    keep = [n for n in data["notes"] if n["id"] != note_id]
    if len(keep) == len(data["notes"]):
        raise KeyError(note_id)
    gone = next(n for n in data["notes"] if n["id"] == note_id)
    if gone.get("by") == "agent":
        data["rejected"].append(gone["text"])  # 에이전트가 쓴 걸 지우면 '틀렸다'로 기억
    data["notes"] = keep
    _save(data)
    return data


def for_researcher() -> dict[str, Any]:
    """리서처에게 넘길 기억: 취향 노트 + 좋아한 출처."""
    data = _load()
    good_sources = sorted({r["source_name"] for r in Wiki().reactions() if r.get("source_good") and r.get("source_name")})
    return {"taste_notes": [n["text"] for n in data["notes"]], "liked_sources": good_sources,
            "rejected_guesses": data["rejected"][-5:], "summary": data.get("summary"),
            # 손님이 대화에서 직접 말한 취향: like는 찾고, less는 피하고, mood는 요즘 기분으로 우선한다
            "signals": [{"kind": x["kind"], "text": x["text"], "said": x.get("said"), "date": x["date"]} for x in signals()]}


# ---------------------------------------------------------------- 취향 신호 (대화에서 받아 적은 것)
# 디깅 도우미와 대화하다 손님이 말한 취향을 짧은 신호로 저장한다. 다음 디깅의 리서처와 '좋아할 것 같은 이유'가 이걸 읽는다.
# kind: like(좋아함) | less(덜) | mood(요즘 기분 — 5일 뒤 흐려진다). axis: 레이더 축 중 하나(없어도 됨). said: 손님이 실제로 한 말.

AXES = ["보컬", "사운드", "분위기", "가사", "에너지"]   # 에너지는 방향 축: + 강렬한 쪽, - 조용한 쪽
KIND_KO = {"like": "좋아함", "less": "덜", "mood": "요즘"}
MOOD_DAYS = 5


def _active(x: dict[str, Any]) -> bool:
    if not x.get("active", True):
        return False
    if x["kind"] == "mood":
        return (date.today() - date.fromisoformat(x["date"])).days <= MOOD_DAYS
    return True


def signals() -> list[dict[str, Any]]:
    return [x for x in _load()["signals"] if _active(x)]


def add_signals(items: list[dict[str, Any]], source: str = "chat") -> list[dict[str, Any]]:
    data = _load()
    have = {x["text"] for x in data["signals"] if _active(x)}
    added = []
    for it in items:
        kind = it.get("kind")
        text = str(it.get("text") or "").strip()[:40]
        if kind not in KIND_KO or not text or text in have or text in data["rejected_signals"]:
            continue
        axis = it.get("axis") if it.get("axis") in AXES else None
        pol = 1 if kind == "like" else -1 if kind == "less" else (1 if int(it.get("polarity") or 1) >= 0 else -1)
        x = {"id": uuid.uuid4().hex[:8], "kind": kind, "text": text, "axis": axis, "polarity": pol,
             "said": str(it.get("said") or "")[:120], "artist": it.get("artist"), "date": date.today().isoformat(),
             "source": source, "active": True}
        data["signals"].append(x); have.add(text); added.append(x)
    if added:
        _save(data)
        audit.emit("taste_signal", added=[x["text"] for x in added])
    return added


def remove_signal(sid: str) -> dict[str, Any]:
    data = _load()
    for x in data["signals"]:
        if x["id"] == sid and x.get("active", True):
            x["active"] = False
            data["rejected_signals"].append(x["text"])   # 틀렸다고 지운 건 다시 적지 않는다
            _save(data)
            return data
    raise KeyError(sid)


def radar() -> list[dict[str, Any]]:
    """레이더 차트: 축마다 0~1 (0.5 = 아직 모름). 직접 누른 반응의 측면 칩 + 대화 신호로 계산한다 (LLM 없음)."""
    import math
    score = {a: 0.0 for a in AXES}
    count = {a: 0 for a in AXES}
    for r in Wiki().reactions():
        sign = 1 if r.get("reaction") == "like" else -1 if r.get("reaction") == "dislike" else 0
        for k, v in (r.get("aspects") or {}).items():
            if k in score and sign:
                score[k] += 1.0 * sign * (1 if v > 0 else -1); count[k] += 1
    for x in signals():
        if x.get("axis"):
            score[x["axis"]] += 1.5 * x["polarity"]; count[x["axis"]] += 1
    return [{"axis": a, "value": round(0.5 + 0.5 * math.tanh(score[a] / 3), 3), "evidence": count[a]} for a in AXES]


SUMMARY_SYSTEM = """너는 레코드 가게 사장님이다. 단골손님의 취향 기록을 보고 '이 손님은 이런 음악을 좋아해요'를 두 문장으로 다듬는다.
- 기록(notes, signals, radar)에 있는 것만. 장르 이름으로 뭉뚱그리지 말고 손님이 짚은 표현을 살린다.
- 1문장: 좋아하는 것. 2문장: 덜 듣고 싶은 것이나 요즘 기분(있을 때만). 해요체, 높임 '-시-' 없이, 합쳐서 90자 안팎.
JSON 하나만: {"summary": "..."}"""


async def summarize(llm: LLM | None = None) -> str | None:
    llm = llm or LLM()
    data = _load()
    payload = {"notes": [n["text"] for n in data["notes"]], "signals": [{"kind": KIND_KO[x["kind"]], "text": x["text"]} for x in signals()],
               "radar": radar()}
    if not payload["notes"] and not payload["signals"]:
        return None
    msg = await llm.chat(MODEL, [{"role": "system", "content": SUMMARY_SYSTEM},
                                 {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                         role="taste_summary", json_mode=True, temperature=0.4, max_tokens=300, reasoning=False)
    try:
        text = str(json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))["summary"]).strip()[:200]  # type: ignore[union-attr]
    except (AttributeError, KeyError, json.JSONDecodeError):
        return data.get("summary")
    data = _load(); data["summary"] = text; _save(data)
    return text


# ---------------------------------------------------------------- 취향 유형 (MBTI처럼 네 글자)
# 소리 축 네 개로 16가지. 기록이 없는 축은 '?'로 두고 억지로 정하지 않는다 (말하거나 반응하면 정해진다).
# 유형 표(이름·한 줄·장르·예시 아티스트)는 제품 문구로 고정해 둔다. 손님 데이터에서 나오는 건 축 위치와 '내 지도에서 이 유형다운 판'뿐이다.

TYPE_AXES = [
    {"key": "energy", "label": "에너지", "a": ("Q", "조용"), "b": ("L", "강렬")},
    {"key": "center", "label": "중심", "a": ("V", "목소리"), "b": ("S", "사운드")},
    {"key": "texture", "label": "결", "a": ("D", "몽롱"), "b": ("C", "선명")},
    {"key": "dig", "label": "디깅", "a": ("R", "뿌리"), "b": ("F", "바깥")},
]

TYPES: dict[str, dict[str, Any]] = {
    "QVDR": {"name": "새벽 라디오형", "line": "속삭이는 목소리와 흐릿한 공기, 그 목소리가 어디서 왔는지까지 따라가요.", "genres": ["드림팝", "베드룸 팝", "인디 포크"], "artists": ["Beach House", "Mazzy Star", "검정치마"]},
    "QVDF": {"name": "비 오는 창가형", "line": "나른한 목소리를 틀어 두고, 처음 듣는 이름을 계속 넘겨 봐요.", "genres": ["인디 팝", "로파이", "네오 소울"], "artists": ["Clairo", "백예린", "Men I Trust"]},
    "QVCR": {"name": "손편지 낭독형", "line": "또박또박한 노랫말에 귀를 기울이고, 그 말을 만든 사람의 뿌리를 찾아요.", "genres": ["포크", "싱어송라이터", "모던 포크"], "artists": ["Nick Drake", "김사월", "Elliott Smith"]},
    "QVCF": {"name": "일기장 수집가형", "line": "누군가의 솔직한 이야기를 모으듯, 새 목소리를 찾아 다녀요.", "genres": ["인디 발라드", "어쿠스틱", "얼터너티브 포크"], "artists": ["이랑", "Phoebe Bridgers", "Adrianne Lenker"]},
    "QSDR": {"name": "다락방 레코드형", "line": "목소리보다 소리의 결. 겹겹이 깔린 기타 안개 속에서 원류를 캐요.", "genres": ["슈게이즈", "드림팝", "앰비언트"], "artists": ["Slowdive", "Cocteau Twins", "파란노을"]},
    "QSDF": {"name": "안개 산책형", "line": "흐르는 소리에 몸을 맡기고, 낯선 풍경 쪽으로 계속 걸어가요.", "genres": ["앰비언트 팝", "일렉트로니카", "다운템포"], "artists": ["Brian Eno", "Tycho", "Boards of Canada"]},
    "QSCR": {"name": "재즈 바 단골형", "line": "조용하지만 또렷한 연주. 오래된 명반을 거슬러 들어요.", "genres": ["재즈", "보사노바", "체임버 팝"], "artists": ["Bill Evans", "Chet Baker", "João Gilberto"]},
    "QSCF": {"name": "미술관 오디오가이드형", "line": "정교하게 짜인 소리를 감상하듯, 새로운 작법을 찾아다녀요.", "genres": ["네오클래식", "미니멀", "실험 팝"], "artists": ["Nils Frahm", "Ólafur Arnalds", "류이치 사카모토"]},
    "LVDR": {"name": "한밤의 무대형", "line": "몽롱하지만 꽉 찬 사운드, 그 위의 목소리. 영향받은 밴드까지 파고들어요.", "genres": ["사이키델릭 팝", "아트록", "브릿팝"], "artists": ["Tame Impala", "HYUKOH", "MGMT"]},
    "LVDF": {"name": "네온 드라이브형", "line": "반짝이는 목소리와 리듬, 새로 나온 음악부터 먼저 틀어요.", "genres": ["신스팝", "인디 록", "인디 댄스"], "artists": ["새소년", "The 1975", "Phoenix"]},
    "LVCR": {"name": "떼창 앞줄형", "line": "다 같이 따라 부를 수 있는 선명한 목소리. 그 밴드가 들었던 펑크까지 찾아가요.", "genres": ["펑크", "개러지 록", "포스트펑크"], "artists": ["크라잉넛", "The Strokes", "노브레인"]},
    "LVCF": {"name": "확성기형", "line": "또렷하게 꽂히는 말과 에너지. 지금 가장 새로운 목소리를 찾아요.", "genres": ["힙합", "얼터너티브 R&B", "랩 록"], "artists": ["E SENS", "Kendrick Lamar", "빈지노"]},
    "LSDR": {"name": "굉음 속 명상형", "line": "벽처럼 쌓인 노이즈 안에서 길을 잃는 게 좋아요. 그 소리의 뿌리를 캐요.", "genres": ["슈게이즈", "노이즈 팝", "사이키델릭 록"], "artists": ["My Bloody Valentine", "Silica Gel", "DIIV"]},
    "LSDF": {"name": "우주 비행형", "line": "끝없이 부풀어 오르는 연주를 타고 낯선 곳으로 날아가요.", "genres": ["포스트록", "크라우트록", "일렉트로닉"], "artists": ["Mogwai", "잠비나이", "Explosions in the Sky"]},
    "LSCR": {"name": "합주실 단골형", "line": "정교하게 맞물리는 연주와 변박. 그 연주자들의 뿌리를 파요.", "genres": ["매스록", "포스트하드코어", "재즈 록"], "artists": ["toe", "black midi", "King Crimson"]},
    "LSCF": {"name": "실험실 폭주형", "line": "선명하고 거친 소리 실험. 처음 듣는 조합일수록 반가워요.", "genres": ["얼터너티브 록", "익스페리멘탈", "브레이크비트"], "artists": ["Radiohead", "Battles", "이디오테잎"]},
}


def taste_type() -> dict[str, Any]:
    """네 축의 위치(-1~1, 0이면 모름)와 유형. 반응 측면·대화 신호·좋아한 판이 온 길로 계산한다 (LLM 없음)."""
    import math
    r = {x["axis"]: x["value"] - 0.5 for x in radar()}            # -0.5~0.5
    ev = {x["axis"]: x["evidence"] for x in radar()}
    # 디깅: 좋아한 판이 본인 발언(뿌리)으로 왔나, 평론·협업(바깥)으로 왔나 + 미개척지에서 고른 방향
    roots = branch = 0.0
    for rx in Wiki().reactions():
        if rx.get("reaction") == "like" and rx.get("edge"):
            if rx["edge"] == "본인 발언":
                roots += 1
            else:
                branch += 1
    try:
        from . import frontier
        for x in frontier.load():
            if x["status"] in ("dug", "queued"):
                roots += 0.7 if x["direction"] == "root" else 0
                branch += 0.7 if x["direction"] != "root" else 0
    except Exception:
        pass
    raw = {
        "energy": (r["에너지"], ev["에너지"]),
        "center": (r["사운드"] - r["보컬"], ev["사운드"] + ev["보컬"]),
        "texture": (r["가사"] - r["분위기"], ev["가사"] + ev["분위기"]),
        "dig": (math.tanh((branch - roots) / 2) * 0.5, int(roots + branch)),
    }
    axes, code = [], ""
    for ax in TYPE_AXES:
        v, n = raw[ax["key"]]
        known = abs(v) > 0.02 and n > 0
        side = ax["b"] if v > 0 else ax["a"]
        axes.append({"key": ax["key"], "label": ax["label"], "left": ax["a"][1], "right": ax["b"][1],
                     "value": round(max(-1, min(1, v * 2)), 3), "known": known, "letter": side[0] if known else "?",
                     "evidence": int(n), "weak": known and n <= 2,
                     "assumed": None if known else ax["a"][1]})   # 모르는 축은 이름을 고를 때 왼쪽(예: 조용)으로 가정했다
        code += side[0] if known else ax["a"][0]   # 모르는 축은 왼쪽 글자로 임시 유형 (화면엔 ?로)
    t = TYPES[code]
    mine = [m.get("name_ko") or m["name"] for m in Wiki().pages()
            if (m.get("reactions") or [{}])[-1].get("reaction") == "like" or m.get("role") == "seed"]
    return {"code": "".join(a["letter"] for a in axes), "base": code, **t, "axes": axes,
            "unknown": [a["label"] for a in axes if not a["known"]], "mine": mine[:6]}
