/** 판 뒤로 흐르는 거대한 아티스트 이름 (레퍼런스 3번 SIRUP). 판이 바뀌면 이름이 갈아 끼워지며 흐름이 이어진다. */
import { AnimatePresence, motion } from 'motion/react'

export function BigName({ name }: { name: string }) {
  const row = Array.from({ length: 6 }, () => name).join('   ')
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <AnimatePresence mode="popLayout">
        <motion.div key={name} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -40 }}
                    transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}>
          <div className="marquee flex w-max whitespace-nowrap text-[clamp(90px,17vw,260px)] font-black leading-none tracking-[-0.04em] text-white/[0.14]">
            <span className="pr-[0.4em]">{row}</span><span className="pr-[0.4em]">{row}</span>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
