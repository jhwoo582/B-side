"""개인 디깅 위키 (llm-wiki) — 아티스트 한 명당 마크다운 한 장.

LLM은 위키를 직접 쓰지 않는다. 구조화된 데이터(frontmatter)를 코드가 갱신하고, 본문은 그 데이터로 매번 다시 그린다.
그래서 위키에는 검수를 통과한 인용·출처와 사용자의 반응만 들어간다(문제정의서 §3.2 규칙).
"""

from __future__ import annotations

import os
import re
from datetime import date
from pathlib import Path
from typing import Any

import frontmatter

from .config import WIKI
from .sources.common import norm_name

REACTIONS = {"like": "♥ 더 듣고 싶어", "dislike": "그저 그래", "known": "✓ 원래 알아"}
STATUS_BY_REACTION = {"like": "liked", "dislike": "skipped", "known": "known"}
ASPECTS = ["보컬", "사운드", "분위기", "가사", "기타 톤", "리듬", "녹음 질감"]  # 화면은 앞의 4개만 쓴다
NEXT = {"more": "이 길로 더 파줘", "later": "나중에 다시", "stop": "이 아티스트는 그만"}
STATUS_BY_NEXT = {"more": "digging", "later": "later", "stop": "stopped"}


def slug(name: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|#\[\]]", "", name).strip()
    return re.sub(r"\s+", "_", s) or "unknown"


class Wiki:
    def __init__(self, root: Path = WIKI) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    # ---------- 읽기 ----------

    def pages(self) -> list[dict[str, Any]]:
        out = []
        for p in sorted(self.root.glob("*.md")):
            post = frontmatter.load(p)
            out.append({**post.metadata, "slug": p.stem})
        return out

    def find(self, name: str) -> Path | None:
        key = norm_name(name)
        direct = self.root / f"{slug(name)}.md"
        if direct.exists():
            return direct
        for p in self.root.glob("*.md"):
            meta = frontmatter.load(p).metadata
            names = [meta.get("name", ""), meta.get("name_ko") or "", *(meta.get("aliases") or [])]
            if key in {norm_name(n) for n in names if n}:
                return p
        return None

    def load(self, name_or_slug: str) -> dict[str, Any] | None:
        p = self.root / f"{name_or_slug}.md"
        p = p if p.exists() else self.find(name_or_slug)
        if not p:
            return None
        post = frontmatter.load(p)
        return {"slug": p.stem, "meta": post.metadata, "markdown": post.content}

    def excluded(self) -> set[str]:
        """👎·원래 앎으로 반응한 아티스트 — 다시 가져오지 않는다."""
        out = set()
        for m in self.pages():
            last = (m.get("reactions") or [{}])[-1]
            if last.get("reaction") in ("dislike", "known") or last.get("next") == "stop":
                out |= {norm_name(n) for n in (m.get("name"), m.get("name_ko"), *(m.get("aliases") or [])) if n}
        return out

    def seen(self) -> set[str]:
        """이미 후보로 나왔던 아티스트 — 같은 아티스트를 매일 다시 주지 않는다."""
        return {norm_name(n) for m in self.pages() if m.get("role") == "candidate"
                for n in (m.get("name"), m.get("name_ko"), *(m.get("aliases") or [])) if n}

    def queue(self) -> list[str]:
        """다음에 팔 출발점: '이 길로 더 파줘'가 먼저, 그다음 👍한 후보, 위키의 '다음에 팔 링크'."""
        more, liked, out = [], [], []
        for m in self.pages():
            last = (m.get("reactions") or [{}])[-1]
            if last.get("next") == "more":
                more.append(m["name"])
            elif last.get("reaction") == "like":
                liked.append(m["name"])
            out += m.get("next_links") or []
        # 반응은 없지만 턴테이블에서 끝까지 들은 아티스트도 뒤쪽 출발점으로
        full = [m["name"] for m in self.pages()
                if not m.get("reactions") and any(x["signal"] == "full" for x in m.get("listens") or [])]
        return list(dict.fromkeys(more + liked + out + full))

    def reactions(self) -> list[dict[str, Any]]:
        """모든 반응을 아티스트·경로와 함께 (취향 노트의 근거). id = '<slug>#<번호>'."""
        out = []
        for m in self.pages():
            for i, r in enumerate(m.get("reactions") or []):
                p = (m.get("paths") or [{}])[0]
                out.append({"id": f"{m['slug']}#{i}", "artist": m["name"], "artist_ko": m.get("name_ko"), **r,
                            "came_from": p.get("from"), "edge": p.get("edge"), "source_name": p.get("source_name"),
                            "source_url": p.get("source_url")})
            for i, x in enumerate(m.get("retorts") or []):
                out.append({"id": f"{m['slug']}#R{i}", "artist": m["name"], "artist_ko": m.get("name_ko"),
                            "kind": "retort", "date": x["date"], "reason": f"말대꾸: {x['objection']}",
                            "came_from": (m.get("paths") or [{}])[0].get("from"),
                            "edge": (m.get("paths") or [{}])[0].get("edge")})
            for i, x in enumerate(m.get("listens") or []):
                out.append({"id": f"{m['slug']}#L{i}", "artist": m["name"], "artist_ko": m.get("name_ko"),
                            "kind": "listen", "date": x["date"],
                            "listen": "턴테이블에서 끝까지 들음" if x["signal"] == "full" else f"{x['seconds']}초 만에 넘김",
                            "came_from": (m.get("paths") or [{}])[0].get("from")})
        return out

    def record_retort(self, artist: str, objection: str, reply: str, brief_date: str | None = None) -> None:
        """말대꾸: 사용자가 판의 이유에 반박한 기록. 취향 노트의 강한 근거가 된다."""
        meta = self._get_meta(artist)
        if not meta:
            return
        meta.setdefault("retorts", []).append({"date": date.today().isoformat(), "objection": objection.strip()[:300],
                                               "reply": reply, "brief": brief_date})
        self._save(meta)

    def record_listen(self, artist: str, signal: str, seconds: int) -> dict[str, Any] | None:
        """턴테이블 청취 신호(약한 신호): full = 끝까지 들음, skip = 30초 안에 넘김. 위키에 없는 아티스트면 무시."""
        if signal not in ("full", "skip"):
            raise ValueError("signal은 full | skip")
        meta = self._get_meta(artist)
        if not meta:
            return None
        meta.setdefault("listens", []).append({"date": date.today().isoformat(), "signal": signal, "seconds": int(seconds)})
        self._save(meta)
        return meta

    def graph(self) -> dict[str, Any]:
        nodes, edges = {}, []
        for m in self.pages():
            last = (m.get("reactions") or [{}])[-1]
            nodes[m["name"]] = {"id": m["name"], "slug": m["slug"], "name_ko": m.get("name_ko"),
                                "role": m.get("role"), "status": m.get("status"),
                                "reaction": last.get("reaction"), "next": last.get("next"), "first_seen": str(m.get("first_seen")),
                                "thumb": m.get("thumb")}
        for m in self.pages():
            for p in m.get("paths") or []:
                src = p["from"]
                if src not in nodes:
                    nodes[src] = {"id": src, "slug": slug(src), "role": "seed", "status": "seed",
                                  "first_seen": str(p.get("date"))}
                edges.append({"source": src, "target": m["name"], "edge": p["edge"],
                              "date": str(p.get("date")), "connection": p.get("connection"),
                              "dir": p.get("direction") or "branch"})
        return {"nodes": list(nodes.values()), "edges": edges}

    # ---------- 쓰기 ----------

    def _save(self, meta: dict[str, Any]) -> Path:
        path = self.find(meta["name"]) or self.root / f"{slug(meta['name'])}.md"
        post = frontmatter.Post(render(meta), **meta)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(frontmatter.dumps(post), encoding="utf-8")
        os.replace(tmp, path)
        return path

    def _get_meta(self, name: str) -> dict[str, Any] | None:
        p = self.find(name)
        return dict(frontmatter.load(p).metadata) if p else None

    def record_brief(self, brief: dict[str, Any], seed_thumbs: dict[str, str] | None = None) -> int:
        d = brief["date"]
        n = 0
        for c in brief["candidates"]:
            if c["kind"] != "new":
                continue
            meta = self._get_meta(c["artist"]) or {
                "type": "artist", "name": c["artist"], "role": "candidate", "status": "discovered",
                "first_seen": d, "paths": [], "reactions": [], "next_links": []}
            if c.get("artist_ko"):
                meta["name_ko"] = c["artist_ko"]
            aliases = set(meta.get("aliases") or []) | {c.get("artist_query")} - {None, meta["name"]}
            meta["aliases"] = sorted(aliases)
            meta["role"] = "candidate"
            meta["thumb"] = (c.get("track") or {}).get("thumb") or meta.get("thumb")
            meta["channel_id"] = (c.get("track") or {}).get("channel_id") or meta.get("channel_id")
            known = {(p["from"], p.get("quote")) for p in meta["paths"]}
            for hop in c["path"]:
                for cl in c["claims"]:
                    if (hop["from"], cl["quote"]) in known:
                        continue
                    meta["paths"].append({"date": d, "from": hop["from"], "edge": hop["edge"],
                                          "connection": hop.get("connection"), "quote": cl["quote"],
                                          "source_url": cl["source_url"], "source_type": cl.get("source_type"),
                                          "source_name": cl.get("source_name"), "brief": d,
                                          **({"direction": hop["direction"]} if hop.get("direction") == "root" else {})})
            self._save(meta)
            for hop in c["path"]:
                self._ensure_seed(hop["from"], d, (seed_thumbs or {}).get(hop["from"]))
            n += 1
        return n

    def _ensure_seed(self, name: str, d: str, thumb: str | None = None) -> None:
        meta = self._get_meta(name)
        if meta:
            if thumb and not meta.get("thumb"):
                meta["thumb"] = thumb
                self._save(meta)
            return
        self._save({"type": "artist", "name": name, "role": "seed", "status": "seed", "first_seen": d, "thumb": thumb,
                    "paths": [], "reactions": [], "next_links": []})

    def record_feedback(self, artist: str, reaction: str | None = None, reason: str = "", brief_date: str | None = None,
                        aspects: dict[str, int] | None = None, next: str | None = None,
                        source_good: bool = False) -> dict[str, Any]:
        """반응 기록. reaction(전체 인상)·aspects(측면별 +1/-1)·next(다음 행동)·source_good(이 출처 좋았어)·reason(메모)."""
        if reaction is not None and reaction not in REACTIONS:
            raise ValueError(f"reaction은 {list(REACTIONS)} 중 하나")
        if next is not None and next not in NEXT:
            raise ValueError(f"next는 {list(NEXT)} 중 하나")
        aspects = {k: (1 if v > 0 else -1) for k, v in (aspects or {}).items() if k in ASPECTS and v}
        if not (reaction or aspects or next or source_good or reason.strip()):
            raise ValueError("기록할 반응이 없습니다")
        meta = self._get_meta(artist)
        if not meta:
            raise KeyError(f"위키에 없는 아티스트: {artist}")
        entry = {"date": date.today().isoformat(), "reaction": reaction, "aspects": aspects or None, "next": next,
                 "source_good": source_good or None, "reason": reason.strip()[:500], "brief": brief_date}
        entry = {k: v for k, v in entry.items() if v not in (None, "")}
        rs = meta.setdefault("reactions", [])
        # 같은 날 같은 브리프의 같은 판을 다시 고친 거면(탭 → 칩 추가 등) 새 줄 대신 마지막 반응을 덮어쓴다
        if rs and rs[-1].get("date") == entry["date"] and rs[-1].get("brief") == entry.get("brief"):
            rs[-1] = entry
        else:
            rs.append(entry)
        meta["status"] = STATUS_BY_NEXT.get(next) or STATUS_BY_REACTION.get(reaction or "", meta.get("status"))
        self._save(meta)
        return meta


def render(m: dict[str, Any]) -> str:
    """frontmatter → 사람이 읽는 본문. (Obsidian 등에서 바로 읽을 수 있게)"""
    title = m["name"] + (f" ({m['name_ko']})" if m.get("name_ko") else "")
    lines = [f"# {title}", ""]
    role = "시드 (내가 원래 좋아하던 아티스트)" if m.get("role") == "seed" else "디깅으로 만난 아티스트"
    lines += [f"- 구분: {role}", f"- 처음 만난 날: {m.get('first_seen')}", f"- 상태: {m.get('status')}", ""]
    if m.get("paths"):
        lines += ["## 발견 경로", ""]
        for p in m["paths"]:
            lines.append(f"- {p['date']} · [[{p['from']}]] —[{p['edge']}]→ {m['name']}")
            if p.get("connection"):
                lines.append(f"  - 연결: {p['connection']}")
            lines.append(f"  - 인용: \"{p['quote']}\"")
            src = " · ".join(x for x in (p.get("source_name"), p.get("source_type")) if x)
            lines.append(f"  - 출처: {p['source_url']}" + (f" ({src})" if src else ""))
        lines.append("")
    lines += ["## 내 반응", ""]
    if m.get("reactions"):
        for r in m["reactions"]:
            parts = [REACTIONS[r["reaction"]]] if r.get("reaction") in REACTIONS else []
            parts += [f"{k} {'👍' if v > 0 else '👎'}" for k, v in (r.get("aspects") or {}).items()]
            if r.get("next"):
                parts.append(f"→ {NEXT[r['next']]}")
            if r.get("source_good"):
                parts.append("출처 좋았음")
            lines.append(f"- {r['date']}: {' · '.join(parts) or '메모'}" + (f" — {r['reason']}" if r.get("reason") else ""))
    else:
        lines.append("- (아직 없음)")
    lines.append("")
    if m.get("retorts"):
        lines += ["## 말대꾸", ""] + [f"- {x['date']}: \"{x['objection']}\" → 사장님: {x['reply']}" for x in m["retorts"]] + [""]
    if m.get("listens"):
        full = sum(x["signal"] == "full" for x in m["listens"])
        skip = len(m["listens"]) - full
        lines += ["## 턴테이블 청취", "", f"- 끝까지 들음 {full}번 · 넘김 {skip}번 (자동 기록)", ""]
    if m.get("next_links"):
        lines += ["## 다음에 팔 링크", ""] + [f"- [[{n}]]" for n in m["next_links"]] + [""]
    return "\n".join(lines)
