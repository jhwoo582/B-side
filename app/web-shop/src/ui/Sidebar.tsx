/** 가게 안내판: 오늘 들어온 판 · 점원 · 취향 지도, 지난 입고, 내 취향 유형 */
import { Disc3, Orbit } from 'lucide-react'
import type { Brief, TasteType } from '../api'
import { Logo, Orb, fmtDate } from './kit'

export function Sidebar({ brief, dates, taste, view, onView, onPickDate, onClerk, onTaste, clerkOpen }: {
  brief: Brief; dates: { date: string; count: number }[]; taste: TasteType | null
  view: 'crate' | 'map'; onView: (v: 'crate' | 'map') => void
  onPickDate: (d: string) => void; onClerk: (say?: string) => void; onTaste: () => void; clerkOpen: boolean
}) {
  return (
    <aside className="hidden w-[256px] shrink-0 flex-col border-r border-line bg-black/20 lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Logo size={24} />
        <span className="text-[16px] font-bold tracking-[-0.03em]">Crate Digging</span>
      </div>

      <nav className="px-3" aria-label="가게">
        <Item icon={<Disc3 size={18} />} label="오늘 들어온 LP" right={<span className="tabular-nums">{brief.candidates.length}</span>} on={view === 'crate'} onClick={() => onView('crate')} />
        <Item icon={<Orb size={18} active={false} />} label="점원에게 묻기" right={<kbd className="rounded-md bg-fill-2 px-1.5 py-0.5 text-[11px] text-fg-3">⌘K</kbd>} on={clerkOpen} onClick={() => onClerk()} />
        <Item icon={<Orbit size={18} />} label="디깅 맵" on={view === 'map'} onClick={() => onView('map')} />
      </nav>

      <div className="scroll-y mt-6 min-h-0 flex-1 px-3">
        <Section title="지난 입고">
          {[...dates].reverse().map((d) => {
            const on = d.date === brief.date
            return (
              <button key={d.date} onClick={() => onPickDate(d.date)} aria-current={on ? 'date' : undefined}
                      className={`flex h-9 w-full items-center justify-between rounded-xl px-3 text-[14px] transition ${on ? 'bg-fill-2 text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg'}`}>
                <span>{fmtDate(d.date, false)}</span>
                <span className="text-[12.5px] tabular-nums text-fg-3">{d.count}장</span>
              </button>
            )
          })}
        </Section>
      </div>

      {taste && (
        <button onClick={onTaste} aria-label={`내 취향 보기: ${taste.name}`} className="m-3 rounded-2xl bg-fill p-4 text-left ring-1 ring-line transition hover:bg-fill-2">
          <div className="flex items-center gap-1">
            {taste.axes.map((a) => (
              <span key={a.key} className={`grid h-8 w-7 place-items-center rounded-lg text-[15px] font-extrabold ${a.known ? 'bg-white text-black' : 'text-fg-3 ring-1 ring-dashed ring-white/25'}`}>{a.letter}</span>
            ))}
          </div>
          <p className="mt-3 text-[14px] font-semibold">{taste.name}</p>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-fg-3">{taste.line}</p>
        </button>
      )}
    </aside>
  )
}

function Item({ icon, label, right, on = false, onClick, href }: { icon: React.ReactNode; label: string; right?: React.ReactNode; on?: boolean; onClick?: () => void; href?: string }) {
  const cls = `flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium transition ${on ? 'bg-fill-2 text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg'}`
  const inner = <><span className={on ? 'text-accent' : ''}>{icon}</span><span className="flex-1 text-left">{label}</span><span className="text-[12.5px] text-fg-3">{right}</span></>
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
    : <button onClick={onClick} aria-current={on ? 'page' : undefined} className={cls}>{inner}</button>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-3 text-[12.5px] font-medium text-fg-3">{title}</h2>
      {children}
    </section>
  )
}
