/** 지도 겹치기: 친구의 디깅 지도와 내 지도를 비교한다. 숫자보다 '같은 판, 다른 길'과 주고받을 판이 주인공. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EDGE_HEX, EDGE_LABEL, proxied } from '../api'
import { GeneratedSleeve } from './SleeveArt'

interface Friend { slug: string; owner: string; exported: string; artists: number }
interface Gift { artist: string; name_ko?: string; thumb?: string; from?: string; edge?: string; quote?: string; liked_for: string[] }
interface Same { artist: string; name_ko?: string; thumb?: string; different_path: boolean
  mine: { from?: string; edge?: string; reaction?: string }; theirs: { from?: string; edge?: string; reaction?: string } }
interface Result {
  friend: { owner: string }; score: number
  parts: { known_overlap: { value: number; shared: number }; digging_style: number; liked_aspects: number }
  same_record_different_path: Same[]; from_friend: Gift[]; to_friend: Gift[]; notes: { common: string; different: string } | null
}

const Thumb = ({ src, name }: { src?: string; name: string }) =>
  <div className="h-12 w-12 shrink-0 overflow-hidden shadow">{src ? <img src={proxied(src)} alt="" className="h-full w-full object-cover" /> : <GeneratedSleeve name={name} />}</div>
const Edge = ({ e }: { e?: string }) => <span className="text-[11px]" style={{ color: EDGE_HEX[e ?? ''] }}>{EDGE_LABEL[e ?? ''] ?? e}</span>

export function CompareMaps({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [res, setRes] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const loadFriends = () => fetch('/api/friends').then((r) => r.json()).then(setFriends)
  useEffect(() => { if (open) loadFriends() }, [open])
  useEffect(() => {
    if (!sel) return
    setBusy(true); setRes(null); setErr(null)
    fetch(`/api/compare/${sel}`).then(async (r) => (r.ok ? setRes(await r.json()) : setErr('지도를 겹쳐 보지 못했어요.'))).finally(() => setBusy(false))
  }, [sel])

  async function upload(f: File) {
    try {
      const data = JSON.parse(await f.text())
      const r = await fetch('/api/friends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!r.ok) throw new Error((await r.json()).detail)
      const { slug } = await r.json(); await loadFriends(); setSel(slug)
    } catch (e) { setErr(`파일을 읽지 못했어요: ${(e as Error).message}`) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 30 }} animate={{ y: 0 }}
                      className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/50 shadow-2xl backdrop-blur-2xl">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
              <div>
                                <h3 className="text-2xl font-black tracking-[-0.03em]">지도 겹쳐 보기</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {friends.map((f) => (
                  <button key={f.slug} onClick={() => setSel(f.slug)} className={`rounded-full border px-3 py-1 ${sel === f.slug ? 'border-ink bg-ink text-paper' : 'border-ink/30 hover:border-ink'}`}>{f.owner}</button>
                ))}
                <button onClick={() => file.current?.click()} className="rounded-full border border-dashed border-white/40 px-3 py-1 hover:border-white">친구 지도 가져오기</button>
                <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <a href="/api/map/export" className="rounded-full bg-white px-3 py-1 font-semibold text-black">내 지도 내보내기</a>
                <button onClick={onClose} className="ml-1 text-2xl leading-none hover:text-stamp" aria-label="닫기">×</button>
              </div>
            </header>

            <div className="overflow-y-auto px-6 py-5">
              {!sel && <p className="py-10 text-center text-ink-soft">친구를 고르거나 친구가 보낸 지도 파일을 가져오세요. 내 지도는 ‘내 지도 내보내기’로 공유할 수 있어요.</p>}
              {busy && <p className="py-10 text-center text-white/60">겹쳐 보는 중…</p>}
              {err && <p className="py-4 text-center text-stamp">{err}</p>}
              {res && (
                <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
                  {/* 점수와 그 이유 */}
                  <aside>
                    <div className="relative mx-auto h-40 w-56">
                      <div className="absolute left-0 top-2 flex h-36 w-36 items-start justify-start rounded-full bg-stamp/25 p-5 font-semibold">나</div>
                      <div className="absolute right-0 top-2 flex h-36 w-36 items-start justify-end rounded-full bg-critic/25 p-5 font-semibold">{res.friend.owner}</div>
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                        <div className="font-display text-4xl font-black">{res.score}</div>
                        <div className="font-mono text-[9px] tracking-widest">/ 100</div>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-[12px]">
                      <li className="flex justify-between"><span>둘 다 아는 아티스트</span><b>{res.parts.known_overlap.shared}</b></li>
                      <li className="flex justify-between"><span>찾아가는 방식</span><b>{Math.round(res.parts.digging_style * 100)}%</b></li>
                      <li className="flex justify-between"><span>마음이 가는 곳</span><b>{res.parts.liked_aspects ? `${Math.round(res.parts.liked_aspects * 100)}%` : '아직 몰라요'}</b></li>
                    </ul>
                    {res.notes && (
                      <div className="mt-4 rounded-2xl bg-white/10 p-3 text-[14px] leading-snug shadow">
                        <div>공통점: {res.notes.common}</div>
                        <div className="mt-1">차이점: {res.notes.different}</div>
                      </div>
                    )}
                  </aside>

                  <div className="space-y-6">
                    <section>
                      <h4 className="text-[13px] font-semibold text-white/70">같은 음악, 다른 길</h4>
                      {res.same_record_different_path.length === 0 && <p className="mt-1 text-sm text-ink-faint">아직 겹치는 음악이 없어요.</p>}
                      {res.same_record_different_path.map((x) => (
                        <div key={x.artist} className="mt-2 flex items-center gap-3">
                          <Thumb src={x.thumb} name={x.artist} />
                          <div className="min-w-0 text-[13px]">
                            <div className="font-display text-lg font-bold">{x.name_ko || x.artist}</div>
                            <div>나 <b>{x.mine.from}</b> <Edge e={x.mine.edge} /> · {res.friend.owner} <b>{x.theirs.from}</b> <Edge e={x.theirs.edge} /></div>
                            {!x.different_path && x.mine.edge !== x.theirs.edge && <div className="text-[11px] text-ink-faint">출발점은 같고 이유가 달라요</div>}
                          </div>
                        </div>
                      ))}
                    </section>
                    {[['from_friend', `${res.friend.owner}에게서`, '친구는 좋아했고 나는 아직 못 들은 음악'], ['to_friend', `${res.friend.owner}에게`, '나는 좋아했고 친구는 아직 못 들은 음악']].map(([k, title, sub]) => {
                      const list = res[k as 'from_friend' | 'to_friend']
                      return (
                        <section key={k}>
                          <h4 className="text-[13px] font-semibold text-white/70">{title} <span className="font-normal text-white/45">{sub}</span></h4>
                          {list.length === 0 && <p className="mt-1 text-sm text-ink-faint">아직 없어요.</p>}
                          {list.map((g) => (
                            <div key={g.artist} className="mt-2 flex items-start gap-3">
                              <Thumb src={g.thumb} name={g.artist} />
                              <div className="min-w-0 text-[13px]">
                                <div className="font-display text-lg font-bold">{g.name_ko || g.artist}
                                  {!!g.liked_for.length && <span className="ml-2 font-sans text-[11px] font-normal text-stamp">♥ {g.liked_for.join('·')}</span>}</div>
                                <div className="text-ink-soft">{g.from} <Edge e={g.edge} /></div>
                                {g.quote && <div className="mt-0.5 line-clamp-2 font-serif text-[12px] text-ink-soft">“{g.quote}”</div>}
                              </div>
                            </div>
                          ))}
                        </section>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
