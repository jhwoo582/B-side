/** 판 뒷면: 고른 LP의 트랙리스트. A면 = 그 아티스트에서 찾은 판, B면 = 아직 안 가 본 곳.
 *  줄에 올리면 밑줄과 원문이 뜨고, 커버는 판 뒷면 왼쪽 바깥에 그 줄 높이로 뜬다 (Super Hover List, crafterui).
 *  스크롤해도 멈춘 커서 아래 줄이 활성으로 남는다.
 *  B면 줄은 오늘 밤 큐로 끌어 넣거나 + 버튼으로 넣는다. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { MessageCircle, Plus, X } from 'lucide-react'
import { proxied, type Lead } from '../api'
import { edgeOf } from './kit'
import { LEAD_MIME } from './Queue'
import type { P } from './TasteMap'

export interface SideA { p: P; line?: string }

const ART = 84

export function Sleeve({ seed, a, b, sel, queued, full, onPick, onQueue, onAsk, onClose }: {
  seed: P; a: SideA[]; b: Lead[]; sel: string | null; queued: Set<string>; full: boolean
  onPick: (id: string) => void; onQueue: (l: Lead) => void; onAsk: (say: string) => void; onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [cover, setCover] = useState<{ url: string; x: number; y: number; dim: boolean } | null>(null)
  const hit = () => {
    const el = pointer.current && document.elementFromPoint(pointer.current.x, pointer.current.y)
    const row = el && root.current?.contains(el) ? (el as HTMLElement).closest<HTMLElement>('[data-row]') : null
    setActive(row?.dataset.row ?? null)
    const box = root.current?.closest('aside')?.getBoundingClientRect(), r = row?.getBoundingClientRect()
    setCover(row?.dataset.art && box && r ? { url: row.dataset.art, x: box.left - ART - 14, y: Math.max(box.top, r.top + r.height / 2 - ART / 2), dim: !!row.dataset.dim } : null)
  }
  useEffect(() => { setActive(null) }, [seed.id])
  let n = 0
  const no = () => String(++n).padStart(2, '0')

  return (
    <motion.aside key={seed.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}
                  className="bar flex max-h-full min-h-0 flex-col overflow-hidden rounded-[22px] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] ring-1 ring-line" aria-label={`${seed.name} LP 뒷면`}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        {seed.node?.thumb ? <img src={proxied(seed.node.thumb)} alt="" className="h-11 w-11 shrink-0 rounded-[4px] object-cover ring-1 ring-white/10" /> : <span className="h-11 w-11 shrink-0 rounded-[4px] bg-fill-2" />}
        <p className="min-w-0 flex-1 truncate text-[18px] font-serif font-bold tracking-[-0.02em]">{seed.name}</p>
        <button onClick={onClose} aria-label="닫기" className="grid h-8 w-8 place-items-center rounded-full text-fg-3 hover:bg-fill hover:text-fg"><X size={16} /></button>
      </header>
      <div ref={root} className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-6 font-mono text-[12.5px] [mask-image:linear-gradient(to_bottom,#000_0,#000_90%,transparent)]"
           onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; hit() }}
           onPointerLeave={() => { pointer.current = null; setActive(null); setCover(null) }}
           onScroll={() => requestAnimationFrame(hit)}>
        <Side label="Side A" count={a.length} />
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,6.5rem)_3.25rem]">
          {a.map(({ p, line }) => {
            const on = active === p.id || sel === p.id
            const r = p.node?.reaction
            return (
              <Row key={p.id} id={p.id} on={on} art={p.node?.thumb} line={on ? line : undefined} onClick={() => onPick(p.id)}>
                <span className="tabular-nums opacity-50">{no()}</span>
                <span className="truncate font-medium uppercase">{p.name}</span>
                <span className="flex min-w-0 items-center gap-1.5 truncate font-sans text-[12px] opacity-75"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: edgeOf(p.edge).color }} />{edgeOf(p.edge).label}</span>
                <span className="flex justify-end font-sans text-[12px] tabular-nums">
                  {active === p.id
                    ? <button onClick={(e) => { e.stopPropagation(); onAsk(`${p.name} 같은 결로 더 찾아줘`) }} aria-label={`${p.name} 점원에게 묻기`} className="grid h-6 w-6 place-items-center rounded-full bg-fill-2 text-fg"><MessageCircle size={13} /></button>
                    : r === 'like' ? <span className="text-accent">♥</span> : r === 'dislike' ? <span className="text-fg-3">✕</span> : (p.node?.first_seen ?? '').slice(2, 7).replace('-', '.')}
                </span>
              </Row>
            )
          })}
        </div>
        <Side label="Side B" count={b.length} />
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,6.5rem)_3.25rem]">
          {b.map((l) => {
            const q = queued.has(l.id)
            const id = `lead:${l.id}`
            return (
              <Row key={l.id} id={id} on={active === id || sel === id} art={l.thumb} dim line={active === id || sel === id ? (l.quote ? `“${l.quote}”` : l.hint) : undefined}
                   draggable={!q} onDragStart={(e) => { e.dataTransfer.setData(LEAD_MIME, l.id); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => onPick(id)}
                   className={q ? 'opacity-45' : 'cursor-grab'}>
                <span className="tabular-nums opacity-50">{no()}</span>
                <span className="truncate font-medium uppercase">{l.name_ko || l.name}</span>
                <span className="truncate font-sans text-[12px] opacity-75">{l.direction === 'root' ? '뿌리' : '곁가지'} · {l.kind === 'interview' ? '인터뷰' : '평론'}</span>
                <span className="flex justify-end">
                  <button onClick={(e) => { e.stopPropagation(); if (!q) onQueue(l) }} disabled={q || full} aria-label={`${l.name_ko || l.name} 오늘 밤 큐에 넣기`}
                          className="inline-flex h-6 items-center gap-0.5 rounded-full bg-fill-2 px-2 font-sans text-[11.5px] font-semibold text-fg transition hover:bg-white/15 disabled:bg-transparent disabled:text-fg-3">
                    {q ? '큐' : <><Plus size={12} strokeWidth={2.6} />큐</>}
                  </button>
                </span>
              </Row>
            )
          })}
        </div>
      </div>
      {cover && createPortal(
        <img key={cover.url} src={proxied(cover.url)} alt="" aria-hidden
             className={`pointer-events-none fixed z-50 hidden rounded-[3px] object-cover shadow-[0_20px_40px_-12px_#000] ring-1 ring-white/10 lg:block ${cover.dim ? 'grayscale-[0.6]' : ''}`}
             style={{ left: cover.x, top: cover.y, width: ART, height: ART }} />, document.body)}
    </motion.aside>
  )
}

function Side({ label, count }: { label: string; count: number }) {
  return <p className="mb-1 mt-4 flex justify-between text-[11px] uppercase tracking-[0.14em] text-fg-3"><span>{label}</span><span className="tabular-nums tracking-normal">{count}</span></p>
}

function Row({ id, on, art, line, dim, className = '', children, ...rest }: {
  id: string; on: boolean; art?: string; line?: string; dim?: boolean; className?: string; children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'id'> & { draggable?: boolean }) {
  return (
    <>
      <div data-row={id} data-art={art} data-dim={dim || undefined} {...rest}
           className={`col-span-full grid cursor-default grid-cols-subgrid items-center gap-x-2 border-b py-2 transition-colors ${on ? 'border-current text-fg' : 'border-transparent text-fg-2'} ${className}`}>
        {children}
      </div>
      {line && <p className="col-span-full mb-1 ml-[2.5rem] mt-1.5 font-sans text-[12.5px] leading-[1.55] text-fg-3">{line}</p>}
    </>
  )
}
