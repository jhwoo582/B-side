/** 취향 지도: 지도 전체가 커다란 판이다.
 *  가운데 라벨엔 나, 그 둘레에 원래 좋아하던 아티스트(시드)가 라벨처럼 놓이고, 찾은 판이 궤도(홈)를 돈다.
 *  아직 안 가 본 곳은 바깥 점선 궤도의 흐린 점. 시드마다 그 앨범색 빛이 판 아래에서 번진다(백라이트).
 *  끌어서 이동, 휠로 확대. 별을 누르면 카드가 뜨고, 안 가 본 곳은 '오늘 밤 여기로'를 걸 수 있다. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, Minus, MessageCircle, Moon, Plus, X } from 'lucide-react'
import { api, proxied, type GraphEdge, type GraphNode, type Lead, type TasteType } from '../api'
import { albumPalette } from '../albumColor'
import { usePlayer } from '../player'
import { edgeOf } from './kit'

export interface P { id: string; kind: 'seed' | 'found' | 'lead'; name: string; x: number; y: number; r: number; parent?: string; edge?: string; node?: GraphNode; lead?: Lead; orbit?: number }

const SEED_R = 24, FOUND_R = 14, LEAD_R = 3.5

export function layout(nodes: GraphNode[], edges: GraphEdge[], leads: Lead[]) {
  const seeds = nodes.filter((n) => n.role === 'seed')
  const ring = 230 + seeds.length * 8
  const out = new Map<string, P>()
  seeds.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / seeds.length
    out.set(n.id, { id: n.id, kind: 'seed', name: n.name_ko || n.id, x: Math.cos(a) * ring, y: Math.sin(a) * ring, r: SEED_R, node: n })
  })
  // 찾은 판: 들어온 연결의 출발점 둘레를 돈다 (출발점이 아직 없으면 다음 바퀴에)
  const rest = nodes.filter((n) => n.role !== 'seed')
  const kids = new Map<string, number>()
  for (let pass = 0; pass < 4 && rest.some((n) => !out.has(n.id)); pass++) {
    for (const n of rest) {
      if (out.has(n.id)) continue
      const e = edges.find((x) => x.target === n.id && out.has(x.source))
      const parent = e ? out.get(e.source)! : null
      if (!parent && pass < 3) continue
      const p = parent ?? { x: 0, y: 0, kind: 'seed' as const, id: '' }
      const k = kids.get(p.id) ?? 0; kids.set(p.id, k + 1)
      const orbit = (p.kind === 'seed' ? 78 : 50) + (k % 2) * 14
      const base = Math.atan2(p.y, p.x)   // 바깥쪽부터 채운다
      const a = base + (k - 1) * 0.95
      out.set(n.id, { id: n.id, kind: 'found', name: n.name_ko || n.id, x: p.x + Math.cos(a) * orbit, y: p.y + Math.sin(a) * orbit, r: FOUND_R, parent: p.id || undefined, edge: e?.edge, node: n, orbit })
    }
  }
  // 아직 안 가 본 곳: 출발점 둘레 바깥 점선 궤도. 이미 지도에 있는 이름은 뺀다
  const names = new Set([...out.values()].map((p) => p.name.toLowerCase()).concat(nodes.map((n) => n.id.toLowerCase())))
  const lk = new Map<string, number>()
  for (const l of leads) {
    if (names.has(l.name.toLowerCase())) continue
    const p = out.get(l.from)
    if (!p) continue
    const k = lk.get(p.id) ?? 0; lk.set(p.id, k + 1)
    if (k >= 6) continue
    const orbit = p.kind === 'seed' ? 128 : 78
    const a = Math.atan2(p.y, p.x) + 0.35 + (k - 2.5) * 0.42
    out.set(`lead:${l.id}`, { id: `lead:${l.id}`, kind: 'lead', name: l.name_ko || l.name, x: p.x + Math.cos(a) * orbit, y: p.y + Math.sin(a) * orbit, r: LEAD_R, parent: p.id, lead: l, orbit })
  }
  // 겹침 풀기: 부모 근처를 유지하면서 살짝 밀어낸다
  const ps = [...out.values()]
  for (let it = 0; it < 60; it++) {
    for (const a of ps) for (const b of ps) {
      if (a === b || a.kind === 'seed') continue
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + (a.kind === 'lead' ? 14 : 22)
      if (d < min) { const k = (min - d) / d * 0.5; a.x += dx * k; a.y += dy * k }
    }
  }
  const R = Math.max(...ps.map((p) => Math.hypot(p.x, p.y) + p.r)) + 70
  return { ps, R }
}

export function TasteMap({ type, onAsk, onBack }: { type: TasteType | null; onAsk: (say: string) => void; onBack: () => void }) {
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; leads: Lead[] } | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [hover, setHover] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const player = usePlayer()

  const load = () => Promise.all([api.graph(), api.frontier().catch(() => [] as Lead[])]).then(([g, leads]) => setData({ ...g, leads }))
  useEffect(() => { load() }, [])
  const { ps, R } = useMemo(() => (data ? layout(data.nodes, data.edges, data.leads) : { ps: [] as P[], R: 400 }), [data])
  const byId = useMemo(() => new Map(ps.map((p) => [p.id, p])), [ps])

  // 시드마다 앨범에서 뽑은 색 (백라이트)
  useEffect(() => {
    ps.filter((p) => p.kind === 'seed').forEach((p) => albumPalette(p.node?.thumb).then((pal) => setColors((c) => ({ ...c, [p.id]: `rgb(${pal.c3.map((v) => Math.min(255, Math.round(v * 1.9))).join(' ')})` }))))
  }, [ps])

  // 휠로 확대 (지도 화면엔 페이지 스크롤이 없다)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const on = (e: WheelEvent) => { e.preventDefault(); setView((v) => ({ ...v, k: Math.max(0.5, Math.min(2.6, v.k * Math.exp(-e.deltaY * 0.0015))) })) }
    el.addEventListener('wheel', on, { passive: false })
    return () => el.removeEventListener('wheel', on)
  }, [])

  // 고른 별과 그 무리
  const family = (id: string | null) => {
    if (!id) return null
    const p = byId.get(id); if (!p) return null
    const root = p.kind === 'seed' ? p.id : p.parent && byId.get(p.parent)?.kind === 'seed' ? p.parent : p.parent ?? p.id
    return new Set(ps.filter((q) => q.id === root || q.parent === root || (q.parent && byId.get(q.parent)?.parent === root) || q.id === id).map((q) => q.id))
  }
  const lit = family(hover ?? sel)
  const selected = sel ? byId.get(sel) : null
  const spin = player.playing ? 14 : 90

  if (!data) return <div className="grid h-full place-items-center text-fg-3"></div>
  return (
    <div className="relative h-full w-full overflow-hidden">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-4 px-4 pt-4 sm:px-8 lg:pt-10">
        <div>
          <button onClick={onBack} className="pointer-events-auto mb-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] font-medium text-fg-2 ring-1 ring-line lg:hidden"><ChevronLeft size={15} />오늘 들어온 LP</button>
          <h1 className="text-[clamp(30px,3.2vw,42px)] font-serif font-bold leading-tight tracking-[-0.03em]">디깅 맵</h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-3">
            {(['본인 발언', '평론', '협업'] as const).map((e) => <span key={e} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: edgeOf(e).color }} />{edgeOf(e).label}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-white/50" />아직 안 가 본 곳</span>
          </div>
        </div>
        <div className="pointer-events-auto flex overflow-hidden rounded-full bg-fill ring-1 ring-line backdrop-blur">
          <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.25) }))} aria-label="축소" className="grid h-10 w-10 place-items-center text-fg-2 hover:text-fg"><Minus size={17} /></button>
          <button onClick={() => setView({ x: 0, y: 0, k: 1 })} className="px-2 text-[12.5px] tabular-nums text-fg-3 hover:text-fg">{Math.round(view.k * 100)}%</button>
          <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.6, v.k * 1.25) }))} aria-label="확대" className="grid h-10 w-10 place-items-center text-fg-2 hover:text-fg"><Plus size={17} /></button>
        </div>
      </header>

      <div ref={box} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
           onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
           onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.hypot(dx, dy) > 4) d.moved = true; if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy })) }}
           onPointerUp={() => { if (drag.current && !drag.current.moved) setSel(null); drag.current = null }}>
        <svg className="absolute left-1/2 top-[54%] overflow-visible" width={1} height={1} aria-label="디깅 맵">
          <defs>
            <radialGradient id="disc" r="50%"><stop offset="0" stopColor="#1c1b1b" /><stop offset="0.7" stopColor="#0e0d0d" /><stop offset="1" stopColor="#060606" /></radialGradient>
            <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.5" stopColor="#fff" stopOpacity="0.05" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="38" /></filter>
            {ps.filter((p) => p.kind !== 'lead').map((p) => <clipPath key={p.id} id={`c-${cssId(p.id)}`}><circle r={p.r} /></clipPath>)}
          </defs>
          <g style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k * fit(R)})`, transition: drag.current ? 'none' : 'transform 0.35s cubic-bezier(.22,1,.36,1)' }}>
            {/* 판 */}
            <circle r={R} fill="url(#disc)" stroke="rgb(255 255 255 / 0.06)" />
            <g opacity={0.9}>{Array.from({ length: Math.floor((R - 60) / 5) }, (_, i) => <circle key={i} r={60 + i * 5} fill="none" stroke="rgb(255 255 255 / 0.028)" strokeWidth={0.8} />)}</g>
            <g style={{ animation: `spin ${spin}s linear infinite`, transformOrigin: '0 0' }}>
              <path d={wedge(R, -12, 12)} fill="url(#sheen)" />
              <path d={wedge(R, 168, 192)} fill="url(#sheen)" opacity={0.7} />
            </g>
            {/* 백라이트: 시드의 앨범색이 판 위로 은은하게 번진다(겹치면 더해진다) */}
            {ps.filter((p) => p.kind === 'seed').map((p) => (
              <circle key={`g-${p.id}`} cx={p.x} cy={p.y} r={135} fill={colors[p.id] ?? 'rgb(255 255 255)'} opacity={lit && !lit.has(p.id) ? 0.08 : 0.42} filter="url(#glow)" style={{ transition: 'opacity .4s', mixBlendMode: 'screen' }} />
            ))}
            {/* 가운데 라벨: 나 */}
            <circle r={58} fill="rgb(var(--album))" opacity={0.92} />
            <circle r={58} fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth={6} />
            <circle r={3.5} fill="#000" />
            <text y={-18} textAnchor="middle" fontSize={15} fontWeight={800} fill="#000">나</text>
            {type && <text y={26} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(0 0 0 / 0.7)">{type.name}</text>}

            {/* 궤도와 연결 */}
            {ps.filter((p) => p.parent && p.orbit).map((p) => {
              const q = byId.get(p.parent!)!
              const dim = lit && !lit.has(p.id)
              return (
                <g key={`o-${p.id}`} opacity={dim ? 0.15 : 1} style={{ transition: 'opacity .3s' }}>
                  <circle cx={q.x} cy={q.y} r={Math.hypot(p.x - q.x, p.y - q.y)} fill="none" stroke={`rgb(255 255 255 / ${p.kind === 'lead' ? 0.06 : 0.1})`} strokeDasharray={p.kind === 'lead' ? '2 5' : undefined} />
                  {p.kind === 'found' && <line x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke={edgeOf(p.edge).color} strokeOpacity={0.45} strokeWidth={1.2} />}
                </g>
              )
            })}

            {/* 별 */}
            {ps.map((p) => {
              const dim = lit && !lit.has(p.id)
              const on = sel === p.id
              const disliked = p.node?.reaction === 'dislike'
              return (
                <g key={p.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.2 : disliked ? 0.5 : 1} style={{ transition: 'opacity .3s', cursor: 'pointer' }}
                   onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}
                   onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSel(p.id) }}
                   role="button" aria-label={p.name}>
                  {p.kind === 'lead' ? (
                    <>
                      <circle r={10} fill="transparent" />
                      <circle r={p.r} fill={p.lead?.status === 'queued' ? 'rgb(var(--album))' : 'rgb(255 255 255 / 0.4)'} />
                      {p.lead?.status === 'queued' && <circle r={9} fill="none" stroke="rgb(var(--album))" strokeOpacity={0.7}><animate attributeName="r" values="5;12;5" dur="2.4s" repeatCount="indefinite" /></circle>}
                      {(hover === p.id || on || view.k > 1.4) && <text y={-9} textAnchor="middle" fontSize={10} fill="rgb(255 255 255 / 0.55)">{p.name}</text>}
                    </>
                  ) : (
                    <>
                      {on && <circle r={p.r + 7} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.5} />}
                      <circle r={p.r + 2} fill={p.kind === 'seed' ? '#f7f3ee' : edgeOf(p.edge).color} />
                      {p.node?.thumb ? <image href={proxied(p.node.thumb)} x={-p.r} y={-p.r} width={p.r * 2} height={p.r * 2} clipPath={`url(#c-${cssId(p.id)})`} preserveAspectRatio="xMidYMid slice" />
                                     : <circle r={p.r} fill="#2a2a2a" />}
                      {p.kind === 'seed' && <circle r={2.2} fill="#000" />}
                      {p.node?.reaction === 'like' && <g transform={`translate(${p.r * 0.75} ${-p.r * 0.75})`}><circle r={6} fill="rgb(var(--album))" stroke="#000" strokeWidth={1.5} /></g>}
                      <text y={p.r + (p.kind === 'seed' ? 18 : 14)} textAnchor="middle" fontSize={p.kind === 'seed' ? 13 : 10.5} fontWeight={p.kind === 'seed' ? 700 : 500}
                            fill={p.kind === 'seed' ? '#fff' : 'rgb(255 255 255 / 0.75)'} style={{ paintOrder: 'stroke' }} stroke="rgb(0 0 0 / 0.6)" strokeWidth={3}>{p.name}</text>
                    </>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      <AnimatePresence>
        {selected && <Card key={selected.id} p={selected} parent={selected.parent ? byId.get(selected.parent) : undefined} onClose={() => setSel(null)} onAsk={onAsk}
                           onQueue={async (l) => { await api.setLead(l.id, l.status === 'queued' ? 'open' : 'queued').catch(() => {}); load() }} />}
      </AnimatePresence>
      <p className="pointer-events-none absolute bottom-4 right-6 hidden text-[12px] text-fg-3 sm:block">끌어서 이동 · 휠로 확대 · 별을 누르면 자세히</p>
    </div>
  )

  function fit(r: number) {
    const el = box.current
    const w = el?.clientWidth ?? 1000, h = el?.clientHeight ?? 700
    return Math.min(w, h * 1.05) / (r * 2.15)
  }
}

const cssId = (s: string) => s.replace(/[^a-zA-Z0-9가-힣]/g, '_')
function wedge(R: number, a0: number, a1: number) {
  const p = (a: number) => `${Math.cos((a * Math.PI) / 180) * R} ${Math.sin((a * Math.PI) / 180) * R}`
  return `M0 0 L${p(a0)} A${R} ${R} 0 0 1 ${p(a1)} Z`
}

export function Card({ p, parent, onClose, onAsk, onQueue }: { p: P; parent?: P; onClose: () => void; onAsk: (s: string) => void; onQueue: (l: Lead) => void }) {
  const l = p.lead
  const reaction = p.node?.reaction
  return (
    <motion.aside initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                  className="bar absolute bottom-5 left-4 z-20 w-[min(380px,calc(100%-32px))] rounded-[22px] p-5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] ring-1 ring-line sm:left-8">
      <button onClick={onClose} aria-label="닫기" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-fg-3 hover:bg-fill hover:text-fg"><X size={16} /></button>
      <div className="flex items-center gap-3.5 pr-8">
        {p.node?.thumb ? <img src={proxied(p.node.thumb)} alt="" className={`h-14 w-14 shrink-0 object-cover ring-1 ring-white/10 ${p.kind === 'seed' ? 'rounded-full' : 'rounded-[4px]'}`} />
                       : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-dashed border-white/30 text-fg-3"><Moon size={18} /></span>}
        <div className="min-w-0">
          <p className="truncate text-[17px] font-bold tracking-[-0.03em]">{p.name}</p>
          <p className="text-[13px] text-fg-3">
            {p.kind === 'seed' ? '원래 좋아하던 아티스트' : p.kind === 'lead' ? `${parent?.name ?? l?.from}에서 · ${l?.direction === 'root' ? '뿌리' : '곁가지'} · 아직 안 가 봄`
              : <>{parent?.name}에서 · <span style={{ color: edgeOf(p.edge).color }}>{edgeOf(p.edge).label}</span>{reaction === 'like' ? ' · 좋아함' : reaction === 'dislike' ? ' · 별로' : ''}</>}
          </p>
        </div>
      </div>
      {l?.quote && <p className="mt-4 text-[14px] leading-[1.65] text-fg-2">“{l.quote}”</p>}
      {l?.hint && !l.quote && <p className="mt-4 text-[14px] leading-[1.65] text-fg-2">{l.hint}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {l && (
          <button onClick={() => onQueue(l)} className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition ${l.status === 'queued' ? 'bg-accent text-black' : 'bg-fg text-black hover:scale-[1.02]'}`}>
            <Moon size={15} />{l.status === 'queued' ? '오늘 밤 여기로 가요' : '오늘 밤 여기로'}
          </button>
        )}
        <button onClick={() => onAsk(p.kind === 'lead' ? `${p.name}은(는) 어떤 음악이야?` : `${p.name} 같은 결로 더 찾아줘`)}
                className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-fg-2 ring-1 ring-white/15 transition hover:text-fg">
          <MessageCircle size={15} />점원에게 묻기
        </button>
      </div>
    </motion.aside>
  )
}
