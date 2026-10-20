/** 점 격자 비주얼라이저 (레퍼런스 17번).
 *  YouTube 재생기의 실제 오디오는 읽을 수 없어서, 곡 진행 시간으로 결정적인 리듬 패턴을 만든다.
 *  재생 중이면 박자에 맞춰 출렁이고, 멈추면 잦아든다. 색은 지금 판의 accent. */
import { useEffect, useRef } from 'react'

export function DotGrid({ playing, cols = 28, rows = 5, bpm = 112, className = '' }: {
  playing: boolean; cols?: number; rows?: number; bpm?: number; className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, energy = 0, t = 0, last = performance.now()
    const color = () => getComputedStyle(document.documentElement).getPropertyValue('--album').trim() || '255 196 170'
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      energy += ((playingRef.current ? 1 : 0.08) - energy) * Math.min(1, dt * 3)
      if (!reduce) t += dt
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
      const beat = (t * bpm) / 60, kick = Math.exp(-((beat % 1) * 6))           // 박마다 튀는 킥
      const cw = w / cols, ch = h / rows, r0 = Math.min(cw, ch) * 0.16
      const c = color()
      for (let x = 0; x < cols; x++) {
        // 열마다 다른 '주파수 대역'처럼: 낮은 열은 킥에, 높은 열은 잔물결에 반응
        const band = x / cols
        const level = energy * (0.25 + 0.55 * kick * (1 - band) + 0.35 * (0.5 + 0.5 * Math.sin(t * (2 + band * 9) + x * 1.7)))
        const lit = level * rows
        for (let y = 0; y < rows; y++) {
          const k = Math.max(0, Math.min(1, lit - (rows - 1 - y)))
          const r = r0 * (1 + k * 1.1)
          g.fillStyle = `rgb(${c} / ${0.14 + k * 0.86})`
          g.beginPath(); g.arc(x * cw + cw / 2, y * ch + ch / 2, r, 0, Math.PI * 2); g.fill()
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [cols, rows, bpm])

  return <canvas ref={ref} aria-hidden className={`block w-full ${className}`} />
}
