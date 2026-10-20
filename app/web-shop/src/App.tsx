/** B-side — 레코드 가게 앱 시안. 기존 웹앱(app/web)과 같은 API를 쓰고 화면만 다르다.
 *  사이드바 | 오늘 들어온 판(칸 탭 · 랙 · 고른 판 상세) | 점원 · 아래엔 재생 바, 펼치면 턴테이블.
 *  레코드샵은 장식이 아니라 구조로: 크레이트의 칸막이 = 칸 탭, 비닐 겉커버, 내 봉투. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, MessageCircle, Orbit, Play, ReceiptText } from 'lucide-react'
import { api, proxied, type Brief, type Candidate, type Feedback, type TasteType } from './api'
import { PlayerProvider, usePlayer } from './player'
import { useAlbumPalette } from './albumColor'
import { Ambient } from './ui/Ambient'
import { Bin } from './ui/Bin'
import { Detail, Spotlight } from './ui/Detail'
import { Sidebar } from './ui/Sidebar'
import { TastePanel } from './ui/TastePanel'
import { LPMap } from './ui/LPMap'
import { Clerk } from './ui/Clerk'
import { Opening, shouldOpen } from './ui/Opening'
import { FullPlayer, PlayerBar } from './ui/NowPlaying'
import { Art, Logo, edgeOf, fmtDate, ko, nameOf, setKoNames } from './ui/kit'
import { groupAt, shelve, type Group } from './ui/groups'

const today = () => new Date().toLocaleDateString('sv-SE')

export default function App() {
  return (
    <PlayerProvider>
      <Shop />
    </PlayerProvider>
  )
}

function Shop() {
  const [issue, setIssue] = useState<string | null>(() => new URLSearchParams(location.search).get('date'))
  const [brief, setBrief] = useState<Brief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dates, setDates] = useState<{ date: string; count: number }[]>([])
  const [taste, setTaste] = useState<TasteType | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string | undefined>>({})
  const [active, setActive] = useState(0)
  const [clerk, setClerk] = useState<{ open: boolean; seed: string | null }>({ open: false, seed: null })
  const [full, setFull] = useState(false)
  const [fly, setFly] = useState<{ src?: string; from: DOMRect; to: DOMRect; id: number } | null>(null)
  const [bagOpen, setBagOpen] = useState(false)
  const [tasteOpen, setTasteOpen] = useState(false)
  const [intro, setIntro] = useState(shouldOpen)
  const [view, setView] = useState<'crate' | 'map'>(() => (location.hash === '#map' ? 'map' : 'crate'))
  useEffect(() => { history.replaceState(null, '', `${location.pathname}${location.search}${view === 'map' ? '#map' : ''}`) }, [view])
  const player = usePlayer()
  const wide = useWide()

  useEffect(() => {
    api.briefs().then((l) => setDates([...l].sort((a, b) => a.date.localeCompare(b.date)))).catch(() => {})
    api.taste().then((t) => setTaste(t.type ?? null)).catch(() => {})
    api.graph().then((g) => { setKoNames(g.nodes.map((n) => [n.id, n.name_ko])); setThumbs(Object.fromEntries(g.nodes.map((n) => [n.id, n.thumb]))) }).catch(() => {})
  }, [])
  const load = useCallback((focus?: string | null) => {
    (issue ? api.brief(issue) : api.latest()).then((b) => {
      setBrief(b); setError(null)
      if (focus) { const i = shelve(b.candidates).items.findIndex((c) => c.artist === focus); if (i >= 0) setActive(i) }
    }).catch((e: Error) => setError(e.message))
  }, [issue])
  useEffect(() => { load() }, [load])

  const { items, groups } = useMemo(() => shelve(brief?.candidates ?? []), [brief])
  const cur: Candidate | undefined = items[Math.min(active, items.length - 1)]
  useAlbumPalette(cur?.track?.thumb)

  const go = useCallback((i: number) => setActive(Math.max(0, Math.min(items.length - 1, i))), [items.length])
  const playActive = useCallback(() => {
    if (!cur) return
    if (player.current?.artist === cur.artist) player.toggle(); else player.play(cur)
  }, [cur, player])
  // 재생 중인 곡이 바뀌면(다음 곡 등) 랙도 그 판으로
  useEffect(() => {
    const i = items.findIndex((c) => c.artist === player.current?.artist)
    if (i >= 0) setActive(i)
  }, [player.current, items])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /input|textarea/i.test((e.target as HTMLElement).tagName)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setClerk((c) => ({ open: !c.open, seed: null })); return }
      if (typing || full || view === 'map') return
      if (e.key === 'ArrowRight') go(active + 1)
      if (e.key === 'ArrowLeft') go(active - 1)
      if (e.key === ' ' || e.key === 'Enter') { if ((e.target as HTMLElement).tagName === 'BUTTON' && e.key === 'Enter') return; e.preventDefault(); playActive() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [active, go, playActive, full, view])

  const pickDate = (d: string) => {
    const latest = d === dates[dates.length - 1]?.date
    history.replaceState(null, '', latest ? location.pathname : `?date=${d}`)
    setIssue(latest ? null : d); setActive(0)
  }
  const saved = (artist: string) => (f: Feedback) =>
    setBrief((b) => b && { ...b, candidates: b.candidates.map((x) => (x.artist === artist ? { ...x, feedback: { ...f, at: today() } } : x)) })
  /** 더 듣고 싶어요: 랙의 판이 봉투로 날아간다 */
  const toBag = () => {
    const a = document.getElementById('rack-active-sleeve')?.getBoundingClientRect()
    const b = document.getElementById('bag')?.getBoundingClientRect()
    if (a && b) setFly({ src: proxied(cur?.track?.thumb), from: a, to: b, id: Date.now() })
  }
  const openClerk = (seed?: string) => setClerk({ open: true, seed: seed ?? null })

  if (error) return <Empty title="가게 문을 열지 못했어요" body={error} hint="API 서버가 꺼져 있으면 MVP 폴더에서 .venv/bin/uvicorn app.api.main:app --port 8000 을 실행한 뒤 새로고침해 주세요." />
  if (!brief) return <div className="grid h-full place-items-center"><Logo size={36} /></div>
  if (!items.length) return <Empty title={`${fmtDate(brief.date)}엔 들어온 LP가 없어요`} body="밤사이 원문으로 확인된 음악을 찾지 못했어요." hint="다음 입고는 내일 새벽 4시예요." />

  const isToday = brief.date === today()
  const hop = cur?.path[0]
  const bag = items.filter((c) => c.feedback?.reaction === 'like')

  return (
    <div className="relative flex h-full flex-col">
      {intro && <Opening brief={brief} picks={items} thumbs={thumbs} onDone={() => setIntro(false)} />}
      <Ambient src={cur?.track?.thumb} />

      <div className="relative z-10 flex min-h-0 flex-1">
        <Sidebar brief={brief} dates={dates} taste={taste} view={view} onView={setView} onPickDate={pickDate} onClerk={openClerk} onTaste={() => setTasteOpen(true)} clerkOpen={clerk.open} />

        {view === 'map' ? (
          <main className="relative min-w-0 flex-1"><LPMap type={taste} onAsk={(say) => openClerk(say)} onBack={() => setView('crate')} /></main>
        ) : (
        <main className="scroll-y relative min-w-0 flex-1">
          {/* 모바일 머리 */}
          <div className="flex h-14 items-center justify-between px-4 lg:hidden">
            <span className="flex items-center gap-2"><Logo size={22} /><span className="text-[15px] font-bold tracking-[-0.03em]">B-side</span></span>
            <span className="flex gap-2"><button onClick={() => setView('map')} aria-label="디깅 맵" className="grid h-9 w-9 place-items-center rounded-full bg-fill"><Orbit size={18} /></button><button onClick={() => openClerk()} aria-label="점원에게 묻기" className="grid h-9 w-9 place-items-center rounded-full bg-fill"><MessageCircle size={18} /></button></span>
          </div>

          <header className="mx-auto flex max-w-[1180px] flex-wrap items-end justify-between gap-4 px-4 pt-4 sm:px-8 lg:pt-10">
            <div>
              {isToday && <p className="text-[13.5px] font-medium text-fg-3">{fmtDate(brief.date)}</p>}
              <h1 className="mt-1 text-[clamp(30px,3.2vw,42px)] font-serif font-bold leading-tight tracking-[-0.03em]">{isToday ? '오늘 들어온 LP' : `${fmtDate(brief.date, false)}에 들어온 LP`}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Bag items={bag} date={brief.date} open={bagOpen} setOpen={setBagOpen} onPick={(c) => { go(items.indexOf(c)); setBagOpen(false); player.play(c) }} />
              <button onClick={() => { setActive(0); player.play(items[0]) }} className="inline-flex h-11 items-center gap-2 rounded-full bg-white pl-4 pr-5 text-[14.5px] font-semibold text-black shadow-[0_10px_30px_-10px_rgb(0_0_0/0.6)] transition hover:scale-[1.02] active:scale-[0.98]">
                <Play size={17} fill="currentColor" />처음부터 듣기
              </button>
            </div>
          </header>

          <Dividers groups={groups} active={active} onPick={go} />

          {/* 첫 화면: 왼쪽 크레이트 + 고른 LP 이름, 오른쪽(넓은 화면) 어디서 왔나 · 원문 · 반응 */}
          <div className="mx-auto grid max-w-[1180px] items-start gap-x-12 min-[1100px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="relative h-[clamp(420px,57vh,660px)]">
                <Bin items={items} groups={groups} active={active} onActive={go} onPlay={(c) => (player.current?.artist === c.artist ? player.toggle() : player.play(c))} />
              </div>
              <div className="-mt-2 px-4 sm:px-8 min-[1100px]:pl-8 min-[1100px]:pr-0">
            <div className="flex items-center justify-between gap-4">
              <button onClick={() => go(active - 1)} disabled={active === 0} aria-label="이전 LP" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fill ring-1 ring-line transition hover:bg-fill-2 disabled:opacity-30"><ChevronLeft size={20} /></button>
              <AnimatePresence mode="wait">
                <motion.div key={cur.artist} className="min-w-0 text-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
                  <p className={`items-center justify-center gap-2 text-[15px] font-medium text-fg-3 ${wide ? 'hidden' : 'flex'}`}>
                    {hop ? <><span className="h-2 w-2 rounded-full" style={{ background: edgeOf(hop.edge).color }} />{ko(hop.from)}에서 · {edgeOf(hop.edge).label}</> : '원래 좋아하던 아티스트의 숨은 곡'}
                  </p>
                  <h2 className="mt-1.5 truncate text-[clamp(28px,2.6vw,36px)] font-serif font-bold leading-tight tracking-[-0.03em]">{nameOf(cur)}</h2>
                  <p className="mt-0.5 truncate text-[15px] text-fg-2">{cur.track?.title}{cur.artist_ko && cur.artist_ko !== cur.artist ? ` · ${cur.artist}` : ''}</p>
                </motion.div>
              </AnimatePresence>
              <button onClick={() => go(active + 1)} disabled={active === items.length - 1} aria-label="다음 LP" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fill ring-1 ring-line transition hover:bg-fill-2 disabled:opacity-30"><ChevronRight size={20} /></button>
            </div>
              </div>
            </div>
            {wide && (
              <div className="min-w-0 pr-8 pt-12">
                <AnimatePresence mode="wait">
                  <motion.div key={`${brief.date}-${cur.artist}-spot`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                    <Spotlight c={cur} date={brief.date} seedThumb={thumbs[cur.path[0]?.from ?? '']} onSaved={saved(cur.artist)} onLiked={toBag} />
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* 아래: 자세히 */}
          <div className="mx-auto max-w-[1180px] px-4 sm:px-8">
            <div className="pb-12 pt-8">
              <AnimatePresence mode="wait">
                <motion.div key={`${brief.date}-${cur.artist}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                  <Detail spotlight={wide} c={cur} date={brief.date} seedThumbs={thumbs} onSaved={saved(cur.artist)} onLiked={toBag} onRetortDone={(a) => a && load(a)} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
        )}

        <AnimatePresence>
          {clerk.open && <Clerk key="clerk" seed={clerk.seed} onClose={() => setClerk({ open: false, seed: null })} onFound={(a) => load(a)} />}
        </AnimatePresence>
      </div>

      <PlayerBar items={items} fallback={cur} onFull={() => setFull(true)} onClerk={() => setClerk((c) => ({ open: !c.open, seed: null }))} onSelect={go} clerkOpen={clerk.open} />
      <AnimatePresence>{full && <FullPlayer items={items} fallback={cur} onClose={() => setFull(false)} />}</AnimatePresence>

      <AnimatePresence>{tasteOpen && <TastePanel onClose={() => setTasteOpen(false)} onAsk={(say) => openClerk(say)} />}</AnimatePresence>

      {/* 영수증으로 날아가는 판 */}
      <AnimatePresence>
        {fly && (
          <motion.img key={fly.id} src={fly.src} alt="" className="pointer-events-none fixed z-[70] rounded-[4px] object-cover shadow-2xl"
                      initial={{ left: fly.from.left, top: fly.from.top, width: fly.from.width, height: fly.from.height, opacity: 1 }}
                      animate={{ left: fly.to.left + 10, top: fly.to.top + 8, width: 24, height: 24, opacity: [1, 1, 0] }}
                      transition={{ duration: 0.7, ease: [0.55, 0, 0.2, 1] }} onAnimationComplete={() => setFly(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

/** 칸 탭: 크레이트의 칸막이. 연결 종류별로 판이 모여 있고, 누르면 그 칸의 첫 판으로 */
function Dividers({ groups, active, onPick }: { groups: Group[]; active: number; onPick: (i: number) => void }) {
  const on = groupAt(groups, active)
  return (
    <nav aria-label="크레이트 칸" className="no-scrollbar mx-auto mt-6 flex max-w-[1180px] gap-1 overflow-x-auto px-4 sm:px-8">
      {groups.map((g) => {
        const here = on?.key === g.key
        return (
          <button key={g.key} onClick={() => onPick(g.start)} aria-current={here ? 'true' : undefined}
                  className={`relative h-9 shrink-0 rounded-full px-3.5 text-[13.5px] font-medium transition-colors ${here ? 'text-fg' : 'text-fg-3 hover:text-fg-2'}`}>
            {here && <motion.span layoutId="divider" className="absolute inset-0 rounded-full bg-fill-2 ring-1 ring-line" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
            <span className="relative inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.color }} />{g.label}
              <span className="tabular-nums text-fg-3">{here ? `${active - g.start + 1}/${g.count}` : g.count}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/** 영수증: 이번에 들어온 판 중 '더 듣고 싶어요'를 누른 판이 한 줄씩 찍힌다 */
function Bag({ items, date, open, setOpen, onPick }: { items: Candidate[]; date: string; open: boolean; setOpen: (o: boolean) => void; onPick: (c: Candidate) => void }) {
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open, setOpen])
  return (
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <motion.button id="bag" key={items.length} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`영수증, ${items.length}장`}
                     animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 0.3, delay: 0.65 }}
                     className="inline-flex h-11 items-center gap-2 rounded-full bg-fill pl-4 pr-3 text-[14.5px] font-semibold ring-1 ring-line backdrop-blur transition hover:bg-fill-2">
        <ReceiptText size={17} />영수증
        <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12px] tabular-nums ${items.length ? 'bg-accent text-black' : 'bg-fill-2 text-fg-3'}`}>{items.length}</span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -12, clipPath: 'inset(0 0 100% 0)' }} animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)' }} exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute right-0 top-[54px] z-50 w-[320px] drop-shadow-[0_30px_50px_rgb(0_0_0/0.7)]">
            {/* 감열지: 아래 가장자리만 톱니 */}
            <div className="bg-[#f4f3f0] px-5 pb-7 pt-5 text-[#141414] [mask:conic-gradient(from_-45deg_at_bottom,#0000,#000_1deg_89deg,#0000_90deg)_bottom/12px_51%_repeat-x,linear-gradient(#000_0_0)_top/100%_calc(100%-6px)_no-repeat]">
              <div className="flex items-baseline justify-between text-[12px] text-black/50">
                <span className="font-semibold text-black">B-side</span><span className="tabular-nums">{date.replace(/-/g, '.')}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-black/50">더 듣고 싶은 음악</p>
              <div className="my-3 border-t border-dashed border-black/30" />
              {items.length === 0 ? (
                <p className="py-2 text-[13.5px] leading-[1.6] text-black/60">아직 찍힌 음악이 없어요. ‘더 듣고 싶어요’를 누르면 여기 한 줄씩 찍혀요.</p>
              ) : (
                <ol className="space-y-1">
                  {items.map((c, k) => (
                    <li key={c.artist}>
                      <button onClick={() => onPick(c)} className="group -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-black/[0.05]">
                        <span className="w-4 text-[12px] tabular-nums text-black/40">{String(k + 1).padStart(2, '0')}</span>
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[3px]"><Art c={c} /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{nameOf(c)}</span><span className="block truncate text-[12px] text-black/50">{c.track?.title}</span></span>
                        <Play size={13} className="shrink-0 text-black/30 transition group-hover:text-black" fill="currentColor" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="my-3 border-t border-dashed border-black/30" />
              <div className="flex items-baseline justify-between text-[13px]"><span className="text-black/55">합계</span><span className="font-bold tabular-nums">{items.length}장</span></div>
              <p className="mt-2 text-[11.5px] leading-[1.5] text-black/45">여기 찍힌 음악에서 오늘 밤 디깅을 출발해요.</p>
              <div aria-hidden className="mx-auto mt-4 h-8 w-[70%] bg-[repeating-linear-gradient(90deg,#141414_0_2px,transparent_2px_4px,#141414_4px_5px,transparent_5px_8px,#141414_8px_11px,transparent_11px_12px)] opacity-85" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Empty({ title, body, hint }: { title: string; body: string; hint: string }) {
  return (
    <main className="mx-auto flex h-full max-w-[560px] flex-col justify-center px-6">
      <Logo size={32} />
      <h1 className="mt-6 text-[28px] font-serif font-bold tracking-[-0.03em]">{title}</h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-fg-2">{body}</p>
      <p className="mt-2 text-[14px] leading-[1.7] text-fg-3">{hint}</p>
    </main>
  )
}

/** 크레이트 옆에 원문을 둘 만큼 넓은가 */
function useWide() {
  const q = '(min-width: 1100px)'
  const [wide, setWide] = useState(() => matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q), f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return wide
}
