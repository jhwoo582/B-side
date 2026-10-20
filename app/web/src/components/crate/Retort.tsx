/** 말대꾸: 판의 이유에 반박하면 사장님이 한 줄로 답하고, 방향을 바꿔 한 판을 더 찾아온다. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Candidate, LogEvent } from '../../api'

// 화면 라벨 → 에이전트에 보내는 반박
const QUICK: [string, string][] = [
  ['본인 발언으로 찾아 주세요', '평론 말고 아티스트 본인이 한 말로'],
  ['더 낯선 쪽으로', '더 낯선 쪽으로'],
  ['비슷하지만 더 조용하게', '비슷한데 더 조용한 거'],
  ['이 이유는 납득이 안 돼요', '이 이유는 별로야'],
]
const TOOL_KO: Record<string, string> = {
  interview_mentions: '인터뷰 읽는 중', web_search: '검색 중', find_in_page: '원문 읽는 중', read_page: '원문 읽는 중',
  mb_search_artist: '크레딧 확인 중', mb_relations: '멤버 확인 중', mb_collaborations: '협업 확인 중',
  check_novelty: '보관함 확인 중', critic_picks: '평론 확인 중', submit_candidate: '검증 중',
}

export function Retort({ c, date, onDone }: { c: Candidate; date: string; onDone: (newArtist: string | null) => void }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [reply, setReply] = useState<string | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const es = useRef<EventSource | null>(null)
  useEffect(() => () => es.current?.close(), [])
  useEffect(() => { setPhase('idle'); setReply(null); setSteps([]); setError(null); setText('') }, [c.artist])

  async function send(objection: string) {
    if (objection.trim().length < 2 || phase === 'working') return
    setError(null); setReply(null); setSteps([]); setPhase('working')
    // 먼저 스트림을 연결하고 나서 시작해야 첫 이벤트를 놓치지 않는다
    es.current?.close()
    const s = new EventSource('/api/run/stream'); es.current = s
    let found: string | null = null
    s.addEventListener('retort_reply', (ev) => setReply(JSON.parse((ev as MessageEvent).data).reply))
    s.addEventListener('tool', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as LogEvent
      const label = TOOL_KO[e.tool as string]
      if (label) setSteps((xs) => (xs[xs.length - 1] === label ? xs : [...xs, label].slice(-4)))
    })
    s.addEventListener('verify', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data)
      setSteps((xs) => [...xs, e.verbatim && e.supports ? `검증 통과: ${e.candidate}` : `검증 실패: ${e.candidate}, 다시 찾는 중`].slice(-4))
    })
    s.addEventListener('candidate', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data)
      if (e.status === 'accepted') found = e.artist
    })
    s.addEventListener('run_end', () => {
      s.close()
      setPhase(found ? 'done' : 'failed')
      onDone(found)
    })
    try {
      const r = await fetch('/api/retort', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, artist: c.artist, objection }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`)
    } catch (e) { s.close(); setPhase('idle'); setError((e as Error).message) }
  }

  if (c.kind !== 'new') return null
  return (
    <div className="pt-3">
      {phase === 'idle' && (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {QUICK.map(([label, q]) => (
              <button key={q} onClick={() => send(q)} className="rounded-full border border-white/25 px-3 py-1.5 text-[13px] transition hover:border-white hover:bg-white hover:text-black">{label}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(text) }} className="mt-2 flex gap-1.5">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="직접 적기 (예: 보컬은 더, 기타는 덜)"
                   className="min-w-0 flex-1 rounded-full border border-ink/30 bg-transparent px-3 py-1.5 text-[13px] outline-none focus:border-ink" />
            <button disabled={text.trim().length < 2} className="rounded-full bg-white px-4 text-[13px] text-black disabled:opacity-30">↵</button>
          </form>
          {error && <div className="mt-1 text-[12px] text-stamp">{error}</div>}
        </>
      )}
      <AnimatePresence>
        {phase !== 'idle' && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
            <div className="relative ml-1 inline-block max-w-full rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-[13px] text-black">
              {reply ?? <span className="animate-pulse">생각 중…</span>}
            </div>
            <ul className="mt-2 space-y-0.5 text-[12px] text-white/65">
              {steps.map((x, i) => <motion.li key={i + x} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>· {x}</motion.li>)}
              {phase === 'working' && <li className="animate-pulse text-ink-faint">새 음악 찾는 중 (1–3분)</li>}
              {phase === 'done' && <li className="font-semibold text-stamp">이 음악 바로 뒤에 담았어요</li>}
              {phase === 'failed' && <li className="text-stamp">꼭 맞는 음악을 못 찾았어요. 다르게 말해 볼까요?</li>}
            </ul>
            {phase === 'failed' && <button onClick={() => setPhase('idle')} className="mt-1 text-[12px] underline">다시 시도</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
