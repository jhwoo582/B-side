/** 취향 유형 카드: MBTI처럼 네 글자. 축마다 어느 쪽인지 막대 위 점으로, 아직 모르는 축은 '?'.
 *  공유: 이미지로 저장(1080×1350)하거나 한 줄 문구를 복사한다. */
import { forwardRef, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { toPng } from 'html-to-image'
import type { TasteType } from '../api'

function Letters({ t, size = 'big' }: { t: TasteType; size?: 'big' | 'card' }) {
  return (
    <div className="flex gap-1.5">
      {t.axes.map((a, k) => (
        <motion.span key={a.key} initial={{ y: 14, opacity: 0, rotateX: -60 }} animate={{ y: 0, opacity: 1, rotateX: 0 }} transition={{ delay: 0.08 * k, type: 'spring', stiffness: 260, damping: 18 }}
                     className={`grid place-items-center rounded-xl font-black tracking-[-0.04em] ${size === 'big' ? 'h-14 w-12 text-[30px]' : 'h-[58px] w-[50px] text-[32px]'} ${a.known ? 'bg-white text-black' : 'border border-dashed border-white/35 text-white/45'}`}>
          {a.letter}
        </motion.span>
      ))}
    </div>
  )
}

function Axes({ t }: { t: TasteType }) {
  return (
    <div className="space-y-3">
      {t.axes.map((a) => (
        <div key={a.key} className="grid grid-cols-[44px_1fr] items-center gap-3">
          <span className="text-[12px] leading-tight text-white/45">{a.label}<span className="block text-[10px] text-white/30">{a.known ? `기록 ${a.evidence}` : '기록 없음'}</span></span>
          <div>
            <div className="flex justify-between text-[12px]">
              <span className={a.known && a.value < 0 ? 'font-semibold text-white' : 'text-white/45'}>{a.left}</span>
              <span className={a.known && a.value > 0 ? 'font-semibold text-white' : 'text-white/45'}>{a.right}</span>
            </div>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-white/10">
              <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-white/20" />
              {a.known
                ? <motion.span className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${a.weak ? 'border-2 border-[#ff8f7a] bg-transparent' : 'bg-[#ff8f7a] shadow-[0_0_12px_rgba(255,143,122,0.7)]'}`}
                               initial={{ left: '50%' }} animate={{ left: `${50 + a.value * 46}%` }} transition={{ type: 'spring', stiffness: 120, damping: 16, delay: 0.3 }} />
                : <span className="absolute left-1/2 top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-dashed border-white/40 text-[9px] text-white/50">?</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 공유용 카드 (360×450 → 저장할 때 3배). 이미지로 구워지므로 색은 고정값 */
const ShareCard = forwardRef<HTMLDivElement, { t: TasteType }>(({ t }, ref) => (
  <div ref={ref} style={{ width: 360, height: 450, background: 'radial-gradient(120% 80% at 20% 0%, #4b2a63 0%, #1b1530 50%, #0d0b14 100%)' }}
       className="flex flex-col rounded-2xl p-7 text-white">
    <div className="text-[11px] text-white/55">Crate Digging · 내 취향 유형</div>
    <div className="mt-4"><Letters t={t} size="card" /></div>
    <div className="mt-4 text-[28px] font-black leading-tight tracking-[-0.04em]">{t.name}</div>
    <p className="mt-2 text-[13px] leading-[1.6] text-white/75">{t.line}</p>
    <div className="mt-4 flex flex-wrap gap-1.5">{t.genres.map((g) => <span key={g} className="rounded-full bg-white/12 px-2.5 py-1 text-[11.5px]">{g}</span>)}</div>
    <div className="mt-auto border-t border-white/15 pt-3 text-[11px] text-white/55">
      이 유형이 좋아할 만한 · <span className="text-white/85">{t.artists.join(', ')}</span>
    </div>
  </div>
))
ShareCard.displayName = 'ShareCard'

export function TasteTypeCard({ t }: { t: TasteType }) {
  const card = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  async function save() {
    if (!card.current) return
    try {
      const url = await toPng(card.current, { pixelRatio: 3, cacheBust: true })
      const a = document.createElement('a'); a.href = url; a.download = `digging-type-${t.code}.png`; a.click()
      setMsg('이미지를 저장했어요')
    } catch { setMsg('이미지를 저장하지 못했어요') }
  }
  async function copy() {
    const text = `내 음악 취향은 ${t.code} ${t.name}. ${t.line} (${t.genres.join(' · ')})`
    try { await navigator.clipboard.writeText(text); setMsg('문구를 복사했어요') } catch { setMsg(text) }
  }
  return (
    <section>
      <div className="text-[12px] text-white/45">내 취향 유형</div>
      <div className="mt-2"><Letters t={t} /></div>
      <motion.h4 key={t.name} initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ delay: 0.35 }}
                 className="mt-3 text-[28px] font-black leading-tight tracking-[-0.045em]">{t.name}</motion.h4>
      <p className="mt-1.5 text-[15px] leading-[1.65] text-white/75">{t.line}</p>
      {(t.unknown.length > 0 || t.axes.some((a) => a.weak)) && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/45">
          {t.unknown.length > 0 && <>{t.axes.filter((a) => !a.known).map((a) => `${a.label}는 아직 몰라서 ‘${a.assumed}’ 쪽으로 짐작한 이름이에요. `)}</>}
          {t.axes.some((a) => a.weak) && <>{t.axes.filter((a) => a.weak).map((a) => a.label).join('·')}은 기록이 한두 개뿐이라 아직 확신은 없어요. </>}
          음악에 마음을 남기거나 도우미에게 말할수록 또렷해져요.
        </p>
      )}

      <div className="mt-5"><Axes t={t} /></div>

      <div className="mt-6 space-y-3 text-[13px]">
        <div><div className="mb-1.5 text-[12px] text-white/45">이 유형이 좋아할 장르</div>
          <div className="flex flex-wrap gap-1.5">{t.genres.map((g) => <span key={g} className="rounded-full bg-white/[0.08] px-3 py-1">{g}</span>)}</div></div>
        <div><div className="mb-1.5 text-[12px] text-white/45">이 유형이 좋아할 만한 아티스트</div>
          <div className="flex flex-wrap gap-1.5">{t.artists.map((g) => <span key={g} className="rounded-full bg-white/[0.08] px-3 py-1">{g}</span>)}</div></div>
        {t.mine.length > 0 && <div><div className="mb-1.5 text-[12px] text-white/45">내 지도에서</div>
          <div className="flex flex-wrap gap-1.5">{t.mine.map((g) => <span key={g} className="rounded-full bg-[#ff8f7a]/15 px-3 py-1 text-[#ffc3b8]">{g}</span>)}</div></div>}
      </div>

      <div className="mt-5 flex gap-2">
        <button onClick={save} className="h-10 flex-1 rounded-full bg-white text-[13.5px] font-semibold text-black transition hover:scale-[1.01]">유형 카드 저장</button>
        <button onClick={copy} className="h-10 flex-1 rounded-full border border-white/25 text-[13.5px] font-semibold transition hover:border-white">문구 복사</button>
      </div>
      {msg && <p className="mt-2 text-center text-[12px] text-white/60">{msg}</p>}
      {/* 저장용 카드는 화면 밖에 그려 둔다 */}
      <div className="pointer-events-none fixed -left-[9999px] top-0" aria-hidden><ShareCard ref={card} t={t} /></div>
    </section>
  )
}
