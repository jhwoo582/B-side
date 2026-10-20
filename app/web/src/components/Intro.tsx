/** 시작 화면 (Stardust Stage + Stack Loader + Music Reactive):
 *  1. 별가루: 검은 하늘 가운데 별 하나. 점선 궤도가 시계 방향으로 차오르며(진행률) 별에서 선이 뿜어져 나간다.
 *     아래엔 고정폭 글씨로 진행률(000%)과 지금 하는 일.
 *  2. 100%가 되면 궤도와 선의 점들이 전부 가운데로 빨려 들어가고, 그 자리에 작은 판 더미가 나타난다.
 *  3. 판 더미: 커버가 플립북처럼 한 장씩 맨 위로 올라오고(그때마다 파형이 튄다), 양옆 글자가 단어씩 세워진다.
 *     더미가 탑처럼 솟았다가 세로로 펼쳐지고, 글자가 넘어가며 사라진 뒤 커버가 끝에서부터 사라지며 앱이 열린다.
 *  필름 그레인과 얇은 파형(블룸)이 내내 깔린다. 커서 쪽으로 하늘이 살짝 기운다.
 *  누르거나 아무 키나 누르면 건너뛴다. 움직임 줄이기 설정이면 보여 주지 않는다. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { proxied, type Brief } from '../api'

type Phase = 'load' | 'morph' | 'flip' | 'tower' | 'spread' | 'out' | 'gone'
const MS: Record<Exclude<Phase, 'gone'>, number> = { load: 1500, morph: 520, flip: 900, tower: 700, spread: 900, out: 750 }
const NEXT: Record<Exclude<Phase, 'gone'>, Phase> = { load: 'morph', morph: 'flip', flip: 'tower', tower: 'spread', spread: 'out', out: 'gone' }
const EASE = [0.25, 1, 0.5, 1] as const          // Stack Loader의 기본 곡선
const IN_OUT = [0.65, 0, 0.35, 1] as const       // power3.inOut 근사
const ACTS = ['어젯밤 찾은 음악을 꺼내는 중', '이야기를 맞춰 보는 중', '취향 지도를 그리는 중', '바늘을 내리는 중']

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x)
/** 진행률: 일정하지 않게 멈칫거리며 차오른다 (실제 로딩처럼) */
const KNOTS: [number, number][] = [[0, 0], [0.18, 0.14], [0.34, 0.22], [0.52, 0.55], [0.7, 0.68], [0.86, 0.9], [1, 1]]
function progress(t: number) {
  for (let i = 1; i < KNOTS.length; i++) {
    const [t0, p0] = KNOTS[i - 1], [t1, p1] = KNOTS[i]
    if (t <= t1) { const u = (t - t0) / (t1 - t0); return p0 + (p1 - p0) * (u * u * (3 - 2 * u)) }
  }
  return 1
}
function seeded(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 } }

