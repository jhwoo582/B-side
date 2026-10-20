/** '이 판 이야기': 왼쪽은 큰 앨범아트와 삐져나온 바이닐, 오른쪽은 이름 → 턴테이블에 올리기 → 근거 → 반응 → (접힌) 말대꾸.
 *  판을 끌어 오른쪽으로 놓아도 턴테이블에 올라간다. */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { REACTION_LABEL, type Candidate, type Feedback, type Reaction } from '../../api'
import { ReactionForm } from './ReactionForm'
import { Retort } from './Retort'
import { WhyPanel } from '../WhyPanel'
import { usePlayer } from '../../player'
import { SleeveArt } from '../SleeveArt'

export function SleeveDetail({ c, date, n, total, onClose, onPrev, onNext, onReact, onRetortDone }: {
  c: Candidate; date: string; n: number; total: number
  onClose: () => void; onPrev: () => void; onNext: () => void
  onReact: (f: Feedback) => void
  onRetortDone: (newArtist: string | null) => void
}) {
  const player = usePlayer()
  const [retortOpen, setRetortOpen] = useState(false)
  const isPlaying = player.current?.artist === c.artist && player.playing
  useEffect(() => setRetortOpen(false), [c.artist])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const play = () => { if (!isPlaying) player.play(c); onClose() }

  return (
    <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div className="relative flex max-h-full w-full max-w-6xl flex-col items-center gap-10 overflow-y-auto px-5 py-10 lg:flex-row lg:items-start lg:justify-center"
           onClick={(e) => e.stopPropagation()}>

        {/* ---------- 판 ---------- */}
        <motion.div className="relative shrink-0 lg:sticky lg:top-0" initial={{ y: 40, opacity: 0, scale: 0.94 }} animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 150, damping: 20 }}>
          {c.track?.video_id && !isPlaying && (
            <motion.div className="vinyl absolute top-[4%] h-[92%] cursor-grab rounded-full shadow-2xl active:cursor-grabbing"
                        style={{ aspectRatio: '1', right: '-30%' }}
                        drag="x" dragSnapToOrigin dragConstraints={{ left: -30, right: 360 }} dragElastic={0.1}
                        whileHover={{ x: 16 }}
                        onDragEnd={(_, i) => { if (i.offset.x > 140) play() }}
                        aria-label="오른쪽으로 끌어서 재생">
              <div className="absolute inset-[33%] overflow-hidden rounded-full"><SleeveArt c={c} /></div>
            </motion.div>
          )}
          <div className="relative h-[min(80vw,440px)] w-[min(80vw,440px)] overflow-hidden rounded-md shadow-[0_40px_80px_-25px_rgba(0,0,0,0.9)]">
            <SleeveArt c={c} />
            <AnimatePresence>{c.feedback?.reaction && <Sticker r={c.feedback.reaction} />}</AnimatePresence>
          </div>
        </motion.div>

        {/* ---------- 이야기 ---------- */}
        <motion.div className="w-full max-w-[460px] lg:max-w-[604px] lg:pl-36" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 }}>
          <div className="text-[13px] text-white/55">{n} / {total}{c.reply_to ? ' · 답장' : c.kind === 'hidden_track' ? ' · 숨은 곡' : ''}</div>
          <h2 className="mt-1 text-[44px] font-black leading-[1.02] tracking-[-0.045em]">{c.artist_ko || c.artist}</h2>
          {c.artist_ko && c.artist_ko !== c.artist && <div className="text-[15px] text-white/60">{c.artist}</div>}
          <div className="mt-2 text-[16px] text-white/80">{c.track?.title ?? ''}{c.track?.album && c.track.album !== c.track.title && <span className="text-white/50">, {c.track.album}</span>}</div>

          <div className="mt-6 flex items-center gap-2">
            <button disabled={!c.track?.video_id} onClick={() => (isPlaying ? player.toggle() : play())}
                    className="h-12 flex-1 rounded-full bg-white text-[15px] font-semibold text-black transition hover:scale-[1.02] disabled:opacity-30">
              {isPlaying ? '일시정지' : '재생'}
            </button>
            {c.track?.url && (
              <a href={c.track.url} target="_blank" rel="noreferrer" aria-label="YouTube Music에서 열기"
                 className="grid h-12 w-12 place-items-center rounded-full border border-white/25 text-white/80 transition hover:border-white hover:text-white">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M6 3h7v7M13 3 4 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
              </a>
            )}
          </div>

          {c.kind === 'new' && <div className="mt-6"><ReactionForm c={c} date={date} onSaved={onReact} /></div>}

          <div className="mt-6"><WhyPanel c={c} /></div>

          {c.kind === 'new' && (
            <div className="mt-4">
              <button onClick={() => setRetortOpen((o) => !o)} aria-expanded={retortOpen}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/10 px-5 py-3.5 text-left text-[14px] transition hover:border-white/30">
                <span>다른 이유로 찾아 달라고 하기</span>
                <span className={`transition-transform ${retortOpen ? 'rotate-90' : ''}`} aria-hidden>›</span>
              </button>
              <AnimatePresence initial={false}>
                {retortOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-1">
                    <Retort c={c} date={date} onDone={onRetortDone} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between text-[13px] text-white/55">
            <button onClick={onPrev} disabled={n === 1} className="hover:text-white disabled:opacity-30">이전</button>
            <button onClick={onClose} className="hover:text-white">닫기</button>
            <button onClick={onNext} disabled={n === total} className="hover:text-white disabled:opacity-30">다음</button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

export function Sticker({ r, small = false }: { r: Reaction; small?: boolean }) {
  const s = REACTION_LABEL[r]
  return (
    <motion.div initial={{ scale: 2.4, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: 14, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className={`absolute right-3 top-3 flex flex-col items-center justify-center rounded-full font-semibold text-black shadow-lg ${small ? 'h-9 w-9 text-sm' : 'h-20 w-20'}`}
                style={{ background: s.color, boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.35), 0 6px 14px rgba(0,0,0,0.3)' }}>
      <span className={small ? 'text-base' : 'text-2xl leading-none'}>{s.emoji}</span>
      {!small && <span className="mt-0.5 text-[11px]">{s.label}</span>}
    </motion.div>
  )
}
