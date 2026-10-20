"""MusicBrainz — 멤버·소속 밴드·공동 크레딧. music_curation/tools/musicbrainz_mcp에서 옮겨옴.

호출 제한(프로세스 전역 1.1초 간격), 503/5xx/타임아웃만 재시도, 같은 요청은 캐시.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any

import httpx

from .. import audit
from ..config import SECRETS
from .common import ToolFailure, clean_text

BASE_URL = "https://musicbrainz.org/ws/2"
MB_WEB = "https://musicbrainz.org"
MIN_INTERVAL_S = 1.1
MAX_ATTEMPTS = 3
# MusicBrainz는 User-Agent에 연락처를 요구한다. 환경변수 MB_CONTACT 또는 .secrets/mb_contact
CONTACT = (os.environ.get("MB_CONTACT", "").strip()
           or ((SECRETS / "mb_contact").read_text().strip() if (SECRETS / "mb_contact").exists() else "")
           or "unknown")
_MBID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class MusicBrainz:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            base_url=BASE_URL, timeout=15,
            headers={"User-Agent": f"digging-agent/0.2 ( {CONTACT} )", "Accept": "application/json"})
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._cache: dict[str, dict[str, Any]] = {}

    async def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        params = {**params, "fmt": "json"}
        key = path + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        if key in self._cache:
            return self._cache[key]
        async with self._lock:
            last_error = ""
            for attempt in range(1, MAX_ATTEMPTS + 1):
                wait = self._last + MIN_INTERVAL_S - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                self._last = time.monotonic()
                try:
                    r = await self._http.get(path, params=params)
                except httpx.HTTPError as e:
                    last_error = f"네트워크 오류({type(e).__name__})"
                else:
                    if r.status_code == 200:
                        self._cache[key] = r.json()
                        return self._cache[key]
                    if r.status_code == 404:
                        raise ToolFailure("MusicBrainz에 해당 항목이 없습니다(404).")
                    if r.status_code == 400:
                        raise ToolFailure("MusicBrainz가 요청을 거부했습니다(400). 인자를 확인하세요.")
                    last_error = f"MusicBrainz 오류({r.status_code})"
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(2 ** (attempt - 1))
        raise ToolFailure(f"{last_error}. {MAX_ATTEMPTS}회 시도 후 중단.")

    @staticmethod
    def _ref(a: dict[str, Any]) -> dict[str, Any]:
        return {"mbid": a["id"], "name": clean_text(a.get("name")), "type": a.get("type"),
                "disambiguation": clean_text(a.get("disambiguation")), "source_url": f"{MB_WEB}/artist/{a['id']}"}

    @staticmethod
    def _mbid(mbid: str) -> str:
        mbid = mbid.strip().lower()
        if not _MBID_RE.match(mbid):
            raise ToolFailure(f"'{mbid}'는 MBID(UUID)가 아닙니다. mb_search_artist로 먼저 찾으세요.")
        return mbid

    async def search_artist(self, name: str, limit: int = 5) -> dict[str, Any]:
        data = await self._get("/artist/", {"query": name, "limit": min(max(limit, 1), 10)})
        return {"query": name, "candidates": [
            {**self._ref(a), "country": a.get("country"), "match_score": a.get("score")}
            for a in data.get("artists", [])]}

    async def relations(self, mbid: str) -> dict[str, Any]:
        a = await self._get(f"/artist/{self._mbid(mbid)}", {"inc": "artist-rels"})
        members, member_of, other = [], [], []
        for r in a.get("relations", []):
            if r.get("target-type") != "artist":
                continue
            edge = {**self._ref(r["artist"]), "roles": [clean_text(x) for x in r.get("attributes", [])]}
            if r["type"] == "member of band":
                (members if r["direction"] == "backward" else member_of).append(edge)
            else:
                other.append({**edge, "relation": r["type"]})
        return {"artist": self._ref(a), "members": members, "member_of": member_of, "other_relations": other[:15],
                "note": "부재 ≠ 관계 없음 (한국 인디는 입력이 얇다)"}

    async def collaborations(self, mbid: str) -> dict[str, Any]:
        mid = self._mbid(mbid)
        data = await self._get("/release-group", {"artist": mid, "inc": "artist-credits", "limit": 100})
        out = []
        for g in data.get("release-groups", []):
            others = [c["artist"] for c in g.get("artist-credit", []) if c["artist"]["id"] != mid]
            if others:
                out.append({"title": clean_text(g.get("title")), "date": g.get("first-release-date") or None,
                            "co_artists": [self._ref(o) for o in others],
                            "source_url": f"{MB_WEB}/release-group/{g['id']}"})
        return {"mbid": mid, "collaborations": out[:20]}

    async def aclose(self) -> None:
        await self._http.aclose()
