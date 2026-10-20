/** 라이너 노트: 판 하나의 펼침면 오른쪽. 이 판을 왜 가져왔는지(원문)가 주인공이고, 그 아래로 내가 답하고 에이전트가 받아 적는다.
 *  위계: 아티스트 이름 → 대표 인용(크게, 명조) → 누가 어디서(작게) → 문맥·이어지는 글·연결 → 정리 → 내 반응(큰 문장)과 그 답(작은 문장).
 *  '나 / 에이전트' 같은 꼬리표 없이 문장 크기와 밝기로 누가 한 말인지 구분한다. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, ASPECT_LABEL, ASPECTS, EDGE_HEX, EDGE_LABEL, proxied, type Candidate, type Feedback, type LogEvent, type Reaction } from '../api'
import { GeneratedSleeve, SleeveArt } from './SleeveArt'

/** 연결고리: 내가 원래 좋아하던 아티스트(왼쪽 원)에서 이 판(오른쪽 원)까지. 선이 그려지고 그 위로 빛이 흐른다 */
function Link({ c, seedThumb, color, active, check }: { c: Candidate; seedThumb?: string; color: string; active: boolean; check?: { url: string; label: string } }) {
  const hop = c.path[0]
  const fact = hop.connection?.replace(/ — 같은 해 같은 부문에 .+$/, '') || EDGE_LABEL[hop.edge] || hop.edge
  const Disc = ({ children, label, sub }: { children: React.ReactNode; label: string; sub: string }) => (
    <div className="flex w-[74px] shrink-0 flex-col items-center text-center">
      <div className="h-12 w-12 overflow-hidden rounded-full ring-1 ring-white/25 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.8)]">{children}</div>
      <div className="mt-1.5 w-full truncate text-[12.5px] font-semibold">{label}</div>
      <div className="text-[10.5px] text-white/40">{sub}</div>
    </div>
  )
  return (
    <motion.div initial={false} animate={{ opacity: active ? 1 : 0 }} transition={{ delay: active ? 0.4 : 0, duration: 0.4 }} className="mt-6 flex items-start gap-1">
      <Disc label={hop.from} sub="원래 좋아하던">
        {seedThumb ? <img src={proxied(seedThumb)} alt="" className="h-full w-full object-cover" /> : <GeneratedSleeve name={hop.from} />}
      </Disc>
      <div className="relative min-w-0 flex-1 pt-1">
        <div className="truncate px-1 text-center text-[13px] text-white/75" title={fact}>{fact}</div>
        <div className="relative mt-2.5 h-px w-full">
          <motion.div className="absolute inset-0 origin-left" style={{ background: `linear-gradient(90deg, ${color}33, ${color} 50%, ${color}33)` }}
                      initial={false} animate={{ scaleX: active ? 1 : 0 }} transition={{ delay: active ? 0.55 : 0, duration: 0.9, ease: [0.4, 0, 0.2, 1] }} />
          {/* 빛 점: 선 한가운데를 따라 흐른다 */}
          {active && (
            <motion.span className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
                         initial={{ left: '0%', opacity: 0 }} animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
                         transition={{ delay: 1.5, duration: 2.6, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }} />
          )}
        </div>
        <div className="mt-1 flex justify-center gap-2 text-[11px] text-white/40">
          <span style={{ color }}>{EDGE_LABEL[hop.edge] ?? hop.edge}</span>
          {check && <a href={check.url} target="_blank" rel="noreferrer" className="hover:text-white">확인<Arrow /></a>}
        </div>
      </div>
      <Disc label={c.artist_ko || c.artist} sub="오늘의 음악"><SleeveArt c={c} /></Disc>
    </motion.div>
  )
}

