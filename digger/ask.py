"""점원이 먼저 묻는 질문 — 기록이 엇갈리거나 비어 있는 곳을 골라 한 줄 질문으로 만든다.

LLM 없이 기록에서 바로 만든다:
- 청취가 엇갈린 판: 끝까지 들은 날도, 금방 넘긴 날도 있는 아티스트 → 좋아함/덜 신호
- 아직 모르는 취향 축: 유형 글자가 '?'인 축 → 그 축의 신호
- 덜 파 본 판: 찾은 판이 적은 시드인데 본인이 말한 뿌리가 남아 있음 → 오늘 밤 큐에 넣기
답은 취향 신호(taste.add_signals, source="ask")나 미개척지 큐로 저장된다. 답한 질문은 다시 묻지 않는다.
"""

from __future__ import annotations

import json
import os
from datetime import date
from typing import Any

from . import audit, frontier, taste
from .config import HOME
from .wiki import Wiki

PATH = HOME / "wiki" / "asked.json"
LIMIT = 3

# 아직 모르는 축 → (질문, [(보기, 신호 또는 None)])
AXIS_Q: dict[str, tuple[str, list[tuple[str, dict[str, Any] | None]]]] = {
    "energy": ("요즘은 조용한 쪽이 좋아요, 꽉 찬 쪽이 좋아요?", [
        ("조용한 쪽", {"kind": "less", "text": "꽉 찬 강렬한 소리", "axis": "에너지"}),
        ("꽉 찬 쪽", {"kind": "like", "text": "꽉 찬 강렬한 소리", "axis": "에너지"}),
        ("그때그때 달라요", None)]),
    "center": ("노래에서 먼저 귀에 들어오는 건 어느 쪽이에요?", [
        ("목소리", {"kind": "like", "text": "목소리가 중심인 노래", "axis": "보컬"}),
        ("사운드", {"kind": "like", "text": "소리의 질감이 중심인 음악", "axis": "사운드"}),
        ("둘 다 비슷해요", None)]),
    "texture": ("몽롱하게 번지는 쪽이 좋아요, 또렷하게 들리는 쪽이 좋아요?", [
        ("몽롱한 쪽", {"kind": "like", "text": "몽롱하게 번지는 분위기", "axis": "분위기"}),
        ("또렷한 쪽", {"kind": "like", "text": "또렷하게 들리는 노랫말", "axis": "가사"}),
        ("그때그때 달라요", None)]),
}


def _asked() -> dict[str, str]:
    return json.loads(PATH.read_text(encoding="utf-8")) if PATH.exists() else {}


def _mark(qid: str) -> None:
    d = _asked(); d[qid] = date.today().isoformat()
    PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PATH.with_suffix(".tmp"); tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8"); os.replace(tmp, PATH)


def _all() -> list[dict[str, Any]]:
    """지금 물을 수 있는 질문 전부 (답한 것 포함). 각 질문은 보기마다 할 일(do)을 갖는다."""
    w = Wiki()
    out: list[dict[str, Any]] = []
    # 청취가 엇갈린 판: 기록이 많은 순
    mixed = []
    for m in w.pages():
        sig = [x["signal"] for x in m.get("listens") or []]
        if "full" in sig and "skip" in sig:
            mixed.append((len(sig), m, sig.count("full"), sig.count("skip")))
    for _, m, full, skip in sorted(mixed, key=lambda t: -t[0])[:2]:
        name = m.get("name_ko") or m["name"]
        out.append({"id": f"listen:{m['name']}", "text": f"{name}, 끝까지 들은 날도 금방 넘긴 날도 있어요. 요즘은 어느 쪽이에요?",
                    "why": f"끝까지 {full}번 · 넘김 {skip}번",
                    "options": [("계속 좋아요", {"signal": {"kind": "like", "text": m["name"], "artist": m["name"]}}),
                                ("요즘은 덜 끌려요", {"signal": {"kind": "less", "text": m["name"], "artist": m["name"]}}),
                                ("곡마다 달라요", {})]})
    # 아직 모르는 축
    for ax in taste.taste_type()["axes"]:
        if not ax["known"] and ax["key"] in AXIS_Q:
            q, opts = AXIS_Q[ax["key"]]
            out.append({"id": f"axis:{ax['key']}", "text": q, "why": f"취향 유형의 {ax['label']} 글자가 아직 비어 있어요",
                        "options": [(label, {"signal": s} if s else {}) for label, s in opts]})
    # 덜 파 본 판 + 본인이 말한 뿌리
    g = w.graph()
    found = {n["id"]: sum(1 for e in g["edges"] if e["source"] == n["id"]) for n in g["nodes"] if n["role"] == "seed"}
    names = {n["id"]: n.get("name_ko") or n["id"] for n in g["nodes"]}
    leads = [x for x in frontier.load() if x["status"] == "open" and x["from"] in found]
    leads.sort(key=lambda x: (found[x["from"]], x["direction"] != "root"))
    for x in leads[:1]:
        out.append({"id": f"lead:{x['id']}", "text": f"{names[x['from']]}에서 이어진 음악은 아직 {found[x['from']]}개예요. {x.get('name_ko') or x['name']} 쪽도 파 볼까요?",
                    "why": x["hint"],
                    "options": [("오늘 밤 큐에 넣어 줘요", {"queue": x["id"]}), ("이번엔 괜찮아요", {})]})
    return out


def questions() -> list[dict[str, Any]]:
    asked = _asked()
    left = [q for q in _all() if q["id"] not in asked]
    # 종류마다 하나씩 먼저 (청취 → 축 → 큐), 남는 칸은 나머지로
    kinds = list(dict.fromkeys(q["id"].split(":")[0] for q in left))
    first = [next(q for q in left if q["id"].startswith(k + ":")) for k in kinds]
    picked = (first + [q for q in left if q not in first])[:LIMIT]
    return [{"id": q["id"], "text": q["text"], "why": q["why"], "options": [label for label, _ in q["options"]]} for q in picked]


def answer(qid: str, choice: int | None, text: str = "") -> dict[str, Any]:
    q = next((x for x in _all() if x["id"] == qid), None)
    if not q:
        raise KeyError(qid)
    text = text.strip()
    if choice is None and not text:
        raise ValueError("보기를 고르거나 직접 말해 주세요")
    do: dict[str, Any] = q["options"][choice][1] if choice is not None and 0 <= choice < len(q["options"]) else {}
    items = [do["signal"]] if do.get("signal") else []
    if text:   # 직접 한 말: 요즘 기분으로 받아 적는다 (5일 뒤 흐려진다)
        items.append({"kind": "mood", "text": text[:40], "said": text})
    added = taste.add_signals(items, source="ask") if items else []
    queued = None
    if do.get("queue"):
        q_ids = [x["id"] for x in frontier.queued()]
        if do["queue"] not in q_ids and len(q_ids) < frontier.MAX_QUEUE:
            frontier.set_queue(q_ids + [do["queue"]]); queued = do["queue"]
    _mark(qid)
    audit.emit("ask_answer", qid=qid, choice=choice, custom=bool(text), signals=len(added), queued=bool(queued))
    return {"ok": True, "signals": [x["text"] for x in added], "queued": queued}
