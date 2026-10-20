/** 오늘의 판 턴테이블 아래: 잡지 풀 쿼트처럼 근거를 보여준다.
 *  제목 → 큰 구절(원문 그대로) → 누가 한 말인지 → (펼치면) 앞뒤 문맥 → 이런 이유로 추천해 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EDGE_HEX, EDGE_LABEL, type Candidate } from '../api'

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const sentences = (t: string) => t.split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean)

export function WhyPanel({ c }: { c: Candidate }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [c.artist])
  const ev = (c.sources ?? []).find((s) => s.kind === '근거 원문')
  const check = (c.sources ?? []).find((s) => s.kind !== '근거 원문')
  const hop = c.path[0]
  const d = c.display
  const color = EDGE_HEX[hop?.edge ?? ''] ?? '#5b5347'
  const before = ev?.excerpt ? sentences(ev.excerpt.before) : []
  const after = ev?.excerpt ? sentences(ev.excerpt.after) : []

  return (
    <AnimatePresence mode="wait">
      <motion.section key={c.artist} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }} className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/25 backdrop-blur-xl">
        <div className="max-h-[40vh] overflow-y-auto px-6 pb-4 pt-4">
          {!ev ? (
            <>
              <div className="text-[13px] text-ink-faint">숨은 곡</div>
              <p className="mt-2 font-serif text-[17px] leading-relaxed">{c.why}</p>
            </>
          ) : (
            <>
              {/* 제목 */}
              <div className="relative text-[13px]" style={{ color }}>{hop?.from} · {EDGE_LABEL[hop?.edge ?? ''] ?? hop?.edge}</div>
              <h3 className="relative mt-1 text-[22px] font-extrabold leading-tight tracking-[-0.03em]">{d?.title ?? hop?.connection}</h3>

              {/* 풀 쿼트: 원문 그대로 */}
              <figure className="relative mt-4 pl-1">
                <span aria-hidden className="absolute -left-2 -top-6 font-display text-[72px] leading-none" style={{ color: 'rgb(var(--album))', opacity: 0.45 }}>“</span>
                <blockquote className="relative text-[20px] font-medium leading-[1.6] tracking-[-0.02em] text-white [text-wrap:pretty]">
                  {d?.pull ?? ev.quote}
                </blockquote>
                <figcaption className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                  <span className="text-ink">— {d?.speaker ? <b>{d.speaker}</b> : ev.label}</span>
                  {d?.speaker && <span className="text-ink-soft">{d.role || ev.label}</span>}
                  <a href={ev.url} target="_blank" rel="noreferrer" className="text-[12px] text-ink-faint underline decoration-ink/30 underline-offset-4 hover:text-ink">
                    출처 {host(ev.url)}
                  </a>
                </figcaption>
              </figure>

              {/* 앞뒤 문맥: 문장 단위로, 근거 문장만 진하게 */}
              {(before.length > 0 || after.length > 0 || (d?.pull && d.pull !== ev.quote)) && (
                <button onClick={() => setOpen((o) => !o)} className="mt-4 text-[13px] text-ink-faint hover:text-ink">
                  {open ? '문맥 접기' : '앞뒤 문맥 보기'}
                </button>
              )}
              <AnimatePresence>
                {open && ev.excerpt && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="mt-2 space-y-2 border-l pl-3 text-[14.5px] leading-[1.8]" style={{ borderColor: `${color}55` }}>
                      {before.map((x, i) => <p key={`b${i}`} className="text-ink-faint">{x}</p>)}
                      <p className="font-semibold text-ink">{ev.excerpt.quote}</p>
                      {after.map((x, i) => <p key={`a${i}`} className="text-ink-faint">{x}</p>)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {check && (
                <div className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
                  연결 확인: <a href={check.url} target="_blank" rel="noreferrer" className="underline decoration-ink/30 underline-offset-4 hover:text-ink">{check.label}</a>
                </div>
              )}
            </>
          )}
        </div>

        {c.why && ev && (
          <footer className="relative border-t border-white/10 bg-white/[0.04] px-6 py-3.5">
            <div className="text-[12px] font-semibold" style={{ color: 'rgb(var(--album))' }}>추천 이유</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink">{c.why}</p>
          </footer>
        )}
      </motion.section>
    </AnimatePresence>
  )
}
