/** 내 취향: 레이더(보컬·사운드·분위기·가사·에너지) + 다듬은 한두 문장 + 대화에서 받아 적은 신호 칩.
 *  신호는 다음 추천(지금 한 판 더, 오늘 밤 디깅, 좋아할 것 같은 이유)에 그대로 들어간다. 틀렸으면 칩을 지우면 된다.
 *  반응 기록으로 에이전트가 쓴 메모는 아래 '메모'에 접혀 있다. */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type Taste, type TasteSignal } from '../api'
import { TasteTypeCard } from './TasteType'

const KIND: Record<TasteSignal['kind'], { label: string; chip: string; dot: string }> = {
  like: { label: '좋아하는 것', chip: 'bg-[#ff8f7a]/15 text-[#ffc3b8] ring-[#ff8f7a]/40', dot: 'bg-[#ff8f7a]' },
  less: { label: '덜 듣고 싶은 것', chip: 'bg-white/[0.06] text-white/70 ring-white/20', dot: 'bg-white/40' },
  mood: { label: '요즘 기분', chip: 'bg-[#93b6ff]/15 text-[#c4d6ff] ring-[#93b6ff]/40', dot: 'bg-[#93b6ff]' },
}

export function TasteNotes({ onClose }: { onClose: () => void }) {
  const [t, setT] = useState<Taste | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const load = () => api.taste().then((d) => { setT(d); setRefreshing(d.refreshing) }).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => {   // 대화로 취향이 바뀌면 다시 읽는다
    const re = () => load()
    window.addEventListener('taste:changed', re)
    return () => window.removeEventListener('taste:changed', re)
  }, [])
  useEffect(() => {
    if (!refreshing) return
    const id = setInterval(load, 2500)
    return () => clearInterval(id)
  }, [refreshing])

  async function refresh() { setRefreshing(true); try { await api.tasteRefresh() } finally { load() } }
  async function drop(id: string) { setT(await api.removeSignal(id)) }
  async function saveEdit() { if (!editing) return; await api.tasteEdit(editing.id, editing.text); setEditing(null); load() }
  async function removeNote(id: string) { await api.tasteRemove(id); load() }

  const groups = (['like', 'less', 'mood'] as const).map((k) => ({ k, items: (t?.signals ?? []).filter((x) => x.kind === k) })).filter((g) => g.items.length)
  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                  className="fixed bottom-6 right-5 top-20 z-40 flex w-[min(400px,calc(100%-2.5rem))] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0d0b15]/85 backdrop-blur-2xl lg:right-10">
      <header className="flex items-center justify-between px-6 pb-1 pt-5">
        <h3 className="text-[20px] font-black tracking-[-0.03em]">내 취향</h3>
        <div className="flex items-center gap-1">
          <button onClick={refresh} disabled={refreshing} className="h-8 whitespace-nowrap rounded-full border border-white/20 px-3 text-[12px] hover:border-white/50 disabled:opacity-50">
            {refreshing ? '정리 중…' : '다시 정리'}
          </button>
          <button onClick={onClose} aria-label="닫기" className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {!t ? <div className="py-6 text-white/50">불러오는 중…</div> : (
          <>
            <div className="pt-2"><TasteTypeCard t={t.type} /></div>

            {groups.length > 0 && (
              <div className="mt-7 space-y-4 border-t border-white/10 pt-5">
                {groups.map((g) => (
                  <section key={g.k}>
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-white/45"><span className={`h-1.5 w-1.5 rounded-full ${KIND[g.k].dot}`} />{KIND[g.k].label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      <AnimatePresence initial={false}>
                        {g.items.map((x) => (
                          <motion.span key={x.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                                       title={x.said ? `“${x.said}”${x.artist ? ` · ${x.artist} 앞에서` : ''} · ${x.date}` : x.date}
                                       className={`inline-flex h-8 items-center gap-1 rounded-full pl-3 pr-1.5 text-[13.5px] ring-1 ${KIND[g.k].chip}`}>
                            {x.text}
                            <button onClick={() => drop(x.id)} aria-label={`${x.text} 지우기`} title="지우기"
                                    className="grid h-6 w-6 place-items-center rounded-full bg-white/10 opacity-80 transition hover:bg-white/25 hover:opacity-100">
                              <svg width="9" height="9" viewBox="0 0 14 14" aria-hidden><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                            </button>
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                ))}
                <p className="text-[12px] leading-relaxed text-white/40">도우미와 나눈 이야기에서 받아 적었어요. 다음 추천이 이걸 따라요. 틀린 건 × 로 지우면 바로 빠져요.</p>
              </div>
            )}

            {t.notes.length > 0 && (
              <section className="mt-6 border-t border-white/10 pt-4">
                <button onClick={() => setMemoOpen((o) => !o)} className="flex w-full items-center justify-between text-[13px] text-white/60 hover:text-white">
                  <span>음악마다 남긴 메모 {t.notes.length}개</span><span className={`transition-transform ${memoOpen ? 'rotate-90' : ''}`} aria-hidden>›</span>
                </button>
                <AnimatePresence initial={false}>
                  {memoOpen && (
                    <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      {t.notes.map((n) => (
                        <li key={n.id} className="group border-t border-white/[0.06] py-2.5 first:mt-2 first:border-0">
                          {editing?.id === n.id ? (
                            <div>
                              <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={2} maxLength={200}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } if (e.key === 'Escape') setEditing(null) }}
                                        className="w-full resize-none rounded-xl bg-white/10 px-3 py-2 text-[14px] outline-none" />
                              <div className="mt-1 flex gap-3 text-[12px]"><button onClick={saveEdit} className="font-semibold">저장</button><button onClick={() => setEditing(null)} className="text-white/60">취소</button></div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <p className="flex-1 text-[14px] leading-relaxed text-white/80">{n.text}{n.by === 'user' && <span className="ml-1.5 text-[11px] text-white/45">수정함</span>}</p>
                              <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                                <button onClick={() => setEditing({ id: n.id, text: n.text })} className="rounded-full px-2 py-0.5 text-[12px] text-white/60 hover:bg-white/10 hover:text-white">수정</button>
                                <button onClick={() => removeNote(n.id)} className="rounded-full px-2 py-0.5 text-[12px] text-white/60 hover:bg-white/10 hover:text-white">{n.by === 'agent' ? '아니에요' : '삭제'}</button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </section>
            )}
          </>
        )}
      </div>
    </motion.aside>
  )
}
