/** 점원이 먼저 묻는 질문: 평소엔 제목 아래 한 줄 알약, 누르면 그 자리에서 카드로 펼쳐진다.
 *  한 번에 하나, 보기 고르기 또는 직접 말하기. 다 답하면 사라진다. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { api, type Question } from '../api'

const spring = { type: 'spring', stiffness: 420, damping: 36 } as const

export function AskCard({ onQueued }: { onQueued: () => void }) {
  const [qs, setQs] = useState<Question[] | null>(null)
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [pick, setPick] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { api.questions().then(setQs).catch(() => setQs([])) }, [])
  useEffect(() => {   // 바깥을 누르거나 Esc면 다시 접힌다
    if (!open) return
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('pointerdown', down); addEventListener('keydown', esc)
    return () => { removeEventListener('pointerdown', down); removeEventListener('keydown', esc) }
  }, [open])

  if (!qs?.length) return null
  const q = qs[i]
  const left = qs.filter((x) => !done[x.id]).length
  const go = (k: number) => { setI(k); setPick(null); setText('') }
  const send = async () => {
    if (sending || (pick === null && !text.trim())) return
    setSending(true)
    try {
      const r = await api.answer(q.id, pick, text.trim())
      setDone((d) => ({ ...d, [q.id]: true }))
      if (r.queued) onQueued()
      const next = qs.findIndex((x, k) => k !== i && !done[x.id])
      setTimeout(() => (next >= 0 ? go(next) : setQs([])), 1300)   // 다 답하면 접힌 채 사라진다
    } catch { /* 다음에 다시 묻는다 */ } finally { setSending(false) }
  }

  return (
    <motion.div ref={box} layout transition={spring} style={{ borderRadius: open ? 20 : 999 }}
                className={`bar pointer-events-auto overflow-hidden ring-1 ring-line shadow-[0_24px_60px_-24px_rgb(0_0_0/0.9)] ${open ? 'w-[min(360px,calc(100vw-32px))]' : 'max-w-[min(420px,calc(100vw-32px))]'}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        {!open ? (
          <motion.button key="pill" layout="position" onClick={() => setOpen(true)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                         className="flex h-10 w-full items-center gap-2.5 pl-3 pr-4 text-left" aria-expanded={false} aria-label={`점원의 질문 ${left}개: ${q.text}`}>
            <span className="relative grid h-5 w-5 shrink-0 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/40 [animation-duration:2.4s]" />
              <span className="h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">{q.text}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{left}</span>
          </motion.button>
        ) : (
          <motion.div key="card" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.08 } }} exit={{ opacity: 0 }} aria-label="점원의 질문" role="dialog">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={q.id + (done[q.id] ? ':ok' : '')} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                {done[q.id] ? (
                  <div className="flex items-center gap-3 px-4 py-6">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-fg"><Check size={15} /></span>
                    <p className="text-[14.5px] font-semibold">받아 적었어요</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 pl-4 pr-2 pt-3.5">
                      <p className="min-w-0 flex-1 pt-0.5 text-[15px] font-bold leading-[1.5] tracking-[-0.025em] [text-wrap:pretty]">{q.text}</p>
                      <button onClick={() => setOpen(false)} aria-label="접기" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-3 hover:bg-fill hover:text-fg"><X size={15} /></button>
                    </div>
                    <p className="px-4 pt-0.5 text-[12.5px] text-fg-3">{q.why}</p>
                    <div role="radiogroup" aria-label="답" className="grid gap-0.5 px-2 pt-2.5">
                      {q.options.map((o, k) => (
                        <label key={o} className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[14px] transition-colors hover:bg-fill-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${pick === k ? 'bg-fill-2' : ''}`}>
                          <input type="radio" name={q.id} checked={pick === k} onChange={() => setPick(k)} className="sr-only" />
                          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ring-[1.5px] ring-inset ${pick === k ? 'ring-fg' : 'ring-fg-3'}`}>
                            {pick === k && <span className="h-2 w-2 rounded-full bg-fg" />}
                          </span>
                          {o}
                        </label>
                      ))}
                    </div>
                    <div className="mx-4 mt-1 border-t border-line">
                      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} maxLength={120}
                             placeholder="직접 말하기" aria-label="직접 말하기" className="w-full bg-transparent py-2.5 text-[14px] outline-none placeholder:text-fg-3" />
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="flex items-center gap-1 border-t border-line py-2 pl-2 pr-2.5">
              <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="이전 질문" className="grid h-7 w-7 place-items-center rounded-lg text-fg-2 hover:bg-fill disabled:opacity-30"><ChevronLeft size={16} /></button>
              <span className="flex gap-1.5" aria-label={`${qs.length}개 중 ${i + 1}번째`}>
                {qs.map((x, k) => <span key={x.id} className={`h-1.5 w-1.5 rounded-full transition-colors ${k === i ? 'bg-fg' : done[x.id] ? 'bg-fg-2' : 'bg-fg-3/60'}`} />)}
              </span>
              <button onClick={() => go(i + 1)} disabled={i === qs.length - 1} aria-label="다음 질문" className="grid h-7 w-7 place-items-center rounded-lg text-fg-2 hover:bg-fill disabled:opacity-30"><ChevronRight size={16} /></button>
              <button onClick={send} disabled={done[q.id] || sending || (pick === null && !text.trim())} aria-label="답 보내기"
                      className="ml-auto grid h-8 w-8 place-items-center rounded-[10px] bg-fg text-black transition disabled:bg-fill-2 disabled:text-fg-3">
                <ArrowUp size={15} strokeWidth={2.4} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
