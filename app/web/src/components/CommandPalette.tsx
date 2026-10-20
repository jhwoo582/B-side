/** 디깅 도우미 (⌘K): 어디서든 불러 묻는다. 뿌리 찾기, 인터뷰 원문, 내 취향 읽기.
 *  답에 나온 별은 지도에서 깜빡이고(dig:focus), 찾은 이름은 바로 흐린 별로 올라가며(dig:lead), 결과를 누르면 지도에서 그 별로 간다(dig:goto). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, postStream, type Lead, type TasteSignal } from '../api'
import { usePlayer, type Signal } from '../player'

interface Source { sid: string; url: string; title: string; quote?: string }
interface Turn { q: string; a: string; sources: Source[]; steps: string[]; found: { name: string; lead?: Lead }[]; error?: string; done: boolean
  signals?: TasteSignal[]; dropped?: string[]; dig?: { direction: string; status: 'running' | 'found' | 'none'; artist?: string } }
/** 도우미가 먼저 말을 걸 때: 지금 듣던 판과 첫 마디 */
export interface Ask { now?: { artist: string; signal?: Signal | null }; opener?: string; say?: string }
const KIND_KO = { like: '좋아함', less: '덜 듣기', mood: '요즘 기분' } as const

const STEP: Record<string, string> = {
  note_taste: '취향 받아 적는 중', dig_now: '새 음악 찾으러 가는 중',
  taste_overview: '지도 읽는 중', artist_page: '기록 보는 중', interview_mentions: '인터뷰 찾는 중',
  web_search: '검색 중', find_in_page: '글 읽는 중', read_page: '글 읽는 중', add_to_map: '지도에 올리는 중', set_tonight: '오늘 밤 갈 곳으로',
}
/** 도우미가 먼저 물을 때의 대답: 문장을 고르게 하지 않고, 좋다/별로 → 어디가(한 단어) 두 번만 누른다.
 *  누른 것은 손님 말투의 짧은 문장으로 바뀌어 도우미에게 간다. */
const ASPECTS: [string, string][] = [['보컬', '이'], ['소리', '가'], ['리듬', '이'], ['분위기', '가'], ['가사', '가']]
export function QuickReact({ signal, onSay }: { signal: Signal; onSay: (text: string) => void }) {
  const [pole, setPole] = useState<'like' | 'less' | null>(null)
  const poles = (signal === 'skip' ? ['less', 'like'] : ['like', 'less']) as ('like' | 'less')[]
  const past = signal === 'full' || signal === 'skip'
  const verb = (p: 'like' | 'less') => (p === 'like' ? (past ? '좋았어요' : '좋아요') : (past ? '별로였어요' : '별로예요'))
  const chip = 'rounded-full border px-3.5 py-1.5 text-[13.5px] transition'
  if (!pole)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {poles.map((p) => (
          <button key={p} onClick={() => setPole(p)} className={`${chip} border-white/20 text-white/85 hover:border-white/50 hover:text-white`}>
            {p === 'like' ? '좋아요' : '별로예요'}
          </button>
        ))}
      </div>
    )
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => setPole(null)} className={`${chip} border-white/50 bg-white/10 text-white`}>{pole === 'like' ? '좋아요' : '별로예요'} ×</button>
      <span className="px-1 text-[12.5px] text-white/40">어디가요?</span>
      {ASPECTS.map(([a, josa]) => (
        <button key={a} onClick={() => onSay(`${a}${josa} ${verb(pole)}`)} className={`${chip} border-white/15 text-white/75 hover:border-white/50 hover:text-white`}>{a}</button>
      ))}
      <button onClick={() => onSay(`전체적으로 ${verb(pole)}`)} className={`${chip} border-white/15 text-white/75 hover:border-white/50 hover:text-white`}>전체적으로</button>
      {pole === 'less' && (
        <button onClick={() => onSay('곡은 괜찮은데 지금은 이런 기분이 아니에요')} className={`${chip} border-white/15 text-white/75 hover:border-white/50 hover:text-white`}>지금 기분</button>
      )}
    </motion.div>
  )
}
/** 듣는 판을 두고 도우미가 꺼내는 첫 마디 */
export const openerFor = (name: string, signal: Signal) => ({
  full: `${name}, 끝까지 들었네요. 어디가 남았어요?`,
  skip: `${name}, 금방 넘겼네요. 어디서 걸렸어요?`,
  listening: `${name}, 들어 보니 어떠세요?`,
}[signal])
const SUGGEST = [
  { q: '요즘은 조용한 게 좋아', hint: '말하면 취향에 적고 다음 추천이 바뀌어요' },
  { q: '내 취향 읽어 줘', hint: '지도를 보고 좋아하는 결을 말해 줘요' },
  { q: 'Silica Gel 뿌리 더 찾아 줘', hint: '인터뷰에서 영향받은 음악' },
  { q: '세이수미가 인터뷰에서 한 말 보여 줘', hint: '그 사람이 한 말 그대로' },
]
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
export const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }))

