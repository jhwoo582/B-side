/** 지도: 궤도계. 시드 아티스트가 항성처럼 가운데서 빛나고, 그 아티스트에서 찾은 판들이 행성처럼 둘레를 돈다.
 *  - 뿌리: 시드 본인이 영향받았다고 말한 음악은 항성 아래로 뿌리처럼 내려간다 (거슬러 올라가는 방향)
 *  - 미개척지: 에이전트가 보고 지나친 이름은 바깥 안개 띠의 흐린 별. 눌러서 '오늘 밤 여기로'를 고르면 다음 디깅이 그쪽으로 간다
 *  지도는 지난 기록이 아니라 다음 갈 곳을 고르는 화면이다. */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Line, OrbitControls, Stars } from '@react-three/drei'
import { AnimatePresence, motion } from 'motion/react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { api, EDGE_HEX, EDGE_LABEL, proxied, type GraphEdge, type GraphNode, type Lead } from '../api'
import { drawSleeveCanvas } from '../components/SleeveArt'
import { ArtistSheet } from '../components/ArtistSheet'
import { CompareMaps } from '../components/CompareMaps'
import { LeadCard } from '../components/LeadCard'
import { LogDrawer } from '../components/LogDrawer'
import { GravityStars } from '../components/GravityStars'
import { useAlbumPalette } from '../albumColor'
import { usePlayer } from '../player'

const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) }
const damp = THREE.MathUtils.damp
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const ROOT_HEX = EDGE_HEX['본인 발언']
const starRadius = (n: GraphNode) => (n.role === 'seed' ? 0.85 : 0.48)
const LEAD_R = 0.3
/** 깊이: 카메라에서 멀수록 0→1. 먼 별은 작고 어둡게 (시네마틱 오빗) */
const _o = new THREE.Vector3()
function depthOf(p: THREE.Vector3, camera: THREE.Camera) {
  const center = camera.position.distanceTo(_o)
  return THREE.MathUtils.clamp((camera.position.distanceTo(p) - center + 7) / 14, 0, 1)
}
const _c = new THREE.Color()
const leadKey = (l: Lead) => `lead:${l.id}`

/** 천체: orbit = 부모 둘레를 도는 행성, root = 부모 아래 뿌리, fog = 바깥 안개 띠의 흐린 별 */
type Mode = 'orbit' | 'root' | 'fog'
interface Body { id: string; parent: string | null; mode: Mode; anchor: THREE.Vector3; offset: THREE.Vector3; r: number; w: number; phase: number; plane: THREE.Quaternion; edge: string }
interface System { bodies: Body[]; order: string[]; extent: number; fogRings: { parent: string; r: number; plane: THREE.Quaternion }[] }

function buildSystem(nodes: GraphNode[], edges: GraphEdge[], leads: Lead[]): System {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const isSeed = (id: string) => byId.get(id)?.role === 'seed'
  const parent = new Map<string, { id: string; edge: string; mode: Mode }>()
  for (const e of [...edges].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = byId.get(e.target)
    if (!t || isSeed(t.id) || parent.has(t.id) || !byId.has(e.source) || e.source === t.id) continue
    parent.set(t.id, { id: e.source, edge: e.edge, mode: e.dir === 'root' ? 'root' : 'orbit' })
  }
  let roots = nodes.filter((n) => isSeed(n.id))
  if (!roots.length && nodes.length) roots = [nodes[0]]
  for (const n of nodes) if (!roots.includes(n) && !parent.has(n.id)) parent.set(n.id, { id: roots[0].id, edge: '', mode: 'orbit' })
  for (const n of nodes) {   // 순환이 있으면 끊는다
    const seen = new Set<string>(); let c: string | undefined = n.id
    while (c && parent.has(c)) { if (seen.has(c)) { parent.set(n.id, { ...parent.get(n.id)!, id: roots[0].id }); break } seen.add(c); c = parent.get(c)!.id }
  }
  // 미개척지: 출발점 별이 지도에 있을 때만
  const nodeByName = new Map<string, string>()
  for (const n of nodes) for (const k of [n.id, n.name_ko]) if (k) nodeByName.set(norm(k), n.id)
  for (const l of leads) {
    const pid = nodeByName.get(norm(l.from))
    if (pid) parent.set(leadKey(l), { id: pid, edge: l.direction === 'root' ? '본인 발언' : '평론', mode: l.direction === 'root' ? 'root' : 'fog' })
  }

  const kids = new Map<string, { orbit: string[]; root: string[]; fog: string[] }>()
  for (const [c, p] of parent) {
    const k = kids.get(p.id) ?? { orbit: [], root: [], fog: [] }
    k[p.mode].push(c); kids.set(p.id, k)
  }
  const first = (id: string) => byId.get(id)?.first_seen ?? '9'
  for (const k of kids.values()) for (const list of [k.orbit, k.root, k.fog]) list.sort((a, b) => first(a).localeCompare(first(b)) || a.localeCompare(b))

  const isStar = (id: string) => roots.some((r) => r.id === id)
  const orbitR = (pid: string, i: number) => (isStar(pid) ? 2.7 + i * 1.05 : 1.15 + i * 0.6)
  const reach = (id: string): number => (kids.get(id)?.orbit ?? []).reduce((m, k, i) => Math.max(m, orbitR(id, i) + reach(k) * 0.6), 0)
  const fogR = (id: string) => Math.max(reach(id), isStar(id) ? 1.6 : 0.6) + (isStar(id) ? 1.9 : 1.1)

  // 항성 배치: 큰 계부터 가운데, 나머지는 좌우로 번갈아
  const sized = roots.map((r) => ({ r, e: ((kids.get(r.id)?.fog.length ? fogR(r.id) : reach(r.id))) + 1.2 })).sort((a, b) => b.e - a.e)
  const slots: { r: GraphNode; x: number }[] = []
  let left = 0, right = 0
  sized.forEach((s, i) => {
    if (i === 0) { slots.push({ r: s.r, x: 0 }); left = right = s.e; return }
    if (i % 2) { slots.push({ r: s.r, x: right + s.e * 0.85 }); right += s.e * 1.7 } else { slots.push({ r: s.r, x: -(left + s.e * 0.85) }); left += s.e * 1.7 }
  })
  const mid = (right - left) / 2
  const bodies = new Map<string, Body>()
  const blank = () => new THREE.Vector3()
  slots.forEach((s, i) => {
    const plane = new THREE.Quaternion().setFromEuler(new THREE.Euler(((hash(s.r.id) % 100) / 100 - 0.5) * 0.35, 0, (i % 2 ? 1 : -1) * 0.12))
    bodies.set(s.r.id, { id: s.r.id, parent: null, mode: 'orbit', anchor: new THREE.Vector3(s.x - mid, (i % 2 ? 1 : -1) * Math.min(i, 1) * 0.8, 0),
                         offset: blank(), r: 0, w: 0, phase: 0, plane, edge: '' })
  })
  const order: string[] = slots.map((s) => s.r.id)
  const fogRings: System['fogRings'] = []
  for (let qi = 0; qi < order.length; qi++) {
    const pid = order[qi], pb = bodies.get(pid)!, k = kids.get(pid)
    if (!k) continue
    k.orbit.forEach((c, i) => {   // 바깥 궤도일수록 느리게 (케플러 비슷하게)
      const r = orbitR(pid, i)
      bodies.set(c, { id: c, parent: pid, mode: 'orbit', anchor: blank(), offset: blank(), r, w: 0.55 / Math.pow(r, 1.15), phase: (hash(c) % 628) / 100, plane: pb.plane, edge: parent.get(c)!.edge })
      order.push(c)
    })
    const sc = isStar(pid) ? 1 : 0.6
    k.root.forEach((c, i) => {    // 뿌리: 부모 아래로 부채꼴
      const n = k.root.length
      const offset = new THREE.Vector3((i - (n - 1) / 2) * 1.5 * sc, -(4.6 + (i % 2) * 1.3) * sc, 1.2 * sc + ((i % 3) - 1) * 0.4 * sc)
      bodies.set(c, { id: c, parent: pid, mode: 'root', anchor: blank(), offset, r: 0, w: 0, phase: (hash(c) % 628) / 100, plane: pb.plane, edge: parent.get(c)!.edge })
      order.push(c)
    })
    if (k.fog.length) {           // 안개 띠: 가장 바깥에서 아주 천천히
      const r = fogR(pid)
      fogRings.push({ parent: pid, r, plane: pb.plane })
      k.fog.forEach((c, i) => {
        bodies.set(c, { id: c, parent: pid, mode: 'fog', anchor: blank(), offset: blank(), r, w: 0.035, phase: (i / k.fog.length) * Math.PI * 2 + (hash(pid) % 100) / 50, plane: pb.plane, edge: parent.get(c)!.edge })
        order.push(c)
      })
    }
  }
  const extent = Math.max(4, left + right) / 2 + 1
  return { bodies: [...bodies.values()], order, extent, fogRings }
}

