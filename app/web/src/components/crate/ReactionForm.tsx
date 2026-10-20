/** 판에 대한 반응: 탭 한 번으로 저장. '더 듣고 싶어'를 누르면 '뭐가 좋았어?' 칩이 펼쳐진다(선택).
 *  더 듣고 싶어 = 좋았음 + 오늘 밤 여기서 더 파기 / 그저 그래 = 다시 안 가져옴 / 원래 알아 = 아는 아티스트로 기록 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, ASPECT_LABEL, ASPECTS, REACTION_LABEL, type Candidate, type Feedback, type Reaction } from '../../api'

export function ReactionForm({ c, date, onSaved }: { c: Candidate; date: string; onSaved: (f: Feedback) => void }) {
  const [reaction, setReaction] = useState<Reaction | null>(c.feedback?.reaction ?? null)
  const [aspects, setAspects] = useState<Record<string, number>>(c.feedback?.aspects ?? {})
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setReaction(c.feedback?.reaction ?? null); setAspects(c.feedback?.aspects ?? {}); setState('idle') }, [c.artist]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(r: Reaction, a: Record<string, number>) {
    const f: Feedback = { reaction: r, aspects: r === 'like' ? a : {}, next: r === 'like' ? 'more' : r === 'dislike' ? 'stop' : null, reason: '' }
    setState('saving')
    try { await api.feedback({ date, artist: c.artist, ...f }); onSaved(f); setState('saved') } catch { setState('error') }
  }
  const pick = (r: Reaction) => { setReaction(r); save(r, aspects) }
  const toggle = (k: string) => {
    const a = { ...aspects }
    if (a[k]) delete a[k]; else a[k] = 1
    setAspects(a)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save('like', a), 600) // 칩은 연달아 눌러도 한 번만 저장
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(REACTION_LABEL) as Reaction[]).map((r) => {
          const on = reaction === r
          const s = REACTION_LABEL[r]
          return (
            <motion.button key={r} whileTap={{ scale: 0.92, rotate: -4 }} onClick={() => pick(r)}
                           className="rounded-xl border-2 px-2 py-2.5 text-sm font-semibold transition"
                           style={{ borderColor: on ? s.color : 'rgba(255,255,255,0.22)', background: on ? s.color : 'transparent', color: on ? '#111' : '#fff' }}>
              {s.emoji} {s.label}
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence>
        {reaction === 'like' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 text-[12px] text-white/55">어떤 점이 좋았나요?</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ASPECTS.map((k) => (
                <motion.button key={k} whileTap={{ scale: 0.9 }} onClick={() => toggle(k)}
                               className={`rounded-full border px-3.5 py-1 text-[13px] transition ${aspects[k] ? 'border-white bg-white text-black' : 'border-white/25 hover:border-white'}`}>
                  {ASPECT_LABEL[k] ?? k}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-3 min-h-[1.25rem] text-[11px] leading-snug text-ink-faint">
        {state === 'saving' ? '저장 중…'
          : state === 'error' ? '저장하지 못했어요. 다시 시도해 주세요.'
          : state === 'saved' ? (reaction === 'like' ? '저장했어요. 오늘 밤 여기서 더 파 볼게요.' : reaction === 'dislike' ? '저장했어요. 이 아티스트는 다시 추천하지 않아요.' : '아는 아티스트로 저장했어요.')
          : ''}
      </p>
    </div>
  )
}
