/** 시작 화면: 오늘 들어온 LP가 가게에 입고된다. 하루 한 번, 건너뛸 수 있다.
 *  1) 가게 오픈 — 화면 머리가 뜨고 OPEN 불이 들어오며, 조명이 왼쪽의 빈 크레이트에 떨어진다
 *  생김새는 앱의 다른 화면과 같다: 뒤엔 지금 들어오는 LP의 앨범색이 흐리게 번지고(Ambient), 제목은 Hahmlet, 나머지는 Pretendard·유리 면
 *  2) 입고 — LP가 위에서 한 장씩 내려와 크레이트에 꽂힌다. 꽂히는 순간 오른쪽 지도에서
 *     원래 좋아하던 아티스트(시드)로부터 선이 뻗어 그 LP가 매달린다(어디서 퍼져 왔는지)
 *  3) 전환 — 크레이트에서 LP 한 장이 올라와 돌고(로딩), 앱이 열린다
 *  모든 상태는 시간 t 하나에서 계산한다(프레임마다 DOM을 직접 고친다). */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { proxied, type Brief, type Candidate } from '../api'
import { Art, Vinyl, edgeOf, fmtDate, ko, nameOf } from './kit'

const KEY = 'crate-opening-seen'
const today = () => new Date().toLocaleDateString('sv-SE')
export function shouldOpen() {
  if (new URLSearchParams(location.search).has('intro')) return true
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  try { return localStorage.getItem(KEY) !== today() } catch { return true }
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const out3 = (x: number) => 1 - Math.pow(1 - x, 3)
const in3 = (x: number) => x * x * x
const inout = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const backOut = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2)
const settle = (x: number) => Math.sin(x * Math.PI * 3) * Math.pow(1 - x, 2) * 0.5   // 꽂힐 때 살짝 튄다

const IN0 = 2.0                // 입고 시작
const SHOW = 1.0, QUICK = 0.5  // 앞에서 잠깐 보여 주는 LP / 바로 꽂히는 LP
const FEATURED = 3
const CRATE_X = 0.3            // 크레이트 가로 위치(화면 비율)

type Slot = { c: Candidate; n: number; at: number; dur: number; feature: boolean; land: number; seed: string }
function plan(picks: Candidate[]) {
  let at = IN0
  const slots: Slot[] = picks.map((c, n) => {
    const feature = n < FEATURED, dur = feature ? SHOW : QUICK
    const s = { c, n, at, dur, feature, land: at + dur * (feature ? 0.9 : 0.75), seed: (c.kind === 'hidden_track' ? c.artist : c.path[0]?.from) ?? '' }
    at += feature ? SHOW : QUICK * 0.5   // 뒤의 LP들은 겹쳐서 줄줄이 떨어진다
    return s
  })
  return { slots, inEnd: at + QUICK }
}

/** 오른쪽 지도: 시드는 왼쪽, 찾은 LP는 오른쪽. 같은 시드의 LP끼리 붙여 세워 선이 엇갈리지 않고,
 *  가로 위치를 조금씩 흔들어 표가 아니라 퍼져 나가는 모양이 되게 한다. 좌표는 화면 비율(%) */
function layoutGraph(slots: Slot[]) {
  const seeds = [...new Set(slots.map((s) => s.seed))]
  const kids = seeds.flatMap((seed) => slots.filter((s) => s.seed === seed))
  const top = 27, bottom = 86, step = (bottom - top) / Math.max(1, kids.length - 1)
  const kid = new Map(kids.map((s, i) => [s.n, { x: 78 + ((i * 37) % 5) * 1.5, y: kids.length === 1 ? 60 : top + i * step }]))
  const seed = new Map(seeds.map((name, i) => {
    const ys = slots.filter((s) => s.seed === name).map((s) => kid.get(s.n)!.y)
    return [name, { x: 57 + ((i * 53) % 4) * 2.2, y: ys.reduce((a, b) => a + b, 0) / ys.length }]
  }))
  return { seeds, kid, seed }
}