function useTex(name: string, thumb?: string | null) {
  const fallback = useMemo(() => { const t = new THREE.CanvasTexture(drawSleeveCanvas(name, '', 256)); t.colorSpace = THREE.SRGBColorSpace; return t }, [name])
  const [tex, setTex] = useState<THREE.Texture>(fallback)
  useEffect(() => {
    const url = proxied(thumb)
    if (!url) return
    let alive = true
    new THREE.TextureLoader().load(url, (t) => { if (alive) { t.colorSpace = THREE.SRGBColorSpace; setTex(t) } })
    return () => { alive = false }
  }, [thumb])
  return tex
}

let glow: THREE.Texture | null = null
function glowTex() {
  if (glow) return glow
  const cv = document.createElement('canvas'); cv.width = cv.height = 256
  const g = cv.getContext('2d')!
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,240,220,0.55)'); grd.addColorStop(0.45, 'rgba(255,220,190,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256)
  glow = new THREE.CanvasTexture(cv)
  return glow
}

type Pos = React.RefObject<Map<string, THREE.Vector3>>

/** 시계: 모든 천체의 현재 위치를 한 곳에서 계산한다 (부모 먼저). 선택 중에는 천천히 돈다. */
function Clock({ sys, pos, slow }: { sys: System; pos: Pos; slow: boolean }) {
  const t = useRef(0), k = useRef(1)
  const byId = useMemo(() => new Map(sys.bodies.map((b) => [b.id, b])), [sys])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const reduce = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  useFrame((_, dt) => {
    k.current = damp(k.current, slow ? 0.12 : 1, 2, dt)
    if (!reduce) t.current += dt * k.current
    for (const id of sys.order) {
      const b = byId.get(id)!
      const v = pos.current.get(id) ?? pos.current.set(id, new THREE.Vector3()).get(id)!
      if (!b.parent) { v.copy(b.anchor); continue }
      const p = pos.current.get(b.parent)!
      if (b.mode === 'root') { v.copy(p).add(b.offset); v.y += Math.sin(t.current * 0.5 + b.phase) * 0.12; continue }
      const a = b.phase + b.w * t.current
      tmp.set(Math.cos(a) * b.r, 0, Math.sin(a) * b.r).applyQuaternion(b.plane)
      v.copy(p).add(tmp)
    }
  }, -1)
  return null
}

