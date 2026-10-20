/** 크레이트의 칸: 연결 종류별로 판을 모으고, 아는 아티스트의 숨은 곡은 맨 뒤 칸에 */
import type { Candidate } from '../api'
import { edgeOf } from './kit'

export interface Group { key: string; label: string; color: string; start: number; count: number }

const ORDER: { key: string; label: string; edges?: string[] }[] = [
  { key: 'self', label: '본인 언급', edges: ['본인 발언'] },
  { key: 'critic', label: '평론', edges: ['평론', '평론가 비교'] },
  { key: 'collab', label: '협업', edges: ['협업', '멤버'] },
  { key: 'hidden', label: '숨은 곡' },
]

const keyOf = (c: Candidate) => {
  const e = c.path[0]?.edge
  if (c.kind === 'hidden_track' || !e) return 'hidden'
  return ORDER.find((g) => g.edges?.includes(e))?.key ?? `edge:${e}`
}

export function shelve(cands: Candidate[]): { items: Candidate[]; groups: Group[] } {
  const keys = [...ORDER.slice(0, 3).map((g) => g.key), ...new Set(cands.map(keyOf).filter((k) => k.startsWith('edge:'))), 'hidden']
  const items: Candidate[] = []
  const groups: Group[] = []
  for (const k of keys) {
    const inK = cands.filter((c) => keyOf(c) === k)
    if (!inK.length) continue
    const first = inK[0].path[0]?.edge
    groups.push({
      key: k, start: items.length, count: inK.length,
      label: ORDER.find((g) => g.key === k)?.label ?? edgeOf(first).label,
      color: k === 'hidden' ? 'rgb(255 255 255 / 0.55)' : edgeOf(first).color,
    })
    items.push(...inK)
  }
  return { items, groups }
}

export const groupAt = (groups: Group[], i: number) => groups.find((g) => i >= g.start && i < g.start + g.count)
