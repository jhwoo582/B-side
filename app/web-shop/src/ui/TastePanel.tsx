/** 내 취향: 유형 + 오각형 그래프(보컬·사운드·분위기·가사·에너지) + 좋아할 만한 장르·아티스트 + 점원이 적어 둔 메모·받아 적은 말.
 *  기록이 없는 축은 점선으로 비워 둔다(지어내지 않는다). */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight, RefreshCw, X } from 'lucide-react'
import { api, type Taste } from '../api'

export function TastePanel({ onClose, onAsk }: { onClose: () => void; onAsk: (say: string) => void }) {
  const [t, setT] = useState<Taste | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.taste().then((d) => { setT(d); setBusy(d.refreshing) }).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!busy) return
    const id = setInterval(load, 2500)
    return () => clearInterval(id)
  }, [busy])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const type = t?.type
  return (
    <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div role="dialog" aria-label="내 취향" onClick={(e) => e.stopPropagation()}
                  initial={{ y: 24, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                  className="bar scroll-y relative max-h-[88vh] w-full max-w-[880px] rounded-[28px] p-6 shadow-[0_60px_140px_-30px_rgb(0_0_0/0.95)] ring-1 ring-line sm:p-9">
        <button onClick={onClose} aria-label="닫기" className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"><X size={18} /></button>
        {!t || !type ? <p className="py-20 text-center text-fg-3">취향 기록을 불러오는 중</p> : (
          <>
            <header>
              <div className="flex gap-1.5">
                {type.axes.map((a) => (
                  <span key={a.key} title={`${a.label}: ${a.known ? (a.value < 0 ? a.left : a.right) : '아직 모름'}`}
                        className={`grid h-12 w-10 place-items-center rounded-xl text-[24px] font-extrabold ${a.known ? 'bg-white text-black' : 'text-fg-3 ring-1 ring-white/25'}`}>{a.letter}</span>
                ))}
              </div>
              <h2 className="mt-4 text-[clamp(26px,3vw,34px)] font-serif font-bold tracking-[-0.03em]">{type.name}</h2>
              <p className="mt-1 text-[16px] text-fg-2">{type.line}</p>
            </header>

            <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
              <Radar data={t.radar} />
              <div className="space-y-5">
                {type.axes.map((a) => (
                  <div key={a.key}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className={a.known && a.value < 0 ? 'font-semibold text-fg' : 'text-fg-3'}>{a.left}</span>
                      <span className="text-[12px] text-fg-3">{a.label}{a.known ? ` · 기록 ${a.evidence}` : ' · 아직 모름'}</span>
                      <span className={a.known && a.value > 0 ? 'font-semibold text-fg' : 'text-fg-3'}>{a.right}</span>
                    </div>
                    <div className="relative mt-2 h-1 rounded-full bg-white/10">
                      <span className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/25" />
                      {a.known && <motion.span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--album)/0.8)]"
                                               initial={{ left: '50%' }} animate={{ left: `${50 + a.value * 50}%` }} transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.2 }} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-8 border-t border-line pt-8 md:grid-cols-2">
              <section>
                <h3 className="text-[13px] font-medium text-fg-3">좋아할 만한 장르</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {type.genres.map((g) => <span key={g} className="rounded-full bg-fill-2 px-3.5 py-1.5 text-[14px] font-medium ring-1 ring-line">{g}</span>)}
                </div>
              </section>
              <section>
                <h3 className="text-[13px] font-medium text-fg-3">이런 아티스트도 들어 보세요</h3>
                <ul className="mt-2 divide-y divide-line">
                  {type.artists.map((a) => (
                    <li key={a}>
                      <button onClick={() => { onAsk(`${a} 같은 결로 한 곡 찾아줘`); onClose() }} className="group flex w-full items-center justify-between py-2.5 text-left text-[15px] font-medium">
                        {a}<span className="inline-flex items-center gap-1 text-[12.5px] text-fg-3 transition group-hover:text-fg">점원에게 찾아 달라기<ArrowUpRight size={14} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {(t.summary || t.notes.length > 0) && (
              <section className="mt-8 border-t border-line pt-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-medium text-fg-3">점원이 기억하는 것</h3>
                  <button onClick={async () => { setBusy(true); try { await api.tasteRefresh() } finally { load() } }} disabled={busy}
                          className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 transition hover:text-fg disabled:opacity-50">
                    <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />{busy ? '다시 정리하는 중' : '다시 정리'}
                  </button>
                </div>
                {t.summary && <p className="mt-3 text-[16px] leading-[1.7]">{t.summary}</p>}
                <ul className="mt-4 space-y-2">
                  {t.notes.map((n) => (
                    <li key={n.id} className="flex gap-3 text-[14px] leading-[1.6] text-fg-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-fg-3" />{n.text}</li>
                  ))}
                </ul>
              </section>
            )}

            {t.signals.length > 0 && (
              <section className="mt-8 border-t border-line pt-8">
                <h3 className="text-[13px] font-medium text-fg-3">대화에서 받아 적은 말 · 틀리면 지워 주세요</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.signals.map((x) => (
                    <span key={x.id} title={x.said} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill pl-3.5 pr-1.5 text-[13.5px] ring-1 ring-line">
                      <span className="text-[12px] text-fg-3">{x.kind === 'like' ? '좋아함' : x.kind === 'less' ? '덜 듣기' : '요즘'}</span>{x.text}
                      <button onClick={async () => setT(await api.removeSignal(x.id))} aria-label={`${x.text} 지우기`} className="grid h-6 w-6 place-items-center rounded-full text-fg-3 hover:bg-fill-2 hover:text-fg"><X size={13} /></button>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

/** 오각형 그래프. 기록이 없는 축은 꼭짓점을 비워(점선) 둔다 */
function Radar({ data }: { data: { axis: string; value: number; evidence: number }[] }) {
  const R = 120, C = 160
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / data.length
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const
  }
  const ring = (f: number) => data.map((_, i) => pt(i, R * f).join(',')).join(' ')
  const shape = data.map((d, i) => pt(i, R * Math.max(0.08, d.value)).join(',')).join(' ')
  return (
    <svg viewBox="0 0 320 320" className="mx-auto w-full max-w-[340px]" role="img" aria-label={data.map((d) => `${d.axis} ${Math.round(d.value * 100)}`).join(', ')}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ring(f)} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={1} />)}
      {data.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="rgb(255 255 255 / 0.08)" /> })}
      <motion.polygon points={shape} fill="rgb(var(--album) / 0.28)" stroke="rgb(var(--album))" strokeWidth={2} strokeLinejoin="round"
                      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ originX: `${C}px`, originY: `${C}px` }} transition={{ type: 'spring', stiffness: 90, damping: 14, delay: 0.1 }} />
      {data.map((d, i) => {
        const [x, y] = pt(i, R * Math.max(0.08, d.value))
        const [lx, ly] = pt(i, R + 26)
        const known = d.evidence > 0
        return (
          <g key={d.axis}>
            <circle cx={x} cy={y} r={known ? 4.5 : 4} fill={known ? 'rgb(var(--album))' : '#111'} stroke={known ? 'none' : 'rgb(255 255 255 / 0.45)'} strokeDasharray={known ? undefined : '2 2'} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill={known ? '#fff' : 'rgb(255 255 255 / 0.4)'} fontSize="13" fontWeight={known ? 600 : 400}>{d.axis}</text>
          </g>
        )
      })}
    </svg>
  )
}