/** 하늘 한 장: 별, 궤도, 뿜어 나가는 선, 빨려 드는 점, 파형. 진행률 글씨는 ref로 바로 고친다 */
function Sky({ phase, beat, stack, counter, status }: {
  phase: Phase; beat: React.RefObject<number>; stack: number
  counter: React.RefObject<HTMLSpanElement | null>; status: React.RefObject<HTMLSpanElement | null>
}) {
  const cv = useRef<HTMLCanvasElement>(null)
  const ph = useRef(phase); ph.current = phase
  useEffect(() => {
    const c = cv.current!, g = c.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let W = 0, H = 0
    const fit = () => { W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0) }
    fit(); window.addEventListener('resize', fit)
    const rnd = seeded(7)
    const field = Array.from({ length: 240 }, () => ({ x: rnd(), y: rnd(), r: rnd() < 0.9 ? 0.7 : 1.4, tw: rnd() * 6, a: 0.15 + rnd() * 0.45 }))
    const RING = 84
    const rays = Array.from({ length: 30 }, () => ({ a: rnd() * Math.PI * 2, len: 0.9 + rnd() * 1.6, dash: 6 + rnd() * 14, sp: 0.6 + rnd() * 0.8, off: rnd() }))
    // 빨려 드는 점: 궤도 점 + 선 위의 점. 각자 늦게 출발하는 정도가 다르다
    const fly = [
      ...Array.from({ length: RING }, (_, i) => ({ kind: 0, i, d: rnd() * 0.4, tx: rnd() - 0.5, ty: rnd() - 0.5 })),
      ...rays.flatMap((ry, k) => Array.from({ length: 4 }, (_, j) => ({ kind: 1, i: k, j, d: rnd() * 0.4, tx: rnd() - 0.5, ty: rnd() - 0.5 }))),
    ]
    const mouse = { x: 0.5, y: 0.5 }, lean = { x: 0, y: 0 }
    const onMove = (e: PointerEvent) => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight }
    window.addEventListener('pointermove', onMove)
    const start = performance.now()
    let raf = 0, last = start, amp = 0, seen = 0, morphAt = 0, act = -1
    const spark = (x: number, y: number, s: number) => {   // 네 갈래 별
      g.beginPath(); g.moveTo(x, y - s)
      g.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s, y); g.quadraticCurveTo(x + s * 0.12, y + s * 0.12, x, y + s)
      g.quadraticCurveTo(x - s * 0.12, y + s * 0.12, x - s, y); g.quadraticCurveTo(x - s * 0.12, y - s * 0.12, x, y - s); g.fill()
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      const t = (now - start) / 1000, p = ph.current
      const P = p === 'load' ? progress(clamp01((now - start) / MS.load)) : 1
      if (p === 'morph' && !morphAt) morphAt = now
      const m = morphAt ? clamp01((now - morphAt) / MS.morph) : 0
      if (beat.current !== seen) { seen = beat.current; amp = Math.min(1.4, amp + 0.8) }
      amp *= Math.pow(0.03, dt)
      lean.x += ((mouse.x - 0.5) * 18 - lean.x) * Math.min(1, dt * 3); lean.y += ((mouse.y - 0.5) * 12 - lean.y) * Math.min(1, dt * 3)

      // 진행률 글씨
      if (counter.current) counter.current.textContent = String(Math.round(P * 100)).padStart(3, '0') + '%'
      const a = Math.min(ACTS.length - 1, Math.floor(P * ACTS.length))
      if (a !== act && status.current) { act = a; status.current.textContent = ACTS[a] }

      g.clearRect(0, 0, W, H)
      const cx = W / 2 + lean.x, cy = H * 0.47 + lean.y, R = Math.min(W, H) * 0.16

      // 별 밭: 멀리 있는 점들. 커서 쪽으로 살짝 더 기운다
      g.fillStyle = '#fff'
      for (const s of field) {
        g.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 2 + s.tw))
        g.fillRect(s.x * W + lean.x * 0.5, s.y * H + lean.y * 0.5, s.r, s.r)
      }

      const gone = p !== 'load' && p !== 'morph'
      if (!gone) {
        // 뿜어 나가는 선: 진행률이 오를수록 빨라진다
        const keep = 1 - m
        g.strokeStyle = '#fff'; g.lineWidth = 1
        for (const ry of rays) {
          const r0 = R * 1.18, r1 = R * (1.18 + ry.len) * (0.6 + 0.4 * P)
          const speed = (0.3 + P * 2.2) * ry.sp
          const ca = Math.cos(ry.a), sa = Math.sin(ry.a)
          g.globalAlpha = 0.35 * keep
          g.setLineDash([ry.dash, ry.dash * 1.6]); g.lineDashOffset = -(t * speed * 60 + ry.off * 40)
          g.beginPath(); g.moveTo(cx + ca * r0, cy + sa * r0); g.lineTo(cx + ca * r1, cy + sa * r1); g.stroke()
        }
        g.setLineDash([])
        // 궤도: 열두 시부터 시계 방향으로 차오른다
        for (let i = 0; i < RING; i++) {
          const u = i / RING, ang = -Math.PI / 2 + u * Math.PI * 2
          const lit = clamp01((P * 1.04 - u) / 0.04)
          g.globalAlpha = (0.18 + 0.82 * lit) * keep
          const s = 1 + lit * 1.2
          g.fillRect(cx + Math.cos(ang) * R - s / 2, cy + Math.sin(ang) * R - s / 2, s, s)
        }
        // 가운데 별: 진행률만큼 커지고, 빨려 들 땐 점으로 줄었다가 판 더미가 된다
        const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9)
        glow.addColorStop(0, `rgba(255,255,255,${0.22 * keep})`); glow.addColorStop(1, 'rgba(255,255,255,0)')
        g.globalAlpha = 1; g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, R * 0.9, 0, Math.PI * 2); g.fill()
        g.fillStyle = '#fff'; g.globalAlpha = keep
        spark(cx, cy, (10 + P * 10) * (1 + 0.08 * Math.sin(t * 5)) * (1 - m * 0.8))
      }
      // 빨려 드는 점: 제자리에서 출발해 가운데 판 더미 자리 안의 한 점으로
      if (p === 'morph' || (gone && m < 1)) {
        g.fillStyle = '#fff'
        for (const f of fly) {
          const k = clamp01((m - f.d) / 0.6), e = k * k * (3 - 2 * k)
          let x0, y0
          if (f.kind === 0) { const ang = -Math.PI / 2 + (f.i / RING) * Math.PI * 2; x0 = cx + Math.cos(ang) * R; y0 = cy + Math.sin(ang) * R }
          else { const ry = rays[f.i], r = R * (1.3 + (f.j! / 4) * ry.len); x0 = cx + Math.cos(ry.a) * r; y0 = cy + Math.sin(ry.a) * r }
          const x1 = cx + f.tx * stack, y1 = cy + f.ty * stack
          g.globalAlpha = (1 - e * 0.9)
          g.fillRect(x0 + (x1 - x0) * e - 1, y0 + (y1 - y0) * e - 1, 2, 2)
        }
      }

      // 파형: 화면을 가로지르는 얇은 선. 플립마다 튄다 (블룸)
      if (p !== 'out' || amp > 0.02) {
        const base = 2.5 + amp * 30
        g.save(); g.globalAlpha = p === 'out' ? 0.4 : 0.8
        g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8 + amp * 22
        g.strokeStyle = '#fff'; g.lineWidth = 1
        g.beginPath()
        for (let x = 0; x <= W; x += 3) {
          const u = x / W, env = Math.sin(u * Math.PI) ** 3
          const y = H * 0.86 + (Math.sin(u * 31 + t * 7) * 0.5 + Math.sin(u * 73 - t * 11) * 0.3 + Math.sin(u * 13 + t * 3) * 0.4) * base * env
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
        }
        g.stroke(); g.restore()
      }
      g.globalAlpha = 1
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', fit); window.removeEventListener('pointermove', onMove) }
  }, [beat, counter, status, stack])
  return <canvas ref={cv} className="absolute inset-0 h-full w-full" aria-hidden />
}

