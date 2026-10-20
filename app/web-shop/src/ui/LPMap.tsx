/** 취향 지도 (3D): 공간에 LP 여러 장이 각기 다른 높이·기울기로 떠 있다.
 *  원래 좋아하던 아티스트 한 명 = LP 한 장. 라벨엔 그 앨범아트, 홈 위엔 거기서 찾은 판들이 올라가 판과 함께 돈다.
 *  바깥 홈의 흐린 점은 아직 안 가 본 곳. LP마다: 두께가 보이는 테두리, 홈과 곡 사이의 매끈한 띠, 스핀들 구멍,
 *  그리고 판이 돌아도 제자리에 머무는 쐐기 모양 반사광. 재생 중이면 판들이 더 빨리 돈다.
 *  판을 누르면 오른쪽에 판 뒷면(트랙리스트)이 열리고, 왼쪽엔 점원의 질문과 오늘 밤 큐가 있다. */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import * as THREE from 'three'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Billboard, CameraControls, Environment, Html, Lightformer, Line, Sparkles, Stars } from '@react-three/drei'
import { easing } from 'maath'
import { ChevronLeft } from 'lucide-react'
import { api, proxied, type GraphEdge, type GraphNode, type Lead, type TasteType } from '../api'
import { albumPalette } from '../albumColor'
import { usePlayer } from '../player'
import { edgeOf } from './kit'
import { layout, type P } from './TasteMap'
import { Sleeve } from './Sleeve'
import { AskCard } from './AskCard'
import { MAX_QUEUE, Queue } from './Queue'

const LABEL = 0.36   // 라벨 반지름 / 판 반지름

// ---------------------------------------------------------------- 텍스처 (한 번만 만든다)

const once = <T,>(f: () => T) => { let v: T | null = null; return () => (v ??= f()) }

