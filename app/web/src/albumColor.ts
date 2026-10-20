/** 앨범아트에서 화면 전체를 물들일 팔레트를 뽑는다 (색감 ①: 앨범색 전체).
 *  작은 k-means로 대표색 3개를 고르고, 배경용으로 어둡게 만든 base와 글자·버튼용 밝은 accent를 만든다. */
import { useEffect, useState } from 'react'
import { proxied } from './api'

export type RGB = [number, number, number]
export interface AlbumPalette { base: RGB; c1: RGB; c2: RGB; c3: RGB; accent: RGB }

export const DEFAULT_PALETTE: AlbumPalette = {
  base: [22, 14, 18], c1: [120, 40, 60], c2: [40, 50, 110], c3: [170, 90, 60], accent: [255, 196, 170],
}
const cache = new Map<string, AlbumPalette>()

const lum = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const sat = ([r, g, b]: RGB) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0 }
const scale = (c: RGB, k: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as RGB
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB

/** 채도를 끌어올린다: 회색 평균에서 각 채널을 k배 멀어지게 (알록달록한 그림이 회색으로 뭉개지지 않게) */
function saturate(c: RGB, k: number): RGB {
  const m = (c[0] + c[1] + c[2]) / 3
  return c.map((v) => Math.max(0, Math.min(255, Math.round(m + (v - m) * k)))) as RGB
}

/** 배경에 깔 색: 채도를 올리고 밝기를 일정 범위로 눌러서 흰 글자가 항상 읽히게 (WCAG 4.5:1 근처) */
function forBackground(c: RGB, target = 0.16): RGB {
  const s = saturate(c, sat(c) < 0.25 ? 2.2 : 1.5)
  const l = lum(s) || 0.01
  return scale(s, Math.min(1.4, target / l))
}

export async function albumPalette(url?: string | null): Promise<AlbumPalette> {
  const src = proxied(url)
  if (!src) return DEFAULT_PALETTE
  if (cache.has(src)) return cache.get(src)!
  const img = new Image()
  img.src = src
  try { await img.decode() } catch { return DEFAULT_PALETTE }
  const n = 36
  const cv = document.createElement('canvas'); cv.width = cv.height = n
  const g = cv.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, n, n)
  const d = g.getImageData(0, 0, n, n).data
  const px: RGB[] = []
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]])

  // k-means (k=4, 8회). 너무 하얗거나 까만 픽셀은 가중치를 낮춘다
  let cent: RGB[] = [px[0], px[Math.floor(px.length / 3)], px[Math.floor((2 * px.length) / 3)], px[px.length - 1]]
  let groups: { c: RGB; w: number }[] = []
  for (let it = 0; it < 8; it++) {
    const acc = cent.map(() => ({ r: 0, g: 0, b: 0, w: 0 }))
    for (const p of px) {
      let bi = 0, bd = Infinity
      cent.forEach((c, i) => { const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (dd < bd) { bd = dd; bi = i } })
      const l = lum(p), w = l < 0.06 || l > 0.94 ? 0.25 : 1
      acc[bi].r += p[0] * w; acc[bi].g += p[1] * w; acc[bi].b += p[2] * w; acc[bi].w += w
    }
    cent = acc.map((a, i) => (a.w ? [a.r / a.w, a.g / a.w, a.b / a.w] as RGB : cent[i]))
    groups = acc.map((a, i) => ({ c: cent[i].map(Math.round) as RGB, w: a.w }))
  }
  // 많이 쓰였고 채도 있는 색 순서
  groups.sort((a, b) => b.w * (0.15 + sat(b.c) ** 1.5) - a.w * (0.15 + sat(a.c) ** 1.5))
  const [g1, g2, g3] = groups.map((x) => x.c)
  const vivid = [...groups].sort((a, b) => sat(b.c) * Math.sqrt(b.w) - sat(a.c) * Math.sqrt(a.w))[0].c
  const pal: AlbumPalette = {
    base: forBackground(g1, 0.05),
    c1: forBackground(g1, 0.17),
    c2: forBackground(g2 ?? g1, 0.15),
    c3: forBackground(g3 ?? vivid, 0.22),
    accent: mix(vivid, [255, 255, 255], 0.55),   // 버튼·강조 글자: 앨범의 가장 선명한 색을 밝게
  }
  cache.set(src, pal)
  return pal
}

type Listener = (p: AlbumPalette) => void
const listeners = new Set<Listener>()
let current = DEFAULT_PALETTE
export const onPalette = (fn: Listener) => { listeners.add(fn); fn(current); return () => { listeners.delete(fn) } }

/** 지금 손에 든 판의 팔레트를 화면 전체(셰이더 배경 + CSS 토큰)에 적용 */
export function useAlbumPalette(url?: string | null): AlbumPalette {
  const [p, setP] = useState(current)
  useEffect(() => {
    let alive = true
    albumPalette(url).then((x) => {
      if (!alive) return
      current = x
      setP(x)
      const root = document.documentElement.style
      root.setProperty('--album', x.accent.join(' '))
      root.setProperty('--album-base', x.base.join(' '))
      root.setProperty('--album-c1', x.c1.join(' '))
      listeners.forEach((fn) => fn(x))
    })
    return () => { alive = false }
  }, [url])
  return p
}

export const rgb = ([r, g, b]: RGB, a = 1) => (a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`)
export const rgbHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
