/** 앱 전체에서 쓰는 작은 약속들: 연결 종류 색, 이름 표기, 앨범아트, 로고 */
import { useState } from 'react'
import { proxied, sleevePalette, type Candidate } from '../api'

export const EDGE: Record<string, { label: string; color: string }> = {
  '본인 발언': { label: '본인 언급', color: '#ff8fb1' },
  '평론': { label: '평론', color: '#86b8ff' },
  '평론가 비교': { label: '평론 비교', color: '#86b8ff' },
  '협업': { label: '협업', color: '#ffd27a' },
  '멤버': { label: '멤버', color: '#ffd27a' },
}
export const edgeOf = (e?: string) => EDGE[e ?? ''] ?? { label: e ?? '', color: '#d6d6d6' }

export const nameOf = (c: Candidate) => c.artist_ko || c.artist

/** 영문 이름 → 한글 이름 (위키에 있으면). 앱이 지도를 불러올 때 채운다 */
const KO = new Map<string, string>()
export const setKoNames = (pairs: [string, string | undefined][]) => pairs.forEach(([en, ko]) => ko && KO.set(en, ko))
export const ko = (name?: string | null) => (name ? KO.get(name) ?? name : '')

/** 점원의 말: 템플릿 문장은 괄호 속 연결 설명(경로에 이미 보인다)을 덜어낸다 */
export function clerkLine(c: Candidate) {
  let w = c.why ?? ''
  if (c.why_by === 'template') w = w.replace(/\s*\([^)]*\)/g, '')
  return w.replace(/판이에요/g, '음악이에요').replace(/이 판/g, '이 음악').trim()
}

/** 원문을 감싼 따옴표를 벗긴다. 짝이 맞는 감싸기, 또는 짝 없이 앞·뒤에만 붙은 따옴표만 (원문 안의 ‘…’는 그대로) */
export function unquote(s: string) {
  let t = s.trim()
  const pair: Record<string, string> = { '“': '”', '"': '"', '‘': '’', "'": "'" }
  const count = (str: string, ch: string) => str.split(ch).length - 1
  if (pair[t[0]] && t.endsWith(pair[t[0]]) && t.length > 2) t = t.slice(1, -1).trim()
  const open = t[0], close = pair[open]
  if (close && (open === close ? count(t, open) % 2 === 1 : !t.slice(1).includes(close))) t = t.slice(1).trim()
  const last = t[t.length - 1]
  const opener = Object.keys(pair).find((k) => pair[k] === last)
  if (opener && (opener === last ? count(t, last) % 2 === 1 : !t.slice(0, -1).includes(opener))) t = t.slice(0, -1).trim()
  return t
}

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
export const fmtTime = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')
export const fmtDate = (d: string, weekday = true) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('ko-KR', weekday ? { month: 'long', day: 'numeric', weekday: 'long' } : { month: 'long', day: 'numeric' })

/** 앨범아트. 없으면 가게에서 찍은 타이포 슬리브 */
export function Art({ c, className = '', eager = false }: { c: Candidate; className?: string; eager?: boolean }) {
  const [broken, setBroken] = useState(false)
  const src = proxied(c.track?.thumb)
  if (src && !broken) {
    return <img src={src} alt="" draggable={false} loading={eager ? 'eager' : 'lazy'} onError={() => setBroken(true)} className={`h-full w-full select-none object-cover ${className}`} />
  }
  const [bg, fg, accent] = sleevePalette(c.artist)
  return (
    <div className={`relative flex h-full w-full items-end overflow-hidden p-[9%] ${className}`} style={{ background: bg, color: fg, containerType: 'inline-size' }}>
      <div className="absolute -right-[18%] -top-[18%] aspect-square w-[72%] rounded-full" style={{ background: accent }} />
      <div className="relative text-[clamp(10px,13cqw,56px)] font-extrabold leading-[0.95] tracking-[-0.04em]">{nameOf(c)}</div>
    </div>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11.5" fill="#fff" />
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="#000" strokeOpacity=".16" strokeWidth=".5" />
      <circle cx="12" cy="12" r="6.8" fill="none" stroke="#000" strokeOpacity=".16" strokeWidth=".5" />
      <circle cx="12" cy="12" r="4.3" fill="rgb(var(--album))" />
      <circle cx="12" cy="12" r="1.1" fill="#000" />
    </svg>
  )
}

/** 판 한 장: 라벨에 앨범아트 */
export function Vinyl({ c, spinning, className = '' }: { c: Candidate; spinning: boolean; className?: string }) {
  return (
    <div className={`vinyl spin relative ${className}`} style={{ animationPlayState: spinning ? 'running' : 'paused' }}>
      <div className="absolute inset-[33%] overflow-hidden rounded-full ring-1 ring-black/40"><Art c={c} /></div>
      <div className="absolute left-1/2 top-1/2 h-[3.5%] w-[3.5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />
    </div>
  )
}

/** 시리 오브: 점원이 찾는 동안 숨 쉬듯 도는 구슬 (원래 앱 app/web의 것 그대로) */
export function Orb({ size = 22, active = true }: { size?: number; active?: boolean }) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 rounded-full ${active ? 'orb-spin' : ''}`}
          style={{ width: size, height: size, background: 'conic-gradient(from 0deg, #ff8f7a, #b48cff, #6fa8ff, #7fe3c4, #ff8f7a)', filter: 'blur(0.3px) saturate(1.2)' }}>
      <span className="absolute inset-[18%] rounded-full bg-[#0b0912]/55 blur-[2px]" />
      <span className={`absolute inset-0 rounded-full ${active ? 'orb-breathe' : ''}`} style={{ boxShadow: '0 0 14px 2px rgba(180,140,255,.55)' }} />
    </span>
  )
}
