/** 크레이트 랙: 가운데 판은 정면, 옆 판들은 바깥 모서리가 앞으로 나와 랙이 손님 쪽으로 열린다.
 *  끌기·휠·화살표로 넘기고, 옆 판을 누르면 그 판으로, 가운데 판을 누르면 바늘을 내린다(판이 슬리브에서 나와 돈다). */
import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react'
import type { Candidate } from '../api'
import { usePlayer } from '../player'
import { Art, Vinyl, nameOf } from './kit'
import { Sticker } from './Detail'

export function Rack({ items, active, onActive, onPlay }: {
  items: Candidate[]; active: number; onActive: (i: number) => void; onPlay: (c: Candidate) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(300)
  const pos = useMotionValue(active)
  const drag = useRef<{ x: number; p: number; t: number; moved: boolean } | null>(null)
  const dragged = useRef(false)   // 끌고 놓은 직후의 click은 무시한다
  const wheel = useRef({ acc: 0, at: 0 })

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize(Math.round(Math.max(170, Math.min(330, e.contentRect.width * 0.27, e.contentRect.height * 0.74)))))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const a = animate(pos, active, { type: 'spring', stiffness: 220, damping: 30, mass: 0.9 })
    return () => a.stop()
  }, [active, pos])

  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i))
  const step = size * 0.68

  const down = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, p: pos.get(), t: performance.now(), moved: false }
    dragged.current = false
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 6 && !d.moved) { d.moved = true; dragged.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
    if (d.moved) pos.set(Math.max(-0.4, Math.min(items.length - 0.6, d.p - dx / step)))
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    const v = (e.clientX - d.x) / Math.max(1, performance.now() - d.t)   // px/ms
    const target = clamp(Math.round(pos.get() - v * 4.5))
    if (target === active) animate(pos, active, { type: 'spring', stiffness: 260, damping: 30 })
    else onActive(target)
  }
  const onWheel = (e: React.WheelEvent) => {
    const w = wheel.current
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    const now = performance.now()
    if (now - w.at > 220) w.acc = 0
    w.at = now
    w.acc += delta
    if (Math.abs(w.acc) > 70) { onActive(clamp(active + Math.sign(w.acc))); w.acc = 0; w.at = now + 140 }
  }

  return (
    <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={onWheel}
         role="listbox" aria-label="오늘의 크레이트" aria-activedescendant={`rack-${active}`}
         className="relative h-full w-full touch-pan-y select-none [perspective:1400px]">
      {/* 가운데 판 아래 바닥에 번지는 앨범색 빛 */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-[60%] w-[min(900px,90%)] -translate-x-1/2 rounded-[50%] opacity-60 blur-3xl" style={{ background: 'radial-gradient(closest-side, rgb(var(--album) / 0.55), transparent)' }} />
      {items.map((c, i) => (
        <Sleeve key={c.artist} c={c} i={i} pos={pos} size={size} step={step} active={i === active}
                onClick={() => { if (dragged.current) return; if (i === active) onPlay(c); else onActive(i) }} />
      ))}
    </div>
  )
}

function Sleeve({ c, i, pos, size, step, active, onClick }: {
  c: Candidate; i: number; pos: MotionValue<number>; size: number; step: number; active: boolean; onClick: () => void
}) {
  const player = usePlayer()
  const mine = player.current?.artist === c.artist
  const d = useTransform(pos, (p) => i - p)
  const near = (v: number) => Math.min(Math.abs(v), 1)
  const far = (v: number) => Math.max(Math.abs(v) - 1, 0)
  const x = useTransform(d, (v) => Math.sign(v) * (near(v) * step + far(v) * size * 0.36))
  const rotateY = useTransform(d, (v) => Math.sign(v) * near(v) * -42)
  const z = useTransform(d, (v) => -near(v) * 160 - far(v) * 70)
  const scale = useTransform(d, (v) => 1 - near(v) * 0.08)
  const shade = useTransform(d, (v) => near(v) * 0.42 + far(v) * 0.12)
  const opacity = useTransform(d, (v) => (Math.abs(v) > 4.6 ? Math.max(0, 5.6 - Math.abs(v)) : 1))
  const zIndex = useTransform(d, (v) => 100 - Math.round(Math.abs(v) * 10))

  return (
    <motion.div id={`rack-${i}`} role="option" aria-selected={active} aria-label={`${nameOf(c)}, ${c.track?.title ?? ''}`}
                className="absolute left-1/2 top-[42%] [transform-style:preserve-3d]"
                style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, x, z, rotateY, scale, opacity, zIndex }}
                initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + Math.abs(i) * 0.045, type: 'spring', stiffness: 160, damping: 22 }}>
      {/* 바늘을 내리면 판이 슬리브 오른쪽으로 나와 돈다 */}
      <motion.div className="absolute inset-[3%]" animate={{ x: active && mine ? '44%' : '0%', rotate: active && mine ? 0 : -20 }} transition={{ type: 'spring', stiffness: 120, damping: 20 }}>
        <Vinyl c={c} spinning={mine && player.playing} className="h-full w-full" />
      </motion.div>
      {/* 비닐 겉커버: 슬리브보다 조금 크고, 빛이 사선으로 지나간다 */}
      <span aria-hidden className="reflect pointer-events-none absolute -inset-[2.2%] rounded-[7px] bg-white/[0.035] ring-1 ring-white/[0.13]" />
      <button id={active ? 'rack-active-sleeve' : undefined} onClick={onClick} tabIndex={-1}
              className="reflect absolute inset-0 block cursor-pointer overflow-hidden rounded-[4px] shadow-[0_30px_70px_-30px_rgb(0_0_0/0.95)]">
        <Art c={c} eager />
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,transparent_0_28%,rgb(255_255_255/0.2)_40%,rgb(255_255_255/0.05)_48%,transparent_58%)] mix-blend-screen" />
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),inset_0_1px_0_rgb(255_255_255/0.25)]" />
        <motion.span className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: shade }} />
      </button>
      {c.feedback?.reaction && <Sticker r={c.feedback.reaction} className="absolute -right-3 -top-3 z-10" />}
    </motion.div>
  )
}
