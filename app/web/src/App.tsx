import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type Brief } from './api'
import { PlayerProvider, usePlayer } from './player'
import { Story, type Section } from './pages/Story'
import { TrailView } from './pages/TrailView'
import { NowPlaying } from './components/NowPlaying'
import { SilkBackground } from './components/SilkBackground'
import { CommandPalette, Orb } from './components/CommandPalette'
import { Intro } from './components/Intro'
import { TasteNotes } from './components/TasteNotes'

/** 오른쪽 단계 표시: 탭 대신, 하루의 흐름에서 지금 어디쯤인지 */
const STEPS: { id: Section; label: string }[] = [
  { id: 'crate', label: '오늘의 음악' },
  { id: 'listen', label: '듣기' },
  { id: 'map', label: '취향 지도' },
]

export default function App() {
  return (
    <PlayerProvider>
      <Shop />
    </PlayerProvider>
  )
}

function Shop() {
  const [trailDate, setTrailDate] = useState<string | null>(() => location.hash.match(/^#trail\/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [section, setSection] = useState<Section>('crate')
  const [space, setSpace] = useState(0)
  const player = usePlayer()
  const [ask, setAsk] = useState(false)
  const [tasteOpen, setTasteOpen] = useState(false)
  // 어디서든: 취향 노트 열기, 대화로 판이 새로 붙으면 브리프 다시 읽기
  useEffect(() => {
    const open = () => setTasteOpen(true)
    const re = () => api.latest().then(setBrief).catch(() => {})
    const askOpen = () => setAsk(true)   // 도우미가 먼저 말을 걸 때 (dig:ask) 창을 연다
    window.addEventListener('taste:open', open); window.addEventListener('brief:reload', re); window.addEventListener('dig:ask', askOpen)
    return () => { window.removeEventListener('taste:open', open); window.removeEventListener('brief:reload', re); window.removeEventListener('dig:ask', askOpen) }
  }, [])
  // 시작 화면: 페이지를 열 때마다. 공유 링크로 들어오거나, 주소에 ?nointro가 있거나, 움직임 줄이기 설정이면 건너뛴다
  const [intro, setIntro] = useState(() =>
    !trailDate && !new URLSearchParams(location.search).has('nointro') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const endIntro = useCallback(() => setIntro(false), [])
  const go = (id: Section) => { setTrailDate(null); setTimeout(() => window.dispatchEvent(new CustomEvent('story:go', { detail: id })), 30) }

  // ⌘K / Ctrl+K: 디깅 도우미. 결과에서 별을 고르면 지도까지 내려가서 그 별을 연다
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setAsk((o) => !o) } }
    const goto = (e: Event) => {
      const ce = e as CustomEvent & { relayed?: boolean }
      if (ce.relayed) return
      go('map')
      setTimeout(() => { const r = new CustomEvent('dig:goto', { detail: ce.detail }) as CustomEvent & { relayed?: boolean }; r.relayed = true; window.dispatchEvent(r) }, 900)
    }
    window.addEventListener('keydown', key); window.addEventListener('dig:goto', goto)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('dig:goto', goto) }
  }, [])

  const reload = useCallback(() => {
    api.latest().then(setBrief).catch(() => setBrief(null)).finally(() => setLoaded(true))
  }, [])
  useEffect(reload, [reload])
  useEffect(() => { if (!trailDate) history.replaceState(null, '', `#${section}`) }, [section, trailDate])

  return (
    <div className="paper-grain relative h-full">
      {/* 화면 전체 = 지금 판의 색으로 흐르는 실크. 지도로 내려갈수록 우주로 바뀐다 */}
      <SilkBackground playing={player.playing} space={trailDate ? 0 : space} />

      <main className="absolute inset-0 z-10">
        {trailDate ? (
          <div className="h-full pt-[68px]"><TrailView date={trailDate} onExit={() => { setTrailDate(null); reload() }} /></div>
        ) : !loaded ? (
          <div className="flex h-full items-center justify-center text-lg text-white/60">불러오는 중…</div>
        ) : (
          <Story brief={brief} setBrief={setBrief} reload={reload} onSection={setSection} onSpace={setSpace} />
        )}
      </main>

      {/* 간판 뒤 그늘: 스크롤되는 글이 간판과 겹치지 않게 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24 bg-gradient-to-b from-black/55 via-black/25 to-transparent" />
      {/* 간판: 내용 위에 떠 있다 */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-5 pb-2 pt-5 lg:px-10">
        <button onClick={() => go('crate')} className="pointer-events-auto text-[22px] font-extrabold leading-none tracking-[-0.03em] text-white">Crate Digging</button>
        <div className="pointer-events-auto flex items-center gap-3">
          <button onClick={() => setAsk(true)} aria-label="도우미에게 물어보기"
                  className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-black/25 pl-2 pr-3 text-[13px] text-white/75 backdrop-blur transition hover:border-white/40 hover:text-white">
            <Orb size={18} active={false} />물어보기<kbd className="ml-1 rounded border border-white/15 px-1 text-[10.5px] text-white/45">⌘K</kbd>
          </button>
          <MoreMenu onPick={(ev) => { if (ev !== 'taste:open') go(ev === 'open-share' ? 'crate' : section); setTimeout(() => window.dispatchEvent(new Event(ev)), 80) }} />
        </div>
      </header>

      {/* 오른쪽 단계 표시 */}
      {!trailDate && loaded && (
        <nav aria-label="흐름" className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end gap-3 lg:flex">
          {STEPS.map((s) => {
            const on = section === s.id
            return (
              <button key={s.id} onClick={() => go(s.id)} aria-current={on ? 'step' : undefined} className="group flex items-center gap-2.5">
                <span className={`text-[12px] transition ${on ? 'text-white' : 'text-white/0 group-hover:text-white/60'}`}>{s.label}</span>
                <span className={`block w-[3px] rounded-full transition-all duration-300 ${on ? 'h-7 bg-white' : 'h-3 bg-white/30 group-hover:bg-white/60'}`} />
              </button>
            )
          })}
        </nav>
      )}

      {/* 지도까지 내려와도 음악은 계속: 작은 턴테이블 */}
      <AnimatePresence>
        {section === 'map' && player.current && !trailDate && (
          <motion.div className="fixed bottom-5 left-5 z-30 lg:left-10" initial={{ y: 200 }} animate={{ y: 0 }} exit={{ y: 200 }}>
            <NowPlaying compact />
          </motion.div>
        )}
      </AnimatePresence>
      <CommandPalette open={ask} onClose={() => setAsk(false)} />
      <AnimatePresence>{tasteOpen && <TasteNotes onClose={() => setTasteOpen(false)} />}</AnimatePresence>
      {intro && loaded && <Intro brief={brief} onDone={endIntro} />}
      {intro && !loaded && <div className="fixed inset-0 z-[100] bg-[#060509]" />}
    </div>
  )
}

function MoreMenu({ onPick }: { onPick: (ev: 'open-log' | 'open-share' | 'taste:open') => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} aria-label="더보기" aria-expanded={open}
              className="grid h-9 w-9 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><circle cx="4" cy="9" r="1.5" fill="currentColor" /><circle cx="9" cy="9" r="1.5" fill="currentColor" /><circle cx="14" cy="9" r="1.5" fill="currentColor" /></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
                      className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-2xl border border-white/10 bg-black/70 py-1.5 text-[14px] shadow-2xl backdrop-blur-xl">
            {([['open-log', '밤사이 기록'], ['open-share', '오늘 걸어온 길 공유'], ['taste:open', '내 취향']] as const).map(([ev, label]) => (
              <button key={ev} onClick={() => { setOpen(false); onPick(ev) }} className="block w-full px-4 py-2.5 text-left text-white/85 hover:bg-white/10 hover:text-white">{label}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