export function Opening({ brief, picks, thumbs, onDone }: { brief: Brief; picks: Candidate[]; thumbs: Record<string, string | undefined>; onDone: () => void }) {
  const { slots, inEnd } = useMemo(() => plan(picks), [picks])
  const g = useMemo(() => layoutGraph(slots), [slots])
  const SPIN = inEnd + 0.6, END = SPIN + 1.9
  const root = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  const [glow, setGlow] = useState(0)   // 뒤에 번지는 앨범색 = 방금 들어온 LP
  useLayoutEffect(() => { const r = () => setSize({ w: innerWidth, h: innerHeight }); addEventListener('resize', r); return () => removeEventListener('resize', r) }, [])
  const pages = brief.run?.pages_read ?? 0
  const last = slots[slots.length - 1]?.c

  const finish = () => {
    if (done.current) return
    done.current = true
    try { localStorage.setItem(KEY, today()) } catch { /* 다음에 또 보여도 괜찮다 */ }
    onDone()
  }

  useEffect(() => {
    const el = root.current!
    const q = (s: string) => el.querySelector(s) as HTMLElement
    const qa = (s: string) => [...el.querySelectorAll<HTMLElement>(s)]
    const sign = q('[data-sign]'), open = q('[data-open]'), light = q('[data-light]'), crate = q('[data-crate]'), count = q('[data-count]')
    let lastGlow = 0
    const recs = qa('[data-rec]'), seedEls = qa('[data-seed]'), kidEls = qa('[data-kid]'), lines = [...el.querySelectorAll<SVGPathElement>('[data-line]')], dots = [...el.querySelectorAll<SVGCircleElement>('[data-dot]')]
    const tally = q('[data-tally]'), spin = q('[data-spin]'), world = q('[data-world]')
    let raf = 0, t0 = performance.now()

    const frame = (now: number) => {
      const t = (now - t0) / 1000
      const W = el.clientWidth, H = el.clientHeight, u = Math.min(W, H) / 100
      const cx = W * CRATE_X, floor = H * 0.8, S = 28 * u, showY = H * 0.56
      // 1) 가게 오픈
      const head = out3(seg(t, 0.2, 1.1))
      sign.style.opacity = String(head); sign.style.transform = `translateY(${(1 - head) * 14}px)`
      open.style.opacity = String(t < 1.2 ? 0 : t < 1.32 ? 0.4 : t < 1.4 ? 0.1 : 1)   // 불이 탁 들어온다
      light.style.opacity = String(out3(seg(t, 0.9, 1.9)))
      crate.style.opacity = String(out3(seg(t, 1.0, 1.7)))
      // 2) 입고
      slots.forEach((s, k) => {
        const node = recs[k]
        if (t < s.at) { node.style.opacity = '0'; return }
        const after = slots.filter((x) => x.n > k && t >= x.land).length   // 나중에 온 LP가 앞에 선다
        const inY = floor - after * 1.4 * u, inS = 1 - after * 0.03, inB = 1 - Math.min(0.55, after * 0.09)
        const p = seg(t, s.at, s.at + s.dur)
        let y: number, sc = 1, rot: number
        if (s.feature) {
          const come = out3(seg(p, 0, 0.4)), drop = in3(seg(p, 0.66, 0.9)), land = seg(p, 0.9, 1)
          const mid = showY + S * 0.5
          y = -S + (mid + S) * come + (floor - mid) * drop + (land > 0 ? settle(land) * -3 * u : 0)
          sc = 1.08 - 0.08 * drop
          rot = (1 - come) * -6 + Math.sin(t * 1.6) * 1.2 * (1 - drop)
        } else {
          const drop = in3(seg(p, 0, 0.75)), land = seg(p, 0.75, 1)
          y = -S + (floor + S) * drop + (land > 0 ? settle(land) * -2.5 * u : 0)
          rot = (1 - drop) * (k % 2 ? 4 : -4)
        }
        let b = 1
        if (p >= 1) { y = inY; sc = inS; rot = 0; b = inB }
        node.style.opacity = '1'
        node.style.zIndex = String(10 + k)
        node.style.filter = b < 1 ? `brightness(${b})` : ''
        node.style.transform = `translate(${cx - S / 2}px, ${y - S}px) scale(${sc}) rotate(${rot}deg)`
      })
      // 오른쪽 지도: 시드가 먼저 떠 있고, LP가 꽂히는 순간 선이 뻗어 LP가 매달린다
      const latest = slots.filter((s) => t >= s.land - 0.1).pop()
      g.seeds.forEach((seed, i) => {
        const first = Math.min(...slots.filter((s) => s.seed === seed).map((s) => s.land))
        const a = backOut(seg(t, Math.min(IN0 + 0.2 + i * 0.08, first - 0.3), Math.min(IN0 + 0.7 + i * 0.08, first)))
        const hot = latest?.seed === seed && t < SPIN
        seedEls[i].style.opacity = String(clamp(a) * (hot ? 1 : 0.62))
        seedEls[i].style.transform = `translate(calc(-100% + 2.3vmin), -50%) scale(${0.6 + 0.4 * a})`   // 사진 가운데가 시드 자리에 온다
      })
      slots.forEach((s, k) => {
        const line = out3(seg(t, s.land - 0.1, s.land + 0.35)), pop = backOut(seg(t, s.land + 0.15, s.land + 0.55))
        const hot = latest === s && t < SPIN
        lines[k].style.strokeDashoffset = String(1 - line)
        lines[k].style.opacity = String(line > 0 ? (hot ? 0.95 : 0.4) : 0)
        // 선이 그어질 때 빛 한 점이 앞장서 달린다
        const len = lines[k].getTotalLength(), pt = lines[k].getPointAtLength(len * line)
        dots[k].setAttribute('cx', String(pt.x)); dots[k].setAttribute('cy', String(pt.y))
        dots[k].style.opacity = String(line > 0 && line < 1 ? 1 : Math.max(0, 1 - seg(t, s.land + 0.35, s.land + 0.6)) * (line >= 1 ? 1 : 0))
        kidEls[k].style.opacity = String(clamp(pop) * (hot ? 1 : 0.7))
        kidEls[k].style.transform = `translate(0, -50%) scale(${0.5 + 0.5 * pop})`
      })
      const arrived = slots.filter((s) => t >= s.land).length
      count.textContent = String(arrived)
      if (arrived !== lastGlow && arrived <= FEATURED) { lastGlow = arrived; setGlow(Math.max(0, arrived - 1)) }   // 앞의 몇 장 색만 받는다(흰 커버면 화면이 바랜다)
      tally.textContent = `${pages}곳을 읽고 원문을 대조했어요`
      tally.style.opacity = String(seg(t, IN0, IN0 + 0.4) * (1 - seg(t, SPIN, SPIN + 0.4)))
      // 3) 전환: 크레이트에서 LP가 올라와 돈다 → 앱
      const rise = out3(seg(t, SPIN, SPIN + 0.9)), grow = inout(seg(t, SPIN + 0.8, END)), toMid = inout(seg(t, SPIN + 0.3, SPIN + 1.3))
      spin.style.opacity = String(seg(t, SPIN, SPIN + 0.25))
      spin.style.left = `${(CRATE_X + (0.5 - CRATE_X) * toMid) * 100}%`
      spin.style.transform = `translate(-50%, -50%) translateY(${(1 - rise) * 28 * u}px) scale(${0.6 + rise * 0.4 + grow * 0.5}) rotate(${t * 200}deg)`
      world.style.opacity = String(1 - seg(t, SPIN + 0.2, SPIN + 1.0))
      el.style.opacity = String(1 - seg(t, END - 0.45, END))
      if (t >= END) { finish(); return }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame((n) => { t0 = n; frame(n) })
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish() } }
    addEventListener('keydown', key)
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', key) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const bg = proxied(slots[glow]?.c.track?.thumb)
  return (
    <div ref={root} className="fixed inset-0 z-[100] overflow-hidden bg-black text-fg" role="dialog" aria-label="오늘 들어온 LP 입고" onClick={finish}>
      {/* 앱과 같은 배경: 방금 들어온 LP의 앨범색이 크게 흐려져 번진다 */}
      <div aria-hidden className="absolute inset-0">
        {bg && <img key={bg} src={bg} alt="" className="absolute left-[-20%] top-[-30%] h-[130%] w-[90%] object-cover opacity-55 transition-opacity duration-1000 [filter:blur(110px)_saturate(1.8)_brightness(0.75)]" style={{ animation: 'fade-in 1.2s ease-out' }} />}
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,transparent_0,rgb(0_0_0/0.4)_55%,rgb(0_0_0/0.88)_100%)]" />
      </div>
      <div data-world className="absolute inset-0">
        <div data-light className="absolute inset-0 opacity-0" style={{ background: `radial-gradient(40vmin 56vmin at ${CRATE_X * 100}% 64%, rgb(255 245 235 / 0.10), transparent 70%)` }} />
        {/* 머리: 다른 화면의 제목과 같은 모양 */}
        <header data-sign className="absolute inset-x-0 top-0 flex items-start justify-between px-[6vw] pt-[7vh] opacity-0">
          <div>
            <p className="text-[clamp(13px,1.6vmin,16px)] font-medium text-fg-3">{fmtDate(brief.date)}</p>
            <h1 className="mt-1 font-serif text-[clamp(34px,5.4vmin,60px)] font-bold leading-tight tracking-[-0.03em]">오늘 들어온 LP <span data-count className="font-display text-[1.15em] font-normal italic text-accent">0</span></h1>
          </div>
          <span data-open className="mt-2 inline-flex h-9 items-center gap-2 rounded-full bg-fill px-3.5 text-[13px] font-semibold opacity-0 ring-1 ring-line backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-[#7fe3a8] shadow-[0_0_10px_2px_rgb(127_227_168/0.7)]" />OPEN
          </span>
        </header>

        {/* 오른쪽: 퍼져 나간 지도 */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden>
          <defs><filter id="op-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter></defs>
          {slots.map((s) => {
            const a = g.seed.get(s.seed)!, b = g.kid.get(s.n)!, um = Math.min(size.w, size.h) / 100
            const x0 = (a.x / 100) * size.w + 2.6 * um, y0 = (a.y / 100) * size.h, x1 = (b.x / 100) * size.w - 0.6 * um, y1 = (b.y / 100) * size.h, mx = (x0 + x1) / 2
            const color = s.c.kind === 'hidden_track' ? '#e8e4de' : edgeOf(s.c.path[0]?.edge).color
            return (
              <g key={s.n}>
                <path data-line d={`M${x0} ${y0} C${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`} fill="none" pathLength={1} strokeDasharray="1 1" strokeDashoffset="1" stroke={color} strokeWidth={1.4} strokeLinecap="round" opacity={0} />
                <circle data-dot r={3.5} fill={color} filter="url(#op-glow)" opacity={0} />
              </g>
            )
          })}
        </svg>
        {g.seeds.map((seed) => (
          <div key={seed} data-seed className="absolute flex flex-row-reverse items-center gap-[1.2vmin] opacity-0" style={{ left: `${g.seed.get(seed)!.x}%`, top: `${g.seed.get(seed)!.y}%`, transformOrigin: 'calc(100% - 2.3vmin) 50%' }}>
            <span className="grid h-[4.6vmin] w-[4.6vmin] shrink-0 place-items-center overflow-hidden rounded-full bg-fill-2 text-[1.8vmin] font-bold text-fg-2 ring-1 ring-white/20">
              {thumbs[seed] ? <img src={proxied(thumbs[seed])} alt="" className="h-full w-full object-cover" /> : ko(seed).slice(0, 1)}
            </span>
            <span className="max-w-[17vmin] truncate text-right text-[1.7vmin] font-semibold text-fg-2">{ko(seed)}</span>
          </div>
        ))}
        {slots.map((s) => (
          <div key={s.n} data-kid className="absolute flex origin-left items-center gap-[1.2vmin] opacity-0" style={{ left: `${g.kid.get(s.n)!.x}%`, top: `${g.kid.get(s.n)!.y}%` }}>
            <span className="relative h-[4.6vmin] w-[4.6vmin] shrink-0 overflow-hidden rounded-[3px] shadow-[0_1vmin_2vmin_-1vmin_#000] ring-1 ring-white/15"><Art c={s.c} /></span>
            <span className="whitespace-nowrap">
              <span className="block text-[1.8vmin] font-bold leading-tight tracking-[-0.02em]">{s.c.kind === 'hidden_track' ? s.c.track?.title : nameOf(s.c)}</span>
              <span className="mt-[0.3vmin] flex items-center gap-[0.6vmin] text-[1.35vmin] text-fg-3">
                <span className="h-[0.8vmin] w-[0.8vmin] rounded-full" style={{ background: s.c.kind === 'hidden_track' ? '#e8e4de' : edgeOf(s.c.path[0]?.edge).color }} />
                {s.c.kind === 'hidden_track' ? '숨은 곡' : edgeOf(s.c.path[0]?.edge).label}
              </span>
            </span>
          </div>
        ))}

        {/* 왼쪽: 입고되는 LP — 메인 크레이트와 같은 슬리브(비닐 겉커버, 위에서 오는 빛) */}
        {slots.map((s) => (
          <div key={s.n} data-rec className="absolute left-0 top-0 aspect-square w-[28vmin] origin-bottom opacity-0 will-change-transform">
            <span className="vinyl absolute inset-y-[4%] left-[14%] w-[92%]" />
            <span className="pointer-events-none absolute -inset-[2%] rounded-[6px] bg-white/[0.03] ring-1 ring-white/[0.12]" />
            <span className="absolute inset-0 overflow-hidden rounded-[3px] shadow-[0_-16px_30px_-12px_rgb(0_0_0/0.75),0_20px_40px_-20px_rgb(0_0_0/0.9)]">
              <Art c={s.c} eager />
              <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(255_250_240/0.16),transparent_28%,transparent_60%,rgb(0_0_0/0.4))]" />
              <span className="absolute inset-0 bg-[linear-gradient(118deg,transparent_0_30%,rgb(255_255_255/0.14)_42%,transparent_54%)] mix-blend-screen" />
              <span className="absolute inset-0 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),inset_0_1px_0_rgb(255_255_255/0.3)]" />
            </span>
          </div>
        ))}
        {/* 크레이트 앞판: 유리 면 */}
        <div data-crate className="bar absolute top-[80%] z-[95] h-[11vmin] w-[40vmin] -translate-x-1/2 -translate-y-[38%] rounded-[1.4vmin] opacity-0 ring-1 ring-white/[0.12] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_4vmin_6vmin_-2vmin_#000]"
             style={{ left: `${CRATE_X * 100}%` }} />
        <p data-tally className="absolute bottom-[6vh] left-[6vw] text-[13px] font-medium text-fg-3 opacity-0" />
      </div>
      {/* 전환: 크레이트에서 올라와 도는 LP */}
      <div data-spin className="absolute top-1/2 aspect-square w-[34vmin] opacity-0" style={{ left: `${CRATE_X * 100}%` }}>
        {last && <Vinyl c={last} spinning={false} className="h-full w-full" />}
      </div>
      <button onClick={(e) => { e.stopPropagation(); finish() }} className="absolute bottom-[6vh] right-[6vw] z-[200] inline-flex h-10 items-center rounded-full bg-fill px-4 text-[13.5px] font-semibold text-fg-2 ring-1 ring-line backdrop-blur transition hover:bg-fill-2 hover:text-fg">건너뛰기</button>
    </div>
  )
}
