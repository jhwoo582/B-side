export type Reaction = 'like' | 'dislike' | 'known'
export type NextAction = 'more' | 'later' | 'stop'
export interface Feedback {
  reaction?: Reaction | null
  aspects?: Record<string, number>
  next?: NextAction | null
  source_good?: boolean
  reason: string
}
export const ASPECTS = ['보컬', '사운드', '분위기', '가사']   // 백엔드 키 (화면엔 ASPECT_LABEL)
export const ASPECT_LABEL: Record<string, string> = { '보컬': '보컬', '사운드': '사운드', '분위기': '분위기', '가사': '가사' }
/** 연결 종류(백엔드 키) → 화면 라벨 */
export const EDGE_LABEL: Record<string, string> = { '본인 발언': '본인 언급', '평론': '평론', '평론가 비교': '평론 비교', '협업': '협업', '멤버': '멤버 연결' }
export const NEXT_LABEL: Record<NextAction, { label: string; hint: string }> = {
  more: { label: '더 찾아보기', hint: '오늘 밤 여기서 출발해요' },
  later: { label: '나중에', hint: '담아 둘게요' },
  stop: { label: '그만', hint: '다시 가져오지 않을게요' },
}
export interface TasteNote { id: string; text: string; evidence: string[]; evidence_view?: string[]; by: 'agent' | 'user' }
/** 대화에서 받아 적은 취향 신호 */
export interface TasteSignal { id: string; kind: 'like' | 'less' | 'mood'; text: string; axis?: string | null; polarity: number; said?: string; artist?: string | null; date: string; source: string }
export interface TasteType {
  code: string; base: string; name: string; line: string; genres: string[]; artists: string[]; unknown: string[]; mine: string[]
  axes: { key: string; label: string; left: string; right: string; value: number; known: boolean; letter: string; evidence: number; weak: boolean; assumed: string | null }[]
}
export interface Taste { notes: TasteNote[]; rejected: string[]; updated: string | null; refreshing: boolean; signals: TasteSignal[]; radar: { axis: string; value: number; evidence: number }[]; summary: string | null; type: TasteType }

export interface Verify { verbatim: boolean; supports: boolean; reason: string; via?: string }
export interface Claim {
  quote: string
  source_url: string
  source_type?: string
  source_name?: string
  edge_type?: string
  verify?: Verify
}
export interface Hop { from: string; edge: string; to: string; connection?: string }
export interface Track {
  title?: string
  video_id?: string
  url?: string
  thumb?: string
  album?: string
  artist?: string
  note?: string | null
  shelf?: { title: string; heard: boolean }[]   // 숨은 곡: 이 아티스트 인기곡 중 들은 곡 / 안 들은 곡
}
export interface Candidate {
  kind: 'new' | 'hidden_track'
  artist: string
  artist_ko?: string
  monthly_listeners?: number | null
  track?: Track | null
  path: Hop[]
  claims: Claim[]
  retries?: number
  note?: string
  feedback?: Feedback & { at: string }
  why?: string
  reply_to?: { artist: string; objection: string; reply: string }
  more_evidence?: { quote: string; url: string; source_name: string; host: string; kind: '인터뷰' | '리뷰' | '기사'; speaker: string; context?: string }[]   // 이어지는 글
  from_lead?: boolean
  from_chat?: { said: string; direction: string }   // 도우미와의 대화로 방향을 틀어 찾아온 판   // 지도에서 '오늘 밤 여기로' 고른 곳에서 찾은 판
  display?: { title: string; pull: string; speaker: string; role: string }
  why_by?: 'writer' | 'template'
  sources?: { label: string; url: string; quote: string | null; kind: string; excerpt?: { before: string; quote: string; after: string } }[]
}
export interface Rejection {
  artist: string
  stage: string
  reason: string
  claims?: (Verify & { quote: string; source_url: string; closest_in_source?: string; similarity?: number })[]
}
export interface Brief {
  date: string
  seeds: string[]
  run: {
    models: { researcher: string; judge: string }
    tool_calls: number
    tool_errors: number
    cost_usd: number
    seconds: number
    pages_read: number
    accepted: number
    rejected: number
    verbatim_failures: number
    stop_reason: string
    auth_warning?: string | null
  }
  candidates: Candidate[]
  rejections: Rejection[]
  playlist: { url?: string; title?: string; error?: string } | null
}

