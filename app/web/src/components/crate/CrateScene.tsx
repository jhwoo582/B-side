/** 3D 나무 크레이트. 넘긴 판은 앞으로 기울고, 지금 판은 서 있고, 뒤의 판들은 뒤로 살짝 기대 있다. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, RoundedBox, Sparkles, SpotLight } from '@react-three/drei'
import * as THREE from 'three'
import { proxied, type Candidate } from '../../api'
import { drawSleeveCanvas } from '../SleeveArt'

const SIZE = 1
const THICK = 0.014
const GAP = 0.055
const damp = THREE.MathUtils.damp

function useSleeveTexture(c: Candidate) {
  const fallback = useMemo(() => {
    const t = new THREE.CanvasTexture(drawSleeveCanvas(c.artist, c.track?.title ?? ''))
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [c.artist, c.track?.title])
  const [tex, setTex] = useState<THREE.Texture>(fallback)
  useEffect(() => {
    const url = proxied(c.track?.thumb)
    if (!url) return
    let alive = true
    new THREE.TextureLoader().load(url, (t) => {
      if (!alive) return
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      setTex(t)
    })
    return () => { alive = false }
  }, [c.track?.thumb])
  return tex
}

function Record({ c, i, index, picked, count, onClick }: {
  c: Candidate; i: number; index: number; picked: boolean; count: number; onClick: (e: ThreeEvent<MouseEvent>) => void
}) {
  const group = useRef<THREE.Group>(null)
  const born = useRef(performance.now())
  const tex = useSleeveTexture(c)
  const [hover, setHover] = useState(false)
  const reacted = !!c.feedback

  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: reacted ? '#8a7a64' : '#a8977d', roughness: 0.85 })
    const back = new THREE.MeshStandardMaterial({ color: '#4a3d30', roughness: 0.9 })
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.02, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.06 })
    return [side, side, side, side, front, back]
  }, [tex, reacted])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const d = i - index
    // 넘긴 판(d<0)은 앞으로 크게 기울고, 지금 판은 거의 서 있고, 뒤의 판은 뒤로 기댄다
    const tilt = d < 0 ? 1.12 + d * 0.012 : d === 0 ? (hover ? 0.04 : -0.06) : -0.16 - Math.min(d, 6) * 0.004
    // 처음 열 때: 판들이 아래에서 하나씩 꽂힌다 (한 번만 연출하는 순간)
    const arrived = performance.now() - born.current > 350 + i * 70
    const lift = !arrived ? -1.3 : picked ? 4 : d === 0 && hover ? 0.07 : 0
    const front = (Array.isArray((g.children[0] as THREE.Mesh)?.material) ? ((g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[])[4] : null)
    if (front) front.emissiveIntensity = damp(front.emissiveIntensity, d === 0 ? (hover ? 0.32 : 0.14) : 0.04, 6, dt)
    const z = -i * GAP + (d < 0 ? 0.05 : 0)
    g.rotation.x = damp(g.rotation.x, tilt, 9, dt)
    g.position.y = damp(g.position.y, lift, picked ? 5 : 10, dt)
    g.position.z = damp(g.position.z, z + (picked ? 0.9 : 0), 6, dt)
  })

  return (
    <group ref={group} position={[0, -1.3, -i * GAP]}>
      <mesh
        position={[0, SIZE / 2, 0]}
        material={materials}
        castShadow
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}
        renderOrder={count - i}
      >
        <boxGeometry args={[SIZE, SIZE, THICK]} />
      </mesh>
    </group>
  )
}

function Crate({ depth }: { depth: number }) {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a4c2c', roughness: 0.7 }), [])
  const woodDark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 0.85 }), [])
  const W = SIZE + 0.16, T = 0.05, H = 0.5
  const zFront = 0.2, zBack = zFront - depth
  const zMid = (zFront + zBack) / 2
  return (
    <group>
      {/* 바닥 */}
      <RoundedBox args={[W, T, depth]} radius={0.01} position={[0, -T / 2, zMid]} material={woodDark} />
      {/* 옆판 (손잡이 구멍은 생략) */}
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[T, H, depth]} radius={0.012} position={[s * (W / 2 - T / 2), H / 2 - T, zMid]} material={wood} />
      ))}
      {/* 앞판은 낮게: 판이 잘 보이도록 */}
      <RoundedBox args={[W, H * 0.55, T]} radius={0.012} position={[0, (H * 0.55) / 2 - T, zFront]} material={wood} />
      {/* 뒤판 */}
      <RoundedBox args={[W, H * 1.15, T]} radius={0.012} position={[0, (H * 1.15) / 2 - T, zBack]} material={wood} />
      {/* 가로 널빤지 띠 */}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[s * (W / 2 + 0.001), H * 0.35, zMid]} material={woodDark}>
          <boxGeometry args={[0.004, 0.03, depth * 0.98]} />
        </mesh>
      ))}
    </group>
  )
}

