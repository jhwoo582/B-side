/** 고른 판의 상세. 박스 없이 타이포와 얇은 선으로만 나눈다.
 *  위: 어디서 왔나(경로 · 점원 메모) | 원문(크게)
 *  아래: 반응 → 다르게 찾아 달라고 하기 → 같은 음악을 다룬 다른 글 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, ArrowUpRight, Check, ChevronDown, Heart, ShieldCheck, ThumbsDown } from 'lucide-react'
import { api, ASPECTS, ASPECT_LABEL, proxied, type Candidate, type Feedback, type LogEvent, type Reaction } from '../api'
import { Art, clerkLine, edgeOf, hostOf, ko, nameOf, unquote } from './kit'

/** 첫 화면 오른쪽(넓은 화면): 어디서 이어졌는지 한 줄 · 원문 · 반응. 크레이트 옆에서 '왜 이 LP가 왔는지'를 바로 보여 준다 */
export function Spotlight({ c, date, seedThumb, onSaved, onLiked }: {
  c: Candidate; date: string; seedThumb?: string; onSaved: (f: Feedback) => void; onLiked: () => void
}) {
  const hop = c.path[0], edge = edgeOf(hop?.edge)
  return (
    <div className="flex flex-col gap-7">
      {hop ? (
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-fill-2 text-[14px] font-semibold ring-1 ring-white/15">
            {seedThumb ? <img src={proxied(seedThumb)} alt="" className="h-full w-full object-cover" /> : ko(hop.from).slice(0, 1)}
          </span>
          <span className="relative h-px w-16 shrink-0" style={{ background: `linear-gradient(90deg, ${edge.color}40, ${edge.color})` }}>
            <span className="absolute -right-0.5 -top-[3px] h-[7px] w-[7px] rotate-45 border-r border-t" style={{ borderColor: edge.color }} />
          </span>
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-white/15"><Art c={c} /></span>
          <span className="min-w-0 pl-1">
            <span className="block truncate text-[15px] font-semibold">{ko(hop.from)}에서</span>
            <span className="block text-[13px] font-medium" style={{ color: edge.color }}>{edge.label}</span>
          </span>
        </div>
      ) : <Label>원래 좋아하던 아티스트의 숨은 곡</Label>}
      {c.kind === 'hidden_track' ? <Shelf c={c} /> : <Quote c={c} bare />}
      <span className="h-px bg-line" />
      <Reactions c={c} date={date} onSaved={onSaved} onLiked={onLiked} stacked />
    </div>
  )
}

/** spotlight = 첫 화면 오른쪽에 원문·반응이 이미 있다 → 아래에는 경로 자세히 · 점원 메모 · 다르게 찾기 · 다른 글만 */
export function Detail({ c, date, seedThumbs, onSaved, onRetortDone, onLiked, spotlight = false }: {
  c: Candidate; date: string; seedThumbs: Record<string, string | undefined>
  onSaved: (f: Feedback) => void; onRetortDone: (artist: string | null) => void; onLiked: () => void; spotlight?: boolean
}) {
  const hidden = c.kind === 'hidden_track'
  if (spotlight) return (
    <div>
      {!hidden && (c.why_by !== 'template' || c.reply_to || c.from_chat) && clerkLine(c) && (
        <div className="grid gap-5 border-t border-line pt-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-20">
          <h3 className="text-[20px] font-serif font-bold tracking-[-0.025em]">점원 메모</h3>
          <div>
            {c.reply_to && <Said label="말대꾸에 답해 다시 찾은 음악" said={c.reply_to.objection} />}
            {c.from_chat && <Said label="대화에서 듣고 찾아온 음악" said={c.from_chat.said} />}
            <p className="text-[16px] leading-[1.75] text-fg">{clerkLine(c)}</p>
          </div>
        </div>
      )}
      {!hidden && <Row><Retort c={c} date={date} onDone={onRetortDone} /></Row>}
      {!hidden && !!c.more_evidence?.length && <Row><More c={c} /></Row>}
    </div>
  )
  return (
    <div>
      <div className="grid gap-12 border-t border-line pt-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-20">
        <Origin c={c} seedThumb={seedThumbs[c.path[0]?.from ?? '']} />
        {hidden ? <Shelf c={c} /> : <Quote c={c} />}
      </div>
      <Row><Reactions c={c} date={date} onSaved={onSaved} onLiked={onLiked} /></Row>
      {!hidden && <Row><Retort c={c} date={date} onDone={onRetortDone} /></Row>}
      {!hidden && !!c.more_evidence?.length && <Row><More c={c} /></Row>}
    </div>
  )
}

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-12 border-t border-line pt-8">{children}</div>
const Label = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] font-medium text-fg-3">{children}</p>