/** 시리 오브: 에이전트가 찾는 동안 숨 쉬듯 도는 구슬 */
export function Orb({ size = 22, active = true }: { size?: number; active?: boolean }) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 rounded-full ${active ? 'orb-spin' : ''}`}
          style={{ width: size, height: size, background: 'conic-gradient(from 0deg, #ff8f7a, #b48cff, #6fa8ff, #7fe3c4, #ff8f7a)', filter: 'blur(0.3px) saturate(1.2)' }}>
      <span className="absolute inset-[18%] rounded-full bg-[#0b0912]/55 blur-[2px]" />
      <span className={`absolute inset-0 rounded-full ${active ? 'orb-breathe' : ''}`} style={{ boxShadow: '0 0 14px 2px rgba(180,140,255,.55)' }} />
    </span>
  )
}

/** 블러 리빌: 단어가 흐림에서 또렷하게 하나씩 */
function Reveal({ children }: { children: ReactNode[] }) {
  return <>{children.map((c, i) => (
    <motion.span key={i} initial={{ opacity: 0, filter: 'blur(8px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }}
                 transition={{ duration: 0.45, delay: Math.min(i * 0.018, 1.6) }}>{c}</motion.span>
  ))}</>
}

/** **굵게**, [S1] 출처 칩, [지도] 표시를 단어 단위 조각으로 */
function pieces(text: string, sources: Source[]): ReactNode[] {
  const out: ReactNode[] = []
  text.split(/(\*\*[^*]+\*\*|\[S\d+\]|\[지도\])/g).forEach((part, i) => {
    if (!part) return
    const b = part.match(/^\*\*(.+)\*\*$/)
    if (b) { out.push(<b key={`b${i}`} className="font-semibold text-white">{b[1]}</b>); return }
    const s = part.match(/^\[(S\d+)\]$/)
    if (s) {
      const src = sources.find((x) => x.sid === s[1])
      if (src) out.push(
        <a key={`s${i}`} href={src.url} target="_blank" rel="noreferrer" title={src.title || host(src.url)}
           className="mx-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#93b6ff]/20 px-1 align-[2px] text-[10.5px] font-semibold text-[#bcd0ff] no-underline hover:bg-[#93b6ff]/40">
          {s[1].slice(1)}
        </a>)
      return
    }
    if (part === '[지도]') { out.push(<span key={`m${i}`} className="mx-0.5 rounded-full bg-white/10 px-1.5 align-[1px] text-[10.5px] text-white/70">지도</span>); return }
    part.split(/(\s+)/).forEach((w, j) => { if (w) out.push(<span key={`t${i}-${j}`}>{w}</span>) })
  })
  return out
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [ctx, setCtx] = useState<Ask | null>(null)   // 지금 듣던 판 + 도우미의 첫 마디
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as Ask
      setCtx(d); setTurns([])
      if (d.say) setTimeout(() => ask(d.say!, d), 120)
    }
    window.addEventListener('dig:ask', on)
    return () => window.removeEventListener('dig:ask', on)
  })

  const player = usePlayer()
  useEffect(() => {   // 그냥 열었을 때: 지금 도는 판이 있으면 도우미가 그 판 이야기로 먼저 묻는다
    if (!open) return
    setTimeout(() => input.current?.focus(), 60)
    const c = player.current
    if (c && player.playing && turns.length === 0 && ctx?.now?.artist !== c.artist)
      setCtx({ now: { artist: c.artist, signal: 'listening' }, opener: openerFor(c.artist_ko || c.artist, 'listening') })
    if (c) player.markAsked(c.artist)   // 이미 물었으니 40초 뒤 질문은 띄우지 않는다
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [turns])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])

  /** '지금 한 판 더': 리서처가 끝나면 카드가 '찾았어요'로 바뀌고 오늘의 판에 붙는다 */
  function watchDig() {
    const es = new EventSource('/api/run/stream')
    es.addEventListener('run_end', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data)
      if (e.tag !== 'steer') return
      es.close()
      setTurns((ts) => ts.map((t) => (t.dig?.status === 'running' ? { ...t, dig: { ...t.dig, status: e.artist ? 'found' : 'none', artist: e.artist ?? undefined } } : t)))
      if (e.artist) window.dispatchEvent(new Event('brief:reload'))
    })
  }
  async function dropSignal(ti: number, id: string) {
    await api.removeSignal(id).catch(() => {})
    setTurns((ts) => ts.map((t, k) => (k === ti ? { ...t, dropped: [...(t.dropped ?? []), id] } : t)))
    window.dispatchEvent(new Event('taste:changed'))
  }

  async function ask(text: string, c: Ask | null = ctx) {
    const question = text.trim()
    if (!question || busy) return
    setQ(''); setBusy(true)
    const playing = player.current?.artist
    if (playing) player.markAsked(playing, true)   // 손님이 말했다: 이 판을 두고 다시 먼저 묻지 않는다
    const history = [...(c?.opener ? [{ role: 'assistant', content: c.opener }] : []),
      ...turns.filter((t) => t.done && !t.error).flatMap((t) => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }])]
    setTurns((ts) => [...ts, { q: question, a: '', sources: [], steps: [], found: [], done: false }])
    const patch = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])])
    abort.current = new AbortController()
    try {
      await postStream('/api/chat', { messages: [...history, { role: 'user', content: question }], now: c?.now ?? null }, (ev, d) => {
        if (ev === 'signal') { patch((t) => ({ ...t, signals: [...(t.signals ?? []), ...d.signals] })); window.dispatchEvent(new Event('taste:changed')) }
        if (ev === 'digging') { patch((t) => ({ ...t, dig: { direction: d.direction, status: 'running' } })); watchDig() }
        if (ev === 'step') patch((t) => ({ ...t, steps: [...t.steps, STEP[d.tool] ?? '찾는 중'] }))
        if (ev === 'focus') {
          emit('dig:focus', d.names)
          patch((t) => ({ ...t, found: [...t.found, ...d.names.filter((n: string) => !t.found.some((f) => f.name === n)).map((name: string) => ({ name }))] }))
        }
        if (ev === 'lead') {
          emit('dig:lead', d.lead); emit('dig:focus', [d.lead.name])
          patch((t) => ({ ...t, found: [...t.found.filter((f) => f.name !== d.lead.name), { name: d.lead.name, lead: d.lead }] }))
        }
        if (ev === 'answer') patch((t) => ({ ...t, a: d.text, sources: d.sources, done: true }))
        if (ev === 'error') patch((t) => ({ ...t, error: d.error, done: true }))
      }, abort.current.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patch((t) => ({ ...t, error: (e as Error).message, done: true }))
    } finally { setBusy(false); patch((t) => ({ ...t, done: true })) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-[2px]"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div role="dialog" aria-label="도우미" onClick={(e) => e.stopPropagation()}
                      initial={{ y: -12, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -8, scale: 0.98, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      className="flex max-h-[76vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[22px] border border-white/12 bg-[#0d0b15]/90 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
            <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <Orb size={22} active={busy} />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="도우미에게 말하기"
                     placeholder={busy ? '찾는 중이에요…' : ctx?.opener ? '편하게 말해 주세요. 다음 추천이 바뀌어요' : '요즘 듣고 싶은 것, 좋아하는 음악의 뿌리…'}
                     className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-white/35" />
              <kbd className="hidden rounded-md border border-white/15 px-1.5 py-0.5 text-[11px] text-white/45 sm:block">esc</kbd>
            </form>

            <div ref={box} className="flex-1 overflow-y-auto">
              {/* 도우미가 먼저: 지금 듣던 판 이야기로 시작한다 */}
              {ctx?.opener && (
                <div className="border-b border-white/[0.06] px-5 py-4">
                  {ctx.now && <div className="text-[12px] text-white/40">{ctx.now.artist} · {ctx.now.signal === 'full' ? '끝까지 들음' : ctx.now.signal === 'skip' ? '금방 넘김' : '듣는 중'}</div>}
                  <p className="mt-1 text-[16px] font-semibold leading-[1.6]"><Reveal>{pieces(ctx.opener, [])}</Reveal></p>
                  {turns.length === 0 && (
                    <div className="mt-3"><QuickReact signal={ctx.now?.signal ?? 'listening'} onSay={(t) => ask(t)} /></div>
                  )}
                </div>
              )}
              {turns.length === 0 && !ctx?.opener && (
                <div className="p-2">
                  <div className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-white/40">이렇게 물어보세요</div>
                  {SUGGEST.map((s) => (
                    <button key={s.q} onClick={() => ask(s.q)}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.07] focus-visible:bg-white/[0.07]">
                      <span className="text-[14.5px]">{s.q}</span><span className="truncate text-[12.5px] text-white/40">{s.hint}</span>
                    </button>
                  ))}
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className="border-b border-white/[0.06] px-5 py-4 last:border-0">
                  <div className="text-[13px] text-white/50">{t.q}</div>
                  {!t.done && (
                    <div className="mt-3 flex items-center gap-2.5 text-[13.5px] text-white/65">
                      <Orb size={16} />{t.steps[t.steps.length - 1] ?? '생각 중'}…
                    </div>
                  )}
                  {t.error && <div className="mt-2 text-[13.5px] text-[#ff9a8a]">답하지 못했어요. {t.error}</div>}
                  {t.a && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.75] text-white/90"><Reveal>{pieces(t.a, t.sources)}</Reveal></p>}

                  {/* 받아 적은 취향: 맞으면 그대로, 틀리면 바로 지운다 */}
                  {!!t.signals?.length && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="text-[12px] text-white/45">취향에 적었어요 · 다음 추천이 이걸 따라요</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.signals.map((x) => {
                          const gone = t.dropped?.includes(x.id)
                          return (
                            <span key={x.id} className={`inline-flex h-8 items-center gap-1.5 rounded-full pl-3 pr-1.5 text-[13px] ring-1 ${gone ? 'text-white/30 line-through ring-white/10' : x.kind === 'like' ? 'bg-[#ff8f7a]/15 text-[#ffc3b8] ring-[#ff8f7a]/40' : x.kind === 'mood' ? 'bg-[#93b6ff]/15 text-[#c4d6ff] ring-[#93b6ff]/40' : 'bg-white/[0.06] text-white/70 ring-white/20'}`}>
                              <span className="text-[11px] opacity-70">{KIND_KO[x.kind]}</span>{x.text}
                              {!gone && <button onClick={() => dropSignal(i, x.id)} className="rounded-full px-1.5 text-[11px] opacity-60 hover:bg-white/15 hover:opacity-100">아니에요</button>}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {/* 지금 한 판 더 */}
                  {t.dig && (
                    <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      {t.dig.status === 'running' ? <Orb size={20} /> : <span className={`h-2.5 w-2.5 rounded-full ${t.dig.status === 'found' ? 'bg-[#ff8f7a]' : 'bg-white/30'}`} />}
                      <div className="min-w-0 flex-1 text-[13.5px]">
                        {t.dig.status === 'running' && <><div className="text-white/85">이 느낌으로 새 음악을 찾고 있어요 · 1~3분</div><div className="truncate text-[12px] text-white/40">{t.dig.direction}</div></>}
                        {t.dig.status === 'found' && <div className="text-white/90"><b>{t.dig.artist}</b>을(를) 찾아 오늘의 음악에 담았어요</div>}
                        {t.dig.status === 'none' && <div className="text-white/60">이번엔 꼭 맞는 음악을 못 찾았어요. 오늘 밤에 다시 찾아볼게요.</div>}
                      </div>
                      {t.dig.status === 'found' && (
                        <button onClick={() => { const a = t.dig!.artist; onClose(); setTimeout(() => emit('story:open', a), 400) }}
                                className="h-8 shrink-0 rounded-full bg-white px-3 text-[12.5px] font-semibold text-black">들으러 가기</button>
                      )}
                    </div>
                  )}

                  {t.found.length > 0 && t.done && (
                    <div className="mt-3">
                      <div className="pb-1 text-[11.5px] font-medium text-white/40">지도에서 보기</div>
                      {t.found.map((f) => (
                        <button key={f.name} onClick={() => { emit('dig:goto', f.name); onClose() }}
                                className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.07]">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${f.lead ? 'bg-[#ff8f7a]' : 'bg-white/60'}`} />
                            <span className="truncate text-[14px]">{f.name}</span>
                            {f.lead && <span className="shrink-0 rounded-full bg-[#ff8f7a]/15 px-2 py-0.5 text-[11px] text-[#ffb3a5]">새 흐린 별 · {f.lead.direction === 'root' ? '뿌리' : '곁가지'}</span>}
                          </span>
                          <span className="text-[12px] text-white/35">↵</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {t.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.sources.map((s) => (
                        <a key={s.sid} href={s.url} target="_blank" rel="noreferrer"
                           className="flex max-w-[280px] items-center gap-1.5 rounded-full bg-white/[0.07] py-1 pl-1 pr-2.5 text-[11.5px] text-white/65 hover:bg-white/15 hover:text-white">
                          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#93b6ff]/25 text-[10.5px] font-semibold text-[#bcd0ff]">{s.sid.slice(1)}</span>
                          <span className="truncate">{s.title || host(s.url)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-2.5 text-[11.5px] text-white/40">
              <button onClick={() => { onClose(); emit('taste:open', null) }} className="hover:text-white">내 취향 보기 →</button>
              {turns.length > 0 && !busy && <button onClick={() => { setTurns([]); setCtx(null); emit('dig:focus', []) }} className="hover:text-white">새 대화</button>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