/** 스탠드 불빛이 닿는 둥근 바닥: 가장자리로 갈수록 어둠에 녹는다 (직사각형 경계가 안 보이게) */
function Floor() {
  const tex = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256
    const g = cv.getContext('2d')!
    // alphaMap은 밝기(초록 채널)를 투명도로 읽는다 → 흰색(불투명)에서 검정(투명)으로
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256)
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.35, '#999'); grd.addColorStop(0.75, '#222'); grd.addColorStop(1, '#000')
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(cv)
  }, [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.302, -0.35]}>
      <circleGeometry args={[2.2, 64]} />
      <meshStandardMaterial color="#3a2818" roughness={0.9} transparent alphaMap={tex} depthWrite={false} />
    </mesh>
  )
}

/** 크레이트 위 스탠드 조명: 앨범아트 색의 빛줄기 */
function Lamp({ color, playing }: { color: string; playing: boolean }) {
  const light = useRef<THREE.SpotLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  useFrame((state) => {
    if (!light.current) return
    light.current.target = target
    // 판이 돌아가는 동안 33⅓rpm 박자로 은은하게 숨 쉰다
    const beat = playing ? 1 + 0.12 * Math.sin(state.clock.elapsedTime * (Math.PI * 2) / 1.8) : 1
    light.current.intensity = 48 * beat
  })
  return (
    <>
      <primitive object={target} position={[0, 0.1, -0.3]} />
      <SpotLight ref={light} position={[0.2, 2.5, 1.1]} color={color} angle={0.42} penumbra={0.75} distance={5.5}
                 attenuation={3.6} anglePower={4} opacity={0.5} radiusTop={0.06} radiusBottom={1.1} intensity={48} />
    </>
  )
}

function Rig({ index }: { index: number }) {
  // 카메라가 지금 판을 살짝 따라간다 (처음엔 문 앞에서 다가온다)
  useFrame((state, dt) => {
    const z = -index * GAP
    state.camera.position.z = damp(state.camera.position.z, 2.1 + z * 0.55, 2.2, dt)
    state.camera.position.x = damp(state.camera.position.x, state.pointer.x * 0.12, 2, dt)
    state.camera.lookAt(0, 0.3, z * 0.7 - 0.25)
  })
  return null
}

export function CrateScene({ candidates, index, setIndex, picked, onPick, color = '#f2b35e', playing = false }: {
  candidates: Candidate[]; index: number; setIndex: (i: number) => void; picked: number | null; onPick: (i: number) => void
  color?: string; playing?: boolean
}) {
  const depth = candidates.length * GAP + 0.42
  const wheelLock = useRef(0)
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 2.05, 3.4], fov: 34 }}
      gl={{ antialias: true, alpha: true }}
      onWheel={(e) => {
        const now = performance.now()
        if (now - wheelLock.current < 160 || Math.abs(e.deltaY) < 8) return
        wheelLock.current = now
        setIndex(Math.max(0, Math.min(candidates.length - 1, index + Math.sign(e.deltaY))))
      }}
    >
      {/* 밤의 가게: 주변은 어둡고, 크레이트 위 스탠드 하나 + 백열등 반사 + 창밖 푸른 빛 */}
      <ambientLight intensity={0.32} color="#ffd9b0" />
      <Lamp color={color} playing={playing} />
      <pointLight position={[-1.6, 1.2, 1.4]} intensity={3.4} distance={4.5} color="#ffb877" />
      <directionalLight position={[-3, 2, -2]} intensity={0.25} color="#8fa6ff" />
      <Floor />
      <Sparkles count={70} scale={[1.8, 1.6, 1.8]} position={[0.1, 0.9, -0.2]} size={1.6} speed={0.22} opacity={0.55} color={color} />
      <Rig index={index} />
      <group position={[0, -0.25, 0]}>
        <Crate depth={depth} />
        {candidates.map((c, i) => (
          <Record key={c.artist + i} c={c} i={i} index={index} count={candidates.length} picked={picked === i}
                  onClick={(e) => { e.stopPropagation(); if (i === index) onPick(i); else setIndex(i) }} />
        ))}
        <ContactShadows position={[0, -0.051, -depth / 2 + 0.2]} opacity={0.45} scale={4} blur={2.4} far={1.2} color="#3b2412" />
      </group>
    </Canvas>
  )
}
