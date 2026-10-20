/** 점원: 취향을 말하면 받아 적고, 원하면 지금 한 곡 더 찾아 크레이트에 꽂는다 (/api/chat SSE) */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowUp, X } from 'lucide-react'
import { api, postStream, type TasteSignal } from '../api'
import { usePlayer } from '../player'
import { Orb, hostOf } from './kit'

interface Source { sid: string; url: string; title?: string }
interface Turn {
  q: string; a: string; sources: Source[]; steps: string[]; done: boolean; error?: string
  signals?: TasteSignal[]; dropped?: string[]; dig?: { direction: string; status: 'running' | 'found' | 'none'; artist?: string }
}

const STEP: Record<string, string> = {
  taste_overview: '취향 기록을 보고 있어요', interview_mentions: '인터뷰를 읽고 있어요', web_search: '찾아보고 있어요',
  find_in_page: '글을 읽고 있어요', read_page: '글을 읽고 있어요', add_to_map: '디깅 맵에 올리고 있어요', set_tonight: '오늘 밤 갈 곳을 적고 있어요',
  note_taste: '취향을 받아 적고 있어요', dig_now: '새 음악을 찾으러 가요',
}
const SUGGEST = ['내 취향 어때?', '요즘 시험기간이라 신나는 게 듣고 싶어', '실리카겔이 영향받은 음악은 뭐야?', '세이수미 같은 결로 더 찾아줘']
const KIND = { like: '좋아함', less: '덜 듣기', mood: '요즘' } as const

/** [S1]은 출처 번호 칩으로, [지도]는 지운다 */
function withCites(text: string, sources: Source[]): ReactNode[] {
  return text.split(/(\[S\d+\]|\[지도\])/g).map((part, k) => {
    const m = part.match(/^\[S(\d+)\]$/)
    if (m) {
      const s = sources.find((x) => x.sid === `S${m[1]}`)
      return <a key={k} href={s?.url} target="_blank" rel="noreferrer" className="mx-0.5 inline-grid h-[18px] min-w-[18px] -translate-y-px place-items-center rounded-full bg-white/12 px-1 align-middle text-[10.5px] font-semibold text-fg-2 hover:bg-white/25">{m[1]}</a>
    }
    return part === '[지도]' ? null : <span key={k}>{part}</span>
  })
}

