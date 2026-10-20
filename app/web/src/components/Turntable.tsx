/** 턴테이블: 판을 끌어다 올리면 바이닐이 플래터에 내려앉고, 톤암이 들려 넘어와 내려앉고, 플래터가 천천히 돌기 시작한다.
 *  - 회전은 물리처럼: 재생하면 서서히 33⅓rpm까지 올라가고, 멈추면 관성으로 천천히 선다
 *  - 판이 닿는 순간(thump가 바뀔 때) 본체가 살짝 가라앉고 먼지가 튄다
 *  - cueing: 톤암이 들린 채 판 위로 넘어오는 중 (내려앉으면 바늘이 닿는다)
 *  dropActive일 때(판을 끌고 있을 때) 플래터가 '여기에 놓아'로 빛나고, dropHover면 자석처럼 당긴다. */
import { forwardRef, useEffect, useRef } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { usePlayer } from '../player'
import { SleeveArt } from './SleeveArt'

const RPM_DEG = 200   // 33⅓rpm = 초당 200도

export const Turntable = forwardRef<HTMLDivElement, { dropActive?: boolean; dropHover?: boolean; hideRecord?: boolean; thump?: number; cueing?: boolean }>(
  ({ dropActive = false, dropHover = false, hideRecord = false, thump = 0, cueing = false }, ref) => {
    const p = usePlayer()
    const on = !!p.current && !hideRecord
    const armAngle = cueing ? 22 : on ? 21 + p.progress * 14 : -4
    const body = useAnimationControls()
    const disc = useRef<HTMLDivElement>(null)

    // 플래터 회전: 각속도가 목표(재생 중 200°/s)로 서서히 다가간다. 올라갈 땐 빠르게, 설 땐 관성으로 느리게
    const spin = useRef({ angle: 0, vel: 0 })
    const playingRef = useRef(false)
    playingRef.current = on && p.playing && !cueing
    useEffect(() => {
      let raf = 0, last = performance.now()
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now
        const s = spin.current, target = playingRef.current ? RPM_DEG : 0
        s.vel += (target - s.vel) * Math.min(1, dt * (target > s.vel ? 2.6 : 0.9))
        s.angle = (s.angle + s.vel * dt) % 360
        if (disc.current) disc.current.style.transform = `rotate(${s.angle}deg)`
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
      return () => cancelAnimationFrame(raf)
    }, [])

    // 판이 닿는 순간: 본체가 살짝 눌렸다가 돌아온다
    useEffect(() => {
      if (!thump) return
      body.start({ y: [0, 3, -1, 0], scale: [1, 0.992, 1.002, 1], transition: { duration: 0.42, ease: 'easeOut' } })
    }, [thump, body])

    return (
      <motion.div ref={ref} animate={body} className="relative mx-auto aspect-[1.12] w-full max-w-[520px] select-none">
        {/* 재생 중엔 판 아래로 앨범색 빛이 번진다 */}
        <div aria-hidden className={`pointer-events-none absolute inset-[8%] rounded-full blur-3xl transition-opacity duration-700 ${on && p.playing ? 'opacity-70' : 'opacity-0'}`}
             style={{ background: 'rgb(var(--album))' }} />
        {/* 본체 */}
        <div className="absolute inset-0 rounded-[28px] border border-white/10 bg-gradient-to-b from-white/[0.10] to-black/40 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl" />
        {/* 플래터 */}
        <div data-platter className="absolute left-[6%] top-[7%] aspect-square h-[86%]">
          <div className={`absolute inset-0 rounded-full bg-[radial-gradient(circle,#323236_0%,#26262a_60%,#1c1c1f_100%)] transition-shadow duration-300 ${dropActive ? (dropHover ? 'shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_0_70px_rgba(255,255,255,0.4)]' : 'shadow-[0_0_0_2px_rgba(255,255,255,0.45)]') : 'shadow-[inset_0_0_0_2px_rgba(255,255,255,0.06),0_14px_30px_rgba(0,0,0,0.6)]'}`} />
          {/* 자석: 판을 가까이 가져오면 스핀들 둘레가 맥동한다 */}
          {dropActive && (
            <motion.div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50"
                        animate={{ scale: dropHover ? [1, 2.6] : [1, 1.6], opacity: [0.8, 0] }} transition={{ duration: dropHover ? 0.7 : 1.2, repeat: Infinity }} />
          )}
          <AnimatePresence mode="wait">
            {on ? (
              <motion.div key={p.current!.artist} className="absolute inset-[3%]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ scale: 0.92, opacity: 0, transition: { duration: 0.25 } }}
                          transition={{ duration: 0.08 }}>
                <div ref={disc} className="vinyl absolute inset-0 rounded-full">
                  <div className="absolute inset-[33%] overflow-hidden rounded-full"><SleeveArt c={p.current!} /></div>
                  {/* 홈에 비치는 빛: 돌 때 반사가 흐른다 */}
                  <div aria-hidden className="absolute inset-0 rounded-full opacity-40 [background:conic-gradient(from_20deg,transparent_0_8%,rgba(255,255,255,0.18)_12%,transparent_18%_58%,rgba(255,255,255,0.12)_62%,transparent_68%)]" />
                </div>
                <div className="absolute left-1/2 top-1/2 h-[3%] w-[3%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80" />
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 rounded-full">
                {/* 빈 플래터: 회색 펠트 매트. 검은 LP가 올라오면 또렷이 구분된다 */}
                <div className="absolute inset-[3%] rounded-full opacity-60 mix-blend-overlay" style={{ background: 'repeating-conic-gradient(rgba(255,255,255,0.05) 0 1deg, transparent 1deg 3deg)' }} />
                <div className="absolute inset-[30%] rounded-full border border-white/[0.06]" />
              </motion.div>
            )}
          </AnimatePresence>
          {/* 먼지: 판이 닿을 때 바깥으로 튄다 */}
          <AnimatePresence>
            {thump > 0 && (
              <motion.div key={thump} className="pointer-events-none absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.9 }}>
                {Array.from({ length: 14 }, (_, i) => {
                  const a = (i / 14) * Math.PI * 2 + i, r = 46 + (i % 3) * 6
                  return <motion.span key={i} className="absolute left-1/2 top-1/2 h-[3px] w-[3px] rounded-full bg-white/80"
                                      initial={{ x: Math.cos(a) * 40 * 2.2, y: Math.sin(a) * 40 * 2.2, opacity: 0.9 }}
                                      animate={{ x: Math.cos(a) * r * 3.4, y: Math.sin(a) * r * 3.4 - 10, opacity: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }} />
                })}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[2%] w-[2%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />
        </div>
        {/* 톤암: 큐잉 중엔 들린 채(그림자가 멀어지고 머리가 커진다) 넘어오고, 끝나면 내려앉는다 */}
        <motion.div className="absolute right-[7%] top-[8%] h-[74%] w-[9%] origin-[50%_8%]" aria-hidden
                    animate={{ rotate: armAngle }} transition={cueing ? { type: 'spring', stiffness: 70, damping: 14 } : { type: 'spring', stiffness: 36, damping: 11 }}>
          <motion.div className="absolute inset-0" animate={{ scale: cueing ? 1.035 : 1, filter: cueing ? 'drop-shadow(0 14px 10px rgba(0,0,0,0.55))' : 'drop-shadow(0 3px 3px rgba(0,0,0,0.5))' }}
                      transition={{ duration: 0.25 }}>
            <div className="absolute left-1/2 top-0 aspect-square w-[95%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f4f4f4,#7d7d80)] shadow-lg" />
            <div className="absolute left-1/2 top-[7%] h-[82%] w-[13%] -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,#8a8a8d,#f2f2f2,#8a8a8d)]" />
            <div className="absolute bottom-[3%] left-1/2 h-[10%] w-[52%] -translate-x-[70%] rotate-[-16deg] rounded-[3px] bg-[#1a1a1c] shadow" />
          </motion.div>
        </motion.div>
        {/* 속도 표시 · 전원 */}
        <div className="absolute bottom-[7%] right-[6%] flex items-center gap-2 text-[11px] text-white/45">
          <span className={`h-1.5 w-1.5 rounded-full ${p.playing ? 'bg-white shadow-[0_0_8px_white]' : 'bg-white/25'}`} />33⅓
        </div>
      </motion.div>
    )
  })
Turntable.displayName = 'Turntable'