// ---------------------------------------------------------------- 어디서 왔나

function Origin({ c, seedThumb }: { c: Candidate; seedThumb?: string }) {
  const hop = c.path[0]
  const edge = edgeOf(hop?.edge)
  const note = clerkLine(c)
  return (
    <div>
      <Label>어디서 왔나</Label>
      {c.reply_to && <Said label="말대꾸에 답해 다시 찾은 음악" said={c.reply_to.objection} />}
      {c.from_chat && <Said label="대화에서 듣고 찾아온 음악" said={c.from_chat.said} />}
      {hop ? (
        <ol className="relative mt-5">
          <span aria-hidden className="absolute bottom-5 left-[17px] top-5 w-px" style={{ background: `linear-gradient(${edge.color}55, ${edge.color})` }} />
          <Stop img={seedThumb ? <img src={proxied(seedThumb)} alt="" className="h-full w-full object-cover" /> : <span>{hop.from.slice(0, 1)}</span>} round name={ko(hop.from)} sub="원래 좋아하던 아티스트" />
          <li className="py-4 pl-[52px]">
            <p className="text-[13px] font-semibold" style={{ color: edge.color }}>{edge.label}</p>
            {hop.connection && <p className="mt-1 text-[14px] leading-[1.6] text-fg-2">{hop.connection}</p>}
          </li>
          <Stop img={<Art c={c} />} name={nameOf(c)} sub="오늘 들어온 LP" />
        </ol>
      ) : (
        <p className="mt-4 text-[15px] leading-[1.6] text-fg-2">원래 좋아하던 아티스트의, 최근 들은 기록에 없는 곡이에요.</p>
      )}
      {note && hop && (
        <div className="mt-8">
          <Label>점원 메모</Label>
          <p className="mt-2 text-[15.5px] leading-[1.7] text-fg">{note}</p>
        </div>
      )}
    </div>
  )
}

function Stop({ img, name, sub, round = false }: { img: React.ReactNode; name: string; sub: string; round?: boolean }) {
  return (
    <li className="relative flex items-center gap-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden bg-fill-2 text-[14px] font-semibold ring-1 ring-white/10 ${round ? 'rounded-full' : 'rounded-[4px]'}`}>{img}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{name}</span>
        <span className="block text-[12.5px] text-fg-3">{sub}</span>
      </span>
    </li>
  )
}

function Said({ label, said }: { label: string; said: string }) {
  return <p className="mt-3 text-[14px] text-fg-2"><span className="text-accent">{label}</span> · “{said}”</p>
}

// ---------------------------------------------------------------- 원문