export interface GraphNode {
  id: string
  slug: string
  name_ko?: string
  role: 'seed' | 'candidate'
  status?: string
  reaction?: Reaction
  next?: NextAction
  first_seen: string
  thumb?: string
}
export interface GraphEdge { source: string; target: string; edge: string; date: string; connection?: string; dir?: 'root' | 'branch' }
/** 미개척지: 리서처가 보고 지나친 이름. 지도에 흐린 별로 남고, 고르면 다음 디깅의 방향이 된다 */
export interface Lead {
  id: string; name: string; name_ko?: string; from: string; kind: 'interview' | 'critic'; direction: 'root' | 'branch'
  hint: string; quote?: string; url?: string; source_name?: string; thumb?: string; status: 'open' | 'queued'; note?: string
}
export interface WikiPage {
  slug: string
  markdown: string
  meta: {
    name: string
    name_ko?: string
    role: string
    status: string
    first_seen: string
    thumb?: string
    paths?: (Claim & { date: string; from: string; edge: string; connection?: string })[]
    reactions?: { date: string; reaction: Reaction; reason?: string }[]
    next_links?: string[]
  }
}
export interface LogEvent { ts: string; kind: string; [k: string]: unknown }

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`)
  return r.json()
}

export const api = {
  latest: () => fetch('/api/briefs/latest').then(j<Brief>),
  brief: (d: string) => fetch(`/api/briefs/${d}`).then(j<Brief>),
  briefs: () => fetch('/api/briefs').then(j<{ date: string; count: number }[]>),
  graph: () => fetch('/api/wiki/graph').then(j<{ nodes: GraphNode[]; edges: GraphEdge[] }>),
  page: (slug: string) => fetch(`/api/wiki/${encodeURIComponent(slug)}`).then(j<WikiPage>),
  log: (d: string) => fetch(`/api/logs/${d}`).then(j<LogEvent[]>),
  feedback: (body: Feedback & { date: string; artist: string }) =>
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j<{ ok: boolean }>),
  taste: () => fetch('/api/taste').then(j<Taste>),
  removeSignal: (id: string) => fetch(`/api/taste/signal/${id}`, { method: 'DELETE' }).then(j<Taste>),
  tasteRefresh: () => fetch('/api/taste/refresh', { method: 'POST' }).then(j<{ notes: TasteNote[] }>),
  tasteEdit: (id: string, text: string) =>
    fetch(`/api/taste/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).then(j<{ notes: TasteNote[] }>),
  tasteRemove: (id: string) => fetch(`/api/taste/${id}`, { method: 'DELETE' }).then(j<{ notes: TasteNote[] }>),
  listen: (artist: string, signal: 'full' | 'skip', seconds: number) =>
    fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist, signal, seconds }) }).then(j<{ recorded: boolean }>),
  run: (target = 8) =>
    fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) }).then(j<{ started: boolean }>),
  frontier: () => fetch('/api/frontier').then(j<Lead[]>),
  setLead: (id: string, status: 'open' | 'queued' | 'dismissed') =>
    fetch(`/api/frontier/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).then(j<Lead>),
  digLeads: () => fetch('/api/frontier-dig', { method: 'POST' }).then(j<{ started: boolean }>),
}

/** POST로 SSE 받기 (EventSource는 GET만 된다) */
export async function postStream(url: string, body: unknown, onEvent: (event: string, data: any) => void, signal?: AbortSignal) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`)
  const reader = r.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split(/\r?\n\r?\n/)
    buf = parts.pop() ?? ''
    for (const part of parts) {
      let ev = 'message', data = ''
      for (const line of part.split(/\r?\n/)) {
        if (line.startsWith('event:')) ev = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) onEvent(ev, JSON.parse(data))
    }
  }
}

export const proxied = (url?: string | null) => (url ? `/api/img?url=${encodeURIComponent(url)}` : undefined)

export const EDGE_COLOR: Record<string, string> = {
  '본인 발언': 'var(--edge-statement)',
  '평론': 'var(--edge-critic)',
  '평론가 비교': 'var(--edge-critic)',
  '협업': 'var(--edge-collab)',
  '멤버': 'var(--edge-collab)',
}
export const EDGE_HEX: Record<string, string> = {
  '본인 발언': '#ff8f7a', '평론': '#93b6ff', '평론가 비교': '#93b6ff', '협업': '#f2c46a', '멤버': '#f2c46a',
}

/** 이름 → 결정적인 슬리브 팔레트 (앨범아트가 없을 때 자동 생성 슬리브용) */
const SLEEVES = [
  ['#c8402a', '#efe6d6', '#1d1a16'], ['#2c4f8c', '#e9dfc9', '#d9a227'], ['#2f6f6a', '#f1e3c4', '#1d1a16'],
  ['#d9a227', '#1d1a16', '#c8402a'], ['#1d1a16', '#efe6d6', '#c8402a'], ['#8a4f7d', '#f3e7d3', '#1d1a16'],
]
export function sleevePalette(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SLEEVES[h % SLEEVES.length]
}

export const REACTION_LABEL: Record<Reaction, { label: string; emoji: string; color: string }> = {
  like: { label: '더 듣고 싶어요', emoji: '♥', color: '#ff7a66' },
  dislike: { label: '별로예요', emoji: '–', color: '#a89a88' },
  known: { label: '이미 알아요', emoji: '✓', color: '#86cbbb' },
}
