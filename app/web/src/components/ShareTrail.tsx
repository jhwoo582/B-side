/** '오늘의 길 공유': 스토리 카드 미리보기 + 이미지 저장 + 링크 복사. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toPng } from 'html-to-image'
import { StoryCard, type Trail } from './StoryCard'

export function ShareTrail({ date, open, onClose }: { date: string; open: boolean; onClose: () => void }) {
  const [trail, setTrail] = useState<Trail | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) fetch(`/api/trail/${date}`).then((r) => r.json()).then(setTrail) }, [open, date])

  async function save() {
    if (!card.current) return
    setMsg('이미지 만드는 중…')
    try {
      const url = await toPng(card.current, { pixelRatio: 3, cacheBust: true })
      const a = document.createElement('a'); a.href = url; a.download = `digging-trail-${date}.png`; a.click()
      setMsg('저장했어요 (1080×1920)')
    } catch { setMsg('이미지를 저장하지 못했어요') }
  }
  async function copy() {
    const link = `${location.origin}/#trail/${date}`
    try { await navigator.clipboard.writeText(link); setMsg('링크를 복사했어요') } catch { setMsg(link) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="flex flex-col items-center gap-4 lg:flex-row lg:items-end" onClick={(e) => e.stopPropagation()}
                      initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 18 }}>
            <div className="shadow-2xl">{trail ? <StoryCard ref={card} trail={trail} /> : <div className="h-[640px] w-[360px] animate-pulse rounded-2xl bg-white/10" />}</div>
            <div className="w-[300px] rounded-3xl border border-white/10 bg-black/40 p-5 backdrop-blur-2xl">
              <h3 className="text-[22px] font-bold leading-tight tracking-[-0.03em]">오늘 걸어온 길 공유</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/65">링크를 받은 사람은 내가 걸어온 길을 따라와서, 그 끝에서 자기 음악을 이어 찾을 수 있어요.</p>
              <button onClick={save} disabled={!trail} className="mt-5 h-11 w-full rounded-full bg-white text-[14px] font-semibold text-black transition hover:scale-[1.01] disabled:opacity-40">스토리 이미지 저장</button>
              <button onClick={copy} className="mt-2 h-11 w-full rounded-full border border-white/25 text-[14px] font-semibold transition hover:border-white">링크 복사</button>
              {msg && <div className="mt-3 break-all text-center text-[12px] text-white/70">{msg}</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
