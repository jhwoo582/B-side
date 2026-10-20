/** 화면 전체를 덮는 실크 셰이더 배경 (레퍼런스 12번). 지도 탭에서는 같은 팔레트의 우주(성운 + 별)로 천천히 바뀐다.
 * 지금 판의 팔레트로 물들고, 판이 바뀌면 색이 천천히 넘어간다.
 *  재생 중에는 흐름이 조금 빨라진다. 성능을 위해 화면 절반 해상도로 그리고 CSS로 늘린다. */
import { useEffect, useRef } from 'react'
import { onPalette, type AlbumPalette } from '../albumColor'

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uBase, uC1, uC2, uC3; uniform float uSpace;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.03; a *= .5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(uRes.x / uRes.y, 1.) * 1.5;
  float t = uTime * .055;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.2*q + vec2(1.7, 9.2) + t*1.4), fbm(p + 3.2*q + vec2(8.3, 2.8) - t*1.1));
  float f = fbm(p + 3.4*r);
  vec3 col = mix(uBase, uC1, smoothstep(.15, .85, f));
  col = mix(col, uC2, smoothstep(.3, 1.05, length(q)) * .8);
  col = mix(col, uC3, smoothstep(.5, .95, r.x) * .65);
  col += pow(smoothstep(.5, .95, f), 3.) * .16;              // 비단 결의 광택
  float v = smoothstep(1.3, .2, length(uv - vec2(.5, .48)));
  col *= mix(.5, 1., v);                                      // 가장자리는 어둡게
  // 우주: 아주 어두운 바탕 위에 앨범색 성운, 비스듬한 은하수 띠, 반짝이는 별
  vec2 sp = uv * vec2(uRes.x / uRes.y, 1.) * 2.2;
  float neb = smoothstep(.42, .98, fbm(sp * .8 + q * .7 + t * .3));
  float neb2 = pow(smoothstep(.5, 1., fbm(sp * 1.7 - t * .2 + r)), 2.);
  vec3 space = vec3(.010, .010, .028) + uC1 * neb * .42 + uC2 * neb2 * .3;
  // 은하수: 비스듬한 띠 + 밝은 중심 + 그 위를 가로지르는 어두운 먼지 줄기, 띠 안일수록 별이 빽빽하다
  float by = uv.y - .52 + .35 * (uv.x - .5);
  float band = exp(-pow(by * 3.4, 2.));
  float core = exp(-pow(by * 10., 2.)) * smoothstep(.0, .6, fbm(sp * 1.3 + 4.));
  float dust = smoothstep(.48, .74, fbm(sp * 3.1 + vec2(t * .04, 0.)));
  space += mix(uC3, vec3(.82, .8, 1.), .6) * band * (.08 + .24 * fbm(sp * 2.4 + t * .1));
  space += vec3(1., .92, .82) * core * .16;
  space *= 1. - band * dust * .6;
  vec2 g = floor(gl_FragCoord.xy);
  float h = hash(g);
  float tw = .45 + .55 * sin(uTime * (1.5 + h * 3.) + h * 90.);
  space += step(mix(.9985, .991, band), h) * tw * mix(.45, .7, band);   // 잔별: 띠 안에서 더 빽빽
  space += step(.99985, hash(g + 7.3)) * .9;                               // 드문 밝은 별
  space *= mix(.6, 1., v);
  col = mix(col, space, uSpace);
  col += (hash(gl_FragCoord.xy + uTime) - .5) * .018;         // 미세한 그레인 (밴딩 방지)
  gl_FragColor = vec4(col, 1.);
}`

const toVec = (c: number[]) => c.map((v) => v / 255)

export function SilkBackground({ playing, space = 0 }: { playing: boolean; space?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const playingRef = useRef(playing)
  playingRef.current = playing
  const spaceRef = useRef(space)
  spaceRef.current = space

  useEffect(() => {
    const cv = ref.current!
    const gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false })
    if (!gl) return
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return }
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    const uRes = u('uRes'), uTime = u('uTime'), uBase = u('uBase'), uC1 = u('uC1'), uC2 = u('uC2'), uC3 = u('uC3'), uSpace = u('uSpace')

    // 색은 목표값으로 천천히 다가간다
    const cur = { base: [0, 0, 0], c1: [0, 0, 0], c2: [0, 0, 0], c3: [0, 0, 0] }
    let target = cur
    const off = onPalette((p: AlbumPalette) => {
      target = { base: toVec(p.base), c1: toVec(p.c1), c2: toVec(p.c2), c3: toVec(p.c3) }
      if (cur.c1.every((v) => v === 0)) Object.assign(cur, JSON.parse(JSON.stringify(target)))
    })

    const resize = () => {
      const k = 0.5 * Math.min(window.devicePixelRatio || 1, 2)
      cv.width = Math.max(1, Math.floor(window.innerWidth * k)); cv.height = Math.max(1, Math.floor(window.innerHeight * k))
      gl.viewport(0, 0, cv.width, cv.height)
    }
    resize(); window.addEventListener('resize', resize)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, t = 0, last = performance.now(), sp = spaceRef.current
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      if (!reduce) t += dt * (playingRef.current ? 1.7 : 1)
      for (const k of ['base', 'c1', 'c2', 'c3'] as const) cur[k] = cur[k].map((v, i) => v + (target[k][i] - v) * Math.min(1, dt * 1.6))
      sp += (spaceRef.current - sp) * Math.min(1, dt * 4)
      gl.uniform2f(uRes, cv.width, cv.height); gl.uniform1f(uTime, t); gl.uniform1f(uSpace, sp)
      gl.uniform3fv(uBase, cur.base); gl.uniform3fv(uC1, cur.c1); gl.uniform3fv(uC2, cur.c2); gl.uniform3fv(uC3, cur.c3)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); off() }
  }, [])

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-full w-full" />
}
