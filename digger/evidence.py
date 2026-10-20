"""더 읽을 근거 — 판마다 원문 근거를 2~3개로 늘린다 (라이너 노트의 '이어지는 글').

리서처가 붙인 근거(평론 심사평 등) 하나로는 '왜 이 판인지'가 얇다. 판이 정해진 뒤 따로:
1. 검색: '<아티스트> 인터뷰', '<아티스트> 리뷰 앨범' (웹진·인터뷰 기사)
2. 그 아티스트 이름이 나오는 문장을 원문에서 모은다 (코드)
3. 작은 모델이 그중 '음악이나 아티스트를 설명하는 문장', '본인이 한 말'을 최대 2개 고르고 누가 한 말인지 붙인다
4. 고른 문장이 원문에 글자 그대로 있는지 코드가 다시 대조한다 (통과한 것만 저장)

저장: candidate["more_evidence"] = [{quote, url, source_name, kind(인터뷰|리뷰|기사), speaker, context}]
실행: python -m digger.evidence --date 2026-10-12   (기존 브리프에 채우기)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from typing import Any
from urllib.parse import urlparse

from . import audit
from .config import BRIEFS
from .llm import LLM
from .sources.common import ToolFailure
from .sources.web import SENTENCE_SPLIT, Web
from .verifier import context_around, normalize, verbatim

MODEL = os.environ.get("DIGGER_WRITER_MODEL", "deepseek/deepseek-v4.1-flash")
SKIP_HOSTS = ("youtube.com", "music.youtube.com", "spotify.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "namu.wiki", "melon.com", "genie.co.kr")

PICK_SYSTEM = """음악 앱이 한 아티스트를 추천하며 '더 읽을 근거'를 보여 준다. 웹 문서에서 모은 문장 후보를 받는다.
그중 최대 2개를 고른다:
- 아티스트의 음악(사운드·가사·분위기·앨범)을 구체적으로 설명하는 평론·기사 문장, 또는 아티스트 본인이 자기 음악에 대해 한 말.
- 홍보 문구, 공연 일정, 단순 사실 나열(발매일·소속사), 다른 아티스트 이야기는 고르지 않는다.
- 이미 쓰인 근거(existing)와 같은 내용은 고르지 않는다. 좋은 문장이 없으면 빈 목록.
각 항목: i(문장 번호), kind(인터뷰|리뷰|기사), speaker(누가 한 말인지 문서에서 확인되면 이름, 아니면 빈 문자열).
JSON 하나만: {"items": [{"i": 0, "kind": "리뷰", "speaker": ""}]}"""


async def gather(llm: LLM, web: Web, c: dict[str, Any]) -> list[dict[str, Any]]:
    names = [n for n in dict.fromkeys([c.get("artist_ko"), c.get("artist")]) if n]
    known_urls = {cl["source_url"] for cl in c.get("claims", [])}
    rows: list[tuple[str, str, str, str]] = []   # (url, title, sentence, raw text)
    seen_urls: set[str] = set()
    for q in [f"{names[0]} 인터뷰", f"{names[0]} 앨범 리뷰"]:
        try:
            res = (await web.search(q, max_results=5))["results"]
        except ToolFailure:
            continue
        for r in res:
            url = r["url"]
            if url in seen_urls or url in known_urls or any(h in (urlparse(url).hostname or "") for h in SKIP_HOSTS):
                continue
            seen_urls.add(url)
            if len(seen_urls) > 6:
                break
            try:
                page = await web.page(url)
            except ToolFailure:
                continue
            keys = [n.casefold() for n in names]
            for s in SENTENCE_SPLIT.split(page["text"]):
                s = s.strip()
                if 30 <= len(s) <= 260 and any(k in s.casefold() for k in keys) and not re.search(r"https?:|\]\(|!\[", s):
                    rows.append((url, r.get("title") or "", s, page["text"]))
    rows = rows[:40]
    if not rows:
        return []
    payload = {"artist": names, "existing": [cl["quote"] for cl in c.get("claims", [])],
               "candidates": [{"i": i, "text": s, "from": t[:60]} for i, (_, t, s, _) in enumerate(rows)]}
    try:
        msg = await llm.chat(MODEL, [{"role": "system", "content": PICK_SYSTEM},
                                     {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                             role="evidence_pick", json_mode=True, temperature=0.2, max_tokens=500, reasoning=False)
        items = json.loads(re.search(r"\{.*\}", msg.get("content") or "", re.S).group(0)).get("items") or []  # type: ignore[union-attr]
    except (AttributeError, json.JSONDecodeError, ToolFailure):
        return []
    out = []
    for it in items[:2]:
        try:
            url, title, s, raw = rows[int(it["i"])]
        except (KeyError, ValueError, IndexError, TypeError):
            continue
        ok, _ = verbatim(s, raw)   # 원문 글자 대조 (코드)
        if not ok or any(normalize(s) == normalize(x["quote"]) for x in out):
            continue
        host = (urlparse(url).hostname or "").replace("www.", "")
        out.append({"quote": s, "url": url, "source_name": title[:60] or host, "host": host,
                    "kind": it.get("kind") if it.get("kind") in ("인터뷰", "리뷰", "기사") else "기사",
                    "speaker": str(it.get("speaker") or "")[:30], "context": context_around(raw, s, 500)})
    return out


async def enrich(candidates: list[dict[str, Any]], llm: LLM | None = None) -> int:
    llm, web = llm or LLM(), Web()
    n = 0
    try:
        for c in candidates:
            if c.get("kind") != "new":
                continue
            try:
                c["more_evidence"] = await gather(llm, web, c)
                n += len(c["more_evidence"])
            except Exception as e:  # 더 읽을거리는 덤이다. 실패해도 브리프는 나간다
                audit.emit("evidence", artist=c.get("artist"), ok=False, error=str(e)[:200])
    finally:
        await web.aclose()
    audit.emit("evidence", added=n)
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    args = ap.parse_args()
    from .pipeline import save_brief
    p = BRIEFS / f"{args.date}.json"
    brief = json.loads(p.read_text(encoding="utf-8"))
    llm = LLM()
    n = asyncio.run(enrich(brief["candidates"], llm))
    save_brief(brief)
    print(f"근거 {n}개 추가 · ${llm.usage.cost_usd:.4f}")
    for c in brief["candidates"]:
        for e in c.get("more_evidence") or []:
            print(f"- {c['artist']} [{e['kind']}] {e['speaker'] or e['host']}: {e['quote'][:90]}")


if __name__ == "__main__":
    main()
