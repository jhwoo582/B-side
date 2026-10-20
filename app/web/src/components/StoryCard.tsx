/** 디깅 경로 스토리 카드 (9:16). '나는 이런 사람'이 아니라 '나는 이렇게 여기까지 왔다'를 보여준다. */
import { forwardRef } from 'react'
import { EDGE_HEX, EDGE_LABEL, proxied, sleevePalette } from '../api'

export interface Hop {
  from: string; from_thumb?: string | null; to: string; to_ko?: string | null; to_thumb?: string | null
  edge: string; quote: string; source: string; reaction?: string | null; reply_to?: boolean
}
export interface Trail { date: string; hops: Hop[]; ends: string[] }

function Disc({ src, name, size }: { src?: string | null; name: string; size: number }) {
  const [bg, fg] = sleevePalette(name)
  return src
    ? <img src={proxied(src)} alt="" crossOrigin="anonymous" style={{ width: size, height: size }} className="rounded-full object-cover shadow-[0_4px_12px_rgba(0,0,0,0.45)] ring-1 ring-white/30" />
    : <div style={{ width: size, height: size, background: bg, color: fg }} className="flex items-center justify-center rounded-full text-sm font-black ring-1 ring-white/30">{name.slice(0, 2)}</div>
}

/** 화면 크기 360×640. 저장할 때 3배(1080×1920)로 렌더링한다. 이미지로 구워지므로 색은 CSS 변수 대신 고정값. */
export const StoryCard = forwardRef<HTMLDivElement, { trail: Trail; max?: number }>(({ trail, max = 3 }, ref) => {
  const hops = trail.hops.slice(0, max)
  const date = new Date(trail.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
  return (
    <div ref={ref} style={{ width: 360, height: 640, background: 'radial-gradient(120% 70% at 20% 0%, #4b2a63 0%, #1b1530 45%, #0d0b14 100%)' }}
         className="relative flex flex-col overflow-hidden rounded-2xl px-6 pb-6 pt-7 text-white">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[420px] w-[420px] rounded-full opacity-20"
           style={{ background: 'repeating-radial-gradient(circle, #ffffff 0 1px, transparent 1.5px 5px)' }} />
      <div className="relative">
        <div className="text-[11px] font-medium text-white/60">Crate Digging · {date}</div>
        <div className="mt-1 text-[30px] font-black leading-[1.02] tracking-[-0.04em]">오늘 내가 걸어온 길</div>
      </div>

      <div className="relative mt-5 flex flex-1 flex-col gap-3">
        {hops.map((h, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="flex shrink-0 flex-col items-center">
              <Disc src={h.from_thumb} name={h.from} size={32} />
              <div className="my-0.5 h-5 w-[2px] rounded" style={{ background: EDGE_HEX[h.edge] ?? '#888' }} />
              <Disc src={h.to_thumb} name={h.to} size={46} />
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="truncate text-[10px] text-white/55">{h.from} <span style={{ color: EDGE_HEX[h.edge] }}>· {EDGE_LABEL[h.edge] ?? h.edge}</span></div>
              <div className="mt-1 truncate text-[17px] font-bold leading-tight tracking-[-0.02em]">
                {h.to_ko || h.to}{h.reaction === 'like' && <span className="ml-1 text-[#ff8a74]">♥</span>}
                {h.reply_to && <span className="ml-1.5 rounded-full bg-white/15 px-1.5 py-0.5 align-middle text-[8px] font-semibold">답장</span>}
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] leading-[1.5] text-white/85">“{h.quote}”</div>
              {h.source && <div className="mt-0.5 truncate text-[9px] text-white/45">{h.source}</div>}
            </div>
          </div>
        ))}
        {trail.hops.length > max && <div className="text-[11px] text-white/50">+ {trail.hops.length - max}개 더</div>}
      </div>

      <div className="relative mt-2 flex shrink-0 items-end justify-between border-t border-white/15 pt-3">
        <div className="text-[10px] leading-snug text-white/65">하나하나 이어진 길.<br />모든 연결엔 출처가 있어요.</div>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full" style={{ background: 'radial-gradient(circle, #ff8a74 0 30%, #111 32%)' }} />
          <span className="text-[13px] font-black tracking-[-0.02em]">Crate Digging</span>
        </div>
      </div>
    </div>
  )
})
StoryCard.displayName = 'StoryCard'