/** 홈: 라벨 바깥부터 가장자리까지. 곡 사이엔 홈 없는 매끈한 띠 */
const grooves = once(() => {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')!, m = S / 2
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, S, S)
  const gaps = [0.52, 0.64, 0.75, 0.86]
  for (let r = m * (LABEL + 0.03); r < m * 0.96; r += 1.3) {
    const f = r / m
    if (gaps.some((x) => Math.abs(f - x) < 0.01)) continue
    g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.06})`; g.lineWidth = 0.8
    g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke()
  }
  for (const x of gaps) { g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.beginPath(); g.arc(m, m, m * (x - 0.01), 0, Math.PI * 2); g.stroke() }
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 2; g.beginPath(); g.arc(m, m, m * 0.98, 0, Math.PI * 2); g.stroke()
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t
})

/** LP의 반사광: 마주 보는 두 쐐기. 판이 돌아도 이건 돌지 않는다 */
const sheen = once(() => {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')!, m = S / 2
  for (const [a, k] of [[-0.6, 0.55], [Math.PI - 0.6, 0.32]] as const) {
    const grd = g.createConicGradient(a - 0.35, m, m)
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.055, `rgba(255,255,255,${k})`); grd.addColorStop(0.11, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd; g.beginPath(); g.arc(m, m, m * 0.97, 0, Math.PI * 2); g.arc(m, m, m * (LABEL + 0.02), 0, Math.PI * 2, true); g.fill()
  }
  const t = new THREE.CanvasTexture(c); return t
})

const glow = once(() => {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')!, grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.3)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, S, S); return new THREE.CanvasTexture(c)
})

function ArtMat({ url, op }: { url: string; op: number }) {
  const tex = useLoader(THREE.TextureLoader, url)
  tex.colorSpace = THREE.SRGBColorSpace
  return <meshStandardMaterial map={tex} roughness={0.75} transparent opacity={op} />
}

// ---------------------------------------------------------------- 시드 하나 = LP 한 장

/** 판 위에 올라간 찾은 판·안 가 본 곳 */
function Rider({ p, at, dim, sel, hover, onPick, onHover }: {
  p: P; at: [number, number]; dim: boolean; sel: boolean; hover: boolean; onPick: () => void; onHover: (on: boolean) => void
}) {
  const lead = p.kind === 'lead'
  const queued = p.lead?.status === 'queued'
  const r = lead ? 0.11 : 0.42
  const disliked = p.node?.reaction === 'dislike'
  const fade = dim || disliked
  return (
    <group position={[at[0], lead ? 0.12 : 0.5, at[1]]}
           onClick={(e) => { e.stopPropagation(); onPick() }}
           onPointerOver={(e) => { e.stopPropagation(); onHover(true); document.body.style.cursor = 'pointer' }}
           onPointerOut={() => { onHover(false); document.body.style.cursor = '' }}>
      {!lead && <Line points={[[0, -0.45, 0], [0, -0.05, 0]]} color={edgeOf(p.edge).color} transparent opacity={fade ? 0.1 : 0.5} lineWidth={1} />}
      <Billboard>
        {lead ? (
          <mesh><circleGeometry args={[queued ? r * 1.6 : r, 20]} /><meshBasicMaterial color={queued ? '#ffd27a' : '#ffffff'} transparent opacity={dim ? 0.12 : hover || queued ? 0.9 : 0.4} /></mesh>
        ) : (
          <>
            <mesh position={[0, 0, -0.01]}><circleGeometry args={[r * (sel || hover ? 1.28 : 1.15), 48]} /><meshBasicMaterial color={sel ? '#ffffff' : edgeOf(p.edge).color} transparent opacity={fade ? 0.2 : 1} /></mesh>
            {p.node?.thumb ? <Suspense fallback={null}><Face url={proxied(p.node.thumb)!} r={r * (sel || hover ? 1.12 : 1)} op={fade ? 0.22 : 1} /></Suspense>
                           : <mesh><circleGeometry args={[r, 48]} /><meshBasicMaterial color="#333" /></mesh>}
          </>
        )}
      </Billboard>
      <Html center position={[0, lead ? -0.3 : -0.72, 0]} distanceFactor={16} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
        <span className={`whitespace-nowrap font-semibold ${lead ? 'text-[12px] text-white/60' : 'text-[13px] text-white/85'}`}
              style={{ opacity: lead && !hover && !sel ? 0 : dim ? 0.25 : 1, transition: 'opacity .2s', textShadow: '0 1px 8px rgba(0,0,0,0.95)' }}>
          {p.name}{p.node?.reaction === 'like' ? ' ♥' : ''}
        </span>
      </Html>
    </group>
  )
}
function Face({ url, r, op }: { url: string; r: number; op: number }) {
  const tex = useLoader(THREE.TextureLoader, url)
  tex.colorSpace = THREE.SRGBColorSpace
  return <mesh><circleGeometry args={[r, 48]} /><meshBasicMaterial map={tex} transparent opacity={op} /></mesh>
}

/** 시드의 LP: 라벨엔 시드 앨범아트, 홈 위엔 찾은 판들이 궤도를 따라 올라가 함께 돈다 */
function SeedRecord({ seed, kids, at, tilt, color, lit, sel, hover, setSel, setHover }: {
  seed: P; kids: { p: P; x: number; z: number }[]; at: THREE.Vector3; tilt: [number, number]; color: string
  lit: Set<string> | null; sel: string | null; hover: string | null; setSel: (id: string) => void; setHover: (id: string | null) => void
}) {
  const R = discR(kids)
  const spinner = useRef<THREE.Group>(null)
  const float = useRef<THREE.Group>(null)
  const player = usePlayer()
  const ph = useMemo(() => Math.random() * 10, [])
  const hot = !!lit && lit.has(seed.id)   // 이 판(또는 그 위의 판)에 손이 가 있다
  const lift = useRef({ v: 0 })
  // 물 위에 뜬 듯: 판마다 다른 박자로 천천히 오르내리고, 기울기 축이 느리게 흔들린다(세차).
  // 손이 가면 살짝 떠오르며 이쪽으로 고개를 든다.
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime, g = float.current
    if (spinner.current) spinner.current.rotation.y -= dt * (player.playing ? 0.32 : 0.06)
    easing.damp(lift.current, 'v', hot ? 1 : 0, 0.4, dt)
    if (!g) return
    const k = lift.current.v
    g.position.y = at.y + Math.sin(t * 0.42 + ph) * 0.4 + k * 0.9
    g.rotation.x = tilt[0] + Math.sin(t * 0.31 + ph) * 0.07 + k * 0.22
    g.rotation.z = tilt[1] + Math.cos(t * 0.23 + ph * 1.3) * 0.06
    g.scale.setScalar(1 + k * 0.04)
  })
  const dimAll = !!lit && !lit.has(seed.id)
  const op = dimAll ? 0.3 : 1
  const side = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#070707', roughness: 0.3, clearcoat: 1, transparent: true }), [])
  const top = useMemo(() => new THREE.MeshPhysicalMaterial({ map: grooves(), roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true }), [])
  side.opacity = op; top.opacity = op
  const onSeed = { onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); setSel(seed.id) }, onPointerOver: (e: { stopPropagation: () => void }) => { e.stopPropagation(); setHover(seed.id); document.body.style.cursor = 'pointer' }, onPointerOut: () => { setHover(null); document.body.style.cursor = '' } }
  return (
    <group ref={float} position={[at.x, at.y, at.z]} rotation={[tilt[0], 0, tilt[1]]}>
      {/* 앨범색 백라이트: 판 아래로 번진다 */}
      <mesh position={[0, -0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[R * 3.2, R * 3.2]} />
        <meshBasicMaterial map={glow()} color={color} transparent opacity={dimAll ? 0.08 : 0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <group ref={spinner}>
        <mesh material={[side, top, side]}><cylinderGeometry args={[R, R, 0.12, 128, 1]} /></mesh>
        <mesh position={[0, 0.062, 0]} rotation={[-Math.PI / 2, 0, 0]} {...onSeed}>
          <circleGeometry args={[R * LABEL, 64]} />
          {seed.node?.thumb ? <Suspense fallback={<meshStandardMaterial color="#444" />}><ArtMat url={proxied(seed.node.thumb)!} op={op} /></Suspense> : <meshStandardMaterial color="#444" />}
        </mesh>
        <mesh position={[0, 0.064, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.07, 24]} /><meshBasicMaterial color="#000" /></mesh>
        {/* 궤도 = 홈 위의 밝은 줄 */}
        {[...new Set(kids.map((k) => Math.round(Math.hypot(k.x, k.z) * 10) / 10))].map((rr) => (
          <mesh key={rr} position={[0, 0.065, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[rr - 0.012, rr + 0.012, 128]} /><meshBasicMaterial color="#ffffff" transparent opacity={dimAll ? 0.04 : 0.16} /></mesh>
        ))}
        {kids.map((k) => (
          <Rider key={k.p.id} p={k.p} at={[k.x, k.z]} dim={!!lit && !lit.has(k.p.id)} sel={sel === k.p.id} hover={hover === k.p.id}
                 onPick={() => setSel(k.p.id)} onHover={(on) => setHover(on ? k.p.id : null)} />
        ))}
      </group>
      {/* 돌지 않는 반사광 */}
      <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[R * 2, R * 2]} />
        <meshBasicMaterial map={sheen()} transparent opacity={dimAll ? 0.12 : 0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* 시드 이름: 라벨 바로 위에 뜬다 */}
      <Html center position={[0, 1.1, 0]} distanceFactor={16} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
        <span className="whitespace-nowrap text-[18px] font-bold text-white" style={{ opacity: dimAll ? 0.3 : 1, textShadow: '0 1px 10px rgba(0,0,0,0.95)' }}>{seed.name}</span>
      </Html>
    </group>
  )
}

export interface System { s: P; kids: { p: P; x: number; z: number }[]; R: number; at: THREE.Vector3; tilt: [number, number] }

/** 판들의 자리: 가로로 늘어선 두 줄. 이웃한 판은 앞뒤·위아래로 엇갈려서, 겹치지 않고 깊이가 생긴다.
 *  판은 카메라 쪽으로 고개를 들고 있고, 바깥쪽 판일수록 가운데를 향해 살짝 돈다 */
function arrange(ps: P[]): System[] {
  const byId = new Map(ps.map((p) => [p.id, p]))
  const rootOf = (p: P): P => (p.parent && byId.get(p.parent) ? rootOf(byId.get(p.parent)!) : p)
  const seeds = ps.filter((p) => p.kind === 'seed')
  const k = 0.028   // 레이아웃 단위 → 월드 단위 (판 안의 거리)
  const out: System[] = []
  let x = 0
  seeds.forEach((s, i) => {
    const kids = ps.filter((p) => p !== s && rootOf(p) === s).map((p) => ({ p, x: (p.x - s.x) * k, z: (p.y - s.y) * k }))
    const R = discR(kids)
    if (i) x += (out[i - 1].R + R) * 0.78
    const back = i % 2 === 1
    out.push({ s, kids, R, at: new THREE.Vector3(x, back ? 3.2 : -1.6, back ? -7 : 1.5), tilt: [back ? 0.5 : 0.72, 0] })
  })
  const mid = x / 2
  out.forEach((o) => { o.at.x -= mid; o.tilt[1] = -(o.at.x / Math.max(1, mid)) * 0.16 })
  return out
}
const discR = (kids: { x: number; z: number }[]) => Math.max(2.6, ...kids.map((k) => Math.hypot(k.x, k.z) + 0.9))

function Scene({ systems, colors, lit, sel, setSel, hover, setHover }: {
  systems: System[]; colors: Record<string, string>
  lit: Set<string> | null; sel: string | null; setSel: (id: string | null) => void; hover: string | null; setHover: (id: string | null) => void
}) {
  const root = useRef<THREE.Group>(null)
  // 포인터를 따라 공간 전체가 아주 조금 기운다 (시차)
  useFrame(({ pointer }, dt) => { if (root.current) easing.dampE(root.current.rotation, [-pointer.y * 0.035, pointer.x * 0.07, 0], 0.8, dt) })
  return (
    <group ref={root} onPointerMissed={() => setSel(null)}>
      {systems.map(({ s, kids, at, tilt }) => (
        <SeedRecord key={s.id} seed={s} kids={kids} at={at} tilt={tilt} color={colors[s.id] ?? '#ffffff'} lit={lit} sel={sel} hover={hover} setSel={setSel} setHover={setHover} />
      ))}
    </group>
  )
}

/** 카메라: 평소엔 낮은 눈높이에서 천천히 흔들리고, 판을 고르면 그 판 앞으로 미끄러져 간다(판 뒷면 자리만큼 왼쪽에 둔다) */
const HOME = [0, 7, 46, 0, 0, -3] as const
function Camera({ focus, R = 4, idle }: { focus: THREE.Vector3 | null; R?: number; idle: boolean }) {
  const cc = useRef<CameraControls>(null)
  useEffect(() => {
    const c = cc.current; if (!c) return
    if (!focus) { c.setLookAt(...HOME, true); return }
    const d = 14 + R * 2.6, side = innerWidth >= 1024 ? d * 0.24 : 0   // 판 크기에 맞춰 물러선다
    c.setLookAt(focus.x + side, focus.y + d * 0.32, focus.z + d, focus.x + side, focus.y - 0.5, focus.z, true)
  }, [focus])
  useFrame(({ clock }, dt) => { if (idle && cc.current) cc.current.rotate(Math.sin(clock.elapsedTime * 0.12) * dt * 0.025, 0, false) })
  return <CameraControls ref={cc} makeDefault smoothTime={0.9} truckSpeed={0} dollySpeed={0.4} azimuthRotateSpeed={0.4} polarRotateSpeed={0.3}
                         minDistance={10} maxDistance={70} minPolarAngle={0.9} maxPolarAngle={1.55} minAzimuthAngle={-0.9} maxAzimuthAngle={0.9} />
}

// ---------------------------------------------------------------- 화면

export function LPMap({ onAsk, onBack }: { type?: TasteType | null; onAsk: (say: string) => void; onBack: () => void }) {
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; leads: Lead[] } | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [hover, setHover] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  const load = () => Promise.all([api.graph(), api.frontier().catch(() => [] as Lead[])]).then(([g, leads]) => setData({ ...g, leads }))
  useEffect(() => { load() }, [])
  const { ps } = useMemo(() => (data ? layout(data.nodes, data.edges, data.leads) : { ps: [] as P[] }), [data])
  const byId = useMemo(() => new Map(ps.map((p) => [p.id, p])), [ps])
  useEffect(() => {
    ps.filter((p) => p.kind === 'seed').forEach((p) => albumPalette(p.node?.thumb).then((pal) => setColors((c) => ({ ...c, [p.id]: `rgb(${pal.c3.map((v) => Math.min(255, Math.round(v * 2.2))).join(',')})` }))))
  }, [ps])

  const family = (id: string | null) => {
    if (!id) return null
    const p = byId.get(id); if (!p) return null
    let root = p; while (root.parent && byId.get(root.parent)) root = byId.get(root.parent)!
    const inFam = (q: P): boolean => q.id === root.id || (!!q.parent && byId.has(q.parent) && inFam(byId.get(q.parent)!))
    return new Set(ps.filter(inFam).map((q) => q.id))
  }
  const lit = family(hover ?? sel)
  const systems = useMemo(() => arrange(ps), [ps])
  const open = useMemo(() => {   // 열린 판 = 고른 것의 시드
    const fam = family(sel)
    if (!fam || !sel) return null
    let root = byId.get(sel)!; while (root.parent && byId.get(root.parent)) root = byId.get(root.parent)!
    const kids = ps.filter((p) => fam.has(p.id) && p !== root)
    const line = (p: P) => data?.edges.find((e) => e.target === p.id)?.connection
    return { seed: root, a: kids.filter((p) => p.kind === 'found').map((p) => ({ p, line: line(p) })), b: kids.flatMap((p) => (p.lead ? [p.lead] : [])) }
  }, [sel, ps])  // eslint-disable-line react-hooks/exhaustive-deps
  const focused = open ? systems.find((x) => x.s.id === open.seed.id) : undefined

  const queue = useMemo(() => (data?.leads ?? []).filter((l) => l.status === 'queued').sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99)), [data])
  const setQueue = (ids: string[]) => {
    ids = ids.slice(0, MAX_QUEUE)
    setData((d) => d && { ...d, leads: d.leads.map((l) => ({ ...l, status: ids.includes(l.id) ? 'queued' : 'open', rank: ids.includes(l.id) ? ids.indexOf(l.id) : undefined })) })
    api.setQueue(ids).catch(() => {}).finally(load)
  }
  const ids = queue.map((l) => l.id)
  const nameOf = (id: string) => byId.get(id)?.name ?? id

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas camera={{ position: [0, 6, 40], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <fog attach="fog" args={['#05050a', 38, 95]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 12, 8]} intensity={1} />
        <Stars radius={90} depth={60} count={1800} factor={3} saturation={0} fade speed={0.3} />
        <Sparkles count={70} scale={[46, 18, 30]} size={2.2} speed={0.18} opacity={0.35} color="#ffe6d6" noise={0.6} />
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={1.4} position={[-5, 6, 8]} rotation={[0, 0.5, 0.6]} scale={[14, 0.5, 1]} />
          <Lightformer form="rect" intensity={0.7} position={[6, -3, 8]} rotation={[0, -0.4, -0.5]} scale={[10, 0.3, 1]} />
          <Lightformer form="ring" intensity={0.8} position={[0, 8, 4]} scale={4} color="#b8c8ff" />
        </Environment>
        {ps.length > 0 && <Scene systems={systems} colors={colors} lit={lit} sel={sel} setSel={setSel} hover={hover} setHover={setHover} />}
        <Camera focus={focused?.at ?? null} R={focused?.R} idle={!sel && !hover} />
      </Canvas>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-4 px-4 pt-4 sm:px-8 lg:pt-10">
        <div>
          <button onClick={onBack} className="pointer-events-auto mb-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] font-medium text-fg-2 ring-1 ring-line lg:hidden"><ChevronLeft size={15} />오늘 들어온 LP</button>
          <h1 className="text-[clamp(30px,3.2vw,42px)] font-serif font-bold leading-tight tracking-[-0.03em]">디깅 맵</h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-3">
            {(['본인 발언', '평론', '협업'] as const).map((e) => <span key={e} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: edgeOf(e).color }} />{edgeOf(e).label}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-white/50" />아직 안 가 본 곳</span>
          </div>
          <div className="relative z-30 mt-5"><AskCard onQueued={load} /></div>
        </div>
      </header>

      {/* 아래: 오늘 밤 큐 (판 뒷면이 열리면 그 왼쪽까지만) */}
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex sm:inset-x-8 sm:bottom-6 lg:right-[calc(400px+64px)]">
        <div className={`pointer-events-auto max-w-full ${open ? 'hidden lg:block' : ''}`}>
          <Queue items={queue} fromName={(l) => nameOf(l.from)} onChange={setQueue}
                 onDrop={(id, at) => { const next = ids.filter((x) => x !== id); next.splice(at, 0, id); setQueue(next) }} />
        </div>
      </div>

      {/* 오른쪽: 판 뒷면 */}
      <div className="pointer-events-none absolute inset-x-4 bottom-4 top-[45%] z-20 flex flex-col justify-end sm:inset-x-8 lg:inset-x-auto lg:bottom-6 lg:right-8 lg:top-28 lg:w-[400px] lg:justify-start">
        <AnimatePresence mode="wait">
          {open && (
            <div key={open.seed.id} className="pointer-events-auto flex min-h-0 flex-col">
              <Sleeve seed={open.seed} a={open.a} b={open.b} sel={sel} queued={new Set(ids)} full={ids.length >= MAX_QUEUE}
                      onPick={setSel} onAsk={onAsk} onClose={() => setSel(null)}
                      onQueue={(l) => setQueue([...ids, l.id])} />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
