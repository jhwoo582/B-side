"""취향 지도: 사용자가 '아는' 아티스트를 채널 ID 기준으로 로컬에 누적한다. music_curation/tools/ytmusic에서 옮겨옴.

YouTube Music 청취기록 API는 최근 200곡만 주므로 동기화할 때마다 합쳐 둔다.
사용자가 '원래 알아'라고 한 아티스트(user_marked)도 여기 남는다.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Any

from ytmusicapi import YTMusic

from ..config import TASTE_PATH
from .common import norm_name


def channel_id(browse_id: str | None) -> str | None:
    if not browse_id:
        return None
    return browse_id[4:] if browse_id.startswith("MPLA") else browse_id


def parse_count(text: str | None) -> int | None:
    """'367K', '2.04M', '1,234' → 정수."""
    if not text:
        return None
    m = re.match(r"^\s*([\d.,]+)\s*([KMB]?)", text.replace(",", ""), re.I)
    if not m:
        return None
    return int(float(m.group(1)) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()])


class TasteMap:
    def __init__(self, path: Path = TASTE_PATH) -> None:
        self.path = path
        self.data: dict[str, Any] = {"updated": None, "artists": {}}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))
        self.heard_titles: dict[str, set[str]] = {}
        self.recent_liked: list[dict[str, Any]] = []

    @property
    def artists(self) -> dict[str, dict[str, Any]]:
        return self.data["artists"]

    def _touch(self, cid: str, name: str, source: str, n: int = 1) -> None:
        today = date.today().isoformat()
        a = self.artists.setdefault(cid, {"name": name, "sources": {}, "first_seen": today})
        a["name"] = name or a["name"]
        a["last_seen"] = today
        if source in ("history", "liked"):
            a["sources"][source] = a["sources"].get(source, 0) + n
        else:
            a["sources"][source] = a["sources"].get(source) or today

    def sync(self, yt: YTMusic) -> dict[str, int]:
        before = len(self.artists)
        seen: dict[tuple[str, str], int] = {}
        names: dict[str, str] = {}

        def count(tracks: list[dict[str, Any]], source: str) -> None:
            for t in tracks:
                for a in t.get("artists") or []:
                    cid = channel_id(a.get("id"))
                    if cid:
                        seen[(cid, source)] = seen.get((cid, source), 0) + 1
                        names[cid] = a.get("name") or names.get(cid, "")
                        self.heard_titles.setdefault(cid, set()).add(t.get("title") or "")

        # 소스별로 따로 실패하게 한다: 청취기록 API 하나가 간헐적으로 오류를 내도 나머지는 동기화한다
        self.sync_errors: list[str] = []

        def safe(name: str, fn: Any, default: Any) -> Any:
            try:
                return fn()
            except Exception as e:
                self.sync_errors.append(f"{name}: {type(e).__name__}")
                return default

        count(safe("history", yt.get_history, []), "history")
        liked = safe("liked", lambda: yt.get_liked_songs(limit=None).get("tracks", []), [])
        self.recent_liked = liked[:60]
        count(liked, "liked")
        for (cid, source), n in seen.items():
            a = self.artists.get(cid)
            if a is None or a["sources"].get(source, 0) < n:
                prev = a["sources"].get(source, 0) if a else 0
                self._touch(cid, names[cid], source, n - prev)
        for a in safe("library", lambda: yt.get_library_artists(limit=None), []):
            if cid := channel_id(a.get("browseId")):
                self._touch(cid, a.get("artist", ""), "library")
        for a in safe("subscriptions", lambda: yt.get_library_subscriptions(limit=None), []):
            if cid := channel_id(a.get("browseId")):
                self._touch(cid, a.get("artist", ""), "subscribed")
        self.data["updated"] = date.today().isoformat()
        self.save()
        if len(self.sync_errors) == 4:
            raise RuntimeError("청취 신호를 하나도 읽지 못했습니다: " + ", ".join(self.sync_errors))
        return {"artists": len(self.artists), "added": len(self.artists) - before, "errors": self.sync_errors}

    def mark_known(self, cid: str, name: str) -> None:
        self._touch(cid, name, "user_marked")
        self.save()

    def lookup(self, cid: str, name: str | None = None) -> dict[str, Any] | None:
        """채널 ID로 먼저, 없으면 이름으로 (공식 채널과 Topic 채널이 따로 있는 경우)."""
        if cid and cid in self.artists:
            return self.artists[cid]
        if name and (key := norm_name(name)):
            for a in self.artists.values():
                if norm_name(a.get("name", "")) == key:
                    return a
        return None

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)