/** 숨은 곡: 이 아티스트의 인기곡을 트랙리스트처럼. 들은 곡은 채운 점, 이 곡만 비어서 빛난다 */
function Shelf({ c, active }: { c: Candidate; active: boolean }) {
  const shelf = c.track?.shelf ?? []
  if (!shelf.length) return null
  return (
    <motion.div initial={false} animate={{ opacity: active ? 1 : 0 }} transition={{ delay: active ? 0.4 : 0 }} className="mt-[4vh]">
      <div className="mb-3 text-[13px] text-white/45">{c.artist} 인기곡</div>
      <ol className="space-y-1">
        {shelf.map((s, k) => {
          const me = s.title === c.track?.title
          return (
            <motion.li key={s.title + k} initial={{ opacity: 0, x: -8 }} animate={active ? { opacity: 1, x: 0 } : { opacity: 0.5, x: 0 }}
                       transition={{ delay: active ? 0.5 + k * 0.08 : 0 }}
                       className={`flex items-center gap-4 rounded-xl px-3 py-2.5 ${me ? 'bg-white/[0.07] ring-1 ring-[#ff8f7a]/50' : ''}`}>
              <span className="w-5 text-right text-[12px] tabular-nums text-white/35">{k + 1}</span>
              <span className="relative grid h-3 w-3 place-items-center">
                {me ? <><span className="absolute inset-0 animate-ping rounded-full bg-[#ff8f7a]/50" /><span className="h-3 w-3 rounded-full border-2 border-[#ff8f7a]" /></>
                    : s.heard ? <span className="h-2.5 w-2.5 rounded-full bg-white/55" /> : <span className="h-2.5 w-2.5 rounded-full border border-white/30" />}
              </span>
              <span className={`min-w-0 flex-1 truncate text-[17px] ${me ? 'font-semibold text-white' : s.heard ? 'text-white/45' : 'text-white/70'}`}>{s.title}</span>
              <span className={`shrink-0 text-[12px] ${me ? 'text-[#ffb3a5]' : 'text-white/30'}`}>{me ? '아직 안 들은 곡' : s.heard ? '들은 곡' : ''}</span>
            </motion.li>
          )
        })}
      </ol>
    </motion.div>
  )
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const sentences = (t: string) => t.split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean)
const Arrow = () => <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden className="ml-0.5 inline align-[1px]"><path d="M6 3h7v7M13 3 4 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>

