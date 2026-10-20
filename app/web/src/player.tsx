/** 숨긴 YouTube IFrame 플레이어 하나를 앱 전체에서 공유한다. 탭을 옮겨도 음악이 이어진다.
 *
 * 재생이 되려면 두 가지가 필요하다:
 *  - 플레이어가 충분히 커야 한다 (YouTube는 200×200보다 작은 플레이어의 재생을 막는다) → 240×240을 투명하게 뒤에 둔다
 *  - 클릭 직후(사용자 동작 안에서) 곡을 불러야 한다 → 앱이 열릴 때 플레이어를 미리 만들어 두고, play()는 동기로 loadVideoById
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Candidate } from './api'

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

/** full = 끝까지 들음, skip = 30초 안에 넘김 (둘은 기록), listening = 한동안 듣는 중 (도우미가 묻기만) */
export type Signal = 'full' | 'skip' | 'listening'
const ASK_AFTER = 40

interface PlayerState {
  current: Candidate | null
  playing: boolean
  loading: boolean
  progress: number // 0~1
  duration: number
  error: string | null
  muted: boolean
  lastSignal: { artist: string; signal: Signal } | null
  unmute: () => void
  play: (c: Candidate) => void
  toggle: () => void
  stop: () => void
  /** 도우미가 이 판을 이미 물었거나(asked) 손님이 이미 말했으면(talked) 다시 먼저 묻지 않는다 */
  markAsked: (artist: string, talked?: boolean) => void
  hasTalked: (artist: string) => boolean
}

const Ctx = createContext<PlayerState | null>(null)
export const usePlayer = () => useContext(Ctx)!

let apiPromise: Promise<any> | null = null
function loadYT(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return apiPromise
}

