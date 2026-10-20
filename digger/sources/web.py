"""웹 — 검색(Tavily), 원문 가져오기, 문장 찾기. music_curation/tools/web_mcp에서 옮겨옴.

원문 가져오기는 직접 요청(trafilatura 추출)을 먼저 하고, 403 등으로 막히면 Tavily extract로 우회한다
(koreanmusicawards.com은 직접 요청을 403으로 막는다). 검수는 fresh=True로 캐시를 쓰지 않고 다시 가져온다.

안전장치: http(s)·80/443만, 사설·루프백 주소 차단(리다이렉트마다 재검사), 3MB·20초 제한, 도메인당 1초 간격.
본문 속 '모델에게 하는 지시'로 보이는 문장은 표시한다(데이터로만 다룬다).
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import time
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
import trafilatura

from .. import audit
from ..config import secret
from .common import ToolFailure

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("trafilatura").setLevel(logging.ERROR)

MAX_BYTES = 3 * 1024 * 1024
TIMEOUT_S = 20.0
USER_AGENT = "Mozilla/5.0 (Macintosh; digging-agent/0.2; personal music research)"
TAVILY = "https://api.tavily.com"

SUSPICIOUS = re.compile(
    r"(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard .{0,20}instructions|"
    r"system prompt|you are (now )?an? (ai|assistant)|이전 지시|지시를 무시|시스템 프롬프트|너는 이제)", re.I)
INFLUENCE = re.compile(r"영향|좋아하|즐겨 ?듣|자주 듣|요즘 듣|많이 들|빠져 ?있|레퍼런스|존경|롤모델|동경|꽂혀|추천하|플레이리스트|"
                       r"influenc|inspired|favorite|listening to|look up to", re.I)
SENTENCE_SPLIT = re.compile(r"(?<=[.!?。？！])\s+|\n+")


_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]*)\]\((?:https?:)?//[^)]*\)")
_URL = re.compile(r"https?://\S+")


def clean_markdown(text: str) -> str:
    """Tavily가 주는 마크다운에서 이미지·링크·메뉴 줄을 걷어 본문만 남긴다."""
    text = _MD_IMAGE.sub("", text)
    for _ in range(2):  # 링크 안에 링크가 있는 메뉴 구조
        text = _MD_LINK.sub(r"\1", text)
    lines = []
    for line in text.splitlines():
        t = line.strip().lstrip("*#>-| ").strip()
        if not t or _URL.search(t) or len(t) < 25 and not re.search(r"[.!?。]$", t):
            continue  # 빈 줄, 주소, 짧은 메뉴 항목
        lines.append(t)
    return "\n".join(lines)


def light_clean(text: str) -> str:
    """이미지·링크 주소만 걷는다. 줄은 지우지 않는다 (짧은 줄에 '글: 신샘' 같은 말한 사람이 있다)."""
    text = _MD_IMAGE.sub("", text)
    for _ in range(2):
        text = _MD_LINK.sub(r"\1", text)
    return "\n".join(t for t in (l.strip() for l in text.splitlines()) if t and not _URL.fullmatch(t))


def _check_public_url(url: str) -> None:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ToolFailure(f"http(s) 주소만 읽을 수 있습니다: {url}")
    if p.port not in (None, 80, 443):
        raise ToolFailure(f"80/443 이외의 포트는 허용하지 않습니다: {url}")
    try:
        infos = socket.getaddrinfo(p.hostname, None)
    except socket.gaierror as e:
        raise ToolFailure(f"주소를 찾을 수 없습니다: {p.hostname}") from e
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise ToolFailure(f"내부망·로컬 주소는 읽을 수 없습니다: {p.hostname}")


class Web:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}, follow_redirects=False)
        self._last: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._cache: dict[str, dict[str, Any]] = {}

    # ---------- 검색 ----------

    async def search(self, query: str, max_results: int = 5, include_domains: list[str] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"query": query, "max_results": min(max(max_results, 1), 10), "search_depth": "basic"}
        if include_domains:
            payload["include_domains"] = include_domains
        r = await self._tavily("search", payload)
        return {"query": query, "results": [
            {"title": x.get("title"), "url": x.get("url"), "snippet": (x.get("content") or "")[:300]}
            for x in r.get("results", [])],
            "note": "snippet은 요약 조각이라 인용으로 쓰지 않는다. 인용은 find_in_page/read_page의 원문에서."}

    async def _tavily(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{TAVILY}/{endpoint}", json=payload,
                                 headers={"Authorization": f"Bearer {secret('tavily_api_key', 'TAVILY_API_KEY')}"})
        except httpx.HTTPError as e:
            raise ToolFailure(f"Tavily 연결 실패({type(e).__name__})") from e
        if r.status_code == 429:
            raise ToolFailure("Tavily 사용 한도 초과. 잠시 뒤 다시 시도하세요.")
        if r.status_code != 200:
            raise ToolFailure(f"Tavily 오류(HTTP {r.status_code})")
        return r.json()

    # ---------- 원문 ----------

    async def page(self, url: str, fresh: bool = False) -> dict[str, Any]:
        if not fresh and url in self._cache:
            return self._cache[url]
        _check_public_url(url)
        try:
            text, final_url, via = await self._direct(url), url, "direct"
        except ToolFailure as direct_error:
            try:
                text, final_url, via = await self._extract(url), url, "tavily_extract"
            except ToolFailure as e:
                raise ToolFailure(f"원문을 가져오지 못했습니다. 직접: {direct_error} / 우회: {e}") from e
        text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text)
        page = {"url": final_url, "text": text, "via": via,
                "suspicious_instructions": [m.group(0) for m in SUSPICIOUS.finditer(text)][:5]}
        self._cache[url] = page
        audit.emit("fetch", url=url, via=via, chars=len(text), fresh=fresh)
        from .. import rag   # 읽은 원문은 원문 저장소(RAG)에 쌓는다
        rag.save_page(final_url, text, via)
        return page

    async def _direct(self, url: str) -> str:
        current = url
        for _ in range(4):
            _check_public_url(current)
            host = urlparse(current).hostname or ""
            async with self._locks.setdefault(host, asyncio.Lock()):
                wait = self._last.get(host, 0) + 1.0 - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                try:
                    async with self._http.stream("GET", current) as r:
                        self._last[host] = time.monotonic()
                        if r.is_redirect:
                            current = urljoin(current, r.headers.get("location", ""))
                            continue
                        if r.status_code != 200:
                            raise ToolFailure(f"HTTP {r.status_code}")
                        if not any(t in r.headers.get("content-type", "") for t in ("html", "text")):
                            raise ToolFailure("HTML 문서가 아님")
                        body = b""
                        async for chunk in r.aiter_bytes():
                            body += chunk
                            if len(body) > MAX_BYTES:
                                raise ToolFailure("문서가 3MB를 넘음")
                except httpx.HTTPError as e:
                    raise ToolFailure(f"네트워크 오류({type(e).__name__})") from e
            html = body.decode(r.encoding or "utf-8", errors="replace")
            text = trafilatura.extract(html, include_comments=False, include_tables=True, favor_recall=True) or ""
            if len(text.strip()) < 200:
                raise ToolFailure("본문 추출 실패(자바스크립트 페이지일 수 있음)")
            return text
        raise ToolFailure("리다이렉트가 너무 많음")

    async def _extract(self, url: str) -> str:
        # WordPress 글 주소는 끝 '/'가 없으면 Tavily가 가져오지 못하는 경우가 있어 붙여서 한 번 더 시도한다
        variants = [url] + ([url + "/"] if not urlparse(url).path.endswith("/") and "?" not in url else [])
        for u in variants:
            d = await self._tavily("extract", {"urls": [u], "extract_depth": "advanced"})
            results = d.get("results") or []
            if results and (results[0].get("raw_content") or "").strip():
                return light_clean(results[0]["raw_content"])
        raise ToolFailure("Tavily extract 결과 없음")

    async def find_in_page(self, url: str, terms: list[str], max_sentences: int = 12) -> dict[str, Any]:
        page = await self.page(url)
        lowered = [t.casefold() for t in terms if t.strip()]
        hits = []
        for s in SENTENCE_SPLIT.split(page["text"]):
            s = s.strip()
            if 8 <= len(s) <= 600 and any(t in s.casefold() for t in lowered):
                hits.append(s)
                if len(hits) >= max_sentences:
                    break
        return {"url": page["url"], "sentences": hits, "total_chars": len(page["text"]),
                "suspicious_instructions": page["suspicious_instructions"],
                "note": "인용은 이 문장을 한 글자도 바꾸지 않고 쓴다."}

    async def read_page(self, url: str, start: int = 0, max_chars: int = 3000) -> dict[str, Any]:
        page = await self.page(url)
        text = page["text"]
        end = min(start + min(max_chars, 6000), len(text))
        return {"url": page["url"], "total_chars": len(text), "start": start,
                "next_start": end if end < len(text) else None, "text": text[start:end],
                "suspicious_instructions": page["suspicious_instructions"]}

    async def interview_mentions(self, artist: str, artist_ko: str | None = None, max_pages: int = 4) -> dict[str, Any]:
        """아티스트 인터뷰에서 '영향받은·좋아하는·즐겨 듣는' 음악을 말한 문장을 원문 그대로 모은다.
        검색 → 원문 가져오기 → 취향 표현이 들어간 문장만 골라낸다(LLM 없음)."""
        names = [n for n in dict.fromkeys([artist_ko, artist]) if n]
        queries = [f"{n} 인터뷰 영향 받은 음악" for n in names[:2]] + [f"{names[0]} 인터뷰 좋아하는 아티스트 즐겨 듣는"]
        urls: list[tuple[str, str]] = []
        for q in queries:
            try:
                for r in (await self.search(q, max_results=5))["results"]:
                    if r["url"] not in {u for u, _ in urls}:
                        urls.append((r["url"], r.get("title") or ""))
            except ToolFailure:
                continue
        found, read = [], 0
        name_keys = [n.casefold() for n in names]
        for url, title in urls:
            if read >= max_pages:
                break
            # 제목이나 주소에 아티스트 이름이 없는 페이지는 건너뛴다 (다른 아티스트 인터뷰일 가능성)
            if not any(k in (title + url).casefold() for k in name_keys):
                continue
            try:
                page = await self.page(url)
            except ToolFailure:
                continue
            read += 1
            hits = [s.strip() for s in SENTENCE_SPLIT.split(page["text"])
                    if 12 <= len(s.strip()) <= 500 and INFLUENCE.search(s)]
            if hits:
                found.append({"url": page["url"], "title": title, "sentences": hits[:8],
                              "suspicious_instructions": page["suspicious_instructions"]})
        return {"artist": artist, "pages_read": read, "interviews": found,
                "note": "문장 속에 나온 다른 아티스트가 후보다. 이 문장을 그대로 인용하고 edge_type은 '본인 발언'(그 아티스트 본인이 한 말일 때). "
                        "인터뷰어의 질문이나 기자의 설명 문장이면 '본인 발언'이 아니다."}

    async def aclose(self) -> None:
        await self._http.aclose()
