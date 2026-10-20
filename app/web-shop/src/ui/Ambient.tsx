/** 지금 판의 앨범아트를 크게 흐려 화면 뒤에 천천히 돌린다. 판이 바뀌면 교차로 바뀐다 */
import { AnimatePresence, motion } from 'motion/react'
import { proxied } from '../api'

export function Ambient({ src }: { src?: string | null }) {
  const url = proxied(src)
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-black">
      <AnimatePresence initial={false}>
        {url && (
          <motion.div key={url} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4, ease: 'easeOut' }}>
            <img src={url} alt="" className="absolute left-[-25%] top-[-35%] h-[130%] w-[90%] object-cover opacity-70 [filter:blur(110px)_saturate(1.8)]"
                 style={{ animation: 'drift 90s linear infinite' }} />
            <img src={url} alt="" className="absolute bottom-[-40%] right-[-20%] h-[120%] w-[80%] object-cover opacity-55 [filter:blur(120px)_saturate(1.6)_hue-rotate(-12deg)]"
                 style={{ animation: 'drift 120s linear infinite reverse' }} />
          </motion.div>
        )}
      </AnimatePresence>
      {/* 글자가 읽히도록 가장자리와 아래를 어둡게 */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,transparent_0,rgb(0_0_0/0.35)_55%,rgb(0_0_0/0.85)_100%)]" />
      <div className="absolute inset-0 bg-black/25" />
    </div>
  )
}