/** 단어 하나: 바닥을 축으로 눕혀 있다가 세워지고(rotateX 90 → 0), 나갈 땐 위를 축으로 넘어간다 */
function Word({ w, i, on, off }: { w: string; i: number; on: boolean; off: boolean }) {
  return (
    <span className="inline-block [perspective:1000px]">
      <motion.span className="inline-block"
                   style={{ transformOrigin: off ? '50% 0%' : '50% 100%', textShadow: '-1px 0 rgba(255,60,90,0.55), 1px 0 rgba(60,200,255,0.55)' }}
                   initial={{ rotateX: 90, opacity: 0 }}
                   animate={off ? { rotateX: 90, opacity: 0 } : on ? { rotateX: 0, opacity: 1 } : { rotateX: 90, opacity: 0 }}
                   transition={{ duration: off ? 0.5 : 0.9, ease: EASE, delay: i * 0.08 }}>{w}</motion.span>
    </span>
  )
}

export function Intro({ brief, onDone }: { brief: Brief | null; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>('load')
  const items = (brief?.candidates ?? []).filter((c) => c.track?.thumb).slice(0, 9)
  const n = items.length
  const total = brief?.candidates.length ?? n
  const beat = useRef(0)
  const counter = useRef<HTMLSpanElement>(null), status = useRef<HTMLSpanElement>(null)
  const [top, setTop] = useState(0)   // 플립북: 지금 맨 위에 올라온 커버
  const done = useRef(onDone); done.current = onDone

  useEffect(() => {
    if (phase === 'gone') { done.current(); return }
    const t = setTimeout(() => setPhase(NEXT[phase]), MS[phase])
    return () => clearTimeout(t)
  }, [phase])
  // 플립북: 한 장씩 맨 위로 (그때마다 박자)
  useEffect(() => {
    if (phase !== 'flip' || !n) return
    let i = 0
    const id = setInterval(() => { i += 1; setTop(i % n); beat.current += 1; if (i >= n - 1) clearInterval(id) }, Math.max(70, MS.flip / n))
    return () => clearInterval(id)
  }, [phase, n])
  useEffect(() => {
    const skip = () => setPhase('gone')
    window.addEventListener('keydown', skip); window.addEventListener('pointerdown', skip)
    return () => { window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip) }
  }, [])

  const size = Math.round(Math.max(64, Math.min(120, innerWidth * 0.068)))
  const shown = phase !== 'load' && phase !== 'morph'
  const wordsOn = phase === 'flip' || phase === 'tower' || phase === 'spread'
  const wordsOff = phase === 'out'

  return (
    <AnimatePresence>
      {phase !== 'gone' && (
        <motion.div className="fixed inset-0 z-[100] overflow-hidden bg-[#050507] text-white" aria-label="시작 화면" role="presentation"
                    exit={{ opacity: 0, transition: { duration: 0.6, ease: EASE } }}>
          <Sky phase={phase} beat={beat} stack={size} counter={counter} status={status} />

          {/* 판 더미: 별이 있던 자리. 플립북 → 탑 → 세로로 펼침 → 끝에서부터 사라짐 */}
          <div className="pointer-events-none absolute left-1/2 top-[47%]" style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}>
            {items.map((c, i) => {
              const spreadY = (-(110 * (n - 1)) / 2 + i * 110) + '%'
              const at = !shown ? { opacity: 0, scale: 0.4, y: '0%' }
                : phase === 'flip' ? { opacity: 1, scale: 1, y: '0%' }
                : phase === 'tower' ? { opacity: 1, scale: 1 + i * 0.15, y: `${-i * 20}%` }
                : phase === 'spread' ? { opacity: 1, scale: 1, y: spreadY }
                : { opacity: 0, scale: 1, y: spreadY }
              return (
                <motion.div key={c.artist} className="absolute inset-0 overflow-hidden rounded-[2px]"
                            style={{ zIndex: phase === 'flip' ? (i === top ? n + 1 : i) : i }}
                            initial={{ opacity: 0, scale: 0.4 }} animate={at}
                            transition={phase === 'out'
                              ? { duration: 0.45, ease: EASE, delay: (n - 1 - i) * 0.05 }
                              : phase === 'flip' ? { duration: 0.5, ease: EASE }
                              : { duration: phase === 'tower' ? 0.7 : 0.9, ease: IN_OUT, delay: (n - 1 - i) * 0.01 }}>
                  <img src={proxied(c.track?.thumb) ?? ''} alt="" className="h-full w-full object-cover" />
                </motion.div>
              )
            })}
          </div>

          {/* 양옆 글자 (Stack Loader): 단어씩 세워진다 */}
          <div className="pointer-events-none absolute inset-x-0 top-[47%] flex -translate-y-1/2 items-center justify-between px-[4vw] text-[clamp(15px,1.6vw,22px)] font-medium tracking-[0.02em]">
            <p className="flex gap-[0.35em]">{['어젯밤', '찾아온'].map((w, i) => <Word key={w} w={w} i={i} on={wordsOn} off={wordsOff} />)}</p>
            <p className="flex gap-[0.35em]">{['LP', `${total}장`].map((w, i) => <Word key={w} w={w} i={i + 2} on={wordsOn} off={wordsOff} />)}</p>
          </div>

          {/* 진행률 (Stardust): 별이 타는 동안만 */}
          <motion.div className="pointer-events-none absolute inset-x-0 top-[calc(47%_+_19vmin)] flex flex-col items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/70"
                      animate={{ opacity: phase === 'load' ? 1 : 0, y: phase === 'load' ? 0 : 6 }} transition={{ duration: 0.4 }}>
            <span ref={counter} className="text-[13px] tabular-nums text-white">000%</span>
            <span ref={status}>{ACTS[0]}</span>
          </motion.div>

          {/* 아래 가운데: 이름 */}
          <motion.p className="pointer-events-none absolute bottom-[6vh] left-1/2 -translate-x-1/2 font-serif text-[clamp(16px,1.4vw,20px)] italic tracking-[0.04em] text-white/80"
                    initial={{ opacity: 0 }} animate={{ opacity: phase === 'out' ? 0 : 1 }} transition={{ duration: 0.8, ease: EASE }}>
            Crate Digging
          </motion.p>

          {/* 필름 그레인 */}
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-overlay"
               style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
          <div className="absolute bottom-4 right-6 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 lg:right-10">누르면 건너뛰기</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
