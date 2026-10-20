/** 하루를 한 줄로: 위에서 아래로 내려가며 ① 오늘의 판 → ② 듣기 → ③ 넓히기(지도). 탭 대신 스크롤 이야기 (G안).
 *  ① 크레이트에서 꺼낸 판 더미가 내리면 가지런히 놓이고(Layered Stack), 판에 올리면 뒤집혀 뒷면에 온 길이 보인다(Flip Card Stack).
 *  ② 턴테이블은 왼쪽에 붙어 있고(Sticky Scroll), 오른쪽으로 판마다 이야기가 지나간다. 가운데 온 판이 슬리브에 꽂힌다.
 *  ③ 더 내리면 카메라가 멀어지며 우주(취향 지도)가 펼쳐지고, 배경도 실크에서 우주로 바뀐다. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react'
import { api, EDGE_HEX, EDGE_LABEL, type Brief, type Candidate, type Feedback, type TasteSignal } from '../api'
import { Turntable } from '../components/Turntable'
import { DotGrid } from '../components/DotGrid'
import { SleeveArt } from '../components/SleeveArt'
import { LinerNotes } from '../components/LinerNotes'
import { Sticker } from '../components/crate/SleeveDetail'
import { LogDrawer } from '../components/LogDrawer'
import { ShareTrail } from '../components/ShareTrail'
import { Board } from './Board'
import { useAlbumPalette } from '../albumColor'
import { usePlayer, type Signal } from '../player'
import { buzz, crackle, thunk } from '../vinylSound'
import { Orb, QuickReact, openerFor } from '../components/CommandPalette'

export type Section = 'crate' | 'listen' | 'map'
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const rand = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x) }

// ---------------------------------------------------------------- ① 오늘의 판

function CrateStack({ items, scroller, onOpen }: { items: Candidate[]; scroller: React.RefObject<HTMLDivElement | null>; onOpen: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(1000)
  const [arranged, setArranged] = useState(false)
  const [hover, setHover] = useState(false)
  const { scrollYProgress } = useScroll({ container: scroller, target: box, offset: ['start start', 'end start'] })
  useMotionValueEvent(scrollYProgress, 'change', (v) => setArranged(v > 0.04))
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const open = arranged || hover
  const n = items.length
  const card = Math.max(130, Math.min(210, w / (Math.min(n, 5) + 0.9)))
  const cols = n > 5 ? Math.ceil(n / 2) : n
  const gap = card * 0.14

  return (
    <div ref={box} className="relative mx-auto h-[min(64vh,560px)] w-full max-w-6xl" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {items.map((c, i) => {
        const row = n > 5 ? Math.floor(i / cols) : 0, col = n > 5 ? i % cols : i
        const inRow = n > 5 ? (row === 0 ? cols : n - cols) : n
        const grid = { x: (col - (inRow - 1) / 2) * (card + gap), y: (row - (n > 5 ? 0.5 : 0)) * (card + gap * 1.6), rotate: 0, scale: 1 }
        const pile = { x: (rand(i + 1) - 0.5) * card * 0.7, y: (rand(i + 7) - 0.5) * card * 0.4 - i * 3, rotate: (rand(i + 3) - 0.5) * 28, scale: 1 - (n - i) * 0.01 }
        return (
          <motion.div key={c.artist} className="absolute left-1/2 top-1/2" style={{ width: card, height: card, marginLeft: -card / 2, marginTop: -card / 2, zIndex: open ? 1 : n - i }}
                      initial={{ y: -600, opacity: 0, rotate: pile.rotate }}
                      animate={{ ...(open ? grid : pile), opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 140, damping: 18, delay: open ? i * 0.035 : 0.2 + (n - i) * 0.06 }}>
            <FlipCard c={c} n={i + 1} total={n} enabled={open} onOpen={() => onOpen(i)} />
          </motion.div>
        )
      })}
    </div>
  )
}

/** 판 한 장: 앞면은 커버, 올리면 뒤집혀 뒷면에 '어디서 왔는지'(라이너 노트) */
function FlipCard({ c, n, total, enabled, onOpen }: { c: Candidate; n: number; total: number; enabled: boolean; onOpen: () => void }) {
  const [flip, setFlip] = useState(false)
  const hop = c.path[0]
  const line = c.display?.pull ?? c.claims[0]?.quote ?? c.why ?? ''
  return (
    <button onClick={onOpen} onPointerEnter={() => enabled && setFlip(true)} onPointerLeave={() => setFlip(false)} onFocus={() => setFlip(true)} onBlur={() => setFlip(false)}
            aria-label={`${c.artist_ko || c.artist} 이야기 보기`} className="group relative block h-full w-full [perspective:900px]">
      <motion.div className="relative h-full w-full [transform-style:preserve-3d]" animate={{ rotateY: flip ? 180 : 0 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }}>
        <div className="absolute inset-0 overflow-hidden rounded-[3px] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.9)] [backface-visibility:hidden]">
          <SleeveArt c={c} />
          {c.feedback?.reaction && <Sticker r={c.feedback.reaction} small />}
        </div>
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[3px] border border-white/12 bg-[#110e1a]/95 p-3 text-left [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="text-[10px] tabular-nums text-white/40">{String(n).padStart(2, '0')} / {String(total).padStart(2, '0')}</div>
          <div className="mt-1 truncate text-[15px] font-black leading-tight tracking-[-0.03em]">{c.artist_ko || c.artist}</div>
          {hop ? (
            <div className="mt-0.5 truncate text-[10.5px]" style={{ color: EDGE_HEX[hop.edge] }}>{hop.from} · {EDGE_LABEL[hop.edge] ?? hop.edge}</div>
          ) : <div className="mt-0.5 text-[10.5px] text-white/50">숨은 곡</div>}
          <p className="mt-2 line-clamp-4 text-[11.5px] leading-[1.5] text-white/75">{line ? `“${line}”` : ''}</p>
          <div className="mt-auto text-[10.5px] text-white/45">이야기 보기 ↓</div>
        </div>
      </motion.div>
    </button>
  )
}

// ---------------------------------------------------------------- ② 듣기

function StoryBlock({ c, i, total, date, active, replies, seedThumb, onReact, onRetortDone, onOpen }: {
  c: Candidate; i: number; total: number; date: string; active: boolean; replies: Candidate[]; seedThumb?: string
  onReact: (f: Feedback) => void; onRetortDone: (artist: string | null) => void; onOpen: (artist: string) => void
}) {
  return (
    <article id={`story-${i}`} data-i={i} data-artist={c.artist} className="flex h-[100dvh] snap-center snap-always flex-col justify-center overflow-hidden pb-[4vh] pt-[11vh]">
      <LinerNotes c={c} i={i} total={total} date={date} active={active} replies={replies} seedThumb={seedThumb} onReact={onReact} onRetortDone={onRetortDone} onOpen={onOpen} />
    </article>
  )
}

const GH = 180      // 손에 든 바이닐 크기(px)
const TILT = 38     // 턴테이블을 눕힌 각도 (원근 착지)
const LIFT = 64     // 들어 올렸을 때 LP와 그림자 사이 높이(px). 플래터 위에선 낮게 뜬다
const ON_PLATTER = 0.94   // 턴테이블 위 LP 지름 / 플래터 지름 (Turntable의 inset 3%)

/** 왼쪽에 비스듬히 누운 턴테이블 + 거기 기대 선 슬리브 (B안 · 원근 착지).
 *  - 슬리브에 손을 올리면 판이 슬리브에서 반쯤 미끄러져 나오며 돈다 (Vinyl Album Card)
 *  - 집어 들면 판이 떠오르고, 그림자는 바닥에 흐릿하게 남는다. 판은 무게가 있어 손을 한 박자 늦게 따라오고 흔들린다 (Rope)
 *  - 플래터 위로 가져가면 판이 플래터 면에 맞춰 눕고 자석처럼 스핀들로 끌린다
 *  - 놓으면 그림자가 모이며 내려앉고(툭), 먼지가 튀고, 톤암이 넘어와 바늘이 닿는다(지직) */
function Deck({ c, onPlay }: { c: Candidate | undefined; onPlay: () => void }) {
  const player = usePlayer()
  const deck = useRef<HTMLDivElement>(null)
  const sleeve = useRef<HTMLDivElement>(null)
  const peek = useRef<HTMLDivElement>(null)   // 슬리브에서 반쯤 나온 바이닐
  const [mode, setMode] = useState<'off' | 'drag' | 'fly'>('off')
  const [near, setNear] = useState(false)
  const [hide, setHide] = useState(false)
  const [thump, setThump] = useState(0)
  const [cue, setCue] = useState(false)
  const [peeking, setPeeking] = useState(false)
  // gx, gy: 판이 놓일 바닥 위의 점(손이 가리키는 곳). 그려지는 판은 hx, hy로 무게 있게 늦게 따라온다
  const gx = useMotionValue(0), gy = useMotionValue(0), gs = useMotionValue(1)
  const lift = useMotionValue(0)                 // 0 = 바닥, 1 = 들어 올림
  const lay = useMotionValue(0)                  // 0 = 손에 세워 듦, 1 = 플래터 면에 맞춰 누움
  const flat = useRef(0.8)                       // 플래터 타원의 세로/가로 비 (턴테이블이 누운 만큼)
  const heavy = { stiffness: 210, damping: 19, mass: 1.15 }
  const hx = useSpring(gx, heavy), hy = useSpring(gy, heavy)
  const swing = useSpring(0, { stiffness: 120, damping: 9 })   // 끌 때 흔들림 (줄에 매단 듯)
  const rx = useSpring(0, { stiffness: 220, damping: 18 }), ry = useSpring(0, { stiffness: 220, damping: 18 })
  const live = useRef(true)   // 끄는 중엔 늦게 따라오고, 날아갈 땐 바로 그린다
  const px = useTransform([hx, gx], ([a, b]: number[]) => (live.current ? a : b) - GH / 2)
  const pyGround = useTransform([hy, gy], ([a, b]: number[]) => (live.current ? a : b) - GH / 2)
  // 플래터 위에선 낮게 떠서 그림자가 매트 위에 또렷이 깔린다 (멀리선 높이 들고 있다)
  const py = useTransform([pyGround, lift, lay], ([y, h, l]: number[]) => y - LIFT * h * (1 - 0.7 * l))
  // 누움은 플래터 타원에 정확히 맞춘다: 따로 원근을 주면 모양이 어긋나 '떠 있는 원기둥'처럼 보인다
  const recScaleY = useTransform(lay, (l) => 0.94 + (flat.current - 0.94) * l)
  const tiltX = useTransform([lay, rx], ([l, r]: number[]) => r * (1 - l))
  const tiltY = useTransform([lay, ry], ([l, r]: number[]) => r * (1 - l))
  const shScaleY = useTransform(lay, (l) => 0.5 + (flat.current - 0.5) * l)
  const shBlur = useTransform([lift, lay], ([h, l]: number[]) => `blur(${4 + h * (16 - 10 * l)}px)`)
  const shOpacity = useTransform([lift, lay], ([h, l]: number[]) => 0.85 - h * 0.45 * (1 - 0.5 * l))
  const shScale = useTransform([gs, lift], ([s, h]: number[]) => s * (0.96 + h * 0.12))
  const last = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0 })
  const now = player.current
  const onDeck = !!c && now?.artist === c.artist

  /** 플래터: 눕혀 있어 화면에선 타원이다 (가로 반지름 rx, 세로 반지름 ry) */
  const platter = () => {
    const r = (deck.current!.querySelector('[data-platter]') as HTMLElement).getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rad: r.width / 2, ry: r.height / 2 }
  }
  const sleeveSpot = () => {
    const r = (peek.current ?? sleeve.current)?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width / GH } : { x: 80, y: innerHeight - 80, s: 0.5 }
  }
  /** 자석: 플래터 면 위 거리로 1.7배 안이면 스핀들 쪽으로 끌리고, 크기와 기울기가 플래터에 맞춰진다 */
  const magnet = (x: number, y: number) => {
    const { cx, cy, rad, ry: prY } = platter()
    const d = Math.hypot(x - cx, (y - cy) * (rad / prY)), zone = rad * 1.7
    const k = d < zone ? Math.pow(1 - d / zone, 1.3) : 0
    return { x: x + (cx - x) * k * 0.75, y: y + (cy - y) * k * 0.75, s: 1.08 + ((rad * 2 * ON_PLATTER) / GH - 1.08) * k, k, d, rad, cx, cy }
  }

  async function land() {
    const { cx, cy, rad } = platter()
    gx.set(hx.get()); gy.set(hy.get()); live.current = false     // 손에서 떨어진 자리에서 이어서
    setMode('fly'); setHide(true); setNear(false)
    rx.set(0); ry.set(0); swing.set(0)
    // 1) 스핀들 바로 위로 맞춘다(떠 있는 채) → 2) 잠깐 멈췄다가 → 3) 스핀들에 꿰이듯 곧게 내려앉는다
    await Promise.all([
      animate(gx, cx, { type: 'spring', stiffness: 300, damping: 30 }),
      animate(gy, cy, { type: 'spring', stiffness: 300, damping: 30 }),
      animate(gs, (rad * 2 * ON_PLATTER) / GH, { type: 'spring', stiffness: 300, damping: 30 }),
      animate(lay, 1, { type: 'spring', stiffness: 300, damping: 30 }),
    ])
    await animate(lift, 0, { duration: 0.32, ease: [0.55, 0, 0.9, 0.6] })   // 떨어진다 — 그림자가 LP 밑으로 모인다
    thunk(); buzz(14)
    setThump((t) => t + 1); setMode('off'); setHide(false); setCue(true)
    setTimeout(() => { setCue(false); crackle() }, 700)   // 톤암이 넘어와 내려앉는 순간 바늘 소리
  }
  async function miss() {
    const s = sleeveSpot()
    gx.set(hx.get()); gy.set(hy.get()); live.current = false
    setMode('fly'); setNear(false); rx.set(0); ry.set(0); swing.set(0)
    await Promise.all([
      animate(gx, s.x, { type: 'spring', stiffness: 240, damping: 24 }), animate(gy, s.y, { type: 'spring', stiffness: 240, damping: 24 }),
      animate(gs, s.s, { duration: 0.3 }), animate(lift, 0, { duration: 0.3 }), animate(lay, 0, { duration: 0.2 }),
    ])
    setMode('off')
  }

  useEffect(() => {
    if (mode !== 'drag') return
    const move = (e: PointerEvent) => {
      const L = last.current, t = performance.now(), dt = Math.max(1, t - L.t)
      L.vx = L.vx * 0.6 + ((e.clientX - L.x) / dt) * 0.4; L.vy = L.vy * 0.6 + ((e.clientY - L.y) / dt) * 0.4
      L.x = e.clientX; L.y = e.clientY; L.t = t
      const m = magnet(e.clientX, e.clientY + LIFT)   // 손은 판을 들고 있으니, 판이 놓일 바닥은 손보다 아래
      gx.set(m.x); gy.set(m.y); gs.set(m.s); lay.set(m.k)
      rx.set(Math.max(-26, Math.min(26, -L.vy * 14))); ry.set(Math.max(-26, Math.min(26, L.vx * 14)))
      swing.set(Math.max(-24, Math.min(24, -L.vx * 18)) * (1 - m.k))
      setNear(m.k > 0.15)
    }
    const up = (e: PointerEvent) => {
      const L = last.current, m = magnet(e.clientX, e.clientY + LIFT)
      // 플래터 위거나, 플래터 쪽으로 힘껏 던졌으면 내려앉는다
      const toward = (m.cx - e.clientX) * L.vx + (m.cy - e.clientY) * L.vy > 0
      const thrown = Math.hypot(L.vx, L.vy) > 1.1 && toward && m.d < m.rad * 3.2
      if (m.d < m.rad * 1.25 || thrown) { onPlay(); land() } else miss()
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (e: React.PointerEvent) => {
    e.preventDefault()
    const s = sleeveSpot()
    last.current = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 }
    live.current = true
    const pr = platter(); flat.current = pr.ry / pr.rad
    gx.jump(s.x); gy.jump(s.y + LIFT); hx.jump(s.x); hy.jump(s.y + LIFT); gs.set(s.s); lay.set(0); lift.set(1)
    animate(gs, 1.08, { type: 'spring', stiffness: 300, damping: 20 })   // 집어 드는 순간 살짝 커진다
    gx.set(e.clientX); gy.set(e.clientY + LIFT)                           // 판은 무게가 있어 손을 늦게 따라온다
    setMode('drag'); setPeeking(false)
  }

  const canPick = !onDeck && !!c?.track?.video_id
  return (
    <div className={`mx-auto w-full max-w-[580px] ${mode === 'drag' ? 'cursor-grabbing select-none' : ''}`}>
      {/* 비스듬히 누운 턴테이블 + 거기 기대 선 슬리브. 슬리브에 손을 올리면 바이닐이 미끄러져 나온다 */}
      <div className="relative pb-[16%]">
        <div className="w-[82%] [perspective:1500px]">
          <div style={{ transform: `rotateX(${TILT}deg)`, transformOrigin: '50% 100%', transformStyle: 'preserve-3d' }}>
            <Turntable ref={deck} dropActive={mode === 'drag'} dropHover={near} hideRecord={hide} thump={thump} cueing={cue} />
          </div>
        </div>
        <AnimatePresence mode="wait">
          {c && (
            <motion.div key={c.artist} ref={sleeve} className="absolute bottom-0 right-[-2%] aspect-square w-[38%]"
                        initial={{ y: 40, opacity: 0, rotate: 3 }} animate={{ y: 0, opacity: 1, rotate: peeking ? -2 : -5 }} exit={{ y: 30, opacity: 0, rotate: 2, transition: { duration: 0.2 } }}
                        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                        onPointerEnter={() => canPick && mode === 'off' && setPeeking(true)} onPointerLeave={() => setPeeking(false)}>
              {canPick && (
                <motion.div ref={peek} className="vinyl absolute left-[5%] top-0 aspect-square w-[90%] cursor-grab touch-none rounded-full shadow-[0_16px_40px_-10px_rgba(0,0,0,0.9)]"
                            animate={mode !== 'off' ? { opacity: 0 } : { opacity: 1, y: peeking ? '-46%' : '-16%', rotate: peeking ? 160 : 0 }}
                            transition={{ type: 'spring', stiffness: 160, damping: 18 }}
                            onPointerDown={pick} aria-label="LP를 집어 턴테이블로">
                  <div className="absolute inset-[33%] overflow-hidden rounded-full"><SleeveArt c={c} /></div>
                  <div aria-hidden className="absolute inset-0 rounded-full opacity-40 [background:conic-gradient(from_200deg,transparent_0_10%,rgba(255,255,255,0.25)_14%,transparent_20%_60%,rgba(255,255,255,0.15)_64%,transparent_70%)]" />
                </motion.div>
              )}
              {/* 슬리브를 집어도 바이닐이 딸려 나온다 */}
              <div onPointerDown={canPick ? pick : undefined}
                   className={`absolute inset-0 touch-none overflow-hidden rounded-[3px] shadow-[0_30px_60px_-18px_rgba(0,0,0,0.95)] ring-1 ring-white/10 ${canPick ? 'cursor-grab active:cursor-grabbing' : ''}`}><SleeveArt c={c} /></div>
              {canPick && mode === 'off' && (
                <div className="pointer-events-none absolute -bottom-7 left-0 right-0 text-center text-[12px] text-white/45">{now ? 'LP를 바꾸려면 끌어 올려 주세요' : 'LP를 집어 턴테이블에'}</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 지금 도는 판 */}
      <div className="mt-10 flex h-[60px] items-center gap-4">
        <div className="min-w-0 flex-1">
          {now && !hide ? (
            <>
              <div className="flex items-baseline gap-2"><span className="truncate text-[15px] font-semibold">{now.track?.title}</span><span className="truncate text-[13px] text-white/55">{now.artist_ko || now.artist}</span></div>
              <div className="mt-2 flex items-center gap-2 text-[11px] tabular-nums text-white/50">
                <span>{fmt(player.progress * player.duration)}</span>
                <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${player.progress * 100}%` }} /></div>
                <span>{player.duration ? fmt(player.duration) : '--:--'}</span>
              </div>
            </>
          ) : <div className="text-[13px] text-white/45">{mode === 'drag' ? (near ? '놓으면 올라가요' : '턴테이블 위로 가져가세요') : cue ? '바늘을 내리고 있어요' : ''}</div>}
        </div>
        {now && !hide && (
          <button onClick={player.toggle} aria-label={player.playing ? '일시정지' : '재생'} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-black transition hover:scale-105">
            {player.playing
              ? <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
              : <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>}
          </button>
        )}
      </div>
      <div className="relative mt-3 h-[52px]">
        <DotGrid playing={player.playing} cols={40} rows={2} className="h-5" />
        {player.muted && player.playing && <button onClick={player.unmute} className="absolute inset-x-0 bottom-0 rounded-full bg-white py-2 text-[13px] font-semibold text-black">소리 켜기</button>}
        {player.error && !player.muted && <p className="absolute inset-x-0 bottom-0 text-center text-[12px] text-white/75">{player.error}{now?.track?.url && <a href={now.track.url} target="_blank" rel="noreferrer" className="ml-1 underline">YouTube Music에서 열기</a>}</p>}
      </div>

      {/* 손에 든 바이닐: 바닥엔 그림자, 위엔 떠 있는 판. 플래터에 가까우면 플래터 면에 맞춰 눕는다 */}
      {mode !== 'off' && c && (
        <>
          <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-40 rounded-full bg-black"
                      style={{ x: px, y: pyGround, width: GH, height: GH, scale: shScale, scaleY: shScaleY, filter: shBlur, opacity: shOpacity }} />
          <motion.div className="pointer-events-none fixed left-0 top-0 z-50 [perspective:800px]" style={{ x: px, y: py, width: GH, height: GH }}>
            <motion.div className="h-full w-full" style={{ scale: gs, scaleY: recScaleY }}>
            {/* 가장자리 빛: 검은 LP가 매트와 섞이지 않게 테두리를 살린다 */}
            <motion.div className="vinyl relative h-full w-full rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),inset_0_2px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.6)]" style={{ rotateX: tiltX, rotateY: tiltY, rotate: swing }}>
              <div className="absolute inset-[33%] overflow-hidden rounded-full"><SleeveArt c={c} /></div>
              <div aria-hidden className="absolute inset-0 rounded-full opacity-50 [background:conic-gradient(from_200deg,transparent_0_10%,rgba(255,255,255,0.25)_14%,transparent_20%_60%,rgba(255,255,255,0.15)_64%,transparent_70%)]" />
              <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80" />
            </motion.div>
            </motion.div>
          </motion.div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- ③ 넓히기

function MapStage({ scroller, onProgress }: { scroller: React.RefObject<HTMLDivElement | null>; onProgress: (p: number) => void }) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ container: scroller, target: ref, offset: ['start end', 'end end'] })
  const scale = useTransform(scrollYProgress, [0.25, 0.85], [1.9, 1])
  const opacity = useTransform(scrollYProgress, [0.15, 0.55], [0, 1])
  useMotionValueEvent(scrollYProgress, 'change', (v) => onProgress(Math.min(1, Math.max(0, (v - 0.1) / 0.6))))
  return (
    <section ref={ref} id="map" data-section="map" className="relative h-[180vh] snap-end">
      <div className="sticky top-0 h-[100dvh] overflow-hidden">
        <motion.div className="absolute inset-0 origin-center" style={{ scale, opacity }}>
          <div className="absolute inset-x-0 bottom-0 top-[68px]"><Board /></div>
        </motion.div>
        <motion.div className="pointer-events-none absolute inset-x-0 top-[22vh] text-center" style={{ opacity: useTransform(scrollYProgress, [0.05, 0.3, 0.5], [0, 1, 0]) }}>
          <div className="text-[13px] text-white/55">멀리서 보면</div>
          <div className="text-[clamp(32px,4vw,52px)] font-black tracking-[-0.045em]">지금까지 걸어온 길이 이렇게 이어져 있어요</div>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 대화

/** 도우미가 먼저 말을 건다: 판을 끝까지 듣거나 금방 넘기면 왼쪽 아래에 한 줄. 누르면 그 판 이야기로 대화가 열린다 */
function Nudge({ items }: { items: Candidate[] }) {
  const player = usePlayer()
  const [shown, setShown] = useState<{ artist: string; name: string; signal: Signal } | null>(null)
  useEffect(() => {
    const s = player.lastSignal
    if (!s) return
    if (player.hasTalked(s.artist)) return   // 이 판 이야기는 이미 나눴다
    const c = items.find((x) => x.artist === s.artist)
    setShown({ artist: s.artist, name: c?.artist_ko || s.artist, signal: s.signal })
    const t = setTimeout(() => setShown(null), 25000)
    return () => clearTimeout(t)
  }, [player.lastSignal]) // eslint-disable-line react-hooks/exhaustive-deps
  const opener = shown && openerFor(shown.name, shown.signal)
  const open = (say?: string) => {
    if (!shown) return
    window.dispatchEvent(new CustomEvent('dig:ask', { detail: { now: { artist: shown.artist, signal: shown.signal }, opener, say } }))
    setShown(null)
  }
  return (
    <AnimatePresence>
      {shown && (
        <motion.div initial={{ y: 30, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                    className="fixed bottom-6 left-1/2 z-40 w-[min(520px,calc(100%-2rem))] -translate-x-1/2 rounded-3xl border border-white/12 bg-[#0d0b15]/90 p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          <div className="flex items-start gap-3">
            <Orb size={22} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-[1.5]">{opener}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <QuickReact signal={shown.signal} onSay={(t) => open(t)} />
                <button onClick={() => open()} className="rounded-full px-3 py-1.5 text-[13px] text-white/50 hover:text-white">직접 말하기</button>
              </div>
            </div>
            <button onClick={() => setShown(null)} aria-label="닫기" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/45 hover:bg-white/10 hover:text-white">
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 어제 이렇게 말했죠: 최근 대화에서 받아 적은 말이 오늘 무엇이 됐는지 (양방향이 보이는 자리) */
function Yesterday({ items, onOpen }: { items: Candidate[]; onOpen: (artist: string) => void }) {
  const [sig, setSig] = useState<TasteSignal[]>([])
  useEffect(() => {
    const load = () => api.taste().then((t) => setSig(t.signals.filter((x) => x.source === 'chat' && x.said))).catch(() => {})
    load(); window.addEventListener('taste:changed', load)
    return () => window.removeEventListener('taste:changed', load)
  }, [])
  const last = sig.slice(-2).reverse()
  if (!last.length) return null
  const fromChat = items.filter((c) => c.from_chat)
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                className="mx-auto mt-5 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border border-white/10 bg-black/25 px-5 py-2.5 backdrop-blur-xl">
      <span className="text-[12px] text-white/40">내가 한 말</span>
      {last.map((x) => <span key={x.id} className="font-serif text-[15.5px] text-white/90">“{x.said}”</span>)}
      {fromChat.length > 0 && <>
        <span className="text-white/30" aria-hidden>→</span>
        {fromChat.map((c) => <button key={c.artist} onClick={() => onOpen(c.artist)} className="rounded-full bg-[#ff8f7a]/15 px-2.5 py-0.5 text-[13px] text-[#ffc3b8] hover:bg-[#ff8f7a]/25">{c.artist_ko || c.artist}</button>)}
      </>}
      <button onClick={() => window.dispatchEvent(new Event('taste:open'))} className="text-[12px] text-white/40 hover:text-white">내 취향 →</button>
    </motion.div>
  )
}

// ---------------------------------------------------------------- 한 줄

export function Story({ brief, setBrief, reload, onSection, onSpace }: {
  brief: Brief | null; setBrief: (b: Brief) => void; reload: () => void
  onSection: (s: Section) => void; onSpace: (p: number) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  // 연결고리 왼쪽 원: 원래 좋아하던 아티스트 사진 (지도에 저장돼 있다)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => { api.graph().then((g) => setThumbs(Object.fromEntries(g.nodes.filter((n) => n.thumb).map((n) => [n.id.toLowerCase(), n.thumb!])))).catch(() => {}) }, [])
  const [logOpen, setLogOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const player = usePlayer()
  const items = useMemo(() => brief?.candidates ?? [], [brief])
  useAlbumPalette(items[active]?.track?.thumb)
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } buzz(6) }, [active])

  // 헤더 메뉴(⋯)에서 여는 서랍들, 오른쪽 단계 표시에서 오는 이동
  useEffect(() => {
    const log = () => setLogOpen(true), share = () => setShareOpen(true)
    const go = (e: Event) => document.getElementById((e as CustomEvent).detail as string)?.scrollIntoView({ behavior: 'smooth' })
    window.addEventListener('open-log', log); window.addEventListener('open-share', share); window.addEventListener('story:go', go)
    return () => { window.removeEventListener('open-log', log); window.removeEventListener('open-share', share); window.removeEventListener('story:go', go) }
  }, [])
  // 도우미가 대화로 찾아온 판을 열어 달라고 할 때 (브리프를 다시 읽는 중일 수 있어 잠깐 기다렸다 찾는다)
  useEffect(() => {
    const on = (e: Event) => {
      const artist = (e as CustomEvent).detail as string
      const tryOpen = (n: number) => { const el = [...document.querySelectorAll('[data-artist]')].find((x) => (x as HTMLElement).dataset.artist === artist) as HTMLElement | undefined
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); else if (n > 0) setTimeout(() => tryOpen(n - 1), 500) }
      tryOpen(8)
    }
    window.addEventListener('story:open', on)
    return () => window.removeEventListener('story:open', on)
  }, [])
  // 처음 들어올 때 주소가 #map이면 지도부터
  useEffect(() => { if (location.hash === '#map' || location.hash === '#board') setTimeout(() => document.getElementById('map')?.scrollIntoView(), 50) }, [])

  // 가운데 온 이야기 = 슬리브에 꽂힐 판, 보이는 구역 = 오른쪽 단계 표시
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const stories = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)) }),
      { root, rootMargin: '-45% 0px -45% 0px' })
    root.querySelectorAll('[data-i]').forEach((el) => stories.observe(el))
    const sections = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) onSection((e.target as HTMLElement).dataset.section as Section) }),
      { root, rootMargin: '-50% 0px -50% 0px' })
    root.querySelectorAll('[data-section]').forEach((el) => sections.observe(el))
    return () => { stories.disconnect(); sections.disconnect() }
  }, [items.length, onSection])

  const playAt = useCallback((i: number) => { const c = items[i]; if (c?.track?.video_id) player.play(c) }, [items, player])

  const react = (i: number, f: Feedback) => {
    if (!brief) return
    const next = structuredClone(brief)
    next.candidates[i].feedback = { ...f, at: new Date().toISOString().slice(0, 10) }
    setBrief(next)
  }
  const openStory = (i: number) => document.getElementById(`story-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  if (!brief || !items.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="text-5xl font-black tracking-[-0.04em]">아직 찾은 음악이 없어요</div>
        <button onClick={() => setLogOpen(true)} className="rounded-full bg-white px-6 py-3 font-semibold text-black">음악 찾기 시작</button>
        <LogDrawer open={logOpen} onClose={() => setLogOpen(false)} date={null} onFinished={reload} />
      </div>
    )
  }
  const date = new Date(brief.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })

  return (
    <div ref={scroller} className="h-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
      {/* ① 오늘의 판 */}
      <section id="crate" data-section="crate" className="relative flex min-h-[100dvh] snap-start flex-col px-5 pb-10 pt-[88px] lg:px-10">
        {brief.run.auth_warning && (
          <div role="alert" className="mx-auto mb-2 w-fit rounded-full bg-black/35 px-4 py-1.5 text-[13px] backdrop-blur">YouTube Music 연결이 끊겼어요. 플레이리스트를 만들려면 다시 로그인해 주세요.</div>
        )}
        <div className="text-center">
          <div className="text-[13px] text-white/55">{date}</div>
          <h2 className="mt-1 text-[clamp(34px,4.4vw,60px)] font-black leading-[1.02] tracking-[-0.05em]">어젯밤 찾아온 음악 {items.length}곡</h2>
        </div>
        <Yesterday items={items} onOpen={(artist) => window.dispatchEvent(new CustomEvent('story:open', { detail: artist }))} />
        <div className="flex flex-1 items-center"><CrateStack items={items} scroller={scroller} onOpen={openStory} /></div>
        <button onClick={() => openStory(0)} className="mx-auto flex flex-col items-center gap-1 text-[13px] text-white/55 hover:text-white">
          내려서 듣기<motion.span animate={{ y: [0, 5, 0] }} transition={{ duration: 1.6, repeat: Infinity }} aria-hidden>↓</motion.span>
        </button>
      </section>

      {/* ② 듣기: 턴테이블은 붙어 있고 이야기가 지나간다 */}
      <section id="listen" data-section="listen" className="relative grid grid-cols-1 gap-x-14 px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:px-10">
        <div className="z-10 flex items-center pt-[76px] lg:sticky lg:top-0 lg:h-[100dvh] lg:pt-[68px]">
          <Deck c={items[active]} onPlay={() => playAt(active)} />
        </div>
        <div>
          {items.map((c, i) => (
            <StoryBlock key={c.artist + i} c={c} i={i} total={items.length} date={brief.date} active={i === active}
                        replies={items.filter((x) => x.reply_to?.artist === c.artist)}
                        seedThumb={c.path[0] ? thumbs[c.path[0].from.toLowerCase()] : undefined}
                        onReact={(f) => react(i, f)}
                        onOpen={(artist) => { const j = items.findIndex((x) => x.artist === artist); if (j >= 0) openStory(j) }}
                        onRetortDone={(artist) => { if (artist) api.brief(brief.date).then((b) => { setBrief(b); const j = b.candidates.findIndex((x) => x.artist === artist); if (j >= 0) setTimeout(() => openStory(j), 300) }) }} />
          ))}
        </div>
      </section>

      {/* ③ 넓히기 */}
      <MapStage scroller={scroller} onProgress={onSpace} />

      <Nudge items={items} />
      <LogDrawer open={logOpen} onClose={() => setLogOpen(false)} date={brief.date} onFinished={reload} />
      <ShareTrail date={brief.date} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}
