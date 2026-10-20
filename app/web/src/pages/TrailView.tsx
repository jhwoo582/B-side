/** 공유받은 디깅 경로 (#trail/날짜): 길을 보여주고, 그 끝에서 내 에이전트로 이어서 판다. */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { StoryCard, type Trail } from '../components/StoryCard'
import { LogDrawer } from '../components/LogDrawer'

export function TrailView({ date, onExit }: { date: string; onExit: () => void }) {
  const [trail, setTrail] = useState<Trail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  useEffect(() => {
    fetch(`/api/trail/${date}`).then(async (r) => (r.ok ? setTrail(await r.json()) : setError('이 길을 찾을 수 없어요.')))
  }, [date])

  async function follow() {
    if (!trail) return
    const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 3, seeds: trail.ends, note: `친구가 공유한 ${date} 디깅 경로의 끝(${trail.ends.join(', ')})에서 이어서 판다.` }) })
    if (r.ok) setLogOpen(true); else setError((await r.json().catch(() => ({}))).detail ?? '찾기를 시작하지 못했어요.')
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 overflow-y-auto px-5 py-6 lg:flex-row">
      <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="shadow-[0_40px_80px_-25px_rgba(0,0,0,0.9)]">
        {trail ? <StoryCard trail={trail} /> : <div className="flex h-[640px] w-[360px] items-center justify-center rounded-2xl bg-white/10 text-white/60">{error ?? '불러오는 중…'}</div>}
      </motion.div>
      <div className="max-w-sm">
        <div className="text-[13px] text-white/55">공유받은 길</div>
        <h2 className="mt-1 text-[40px] font-black leading-[1.02] tracking-[-0.045em]">누군가 여기까지<br />걸어왔어요.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/70">이 길 끝에서 내 취향대로 이어서 찾아요. 이미 아는 아티스트는 건너뛸게요.</p>
        {trail && <p className="mt-3 text-[13px] text-white/50">출발점: {trail.ends.join(' · ')}</p>}
        <button onClick={follow} disabled={!trail} className="mt-6 h-12 w-full rounded-full bg-white text-[15px] font-semibold text-black transition hover:scale-[1.01] disabled:opacity-40">이어서 찾기 · 세 곡</button>
        <button onClick={onExit} className="mt-2 h-11 w-full text-[14px] text-white/60 hover:text-white">내 화면으로 돌아가기</button>
        {error && trail && <div className="mt-2 text-[13px] text-[#ff9a8a]">{error}</div>}
      </div>
      <LogDrawer open={logOpen} onClose={() => setLogOpen(false)} date={null} onFinished={onExit} liveOnly />
    </div>
  )
}
