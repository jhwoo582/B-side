/** 아티스트 기록장 (위키 페이지). 지도에서 별을 누르면 오른쪽에 유리 패널로 열린다. */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, EDGE_HEX, EDGE_LABEL, REACTION_LABEL, type WikiPage } from '../api'
import { GeneratedSleeve } from './SleeveArt'

const toSlug = (name: string) => name.replace(/[\\/:*?"<>|#[\]]/g, '').trim().replace(/\s+/g, '_')
const fmtDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

export function ArtistSheet({ slug, onClose, onNavigate }: { slug: string | null; onClose: () => void; onNavigate: (slug: string) => void }) {
  const [page, setPage] = useState<WikiPage | null>(null)
  useEffect(() => {
    setPage(null)
    if (slug) api.page(slug).then(setPage).catch(() => setPage(null))
  }, [slug])
  const m = page?.meta
  const listens = (m as { listens?: { signal: string }[] } | undefined)?.listens ?? []

  return (
    <AnimatePresence>
      {slug && (
        <motion.aside key="sheet" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      className="absolute bottom-24 right-5 top-14 z-30 flex w-[min(400px,calc(100%-2.5rem))] flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/35 backdrop-blur-2xl lg:right-10">
          <header className="flex items-start gap-4 p-5">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl shadow-lg">
              {m?.thumb ? <img src={`/api/img?url=${encodeURIComponent(m.thumb)}`} alt="" className="h-full w-full object-cover" /> : <GeneratedSleeve name={m?.name ?? slug} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-white/55">{m?.role === 'seed' ? '원래 좋아하던 아티스트' : '찾아가다 만난 아티스트'}</div>
              <h3 className="truncate text-[26px] font-black leading-tight tracking-[-0.04em]">{m?.name_ko || m?.name || ''}</h3>
              {m?.name_ko && m.name !== m.name_ko && <div className="truncate text-[13px] text-white/60">{m.name}</div>}
              {m && m.role !== 'seed' && <div className="mt-0.5 text-[12px] text-white/50">처음 만난 날 {fmtDate(String(m.first_seen))}</div>}
            </div>
            <button onClick={onClose} aria-label="닫기" className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6">
            {!page && <div className="text-white/50">불러오는 중…</div>}
            {m && (
              <>
                <section>
                  <h4 className="text-[12px] font-semibold text-white/55">만나게 된 경로</h4>
                  {m.paths?.length ? m.paths.map((p, i) => (
                    <div key={i} className="mt-3">
                      <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
                        <button onClick={() => onNavigate(toSlug(p.from))} className="font-semibold hover:underline">{p.from}</button>
                        <span style={{ color: EDGE_HEX[p.edge] }}>{EDGE_LABEL[p.edge] ?? p.edge}</span>
                        <span className="text-white/40">{fmtDate(String(p.date))}</span>
                      </div>
                      <blockquote className="mt-2 border-l-2 pl-3 text-[15px] leading-relaxed text-white/90" style={{ borderColor: EDGE_HEX[p.edge] }}>“{p.quote}”</blockquote>
                      <a href={p.source_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12px] text-white/45 underline-offset-4 hover:text-white hover:underline">
                        {[p.source_name, p.source_type].filter(Boolean).join(', ') || new URL(p.source_url).hostname}
                      </a>
                    </div>
                  )) : <p className="mt-2 text-[14px] text-white/55">원래 좋아하던 아티스트예요. 여기서 찾은 음악들이 이 별을 중심으로 돌아요.</p>}
                </section>

                <section>
                  <h4 className="text-[12px] font-semibold text-white/55">내 반응</h4>
                  {m.reactions?.length ? m.reactions.map((r, i) => (
                    <div key={i} className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[14px]">
                      {r.reaction && <span style={{ color: REACTION_LABEL[r.reaction].color }}>{REACTION_LABEL[r.reaction].label}</span>}
                      {r.reason && <span className="text-white/80">“{r.reason}”</span>}
                      <span className="text-[12px] text-white/40">{fmtDate(String(r.date))}</span>
                    </div>
                  )) : <p className="mt-2 text-[14px] text-white/45">아직 없어요</p>}
                  {listens.length > 0 && (
                    <p className="mt-2 text-[13px] text-white/55">
                      끝까지 들음 {listens.filter((x) => x.signal === 'full').length}회 · 건너뜀 {listens.filter((x) => x.signal !== 'full').length}회
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