export function Clerk({ onClose, seed, onFound }: { onClose: () => void; seed: string | null; onFound: (artist: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const player = usePlayer()
  const asked = useRef<string | null>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [turns])
  useEffect(() => { if (seed && asked.current !== seed) { asked.current = seed; ask(seed) } }, [seed]) // eslint-disable-line react-hooks/exhaustive-deps

  function watchDig() {
    const es = new EventSource('/api/run/stream')
    es.addEventListener('run_end', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data)
      if (e.tag !== 'steer') return
      es.close()
      setTurns((ts) => ts.map((t) => (t.dig?.status === 'running' ? { ...t, dig: { ...t.dig, status: e.artist ? 'found' : 'none', artist: e.artist ?? undefined } } : t)))
      if (e.artist) onFound(e.artist)
    })
  }

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setQ(''); setBusy(true)
    const history = turns.filter((t) => t.done && !t.error).flatMap((t) => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }])
    setTurns((ts) => [...ts, { q: question, a: '', sources: [], steps: [], done: false }])
    const patch = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])])
    const now = player.current ? { artist: player.current.artist, signal: 'listening' } : null
    try {
      await postStream('/api/chat', { messages: [...history, { role: 'user', content: question }], now }, (ev, d) => {
        if (ev === 'step') patch((t) => ({ ...t, steps: [...t.steps, STEP[d.tool] ?? '찾아보고 있어요'] }))
        if (ev === 'signal') patch((t) => ({ ...t, signals: [...(t.signals ?? []), ...d.signals] }))
        if (ev === 'digging') { patch((t) => ({ ...t, dig: { direction: d.direction, status: 'running' } })); watchDig() }
        if (ev === 'answer') patch((t) => ({ ...t, a: d.text, sources: d.sources ?? [], done: true }))
        if (ev === 'error') patch((t) => ({ ...t, error: d.error, done: true }))
      })
    } catch (e) {
      patch((t) => ({ ...t, error: (e as Error).message, done: true }))
    } finally { setBusy(false); patch((t) => ({ ...t, done: true })) }
  }

  async function drop(ti: number, id: string) {
    await api.removeSignal(id).catch(() => {})
    setTurns((ts) => ts.map((t, k) => (k === ti ? { ...t, dropped: [...(t.dropped ?? []), id] } : t)))
  }

  return (
    <motion.aside aria-label="점원" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                  className="bar fixed inset-0 z-40 flex flex-col border-l border-line lg:static lg:inset-auto lg:w-[400px] lg:shrink-0">
      <header className="flex h-16 items-center gap-3 border-b border-line px-5">
        <Orb size={22} active={turns.some((t) => !t.done)} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">점원</p>
          <p className="truncate text-[12.5px] text-fg-3">말해 주는 취향대로 오늘 밤 디깅이 바뀌어요</p>
        </div>
        <button onClick={onClose} aria-label="닫기" className="grid h-9 w-9 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"><X size={18} /></button>
      </header>

      <div ref={box} className="scroll-y min-h-0 flex-1 px-5 py-5">
        {turns.length === 0 && (
          <div>
            <p className="text-[15px] leading-[1.65] text-fg-2">어떤 음악이 끌리는지, 오늘 음악이 어땠는지 편하게 말해 주세요. 받아 적어 두고 원하면 지금 한 곡 더 찾아올게요.</p>
            <div className="mt-5 space-y-1.5">
              {SUGGEST.map((s) => (
                <button key={s} onClick={() => ask(s)} className="block w-full rounded-2xl bg-fill px-4 py-3 text-left text-[14px] text-fg ring-1 ring-line transition hover:bg-fill-2">{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-6">
          {turns.map((t, i) => (
            <div key={i}>
              <div className="flex justify-end"><p className="max-w-[85%] rounded-[20px] rounded-br-md bg-white/12 px-4 py-2.5 text-[14.5px] leading-[1.55]">{t.q}</p></div>
              <div className="mt-3 flex gap-3">
                <span className="mt-0.5 shrink-0"><Orb size={22} active={!t.done} /></span>
                <div className="min-w-0 flex-1 text-[14.5px] leading-[1.7]">
                  {!t.done && <p className="shimmer">{t.steps[t.steps.length - 1] ?? '생각하고 있어요'}</p>}
                  {t.error && <p className="text-[#fca5a5]">답하지 못했어요. {t.error}</p>}
                  {t.a && <p className="whitespace-pre-wrap text-fg">{withCites(t.a, t.sources)}</p>}
                  {!!t.signals?.length && (
                    <div className="mt-3 rounded-2xl bg-fill p-3 ring-1 ring-line">
                      <p className="text-[12.5px] text-fg-3">취향에 적었어요</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.signals.map((x) => {
                          const gone = t.dropped?.includes(x.id)
                          return (
                            <span key={x.id} className={`inline-flex h-8 items-center gap-1.5 rounded-full pl-3 pr-1 text-[13px] ring-1 ${gone ? 'text-fg-3 line-through ring-line' : 'bg-accent/15 text-fg ring-accent/30'}`}>
                              <span className="text-[11.5px] text-fg-3">{KIND[x.kind]}</span>{x.text}
                              {!gone && <button onClick={() => drop(i, x.id)} className="rounded-full px-2 py-0.5 text-[11.5px] text-fg-3 hover:bg-white/10 hover:text-fg">아니에요</button>}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {t.dig && (
                    <div className="mt-3 rounded-2xl bg-fill p-3 text-[13.5px] ring-1 ring-line">
                      {t.dig.status === 'running' && <><p className="shimmer font-medium">이 느낌으로 새 곡을 찾고 있어요 · 1~3분</p><p className="mt-0.5 truncate text-[12.5px] text-fg-3">{t.dig.direction}</p></>}
                      {t.dig.status === 'found' && <p><b>{t.dig.artist}</b>을(를) 찾아 오늘의 크레이트에 꽂았어요</p>}
                      {t.dig.status === 'none' && <p className="text-fg-2">이번엔 꼭 맞는 곡을 못 찾았어요. 오늘 밤에 다시 찾아볼게요.</p>}
                    </div>
                  )}
                  {t.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.sources.map((s) => (
                        <a key={s.sid} href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-fill py-1 pl-1 pr-2.5 text-[12px] text-fg-2 ring-1 ring-line hover:text-fg">
                          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white/12 text-[10.5px] font-semibold">{s.sid.slice(1)}</span>
                          <span className="truncate">{s.title || hostOf(s.url)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-[22px] bg-fill p-1.5 pl-4 ring-1 ring-line transition focus-within:ring-white/25">
          <textarea ref={input} value={q} onChange={(e) => setQ(e.target.value)} rows={1} maxLength={500} aria-label="점원에게 말하기"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(q) } }}
                    placeholder={busy ? '찾아보는 중이에요' : '요즘 듣고 싶은 것, 좋아하는 음악의 뿌리…'}
                    className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent focus-visible:outline-none py-2 text-[14.5px] leading-[1.5] outline-none [field-sizing:content] placeholder:text-fg-3" />
          <button disabled={!q.trim() || busy} aria-label="보내기" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black transition disabled:bg-fill-2 disabled:text-fg-3">
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </div>
      </form>
    </motion.aside>
  )
}
