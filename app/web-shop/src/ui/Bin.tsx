/** 빈(bin): 판들이 앞에서 뒤로 서 있고, 뒤 판들의 윗부분이 계단처럼 보인다. 뒤에서 앨범색 백라이트.
 *  위아래로 끌거나 ←→로 넘긴다(휠은 페이지 스크롤에 양보). 넘기면 맨 앞 판이 손 쪽으로 넘어가며 사라지고 다음 판이 드러난다 (크레이트 디깅 손동작).
 *  칸이 바뀌는 자리엔 반투명 아크릴 칸막이가 꽂혀 탭이 튀어나와 있다.
 *  맨 앞 판을 누르면 바늘을 내린다: 판이 슬리브 위로 뽑혀 올라와 돈다. */
import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react'
import type { Candidate } from '../api'
import { usePlayer } from '../player'
import { Art, Vinyl, nameOf } from './kit'
import { Sticker } from './Detail'
import type { Group } from './groups'

const DEPTH = 7   // 뒤로 보이는 판 수

export function Bin({ items, groups, active, onActive, onPlay }: {
  items: Candidate[]; groups: Group[]; active: number; onActive: (i: number) => void; onPlay: (c: Candidate) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [dim, setDim] = useState({ w: 1000, h: 480 })
  const pos = useMotionValue(active)
  const drag = useRef<{ y: number; x: number; p: number; t: number; moved: boolean } | null>(null)
  const dragged = useRef(false)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setDim({ w: e.contentRect.width, h: e.contentRect.height }))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const a = animate(pos, active, { type: 'spring', stiffness: 170, damping: 24, mass: 0.9 })
    return () => a.stop()
  }, [active, pos])

  const S = Math.round(Math.max(200, Math.min(380, dim.h * 0.58, dim.w * 0.6)))
  const gap = S * 0.16
  const rise = S * 0.062
  const n = items.length
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i))
  const per = S * 0.55   // 이만큼 끌면 한 장

  // 위아래로 끌어 넘긴다 (아래로 = 앞 판을 손 쪽으로 넘김 = 다음 판)
  const down = (e: React.PointerEvent) => { drag.current = { y: e.clientY, x: e.clientX, p: pos.get(), t: performance.now(), moved: false }; dragged.current = false }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.y, dx = e.clientX - d.x
    const delta = Math.abs(dy) > Math.abs(dx) ? dy : -dx
    if (Math.abs(delta) > 6 && !d.moved) { d.moved = true; dragged.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
    if (d.moved) pos.set(Math.max(-0.3, Math.min(n - 0.7, d.p + delta / per)))
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    const dy = e.clientY - d.y, dx = e.clientX - d.x
    const v = (Math.abs(dy) > Math.abs(dx) ? dy : -dx) / Math.max(1, performance.now() - d.t)
    const target = clamp(Math.round(pos.get() + v * 3))
    if (target === active) animate(pos, active, { type: 'spring', stiffness: 220, damping: 26 }); else onActive(target)
  }
  const baseY = Math.round(dim.h * 0.9)
  return (
    <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
         role="listbox" aria-label="오늘 들어온 LP" aria-activedescendant={`bin-${active}`}
         className="relative h-full w-full touch-pan-x select-none overflow-hidden [mask-image:linear-gradient(to_bottom,#000_95%,transparent)]">
      <Backlight S={S} baseY={baseY} />
      <div className="absolute inset-0 [perspective:1300px]" style={{ perspectiveOrigin: `50% ${baseY - S * 2.1}px` }}>
        <div className="absolute left-1/2 [transform-style:preserve-3d]" style={{ top: baseY }}>
          {groups.slice(1).map((g, gi) => (
            <Divider key={g.key} g={g} k={gi} pos={pos} S={S} gap={gap} rise={rise} onPick={() => { if (!dragged.current) onActive(g.start) }} />
          ))}
          {items.map((c, i) => (
            <Record key={c.artist} c={c} i={i} pos={pos} S={S} gap={gap} rise={rise} active={i === active}
                    onClick={() => { if (dragged.current) return; if (i === active) onPlay(c); else onActive(i) }} />
          ))}
          {/* 빈 앞판: 연기색 아크릴. LP 아랫부분이 비쳐 보이고, 윗모서리에 빛이 걸리고, 앨범색이 살짝 스민다 */}
          <div aria-hidden className="absolute overflow-hidden"
               style={{ width: S * 1.2, height: S * 0.2, left: -S * 0.6, top: -S * 0.12, transform: `translateZ(${gap * 1.05}px)`, borderRadius: S * 0.04,
                        background: 'linear-gradient(180deg, rgb(255 255 255 / 0.10), rgb(255 255 255 / 0.03) 35%, rgb(6 6 8 / 0.5) 100%), linear-gradient(90deg, rgb(var(--album) / 0.12), transparent 30%, transparent 70%, rgb(var(--album) / 0.12)), rgb(14 14 18 / 0.32)',
                        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.32), inset 0 0 0 1px rgb(255 255 255 / 0.10), inset 0 -10px 18px -10px rgb(0 0 0 / 0.6)',
                        backdropFilter: 'blur(6px) saturate(1.3)', WebkitBackdropFilter: 'blur(6px) saturate(1.3)' }}>
            {/* 아크릴에 비친 사선 반사 */}
            <span className="absolute inset-y-0 w-[38%] -skew-x-[24deg] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.07),transparent)]" style={{ left: '14%' }} />
            {/* 손 넣는 홈 */}
            <span className="absolute left-1/2 top-[18%] h-[22%] w-[18%] -translate-x-1/2 rounded-full bg-black/45 shadow-[inset_0_1px_2px_rgb(0_0_0/0.8),0_1px_0_rgb(255_255_255/0.08)]" />
          </div>
          {/* 바닥에 떨어지는 그림자와 앨범색 반사 */}
          <div aria-hidden className="absolute rounded-[50%] blur-xl"
               style={{ width: S * 1.4, height: S * 0.08, left: -S * 0.7, top: S * 0.03, transform: `translateZ(${gap * 1.05}px)`,
                        background: 'radial-gradient(closest-side, rgb(0 0 0 / 0.75), transparent)' }} />
          <div aria-hidden className="absolute rounded-[50%] blur-2xl"
               style={{ width: S * 1.0, height: S * 0.06, left: -S * 0.5, top: S * 0.05, transform: `translateZ(${gap * 1.05}px)`,
                        background: 'radial-gradient(closest-side, rgb(var(--album) / 0.22), transparent)' }} />
        </div>
      </div>
    </div>
  )
}