/** 대화에서 이 별이 나오면 산호색 고리가 퍼져 나간다 */
function Ping({ r, on }: { r: number; on: boolean }) {
  const m = useRef<THREE.Mesh>(null)
  useFrame((state, dt) => {
    if (!m.current) return
    const k = (state.clock.elapsedTime * 0.8) % 1
    m.current.scale.setScalar(1 + k * 0.9)
    const mat = m.current.material as THREE.MeshBasicMaterial
    mat.opacity = damp(mat.opacity, on ? 0.9 * (1 - k) : 0, 8, dt)
  })
  return (
    <mesh ref={m} position={[0, 0, -0.005]}>
      <ringGeometry args={[r * 1.15, r * 1.28, 64]} />
      <meshBasicMaterial color={ROOT_HEX} transparent opacity={0} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function Star({ n, pos, visible, dim, selected, ping, onSelect, onHover }: {
  n: GraphNode; pos: Pos; visible: boolean; dim: boolean; selected: boolean; ping: boolean; onSelect: () => void; onHover: (on: boolean) => void
}) {
  const g = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const corona = useRef<THREE.Mesh>(null)
  const tex = useTex(n.name_ko || n.id, n.thumb)
  const [hover, setHover] = useState(false)
  const seed = n.role === 'seed'
  const r = starRadius(n)
  const faded = n.reaction === 'dislike' || n.reaction === 'known' || n.next === 'stop'
  const warm = n.reaction === 'like' || n.next === 'more'
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }), [tex])

  useFrame((state, dt) => {
    if (!g.current) return
    const p = pos.current.get(n.id)
    if (p) g.current.position.copy(p)
    const far = p && !selected && !hover ? depthOf(p, state.camera) : 0
    g.current.scale.setScalar(damp(g.current.scale.x, !visible ? 0.001 : hover || selected ? 1.15 : 1 - far * 0.22, 6, dt))
    mat.color.lerp(_c.setScalar(1 - far * 0.55), Math.min(1, dt * 6))
    mat.opacity = damp(mat.opacity, dim ? 0.15 : faded ? 0.4 : 1, 6, dt)
    if (ring.current) {
      const m = ring.current.material as THREE.MeshBasicMaterial
      const pulse = n.next === 'more' ? 0.55 + 0.45 * Math.sin(state.clock.elapsedTime * 3) : 1
      m.opacity = damp(m.opacity, dim ? 0.05 : warm ? 0.9 * pulse : seed ? 0.6 : 0.25, 6, dt)
    }
    if (corona.current) {
      corona.current.scale.setScalar(1 + 0.06 * Math.sin(state.clock.elapsedTime * 1.3))
      const m = corona.current.material as THREE.MeshBasicMaterial
      m.opacity = damp(m.opacity, dim ? 0.1 : 0.75, 4, dt)
    }
  })

  return (
    <group ref={g} scale={0.001}>
      <Billboard>
        {seed && (
          <mesh ref={corona} position={[0, 0, -0.03]}>
            <planeGeometry args={[r * 6.5, r * 6.5]} />
            <meshBasicMaterial map={glowTex()} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        )}
        <Ping r={r} on={ping} />
        <mesh ref={ring} position={[0, 0, -0.01]}>
          <ringGeometry args={[r * 1.05, r * 1.13, 64]} />
          <meshBasicMaterial color={warm ? '#ff8a74' : '#ffffff'} transparent opacity={0.3} toneMapped={false} />
        </mesh>
        <mesh material={mat} onClick={(e) => { e.stopPropagation(); onSelect() }}
              onPointerOver={(e) => { e.stopPropagation(); setHover(true); onHover(true); document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { setHover(false); onHover(false); document.body.style.cursor = '' }}>
          <circleGeometry args={[r, 64]} />
        </mesh>
      </Billboard>
    </group>
  )
}

/** 흐린 별: 아직 안 가 본 곳. 어둡게 가라앉아 있다가, '오늘 밤 여기로'를 고르면 밝아지고 숨 쉬듯 깜빡인다. */
function LeadStar({ l, pos, visible, dim, selected, ping, onSelect }: {
  l: Lead; pos: Pos; visible: boolean; dim: boolean; selected: boolean; ping: boolean; onSelect: () => void
}) {
  const g = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const tex = useTex(l.name_ko || l.name, l.thumb)
  const [hover, setHover] = useState(false)
  const queued = l.status === 'queued'
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: '#9aa0b8' }), [tex])
  const key = leadKey(l)
  useFrame((state, dt) => {
    if (!g.current) return
    const p = pos.current.get(key)
    if (p) g.current.position.copy(p)
    const lit = queued || hover || selected || ping
    const far = p && !lit ? depthOf(p, state.camera) : 0
    g.current.scale.setScalar(damp(g.current.scale.x, !visible ? 0.001 : hover || selected ? 1.3 : queued ? 1.15 : 1 - far * 0.2, 6, dt))
    mat.color.lerp(_c.set(lit ? '#ffffff' : '#8a90a8').multiplyScalar(1 - far * 0.5), Math.min(1, dt * 4))
    mat.opacity = damp(mat.opacity, dim ? 0.1 : lit ? 1 : 0.45, 6, dt)
    const pulse = queued ? 0.55 + 0.45 * Math.sin(state.clock.elapsedTime * 2.4) : 1
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = damp((ring.current.material as THREE.MeshBasicMaterial).opacity, dim ? 0.04 : queued ? 0.95 * pulse : 0.2, 6, dt)
    if (halo.current) (halo.current.material as THREE.MeshBasicMaterial).opacity = damp((halo.current.material as THREE.MeshBasicMaterial).opacity, queued && !dim ? 0.5 * pulse : 0, 4, dt)
  })
  return (
    <group ref={g} scale={0.001}>
      <Billboard>
        <mesh ref={halo} position={[0, 0, -0.03]}>
          <planeGeometry args={[LEAD_R * 6, LEAD_R * 6]} />
          <meshBasicMaterial map={glowTex()} color={l.direction === 'root' ? ROOT_HEX : '#cfe0ff'} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        <Ping r={LEAD_R} on={ping} />
        <mesh ref={ring} position={[0, 0, -0.01]}>
          <ringGeometry args={[LEAD_R * 1.12, LEAD_R * 1.24, 48]} />
          <meshBasicMaterial color={l.direction === 'root' ? ROOT_HEX : '#cfe0ff'} transparent opacity={0.2} toneMapped={false} />
        </mesh>
        <mesh material={mat} onClick={(e) => { e.stopPropagation(); onSelect() }}
              onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}>
          <circleGeometry args={[LEAD_R, 48]} />
        </mesh>
      </Billboard>
    </group>
  )
}

/** 궤도: 부모를 따라다니는 원. 색은 연결 종류. dashed면 안개 띠. */
const CIRCLE = Array.from({ length: 129 }, (_, i) => { const a = (i / 128) * Math.PI * 2; return new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) })
function Ring({ parent, r, plane, color, pos, opacity, dashed = false }: { parent: string; r: number; plane: THREE.Quaternion; color: string; pos: Pos; opacity: number; dashed?: boolean }) {
  const g = useRef<THREE.Group>(null)
  const line = useRef<any>(null)   // eslint-disable-line @typescript-eslint/no-explicit-any
  const points = useMemo(() => CIRCLE.map((v) => v.clone().multiplyScalar(r)), [r])
  useFrame((_, dt) => {
    const p = pos.current.get(parent)
    if (g.current && p) g.current.position.copy(p)
    if (line.current?.material) line.current.material.opacity = damp(line.current.material.opacity, opacity, 5, dt)
  })
  return (
    <group ref={g}>
      <group quaternion={plane}>
        <Line ref={line} points={points} color={color} lineWidth={dashed ? 0.8 : 1.1} transparent opacity={0}
              dashed={dashed} dashSize={0.25} gapSize={0.35} />
      </group>
    </group>
  )
}

