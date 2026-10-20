import { useState } from 'react'
import { proxied, sleevePalette, type Candidate } from '../api'

/** 앨범아트. 없거나 못 불러오면 '가게 자체 프레스' 타이포그래피 슬리브를 그린다. */
export function SleeveArt({ c, className = '' }: { c: Candidate; className?: string }) {
  const [broken, setBroken] = useState(false)
  const src = proxied(c.track?.thumb)
  if (src && !broken) {
    return <img src={src} alt={`${c.artist} album art`} onError={() => setBroken(true)}
                className={`h-full w-full object-cover ${className}`} draggable={false} />
  }
  return <GeneratedSleeve name={c.artist} sub={c.track?.title ?? c.artist_ko ?? ''} className={className} />
}

export function GeneratedSleeve({ name, sub, className = '' }: { name: string; sub?: string; className?: string }) {
  const [bg, fg, accent] = sleevePalette(name)
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`} style={{ background: bg, color: fg, containerType: 'inline-size' }}>
      <div className="absolute -right-[18%] -top-[18%] aspect-square w-[78%] rounded-full" style={{ background: accent, opacity: 0.9 }} />
      <div className="absolute -right-[4%] -top-[4%] aspect-square w-[50%] rounded-full border-[3px]" style={{ borderColor: fg, opacity: 0.6 }} />
      <div className="absolute inset-x-[8%] bottom-[9%]">
        <div className="font-display text-[clamp(11px,14cqw,48px)] font-black leading-[0.92] tracking-tight break-words">{name}</div>
        {sub && <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] opacity-80">{sub}</div>}
      </div>
      <div className="absolute left-[8%] top-[8%] font-mono text-[9px] uppercase tracking-[0.25em] opacity-70">Digging Press</div>
    </div>
  )
}

/** 3D 크레이트용: 같은 디자인을 캔버스에 그려 텍스처로 쓴다 */
export function drawSleeveCanvas(name: string, sub: string, size = 512): HTMLCanvasElement {
  const [bg, fg, accent] = sleevePalette(name)
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  g.fillStyle = bg; g.fillRect(0, 0, size, size)
  g.fillStyle = accent; g.globalAlpha = 0.9
  g.beginPath(); g.arc(size * 0.78, size * 0.2, size * 0.4, 0, Math.PI * 2); g.fill()
  g.globalAlpha = 0.6; g.strokeStyle = fg; g.lineWidth = size * 0.012
  g.beginPath(); g.arc(size * 0.78, size * 0.2, size * 0.25, 0, Math.PI * 2); g.stroke()
  g.globalAlpha = 1; g.fillStyle = fg
  g.font = `600 ${size * 0.035}px "IBM Plex Mono", monospace`
  g.fillText('DIGGING PRESS', size * 0.08, size * 0.11)
  let fs = size * 0.16
  g.font = `900 ${fs}px Fraunces, "Gowun Batang", serif`
  while (g.measureText(name).width > size * 0.84 && fs > size * 0.06) { fs *= 0.9; g.font = `900 ${fs}px Fraunces, "Gowun Batang", serif` }
  g.fillText(name, size * 0.08, size * 0.84)
  g.font = `400 ${size * 0.035}px "IBM Plex Mono", monospace`; g.globalAlpha = 0.8
  g.fillText(sub.toUpperCase().slice(0, 34), size * 0.08, size * 0.92)
  return cv
}