export function LinerNotes({ c, i, total, date, active, replies, seedThumb, onReact, onRetortDone, onOpen }: {
  c: Candidate; i: number; total: number; date: string; active: boolean; seedThumb?: string
  replies: Candidate[]                         // 이 판에 말대꾸해서 찾아온 판들
  onReact: (f: Feedback) => void; onRetortDone: (artist: string | null) => void; onOpen: (artist: string) => void
}) {
  const hop = c.path[0]
  const ev = (c.sources ?? []).find((s) => s.kind === '근거 원문')
  const check = (c.sources ?? []).find((s) => s.kind !== '근거 원문')
  const d = c.display
  const color = EDGE_HEX[hop?.edge ?? ''] ?? '#cfc8e6'
  const pull = d?.pull ?? ev?.quote ?? c.claims[0]?.quote ?? ''
  const name = c.artist_ko || c.artist
  // 한 화면에 담기게: 이름·인용이 길면 글자를 줄인다
  const nameSize = name.length > 14 ? 'text-[clamp(32px,3.3vw,50px)]' : name.length > 8 ? 'text-[clamp(40px,4.4vw,64px)]' : 'text-[clamp(48px,5.6vw,84px)]'
  const quoteSize = pull.length > 70 ? 'text-[clamp(19px,1.65vw,25px)]' : pull.length > 40 ? 'text-[clamp(23px,2.15vw,32px)]' : 'text-[clamp(28px,2.7vw,40px)]'
  const hidden = c.kind === 'hidden_track'
  const big = hidden ? (c.track?.title ?? '') : pull

  return (
    <div className="flex h-[calc(100dvh-15vh-40px)] max-h-[860px] max-w-[660px] flex-col overflow-hidden [&>*]:shrink-0">
      {/* 머리: 몇 번째 판 · 어디서 왔는지 */}
      <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-white/50">
        <span className="tabular-nums">{String(i + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        {hop && <><span aria-hidden>·</span><span style={{ color }}>{hop.from}에서 · {EDGE_LABEL[hop.edge] ?? hop.edge}</span></>}
        {c.kind === 'hidden_track' && <><span aria-hidden>·</span><span>원래 좋아하던 아티스트의 숨은 곡</span></>}
        {c.reply_to && <><span aria-hidden>·</span><span className="text-[#ffb3a5]">내 말에 답해 찾아온 음악</span></>}
        {c.from_chat && <><span aria-hidden>·</span><span className="text-[#ffb3a5]">“{c.from_chat.said}”에 맞춰 찾아온 음악</span></>}
      </div>
      <h2 className={`mt-2 font-black leading-[1.02] tracking-[-0.055em] [text-wrap:balance] ${nameSize}`}>{name}</h2>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[15px] text-white/60">
        {c.artist_ko && c.artist_ko !== c.artist && <span>{c.artist}</span>}
        {!hidden && <span className="text-white/85">{c.track?.title}</span>}
        {c.track?.url && <a href={c.track.url} target="_blank" rel="noreferrer" className="text-[13px] text-white/45 hover:text-white">YouTube Music<Arrow /></a>}
      </div>

      {/* 큰 글자 하나: 이 판의 주인공. 이 판이 가운데 오면 흐림에서 또렷하게 떠오른다 */}
      <motion.blockquote key={active ? 'on' : 'off'} initial={{ opacity: 0, filter: 'blur(10px)', y: 10 }}
                         animate={{ opacity: active ? 1 : 0.35, filter: 'blur(0px)', y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                         className={`mt-[3.2vh] line-clamp-4 font-serif font-semibold leading-[1.5] tracking-[-0.02em] text-white [text-wrap:pretty] ${quoteSize}`}>
        {hidden ? big : `“${big}”`}
      </motion.blockquote>
      {hidden && <Shelf c={c} active={active} />}
      {c.kind !== 'hidden_track' && (
        <motion.div initial={false} animate={{ opacity: active ? 1 : 0 }} transition={{ delay: active ? 0.35 : 0 }} className="mt-3 text-[14px] text-white/55">
          {d?.speaker && <span className="font-semibold text-white/85">{d.speaker}</span>}
          {d?.speaker && <span className="mx-1.5" aria-hidden>·</span>}
          {d?.role || ev?.label}
          {ev && <a href={ev.url} target="_blank" rel="noreferrer" className="ml-2 text-white/40 underline decoration-white/20 underline-offset-4 hover:text-white">{host(ev.url)}<Arrow /></a>}
        </motion.div>
      )}

      {/* 연결고리: 내가 아는 판에서 이 판까지. 늘 보인다 */}
      {hop && <Link c={c} seedThumb={seedThumb} color={color} active={active} check={check} />}

      {/* 더 깊이: 문맥 · 다른 글 · 정리가 한 칸에서 차례로 넘어간다 */}
      {c.kind !== 'hidden_track' && <Deeper c={c} active={active} />}

      {/* 답장: 한 줄 */}
      {c.kind !== 'hidden_track' && (
        <motion.div initial={false} animate={{ opacity: active ? 1 : 0.25 }} className="mt-auto pt-[3.5vh]">
          <Respond c={c} date={date} onSaved={onReact} />
          {replies.map((r) => r.reply_to && (
            <button key={r.artist} onClick={() => onOpen(r.artist)} className="mt-3 flex w-full items-center gap-3 text-left">
              <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[3px]"><SleeveArt c={r} /></span>
              <span className="min-w-0 text-[14px]"><span className="text-white/85">“{r.reply_to.objection}”</span><span className="text-white/45"> 에 답해 찾아온 음악 · </span><span className="font-semibold">{r.artist_ko || r.artist}</span></span>
            </button>
          ))}
          <RetortLine c={c} date={date} onDone={onRetortDone} />
        </motion.div>
      )}
    </div>
  )
}

/** 더 깊이 들어가는 칸: 높이가 정해진 한 칸에서 문맥 → 다른 글 → 이어진 길 → 정리가 차례로 넘어간다.
 *  가운데 온 판에서만 저절로 넘어가고(7초), 위에 마우스를 올리면 멈춘다. 이름표를 눌러 바로 갈 수도 있다. */
function Deeper({ c, active }: { c: Candidate; active: boolean }) {
  const ev = (c.sources ?? []).find((s) => s.kind === '근거 원문')
  const before = ev?.excerpt ? sentences(ev.excerpt.before).slice(-2) : []
  const after = ev?.excerpt ? sentences(ev.excerpt.after).slice(0, 2) : []
  const why = c.why?.replace(/\s*—\s*그래서 추천해요?\.?\s*$/, '.').replace(/\.\.$/, '.')
  const pages: { key: string; label: string; body: React.ReactNode }[] = []
  if (before.length || after.length) pages.push({ key: 'ctx', label: '앞뒤 이야기', body: (
    <p className="font-serif text-[17.5px] leading-[1.85] text-white/60">
      {before.join(' ')} <mark className="bg-transparent text-white/90 [box-shadow:inset_0_-0.45em_0_rgba(255,143,122,0.28)]">{ev?.excerpt?.quote}</mark> {after.join(' ')}
      <a href={ev?.url} target="_blank" rel="noreferrer" className="ml-2 font-sans text-[12.5px] text-white/40 underline decoration-white/20 underline-offset-4 hover:text-white">원래 글<Arrow /></a>
    </p>) })
  const count: Record<string, number> = {}
  ;(c.more_evidence ?? []).forEach((m, k) => {
    const base = m.kind === '인터뷰' ? '인터뷰' : '다른 리뷰'
    count[base] = (count[base] ?? 0) + 1
    pages.push({ key: `more${k}`, label: count[base] > 1 ? `${base} ${count[base]}` : base, body: (
    <figure>
      <blockquote className="font-serif text-[clamp(19px,1.65vw,24px)] leading-[1.65] text-white/90">“{m.quote}”</blockquote>
      <figcaption className="mt-2.5 text-[13.5px] text-white/50">{m.speaker && <span className="text-white/70">{m.speaker} · </span>}{m.kind}
        <a href={m.url} target="_blank" rel="noreferrer" className="ml-2 underline decoration-white/20 underline-offset-4 hover:text-white">{m.host}<Arrow /></a></figcaption>
    </figure>) })
  })
  if (why) pages.unshift({ key: 'why', label: '추천 이유', body: <p className="text-[18px] leading-[1.75] text-white/88">{why}</p> })

  const [at, setAt] = useState(0)
  const [hold, setHold] = useState(false)
  const DUR = 7000
  useEffect(() => { if (!active) setAt(0) }, [active])
  useEffect(() => {
    if (!active || hold || pages.length < 2) return
    const t = setTimeout(() => setAt((x) => (x + 1) % pages.length), DUR)
    return () => clearTimeout(t)
  }, [active, hold, at, pages.length])
  if (!pages.length) return null
  const page = pages[Math.min(at, pages.length - 1)]

  return (
    <motion.div initial={false} animate={{ opacity: active ? 1 : 0 }} transition={{ delay: active ? 0.6 : 0, duration: 0.5 }}
                className="mt-[2.8vh] flex min-h-0 flex-1 !shrink flex-col" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <div role="tablist" className="flex flex-wrap gap-x-5 gap-y-2">
        {pages.map((p, k) => (
          <button key={p.key} role="tab" aria-selected={k === at} onClick={() => setAt(k)} className="group relative pb-2 text-[13.5px]">
            <span className={k === at ? 'text-white' : 'text-white/40 group-hover:text-white/70'}>{p.label}</span>
            <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden rounded-full bg-white/10">
              {k === at && <motion.span key={`${at}-${hold}`} className="absolute inset-y-0 left-0 bg-white/80"
                                        initial={{ width: hold ? '100%' : '0%' }} animate={{ width: '100%' }} transition={{ duration: active && !hold ? DUR / 1000 : 0, ease: 'linear' }} />}
            </span>
          </button>
        ))}
      </div>
      <div className="relative mt-4 min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={page.key} className="thin-scroll absolute inset-0 overflow-y-auto overscroll-contain pr-3" initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }} transition={{ duration: 0.45 }}>
            {page.body}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------- 반응

const REACT: { r: Reaction; label: string; said: string; reply: string }[] = [
  { r: 'like', label: '더 듣고 싶어요', said: '더 듣고 싶은 음악이에요', reply: '오늘 밤엔 여기서 출발해 더 찾아볼게요.' },
  { r: 'dislike', label: '별로예요', said: '이번 곡은 저랑 안 맞았어요', reply: '이 아티스트는 다시 가져오지 않을게요. 다음엔 다른 결로 찾아볼게요.' },
  { r: 'known', label: '이미 알아요', said: '이미 아는 아티스트예요', reply: '아는 아티스트로 적어 둘게요. 다음부턴 빼고 찾을게요.' },
]

function Respond({ c, date, onSaved }: { c: Candidate; date: string; onSaved: (f: Feedback) => void }) {
  const [reaction, setReaction] = useState<Reaction | null>(c.feedback?.reaction ?? null)
  const [aspects, setAspects] = useState<Record<string, number>>(c.feedback?.aspects ?? {})
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [editing, setEditing] = useState(false)   // 좋았던 점 고르기: 아직 안 골랐거나 다시 고칠 때만 펼친다
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setReaction(c.feedback?.reaction ?? null); setAspects(c.feedback?.aspects ?? {}); setEditing(false) }, [c.artist]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(r: Reaction, a: Record<string, number>) {
    const f: Feedback = { reaction: r, aspects: r === 'like' ? a : {}, next: r === 'like' ? 'more' : r === 'dislike' ? 'stop' : null, reason: '' }
    setState('saving')
    try { await api.feedback({ date, artist: c.artist, ...f }); onSaved(f); setState('idle') } catch { setState('error') }
  }
  const pick = (r: Reaction) => { setReaction(r); save(r, aspects); setEditing(r === 'like' && !Object.keys(aspects).length) }
  const toggle = (k: string) => {
    const a = { ...aspects }; if (a[k]) delete a[k]; else a[k] = 1
    setAspects(a)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { save('like', a); setTimeout(() => setEditing(false), 900) }, 600)
  }
  const cur = REACT.find((x) => x.r === reaction)
  const liked = Object.keys(aspects).filter((k) => aspects[k] > 0).map((k) => ASPECT_LABEL[k] ?? k)

  return (
    <section className="border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <AnimatePresence mode="wait">
          {cur ? (
            <motion.div key={cur.r} initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="min-w-0">
              <p className="text-[19px] font-bold leading-[1.35] tracking-[-0.03em]">
                {cur.said}
                {reaction === 'like' && (liked.length > 0
                  ? <button onClick={() => setEditing((e) => !e)} className="text-[#ffb3a5] hover:underline"> · {liked.join(', ')}</button>
                  : !editing && <button onClick={() => setEditing(true)} className="ml-2 text-[13px] font-normal text-white/45 hover:text-white">좋았던 점 고르기</button>)}
              </p>
              <p className="mt-0.5 text-[13.5px] text-white/50">{state === 'saving' ? '적는 중…' : state === 'error' ? '저장하지 못했어요. 다시 눌러 주세요.' : cur.reply}</p>
            </motion.div>
          ) : (
            <motion.p key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[19px] font-bold tracking-[-0.03em]">이 음악, 어땠어요?</motion.p>
          )}
        </AnimatePresence>
        <div className="flex shrink-0 gap-1.5">
          {REACT.map((x) => (
            <motion.button key={x.r} whileTap={{ scale: 0.94 }} onClick={() => pick(x.r)} aria-pressed={reaction === x.r}
                           className={`h-9 rounded-full px-3.5 text-[13.5px] font-medium transition ${reaction === x.r ? 'bg-white text-black' : 'border border-white/20 text-white/80 hover:border-white/50 hover:text-white'}`}>
              {x.label}
            </motion.button>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {reaction === 'like' && editing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12.5px] text-white/45">좋았던 건</span>
              {ASPECTS.map((k) => (
                <button key={k} onClick={() => toggle(k)} aria-pressed={!!aspects[k]}
                        className={`h-7 rounded-full px-3 text-[12.5px] transition ${aspects[k] ? 'bg-[#ff8f7a] text-[#2a0f0a]' : 'border border-white/15 text-white/70 hover:border-white/40'}`}>
                  {ASPECT_LABEL[k] ?? k}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ---------------------------------------------------------------- 반박: 내 말(크게) → 에이전트의 답(작게) → 새 판

const QUICK = ['평론 말고 아티스트 본인이 한 말로', '더 낯선 쪽으로', '비슷한데 더 조용한 거', '이 이유는 잘 와닿지 않아요']
const STEP: Record<string, string> = {
  interview_mentions: '인터뷰를 읽고 있어요', web_search: '찾고 있어요', find_in_page: '글을 읽고 있어요', read_page: '글을 읽고 있어요',
  mb_search_artist: '크레딧을 보고 있어요', mb_relations: '멤버를 보고 있어요', mb_collaborations: '협업을 보고 있어요',
  check_novelty: '이미 아는 음악인지 보고 있어요', critic_picks: '평론을 보고 있어요', submit_candidate: '이야기를 맞춰 보고 있어요',
}

function RetortLine({ c, date, onDone }: { c: Candidate; date: string; onDone: (artist: string | null) => void }) {
  const [open, setOpen] = useState(false)
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
    setSaid(objection.trim()); setReply(null); setStep(null); setError(null); setPhase('working')
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
    <section className="mt-3">
      <AnimatePresence mode="wait">
        {said ? (
          <motion.div key="said" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[17px] font-semibold leading-[1.45] tracking-[-0.02em]">“{said}”</p>
            <p className="mt-1 text-[13.5px] leading-[1.6] text-white/55">
              {reply ?? <span className="animate-pulse">생각하고 있어요…</span>}
            </p>
            {phase === 'working' && <p className="mt-1 text-[13px] text-white/40">{step ?? '새 음악을 찾고 있어요'} · 1~3분</p>}
            {phase === 'done' && <p className="mt-1 text-[13px] text-[#ffb3a5]">이 음악 바로 다음에 새 곡을 담았어요</p>}
            {phase === 'failed' && <p className="mt-1 text-[13px] text-white/50">이번엔 꼭 맞는 음악을 못 찾았어요. <button onClick={() => { setSaid(null); setPhase('idle') }} className="underline">다르게 말해 보기</button></p>}
          </motion.div>
        ) : !open ? (
          <motion.button key="open" onClick={() => setOpen(true)} className="text-[13px] text-white/45 underline decoration-white/20 underline-offset-[5px] hover:text-white">
            이 이유가 와닿지 않으면 다른 이유로 찾아 달라고 하기
          </motion.button>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <form onSubmit={(e) => { e.preventDefault(); send(text) }} className="flex items-center gap-2 border-b border-white/25 pb-2 focus-within:border-white">
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="다른 이유로 찾아 달라고 하기"
                     placeholder="예: 보컬은 좋은데 더 조용한 쪽으로" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-white/30" />
              <button disabled={text.trim().length < 2} className="text-[14px] font-semibold disabled:opacity-30">보내기</button>
            </form>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {QUICK.map((q) => <button key={q} onClick={() => send(q)} className="text-[13.5px] text-white/50 hover:text-white">{q}</button>)}
            </div>
            {error && <p className="mt-2 text-[13px] text-[#ff9a8a]">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

