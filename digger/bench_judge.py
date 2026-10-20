"""검수 판정 모델 벤치. 웹을 다시 부르지 않고, 브리프에 저장된 원문 맥락으로 판정만 비교한다.

정답지:
- 통과(true): 지난 브리프에서 실제로 검수를 통과해 실린 근거.
- 불통과(false): 그 근거를 일부러 틀리게 만든 것 세 종류.
  swap  : 인용·맥락은 그대로 두고 후보를 다른 아티스트로 바꿈 (다른 아티스트 이야기)
  offtopic: 같은 원문에서 후보와 상관없는 문장을 인용으로 냄
  edge  : 연결 종류를 틀리게 적음 (평론가 글을 '본인 발언'으로, 본인 말을 '협업'으로)

지표: 정확도, 틀린 근거를 통과시킨 비율(가장 위험), 맞는 근거를 떨어뜨린 비율, 형식 깨짐, 비용, 시간.

실행: python -m digger.bench_judge --models qwen/qwen3.8-27b google/gemma-4-31b-it ...
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import time
from datetime import datetime
from typing import Any

from .config import BRIEFS, ROOT
from .llm import LLM
from .verifier import JUDGE_SYSTEM, parse_verdict

OUT = ROOT / "bench"
SENT = re.compile(r"(?<=[.!?다요])\s+")


def gold(seed: int = 7) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    pos: list[dict[str, Any]] = []
    for f in sorted(BRIEFS.glob("*.json")) + sorted((ROOT / "fixtures" / "briefs").glob("*.json")):
        for c in json.loads(f.read_text(encoding="utf-8"))["candidates"]:
            cl = (c.get("claims") or [{}])[0]
            if c["kind"] != "new" or not cl.get("context") or not (cl.get("verify") or {}).get("supports"):
                continue
            hop = c["path"][0]
            pos.append({"label": True, "kind": "real", "candidate": c["artist"], "names": [c["artist"], c.get("artist_ko") or ""],
                        "connected_to": hop["from"], "edge_type": cl.get("edge_type") or hop["edge"],
                        "claimed_connection": hop.get("connection"), "quote": cl["quote"],
                        "source_url": cl["source_url"], "source_context": cl["context"][:2400]})
    seen, uniq = set(), []
    for p in pos:   # 같은 아티스트가 두 날 실리면 하나만
        if p["candidate"] not in seen:
            seen.add(p["candidate"]); uniq.append(p)
    pos = uniq
    neg: list[dict[str, Any]] = []
    for i, p in enumerate(pos):
        # 평론 글은 문장 전체가 그 아티스트 이야기라 '무관 문장'을 뽑을 수 없다 → 바꿔치기·연결 종류만
        critic = p["edge_type"] in ("평론", "평론가 비교")
        kind = ["swap", "edge"][i % 2] if critic else ["swap", "offtopic", "edge"][i % 3]
        n = {**p, "label": False, "kind": kind}
        if kind == "swap":
            other = pos[(i + 1 + rng.randrange(len(pos) - 1)) % len(pos)]
            n.update(candidate=other["candidate"], connected_to=other["connected_to"], claimed_connection=other["claimed_connection"])
        elif kind == "offtopic":
            names = [x.lower() for x in p["names"] + [p["connected_to"]] if x]
            sents = [s.strip() for s in SENT.split(p["source_context"])
                     if 25 <= len(s.strip()) <= 140 and not any(x in s.lower() for x in names) and s.strip() not in p["quote"]]
            if not sents:
                continue
            n["quote"] = rng.choice(sents)
        else:
            n["edge_type"] = "본인 발언" if p["edge_type"] in ("평론", "평론가 비교") else "협업" if p["edge_type"] == "본인 발언" else "본인 발언"
        neg.append(n)
    # 실제로 가장 흔한 실수 = 다른 아티스트 이야기를 근거로 낸 것. 모든 근거마다 바꿔치기를 하나씩 더 (위에서 이미 swap인 것은 짝을 바꿔서)
    for i, p in enumerate(pos):
        if any(x["kind"] == "swap" and x["quote"] == p["quote"] for x in neg):
            continue
        other = pos[(i + 3) % len(pos)]
        neg.append({**p, "label": False, "kind": "swap", "candidate": other["candidate"], "connected_to": other["connected_to"],
                    "claimed_connection": other["claimed_connection"]})
    return pos + neg


async def judge_one(llm: LLM, model: str, case: dict[str, Any]) -> dict[str, Any]:
    payload = {k: case[k] for k in ("candidate", "connected_to", "edge_type", "claimed_connection", "quote", "source_url", "source_context")}
    messages = [{"role": "system", "content": JUDGE_SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]
    t0 = time.monotonic()
    verdict, err = None, None
    for _ in range(2):
        try:
            msg = await llm.chat(model, messages, role="bench_judge", json_mode=True, temperature=0, max_tokens=3000)
        except Exception as e:  # 한 문항 실패가 벤치를 멈추지 않게
            err = str(e)[:160]; continue
        verdict = parse_verdict(msg.get("content") or "")
        if verdict:
            break
    return {"kind": case["kind"], "label": case["label"], "candidate": case["candidate"], "edge_type": case["edge_type"],
            "pred": verdict[0] if verdict else None, "reason": verdict[1] if verdict else err, "sec": round(time.monotonic() - t0, 1)}


async def bench_model(model: str, cases: list[dict[str, Any]], conc: int = 6) -> dict[str, Any]:
    llm = LLM()
    sem = asyncio.Semaphore(conc)

    async def run(c: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            return await judge_one(llm, model, c)
    t0 = time.monotonic()
    res = await asyncio.gather(*(run(c) for c in cases))
    ok = [r for r in res if r["pred"] is not None]
    negs = [r for r in ok if not r["label"]]
    poss = [r for r in ok if r["label"]]
    return {
        "model": model, "n": len(cases), "parse_fail": len(res) - len(ok),
        "accuracy": round(sum(r["pred"] == r["label"] for r in ok) / len(cases), 3),
        # 균형 정확도: 맞는 근거와 틀린 근거 개수가 달라서 둘을 반반 반영한다
        "balanced": round(0.5 * (sum(r["pred"] for r in poss) / max(1, sum(1 for c in cases if c["label"]))
                                 + sum(not r["pred"] for r in negs) / max(1, sum(1 for c in cases if not c["label"]))), 3),
        "false_accept": round(sum(r["pred"] for r in negs) / max(1, len(negs)), 3),   # 틀린 근거를 통과시킨 비율
        "false_reject": round(sum(not r["pred"] for r in poss) / max(1, len(poss)), 3),
        "by_kind": {k: f"{sum(r['pred'] == r['label'] for r in ok if r['kind'] == k)}/{sum(1 for r in res if r['kind'] == k)}" for k in ("real", "swap", "offtopic", "edge")},
        "cost_usd": round(llm.usage.cost_usd, 4), "seconds": round(time.monotonic() - t0, 1),
        "avg_sec": round(sum(r["sec"] for r in res) / len(res), 1), "rows": res,
    }


def to_md(rows: list[dict[str, Any]], n: int) -> str:
    head = f"정답지 {n}문항\n\n" + \
        "| 모델 | 균형 정확도 | 정확도 | 틀린 근거 통과 | 맞는 근거 탈락 | 실제(정답 통과) | 바꿔치기 | 무관 문장 | 연결 종류 | 형식 깨짐 | 비용 | 문항당 |\n|---|---|---|---|---|---|---|---|---|---|---|---|"
    body = [f"| {r['model']} | {r['balanced']} | {r['accuracy']} | {r['false_accept']} | {r['false_reject']} | {r['by_kind']['real']} | {r['by_kind']['swap']} | "
            f"{r['by_kind']['offtopic']} | {r['by_kind']['edge']} | {r['parse_fail']} | ${r['cost_usd']} | {r['avg_sec']}s |" for r in rows]
    return "\n".join([head, *body])


async def main_async(models: list[str]) -> None:
    cases = gold()
    OUT.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    print(f"정답지 {len(cases)}문항: 통과 {sum(c['label'] for c in cases)}, 불통과 {sum(not c['label'] for c in cases)}", flush=True)
    rows = []
    for m in models:
        print(f"===== {m}", flush=True)
        rows.append(await bench_model(m, cases))
        print(json.dumps({k: v for k, v in rows[-1].items() if k != "rows"}, ensure_ascii=False), flush=True)
        (OUT / f"judge-{stamp}.json").write_text(json.dumps({"cases": cases, "results": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / f"judge-{stamp}.md").write_text(f"# 검수 판정 벤치 ({stamp})\n\n{to_md(rows, len(cases))}\n", encoding="utf-8")
    print(to_md(rows, len(cases)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--dry", action="store_true", help="정답지만 만들어 보여 준다")
    a = ap.parse_args()
    if a.dry:
        for c in gold():
            print(c["label"], c["kind"], c["candidate"], c["edge_type"], "|", c["quote"][:70])
        return
    asyncio.run(main_async(a.models))


if __name__ == "__main__":
    main()
