"""원문 RAG — 디깅하며 읽은 원문(인터뷰·리뷰·평론)과 위키를 쌓아 두고, 점원이 다시 꺼내 쓴다.

새 음악을 찾는 일은 리서처가 웹에서 한다(저장소에 없는 아티스트는 벡터 검색으로 찾을 수 없으니까).
RAG는 '한 번 읽은 근거를 다시 쓰는 기억'을 맡는다: "세이수미가 인터뷰에서 한 말 보여 줘" → 저장된 원문에서 문장과 출처를 꺼낸다.
기록에 없으면 없다고 답하게 하는 근거도 여기서 나온다(점수 기준 미달 = 결과 없음).

구성
- 저장: 리서처가 읽은 페이지 원문(Web.page가 부를 때마다 data/rag/pages/에 저장) + 위키 아티스트 페이지
- 청크: 문장 경계로 약 600자, 앞뒤 120자 겹침
- 검색: 하이브리드 = 임베딩(로컬 multilingual-e5-large, 온프레미스) + BM25(한글은 글자 2-gram) → RRF로 합친다
- 아티스트 사전: 위키 이름·한글 이름·별칭, 미개척지, 청취 기록의 이름 → 질문 속 표기를 정식 이름으로 묶고(정규화),
  모든 표기로 질의를 넓힌 뒤, 그 아티스트가 나오는 청크를 위로 올린다

실행:
    python -m digger.rag --backfill   # 지난 로그에 남은 주소를 다시 읽어 저장 (직접 요청만, 유료 우회 안 씀)
    python -m digger.rag --build      # 새 청크만 임베딩해 색인 갱신
    python -m digger.rag --ask "세이수미가 인터뷰에서 한 말"
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import time
from collections import Counter
from pathlib import Path
from typing import Any

import frontmatter
import numpy as np

from . import audit
from .config import HOME, LOGS
from .sources.common import norm_name

ROOT = HOME / "data" / "rag"
PAGES = ROOT / "pages"
MODEL = os.environ.get("DIGGER_EMBED_MODEL", "intfloat/multilingual-e5-large")
CHUNK, OVERLAP = 600, 120
MIN_RRF = 0.025        # 이보다 낮으면 '기록에 없음' (두 검색 중 하나에서라도 꽤 위에 있어야 넘는다)
SENT = re.compile(r"(?<=[.!?。…”\"])\s+|\n+")


# ---------------------------------------------------------------- 원문 저장

def _key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def save_page(url: str, text: str, via: str) -> None:
    """Web.page가 원문을 가져올 때마다 부른다. 같은 주소는 한 번만 저장한다."""
    try:
        p = PAGES / f"{_key(url)}.json"
        if p.exists() or len(text.strip()) < 200:
            return
        PAGES.mkdir(parents=True, exist_ok=True)
        title = next((ln.strip() for ln in text.splitlines() if 4 <= len(ln.strip()) <= 120), "")[:120]
        p.write_text(json.dumps({"url": url, "title": title, "via": via, "text": text,
                                 "saved": time.strftime("%Y-%m-%d")}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass   # 저장 실패가 디깅을 멈추게 하지 않는다


def _docs() -> list[dict[str, Any]]:
    docs = []
    for p in sorted(PAGES.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        docs.append({"id": p.stem, "url": d["url"], "title": d.get("title") or "", "kind": "page", "text": d["text"]})
    for p in sorted((HOME / "wiki" / "artists").glob("*.md")):
        post = frontmatter.load(p)
        docs.append({"id": "wiki-" + _key(p.name), "url": f"wiki:{post.metadata.get('name', p.stem)}",
                     "title": f"위키 · {post.metadata.get('name_ko') or post.metadata.get('name')}", "kind": "wiki",
                     "text": post.content})
    return docs


# ---------------------------------------------------------------- 청크

def chunk(text: str) -> list[tuple[int, str]]:
    """문장 경계로 자른 약 CHUNK자 조각 [(시작 위치, 조각)]. 앞 조각의 끝 OVERLAP자를 다음 조각 앞에 겹친다."""
    sents, pos = [], 0
    for s in SENT.split(text):
        if s is None:
            continue
        i = text.find(s, pos)
        if s.strip():
            sents.append((i, s.strip()))
        pos = max(pos, i + len(s))
    out, cur, start = [], "", 0
    for i, s in sents:
        if not cur:
            start = i
        if cur and len(cur) + len(s) > CHUNK:
            out.append((start, cur))
            tail = cur[-OVERLAP:]
            cur, start = tail + " " + s, i - len(tail)
        else:
            cur = (cur + " " + s).strip()
    if cur.strip():
        out.append((start, cur))
    return [(st, c) for st, c in out if len(c) >= 60]


# ---------------------------------------------------------------- 아티스트 사전 (이름 정규화)

def artist_dictionary() -> dict[str, dict[str, Any]]:
    """정식 이름 → {names: 모든 표기}. 위키(이름·한글·별칭), 미개척지, 청취 기록에서 모은다."""
    groups: dict[str, set[str]] = {}

    def add(canon: str, *names: str | None) -> None:
        g = groups.setdefault(canon, set())
        g.update(n.strip() for n in (canon, *names) if n and len(n.strip()) >= 2)

    for p in (HOME / "wiki" / "artists").glob("*.md"):
        m = frontmatter.load(p).metadata
        add(m["name"], m.get("name_ko"), *(m.get("aliases") or []))
    fp = HOME / "wiki" / "frontier.json"
    if fp.exists():
        for x in json.loads(fp.read_text(encoding="utf-8")):
            add(x["name"], x.get("name_ko"), x.get("name_en"), *(x.get("aliases") or []))
    tm = HOME / "data" / "taste_map.json"
    if tm.exists():
        for a in json.loads(tm.read_text(encoding="utf-8")).get("artists", {}).values():
            add(a["name"])
    # 표기가 겹치는 묶음은 합친다 (위키의 'HYUKOH/혁오'와 미개척지의 '혁오')
    by_norm: dict[str, str] = {}
    merged: dict[str, set[str]] = {}
    for canon, names in groups.items():
        hit = next((by_norm[norm_name(n)] for n in names if norm_name(n) in by_norm), None)
        target = hit or canon
        merged.setdefault(target, set()).update(names)
        for n in merged[target]:
            by_norm[norm_name(n)] = target
    return {c: {"names": sorted(ns, key=len, reverse=True)} for c, ns in merged.items()}


def find_artists(query: str, dictionary: dict[str, dict[str, Any]]) -> list[str]:
    """질문 속 아티스트 표기 → 정식 이름들. 공백·대소문자·문장부호를 무시하고 맞춘다 ('세이 수미' = 'Say Sue Me' = '세이수미')."""
    q = norm_name(query)
    hits = []
    for canon, d in dictionary.items():
        if any(len(norm_name(n)) >= 2 and norm_name(n) in q for n in d["names"]):
            hits.append(canon)
    # 더 긴 이름에 포함된 짧은 이름은 뺀다 ('Silica Gel' 안의 'Gel' 같은 것)
    return [h for h in hits if not any(h != o and norm_name(h) in norm_name(o) for o in hits)]


# ---------------------------------------------------------------- BM25 (한글은 글자 2-gram)

def tokens(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[0-9a-zA-Z]+|[가-힣]+", text.casefold()):
        if re.match(r"[가-힣]", w):
            out += [w[i:i + 2] for i in range(len(w) - 1)] or [w]
        elif len(w) >= 2:
            out.append(w)
    return out


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.4, b: float = 0.75) -> None:
        self.tf = [Counter(d) for d in docs]
        self.len = np.array([len(d) for d in docs], dtype=float)
        self.avg = float(self.len.mean()) if len(docs) else 1.0
        df = Counter(t for d in self.tf for t in d)
        n = len(docs)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.k1, self.b = k1, b

    def scores(self, q: list[str]) -> np.ndarray:
        s = np.zeros(len(self.tf))
        for t in set(q):
            idf = self.idf.get(t)
            if not idf:
                continue
            f = np.array([tf.get(t, 0) for tf in self.tf], dtype=float)
            s += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len / self.avg))
        return s


# ---------------------------------------------------------------- 색인

_embedder = None


def _embed(texts: list[str], kind: str) -> np.ndarray:
    """e5는 'query: ' / 'passage: ' 접두어를 붙여야 제 성능이 난다. 정규화해서 내적 = 코사인."""
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding
        cache = os.environ.get("FASTEMBED_CACHE_PATH", str(Path.home() / ".cache" / "fastembed"))   # 모델은 한 번만 받는다(약 2GB)
        _embedder = TextEmbedding(MODEL, cache_dir=cache)
    v = np.array(list(_embedder.embed([f"{kind}: {t}" for t in texts], batch_size=16)), dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True).clip(1e-9)


def build() -> dict[str, Any]:
    """새 문서의 청크만 임베딩해 색인을 갱신한다 (이미 임베딩한 청크는 다시 하지 않는다)."""
    ROOT.mkdir(parents=True, exist_ok=True)
    meta_p, vec_p = ROOT / "chunks.json", ROOT / "vectors.npy"
    old = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.exists() else []
    old_vec = np.load(vec_p) if vec_p.exists() and old else np.zeros((0, 0), dtype=np.float32)
    have = {c["hash"]: i for i, c in enumerate(old)}
    chunks, rows, todo = [], [], []
    for d in _docs():
        for start, text in chunk(d["text"]):
            h = hashlib.sha1(f"{d['url']}|{text}".encode()).hexdigest()[:16]
            chunks.append({"hash": h, "doc": d["id"], "url": d["url"], "title": d["title"], "kind": d["kind"], "start": start, "text": text})
            if h in have:
                rows.append(old_vec[have[h]])
            else:
                rows.append(None); todo.append(len(chunks) - 1)
    t0 = time.monotonic()
    if todo:
        new = _embed([chunks[i]["text"] for i in todo], "passage")
        for j, i in enumerate(todo):
            rows[i] = new[j]
    vec = np.stack(rows).astype(np.float32) if rows else np.zeros((0, 1024), dtype=np.float32)
    meta_p.write_text(json.dumps(chunks, ensure_ascii=False), encoding="utf-8")
    np.save(vec_p, vec)
    global _index
    _index = None
    out = {"docs": len({c["doc"] for c in chunks}), "chunks": len(chunks), "embedded_now": len(todo), "seconds": round(time.monotonic() - t0, 1)}
    audit.emit("rag_build", **out)
    return out


_index: dict[str, Any] | None = None


def _load() -> dict[str, Any]:
    global _index
    if _index is None:
        meta_p, vec_p = ROOT / "chunks.json", ROOT / "vectors.npy"
        if not meta_p.exists():
            raise FileNotFoundError("원문 색인이 없어요. python -m digger.rag --build 를 먼저 실행하세요.")
        chunks = json.loads(meta_p.read_text(encoding="utf-8"))
        _index = {"chunks": chunks, "vec": np.load(vec_p), "bm25": BM25([tokens(c["text"]) for c in chunks]),
                  "dict": artist_dictionary()}
    return _index


def search(query: str, k: int = 5, artist: str | None = None) -> dict[str, Any]:
    """하이브리드 검색. 질문 속 아티스트는 사전으로 정규화해 모든 표기로 넓히고, 그 이름이 나오는 청크를 올린다."""
    ix = _load()
    chunks, n = ix["chunks"], len(ix["chunks"])
    names = find_artists(" ".join(x for x in (query, artist) if x), ix["dict"])
    aliases = [a for c in names for a in ix["dict"][c]["names"]]
    q_bm = tokens(query + " " + " ".join(aliases))
    bm = ix["bm25"].scores(q_bm)
    dense = ix["vec"] @ _embed([query], "query")[0]
    rank_bm = {int(i): r for r, i in enumerate(np.argsort(-bm)[:50]) if bm[i] > 0}
    rank_de = {int(i): r for r, i in enumerate(np.argsort(-dense)[:50])}
    fused: dict[int, float] = {}
    for ranks in (rank_bm, rank_de):
        for i, r in ranks.items():
            fused[i] = fused.get(i, 0.0) + 1 / (60 + r)
    if aliases:   # 그 아티스트가 실제로 나오는 청크만 남긴다 (다른 아티스트 인터뷰가 섞이지 않게)
        keys = {norm_name(a) for a in aliases}
        fused = {i: s * (1.6 if any(kk in norm_name(chunks[i]["text"]) for kk in keys) else 0.4) for i, s in fused.items()}
    picked, seen_doc = [], Counter()
    for i, s in sorted(fused.items(), key=lambda x: -x[1]):
        if s < MIN_RRF or len(picked) >= k:
            break
        c = chunks[i]
        if seen_doc[c["doc"]] >= 2:   # 한 문서가 결과를 독차지하지 않게
            continue
        seen_doc[c["doc"]] += 1
        picked.append({"url": c["url"], "title": c["title"], "kind": c["kind"], "text": c["text"], "score": round(s, 4),
                       "dense": round(float(dense[i]), 3), "bm25": round(float(bm[i]), 2)})
    audit.emit("rag_search", query=query[:80], artists=names, hits=len(picked), top=picked[0]["score"] if picked else 0)
    return {"query": query, "artists": names, "results": picked, "corpus_chunks": n,
            "note": ("결과 없음 = 저장된 원문에 이 내용이 없다. 지어내지 말고 '기록에 없어요'라고 답한다."
                     if not picked else "답은 results의 문장만 근거로 한다. 인용은 text에서 글자 그대로.")}


# ---------------------------------------------------------------- 지난 로그 다시 읽기

async def backfill() -> dict[str, int]:
    """로그에 남은 fetch 주소를 다시 읽어 저장한다. 직접 요청만 쓴다(Tavily 우회는 유료라 쓰지 않는다)."""
    from .sources.web import Web
    urls = []
    for f in sorted(LOGS.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("kind") == "fetch" and e.get("url") and e["url"] not in urls:
                urls.append(e["url"])
    todo = [u for u in urls if not (PAGES / f"{_key(u)}.json").exists()]
    web, ok, fail = Web(), 0, 0
    for u in todo:
        try:
            text = await web._direct(u)
            save_page(u, re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text), "backfill")
            ok += 1
        except Exception:   # noqa: BLE001 — 막힌 페이지는 건너뛴다
            fail += 1
    await web.aclose()
    return {"urls": len(urls), "fetched": ok, "failed": fail, "already": len(urls) - len(todo)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--ask")
    a = ap.parse_args()
    if a.backfill:
        print(asyncio.run(backfill()))
    if a.build:
        print(build())
    if a.ask:
        print(json.dumps(search(a.ask), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
