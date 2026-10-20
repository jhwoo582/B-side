/** 판의 소리: 플래터에 내려앉는 '툭', 바늘이 닿을 때의 지직거림. 파일 없이 Web Audio로 합성한다.
 *  사용자 동작(판을 놓은 순간) 안에서 처음 불려야 소리가 난다. */
let ctx: AudioContext | null = null
const ac = () => {
  if (!ctx) { try { ctx = new AudioContext() } catch { return null } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** 판이 플래터에 닿는 낮은 '툭' */
export function thunk(gain = 0.35) {
  const a = ac(); if (!a) return
  const t = a.currentTime
  const o = a.createOscillator(), g = a.createGain()
  o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16)
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.25)
  // 판 가장자리가 닿는 짧은 마찰음
  noise(a, t, 0.05, 0.12, 2400)
}

/** 바늘이 홈에 닿는 순간의 '틱' + 몇 초간 옅어지는 지직거림 */
export function crackle(seconds = 2.2, gain = 0.09) {
  const a = ac(); if (!a) return
  const t = a.currentTime
  noise(a, t, 0.03, gain * 3, 5200)                  // 바늘 닿는 틱
  for (let i = 0; i < seconds * 22; i++) {           // 드문드문 튀는 먼지 소리
    const at = t + 0.05 + Math.random() * seconds
    noise(a, at, 0.004 + Math.random() * 0.01, gain * (1 - (at - t) / seconds) * (0.4 + Math.random()), 3000 + Math.random() * 4000)
  }
}

function noise(a: AudioContext, at: number, dur: number, gain: number, freq: number) {
  const len = Math.max(1, Math.floor(a.sampleRate * dur))
  const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain()
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9
  g.gain.value = Math.max(0, gain)
  s.buffer = buf; s.connect(f).connect(g).connect(a.destination); s.start(at)
}

export const buzz = (ms = 12) => { try { navigator.vibrate?.(ms) } catch { /* 진동이 없는 기기 */ } }