/** 앨범색 백라이트: 맨 앞 판 뒤에서 그 판의 색이 번지고, 재생 중엔 천천히 숨 쉰다 */
function Backlight({ S, baseY }: { S: number; baseY: number }) {
  const player = usePlayer()
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <motion.div className="absolute left-1/2 rounded-full blur-[60px]"
                  style={{ top: baseY - S * 1.25, width: S * 1.9, height: S * 1.5, marginLeft: -S * 0.95,
                           background: 'radial-gradient(closest-side, rgb(var(--album) / 0.55), rgb(var(--album-c1) / 0.35) 55%, transparent)' }}
                  animate={player.playing ? { opacity: [0.75, 1, 0.75], scale: [1, 1.07, 1] } : { opacity: 0.8, scale: 1 }}
                  transition={player.playing ? { duration: 5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.8 }} />
      <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%] blur-2xl" style={{ top: baseY - S * 0.12, width: S * 1.8, height: S * 0.4, background: 'radial-gradient(closest-side, rgb(var(--album) / 0.28), transparent)' }} />
    </div>
  )
}

/** 판의 위치: d = 이 판 - 지금 보는 판. d ≥ 0이면 뒤로 서 있고, d < 0이면 손 쪽으로 넘어가며 사라진다 */
function useStand(p: number, pos: MotionValue<number>, gap: number, rise: number) {
  const d = useTransform(pos, (v) => p - v)
  const z = useTransform(d, (v) => (v >= 0 ? -v * gap : Math.min(-v, 1.2) * gap * 0.9))
  const y = useTransform(d, (v) => (v >= 0 ? -v * rise : Math.min(-v, 1.2) * rise * 2.2))
  const rotateX = useTransform(d, (v) => (v >= 0 ? 7 + Math.min(v, 1) * 5 : 7 - Math.min(-v, 1.2) * 70))
  const opacity = useTransform(d, (v) => (v < 0 ? Math.max(0, 1 - -v * 1.35) : v > DEPTH ? Math.max(0, DEPTH + 1 - v) : 1))
  const shade = useTransform(d, (v) => (v <= 0 ? 0 : Math.min(0.72, 0.28 + v * 0.07)))
  return { d, z, y, rotateX, opacity, shade }
}

