"""YouTube Music — 곡 링크, 청취 신호, novelty 판정, 평론 지도, 플레이리스트 생성.
music_curation/tools/ytmusic에서 옮겨옴. 비공식 API(ytmusicapi)라 호출을 한 줄로 세우고 간격을 둔다.

쓰기는 create_playlist 하나뿐: 제목 'Digging '으로 시작, PRIVATE 고정, 수정·삭제 기능 없음.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, Callable

import requests
from ytmusicapi import YTMusic

from .. import audit
from ..config import KMA_PATH, YTM_AUTH
from .common import ToolFailure, norm_name
from .taste_map import TasteMap, parse_count

YTM = "https://music.youtube.com"
MIN_INTERVAL_S = 0.5
PLAYLIST_PREFIX = "Digging "
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _walk_rows(o: Any):
    if isinstance(o, dict):
        if "musicResponsiveListItemRenderer" in o:
            yield o["musicResponsiveListItemRenderer"]
        for v in o.values():
            yield from _walk_rows(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk_rows(v)


def best_thumb(thumbs: list[dict[str, Any]] | None) -> str | None:
    """가장 큰 썸네일. YouTube Music 썸네일은 URL의 =w120-h120 부분을 키우면 고해상도가 된다."""
    if not thumbs:
        return None
    url = max(thumbs, key=lambda t: t.get("width", 0)).get("url")
    return re.sub(r"=w\d+-h\d+", "=w600-h600", url) if url else None


class YouTubeMusic:
    def __init__(self) -> None:
        self._authed = YTMusic(str(YTM_AUTH)) if YTM_AUTH.exists() else None
        self._anon = YTMusic()
        self._lock = asyncio.Lock()
        self._last = 0.0
        self.taste = TasteMap()
        self._synced = False
        self.offline: str | None = None  # 인증 만료 등으로 청취 신호를 못 읽었을 때 그 이유
        self._artist_cache: dict[str, dict[str, Any]] = {}
        self._is_artist: dict[str, bool] = {}

    @property
    def client(self) -> YTMusic:
        # 인증이 만료되면 만료된 쿠키로 계속 두드리지 않고 비로그인 클라이언트로 검색한다
        return self._anon if self.offline else (self._authed or self._anon)

    def _need_auth(self) -> YTMusic:
        if not self._authed:
            raise ToolFailure("YouTube Music 인증 파일이 없습니다(.secrets/ytmusic_browser.json).")
        return self._authed

    async def call(self, fn: Callable[[], Any]) -> Any:
        async with self._lock:
            for attempt in range(1, 4):
                wait = self._last + MIN_INTERVAL_S - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                try:
                    return await asyncio.to_thread(fn)
                except (requests.ConnectionError, requests.Timeout) as e:
                    if attempt == 3:
                        raise ToolFailure(f"YouTube Music 연결 실패({type(e).__name__})") from e
                    await asyncio.sleep(2 ** (attempt - 1))
                except ToolFailure:
                    raise
                except Exception as e:
                    msg = str(e)
                    if "401" in msg or "403" in msg or "Sign in" in msg:
                        raise ToolFailure("YouTube Music 인증 만료. setup_auth.py로 쿠키를 다시 설정하세요.") from e
                    raise ToolFailure(f"YouTube Music 호출 실패({type(e).__name__}): {msg[:200]}") from e
                finally:
                    self._last = time.monotonic()

    async def sync_taste(self) -> TasteMap:
        """청취 신호와 동기화한다. 인증이 만료됐으면 저장된 취향 지도로 계속한다(연동 없이도 성립)."""
        if not self._synced:
            self._synced = True
            try:
                client = self._need_auth()
                stats = await self.call(lambda: self.taste.sync(client))
                audit.emit("taste_sync", **stats)
            except ToolFailure as e:
                self.offline = str(e)
                audit.emit("taste_sync_failed", error=str(e), fallback=f"저장된 취향 지도 {len(self.taste.artists)}명",
                           updated=self.taste.data.get("updated"))
        return self.taste

    # ---------- 아티스트·곡 ----------

    async def resolve_artist(self, name: str) -> dict[str, Any]:
        """이름 → 채널. 상위 결과 중 이름이 정확히 같은 채널을 먼저 고른다(1위가 엉뚱한 경우가 있다: 'Parasol' → Rihanna)."""
        key = norm_name(name)
        if key in self._artist_cache:
            return self._artist_cache[key]
        found = await self.call(lambda: self.client.search(name, filter="artists", limit=5))
        found = [f for f in found if f.get("browseId")]
        if not found:
            raise ToolFailure(f"YouTube Music에서 아티스트 '{name}'를 찾지 못했습니다. 영문·로마자 표기로 다시 시도하세요.")
        top = next((f for f in found if norm_name(f.get("artist") or "") == key), found[0])
        out = {"name": top.get("artist") or "", "channel_id": top["browseId"],
               "channel_url": f"{YTM}/channel/{top['browseId']}",
               "thumb": best_thumb(top.get("thumbnails")),
               "name_matches_query": norm_name(top.get("artist") or "") == key}
        self._artist_cache[key] = out
        return out

    async def artist_page(self, channel_id: str) -> dict[str, Any]:
        return await self.call(lambda: self.client.get_artist(channel_id))

    # 2026-10 기준 YouTube Music은 ytmusicapi가 보내는 클라이언트에 대해 모든 곡을 '재생 불가(GREY_OUT)'로 표시하고,
    # ytmusicapi는 그런 곡의 videoId를 비운다. 원본 응답에는 videoId가 그대로 있으므로 직접 읽는다.
    # (추출한 ID는 YouTube oEmbed로 공개·임베드 가능한 영상임을 확인함)

    async def _raw_tracks(self, browse_id: str) -> list[dict[str, Any]]:
        raw = await self.call(lambda: self.client._send_request("browse", {"browseId": browse_id}))
        out = []
        for r in _walk_rows(raw):
            vid = (r.get("playlistItemData") or {}).get("videoId")
            if not vid:
                m = re.search(r'"videoId":\s*"([A-Za-z0-9_-]{11})"', json.dumps(r))
                vid = m.group(1) if m else None
            cols = r.get("flexColumns") or []
            try:
                title = cols[0]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"][0]["text"]
            except (KeyError, IndexError):
                title = None
            if vid and title:
                out.append({"title": title, "videoId": vid})
        return out

    async def releases(self, channel_id: str) -> list[dict[str, Any]]:
        """아티스트의 앨범·싱글 (최신순에 가깝게 YouTube Music이 주는 순서)."""
        page = await self.artist_page(channel_id)
        out = []
        for kind in ("singles", "albums"):
            for x in (page.get(kind) or {}).get("results") or []:
                if x.get("browseId"):
                    out.append({"title": x.get("title"), "browse_id": x["browseId"], "kind": kind,
                                "year": x.get("year"), "thumb": best_thumb(x.get("thumbnails"))})
        return out

    async def artist_songs(self, channel_id: str, name: str, n: int = 10) -> list[dict[str, Any]]:
        """대표곡 후보: 최근 발매들의 곡을 차례로 모은다."""
        out: list[dict[str, Any]] = []
        for rel in (await self.releases(channel_id))[:4]:
            for t in await self._raw_tracks(rel["browse_id"]):
                out.append({**t, "album": rel["title"], "thumb": rel["thumb"]})
            if len(out) >= n:
                break
        return out[:n]

    async def listen_link(self, artist: str, title: str | None = None) -> dict[str, Any]:
        """아티스트를 채널로 확정한 뒤 그 아티스트의 발매에서만 곡을 고른다(동명이인·검색 오염 방지).
        인용에 나온 곡/앨범(title)을 우선하고, 없으면 최근 발매의 첫 곡."""
        m = await self.resolve_artist(artist)
        cid, yt_name = m["channel_id"], m["name"]
        rels = await self.releases(cid)
        note, pick, rel_used = None, None, None
        if title:
            key = norm_name(title)
            rel_used = next((r for r in rels if norm_name(r["title"] or "") == key), None) \
                or next((r for r in rels if key and key in norm_name(r["title"] or "")), None)
            pools = [rel_used] if rel_used else rels[:6]
            for rel in pools:
                tracks = await self._raw_tracks(rel["browse_id"])
                hit = next((t for t in tracks if norm_name(t["title"]) == key or key in norm_name(t["title"])), None)
                if hit or rel is rel_used:
                    pick, rel_used = hit or (tracks[0] if tracks else None), rel
                    break
            if pick and norm_name(pick["title"]) != key and key not in norm_name(pick["title"]):
                note = f"인용 속 '{title}' 앨범의 첫 곡"
            if not pick:
                note = f"인용 속 '{title}'을 YouTube Music에서 찾지 못해 최근 발매의 곡으로 대신함"
        if not pick:
            for rel in rels[:3]:
                tracks = await self._raw_tracks(rel["browse_id"])
                if tracks:
                    pick, rel_used = tracks[0], rel
                    break
        if not pick:
            raise ToolFailure(f"'{yt_name}'의 곡을 찾지 못했습니다.")
        return {"artist": yt_name, "channel_id": cid, "title": pick["title"], "video_id": pick["videoId"],
                "album": rel_used["title"] if rel_used else None,
                "url": f"{YTM}/watch?v={pick['videoId']}", "thumb": (rel_used or {}).get("thumb") or m["thumb"],
                "note": note}

    # ---------- novelty ----------

    async def novelty(self, names: list[str], max_monthly_listeners: int, excluded: set[str]) -> list[dict[str, Any]]:
        """new / known / too_popular / excluded(위키에서 👎·원래 앎) / not_found."""
        tm = await self.sync_taste()
        out = []
        for name in dict.fromkeys(names):
            if norm_name(name) in excluded:
                out.append({"query": name, "status": "excluded", "why": "위키 기록: 별로/원래 앎"})
                continue
            try:
                m = await self.resolve_artist(name)
            except ToolFailure:
                out.append({"query": name, "status": "not_found"})
                continue
            if norm_name(m["name"]) in excluded:
                out.append({"query": name, "status": "excluded", "why": "위키 기록: 별로/원래 앎"})
                continue
            base = {"query": name, "matched_name": m["name"], "name_matches_query": m["name_matches_query"]}
            if tm.lookup(m["channel_id"], m["name"]) or tm.lookup("", name):
                out.append({**base, "status": "known"})
                continue
            page = await self.artist_page(m["channel_id"])
            listeners = parse_count(page.get("monthlyListeners"))
            popular = listeners is not None and listeners > max_monthly_listeners
            out.append({**base, "status": "too_popular" if popular else "new", "monthly_listeners": listeners})
        return out

    # ---------- 평론 지도 (한국대중음악상 2022~2026) ----------

    async def critic_picks(self, limit: int, max_monthly_listeners: int, excluded: set[str],
                           groups: list[str] | None = None, top_groups: int = 3) -> dict[str, Any]:
        if not KMA_PATH.exists():
            raise ToolFailure("평론 지도 파일(data/kma_nominees.json)이 없습니다.")
        kma = json.loads(KMA_PATH.read_text(encoding="utf-8"))
        tm = await self.sync_taste()
        resolved = kma["artists"]

        def is_known(name: str) -> bool:
            r = resolved.get(name)
            return bool((r and tm.lookup(r["channel_id"], r["yt_name"])) or tm.lookup("", name))

        stats: dict[str, dict[str, set[str]]] = {}
        per_artist: dict[str, list[dict[str, Any]]] = {}
        same_slot: dict[tuple[int, str], set[str]] = {}
        for e in kma["entries"]:
            for a in e["artists"]:
                if resolved.get(a) and is_known(a):
                    same_slot.setdefault((e["year"], e["category"]), set()).add(a)
        for e in kma["entries"]:
            if e["group"] == "General":
                continue
            for a in e["artists"]:
                if not resolved.get(a):
                    continue
                s = stats.setdefault(e["group"], {"all": set(), "known": set()})
                s["all"].add(a)
                if is_known(a):
                    s["known"].add(a)
                elif norm_name(a) not in excluded:
                    per_artist.setdefault(a, []).append(e)

        ranked = sorted(stats, key=lambda g: (-len(stats[g]["known"]), -len(stats[g]["known"]) / len(stats[g]["all"])))
        chosen = [g for g in (groups or ranked[:top_groups]) if g in stats]
        if not chosen:
            raise ToolFailure(f"해당 부문이 없습니다. 가능한 부문: {', '.join(ranked)}")

        def score(entries: list[dict[str, Any]]) -> float:
            return sum(2 * e["winner"] + 1 + 0.5 * (e["year"] - 2022)
                       + 1.5 * bool(same_slot.get((e["year"], e["category"]))) for e in entries)

        pool = sorted(((a, [e for e in es if e["group"] in chosen]) for a, es in per_artist.items()),
                      key=lambda x: -score(x[1]))
        picks, skipped, seen = [], [], set()
        for name, entries in pool:
            if not entries:
                continue
            if len(picks) >= limit:
                break
            r = resolved[name]
            if r["channel_id"] in seen:
                continue
            seen.add(r["channel_id"])
            try:
                page = await self.artist_page(r["channel_id"])
            except ToolFailure:  # 페이지 형식이 다른 아티스트 하나 때문에 도구 전체가 실패하지 않게 건너뛴다
                continue
            listeners = parse_count(page.get("monthlyListeners"))
            if listeners is not None and listeners > max_monthly_listeners:
                skipped.append(name)
                continue
            picks.append({
                "artist": name, "yt_name": r["yt_name"], "monthly_listeners": listeners, "group": entries[0]["group"],
                "nominations": [{"year": e["year"], "category": e["category"], "result": "수상" if e["winner"] else "후보",
                                 "work": e["work"], "source_url": e["source_url"],
                                 "nominated_with_known": sorted(same_slot.get((e["year"], e["category"]), set()))[:3]}
                                for e in sorted(entries, key=lambda e: -e["year"])][:3],
            })
        return {"group_affinity": [{"group": g, "known": len(stats[g]["known"]), "total": len(stats[g]["all"])}
                                   for g in ranked[:5]],
                "chosen_groups": chosen, "picks": picks, "skipped_too_popular": skipped,
                "note": "수상·후보 사실은 출발점일 뿐 근거 인용이 아니다. 근거는 선정의 변·리뷰·인터뷰의 원문 문장으로 찾는다."}

    # ---------- 시드·숨은 곡 ----------

    MUSIC_TYPES = ("MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_OMV")  # 공식 음원·공식 뮤직비디오 (일반 업로드 영상 제외)

    async def is_artist(self, channel_id: str) -> bool:
        """YouTube Music 아티스트인가: 아티스트 페이지가 열리고 앨범·싱글 발매가 있어야 한다.
        커버 채널·일반 유튜버는 아티스트 페이지 자체가 없다(열면 오류)."""
        if channel_id not in self._is_artist:
            try:
                self._is_artist[channel_id] = bool(await self.releases(channel_id))
            except ToolFailure:
                self._is_artist[channel_id] = False
        return self._is_artist[channel_id]

    async def liked_artists(self, n: int) -> list[dict[str, Any]]:
        """시드: 최근 좋아요에서 자주 나온 '아티스트' 순. 일반 영상·커버 채널은 뺀다."""
        tm = await self.sync_taste()
        counts: dict[str, dict[str, Any]] = {}
        for t in tm.recent_liked:
            if t.get("videoType") and t["videoType"] not in self.MUSIC_TYPES:
                continue
            for a in (t.get("artists") or [])[:1]:
                if a.get("id"):
                    c = counts.setdefault(a["id"], {"name": a.get("name"), "channel_id": a["id"], "liked": 0})
                    c["liked"] += 1
        if not counts:  # 오프라인: 저장된 취향 지도의 좋아요 누적 수로 대신한다
            for cid, a in tm.artists.items():
                if a["sources"].get("liked"):
                    counts[cid] = {"name": a["name"], "channel_id": cid, "liked": a["sources"]["liked"]}
        out, skipped = [], []
        for c in sorted(counts.values(), key=lambda c: -c["liked"]):
            if len(out) >= n:
                break
            (out if await self.is_artist(c["channel_id"]) else skipped).append(c)
        if skipped:
            audit.emit("seeds_filtered", skipped=[c["name"] for c in skipped], reason="아티스트 페이지·발매 없음 (일반 채널)")
        return out

    async def hidden_track(self, channel_id: str, name: str = "") -> dict[str, Any] | None:
        """아는 아티스트의, 청취기록에 없는 곡 하나."""
        tm = await self.sync_taste()
        heard = {norm_name(t) for t in tm.heard_titles.get(channel_id, set())}
        songs = await self.artist_songs(channel_id, name, 15)
        # 화면용: 이 아티스트 인기곡 중 들은 곡 / 안 들은 곡 (숨은 곡을 문장 대신 트랙리스트로 보여 준다)
        shelf = [{"title": t.get("title", ""), "heard": norm_name(t.get("title", "")) in heard} for t in songs if t.get("title")]
        for t in songs:
            if norm_name(t.get("title", "")) not in heard:
                return {"title": t["title"], "video_id": t["videoId"], "album": t.get("album"),
                        "url": f"{YTM}/watch?v={t['videoId']}", "thumb": t.get("thumb"), "shelf": shelf}
        return None

    # ---------- 쓰기 ----------

    async def create_playlist(self, title: str, video_ids: list[str], description: str) -> dict[str, Any]:
        if not title.startswith(PLAYLIST_PREFIX):
            raise ToolFailure(f"제목은 '{PLAYLIST_PREFIX}'로 시작해야 합니다.")
        ids = [v for v in dict.fromkeys(video_ids) if _VIDEO_ID_RE.match(v or "")]
        if not ids:
            raise ToolFailure("담을 곡이 없습니다.")
        client = self._need_auth()
        result = await self.call(lambda: client.create_playlist(title, description[:4900], privacy_status="PRIVATE",
                                                                video_ids=ids))
        if not isinstance(result, str):
            raise ToolFailure(f"플레이리스트 생성 응답이 예상과 다릅니다: {str(result)[:200]}")
        audit.emit("playlist_created", playlist_id=result, tracks=len(ids), title=title)
        return {"id": result, "url": f"{YTM}/playlist?list={result}", "title": title, "tracks": len(ids)}