/** 두 천체를 잇는 선, 매 프레임 따라간다 (뿌리 줄기, 궤도 밖의 두 번째 연결) */
function Tether({ a, b, color, pos, opacity, dashed = false }: { a: string; b: string; color: string; pos: Pos; opacity: number; dashed?: boolean }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), [])
  const mat = useMemo(() => (dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.16, gapSize: 0.14, transparent: true, opacity: 0 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })), [color, dashed])
  const line = useMemo(() => new THREE.Line(geo, mat), [geo, mat])
  useFrame((_, dt) => {
    const pa = pos.current.get(a), pb = pos.current.get(b)
    if (!pa || !pb) return
    ;(geo.attributes.position.array as Float32Array).set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z]); geo.attributes.position.needsUpdate = true
    if (dashed) line.computeLineDistances()
    mat.opacity = damp(mat.opacity, opacity, 5, dt)
  })
  return <primitive object={line} />
}

/** 이름표: 별 아래 지점을 매 프레임 화면 좌표로 바꿔 캔버스 위 DOM 이름표를 옮긴다 (drei Html보다 안정적) */
function Labels({ items, pos, els }: { items: { id: string; r: number }[]; pos: Pos; els: React.RefObject<Map<string, HTMLDivElement>> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    for (const it of items) {
      const el = els.current?.get(it.id), p = pos.current.get(it.id)
      if (!el || !p) continue
      v.copy(p).addScaledVector(up, -(it.r + 0.3)).project(camera)
      const far = depthOf(p, camera)
      el.style.transform = `translate(-50%, 0) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) scale(${1 - far * 0.15})`
      el.style.filter = `brightness(${1 - far * 0.5})`
      el.style.visibility = v.z > 1 ? 'hidden' : 'visible'
    }
  })
  return null
}

/** 카메라: 선택한 별을 따라간다. 오른쪽 패널이 열려 있으면 화면 왼쪽으로 비켜 보이게 한다. */
/** 카메라 (끌면 궤도계를 돌려 보고, 두 손가락 스크롤은 이동, 핀치는 커서 쪽 확대).
 *  - 별을 고르면: 그 별로 날아가 따라간다(별이 공전하니 계속). 직접 끌면 따라가기를 멈추고 손에 맡긴다.
 *  - 고르지 않았으면: 고른 걸 풀거나 '전체 보기'를 누른 순간에만 처음 시점으로 돌아가고, 그 뒤엔 손을 뗀다.
 *  - 확대·축소: zoom.current(배율, 커서 위치)로 거리를 부드럽게 바꾸고, 커서가 있으면 그 지점이 제자리에 남도록 중심도 옮긴다. */
/** 돌려주는 값: 이미 끝까지 축소한 상태에서 더 축소하려 했으면 true */
export type Zoom = (f: number, at?: { x: number; y: number }) => boolean
/** 화면 기준으로 픽셀만큼 옮긴다 (두 손가락 스크롤) */
export type Pan = (dx: number, dy: number, height: number) => void
function Follow({ sel, pos, shift, home, controls, reset, snap, zoom, pan }: {
  sel: string | null; pos: Pos; shift: boolean; home: number; controls: React.RefObject<OrbitControlsImpl | null>
  reset: number; snap: number; zoom: React.RefObject<Zoom | null>; pan: React.RefObject<Pan | null>
}) {
  const { camera } = useThree()
  useEffect(() => {   // 화면 밖에서: 처음 시점(각도까지)으로 바로 되돌린다
    const c = controls.current
    if (!snap || !c) return
    c.target.set(0, 0, 0)
    camera.position.set(0, home * 0.42, home * 0.9)
    c.update()
  }, [snap]) // eslint-disable-line react-hooks/exhaustive-deps
  const target = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  const st = useRef({ key: '', settling: true, want: home, zoomTo: null as number | null, panTo: null as THREE.Vector3 | null, free: false })
  const key = `${sel}|${shift}|${reset}`
  if (st.current.key !== key) st.current = { key, settling: true, want: sel ? 10 : home, zoomTo: null, panTo: null, free: false }
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const grab = () => { st.current.free = true; st.current.settling = false; st.current.panTo = null }   // 직접 끌면 손에 맡긴다
    c.addEventListener('start', grab)
    return () => c.removeEventListener('start', grab)
  }, [controls])
  useEffect(() => {
    const ax = new THREE.Vector3(), ay = new THREE.Vector3()
    pan.current = (dx, dy, height) => {
      const c = controls.current
      if (!c) return
      const s = st.current
      s.free = true; s.settling = false; s.panTo = null
      const per = (2 * camera.position.distanceTo(c.target) * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2))) / height
      ax.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(dx * per)
      ay.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-dy * per)
      const move = ax.add(ay)
      c.target.add(move); camera.position.add(move)
    }
  }, [camera, controls, pan])
  useEffect(() => {
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), n = new THREE.Vector3()
    zoom.current = (f, at) => {
      const c = controls.current
      if (!c) return false
      const s = st.current
      const d = s.zoomTo ?? camera.position.distanceTo(c.target)
      if (f > 1 && d >= home * 2 - 0.3) return true
      const next = THREE.MathUtils.clamp(d * f, 4, home * 2)
      s.zoomTo = next
      s.settling = false
      const following = !!sel && !s.free
      if (!at || following) return false
      // 커서 아래 지점(중심을 지나 화면과 마주 보는 면)을 구해, 확대 비율만큼 중심을 그쪽으로 당긴다
      camera.getWorldDirection(n)
      plane.setFromNormalAndCoplanarPoint(n, c.target)
      ray.setFromCamera(new THREE.Vector2(at.x, at.y), camera)
      if (!ray.ray.intersectPlane(plane, hit)) return false
      const from = s.panTo ?? c.target.clone()
      s.panTo = from.clone().lerp(hit, 1 - next / d)
      s.free = true
      return false
    }
  }, [camera, controls, home, zoom, sel])
  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const s = st.current
    const p = sel && !s.free ? pos.current.get(sel) : null
    if (s.panTo) {   // 중심과 카메라를 같이 옮긴다 (보는 각도는 그대로)
      const nx = damp(c.target.x, s.panTo.x, 6, dt), ny = damp(c.target.y, s.panTo.y, 6, dt), nz = damp(c.target.z, s.panTo.z, 6, dt)
      camera.position.x += nx - c.target.x; camera.position.y += ny - c.target.y; camera.position.z += nz - c.target.z
      c.target.set(nx, ny, nz)
      if (c.target.distanceTo(s.panTo) < 0.02) s.panTo = null
    }
    if (p || s.settling) {
      target.set(0, 0, 0)
      if (p) target.copy(p)
      if (shift) target.add(right.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(p ? 2.3 : home * 0.2))
      c.target.set(damp(c.target.x, target.x, 4, dt), damp(c.target.y, target.y, 4, dt), damp(c.target.z, target.z, 4, dt))
    }
    const d = camera.position.distanceTo(c.target)
    const goal = s.zoomTo ?? (s.settling ? s.want : null)
    if (goal != null) {
      if (Math.abs(d - goal) < 0.08) { s.zoomTo = null; if (!p) s.settling = false; else if (s.settling && Math.abs(d - s.want) < 0.15) s.settling = false }
      else { const dir = camera.position.clone().sub(c.target).normalize(); camera.position.copy(c.target).addScaledVector(dir, damp(d, goal, 6, dt)) }
    }
    c.update()
  })
  return null
}

