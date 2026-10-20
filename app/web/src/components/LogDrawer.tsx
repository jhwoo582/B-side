/** 영업 일지: 어젯밤 에이전트가 한 일을 재생하고, '지금 디깅'을 누르면 실시간으로 받아 적는다. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type LogEvent } from '../api'

const TOOL_LABEL: Record<string, string> = {
  critic_picks: '평론 확인', check_novelty: '아는 아티스트인지 확인', mb_search_artist: 'MusicBrainz 검색',
  mb_relations: '멤버·소속 확인', mb_collaborations: '공동 크레딧 확인', web_search: '웹 검색', interview_mentions: '인터뷰 검색',
  find_in_page: '글에서 찾기', read_page: '글 읽기', submit_candidate: '찾은 곡 내놓기',
}

function line(e: LogEvent): { icon: string; text: string; tone?: string } | null {
  const a = (e.args ?? {}) as Record<string, any>
  switch (e.kind) {
    case 'run_start': return { icon: '☾', text: '찾으러 나가요', tone: 'head' }
    case 'seeds': return { icon: '◎', text: `출발점: ${(e.seeds as string[]).join(', ')}` }
    case 'think': return { icon: '…', text: String(e.text), tone: 'think' }
    case 'tool': {
      if (e.tool === 'submit_candidate') return null
      const detail = a.query ?? a.name ?? (a.url ? safeHost(a.url) : '') ?? ''
      return { icon: e.status === 'ok' ? '→' : '✕', text: `${TOOL_LABEL[e.tool as string] ?? e.tool} ${String(detail).replace(/^"|"$/g, '')}`, tone: e.status === 'ok' ? undefined : 'err' }
    }
    case 'verify': return { icon: e.verbatim && e.supports ? '✓' : '✕', text: `확인 · ${e.candidate}: ${e.reason}`, tone: e.verbatim && e.supports ? 'ok' : 'err' }
    case 'candidate': return e.status === 'accepted'
      ? { icon: '♪', text: `찾았어요 · ${e.artist} (${e.accepted}번째)`, tone: 'win' }
      : { icon: '↩', text: `놓아줬어요 · ${e.artist}`, tone: 'err' }
    case 'retry': return { icon: '↻', text: `${e.artist} 다시 보는 중` }
    case 'budget_stop': return { icon: '■', text: '오늘은 여기까지 찾았어요', tone: 'err' }
    case 'playlist_created': return { icon: '☀', text: `플레이리스트에 담았어요 · ${e.title} (${e.tracks}곡)`, tone: 'win' }
    case 'run_end': return { icon: '☼', text: `다 찾았어요 · ${e.accepted}곡 담고 ${e.rejected ?? 0}곡 놓아줬어요`, tone: 'head' }
    default: return null
  }
}
const safeHost = (u: string) => { try { return new URL(u).hostname } catch { return u } }
const TONE: Record<string, string> = { head: 'font-semibold text-white', think: 'italic text-white/40', ok: 'text-[#8fe3c4]', err: 'text-[#ff9a8a]', win: 'font-semibold text-white' }

export function LogDrawer({ open, onClose, date, onFinished, liveOnly = false }: { open: boolean; onClose: () => void; date: string | null; onFinished: () => void; liveOnly?: boolean }) {
  const [events, setEvents] = useState<LogEvent[]>([])
  const [shown, setShown] = useState(0)
  const [live, setLive] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !date || live) return
    api.log(date).then((ev) => { setEvents(ev); setShown(0) }).catch(() => setEvents([]))
  }, [open, date, live])

  // 한 줄씩 재생
  useEffect(() => {
    if (!open || shown >= events.length) return
    const t = setTimeout(() => setShown((s) => s + 1), live ? 0 : 45)
    return () => clearTimeout(t)
  }, [open, shown, events.length, live])

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }) }, [shown])

  async function startLive() {
    setErr(null)
    try {
      await api.run(8)
    } catch (e) { setErr((e as Error).message); return }
    watch()
  }

  // 이미 시작된 실행(이어서 파기·말대꾸)을 받아 적기만 한다
  useEffect(() => { if (open && liveOnly && !live) watch() }, [open, liveOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  function watch() {
    setLive(true); setEvents([]); setShown(0)
    const es = new EventSource('/api/run/stream')
    es.onmessage = () => {}
    const add = (ev: MessageEvent) => {
      const e = JSON.parse(ev.data) as LogEvent
      setEvents((xs) => [...xs, e])
      if (e.kind === 'run_end') { es.close(); setLive(false); onFinished() }
    }
    for (const k of ['run_start', 'seeds', 'think', 'tool', 'verify', 'candidate', 'retry', 'budget_stop', 'playlist_created', 'run_end'])
      es.addEventListener(k, add)
    es.onerror = () => { /* 재연결은 브라우저가 한다 */ }
  }

  const lines = events.slice(0, shown).map((e, i) => ({ e, l: line(e), i })).filter((x) => x.l)
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.aside className="m-3 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/45 backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}
                        initial={{ x: 520 }} animate={{ x: 0 }} exit={{ x: 520 }} transition={{ type: 'spring', stiffness: 220, damping: 28 }}>
            <header className="flex items-center justify-between px-6 pb-3 pt-5">
              <h3 className="flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em]">
                밤사이 기록
                {live && <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] font-medium"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff9a8a]" />찾는 중</span>}
              </h3>
              <button onClick={onClose} aria-label="닫기" className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </header>
            <div ref={box} className="flex-1 space-y-1 overflow-y-auto px-6 py-2 font-mono text-[12px] leading-relaxed">
              {!lines.length && <div className="pt-6 text-white/50">{live ? '시작하는 중…' : '이 날의 기록이 없어요.'}</div>}
              {lines.map(({ l, i }) => (
                <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className={`flex gap-2 ${TONE[l!.tone ?? ''] ?? 'text-white/70'}`}>
                  <span className="w-4 shrink-0 text-center">{l!.icon}</span><span className="min-w-0 break-words">{l!.text}</span>
                </motion.div>
              ))}
            </div>
            <footer className="border-t border-white/10 px-6 py-4">
              {err && <div className="mb-2 text-[12px] text-[#ff9a8a]">{err}</div>}
              <button disabled={live} onClick={startLive}
                      className="h-11 w-full rounded-full bg-white text-[14px] font-semibold text-black transition hover:scale-[1.01] disabled:opacity-40">
                {live ? '찾는 중… 몇 분 걸려요' : '지금 다시 찾기'}
              </button>
              <p className="mt-2 text-center text-[12px] text-white/45">매일 새벽 4시, 잠든 사이에 찾아 둘게요.</p>
            </footer>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