const EMBED_BLOCKED: Record<number, string> = {
  2: '재생할 수 없는 곡이에요',
  5: '이 브라우저에서는 재생할 수 없는 곡이에요',
  100: '삭제되었거나 비공개인 곡이에요',
  101: '외부 재생이 막힌 곡이에요',
  150: '외부 재생이 막힌 곡이에요',
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<any>(null)
  const ready = useRef(false)
  const pending = useRef<string | null>(null)
  const stall = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [current, setCurrent] = useState<Candidate | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [lastSignal, setLastSignal] = useState<{ artist: string; signal: Signal } | null>(null)
  // 청취 자동 기록: 한 곡당 한 번, 끝까지(90%) 들으면 full, 재생 시작 후 30초 안에 넘기면 skip
  // listening: 40초쯤 듣고 있으면 도우미가 먼저 묻는다 (기록은 하지 않는다)
  const listen = useRef<{ artist: string; started: boolean; reported: boolean; asked?: boolean; talked?: boolean } | null>(null)
  const report = (signal: 'full' | 'skip', seconds: number) => {
    const l = listen.current
    if (!l || l.reported || !l.started) return
    l.reported = true
    api.listen(l.artist, signal, Math.round(seconds)).then((r) => { if (r.recorded) setLastSignal({ artist: l.artist, signal }) }).catch(() => {})
  }
  const reportSkipIfEarly = () => {
    const t = player.current?.getCurrentTime?.() ?? 0
    if (t < 30) report('skip', t)
  }
  const requestedAt = useRef(0)   // play()를 부른 시각
  const userPaused = useRef(false) // 사용자가 직접 멈췄는지

  // 앱이 열릴 때 플레이어를 미리 만든다
  useEffect(() => {
    let alive = true
    loadYT().then((YT) => {
      if (!alive || player.current) return
      player.current = new YT.Player(host.current!, {
        height: '240', width: '240',
        playerVars: { controls: 0, playsinline: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: () => {
            ready.current = true
            if (pending.current) { player.current.loadVideoById(pending.current); pending.current = null }
          },
          onStateChange: (e: any) => {
            const S = YT.PlayerState
            if (e.data === S.PLAYING) {
              setPlaying(true); setLoading(false); setError(null); clearStall()
              if (listen.current) listen.current.started = true
            }
            if (e.data === S.ENDED) report('full', player.current.getDuration())
            if (e.data === S.PAUSED || e.data === S.ENDED) setPlaying(false)
            if (e.data === S.BUFFERING) setLoading(true)
          },
          onError: (e: any) => {
            clearStall()
            setError(`${EMBED_BLOCKED[e.data] ?? `재생 오류 (${e.data})`}.`)
            setPlaying(false); setLoading(false)
          },
        },
      })
    })
    const id = setInterval(() => {
      const p = player.current
      if (ready.current && p?.getDuration?.()) {
        setDuration(p.getDuration())
        setProgress(p.getCurrentTime() / p.getDuration())
        if (p.getCurrentTime() / p.getDuration() >= 0.9) report('full', p.getCurrentTime())
        const l = listen.current
        if (l?.started && !l.asked && !l.reported && p.getPlayerState?.() === window.YT?.PlayerState?.PLAYING && p.getCurrentTime() >= ASK_AFTER) {
          l.asked = true
          setLastSignal({ artist: l.artist, signal: 'listening' })
        }
      }
    }, 500)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const clearStall = () => { if (stall.current) clearTimeout(stall.current); stall.current = null }

  const play = useCallback((c: Candidate) => {
    const vid = c.track?.video_id
    if (!vid) { setError('재생할 수 있는 곡이 없어요.'); return }
    if (ready.current) reportSkipIfEarly() // 듣던 곡을 30초 안에 넘겼으면 기록
    listen.current = { artist: c.artist, started: false, reported: false }
    setCurrent(c); setError(null); setLoading(true); setProgress(0); setDuration(0)
    requestedAt.current = performance.now(); userPaused.current = false
    // 클릭 핸들러 안에서 동기로 부른다 (브라우저 자동재생 정책)
    if (ready.current) player.current.loadVideoById(vid)
    else pending.current = vid
    // 브라우저가 소리 있는 재생을 막으면(사파리 등) 상태가 버퍼링 → '시작 안 됨'으로 되돌아간다.
    // 1.8초 뒤에도 재생 중이 아니면 음소거로 먼저 틀고 '소리 켜기' 버튼을 띄운다.
    const req = requestedAt.current
    setTimeout(() => {
      const p = player.current
      if (req !== requestedAt.current || !ready.current || userPaused.current) return
      if (p.getPlayerState() !== window.YT.PlayerState.PLAYING && !p.isMuted()) {
        p.mute(); setMuted(true); p.playVideo()
      }
    }, 1800)
    clearStall()
    stall.current = setTimeout(() => {
      setLoading(false)
      setError('재생이 시작되지 않았어요. 다시 눌러 주세요.')
    }, 8000)
  }, [])

  const toggle = useCallback(() => {
    const p = player.current
    if (!p || !ready.current) return
    if (playing) { userPaused.current = true; p.pauseVideo() } else { userPaused.current = false; setError(null); p.playVideo() }
  }, [playing])

  const unmute = useCallback(() => {
    const p = player.current
    if (!p) return
    p.unMute(); p.setVolume(100); p.playVideo(); setMuted(false)
  }, [])

  const markAsked = useCallback((artist: string, talked = false) => {
    const l = listen.current
    if (l?.artist !== artist) return
    l.asked = true
    if (talked) l.talked = true
  }, [])
  const hasTalked = useCallback((artist: string) => listen.current?.artist === artist && !!listen.current.talked, [])

  const stop = useCallback(() => { reportSkipIfEarly(); player.current?.stopVideo?.(); clearStall(); setPlaying(false); setCurrent(null) }, [])

  return (
    <Ctx.Provider value={{ current, playing, loading, progress, duration, error, muted, lastSignal, unmute, play, toggle, stop, markAsked, hasTalked }}>
      {children}
      {/* 재생용 플레이어: 충분한 크기로, 화면 뒤에 투명하게 */}
      <div aria-hidden style={{ position: 'fixed', right: 0, bottom: 0, width: 240, height: 240, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
        <div ref={host} />
      </div>
    </Ctx.Provider>
  )
}
