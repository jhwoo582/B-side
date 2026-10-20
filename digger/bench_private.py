"""개인 데이터 역할 벤치. 개인 정보를 직접 읽는 역할을 '온프레미스에 올릴 수 있는 크기'의 모델로 비교한다.

역할(전부 실제 코드·프롬프트 그대로, 저장은 하지 않는다):
- anon   : 익명화(새 역할). 손님 말·취향 메모 → 외부 리서처에게 넘길 '음악적 방향'. 개인 사정·원문 표현이 새면 실패.
- why    : 추천 이유 작성(writer.write_why). 검사(인용 대조·어색한 표현·지어내기)를 몇 번 만에 통과했나, 템플릿으로 떨어졌나.
- taste  : 취향 노트 정리(taste.refresh의 생성 부분). JSON 형식, 근거 id가 실제로 있는지.
- retort : 말대꾸 계획(retort.plan). JSON 형식, 답 길이·말투.
- chat   : 점원(chat.Chat). 저장하는 도구(취향 받아 적기·지도·오늘 밤·지금 찾기)는 가짜 성공으로 바꿔 끼운다.

실행: python -m digger.bench_private --models a b c [--tasks anon why taste retort chat]
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import re
import time
from datetime import datetime
from typing import Any

from . import anon as anon_mod, audit, chat as chat_mod, retort as retort_mod, taste as taste_mod, writer as writer_mod
from .config import BRIEFS, ROOT
from .llm import LLM
from .wiki import Wiki

OUT = ROOT / "bench"
CHECKER = "z-ai/glm-5.3"   # 방향 보존 채점 (오픈웨이트, 데이터 비저장 제공자)

# ---------------------------------------------------------------- 익명화

ANON_SYSTEM = anon_mod.SYSTEM   # 운영 코드와 같은 프롬프트

ANON_CASES = [   # said = 손님이 한 말, leak = 밖으로 나가면 안 되는 말
    {"said": ["요즘은 시험기간이라 좀 에너지있고 신나는게 듣고 싶다"], "leak": ["시험"]},
    {"said": ["회사에서 야근하면서 들을 건데 가사 없는 게 좋아요"], "leak": ["회사", "야근"]},
    {"said": ["남자친구랑 헤어지고 나서 너무 힘든데 위로되는 노래 없을까"], "leak": ["남자친구", "헤어", "힘든"]},
    {"said": ["엄마가 병원에 입원하셔서 마음이 무거워요. 조용한 거"], "leak": ["엄마", "병원", "입원"]},
    {"said": ["세이수미 같은 결 좋다, 이런 결 더", "보컬은 좋은데 너무 시끄러운 건 별로"], "leak": []},
    {"said": ["다음 주 토요일에 홍대에서 친구 민지랑 공연 보러 가는데 그 전에 들을 거"], "leak": ["토요일", "홍대", "민지", "친구"]},
]


def leaked(out: str, case: dict[str, Any]) -> list[str]:
    hits = [w for w in case["leak"] if w in out]
    for s in case["said"]:   # 원문 표현이 8자 이상 그대로 옮겨졌나
        t = re.sub(r"\s+", "", s)
        o = re.sub(r"\s+", "", out)
        if any(t[i:i + 8] in o for i in range(0, max(0, len(t) - 7))):
            hits.append(f"원문 그대로: {s[:20]}…")
            break
    return hits


async def task_anon(llm: LLM, model: str) -> dict[str, Any]:
    rows = []
    for case in ANON_CASES:
        payload = {"said_in_chat": case["said"], "taste_notes": [n["text"] for n in taste_mod.get_notes()["notes"]][:4]}
        msg = await llm.chat(model, [{"role": "system", "content": ANON_SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                             role="bench_anon", json_mode=True, temperature=0.2, max_tokens=400, reasoning=False)
        text = msg.get("content") or ""
        try:
            d = json.loads(re.search(r"\{.*\}", text, re.S).group(0))  # type: ignore[union-attr]
            out = (d.get("direction") or "") + " / " + ", ".join(d.get("avoid") or [])
        except (AttributeError, json.JSONDecodeError):
            rows.append({"said": case["said"], "ok_json": False, "out": text[:200], "leak": [], "kept": False}); continue
        chk = await llm.chat(CHECKER, [{"role": "system", "content": "원래 말의 음악적 의도(에너지·분위기·중시하는 것·피할 것)가 '방향'에 보존됐는지 본다. 개인 사정은 빠져야 정상이다. JSON: {\"kept\": true|false}"},
                                       {"role": "user", "content": json.dumps({"원래 말": case["said"], "방향": out}, ensure_ascii=False)}],
                             role="bench_check", json_mode=True, temperature=0, max_tokens=1500)   # 채점 모델은 생각 과정을 끌 수 없다
        kept = '"kept": true' in (chk.get("content") or "").replace("'", '"').lower() or '"kept":true' in (chk.get("content") or "").lower()
        rows.append({"said": case["said"], "ok_json": True, "out": out, "leak": leaked(out, case), "kept": kept})
    n = len(rows)
    return {"score": {"형식": f"{sum(r['ok_json'] for r in rows)}/{n}", "새지 않음": f"{sum(r['ok_json'] and not r['leak'] for r in rows)}/{n}",
                      "방향 보존": f"{sum(r['kept'] for r in rows)}/{n}"}, "rows": rows}

# ---------------------------------------------------------------- 추천 이유

def why_cases() -> list[dict[str, Any]]:
    out = []
    for f in sorted(BRIEFS.glob("*.json")):
        for c in json.loads(f.read_text(encoding="utf-8"))["candidates"]:
            if c["kind"] == "new" and c.get("claims") and (c["claims"][0].get("context")):
                out.append(c)
    seen, uniq = set(), []
    for c in out:
        if c["artist"] not in seen:
            seen.add(c["artist"]); uniq.append(c)
    return uniq[:10]


async def task_why(llm: LLM, model: str) -> dict[str, Any]:
    writer_mod.WHY_MODEL = model
    rows = []
    for c0 in why_cases():
        c = copy.deepcopy(c0)
        for k in ("why", "why_by", "display"):
            c.pop(k, None)
        events: list[dict[str, Any]] = []
        unsub = audit.subscribe(lambda e: events.append(e) if e["kind"] == "write" and e.get("artist") == c["artist"] else None)
        try:
            await writer_mod.write_why(llm, c, [])
        finally:
            unsub()
        why = c.get("why") or ""
        first_ok = bool(events and events[0].get("ok"))
        rows.append({"artist": c["artist"], "why_by": c.get("why_by"), "attempts": len(events), "first_ok": first_ok,
                     "pan": "판" in why and c.get("why_by") == "writer", "haeyo": why.rstrip().endswith(("요.", "요", "요!")),
                     "bad": [b for e in events for b in (e.get("bad_quotes") or [])][:3], "why": why})
    n = len(rows)
    return {"score": {"검사 통과(템플릿 아님)": f"{sum(r['why_by'] == 'writer' for r in rows)}/{n}",
                      "첫 시도 통과": f"{sum(r['first_ok'] for r in rows)}/{n}",
                      "'판' 사용": sum(r["pan"] for r in rows), "해요체": f"{sum(r['haeyo'] for r in rows if r['why_by'] == 'writer')}/{sum(r['why_by'] == 'writer' for r in rows)}"},
            "rows": rows}

# ---------------------------------------------------------------- 취향 노트

async def task_taste(llm: LLM, model: str, reps: int = 3) -> dict[str, Any]:
    data = taste_mod._load()
    reactions = Wiki().reactions()
    ids = {r["id"] for r in reactions}
    payload = {"reactions": [{k: r.get(k) for k in ("id", "artist", "date", "reaction", "aspects", "next", "source_good", "reason",
                                                    "came_from", "edge", "source_name", "kind", "listen")} for r in reactions],
               "locked": [n["text"] for n in data["notes"] if n.get("by") == "user"], "rejected": data["rejected"]}
    rows = []
    for _ in range(reps):
        msg = await llm.chat(model, [{"role": "system", "content": taste_mod.SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False, default=str)}],
                             role="bench_taste", json_mode=True, temperature=0.3, max_tokens=1500, reasoning=False)
        try:
            notes = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0))["notes"]  # type: ignore[union-attr]
        except (AttributeError, KeyError, json.JSONDecodeError):
            rows.append({"ok_json": False, "notes": []}); continue
        good = [n for n in notes if any(e in ids for e in n.get("evidence") or []) and n.get("text")]
        rows.append({"ok_json": True, "n": len(notes), "grounded": len(good), "pan": sum("판" in n.get("text", "") for n in notes),
                     "notes": [n.get("text") for n in notes]})
    ok = [r for r in rows if r["ok_json"]]
    return {"score": {"형식": f"{len(ok)}/{reps}", "근거 있는 메모 비율": round(sum(r["grounded"] for r in ok) / max(1, sum(r["n"] for r in ok)), 2),
                      "메모 수(평균)": round(sum(r["n"] for r in ok) / max(1, len(ok)), 1)}, "rows": rows}

# ---------------------------------------------------------------- 말대꾸

RETORTS = ["평론 말고 아티스트 본인이 한 말로 찾아줘", "더 낯선 쪽으로", "비슷한데 더 조용한 거", "이 이유는 잘 와닿지 않아요", "보컬은 좋은데 기타가 너무 시끄러워"]


async def task_retort(llm: LLM, model: str) -> dict[str, Any]:
    retort_mod.PLAN_MODEL = model
    base = why_cases()[0]
    rows = []
    for o in RETORTS:
        p = await retort_mod.plan(llm, base, o)
        fallback = p["reply"].startswith("알겠어요, 다른 길로")
        rows.append({"objection": o, "fallback": fallback, "reply": p["reply"], "direction": p["direction"][:160],
                     "short": len(p["reply"]) <= 80, "pan": "판" in p["reply"], "haeyo": "요" in p["reply"][-4:]})
    n = len(rows)
    return {"score": {"형식(기본 문장 아님)": f"{sum(not r['fallback'] for r in rows)}/{n}", "짧게": f"{sum(r['short'] for r in rows)}/{n}",
                      "'판' 사용": sum(r["pan"] for r in rows), "해요체": f"{sum(r['haeyo'] for r in rows)}/{n}"}, "rows": rows}

# ---------------------------------------------------------------- 점원

class DryChat(chat_mod.Chat):
    """저장하는 도구는 실제로 실행하지 않고 성공한 척한다 (지도·취향 노트·오늘 밤 표시를 건드리지 않는다)."""
    async def _dispatch(self, name: str, a: dict[str, Any]) -> Any:
        if name == "note_taste":
            return {"saved": [{"id": f"dry{i}", **x} for i, x in enumerate(a.get("items") or [])]}
        if name == "dig_now":
            return {"started": True, "note": "1~3분 뒤 오늘의 음악에 붙어요"}
        if name == "add_to_map":
            return {"added": a.get("name"), "sid": "S9"}
        if name == "set_tonight":
            return {"queued": a.get("name")}
        return await super()._dispatch(name, a)


CHATS = [   # 대화, 꼭 불러야 할 도구(하나라도), 부르면 안 되는 도구
    {"history": [{"role": "user", "content": "내 취향 어때?"}], "need": ["taste_overview"], "avoid": []},
    {"history": [{"role": "user", "content": "요즘 시험기간이라 에너지 있고 신나는 게 듣고 싶어"}], "need": ["note_taste"], "avoid": ["dig_now"]},
    {"history": [{"role": "user", "content": "요즘 시험기간이라 에너지 있고 신나는 게 듣고 싶어"},
                 {"role": "assistant", "content": "'에너지 있는 쪽'으로 적어 둘게요. 이 느낌으로 지금 한 곡 더 찾아올까요? 오늘 밤에도 이어서 찾아볼게요."},
                 {"role": "user", "content": "응 지금 찾아줘"}], "need": ["dig_now"], "avoid": []},
    {"history": [{"role": "user", "content": "실리카겔이 영향받은 음악은 뭐야?"}], "need": ["interview_mentions", "web_search", "find_in_page", "read_page"], "avoid": ["dig_now"]},
    {"history": [{"role": "user", "content": "Cocteau Twins는 어떤 밴드야? 원문으로 보여줘"}], "need": ["web_search", "find_in_page", "read_page", "artist_page", "interview_mentions"], "avoid": ["dig_now"]},
]


async def task_chat(llm: LLM, model: str) -> dict[str, Any]:
    chat_mod.MODEL = model
    rows = []
    for sc in CHATS:
        bot = DryChat(start_dig=lambda d, s: None)
        bot.llm = llm
        tools, answer, sources, err = [], "", [], None
        t0 = time.monotonic()
        try:
            async for e in bot.run(sc["history"]):
                if e["event"] == "step":
                    tools.append(e["tool"])
                if e["event"] == "answer":
                    answer, sources = e["text"], e.get("sources") or []
        except Exception as ex:   # 한 시나리오 실패가 벤치를 멈추지 않게
            err = str(ex)[:160]
        rows.append({"q": sc["history"][-1]["content"], "tools": tools, "need_ok": any(t in tools for t in sc["need"]),
                     "avoid_ok": not any(t in tools for t in sc["avoid"]), "cited": bool(sources) or "[S" in answer,
                     "pan": "판" in answer, "sec": round(time.monotonic() - t0, 1), "error": err, "answer": answer[:400]})
    n = len(rows)
    return {"score": {"필요한 도구 호출": f"{sum(r['need_ok'] for r in rows)}/{n}", "부르면 안 될 도구 피함": f"{sum(r['avoid_ok'] for r in rows)}/{n}",
                      "출처 표시": f"{sum(r['cited'] for r in rows[3:])}/{len(rows[3:])}", "'판' 사용": sum(r["pan"] for r in rows),
                      "평균 응답(초)": round(sum(r["sec"] for r in rows) / n, 1), "오류": sum(bool(r["error"]) for r in rows)}, "rows": rows}

# ---------------------------------------------------------------- 실행

TASKS = {"anon": task_anon, "why": task_why, "taste": task_taste, "retort": task_retort, "chat": task_chat}


async def main_async(models: list[str], tasks: list[str]) -> None:
    OUT.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    results: dict[str, Any] = {}
    for m in models:
        results[m] = {}
        for t in tasks:
            llm = LLM()
            t0 = time.monotonic()
            print(f"===== {m} · {t}", flush=True)
            try:
                r = await TASKS[t](llm, m)
            except Exception as e:  # 한 칸 실패가 벤치를 멈추지 않게
                r = {"score": {"오류": str(e)[:200]}, "rows": []}
            r["cost_usd"] = round(llm.usage.cost_usd, 4)
            r["seconds"] = round(time.monotonic() - t0, 1)
            results[m][t] = r
            print(json.dumps({"score": r["score"], "cost": r["cost_usd"], "sec": r["seconds"]}, ensure_ascii=False), flush=True)
            (OUT / f"private-{stamp}.json").write_text(json.dumps(results, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    md = [f"# 개인 데이터 역할 벤치 ({stamp})\n"]
    for t in tasks:
        keys = list(next(iter(results.values()))[t]["score"].keys())
        md.append(f"\n## {t}\n\n| 모델 | " + " | ".join(keys) + " | 비용 | 시간 |\n|" + "---|" * (len(keys) + 3))
        for m in models:
            r = results[m][t]
            md.append(f"| {m} | " + " | ".join(str(r["score"].get(k, "")) for k in keys) + f" | ${r['cost_usd']} | {r['seconds']}s |")
    (OUT / f"private-{stamp}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--tasks", nargs="+", default=list(TASKS))
    a = ap.parse_args()
    asyncio.run(main_async(a.models, a.tasks))


if __name__ == "__main__":
    main()