export function Board() {
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [cut, setCut] = useState(Number.MAX_SAFE_INTEGER)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [leadSel, setLeadSel] = useState<string | null>(null)
  const notesOpen = false
  const [compareOpen, setCompareOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [focus, setFocus] = useState<Set<string>>(new Set())   // 대화에 나온 이름 (지도에서 깜빡임)
  const controls = useRef<OrbitControlsImpl>(null)
  const [snap, setSnap] = useState(0)                       // 지도를 떠날 때: 각도까지 바로 처음으로
  const [reset, setReset] = useState(0)                     // '전체 보기': 처음 시점으로
  const zoom = useRef<Zoom | null>(null)   // +/− · 핀치 · 두 번 누르기
  const pan = useRef<Pan | null>(null)     // 두 손가락 스크롤
  const [idle, setIdle] = useState(true)   // 한동안 손대지 않으면 천천히 돈다
  const idleT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const poke = () => { setIdle(false); clearTimeout(idleT.current); idleT.current = setTimeout(() => setIdle(true), 6000) }
  const stage = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)   // 올려 둔 별: 이어진 별만 밝힌다
  const [touched, setTouched] = useState(false)                 // 처음 한 번 조작 안내
  const [leave, setLeave] = useState(0)                         // 끝까지 축소한 뒤 더 굴린 양 (0→1이면 판으로 돌아간다)
  const leaveAcc = useRef({ v: 0, t: 0 as ReturnType<typeof setTimeout> | 0 })
  const player = usePlayer()
  // 지도를 떠났다 돌아오면 늘 처음 시점으로 (확대·이동·고른 별을 남겨 두지 않는다)
  useEffect(() => {
    const sec = stage.current?.closest('section')
    if (!sec) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) return
      setSelected(null); setLeadSel(null); setHovered(null); setReset((r) => r + 1); setSnap((r) => r + 1)
    })
    io.observe(sec)
    return () => io.disconnect()
  }, [graph])
  /** 지도에서 판으로: 지금 도는 판의 이야기, 없으면 마지막 판으로 */
  const backToRecords = () => {
    const stories = [...document.querySelectorAll<HTMLElement>('[data-artist]')]
    const playing = stories.find((x) => x.dataset.artist === player.current?.artist)
    ;(playing ?? stories[stories.length - 1])?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  useEffect(() => {
    // 지도 화면에 다 들어왔을 때만 지도가 휠을 받는다 (그 전엔 페이지 스크롤). 트랙패드 핀치(ctrl+휠)는 언제나 확대.
    // 두 손가락 스크롤(그냥 휠) = 이동, 핀치 = 커서 쪽 확대 (Figma·tldraw와 같은 손버릇)
    const el = stage.current
    if (!el) return
    const at = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }
    }
    const engaged = () => { const sec = el.closest('section'); return !sec || sec.getBoundingClientRect().bottom <= window.innerHeight + 4 }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !engaged()) return
      e.preventDefault()
      const k = e.deltaMode === 1 ? 16 : 1
      const dx = e.deltaX * k, dy = e.deltaY * k
      setTouched(true); poke()
      const a = leaveAcc.current
      if (!e.ctrlKey) {
        pan.current?.(dx, dy, el.clientHeight)
        if (a.v) { a.v = 0; setLeave(0) }
        return
      }
      const atLimit = zoom.current?.(Math.exp(THREE.MathUtils.clamp(dy, -60, 60) * 0.012), at(e))
      // 끝까지 축소한 상태에서 더 오므리면: 조금 버티다가 판(이야기)으로 돌아간다. 멈추면 다시 0으로
      if (a.t) clearTimeout(a.t)
      if (!atLimit) { if (a.v) { a.v = 0; setLeave(0) } return }
      a.v = Math.min(1, a.v + Math.min(dy, 40) / 160)
      setLeave(a.v)
      if (a.v >= 1) { a.v = 0; setLeave(0); backToRecords(); return }
      a.t = setTimeout(() => { a.v = 0; setLeave(0) }, 700)
    }
    const onDbl = (e: MouseEvent) => { zoom.current?.(0.5, at(e)); setTouched(true); poke() }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDbl)
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('dblclick', onDbl) }
  })
  const labelEls = useRef(new Map<string, HTMLDivElement>())
  const pos = useRef(new Map<string, THREE.Vector3>())

  const load = useCallback(() => {
    api.graph().then(setGraph)
    api.frontier().then(setLeads).catch(() => setLeads([]))
  }, [])
  useEffect(load, [load])

  // 디깅 도우미(⌘K)에서 오는 신호: 이름 비추기, 새 흐린 별, 그 별로 가기
  const graphRef = useRef(graph); graphRef.current = graph
  const leadsRef = useRef(leads); leadsRef.current = leads
  useEffect(() => {
    const onFocus = (e: Event) => setFocus(new Set(((e as CustomEvent).detail as string[]).map(norm)))
    const onLead = (e: Event) => { const l = (e as CustomEvent).detail as Lead; setLeads((ls) => [...ls.filter((x) => x.id !== l.id), l]) }
    const onGoto = (e: Event) => {
      const name = norm((e as CustomEvent).detail as string)
      const n = graphRef.current?.nodes.find((x) => norm(x.id) === name || (x.name_ko && norm(x.name_ko) === name))
      if (n) { setLeadSel(null); setSelected(n.slug); return }
      const l = leadsRef.current.find((x) => norm(x.name) === name || (x.name_ko && norm(x.name_ko) === name))
      if (l) { setSelected(null); setLeadSel(l.id) }
    }
    window.addEventListener('dig:focus', onFocus); window.addEventListener('dig:lead', onLead); window.addEventListener('dig:goto', onGoto)
    return () => { window.removeEventListener('dig:focus', onFocus); window.removeEventListener('dig:lead', onLead); window.removeEventListener('dig:goto', onGoto) }
  }, [])
  const sys = useMemo(() => (graph ? buildSystem(graph.nodes, graph.edges, leads) : null), [graph, leads])
  const dates = useMemo(() => [...new Set((graph?.nodes ?? []).map((n) => n.first_seen))].sort(), [graph])
  const cutoff = dates[Math.min(cut, dates.length - 1)] ?? ''
  const sel = graph?.nodes.find((n) => n.slug === selected) ?? null
  const lead = leads.find((l) => l.id === leadSel) ?? null
  const queued = leads.filter((l) => l.status === 'queued')
  useAlbumPalette(sel?.thumb ?? lead?.thumb)

  const placed = useMemo(() => new Set(sys?.bodies.map((b) => b.id) ?? []), [sys])
  const neighbors = useMemo(() => {
    if (!graph || !sys) return null
    if (lead) { const b = sys.bodies.find((x) => x.id === leadKey(lead)); return new Set([leadKey(lead), ...(b?.parent ? [b.parent] : [])]) }
    const id = sel?.id ?? hovered   // 고른 별, 없으면 올려 둔 별과 이어진 것만 밝힌다
    if (!id) return null
    const s = new Set([id])
    graph.edges.forEach((e) => { if (e.source === id) s.add(e.target); if (e.target === id) s.add(e.source) })
    sys.bodies.forEach((b) => { if (b.parent === id) s.add(b.id); if (b.id === id && b.parent) s.add(b.parent) })
    return s
  }, [sel, lead, hovered, graph, sys])

  useEffect(() => {
    if (!playing) return
    if (cut >= dates.length - 1) { setPlaying(false); return }
    const t = setTimeout(() => setCut((c) => c + 1), 1100)
    return () => clearTimeout(t)
  }, [playing, cut, dates.length])

  async function setLeadStatus(l: Lead, status: 'open' | 'queued' | 'dismissed') {
    setBusy(true)
    try {
      const x = await api.setLead(l.id, status)
      setLeads((ls) => (status === 'dismissed' ? ls.filter((y) => y.id !== l.id) : ls.map((y) => (y.id === l.id ? { ...y, status: x.status as Lead['status'] } : y))))
      if (status === 'dismissed') setLeadSel(null)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  async function digNow() {
    setMsg(null); setLeadSel(null); setSelected(null)
    setLogOpen(true)                                   // 로그가 먼저 스트림에 붙어야 첫 이벤트를 놓치지 않는다
    await new Promise((r) => setTimeout(r, 400))
    try { await api.digLeads() } catch (e) { setLogOpen(false); setMsg((e as Error).message) }
  }

  if (!graph || !sys) return <div className="flex h-full items-center justify-center text-white/60">불러오는 중…</div>
  if (!graph.nodes.length) return <div className="flex h-full items-center justify-center text-white/60">첫날 밤이 지나면 지도가 생겨요.</div>

  const latest = cutoff === dates[dates.length - 1]
  const shown = (n: GraphNode) => n.first_seen <= cutoff
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const bodyOf = new Map(sys.bodies.map((b) => [b.id, b]))
  const counts = { artists: graph.nodes.filter(shown).length, links: graph.edges.filter((e) => e.date <= cutoff).length }
  const home = Math.max(13, sys.extent * 1.95)
  const tree = new Set(sys.bodies.filter((b) => b.parent && byId.has(b.id)).map((b) => `${b.parent}→${b.id}`))
  const mapLeads = leads.filter((l) => placed.has(leadKey(l)))
  const dimmed = (id: string) => !!neighbors && !neighbors.has(id)
  const followId = lead ? leadKey(lead) : sel?.id ?? null

  return (
    <div ref={stage} className="relative h-full">
      <GravityStars />
      <Canvas className="!absolute inset-0 z-0" camera={{ position: [0, home * 0.42, home * 0.9], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}
              onPointerMissed={() => { setSelected(null); setLeadSel(null) }}>
        <Suspense fallback={null}>
          <Stars radius={70} depth={50} count={2500} factor={3.2} saturation={0} fade speed={0.6} />
          <Clock sys={sys} pos={pos} slow={!!followId} />

          {/* 행성 궤도 */}
          {sys.bodies.filter((b) => b.mode === 'orbit' && b.parent && byId.has(b.id)).map((b) => {
            const lit = !!sel && (sel.id === b.id || sel.id === b.parent)
            const vis = shown(byId.get(b.id)!) && shown(byId.get(b.parent!)!)
            return <Ring key={b.id} parent={b.parent!} r={b.r} plane={b.plane} color={EDGE_HEX[b.edge] ?? '#ffffff'} pos={pos}
                         opacity={!vis ? 0 : lit ? 0.75 : neighbors ? 0.05 : 0.28} />
          })}
          {/* 안개 띠 */}
          {latest && sys.fogRings.map((f) => (
            <Ring key={`fog:${f.parent}`} parent={f.parent} r={f.r} plane={f.plane} color="#cfe0ff" pos={pos} dashed
                  opacity={neighbors && !neighbors.has(f.parent) ? 0.03 : 0.16} />
          ))}
          {/* 뿌리 줄기: 확인된 뿌리는 실선, 아직 안 가 본 뿌리는 점선 */}
          {sys.bodies.filter((b) => b.mode === 'root' && b.parent).map((b) => {
            const isLead = !byId.has(b.id)
            const l = isLead ? mapLeads.find((x) => leadKey(x) === b.id) : null
            const vis = isLead ? latest : shown(byId.get(b.id)!)
            return <Tether key={`root:${b.id}`} a={b.parent!} b={b.id} color={ROOT_HEX} pos={pos} dashed={isLead}
                           opacity={!vis ? 0 : dimmed(b.id) ? 0.05 : isLead ? (l?.status === 'queued' ? 0.8 : 0.3) : 0.7} />
          })}
          {/* 궤도 밖의 두 번째 연결 */}
          {graph.edges.filter((e) => !tree.has(`${e.source}→${e.target}`) && byId.has(e.source) && byId.has(e.target)).map((e, i) => (
            <Tether key={i} a={e.source} b={e.target} color={EDGE_HEX[e.edge] ?? '#ffffff'} pos={pos} dashed
                    opacity={!(shown(byId.get(e.source)!) && shown(byId.get(e.target)!)) ? 0 : neighbors && !(e.source === sel?.id || e.target === sel?.id) ? 0.05 : 0.5} />
          ))}
          {/* 고른 곳으로 가는 길: 안개 띠의 별도 출발점과 선으로 잇는다 */}
          {mapLeads.filter((l) => l.status === 'queued' && bodyOf.get(leadKey(l))?.mode === 'fog').map((l) => (
            <Tether key={`q:${l.id}`} a={bodyOf.get(leadKey(l))!.parent!} b={leadKey(l)} color="#cfe0ff" pos={pos} dashed opacity={dimmed(leadKey(l)) ? 0.05 : 0.7} />
          ))}

          {graph.nodes.map((n) => (
            <Star key={n.id} n={n} pos={pos} visible={shown(n)} dim={dimmed(n.id)} ping={focus.has(norm(n.id)) || (!!n.name_ko && focus.has(norm(n.name_ko)))}
                  selected={sel?.id === n.id} onSelect={() => { setLeadSel(null); setSelected(n.slug) }}
                  onHover={(on) => setHovered((h) => (on ? n.id : h === n.id ? null : h))} />
          ))}
          {mapLeads.map((l) => (
            <LeadStar key={l.id} l={l} pos={pos} visible={latest} dim={dimmed(leadKey(l))} selected={lead?.id === l.id} ping={focus.has(norm(l.name))}
                      onSelect={() => { setSelected(null); setLeadSel(l.id) }} />
          ))}
          {/* 왼쪽 끌기 = 궤도계 돌려 보기(놓으면 관성), 오른쪽·shift 끌기 = 이동, 휠은 위에서 직접. 가만두면 천천히 돈다 */}
          <OrbitControls ref={controls} enableDamping dampingFactor={0.07} enableZoom={false} enablePan screenSpacePanning panSpeed={1}
                         rotateSpeed={0.7} minDistance={4} maxDistance={home * 2} maxPolarAngle={Math.PI * 0.85}
                         autoRotate={idle && !followId} autoRotateSpeed={0.35}
                         onStart={() => { setTouched(true); poke() }} />
          <Labels items={[...graph.nodes.map((n) => ({ id: n.id, r: starRadius(n) })), ...mapLeads.map((l) => ({ id: leadKey(l), r: LEAD_R }))]} pos={pos} els={labelEls} />
          <Follow sel={followId} pos={pos} shift={!!followId || notesOpen} home={home} controls={controls} reset={reset} snap={snap} zoom={zoom} pan={pan} />
        </Suspense>
      </Canvas>

      {/* 별 이름표 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {graph.nodes.map((n) => (
          <div key={n.id} ref={(el) => { if (el) labelEls.current.set(n.id, el); else labelEls.current.delete(n.id) }}
               className={`absolute left-0 top-0 whitespace-nowrap font-semibold text-white transition-opacity duration-300 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)] ${n.role === 'seed' ? 'text-[16px]' : 'text-[13px]'} ${!shown(n) ? 'opacity-0' : dimmed(n.id) ? 'opacity-20' : sel?.id === n.id ? 'opacity-100' : 'opacity-85'}`}>
            {n.name_ko || n.id}
          </div>
        ))}
        {mapLeads.map((l) => (
          <div key={l.id} ref={(el) => { const k = leadKey(l); if (el) labelEls.current.set(k, el); else labelEls.current.delete(k) }}
               className={`absolute left-0 top-0 whitespace-nowrap text-center text-[12px] transition-opacity duration-300 [text-shadow:0_1px_8px_rgba(0,0,0,0.9)] ${!latest ? 'opacity-0' : dimmed(leadKey(l)) ? 'opacity-10' : l.status === 'queued' || lead?.id === l.id ? 'font-semibold text-white opacity-100' : 'text-white/60 opacity-100'}`}>
            {l.name_ko || l.name}
            {l.status === 'queued' && <div className="text-[10px] font-medium text-white/70">오늘 밤 갈 곳</div>}
          </div>
        ))}
      </div>

      {/* 좌상단: 요약과 범례 */}
      {/* 좌상단: 숫자 + 범례. 지도에 그려진 모양 그대로 작은 그림으로 */}
      <div className="pointer-events-none absolute left-5 top-1 z-10 flex h-9 items-center gap-5 [text-shadow:0_1px_8px_rgba(0,0,0,0.85)] lg:left-10">
        <div className="flex items-baseline gap-3.5">
          {([[counts.artists, '아티스트'], [counts.links, '연결'], ...(mapLeads.length ? [[mapLeads.length, '안 가 본 곳']] : [])] as [number, string][]).map(([v, l]) => (
            <span key={l} className="flex items-baseline gap-1">
              <b className="text-[17px] font-black tabular-nums tracking-[-0.03em] text-white">{v}</b>
              <span className="text-[11.5px] text-white/50">{l}</span>
            </span>
          ))}
        </div>
        <span className="hidden h-4 w-px bg-white/15 lg:block" />
        <ul className="hidden items-center gap-4 text-[11.5px] text-white/60 lg:flex">
          {(['본인 발언', '평론', '협업'] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
                <line x1="3" y1="4" x2="19" y2="4" stroke={EDGE_HEX[k]} strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="3" cy="4" r="2.4" fill="#fff" /><circle cx="19" cy="4" r="2.4" fill={EDGE_HEX[k]} />
              </svg>
              {k === '협업' ? '협업·멤버' : EDGE_LABEL[k]}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="#cfe0ff" strokeOpacity=".7" strokeDasharray="2 2" /><circle cx="6" cy="6" r="1.8" fill="#cfe0ff" fillOpacity=".55" /></svg>
            안 가 본 곳
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden><circle cx="5" cy="3" r="2.4" fill="#fff" /><line x1="5" y1="5" x2="5" y2="12" stroke={ROOT_HEX} strokeWidth="1.6" strokeLinecap="round" /><circle cx="5" cy="12" r="1.8" fill={ROOT_HEX} /></svg>
            아래로 뻗으면 뿌리
          </li>
        </ul>
      </div>

      {/* 처음 한 번: 조작 안내 (한 번 만지면 사라진다) */}
      <AnimatePresence>
        {!touched && !leave && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: 1.2 } }} exit={{ opacity: 0 }}
                      className="pointer-events-none absolute left-1/2 top-14 z-10 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-white/10 bg-black/45 px-4 py-2 text-[12.5px] text-white/75 backdrop-blur-xl">
            <span>끌어서 돌려 보기</span><span className="text-white/25">·</span><span>두 손가락으로 이동</span><span className="text-white/25">·</span>
            <span>핀치로 확대</span><span className="text-white/25">·</span><span>두 번 눌러 가까이</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 끝까지 축소한 뒤 더 굴리는 중: 차오르면 판으로 돌아간다 */}
      <AnimatePresence>
        {leave > 0 && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="pointer-events-none absolute left-1/2 top-14 z-20 w-56 -translate-x-1/2 overflow-hidden rounded-full border border-white/15 bg-black/55 px-4 py-2 text-center text-[12.5px] text-white/85 backdrop-blur-xl">
            <div className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${leave * 100}%` }} />
            <span className="relative">↑ 더 오므리면 음악으로 돌아가요</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 우하단: 확대·축소 */}
      <div className="absolute bottom-24 right-5 z-20 flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/40 backdrop-blur-xl lg:right-10">
        {([['확대', 0.75, 'M8 3v10M3 8h10'], ['축소', 1.33, 'M3 8h10']] as const).map(([label, f, d]) => (
          <button key={label} onClick={() => zoom.current?.(f)} aria-label={label} title={`${label} · 핀치로도 돼요`}
                  className="grid h-10 w-10 place-items-center border-b border-white/10 text-white/80 transition last:border-0 hover:bg-white/10 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        ))}
        <button onClick={() => { setSelected(null); setLeadSel(null); setReset((r) => r + 1) }} aria-label="처음 시점으로" title="처음 시점으로"
                className="grid h-10 w-10 place-items-center text-white/80 transition hover:bg-white/10 hover:text-white">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {/* 우상단: 패널 버튼 */}
      <div className="absolute right-5 top-1 flex gap-2 lg:right-10">
        <button onClick={() => window.dispatchEvent(new Event('taste:open'))}
                className="h-9 rounded-full border border-white/20 bg-black/30 px-4 text-[13px] font-medium backdrop-blur transition hover:border-white/50">내 취향</button>
        <button onClick={() => setCompareOpen(true)} className="h-9 rounded-full border border-white/20 bg-black/30 px-4 text-[13px] font-medium backdrop-blur transition hover:border-white/50">지도 겹쳐 보기</button>
        <button onClick={() => { setSelected(null); setLeadSel(null); setReset((r) => r + 1) }} className="h-9 rounded-full border border-white/20 bg-black/30 px-4 text-[13px] font-medium backdrop-blur transition hover:border-white/50">전체 보기</button>
      </div>


      {/* 하단: 오늘 밤 갈 곳 + 시간 */}
      <div className="absolute inset-x-5 bottom-5 mx-auto flex max-w-2xl flex-col gap-2 lg:inset-x-10">
        <AnimatePresence>
          {(queued.length > 0 || msg) && (
            <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
                        className={`flex items-center gap-3 rounded-full border border-white/15 bg-black/45 py-2 pl-5 pr-2 backdrop-blur-xl ${queued.length && !msg ? 'glow-border' : ''}`}>
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: ROOT_HEX }} />
              <div className="min-w-0 flex-1 truncate text-[14px]">
                {msg ?? <>오늘 밤 갈 곳 <b>{queued.length}</b>곳 <span className="text-white/55">· {queued.map((q) => q.name_ko || q.name).join(', ')}</span></>}
              </div>
              {msg
                ? <button onClick={() => setMsg(null)} className="h-9 rounded-full px-4 text-[13px] text-white/70 hover:text-white">닫기</button>
                : <button onClick={digNow} className="h-9 shrink-0 rounded-full bg-white px-4 text-[13px] font-semibold text-black transition hover:scale-[1.02]">지금 찾으러 가기</button>}
            </motion.div>
          )}
        </AnimatePresence>
        {dates.length > 1 && (
          <div className="flex items-center gap-4 rounded-full border border-white/10 bg-black/30 px-4 py-2.5 backdrop-blur-xl">
            <button onClick={() => { if (cut >= dates.length - 1) setCut(0); setPlaying((p) => !p) }} aria-label={playing ? '타임라인 일시정지' : '타임라인 재생'}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-black">
              {playing
                ? <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
                : <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>}
            </button>
            <input type="range" min={0} max={dates.length - 1} value={Math.min(cut, dates.length - 1)} aria-label="타임라인"
                   onChange={(e) => { setPlaying(false); setCut(Number(e.target.value)) }} className="flex-1 accent-white" />
            <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-white/70">
              {new Date(cutoff).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}
      </div>

      <ArtistSheet slug={selected} onClose={() => setSelected(null)} onNavigate={setSelected} />
      <LeadCard lead={lead} busy={busy} onClose={() => setLeadSel(null)}
                onQueue={(q) => lead && setLeadStatus(lead, q ? 'queued' : 'open')} onDismiss={() => lead && setLeadStatus(lead, 'dismissed')} />
      <CompareMaps open={compareOpen} onClose={() => setCompareOpen(false)} />
      <LogDrawer open={logOpen} onClose={() => setLogOpen(false)} date={null} onFinished={load} liveOnly />
    </div>
  )
}
