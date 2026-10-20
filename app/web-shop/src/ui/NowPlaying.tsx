/** 재생 바(아래 고정)와 펼친 턴테이블 화면.
 *  펼친 화면에선 가사 자리에 '이 곡을 고른 이유'의 원문이 흐르고, 재생 위치에 맞춰 한 줄씩 밝아진다. */
import { useEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, Loader2, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import type { Candidate } from '../api'
import { usePlayer } from '../player'
import { Art, Orb, Vinyl, clerkLine, edgeOf, fmtTime, hostOf, ko, nameOf, unquote } from './kit'

function useQueue(items: Candidate[], fallback: Candidate | undefined) {
  const p = usePlayer()
  const c = p.current ?? fallback
  const i = c ? items.findIndex((x) => x.artist === c.artist) : -1
  const live = !!p.current
  return {
    p, c, i, live,
    playPause: () => (live ? p.toggle() : c && p.play(c)),
    prev: () => { const j = i - 1; if (items[j]) p.play(items[j]) },
    next: () => { const j = i + 1; if (items[j]) p.play(items[j]) },
  }
}

function Scrubber({ big = false }: { big?: boolean }) {
  const p = usePlayer()
  const track = useRef<HTMLDivElement>(null)
  const at = (e: React.PointerEvent) => { const r = track.current!.getBoundingClientRect(); p.seek((e.clientX - r.left) / r.width) }
  return (
    <div className="flex w-full items-center gap-3 text-[11.5px] tabular-nums text-fg-3">
      <span className="w-9 text-right">{fmtTime(p.progress * p.duration)}</span>
      <div ref={track} onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); at(e) }} onPointerMove={(e) => e.buttons && at(e)}
           role="slider" aria-label="재생 위치" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress * 100)}
           className={`group relative flex-1 cursor-pointer py-2`}>
        <div className={`relative overflow-hidden rounded-full bg-white/15 transition-all ${big ? 'h-1.5' : 'h-1 group-hover:h-1.5'}`}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${p.progress * 100}%` }} />
        </div>
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition group-hover:opacity-100" style={{ left: `${p.progress * 100}%` }} />
      </div>
      <span className="w-9">{fmtTime(p.duration)}</span>
    </div>
  )
}

function Controls({ q, big = false }: { q: ReturnType<typeof useQueue> & { items: number }; big?: boolean }) {
  const s = big ? 26 : 19
  return (
    <div className={`flex items-center justify-center ${big ? 'gap-8' : 'gap-5'}`}>
      <button onClick={q.prev} disabled={q.i <= 0} aria-label="이전 곡" className="text-fg-2 transition hover:text-fg disabled:opacity-30"><SkipBack size={s} fill="currentColor" /></button>
      <button onClick={q.playPause} disabled={!q.c?.track?.video_id} aria-label={q.p.playing ? '멈추기' : '재생'}
              className={`grid place-items-center rounded-full bg-white text-black transition hover:scale-105 active:scale-95 disabled:opacity-40 ${big ? 'h-16 w-16' : 'h-10 w-10'}`}>
        {q.live && q.p.loading ? <Loader2 size={s} className="animate-spin" /> : q.live && q.p.playing ? <Pause size={s} fill="currentColor" /> : <Play size={s} fill="currentColor" className="translate-x-[1.5px]" />}
      </button>
      <button onClick={q.next} disabled={q.i < 0 || q.i >= q.items - 1} aria-label="다음 곡" className="text-fg-2 transition hover:text-fg disabled:opacity-30"><SkipForward size={s} fill="currentColor" /></button>
    </div>
  )
}

export function PlayerBar({ items, fallback, onFull, onClerk, onSelect, clerkOpen }: {
  items: Candidate[]; fallback?: Candidate; onFull: () => void; onClerk: () => void; onSelect: (i: number) => void; clerkOpen: boolean
}) {
  const base = useQueue(items, fallback)
  const q = { ...base, items: items.length }
  const c = q.c
  if (!c) return null
  return (
    <footer className="bar relative z-30 border-t border-line">
      {/* 모바일: 위 가장자리에 얇은 진행선 */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-white/10 md:hidden"><div className="h-full bg-white" style={{ width: `${q.p.progress * 100}%` }} /></div>
      <div className="mx-auto grid h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 sm:px-5 md:h-[84px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onFull} aria-label="턴테이블 펼치기" className="group relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[6px] ring-1 ring-white/10">
            <Art c={c} />
            <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100"><ChevronDown size={18} className="rotate-180" /></span>
          </button>
          <button onClick={() => q.i >= 0 && onSelect(q.i)} className="min-w-0 text-left">
            <span className="block truncate text-[14.5px] font-semibold">{c.track?.title ?? '재생할 곡 없음'}</span>
            <span className="block truncate text-[13px] text-fg-3">{q.p.error && q.live ? q.p.error : nameOf(c)}</span>
          </button>
          {q.live && q.p.muted && (
            <button onClick={q.p.unmute} className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-[12.5px] font-semibold text-black"><Volume2 size={14} />소리 켜기</button>
          )}
        </div>

        <div className="hidden min-w-0 flex-col items-center gap-0.5 md:flex">
          <Controls q={q} />
          <div className="w-full max-w-[560px]"><Scrubber /></div>
        </div>

        <div className="flex items-center justify-end gap-1">
          <div className="md:hidden">
            <button onClick={q.playPause} aria-label={q.p.playing ? '멈추기' : '재생'} className="grid h-10 w-10 place-items-center rounded-full bg-white text-black">
              {q.live && q.p.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-[1px]" />}
            </button>
          </div>
          <button onClick={onFull} className="hidden h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-fg-2 transition hover:bg-fill hover:text-fg md:inline-flex">
            <Disc size={16} />턴테이블
          </button>
          <button onClick={onClerk} aria-pressed={clerkOpen} className={`hidden h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition md:inline-flex ${clerkOpen ? 'bg-white text-black' : 'text-fg-2 hover:bg-fill hover:text-fg'}`}>
            <Orb size={16} active={false} />점원
          </button>
        </div>
      </div>
    </footer>
  )
}

const Disc = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg>
)

/** 원문을 가사처럼 줄로 나눈다: 문장 끝에서, 긴 문장은 쉼표에서 */
function lines(text: string) {
  const out: string[] = []
  for (const s of text.split(/(?<=[.!?…])\s+/)) {
    if (s.length <= 46) { out.push(s); continue }
    let buf = ''
    for (const part of s.split(/(?<=,)\s+/)) {
      if ((buf + ' ' + part).trim().length > 46 && buf) { out.push(buf.trim()); buf = part } else buf = `${buf} ${part}`
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out.filter(Boolean)
}

export function FullPlayer({ items, fallback, onClose }: { items: Candidate[]; fallback?: Candidate; onClose: () => void }) {
  const base = useQueue(items, fallback)
  const q = { ...base, items: items.length }
  const c = q.c
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const claim = c?.claims[0]
  const text = c ? (claim ? unquote(c.sources?.find((s) => s.kind === '근거 원문')?.excerpt?.quote ?? claim.quote) : clerkLine(c)) : ''
  const ls = useMemo(() => lines(text), [text])
  if (!c) return null
  const playingThis = q.live && q.p.playing
  const cur = q.live ? Math.min(ls.length - 1, Math.floor(q.p.progress * ls.length * 1.15)) : -1
  const hop = c.path[0]

  return (
    <motion.div role="dialog" aria-label="턴테이블" className="fixed inset-0 z-50 flex flex-col bg-black/45 backdrop-blur-[60px]"
                initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
      <div className="flex items-center justify-between px-5 pt-5 sm:px-8">
        <button onClick={onClose} aria-label="접기" className="grid h-10 w-10 place-items-center rounded-full bg-fill text-fg-2 transition hover:bg-fill-2 hover:text-fg"><ChevronDown size={22} /></button>
        <span className="text-[13px] text-fg-3">{q.i + 1} / {items.length}</span>
        <span className="w-10" />
      </div>

      <div className="mx-auto grid min-h-0 w-full max-w-[1200px] flex-1 items-center gap-10 px-6 py-6 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:px-10">
        {/* 턴테이블 */}
        <div className="mx-auto w-full max-w-[520px]">
          <div className="relative aspect-[1/0.86] rounded-[28px] bg-[linear-gradient(160deg,#2a2a2a,#121212_60%)] p-[6%] shadow-[0_50px_100px_-40px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.08)] ring-1 ring-white/10">
            <div className="relative aspect-square h-full rounded-full bg-[#0b0b0b] p-[2.5%] shadow-[inset_0_2px_10px_rgb(0_0_0/0.8)]">
              <Vinyl c={c} spinning={playingThis} className="h-full w-full" />
            </div>
            {/* 톤암: 재생하면 판 위로 넘어온다 */}
            <motion.svg viewBox="0 0 60 200" className="absolute right-[7%] top-[7%] h-[78%] origin-[50%_10%]" animate={{ rotate: playingThis ? 24 : 2 }} transition={{ type: 'spring', stiffness: 60, damping: 14 }} aria-hidden>
              <circle cx="30" cy="20" r="16" fill="#3a3a3a" stroke="#555" />
              <circle cx="30" cy="20" r="6" fill="#999" />
              <path d="M30 20 L30 150 L18 178" stroke="#cfcfcf" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="8" y="172" width="18" height="24" rx="3" fill="#e5e5e5" transform="rotate(20 17 184)" />
            </motion.svg>
            <span className="absolute bottom-[6%] right-[7%] h-2 w-2 rounded-full" style={{ background: playingThis ? 'rgb(var(--album))' : '#444', boxShadow: playingThis ? '0 0 10px rgb(var(--album))' : 'none' }} />
          </div>
        </div>

        {/* 곡 정보 + 원문 */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-4">
            <span className="h-16 w-16 shrink-0 overflow-hidden rounded-[6px] ring-1 ring-white/10"><Art c={c} /></span>
            <div className="min-w-0">
              <h2 className="truncate text-[26px] font-serif font-bold tracking-[-0.025em]">{c.track?.title}</h2>
              <p className="truncate text-[16px] text-fg-2">{nameOf(c)}{hop && <span className="text-fg-3"> · {ko(hop.from)}에서 <span style={{ color: edgeOf(hop.edge).color }}>{edgeOf(hop.edge).label}</span></span>}</p>
            </div>
          </div>
          <div className="no-scrollbar mt-8 max-h-[42vh] space-y-3 overflow-y-auto">
            {ls.map((l, k) => (
              <motion.p key={k} animate={{ opacity: cur < 0 ? 0.85 : k === cur ? 1 : k < cur ? 0.35 : 0.22 }} transition={{ duration: 0.5 }}
                        className="origin-left text-[clamp(22px,2.4vw,32px)] font-bold leading-[1.32] tracking-[-0.035em]">
                {l}
              </motion.p>
            ))}
          </div>
          {claim && <p className="mt-6 text-[13.5px] text-fg-3">{c.display?.speaker ? `${c.display.speaker} · ` : ''}{hostOf(claim.source_url)} {claim.source_type?.trim()}</p>}
          <div className="mt-8"><Scrubber big /></div>
          <div className="mt-4"><Controls q={q} big /></div>
        </div>
      </div>
    </motion.div>
  )
}
