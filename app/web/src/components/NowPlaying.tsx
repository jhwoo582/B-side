/** 지금 도는 판: 슬리브에서 빠져나온 바이닐(5번)이 돌고, 아래에 점 격자(17번)가 박자에 맞춰 출렁인다. */
import { AnimatePresence, motion } from 'motion/react'
import { usePlayer } from '../player'
import { SleeveArt } from './SleeveArt'
import { DotGrid } from './DotGrid'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function NowPlaying({ compact = false }: { compact?: boolean }) {
  const p = usePlayer()
  const c = p.current
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-white/10 bg-black/25 backdrop-blur-xl ${compact ? 'w-[300px] p-3' : 'p-5'}`}>
      <div className="flex items-center gap-4">
        {/* 슬리브 + 빠져나온 바이닐 */}
        <div className={`relative shrink-0 ${compact ? 'h-14 w-[86px]' : 'h-24 w-[150px]'}`}>
          <motion.div className="vinyl absolute top-[4%] aspect-square h-[92%] rounded-full shadow-xl"
                      animate={{ left: c && p.playing ? '38%' : '14%', rotate: p.playing ? 360 : 0 }}
                      transition={{ left: { type: 'spring', stiffness: 120, damping: 16 }, rotate: p.playing ? { repeat: Infinity, ease: 'linear', duration: 1.8 } : { duration: 0.6 } }}>
            {c && <div className="absolute inset-[33%] overflow-hidden rounded-full"><SleeveArt c={c} /></div>}
          </motion.div>
          <div className="absolute inset-y-0 left-0 aspect-square overflow-hidden rounded-md shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)]">
            {c ? <SleeveArt c={c} /> : <div className="h-full w-full bg-white/10" />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={c?.artist ?? 'none'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <div className="text-[12px] text-white/60">{!c ? '재생 중인 곡 없음' : p.loading ? '불러오는 중' : p.playing ? '재생 중' : '일시정지됨'}</div>
              <div className={`truncate font-semibold text-white ${compact ? 'text-[14px]' : 'text-[17px]'}`}>{c?.track?.title ?? '—'}</div>
              {c && <div className="truncate text-[13px] text-white/70">{c.artist_ko || c.artist}</div>}
            </motion.div>
          </AnimatePresence>
        </div>
        <button onClick={p.toggle} disabled={!c} aria-label={p.playing ? '일시정지' : '재생'}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-30">
          {p.playing
            ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>}
        </button>
      </div>
      {!compact && <DotGrid playing={p.playing} className="mt-4 h-14" />}
      {c && (
        <div className="mt-3 flex items-center gap-3 text-[11px] tabular-nums text-white/60">
          <span>{fmt(p.progress * p.duration)}</span>
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p.progress * 100}%`, background: 'rgb(var(--album))' }} />
          </div>
          <span>{p.duration ? fmt(p.duration) : '--:--'}</span>
        </div>
      )}
      {p.muted && p.playing && (
        <button onClick={p.unmute} className="mt-3 w-full rounded-full bg-white py-2 text-[13px] font-semibold text-black">소리 켜기</button>
      )}
      <AnimatePresence>
        {p.lastSignal && p.lastSignal.signal !== 'listening' && p.lastSignal.artist === c?.artist && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2 text-[12px] text-white/70">
            {p.lastSignal.signal === 'full' ? '끝까지 들은 걸 기억해 둘게요' : '넘긴 것도 기억해 둘게요'}
          </motion.div>
        )}
      </AnimatePresence>
      {p.error && (
        <div className="mt-2 text-[12px] text-white/80">
          {p.error}{c?.track?.url && <a href={c.track.url} target="_blank" rel="noreferrer" className="ml-1 underline">YouTube Music에서 열기</a>}
        </div>
      )}
    </div>
  )
}
