/** 오늘 밤 큐: 새벽 디깅이 위에서부터 파는 곳 세 칸. 지도 왼쪽 아래의 작은 카드.
 *  찬 칸 = 작은 LP(커버 라벨) + 이름 + 어디서 이어졌는지. 빈 칸 = 번호와 점선 한 줄.
 *  끌어서 순서 바꾸기, LP 뒷면 B면에서 끌어 넣기. 키보드: Space 잡기 → ↑↓ 옮기기 → Space 놓기 / Esc 취소, Delete 빼기. */
import { useEffect, useRef, useState } from 'react'
import { Reorder } from 'motion/react'
import { X } from 'lucide-react'
import { proxied, type Lead } from '../api'

export const MAX_QUEUE = 3
export const LEAD_MIME = 'application/x-crate-lead'

export function Queue({ items, fromName, onChange, onDrop }: {
  items: Lead[]; fromName: (l: Lead) => string; onChange: (ids: string[]) => void; onDrop: (id: string, at: number) => void
}) {
  const [order, setOrder] = useState(items.map((l) => l.id))
  const [grab, setGrab] = useState<{ id: string; from: string[] } | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => { setOrder(items.map((l) => l.id)) }, [items])
  const byId = new Map(items.map((l) => [l.id, l]))
  const focus = (id: string) => requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus())

  const key = (e: React.KeyboardEvent, id: string) => {
    const k = order.indexOf(id)
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (grab?.id === id) { setGrab(null); onChange(order) } else setGrab({ id, from: order })
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && grab?.id === id) {
      e.preventDefault()
      const j = k + (e.key === 'ArrowUp' ? -1 : 1)
      if (j < 0 || j >= order.length) return
      const next = [...order]; [next[k], next[j]] = [next[j], next[k]]; setOrder(next); focus(id)
    } else if (e.key === 'Escape' && grab) { setOrder(grab.from); setGrab(null); focus(id) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onChange(order.filter((x) => x !== id)) }
  }
  const dropProps = (at: number) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(LEAD_MIME)) { e.preventDefault(); setOver(at) } },
    onDragLeave: () => setOver((o) => (o === at ? null : o)),
    onDrop: (e: React.DragEvent) => { const id = e.dataTransfer.getData(LEAD_MIME); setOver(null); if (id) { e.preventDefault(); onDrop(id, at) } },
  })

  return (
    <section className="bar w-[min(300px,calc(100vw-32px))] rounded-[20px] px-2 pb-2 pt-3 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.9)] ring-1 ring-line" aria-labelledby="queue-h">
      <header className="flex items-baseline justify-between px-2.5 pb-2">
        <h2 id="queue-h" className="text-[15px] font-bold tracking-[-0.03em]">오늘 밤 큐</h2>
        <span className="text-[12px] tabular-nums text-fg-3">{order.length} / {MAX_QUEUE}</span>
      </header>
      <Reorder.Group ref={list} axis="y" values={order} onReorder={setOrder} className="grid gap-0.5" aria-label="오늘 밤 큐">
        {order.map((id, k) => {
          const l = byId.get(id)
          if (!l) return null
          const name = l.name_ko || l.name
          return (
            <Reorder.Item key={id} value={id} onDragEnd={() => onChange(order)} data-id={id} tabIndex={0} onKeyDown={(e) => key(e, id)} {...dropProps(k)}
                          aria-label={`${k + 1}번 ${name}, ${fromName(l)}에서`} aria-roledescription="순서를 바꿀 수 있는 항목" aria-pressed={grab?.id === id}
                          whileDrag={{ scale: 1.03, backgroundColor: 'rgb(36 36 40)', boxShadow: '0 18px 36px -14px rgb(0 0 0 / 0.9)' }}
                          className={`group relative flex h-14 cursor-grab items-center gap-3 rounded-[14px] pl-2 pr-1.5 outline-none transition-colors hover:bg-fill-2 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent ${grab?.id === id || over === k ? 'bg-fill-2 ring-[1.5px] ring-accent' : ''}`}>
              <span className="w-4 text-center text-[13px] font-semibold tabular-nums text-fg-3">{k + 1}</span>
              <MiniLP thumb={l.thumb} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] font-semibold">{name}</span>
                <span className="mt-0.5 block truncate text-[12px] text-fg-3">{fromName(l)}에서 · {l.direction === 'root' ? '뿌리' : '곁가지'}</span>
              </span>
              <button onClick={() => onChange(order.filter((x) => x !== id))} onPointerDown={(e) => e.stopPropagation()} aria-label={`${name} 빼기`}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-3 opacity-0 transition hover:bg-white/10 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"><X size={14} /></button>
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      {Array.from({ length: Math.max(0, MAX_QUEUE - order.length) }, (_, n) => order.length + n).map((k) => (
        <div key={k} {...dropProps(k)} aria-label={`${k + 1}번 빈 칸`}
             className={`flex items-center gap-3 rounded-[14px] pl-2 pr-3 transition-all ${over === k ? 'h-14 bg-white/[0.06]' : 'h-10'}`}>
          <span className={`w-4 text-center text-[13px] font-semibold tabular-nums ${over === k ? 'text-fg' : 'text-fg-3/60'}`}>{k + 1}</span>
          <span className={`h-0 flex-1 border-t-[1.5px] border-dashed transition-colors ${over === k ? 'border-accent' : 'border-white/12'}`} />
        </div>
      ))}
    </section>
  )
}

/** 큐 칸의 작은 LP: 검은 판 가운데에 커버 라벨, 스핀들 구멍 */
function MiniLP({ thumb }: { thumb?: string }) {
  return (
    <span className="vinyl relative grid h-10 w-10 shrink-0 place-items-center">
      {thumb ? <img src={proxied(thumb)} alt="" className="h-[18px] w-[18px] rounded-full object-cover" />
             : <span className="h-[18px] w-[18px] rounded-full bg-[rgb(var(--album))] opacity-80" />}
      <span className="absolute h-1 w-1 rounded-full bg-black" />
    </span>
  )
}
