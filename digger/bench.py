"""리서처 모델 미니 벤치 (계획서 6주차). 같은 과제(목표 N명, 저장 없음)를 모델마다 돌려 비교한다.

지표: 통과 후보 수, 인용 글자 일치율(검수 1단계), 판정 통과율(검수 2단계), 도구 오류, 비용, 시간.

실행: python -m digger.bench [--target 3] [--models a b c]
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime
from typing import Any

from . import audit
from .config import ROOT, Settings
from .pipeline import run

DEFAULT_MODELS = ["z-ai/glm-5.3", "deepseek/deepseek-v4-pro-0813", "moonshotai/kimi-k3"]
OUT = ROOT / "bench"


async def bench_one(model: str, target: int, judge: str | None = None) -> dict[str, Any]:
    s = Settings()
    s.models.researcher = model
    if judge:
        s.models.judge = judge
    s.budget.new_artists = target
    s.budget.hidden_tracks = 0
    events: list[dict[str, Any]] = []
    unsub = audit.subscribe(lambda e: events.append(e) if e["kind"] in ("verify", "tool", "candidate") else None)
    try:
        brief = await run(s, playlist=False, write=False, tag=f"bench:{model}")
        error = None
    except Exception as e:  # 한 모델이 실패해도 벤치는 계속
        brief, error = None, f"{type(e).__name__}: {e}"
    finally:
        unsub()
    verifies = [e for e in events if e["kind"] == "verify"]
    rejected_by = {}
    for e in events:
        if e["kind"] == "candidate" and e["status"] == "rejected":
            rejected_by[e.get("stage", "?")] = rejected_by.get(e.get("stage", "?"), 0) + 1
    r = (brief or {}).get("run", {})
    accepted = r.get("accepted", 0)
    return {
        "model": model, "judge": s.models.judge, "error": error, "accepted": accepted, "target": target,
        "verbatim_rate": round(sum(e["verbatim"] for e in verifies) / len(verifies), 2) if verifies else None,
        "supports_rate": round(sum(e["supports"] for e in verifies if e["verbatim"])
                               / max(1, sum(e["verbatim"] for e in verifies)), 2) if verifies else None,
        "verify_checks": len(verifies), "rejected_by_stage": rejected_by,
        "tool_calls": r.get("tool_calls"), "tool_errors": r.get("tool_errors"),
        "cost_usd": r.get("cost_usd"), "cost_per_accepted": round(r["cost_usd"] / accepted, 3) if accepted else None,
        # 하루 운영 비용 추정: 밤마다 새 아티스트 8명을 찾는다고 보고 후보당 비용 × 8
        "daily_usd": round(r["cost_usd"] / accepted * 8, 2) if accepted else None,
        "seconds": r.get("seconds"), "stop_reason": r.get("stop_reason"),
        # 다양성: 통과한 판들이 몇 명의 시드에서 출발했나
        "seeds_used": len({c["path"][0]["from"] for c in (brief or {}).get("candidates", []) if c["kind"] == "new"}),
        "candidates": [{"artist": c["artist"], "edge": c["path"][0]["edge"], "from": c["path"][0]["from"],
                        "quote": c["claims"][0]["quote"][:120], "source": c["claims"][0]["source_url"]}
                       for c in (brief or {}).get("candidates", []) if c["kind"] == "new"],
    }


def to_md(rows: list[dict[str, Any]]) -> str:
    head = "| 모델 | 통과 | 인용 글자 일치 | 판정 통과 | 도구 호출(오류) | 비용 | 후보당 | 하루(8명) | 한 달 | 시간 | 종료 |\n|---|---|---|---|---|---|---|---|---|---|---|"
    body = [f"| {r['model']} | {r['accepted']}/{r['target']} | {r['verbatim_rate']} | {r['supports_rate']} | "
            f"{r['tool_calls']}({r['tool_errors']}) | ${r['cost_usd']} | ${r['cost_per_accepted']} | ${r['daily_usd']} | "
            f"${round(r['daily_usd'] * 30, 1) if r['daily_usd'] else None} | {r['seconds']}s | "
            f"{r['stop_reason'] or r['error']} |" for r in rows]
    cands = []
    for r in rows:
        cands.append(f"\n### {r['model']}\n")
        cands += [f"- {c['from']} —[{c['edge']}]→ **{c['artist']}**: \"{c['quote']}\" ({c['source']})" for c in r["candidates"]]
    return "\n".join([head, *body, *cands])


async def main_async(models: list[str], target: int, judge: str | None = None, tag: str = "") -> None:
    OUT.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M") + (f"-{tag}" if tag else "")
    rows = []
    for m in models:
        print(f"\n===== {m} =====", flush=True)
        rows.append(await bench_one(m, target, judge))
        print(json.dumps({k: v for k, v in rows[-1].items() if k != "candidates"}, ensure_ascii=False), flush=True)
        (OUT / f"bench-{stamp}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / f"bench-{stamp}.md").write_text(f"# 리서처 모델 미니 벤치 ({stamp})\n\n" + to_md(rows), encoding="utf-8")
    print("\n" + to_md(rows))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=3)
    ap.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    ap.add_argument("--judge", help="검수 모델 (리서처와 다른 계열로)")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()
    asyncio.run(main_async(args.models, args.target, args.judge, args.tag))


if __name__ == "__main__":
    main()