function Record({ c, i, pos, S, gap, rise, active, onClick }: {
  c: Candidate; i: number; pos: MotionValue<number>; S: number; gap: number; rise: number; active: boolean; onClick: () => void
}) {
  const player = usePlayer()
  const mine = player.current?.artist === c.artist
  const { z, y, rotateX, opacity, shade } = useStand(i, pos, gap, rise)
  const pointer = useTransform(opacity, (o) => (o < 0.3 ? 'none' : 'auto'))
  return (
    <motion.div id={`bin-${i}`} role="option" aria-selected={active} aria-label={`${nameOf(c)}, ${c.track?.title ?? ''}`}
                className="absolute [transform-style:preserve-3d]"
                style={{ width: S, height: S, left: -S / 2, top: -S, z, y, rotateX, opacity, transformOrigin: '50% 100%', pointerEvents: pointer }}>
      <motion.div className="relative h-full w-full" whileHover={active ? { y: -14 } : { y: -6 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
        {/* 바늘을 내리면 판이 슬리브 위로 뽑혀 올라와 돈다 */}
        <motion.div className="absolute inset-[4%]" animate={{ y: active && mine ? '-46%' : '0%' }} transition={{ type: 'spring', stiffness: 110, damping: 19 }}>
          <Vinyl c={c} spinning={mine && player.playing} className="h-full w-full" />
        </motion.div>
        {/* 비닐 겉커버 */}
        <span aria-hidden className="pointer-events-none absolute -inset-[2%] rounded-[6px] bg-white/[0.03] ring-1 ring-white/[0.12]" />
        <button id={active ? 'rack-active-sleeve' : undefined} onClick={onClick} tabIndex={-1}
                className="absolute inset-0 block cursor-pointer overflow-hidden rounded-[3px] shadow-[0_-16px_30px_-12px_rgb(0_0_0/0.75),0_20px_40px_-20px_rgb(0_0_0/0.9)]">
          <Art c={c} eager />
          {/* 위에서 오는 빛: 윗변이 밝고 아래로 갈수록 어둡다 */}
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(255_250_240/0.16),transparent_28%,transparent_60%,rgb(0_0_0/0.4))]" />
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,transparent_0_30%,rgb(255_255_255/0.14)_42%,transparent_54%)] mix-blend-screen" />
          <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),inset_0_1px_0_rgb(255_255_255/0.3)]" />
          <motion.span className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: shade }} />
        </button>
        {c.feedback?.reaction && <Sticker r={c.feedback.reaction} className="absolute -right-3 -top-3 z-10" />}
      </motion.div>
    </motion.div>
  )
}

/** 아크릴 칸막이: 그 칸 첫 판 바로 앞에 꽂혀 있고 탭이 판 위로 튀어나온다 */
function Divider({ g, k, pos, S, gap, rise, onPick }: { g: Group; k: number; pos: MotionValue<number>; S: number; gap: number; rise: number; onPick: () => void }) {
  const { z, y, rotateX, opacity } = useStand(g.start - 0.45, pos, gap, rise)
  const H = S * 1.0
  const tabX = S * (0.08 + (k % 3) * 0.3)
  return (
    <motion.div aria-hidden className="pointer-events-none absolute [transform-style:preserve-3d]"
                style={{ width: S * 1.02, height: H, left: -S * 0.51, top: -H, z, y, rotateX, opacity, transformOrigin: '50% 100%' }}>
      <div className="absolute inset-0 rounded-[4px] bg-[linear-gradient(180deg,rgb(255_255_255/0.1),rgb(255_255_255/0.03))] ring-1 ring-white/15" />
      <button onClick={onPick} tabIndex={-1} className="pointer-events-auto absolute flex h-[26px] items-center gap-1.5 rounded-t-[7px] bg-[linear-gradient(180deg,rgb(255_255_255/0.22),rgb(255_255_255/0.1))] px-3 text-[12px] font-semibold text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] ring-1 ring-white/20 backdrop-blur-sm"
              style={{ left: tabX, top: -25 }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.color }} />{g.label}
      </button>
    </motion.div>
  )
}
