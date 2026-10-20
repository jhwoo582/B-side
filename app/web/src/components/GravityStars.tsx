/** 지도 뒤의 별가루: 천천히 떠다니다 커서 쪽으로 끌려오고, 가까운 것끼리 희미한 별자리 선으로 이어진다 (Gravity Stars). */
import { useEffect, useRef } from 'react'

export function GravityStars({ count = 170 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, raf = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const mouse = { x: -9999, y: -9999 }
    const stars = Array.from({ length: count }, () => ({
      x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.05, vy: (Math.random() - 0.5) * 0.05,
      r: Math.random() * 1.1 + 0.3, tw: Math.random() * Math.PI * 2,
    }))
    const resize = () => {
      const b = cv.getBoundingClientRect()
      w = b.width; h = b.height
      cv.width = w * dpr; cv.height = h * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const s of stars) if (s.x <= 1) { s.x *= w; s.y *= h }
    }
    const move = (e: PointerEvent) => { const b = cv.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top }
    const leave = () => { mouse.x = mouse.y = -9999 }
    resize()
    window.addEventListener('resize', resize); window.addEventListener('pointermove', move); document.addEventListener('pointerleave', leave)

    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000) * 60; last = now
      g.clearRect(0, 0, w, h)
      for (const s of stars) {
        const dx = mouse.x - s.x, dy = mouse.y - s.y, d2 = dx * dx + dy * dy
        if (d2 < 200 * 200 && d2 > 16) { const f = 0.012 / Math.sqrt(d2) * (1 - Math.sqrt(d2) / 200) * 60; s.vx += dx * f * 0.02; s.vy += dy * f * 0.02 }
        s.vx *= 0.985; s.vy *= 0.985
        s.vx += (Math.random() - 0.5) * 0.004; s.vy += (Math.random() - 0.5) * 0.004
        if (!reduce) { s.x += s.vx * dt; s.y += s.vy * dt }
        if (s.x < -10) s.x = w + 10; if (s.x > w + 10) s.x = -10
        if (s.y < -10) s.y = h + 10; if (s.y > h + 10) s.y = -10
        s.tw += 0.03 * dt
      }
      g.lineWidth = 0.6
      for (let i = 0; i < stars.length; i++) {
        const a = stars[i]
        for (let j = i + 1; j < stars.length; j++) {
          const b = stars[j], dx = a.x - b.x, dy = a.y - b.y, d = dx * dx + dy * dy
          if (d < 85 * 85) {
            const near = Math.hypot(mouse.x - a.x, mouse.y - a.y) < 220
            g.strokeStyle = `rgba(200,210,255,${(1 - Math.sqrt(d) / 85) * (near ? 0.28 : 0.08)})`
            g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke()
          }
        }
      }
      for (const s of stars) {
        g.fillStyle = `rgba(235,238,255,${0.35 + 0.45 * (0.5 + 0.5 * Math.sin(s.tw))})`
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave) }
  }, [count])
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
}
