/** 미개척지 카드: 지도의 흐린 별을 누르면 열린다. 왜 이 이름이 지도에 떠 있는지(원문)와, '오늘 밤 여기로'. */
import { AnimatePresence, motion } from 'motion/react'
import { EDGE_HEX, proxied, type Lead } from '../api'
import { GeneratedSleeve } from './SleeveArt'

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

export function LeadCard({ lead, onClose, onQueue, onDismiss, busy }: {
  lead: Lead | null; onClose: () => void; onQueue: (queued: boolean) => void; onDismiss: () => void; busy: boolean
}) {
  return (
    <AnimatePresence>
      {lead && (
        <motion.aside key={lead.id} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      className={`absolute right-5 top-14 z-30 flex max-h-[calc(100%-7rem)] w-[min(400px,calc(100%-2.5rem))] flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/40 backdrop-blur-2xl lg:right-10 ${lead.status === 'queued' ? 'glow-border' : ''}`}>
          <header className="flex items-start gap-4 p-5">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full opacity-80 shadow-lg grayscale-[40%]">
              {lead.thumb ? <img src={proxied(lead.thumb)} alt="" className="h-full w-full object-cover" /> : <GeneratedSleeve name={lead.name} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-white/55">{lead.direction === 'root' ? `뿌리 · ${lead.from}가 영향받은 음악` : `곁가지 · ${lead.from} 근처`}</div>
              <h3 className="mt-0.5 text-[26px] font-black leading-tight tracking-[-0.04em]">{lead.name_ko || lead.name}</h3>
              {lead.name_ko && lead.name_ko !== lead.name && <div className="truncate text-[13px] text-white/60">{lead.name}</div>}
              <div className="mt-1 text-[12px] text-white/45">아직 안 가 본 곳</div>
            </div>
            <button onClick={onClose} aria-label="닫기" className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 pb-2">
            <div className="text-[13px]" style={{ color: lead.direction === 'root' ? EDGE_HEX['본인 발언'] : EDGE_HEX['평론'] }}>{lead.hint}</div>
            {lead.quote && (
              <blockquote className="mt-3 border-l-2 pl-3 text-[16px] leading-relaxed text-white/90"
                          style={{ borderColor: lead.direction === 'root' ? EDGE_HEX['본인 발언'] : EDGE_HEX['평론'] }}>
                “{lead.quote}”
              </blockquote>
            )}
            {lead.url && (
              <a href={lead.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[12px] text-white/45 underline-offset-4 hover:text-white hover:underline">
                출처 {lead.source_name ? `${lead.source_name} · ` : ''}{host(lead.url)}
              </a>
            )}
            <p className="mt-4 text-[13px] leading-relaxed text-white/55">
              {lead.direction === 'root'
                ? `여기로 가면 ${lead.from}의 음악이 어디서 왔는지 거슬러 올라가요. 정말 이어져 있는지 확인하고 나서 지도에 별로 띄워요.`
                : '여기로 가면 이 이름이 정말 이어져 있는지 확인하고, 맞으면 지도에 별로 띄워요.'}
            </p>
            {lead.note && <p className="mt-2 text-[12px] text-white/45">지난번에는 {lead.note}</p>}
          </div>

          <footer className="flex items-center gap-2 border-t border-white/10 p-4">
            <button onClick={() => onQueue(lead.status !== 'queued')} disabled={busy}
                    className={`h-11 flex-1 rounded-full text-[14px] font-semibold transition hover:scale-[1.01] disabled:opacity-40 ${lead.status === 'queued' ? 'border border-white/30 text-white' : 'bg-white text-black'}`}>
              {lead.status === 'queued' ? '갈 곳에서 빼기' : '오늘 밤 여기로'}
            </button>
            <button onClick={onDismiss} disabled={busy} className="h-11 rounded-full px-4 text-[13px] text-white/55 hover:text-white disabled:opacity-40">여긴 괜찮아요</button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