function Quote({ c, bare = false }: { c: Candidate; bare?: boolean }) {
  const [open, setOpen] = useState(false)
  const claim = c.claims[0]
  if (!claim) return null
  const ex = (c.sources?.find((s) => s.kind === '근거 원문') ?? c.sources?.[0])?.excerpt
  const quote = unquote(ex?.quote ?? claim.quote)
  const v = claim.verify
  const who = [c.display?.speaker, c.display?.role].filter(Boolean).join(', ')
  return (
    <figure>
      {!bare && <Label>원문</Label>}
      <blockquote className={`${bare ? 'text-[clamp(20px,1.7vw,24px)]' : 'mt-4 text-[clamp(21px,2vw,29px)]'} font-serif font-medium leading-[1.6] tracking-[-0.025em] [text-wrap:pretty]`}>
        <span className="text-fg-3">“</span>{quote}<span className="text-fg-3">”</span>
      </blockquote>
      <AnimatePresence initial={false}>
        {open && ex && (
          <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden">
            <span className="mt-5 block border-l border-line pl-5 text-[14.5px] leading-[1.85] text-fg-3">
              {ex.before && <>…{ex.before} </>}<span className="text-fg">{unquote(ex.quote)}</span>{ex.after && <> {ex.after}…</>}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
      <figcaption className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-fg-2">
        {who && <span className="font-medium text-fg">{who}</span>}
        <a href={claim.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 transition hover:text-fg">
          {hostOf(claim.source_url)}{claim.source_type ? ` ${claim.source_type.trim()}` : ''}<ArrowUpRight size={14} />
        </a>
        {v?.verbatim && v.supports && (
          <span title={v.reason} className="inline-flex items-center gap-1 text-[#86efac]"><ShieldCheck size={14} />원문과 글자까지 확인</span>
        )}
        {ex && (ex.before || ex.after) && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-0.5 text-fg-3 transition hover:text-fg">
            앞뒤 문맥<ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------- 숨은 곡

function Shelf({ c }: { c: Candidate }) {
  const shelf = c.track?.shelf ?? []
  return (
    <div>
      <Label>{c.artist} 인기곡</Label>
      <p className="mt-4 text-[clamp(21px,2vw,29px)] font-semibold leading-[1.45] tracking-[-0.04em]">{clerkLine(c)}</p>
      <ol className="mt-6 divide-y divide-line border-y border-line">
        {shelf.map((s, k) => {
          const picked = s.title === c.track?.title
          return (
            <li key={s.title} className="flex items-center gap-4 py-3">
              <span className="w-4 text-right text-[12.5px] tabular-nums text-fg-3">{k + 1}</span>
              <span className={`min-w-0 flex-1 truncate text-[15px] ${picked ? 'font-semibold text-fg' : s.heard ? 'text-fg-3' : 'text-fg-2'}`}>{s.title}</span>
              <span className={`shrink-0 text-[12.5px] ${picked ? 'font-semibold text-accent' : 'text-fg-3'}`}>{picked ? '오늘 고른 곡' : s.heard ? '들은 곡' : '아직 안 들음'}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- 반응

export const REACTIONS: { r: Reaction; label: string; reply: string; Icon: typeof Heart }[] = [
  { r: 'like', label: '더 듣고 싶어요', reply: '영수증에 찍어 뒀어요. 오늘 밤엔 여기서 출발해요.', Icon: Heart },
  { r: 'known', label: '이미 알아요', reply: '아는 아티스트로 적어 두고, 다음부턴 빼고 찾을게요.', Icon: Check },
  { r: 'dislike', label: '별로예요', reply: '이 아티스트는 다시 가져오지 않을게요.', Icon: ThumbsDown },
]

/** 랙의 슬리브 모서리에 붙는 작은 표시 */
export function Sticker({ r, className = '' }: { r: Reaction; className?: string }) {
  const x = REACTIONS.find((y) => y.r === r)!
  const tone = r === 'like' ? 'bg-accent text-black' : r === 'known' ? 'bg-white text-black' : 'bg-neutral-700 text-white'
  return (
    <span aria-label={x.label} className={`grid h-8 w-8 place-items-center rounded-full shadow-lg ring-2 ring-black/40 ${tone} ${className}`}>
      <x.Icon size={15} strokeWidth={2.4} fill={r === 'like' ? 'currentColor' : 'none'} />
    </span>
  )
}

function Reactions({ c, date, onSaved, onLiked, stacked = false }: { c: Candidate; date: string; onSaved: (f: Feedback) => void; onLiked: () => void; stacked?: boolean }) {
  const [reaction, setReaction] = useState<Reaction | null>(c.feedback?.reaction ?? null)
  const [aspects, setAspects] = useState<Record<string, number>>(c.feedback?.aspects ?? {})
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function save(r: Reaction, a: Record<string, number>) {
    const f: Feedback = { reaction: r, aspects: r === 'like' ? a : {}, next: r === 'like' ? 'more' : r === 'dislike' ? 'stop' : null, reason: '' }
    setState('saving')
    try { await api.feedback({ date, artist: c.artist, ...f }); onSaved(f); setState('idle') } catch { setState('error') }
  }
  const pick = (r: Reaction) => { if (r === 'like' && reaction !== 'like') onLiked(); setReaction(r); save(r, aspects) }
  const toggle = (k: string) => {
    const a = { ...aspects }; if (a[k]) delete a[k]; else a[k] = 1
    setAspects(a)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save('like', a), 500)
  }
  const cur = REACTIONS.find((x) => x.r === reaction)

  return (
    <div className={`flex flex-col gap-5 ${stacked ? '' : 'lg:flex-row lg:items-start lg:justify-between'}`}>
      <div>
        <h3 className={`${stacked ? 'text-[17px]' : 'text-[20px]'} font-serif font-bold tracking-[-0.025em]`}>이 음악, 어땠어요?</h3>
        <p className="mt-1 text-[14px] text-fg-3" aria-live="polite">{state === 'saving' ? '적는 중' : state === 'error' ? '저장하지 못했어요. 다시 눌러 주세요' : cur ? cur.reply : '고른 반응에 따라 오늘 밤 디깅 방향이 바뀌어요'}</p>
      </div>
      <div className={`flex flex-col gap-3 ${stacked ? '' : 'lg:items-end'}`}>
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((x) => {
            const on = reaction === x.r
            return (
              <motion.button key={x.r} whileTap={{ scale: 0.95 }} onClick={() => pick(x.r)} aria-pressed={on}
                             className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14.5px] font-semibold transition-colors ${on ? 'bg-fg text-black' : 'text-fg-2 ring-1 ring-white/15 hover:text-fg hover:ring-white/35'}`}>
                <x.Icon size={16} strokeWidth={2.2} fill={on && x.r === 'like' ? 'currentColor' : 'none'} />{x.label}
              </motion.button>
            )
          })}
        </div>
        <AnimatePresence initial={false}>
          {reaction === 'like' && c.kind === 'new' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[14px]">
                <span className="text-fg-3">좋았던 점</span>
                {ASPECTS.map((k) => {
                  const on = !!aspects[k]
                  return (
                    <button key={k} onClick={() => toggle(k)} aria-pressed={on} className={`inline-flex items-center gap-1.5 font-medium transition ${on ? 'text-accent' : 'text-fg-2 hover:text-fg'}`}>
                      <span className={`grid h-4 w-4 place-items-center rounded-[4px] ${on ? 'bg-accent text-black' : 'ring-1 ring-white/30'}`}>{on && <Check size={11} strokeWidth={3.2} />}</span>
                      {ASPECT_LABEL[k] ?? k}
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 다르게 찾아 달라고 하기

const QUICK = ['아티스트 본인이 한 말로', '더 낯선 쪽으로', '비슷한데 더 조용한 거', '이 이유는 와닿지 않아요']
const STEP: Record<string, string> = {
  interview_mentions: '인터뷰를 읽고 있어요', web_search: '찾아보고 있어요', find_in_page: '글을 읽고 있어요', read_page: '글을 읽고 있어요',
  mb_search_artist: '크레딧을 보고 있어요', mb_relations: '멤버를 보고 있어요', mb_collaborations: '협업을 보고 있어요',
  check_novelty: '이미 아는 음악인지 보고 있어요', critic_picks: '평론을 보고 있어요', submit_candidate: '원문과 맞춰 보고 있어요',
}

function Retort({ c, date, onDone }: { c: Candidate; date: string; onDone: (artist: string | null) => void }) {
  const [text, setText] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [reply, setReply] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const es = useRef<EventSource | null>(null)
  useEffect(() => () => es.current?.close(), [])

  async function send(objection: string) {
    if (objection.trim().length < 2 || phase === 'working') return
    setSaid(objection.trim()); setText(''); setReply(null); setStep(null); setError(null); setPhase('working')
    es.current?.close()
    const s = new EventSource('/api/run/stream'); es.current = s
    let found: string | null = null
    s.addEventListener('retort_reply', (ev) => setReply(JSON.parse((ev as MessageEvent).data).reply))
    s.addEventListener('tool', (ev) => { const e = JSON.parse((ev as MessageEvent).data) as LogEvent; const l = STEP[e.tool as string]; if (l) setStep(l) })
    s.addEventListener('candidate', (ev) => { const e = JSON.parse((ev as MessageEvent).data); if (e.status === 'accepted') found = e.artist })
    s.addEventListener('run_end', () => { s.close(); setPhase(found ? 'done' : 'failed'); onDone(found) })
    try {
      const r = await fetch('/api/retort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, artist: c.artist, objection }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`)
    } catch (e) { s.close(); setPhase('idle'); setSaid(null); setError((e as Error).message) }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-20">
      <div>
        <h3 className="text-[20px] font-serif font-bold tracking-[-0.025em]">다르게 찾아 주세요</h3>
        <p className="mt-1 text-[14px] text-fg-3">이유가 와닿지 않으면 점원에게 말해 주세요. 한 장 더 찾아 이 LP 뒤에 꽂아 둬요.</p>
      </div>
      {said ? (
        <div className="text-[15px] leading-[1.65]">
          <p className="text-fg-3">“{said}”</p>
          <p className="mt-1 text-fg">{reply ?? <span className="shimmer">생각하고 있어요</span>}</p>
          <p className="mt-1 text-[13.5px]" aria-live="polite">
            {phase === 'working' && <span className="shimmer">{step ?? '새 음악을 찾고 있어요'} · 1~3분</span>}
            {phase === 'done' && <span className="text-accent">이 LP 바로 뒤에 새 LP를 꽂아 뒀어요</span>}
            {phase === 'failed' && <span className="text-fg-3">이번엔 꼭 맞는 음악을 못 찾았어요. <button onClick={() => { setSaid(null); setPhase('idle') }} className="font-semibold text-fg underline underline-offset-4">다르게 말해 보기</button></span>}
          </p>
        </div>
      ) : (
        <div>
          <form onSubmit={(e) => { e.preventDefault(); send(text) }} className="flex h-12 items-center gap-2 rounded-full bg-fill pl-5 pr-1.5 ring-1 ring-line transition focus-within:ring-white/30">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="다르게 찾아 달라고 하기"
                   placeholder={`예: ${nameOf(c)}보다 조금 더 조용한 쪽으로`} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none focus-visible:outline-none placeholder:text-fg-3" />
            <button disabled={text.trim().length < 2} aria-label="보내기" className="grid h-9 w-9 place-items-center rounded-full bg-fg text-black transition disabled:bg-fill-2 disabled:text-fg-3"><ArrowUp size={17} strokeWidth={2.4} /></button>
          </form>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 pl-5">
            {QUICK.map((q) => <button key={q} onClick={() => send(q)} className="text-[13.5px] text-fg-3 transition hover:text-fg">{q}</button>)}
          </div>
          {error && <p className="mt-2 pl-5 text-[13px] text-[#fca5a5]">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 같은 음악을 다룬 다른 글

function More({ c }: { c: Candidate }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)] lg:gap-20">
      <h3 className="text-[20px] font-serif font-bold tracking-[-0.025em]">같은 음악을 다룬 다른 글</h3>
      <ul className="divide-y divide-line">
        {(c.more_evidence ?? []).map((e, k) => (
          <li key={e.url + k}>
            <a href={e.url} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-6 py-4 first:pt-0">
              <span className="min-w-0">
                <span className="line-clamp-2 text-[15px] leading-[1.6] text-fg transition group-hover:text-white">{unquote(e.quote)}</span>
                <span className="mt-1 block text-[12.5px] text-fg-3">{[e.speaker, e.host, e.kind].filter(Boolean).join(' · ')}</span>
              </span>
              <ArrowUpRight size={16} className="mt-1 shrink-0 text-fg-3 transition group-hover:text-fg" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
