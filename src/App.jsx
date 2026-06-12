import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
import {
  motion,
  AnimatePresence,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  useSpring,
  useMotionValue,
  useVelocity,
} from 'motion/react'
import './App.css'

// ═══════════════════════════════════════════════════════════════════════════
//  ADRAS / ATLAS GEOMETRY — stepped "bodom" diamonds, the signature ikat motif
// ═══════════════════════════════════════════════════════════════════════════

// Staircase-edged rhombus: the jagged silhouette every atlas weave is built on.
function steppedDiamond(cx, cy, w, h, steps) {
  const pts = []
  const sx = w / steps
  const sy = h / steps
  for (let i = 0; i < steps; i++) {           // top → right
    pts.push([cx + i * sx, cy - h + i * sy], [cx + (i + 1) * sx, cy - h + i * sy])
  }
  for (let i = 0; i < steps; i++) {           // right → bottom
    pts.push([cx + w - i * sx, cy + i * sy], [cx + w - (i + 1) * sx, cy + i * sy])
  }
  for (let i = 0; i < steps; i++) {           // bottom → left
    pts.push([cx - i * sx, cy + h - i * sy], [cx - (i + 1) * sx, cy + h - i * sy])
  }
  for (let i = 0; i < steps; i++) {           // left → top
    pts.push([cx - w + i * sx, cy - i * sy], [cx - w + (i + 1) * sx, cy - i * sy])
  }
  return pts
}

const ptsStr = (pts) =>
  pts.map((p) => p.map((n) => Math.round(n * 10) / 10).join(',')).join(' ')

// ── True atlas weave: flowing vertical silk bands with feathered dye edges ──
// Each band boundary is a smooth vertical wave; integer wave periods make the
// tile seamless vertically, and the first/last boundary share parameters so
// it wraps seamlessly horizontally too.
const TILE_W = 360
const TILE_H = 480

function waveEdge(baseX, amp, phase, periods, steps = 36) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const y = (TILE_H / steps) * i
    const x = baseX + amp * Math.sin((y / TILE_H) * Math.PI * 2 * periods + phase)
    pts.push([x, y])
  }
  return pts
}

const toPath = (pts) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')

// Band boundaries: base x, wave amplitude, phase, periods (must be integers).
const EDGE_DEFS = [
  { base: 0,   amp: 10, phase: 0.0, periods: 2 },
  { base: 52,  amp: 14, phase: 1.7, periods: 2 },
  { base: 96,  amp: 9,  phase: 3.9, periods: 3 },
  { base: 158, amp: 16, phase: 0.8, periods: 2 },
  { base: 204, amp: 11, phase: 2.6, periods: 3 },
  { base: 262, amp: 15, phase: 4.4, periods: 2 },
  { base: 306, amp: 9,  phase: 5.6, periods: 3 },
  { base: 360, amp: 10, phase: 0.0, periods: 2 }, // mirrors boundary 0 → seamless wrap
]

const BAND_COLORS = ['#E11D48', '#FACC15', '#06B6D4', '#8B5CF6', '#DB2777', '#10B981', '#F97316']

const IKAT_TILE_SVG = (() => {
  const edges = EDGE_DEFS.map((d) => waveEdge(d.base, d.amp, d.phase, d.periods))
  let svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE_W}' height='${TILE_H}' viewBox='0 0 ${TILE_W} ${TILE_H}'>`
  // Silk bands — fill between neighbouring wavy boundaries
  for (let i = 0; i < BAND_COLORS.length; i++) {
    const left = edges[i]
    const right = [...edges[i + 1]].reverse()
    const d = toPath(left) + ' ' + right.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z'
    svg += `<path d='${d}' fill='${BAND_COLORS[i]}'/>`
  }
  // Feathered dye-bleed along every interior boundary: a soft dark stitch
  // plus a thin bright silk thread — the signature blurred edge of real ikat.
  for (let i = 1; i < edges.length - 1; i++) {
    const d = toPath(edges[i])
    svg += `<path d='${d}' fill='none' stroke='rgba(18,8,26,0.4)' stroke-width='6' stroke-dasharray='5 9' stroke-linecap='round'/>`
    svg += `<path d='${d}' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='1.3'/>`
  }
  return svg + `</svg>`
})()

const IKAT_TILE = `url("data:image/svg+xml,${encodeURIComponent(IKAT_TILE_SVG)}")`

// Faint arrow/feather hatch — the watery "flame" texture of dyed ikat threads.
const IKAT_FEATHER =
  'repeating-linear-gradient(8deg,' +
  ' rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 2px,' +
  ' transparent 2px, transparent 9px)'

// Thin vertical "warp threads" so the pattern reads as woven silk.
const IKAT_WARP =
  'repeating-linear-gradient(90deg,' +
  ' rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px,' +
  ' transparent 1px, transparent 6px)'

// ═══════════════════════════════════════════════════════════════════════════
//  TOUCH / MOBILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

// Lite mode for weak machines: ≤4 GB RAM reported by the browser.
// Cuts layer count, particle count and animated ornament traces.
const IS_LITE = typeof navigator !== 'undefined' && (navigator.deviceMemory ?? 8) <= 4

// True on phones & tablets (no hover, coarse pointer). Reactive to changes.
const COARSE_QUERY = '(hover: none), (pointer: coarse)'

function subscribeCoarse(cb) {
  const mq = window.matchMedia(COARSE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE_QUERY).matches,
    () => false,
  )
}

// Expanding neon ikat rings wherever the user taps — the phone's answer
// to the desktop cursor torch.
function TapRipples() {
  const coarse = useCoarsePointer()
  const prefersReduced = useReducedMotion()
  const [ripples, setRipples] = useState([])

  useEffect(() => {
    if (!coarse || prefersReduced) return
    const onDown = (e) => {
      const id = `${Date.now()}-${Math.round(e.clientX)}`
      setRipples((rs) => [...rs.slice(-3), { id, x: e.clientX, y: e.clientY }])
    }
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => window.removeEventListener('pointerdown', onDown)
  }, [coarse, prefersReduced])

  const remove = useCallback((id) => {
    setRipples((rs) => rs.filter((r) => r.id !== id))
  }, [])

  if (!coarse || prefersReduced) return null

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 'var(--z-progress)' }}>
      {ripples.map((r) => (
        <div key={r.id} style={{ position: 'absolute', left: r.x, top: r.y }}>
          {/* outer cyan ring */}
          <motion.div
            style={{
              position: 'absolute', left: -80, top: -80,
              width: 160, height: 160, borderRadius: '50%',
              border: '2px solid rgba(34,211,238,0.8)',
              boxShadow: '0 0 24px rgba(34,211,238,0.5), inset 0 0 18px rgba(34,211,238,0.25)',
            }}
            initial={{ scale: 0.15, opacity: 0.9 }}
            animate={{ scale: 1.25, opacity: 0 }}
            transition={{ duration: 0.75, ease: 'easeOut' }}
            onAnimationComplete={() => remove(r.id)}
          />
          {/* inner gold ring, slightly delayed */}
          <motion.div
            style={{
              position: 'absolute', left: -50, top: -50,
              width: 100, height: 100, borderRadius: '50%',
              border: '1.5px solid rgba(245,158,11,0.85)',
              boxShadow: '0 0 18px rgba(245,158,11,0.5)',
            }}
            initial={{ scale: 0.1, opacity: 0.95 }}
            animate={{ scale: 1.15, opacity: 0 }}
            transition={{ duration: 0.65, delay: 0.08, ease: 'easeOut' }}
          />
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVING BACKGROUND — drifting ikat fabric + stars + holographic scanlines
// ═══════════════════════════════════════════════════════════════════════════

// One endlessly-drifting layer of the ikat tile. The x-loop spans exactly one
// tile, so the wrap-around is invisible — the fabric just travels forever.
// Depth comes from sizeScale (bigger background tiles), NOT from a transform
// scale — scaled wrappers ballooned GPU layer memory and caused black-screen
// flashes on macOS. Layer bounds stay as tight as the seamless loop allows.
function DriftingPattern({ reverse = false, duration = 40, sizeScale = 1, blur = 3, opacity = 0.12 }) {
  const prefersReduced = useReducedMotion()
  const w = Math.round(TILE_W * sizeScale)
  const h = Math.round(TILE_H * sizeScale)
  return (
    <motion.div
      style={{
        position: 'absolute',
        // Horizontal margins must fit the one-tile x-loop; vertically the
        // layer only ever moves ~6vh (scroll) + 20px (gyro), so 140px is
        // plenty — slashes GPU layer memory vs full-tile margins.
        top: -140, bottom: -140, left: -w, right: -w,
        backgroundImage: `${IKAT_FEATHER}, ${IKAT_WARP}, ${IKAT_TILE}`,
        backgroundSize: `24px 24px, 6px 6px, ${w}px ${h}px`,
        // Static filter — rasterised once, then the layer only *moves*
        // (transform-only animation = GPU compositing, no repaints).
        filter: `blur(${blur}px) saturate(1.25)`,
        opacity,
        willChange: 'transform',
      }}
      animate={prefersReduced ? {} : { x: reverse ? [-w, 0] : [0, -w] }}
      transition={{ x: { duration, repeat: Infinity, ease: 'linear' } }}
    />
  )
}

// Twinkling night sky over Samarkand — tiny "data points" of the future.
// Generated once at module load so the layout is stable across re-renders.
const STARS = Array.from({ length: 26 }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  top: Math.random() * 55,
  size: 1 + Math.random() * 1.6,
  dur: 2 + Math.random() * 3.4,
  delay: Math.random() * 4,
  gold: Math.random() > 0.72,
}))

function Stars() {
  const prefersReduced = useReducedMotion()
  const list = IS_LITE ? STARS.slice(0, 12) : STARS
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {list.map((s) => (
        <motion.div
          key={s.id}
          style={{
            position: 'absolute',
            left: `${s.left}%`, top: `${s.top}%`,
            width: s.size, height: s.size,
            borderRadius: '50%',
            background: s.gold ? 'rgba(251,191,36,0.9)' : 'rgba(195,235,255,0.85)',
            boxShadow: s.gold ? '0 0 6px rgba(251,191,36,0.8)' : '0 0 6px rgba(140,220,255,0.7)',
            opacity: 0.3,
          }}
          animate={prefersReduced ? {} : { opacity: [0.12, 0.85, 0.12] }}
          transition={{ duration: s.dur, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

// Torch that follows the pointer/finger. A circular window (static soft mask,
// rasterised once) is moved with transform; the fabric inside is counter-
// translated so it stays screen-aligned. Both ops are pure GPU compositing —
// zero repaints per mouse move, perfectly glued to the cursor.
function TorchReveal() {
  const outerRef = useRef(null)
  const innerRef = useRef(null)

  useEffect(() => {
    let raf = 0
    let tx = -9999
    let ty = -9999
    const apply = () => {
      raf = 0
      const o = outerRef.current
      const inn = innerRef.current
      if (!o || !inn) return
      o.style.transform = `translate3d(${tx - 260}px, ${ty - 260}px, 0)`
      inn.style.transform = `translate3d(${260 - tx}px, ${260 - ty}px, 0)`
    }
    const schedule = (x, y) => {
      tx = x; ty = y
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onMove = (e) => schedule(e.clientX, e.clientY)
    const onTouch = (e) => {
      const t = e.touches[0]
      if (t) schedule(t.clientX, t.clientY)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('touchmove', onTouch)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute', left: 0, top: 0,
        width: 520, height: 520,
        transform: 'translate3d(-9999px, -9999px, 0)',
        borderRadius: '50%',
        overflow: 'hidden',
        pointerEvents: 'none',
        WebkitMaskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,0.5) 46%, transparent 72%)',
        maskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,0.5) 46%, transparent 72%)',
        willChange: 'transform',
      }}
    >
      <div
        ref={innerRef}
        style={{
          // 260px overscan on every side so the torch circle stays filled
          // right up to the screen edges (incl. mobile URL-bar resizes).
          position: 'absolute', left: -260, top: -260,
          width: 'calc(100vw + 520px)', height: 'calc(100vh + 520px)',
          backgroundImage: `${IKAT_FEATHER}, ${IKAT_WARP}, ${IKAT_TILE}`,
          backgroundSize: `24px 24px, 6px 6px, ${TILE_W}px ${TILE_H}px`,
          filter: 'saturate(1.55)',
          opacity: 0.5,
          willChange: 'transform',
        }}
      />
    </div>
  )
}

function IkatBackground() {
  const prefersReduced = useReducedMotion()
  const coarse = useCoarsePointer()

  // Scroll-driven drift: the whole fabric travels as the page moves.
  const { scrollYProgress } = useScroll()
  const yShift = useTransform(scrollYProgress, [0, 1], ['0%', '-6%'])
  const xShift = useTransform(scrollYProgress, [0, 1], ['0px', '140px'])

  // Gyroscope parallax — tilting the phone sways the fabric like hung silk.
  const tiltXRaw = useMotionValue(0)
  const tiltYRaw = useMotionValue(0)
  const tiltX = useSpring(useTransform(tiltXRaw, [-1, 1], [-26, 26]), { stiffness: 60, damping: 18 })
  const tiltY = useSpring(useTransform(tiltYRaw, [-1, 1], [-20, 20]), { stiffness: 60, damping: 18 })

  useEffect(() => {
    if (prefersReduced || !coarse) return
    const clamp = (v) => Math.max(-1, Math.min(1, v))
    const onOrient = (e) => {
      if (e.gamma == null || e.beta == null) return
      tiltXRaw.set(clamp(e.gamma / 28))          // left-right tilt
      tiltYRaw.set(clamp((e.beta - 45) / 28))    // forward-back, 45° = neutral hold
    }
    // iOS needs an explicit permission request from a user gesture.
    const askPermission = () => {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {})
      }
    }
    window.addEventListener('pointerdown', askPermission, { once: true, passive: true })
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      window.removeEventListener('pointerdown', askPermission)
      window.removeEventListener('deviceorientation', onOrient)
    }
  }, [prefersReduced, coarse, tiltXRaw, tiltYRaw])


  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 'var(--z-bg)',
        background:
          'radial-gradient(ellipse 95% 75% at 50% 0%, #241438 0%, #160F28 48%, #0C081C 100%)',
      }}
    >
      <Stars />

      {/* Two fabric layers drifting in opposite directions = woven depth
          (one layer in lite mode). On phones the gyroscope adds a silk-sway. */}
      <motion.div style={{ position: 'absolute', inset: 0, y: prefersReduced ? 0 : yShift, x: prefersReduced ? 0 : xShift }}>
        <motion.div style={{ position: 'absolute', inset: 0, x: coarse ? tiltX : 0, y: coarse ? tiltY : 0 }}>
          <DriftingPattern duration={46} blur={2.5} opacity={0.13} />
          {!IS_LITE && <DriftingPattern duration={64} blur={1} opacity={0.1} sizeScale={1.45} reverse />}
        </motion.div>
      </motion.div>

      {/* Sharp vivid fabric revealed under the cursor / finger */}
      {!prefersReduced && <TorchReveal />}

      {/* Holographic scanlines + travelling scan sweep — the "future" layer */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(180,240,255,0.022) 0px, rgba(180,240,255,0.022) 1px, transparent 1px, transparent 3px)',
        }}
      />
      {!prefersReduced && !IS_LITE && (
        <motion.div
          style={{
            position: 'absolute', left: 0, right: 0, top: 0, height: 160,
            background:
              'linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.055) 50%, transparent 100%)',
            willChange: 'transform',
          }}
          animate={{ y: ['-20vh', '120vh'] }}
          transition={{ duration: 8.5, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Deep vignette — keeps edges dark so text stays legible */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background:
            'radial-gradient(ellipse 78% 62% at 50% 45%, transparent 38%, rgba(8,5,18,0.66) 100%)',
        }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANCIENT CITY SKYLINE — Registan silhouettes with neon hologram edges
// ═══════════════════════════════════════════════════════════════════════════

// ── Authentic girih geometry generators ──────────────────────────────────────

// Khatam — the classic 8-pointed star of two interlaced squares, drawn as one
// 16-vertex star polygon (inner radius = exact square-intersection point).
function star8Path(cx, cy, r) {
  const rIn = r * 0.765
  let d = ''
  for (let i = 0; i < 16; i++) {
    const ang = (Math.PI / 8) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : rIn
    d += (i ? 'L' : 'M') + (cx + rr * Math.cos(ang)).toFixed(1) + ' ' + (cy + rr * Math.sin(ang)).toFixed(1)
  }
  return d + 'Z'
}

// Small rotated square (the "cross" filler between stars in girih bands)
function diamondPath(cx, cy, r) {
  return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`
}

// Vertical star-and-diamond chain — the strip ornament on portal pylons
function starChainPath(cx, ys, starR, diaR) {
  let d = ''
  for (let i = 0; i < ys.length; i++) {
    d += star8Path(cx, ys[i], starR)
    if (i < ys.length - 1) d += diamondPath(cx, (ys[i] + ys[i + 1]) / 2, diaR)
  }
  return d
}

// Horizontal row of stars joined by diamonds — the portal frieze band
function starBandPath(xs, y, starR, diaR) {
  let d = ''
  for (let i = 0; i < xs.length; i++) {
    d += star8Path(xs[i], y, starR)
    if (i < xs.length - 1) d += diamondPath((xs[i] + xs[i + 1]) / 2, y, diaR)
  }
  return d
}

// Kungura — the stepped crenellation crowning every Registan portal
function kunguraPath(x0, x1, yBase, h = 11, tooth = 16) {
  let d = `M${x0} ${yBase}`
  for (let x = x0; x < x1; x += tooth) {
    d += `L${x + tooth / 2} ${yBase - h}L${x + tooth} ${yBase}`
  }
  return d
}

// A bright light-segment racing along an SVG path. The full ornament stays
// faintly visible (ghost stroke) and the light draws over it. Glow is faked
// with a wide translucent under-stroke — no drop-shadow filters, which were
// the main FPS killer.
function TracePath({ d, stroke, width = 2, seg = 0.14, duration = 4, delay = 0, reverse = false, still = false }) {
  const prefersReduced = useReducedMotion()
  if (prefersReduced || still) {
    return <path d={d} stroke={stroke} strokeWidth={width} opacity={0.2} fill="none" strokeLinejoin="round" />
  }
  const shared = {
    d,
    pathLength: 1,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeDasharray: `${seg} ${1 - seg}`,
    initial: { strokeDashoffset: 0 },
    animate: { strokeDashoffset: reverse ? 1 : -1 },
    transition: { duration, delay, repeat: Infinity, ease: 'linear' },
  }
  return (
    <>
      {/* ghost ornament — always faintly visible so the pattern reads */}
      <path d={d} stroke={stroke} strokeWidth={width * 0.8} strokeOpacity="0.14" fill="none" strokeLinejoin="round" />
      {/* wide soft under-stroke = cheap glow */}
      <motion.path {...shared} stroke={stroke} strokeWidth={width * 3.4} strokeOpacity={0.22} />
      {/* bright core */}
      <motion.path {...shared} stroke={stroke} strokeWidth={width} />
    </>
  )
}

function Skyline() {
  const prefersReduced = useReducedMotion()
  const { scrollYProgress } = useScroll()
  // Layers recede at different speeds as the page scrolls = depth.
  const yFar = useTransform(scrollYProgress, [0, 1], [0, 46])
  const yNear = useTransform(scrollYProgress, [0, 1], [0, 110])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 0, right: 0, bottom: 0,
        height: '40vh',
        pointerEvents: 'none',
        zIndex: 'var(--z-skyline)',
        overflow: 'hidden',
      }}
    >
      {/* Far ridge of domes — dim, hazy */}
      <motion.svg
        viewBox="0 0 1600 300"
        preserveAspectRatio="xMidYMax slice"
        style={{
          position: 'absolute', bottom: -8, left: 0,
          width: '100%', height: '70%',
          opacity: 0.85,
          y: prefersReduced ? 0 : yFar,
        }}
      >
        <g fill="#1C1336">
          <rect x="0" y="240" width="1600" height="60" />
          <rect x="40" y="150" width="90" height="150" />
          <circle cx="85" cy="150" r="45" />
          <rect x="200" y="90" width="10" height="210" />
          <circle cx="205" cy="86" r="8" />
          <rect x="420" y="170" width="160" height="130" />
          <circle cx="500" cy="170" r="60" />
          <rect x="700" y="200" width="300" height="100" />
          <circle cx="750" cy="200" r="30" />
          <circle cx="850" cy="200" r="30" />
          <circle cx="950" cy="200" r="30" />
          <rect x="1100" y="140" width="120" height="160" />
          <circle cx="1160" cy="140" r="52" />
          <rect x="1320" y="80" width="12" height="220" />
          <circle cx="1326" cy="76" r="9" />
          <rect x="1420" y="190" width="180" height="110" />
          <circle cx="1510" cy="190" r="40" />
        </g>
      </motion.svg>

      {/* Static neon haze along the horizon (replaces the per-frame
          drop-shadow filter that was re-rasterising the whole skyline) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: '34%',
        background: 'linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.05) 55%, rgba(34,211,238,0.09) 100%)',
      }} />

      {/* Near silhouette — iwan portal, minarets, ribbed dome, neon edges.
          Static content + transform-only parallax = rasterised once. */}
      <motion.svg
        viewBox="0 0 1600 380"
        preserveAspectRatio="xMidYMax slice"
        style={{
          position: 'absolute', bottom: -10, left: 0,
          width: '100%', height: '100%',
          y: prefersReduced ? 0 : yNear,
        }}
      >
        <g fill="#0B0718" stroke="rgba(34,211,238,0.38)" strokeWidth="2">
          {/* ground */}
          <rect x="-10" y="340" width="1620" height="50" stroke="none" />
          <line x1="0" y1="341" x2="1600" y2="341" stroke="rgba(34,211,238,0.3)" strokeWidth="1.5" />
          {/* left minaret */}
          <polygon points="150,340 158,100 182,100 190,340" />
          <path d="M154 100 Q170 62 186 100 Z" />
          <line x1="170" y1="66" x2="170" y2="48" />
          {/* grand iwan portal — the arch is a window into the glowing fabric */}
          <path d="M320 340 L320 120 L640 120 L640 340 L560 340 L560 232 Q560 166 480 148 Q400 166 400 232 L400 340 Z" />
          <rect x="320" y="120" width="320" height="16" fill="#161030" />
          {/* ribbed dome on drum */}
          <rect x="760" y="250" width="180" height="90" />
          <path d="M760 250 Q760 202 792 186 Q758 150 850 108 Q942 150 908 186 Q940 202 940 250 Z" />
          <line x1="850" y1="108" x2="850" y2="84" />
          <circle cx="850" cy="80" r="4" />
          {/* bazaar row of small domes */}
          <rect x="1020" y="290" width="260" height="50" />
          <path d="M1040 290 Q1040 260 1072 250 Q1104 260 1104 290 Z" />
          <path d="M1124 290 Q1124 260 1156 250 Q1188 260 1188 290 Z" />
          <path d="M1208 290 Q1208 260 1240 250 Q1272 260 1272 290 Z" />
          {/* right minaret */}
          <polygon points="1380,340 1388,120 1410,120 1418,340" />
          <path d="M1384 120 Q1399 84 1414 120 Z" />
        </g>
      </motion.svg>

      {/* Ornament overlay — its dash animations repaint ONLY this mostly
          transparent svg, never the building silhouettes behind it. */}
      <motion.svg
        viewBox="0 0 1600 380"
        preserveAspectRatio="xMidYMax slice"
        style={{
          position: 'absolute', bottom: -10, left: 0,
          width: '100%', height: '100%',
          y: prefersReduced ? 0 : yNear,
        }}
      >
        {/* ── Racing light over authentic girih ornaments ──
            Khatam stars (two interlaced squares), star-and-diamond chains on
            the pylons, a star frieze across the band, kungura crenellation —
            the actual ornament vocabulary of Registan madrasahs. */}
        <g fill="none" strokeLinecap="round">
          {/* kungura crenellation crowning the portal */}
          <TracePath d={kunguraPath(320, 640, 118)} stroke="#22D3EE" width={1.8} seg={0.18} duration={5.5} still={IS_LITE} />
          {/* portal frame loop */}
          <TracePath d="M320 120 H640 V340 H320 Z" stroke="#22D3EE" width={2.2} seg={0.16} duration={5} delay={0.4} />
          {/* pointed arch sweep */}
          <TracePath d="M400 340 V232 Q400 166 480 148 Q560 166 560 232 V340" stroke="#F59E0B" width={2.2} seg={0.2} duration={3.6} delay={0.6} />
          {/* star frieze across the portal band */}
          <TracePath d={starBandPath([366, 423, 480, 537, 594], 134, 10, 4.5)} stroke="#FACC15" width={1.4} seg={0.1} duration={7} still={IS_LITE} />
          {/* khatam star chains on both pylons */}
          <TracePath d={starChainPath(360, [200, 290], 19, 8)} stroke="#DB2777" width={1.6} seg={0.12} duration={6} delay={0.8} />
          <TracePath d={starChainPath(600, [200, 290], 19, 8)} stroke="#8B5CF6" width={1.6} seg={0.12} duration={6} delay={2.2} reverse still={IS_LITE} />
          {/* dome ribs light up one after another */}
          <TracePath d="M850 108 Q800 180 790 250" stroke="#10B981" width={1.8} seg={0.3} duration={2.8} still={IS_LITE} />
          <TracePath d="M850 108 Q850 180 850 250" stroke="#FACC15" width={1.8} seg={0.3} duration={2.8} delay={0.5} still={IS_LITE} />
          <TracePath d="M850 108 Q900 180 910 250" stroke="#10B981" width={1.8} seg={0.3} duration={2.8} delay={1} still={IS_LITE} />
          {/* star medallion on the dome drum */}
          <TracePath d={star8Path(850, 295, 26)} stroke="#F59E0B" width={1.6} seg={0.22} duration={4} delay={1.2} />
          {/* light climbing the minarets */}
          <TracePath d="M150 340 L158 100" stroke="#22D3EE" width={2} seg={0.3} duration={3.4} reverse still={IS_LITE} />
          <TracePath d="M1418 340 L1410 120" stroke="#22D3EE" width={2} seg={0.3} duration={3.4} delay={1.7} reverse still={IS_LITE} />
          {/* bazaar arcade: domes + a small star under each */}
          <TracePath d={`M1040 290 Q1040 260 1072 250 Q1104 260 1104 290 ${star8Path(1072, 315, 11)}`} stroke="#FACC15" width={1.5} seg={0.25} duration={3.4} still={IS_LITE} />
          <TracePath d={`M1124 290 Q1124 260 1156 250 Q1188 260 1188 290 ${star8Path(1156, 315, 11)}`} stroke="#DB2777" width={1.5} seg={0.25} duration={3.4} delay={0.7} still={IS_LITE} />
          <TracePath d={`M1208 290 Q1208 260 1240 250 Q1272 260 1272 290 ${star8Path(1240, 315, 11)}`} stroke="#22D3EE" width={1.5} seg={0.25} duration={3.4} delay={1.4} still={IS_LITE} />
        </g>
      </motion.svg>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  EDGE GLOW — neon rails on the screen edges that ignite while scrolling
// ═══════════════════════════════════════════════════════════════════════════

function EdgeGlow() {
  const prefersReduced = useReducedMotion()
  const { scrollY } = useScroll()
  const velocity = useVelocity(scrollY)
  // |velocity| → glow strength, smoothed so the rails fade in/out gracefully.
  const glow = useSpring(
    useTransform(velocity, [-1400, 0, 1400], [1, 0, 1]),
    { stiffness: 120, damping: 28, mass: 0.4 },
  )
  const opacity = useTransform(glow, [0, 1], [0, 0.85])

  if (prefersReduced) return null

  const rail = (side) => ({
    position: 'fixed',
    top: 0, bottom: 0,
    [side]: 0,
    width: 3,
    pointerEvents: 'none',
    zIndex: 'var(--z-progress)',
    background: 'linear-gradient(180deg, #22D3EE 0%, #8B5CF6 38%, #E11D48 70%, #F59E0B 100%)',
    boxShadow: side === 'left'
      ? '2px 0 18px rgba(34,211,238,0.55), 6px 0 44px rgba(139,92,246,0.3)'
      : '-2px 0 18px rgba(34,211,238,0.55), -6px 0 44px rgba(139,92,246,0.3)',
  })

  return (
    <>
      <motion.div aria-hidden="true" style={{ ...rail('left'),  opacity }} />
      <motion.div aria-hidden="true" style={{ ...rail('right'), opacity }} />
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCROLL PROGRESS — ikat ribbon woven across the top of the viewport
// ═══════════════════════════════════════════════════════════════════════════

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 130, damping: 24, mass: 0.3 })
  return (
    <motion.div
      aria-hidden="true"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 3,
        transformOrigin: '0 0',
        scaleX,
        zIndex: 'var(--z-progress)',
        background:
          'linear-gradient(90deg, #F59E0B 0%, #E11D48 30%, #8B5CF6 62%, #22D3EE 100%)',
        boxShadow: '0 0 12px rgba(34,211,238,0.5)',
      }}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONTACTS & LANGUAGE
// ═══════════════════════════════════════════════════════════════════════════

const WA_PHONE = '971526113477'
const TG_USER = 'maxarab9'
const waUrl = (text) => `https://wa.me/${WA_PHONE}${text ? `?text=${encodeURIComponent(text)}` : ''}`
const tgUrl = (text) => `https://t.me/${TG_USER}${text ? `?text=${encodeURIComponent(text)}` : ''}`
const MAPS_URL = 'https://maps.google.com/?q=Honey+Murena+Canggu+Bali'

const INITIAL_LANG =
  (typeof localStorage !== 'undefined' && localStorage.getItem('plov-lang')) || 'en'

const STRINGS = {
  en: {
    docTitle: 'Plov House — real Uzbek plov in Bali',
    eyebrow: 'From ancient Uzbekistan — to your table in Bali',
    title: 'PLOV',
    tagline: 'Kazan-cooked over open fire. A IX-century recipe, served in Canggu',
    cta: 'Order plov',
    ctaNow: 'Order now',
    scrollHint: 'Scroll down',
    menuTitle: 'Kinds of plov',
    menuSub: 'Each recipe keeps centuries-old secrets of the Uzbek kitchen',
    perPortion: 'portion · ~300 g',
    orderThis: 'Order this',
    journeyTitle: 'Through the centuries',
    journeySub: 'One recipe — twelve centuries of travel',
    servicesTitle: 'How to get your plov',
    servicesSub: 'Three ways to taste it in Bali',
    quote: <>«Plov is not just food.<br />It is a ritual that gathers people together»</>,
    traditionText:
      'Uzbek plov has been known since the IX century — Avicenna called it «food that strengthens body and spirit». It is traditionally cooked by men in a big cast-iron kazan over open fire: for weddings, for holidays, or simply to gather the people you love. We carried that fire all the way across the ocean — to Bali.',
    footerBrandSub: <>Real Uzbek plov<br />in Bali, Indonesia</>,
    contactsHead: 'Contacts',
    whereHead: 'Where',
    whereName: 'Honey Murena · Canggu',
    whereArea: 'Bali, Indonesia',
    infoHead: 'Service',
    infoLines: ['Canggu & nearby', 'Delivery · chef on-site', 'Daily 10:00 – 22:00'],
    orderHead: 'Order',
    orderBtn: 'Place an order',
    orderNote: 'Big kazan from 3 kg · chef on-site by booking',
    copyright: '© 2026 Plov House · Honey Murena, Canggu',
    location: 'Bali, Indonesia · IX century — 2077',
    mTitle: 'Order plov',
    mSub: 'Pick the options — we finish the order in chat',
    mName: 'Your name (optional)',
    mNamePh: 'John',
    mPlov: 'Kind of plov',
    mFormat: 'Format',
    formats: {
      portions: 'Portions — delivery',
      chef: 'Chef on-site — villa / event',
      kazan: 'Big kazan — by kilogram',
    },
    mQtyPortions: 'How many portions',
    mQtyKg: 'How many kilograms',
    mWa: 'Order in WhatsApp',
    mTg: 'Order in Telegram',
    mNote: 'We reply within minutes',
    msg: {
      hello: 'Hello! I would like to order plov.',
      type: 'Plov',
      format: 'Format',
      qty: 'Quantity',
      name: 'Name',
      portionsUnit: 'portion(s)',
      kgUnit: 'kg',
    },
  },
  ru: {
    docTitle: 'Plov House — настоящий узбекский плов на Бали',
    eyebrow: 'Из глубины веков — к вашему столу на Бали',
    title: 'ПЛОВ',
    tagline: 'Казанный, на открытом огне. Рецепт IX века — теперь в Чангу',
    cta: 'Заказать плов',
    ctaNow: 'Заказать сейчас',
    scrollHint: 'Листать вниз',
    menuTitle: 'Виды плова',
    menuSub: 'Каждый рецепт хранит вековые секреты узбекской кухни',
    perPortion: 'порция · ~300 г',
    orderThis: 'Заказать этот',
    journeyTitle: 'Сквозь века',
    journeySub: 'Один рецепт — двенадцать столетий пути',
    servicesTitle: 'Как получить плов',
    servicesSub: 'Три способа попробовать его на Бали',
    quote: <>«Плов — это не просто еда.<br />Это ритуал, собирающий людей вместе»</>,
    traditionText:
      'Узбекский плов известен с IX века — Авиценна называл его «пищей, укрепляющей тело и дух». Традиционно его готовят мужчины в большом чугунном казане на открытом огне: на свадьбы, праздники или просто ради встречи с близкими. Мы перенесли этот огонь через океан — на Бали.',
    footerBrandSub: <>Настоящий узбекский плов<br />на Бали, Индонезия</>,
    contactsHead: 'Контакты',
    whereHead: 'Где мы',
    whereName: 'Honey Murena · Чангу',
    whereArea: 'Бали, Индонезия',
    infoHead: 'Сервис',
    infoLines: ['Чангу и окрестности', 'Доставка · шеф на месте', 'Ежедневно 10:00 – 22:00'],
    orderHead: 'Заказать',
    orderBtn: 'Оформить заказ',
    orderNote: 'Большой казан от 3 кг · шеф на месте по записи',
    copyright: '© 2026 Plov House · Honey Murena, Чангу',
    location: 'Бали, Индонезия · IX век — 2077',
    mTitle: 'Заказать плов',
    mSub: 'Выберите опции — заказ завершим в чате',
    mName: 'Ваше имя (необязательно)',
    mNamePh: 'Алишер',
    mPlov: 'Вид плова',
    mFormat: 'Формат',
    formats: {
      portions: 'Порции — доставка',
      chef: 'Шеф на месте — вилла / праздник',
      kazan: 'Большой казан — килограммами',
    },
    mQtyPortions: 'Сколько порций',
    mQtyKg: 'Сколько килограммов',
    mWa: 'Заказать в WhatsApp',
    mTg: 'Заказать в Telegram',
    mNote: 'Отвечаем в течение нескольких минут',
    msg: {
      hello: 'Здравствуйте! Хочу заказать плов.',
      type: 'Плов',
      format: 'Формат',
      qty: 'Количество',
      name: 'Имя',
      portionsUnit: 'порц.',
      kgUnit: 'кг',
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════════════════════════════════

const PLOV_TYPES = [
  {
    id: 'festive',
    accent: '#991B1B',
    accentLight: '#F87171',
    name: { en: 'Festive', ru: 'Праздничный' },
    tag:  { en: 'Celebration', ru: 'Для торжества' },
    desc: {
      en: 'Lamb ribs slow-cooked over fire, whole garlic heads, quince and dried fruit. The plov they cook for weddings and the biggest days.',
      ru: 'Бараньи рёбра на медленном огне, целые головки чеснока, айва и сухофрукты. Такой плов готовят к свадьбам и особым событиям.',
    },
  },
  {
    id: 'tashkent',
    accent: '#C46B39',
    accentLight: '#F0A968',
    name: { en: 'Tashkent-style', ru: 'Ташкентский' },
    tag:  { en: 'Classic', ru: 'Классика' },
    desc: {
      en: 'The classic recipe: yellow carrots, cottonseed oil, devzira rice. The zirvak simmers for three hours — and you can taste every one of them.',
      ru: 'Классический рецепт: жёлтая морковь, хлопковое масло, рис дев-зира. Зирвак томится три часа — и это чувствуется.',
    },
  },
  {
    id: 'chaikhansky',
    accent: '#B8860B',
    accentLight: '#F5C84B',
    name: { en: 'Chaikhana', ru: 'Чайханский' },
    tag:  { en: 'Street-style', ru: 'Уличный' },
    desc: {
      en: 'Cooked the way teahouse masters feed a hundred guests: light cumin smoke, kishmish raisins and chickpeas. Unforgettable.',
      ru: 'Как готовят мастера у чайханы на сто гостей: лёгкий дымок зиры, изюм кишмиш и нут. Незабываемо.',
    },
  },
  {
    id: 'shavlya',
    accent: '#6B3A2A',
    accentLight: '#D69A6E',
    name: { en: 'Shavlya', ru: 'Шавля' },
    tag:  { en: 'Homestyle', ru: 'Домашний' },
    desc: {
      en: 'Plov’s cozy cousin — more vegetables, a juicy tomato base, tender rice. Comfort food, Uzbek edition.',
      ru: 'Домашний брат плова — больше овощей, сочный томатный соус, нежный рис. Уют в тарелке.',
    },
  },
]

const SERVICES = [
  {
    num: '01',
    title: { en: 'Delivery by portion', ru: 'Порционная доставка' },
    desc: {
      en: 'Hot kazan plov around Canggu — order from a single portion. About 60 minutes door to door.',
      ru: 'Горячий казанный плов по Чангу — от одной порции. Около 60 минут до двери.',
    },
    Icon: () => (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" rx="1" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    num: '02',
    title: { en: 'Chef at your villa', ru: 'Шеф у вас на вилле' },
    desc: {
      en: 'We bring the kazan, the fire and the master — live cooking at your villa or event. The show is included.',
      ru: 'Привозим казан, огонь и мастера — готовим прямо у вас на вилле или празднике. Шоу прилагается.',
    },
    Icon: () => (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2c1.8 2.4 4 4.2 4 7a4 4 0 0 1-8 0c0-2.8 2.2-4.6 4-7z" />
        <path d="M5 21c0-3 3-4.5 7-4.5s7 1.5 7 4.5" />
      </svg>
    ),
  },
  {
    num: '03',
    title: { en: 'Big kazan for events', ru: 'Большой казан на праздник' },
    desc: {
      en: 'Weddings and big parties — we cook by the kilogram, from 3 kg per kazan. The classic large-order format.',
      ru: 'Свадьбы и большие компании — готовим килограммами, от 3 кг на казан. Классика больших заказов.',
    },
    Icon: () => (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9h18" />
        <path d="M4 9c0 7 3.5 10 8 10s8-3 8-10" />
        <path d="M3 9 1.5 7.5M21 9l1.5-1.5" />
        <ellipse cx="12" cy="7.5" rx="6.5" ry="1.8" />
      </svg>
    ),
  },
]

const ERAS = [
  {
    num: '01',
    year: { en: 'IX cent.', ru: 'IX век' },
    title: { en: 'Birth of the recipe', ru: 'Рождение рецепта' },
    text: {
      en: 'The great physician Avicenna prescribes plov as a remedy that restores strength to the body and clarity to the mind. Seven ingredients — seven foundations of life: onion, carrot, meat, fat, salt, water and rice.',
      ru: 'Великий врач Авиценна описывает плов как средство, возвращающее силы телу и ясность уму. Семь компонентов — семь начал жизни: лук, морковь, мясо, жир, соль, вода и рис.',
    },
    accent: '#F59E0B',
  },
  {
    num: '02',
    year: { en: 'XIV cent.', ru: 'XIV век' },
    title: { en: 'The Silk Road', ru: 'Шёлковый путь' },
    text: {
      en: 'Caravans carry the aroma of zirvak from Samarkand to Bukhara. Every stop cooks it its own way — dozens of regional schools are born, and they live to this day.',
      ru: 'Караваны разносят аромат зирвака от Самарканда до Бухары. На каждой стоянке плов готовят по-своему — так рождаются десятки региональных школ, дошедших до наших дней.',
    },
    accent: '#E11D48',
  },
  {
    num: '03',
    year: { en: 'XX cent.', ru: 'XX век' },
    title: { en: 'The chaikhana era', ru: 'Эпоха чайханы' },
    text: {
      en: 'Oshpaz masters cook for hundreds of guests at once. Morning plov becomes a ritual: served at dawn — latecomers only get the stories of how good it was.',
      ru: 'Ошпазы готовят в казанах на сотни гостей. Утренний плов становится ритуалом: его подают на рассвете, и опоздавшим достаются только истории о том, каким он был.',
    },
    accent: '#10B981',
  },
  {
    num: '04',
    year: { en: 'Bali · now', ru: 'Бали · сейчас' },
    title: { en: 'Plov crosses the ocean', ru: 'Плов через океан' },
    text: {
      en: 'The recipe has not changed in a thousand years — only the map has. Today the kazan smokes by the ocean in Canggu, and twelve centuries of history land on your table.',
      ru: 'Рецепт не меняется тысячу лет — меняется только география. Сегодня казан дымится у океана в Чангу, и двенадцать веков истории приезжают к вам на стол.',
    },
    accent: '#22D3EE',
  },
]

const STATS = [
  { to: 11,   suffix: { en: ' centuries', ru: ' веков' }, label: { en: 'of living tradition', ru: 'живой традиции' } },
  { to: 60,   suffix: { en: ' min',       ru: ' мин' },   label: { en: 'around Canggu',       ru: 'по Чангу' } },
  { to: 4,    suffix: { en: ' kinds',     ru: ' вида' },  label: { en: 'of plov on the menu', ru: 'плова в меню' } },
  { to: 1500, suffix: { en: '+',          ru: '+' },      label: { en: 'happy guests',        ru: 'довольных гостей' } },
]

// ═══════════════════════════════════════════════════════════════════════════
//  FALLING INGREDIENTS
// ═══════════════════════════════════════════════════════════════════════════

const SHAPES = {
  rice: (
    <svg width="6" height="13" viewBox="0 0 6 13">
      <ellipse cx="3" cy="6.5" rx="2.4" ry="6" fill="#F5DEB3" />
    </svg>
  ),
  riceGold: (
    <svg width="5" height="12" viewBox="0 0 5 12">
      <ellipse cx="2.5" cy="6" rx="2" ry="5.5" fill="#EED9A0" />
    </svg>
  ),
  carrot: (
    <svg width="14" height="9" viewBox="0 0 14 9">
      <ellipse cx="7" cy="4.5" rx="6.5" ry="3.4" fill="#E07B39" />
      <ellipse cx="7" cy="4.5" rx="3" ry="1.5" fill="#EF9355" />
    </svg>
  ),
  cumin: (
    <svg width="4" height="10" viewBox="0 0 4 10">
      <path d="M2 0 Q4 5 2 10 Q0 5 2 0Z" fill="#C9962F" />
    </svg>
  ),
  raisin: (
    <svg width="9" height="7" viewBox="0 0 9 7">
      <ellipse cx="4.5" cy="3.5" rx="4" ry="3" fill="#3E1A33" />
      <ellipse cx="3" cy="2.4" rx="1" ry="0.8" fill="#5C2C4E" />
    </svg>
  ),
  chickpea: (
    <svg width="11" height="11" viewBox="0 0 11 11">
      <circle cx="5.5" cy="5.5" r="5" fill="#D4A762" />
      <circle cx="4" cy="4" r="1.5" fill="#E3BC82" />
    </svg>
  ),
}

const SHAPE_KEYS = ['rice', 'rice', 'riceGold', 'carrot', 'cumin', 'raisin', 'chickpea']
const PARTICLE_COUNT = 26

// Stable particle layout, generated once at module load.
const PARTICLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
  const r = Math.random
  return {
    id:      i,
    shape:   SHAPE_KEYS[Math.floor(r() * SHAPE_KEYS.length)],
    left:    r() * 100,
    size:    0.7 + r() * 0.7,
    fall:    7 + r() * 7,
    delay:   r() * 9,
    sway:    12 + r() * 26,
    swayDur: 2.2 + r() * 2.4,
    spin:    (r() > 0.5 ? 1 : -1) * (180 + r() * 280),
    opacity: 0.22 + r() * 0.4,
  }
})

function FallingPiece({ p }) {
  return (
    <motion.div
      style={{
        position: 'absolute',
        top: 0,
        left: `${p.left}vw`,
        opacity: p.opacity,
        scale: p.size,
        willChange: 'transform',
      }}
      initial={{ y: '-12vh' }}
      animate={{
        y:      ['-12vh', '112vh'],
        x:      [0, p.sway, -p.sway * 0.6, p.sway * 0.4, 0],
        rotate: [0, p.spin],
      }}
      transition={{
        y:      { duration: p.fall, delay: p.delay, repeat: Infinity, ease: 'linear' },
        x:      { duration: p.swayDur, repeat: Infinity, ease: 'easeInOut' },
        rotate: { duration: p.fall, delay: p.delay, repeat: Infinity, ease: 'linear' },
      }}
    >
      {SHAPES[p.shape]}
    </motion.div>
  )
}

function RiceRain() {
  const prefersReduced = useReducedMotion()
  const coarse = useCoarsePointer()
  if (prefersReduced) return null
  // Phones and weak machines get a lighter shower — steadier FPS.
  const list = (coarse || IS_LITE) ? PARTICLES.slice(0, 12) : PARTICLES

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 'var(--z-particles)',
      }}
    >
      {list.map((p) => (
        <FallingPiece key={p.id} p={p} />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEAM
// ═══════════════════════════════════════════════════════════════════════════

function SteamPuff({ delay, x, size = 10 }) {
  const prefersReduced = useReducedMotion()
  if (prefersReduced) return null
  return (
    <motion.div
      aria-hidden="true"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: `${x}%`,
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.22)',
        filter: 'blur(5px)',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
      }}
      animate={{
        y:       [-4, -72],
        x:       [0, x < 50 ? -10 : 10],
        opacity: [0, 0.55, 0],
        scale:   [0.4, 1.6, 0.7],
      }}
      transition={{ duration: 2.8, delay, repeat: Infinity, ease: 'easeOut' }}
    />
  )
}

function HeroSteam() {
  return (
    <div aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <SteamPuff delay={0.0} x={38} size={11} />
      <SteamPuff delay={0.6} x={50} size={14} />
      <SteamPuff delay={1.2} x={62} size={10} />
      <SteamPuff delay={0.3} x={44} size={8}  />
      <SteamPuff delay={1.7} x={56} size={9}  />
    </div>
  )
}

function CardSteam({ visible }) {
  const prefersReduced = useReducedMotion()
  if (prefersReduced || !visible) return null
  return (
    <div aria-hidden="true"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0, right: 0,
        height: 56,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {[33, 50, 67].map((x, i) => (
        <motion.div key={i}
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${x}%`,
            width: 8, height: 8,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.28)',
            filter: 'blur(3px)',
            transform: 'translateX(-50%)',
          }}
          animate={{ y: -50, opacity: [0, 0.65, 0], scale: [0.4, 1.3, 0.6] }}
          transition={{ duration: 1.6, delay: i * 0.28, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  ORNAMENTS — kazan, neon arch, floating holographic tiles, ikat divider
// ═══════════════════════════════════════════════════════════════════════════

// Scattered rice grains on the mound — stable layout, generated at module load.
const KAZAN_GRAINS = Array.from({ length: 26 }, (_, i) => ({
  id: i,
  x: 32 + Math.random() * 76,
  y: 26 + Math.random() * 9,
  rot: Math.random() * 180,
  light: Math.random() > 0.5,
}))

function KazanIcon({ live = true }) {
  const prefersReduced = useReducedMotion()
  const embersOn = live && !prefersReduced
  return (
    <svg viewBox="0 0 140 108" width="140" height="108"
      fill="none" aria-hidden="true"
      style={{ display: 'block', margin: '0 auto' }}>
      <defs>
        {/* cast-iron body: dark edges, warm centre highlight */}
        <linearGradient id="kzn-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"  stopColor="#2A1208" />
          <stop offset="28%" stopColor="#5A2E12" />
          <stop offset="50%" stopColor="#7A4520" />
          <stop offset="72%" stopColor="#4A2410" />
          <stop offset="100%" stopColor="#1F0D05" />
        </linearGradient>
        <linearGradient id="kzn-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#56301A" />
          <stop offset="45%" stopColor="#33170A" />
          <stop offset="100%" stopColor="#1C0C04" />
        </linearGradient>
        <radialGradient id="kzn-rice" cx="0.5" cy="0.25" r="0.9">
          <stop offset="0%"  stopColor="#F0D49A" />
          <stop offset="55%" stopColor="#DBAE66" />
          <stop offset="100%" stopColor="#B98342" />
        </radialGradient>
        <radialGradient id="kzn-fire" cx="0.5" cy="0.6" r="0.6">
          <stop offset="0%"  stopColor="rgba(255,140,40,0.55)" />
          <stop offset="60%" stopColor="rgba(255,90,20,0.18)" />
          <stop offset="100%" stopColor="rgba(255,80,20,0)" />
        </radialGradient>
      </defs>

      {/* fire glow under the kazan */}
      <ellipse cx="70" cy="96" rx="42" ry="12" fill="url(#kzn-fire)" />
      {/* coals */}
      <ellipse cx="70" cy="99" rx="30" ry="4.5" fill="#1A0A04" />
      {[48, 58, 70, 82, 92].map((cx, i) => (
        <motion.circle
          key={i} cx={cx} cy={98 - (i % 2) * 2} r={i % 2 ? 2.6 : 3.4}
          fill={i % 2 ? '#FF8C42' : '#E45A1B'}
          animate={embersOn ? { opacity: [0.35, 1, 0.35] } : {}}
          transition={{ duration: 1.4 + i * 0.33, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {/* legs (three-legged cast kazan stand) */}
      <line x1="44" y1="84" x2="36" y2="98" stroke="#241008" strokeWidth="5.5" strokeLinecap="round" />
      <line x1="96" y1="84" x2="104" y2="98" stroke="#241008" strokeWidth="5.5" strokeLinecap="round" />
      <line x1="70" y1="88" x2="70" y2="99" stroke="#1C0C05" strokeWidth="5" strokeLinecap="round" />

      {/* body — deep hemisphere with metal gradient */}
      <path d="M 22 42 Q 16 84 70 88 Q 124 84 118 42 Z" fill="url(#kzn-body)" />
      {/* hammered-metal texture: faint horizontal forging rings */}
      <path d="M 26 56 Q 70 64 114 56" stroke="rgba(0,0,0,0.3)" strokeWidth="1.2" fill="none" />
      <path d="M 32 68 Q 70 75 108 68" stroke="rgba(0,0,0,0.28)" strokeWidth="1.2" fill="none" />
      <path d="M 42 78 Q 70 83 98 78" stroke="rgba(0,0,0,0.25)" strokeWidth="1" fill="none" />
      {/* specular sheen on the left flank */}
      <path d="M 32 46 Q 30 64 44 76 Q 34 62 37 46 Z" fill="rgba(255,200,140,0.16)" />
      {/* soot on the bottom */}
      <path d="M 38 76 Q 70 90 102 76 Q 96 84 70 87 Q 44 84 38 76 Z" fill="rgba(0,0,0,0.4)" />

      {/* rim — thick rolled lip with rivets */}
      <rect x="17" y="34" width="106" height="14" rx="7" fill="url(#kzn-rim)" />
      <rect x="17" y="34" width="106" height="5" rx="2.5" fill="rgba(255,190,120,0.18)" />
      {[28, 44, 60, 80, 96, 112].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="41" r="1.9" fill="#120703" />
          <circle cx={cx - 0.6} cy="40.4" r="0.7" fill="rgba(255,190,120,0.5)" />
        </g>
      ))}

      {/* handles — forged brackets bolted to the rim */}
      <path d="M 20 42 Q 6 42 6 30 Q 6 19 18 18" stroke="#2A1208" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M 20 42 Q 6 42 6 30 Q 6 19 18 18" stroke="rgba(255,180,110,0.25)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 120 42 Q 134 42 134 30 Q 134 19 122 18" stroke="#2A1208" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M 120 42 Q 134 42 134 30 Q 134 19 122 18" stroke="rgba(255,180,110,0.25)" strokeWidth="1.4" fill="none" strokeLinecap="round" />

      {/* plov — golden rice mound */}
      <path d="M 22 36 Q 38 22 70 22 Q 102 22 118 36 Q 102 43 70 43 Q 38 43 22 36 Z" fill="url(#kzn-rice)" />
      {/* rice grains */}
      {KAZAN_GRAINS.map((g) => (
        <ellipse key={g.id} cx={g.x} cy={g.y}
          rx="1.1" ry="2.4"
          fill={g.light ? '#F7E7BC' : '#E8CC8E'} opacity="0.85"
          transform={`rotate(${g.rot} ${g.x} ${g.y})`} />
      ))}
      {/* carrot juliennes */}
      {[[44, 30, 24], [60, 27, -18], [82, 28, 12], [98, 31, -28], [70, 33, 40]].map(([x, y, r], i) => (
        <rect key={i} x={x - 5} y={y - 1.4} width="10" height="2.8" rx="1.4"
          fill={i % 2 ? '#E8762C' : '#D9601A'}
          transform={`rotate(${r} ${x} ${y})`} />
      ))}
      {/* raisins + chickpeas */}
      <ellipse cx="52" cy="34" rx="2" ry="1.5" fill="#3E1A33" />
      <ellipse cx="90" cy="25" rx="2" ry="1.5" fill="#47203A" />
      <circle cx="36" cy="33" r="2" fill="#D4A762" />
      <circle cx="106" cy="34" r="2" fill="#C99C56" />
      {/* whole garlic head crowning the mound — the festive centrepiece */}
      <g>
        <path d="M 70 12 Q 63 14 62 20 Q 62 26 70 26 Q 78 26 78 20 Q 77 14 70 12 Z" fill="#EDE3CE" />
        <path d="M 67 13 Q 66 19 67 25" stroke="#C9B894" strokeWidth="0.9" fill="none" />
        <path d="M 70 12.5 Q 70 19 70 25.5" stroke="#C9B894" strokeWidth="0.9" fill="none" />
        <path d="M 73 13 Q 74 19 73 25" stroke="#C9B894" strokeWidth="0.9" fill="none" />
        <path d="M 70 12 Q 69 8 71 6" stroke="#B8A57E" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 64 15 Q 70 17 76 15" stroke="rgba(120,90,50,0.35)" strokeWidth="0.8" fill="none" />
      </g>
    </svg>
  )
}

// Neon iwan arch — a holographic gate from the past into the future.
// Outer gold line draws itself in; inner dashed turquoise line circulates.
function NeonArch() {
  const prefersReduced = useReducedMotion()
  return (
    <svg
      viewBox="0 0 230 300" width="230" height="300" fill="none" aria-hidden="true"
      style={{
        position: 'absolute',
        left: '50%', top: '50%',
        transform: 'translate(-50%, -54%)',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <motion.path
        d="M 18 298 L 18 120 Q 18 38 115 16 Q 212 38 212 120 L 212 298"
        stroke="rgba(212,175,55,0.55)"
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 8px rgba(245,158,11,0.45))' }}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: prefersReduced ? 0 : 1.8, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.path
        d="M 38 298 L 38 126 Q 38 56 115 38 Q 192 56 192 126 L 192 298"
        stroke="rgba(34,211,238,0.5)"
        strokeWidth="1.5"
        strokeDasharray="10 14"
        style={{ filter: 'drop-shadow(0 0 6px rgba(34,211,238,0.5))' }}
        initial={{ opacity: 0 }}
        animate={prefersReduced
          ? { opacity: 0.8 }
          : { opacity: 0.8, strokeDashoffset: [0, -240] }}
        transition={{
          opacity: { duration: 1, delay: 1.4 },
          strokeDashoffset: { duration: 14, repeat: Infinity, ease: 'linear' },
        }}
      />
    </svg>
  )
}

// Outlined holographic bodom tile, floating slowly.
function HoloTile({ size = 46, color = '#22D3EE', inner = '#F59E0B', float = 18, duration = 5.5, delay = 0, style }) {
  const prefersReduced = useReducedMotion()
  const w = size
  const h = size * 1.6
  return (
    <motion.div
      aria-hidden="true"
      style={{ position: 'absolute', pointerEvents: 'none', ...style }}
      animate={prefersReduced ? {} : { y: [0, -float, 0], rotate: [0, 6, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
        <polygon
          points={ptsStr(steppedDiamond(w / 2, h / 2, w / 2 - 2, h / 2 - 3, 5))}
          fill="none" stroke={color} strokeWidth="1.5" opacity="0.7"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
        <polygon
          points={ptsStr(steppedDiamond(w / 2, h / 2, w / 4, h / 4, 3))}
          fill={inner} opacity="0.45"
        />
      </svg>
    </motion.div>
  )
}

// Animated woven divider: ikat bands shimmer sideways forever,
// and the whole ribbon "weaves in" (scaleX) when scrolled into view.
function IkatDivider() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  // Shimmer runs only while the ribbon is actually on screen.
  const live = useInView(ref)
  const prefersReduced = useReducedMotion()
  return (
    <div ref={ref} aria-hidden="true" style={{ overflow: 'hidden', position: 'relative', zIndex: 'var(--z-content)' }}>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={inView ? { scaleX: 1 } : {}}
        transition={{ duration: prefersReduced ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: 'left center', overflow: 'hidden', height: 7 }}
      >
        <motion.div
          style={{
            height: '100%',
            width: 'calc(100% + 112px)',
            background:
              'repeating-linear-gradient(90deg, #F59E0B 0 14px, #E11D48 14px 28px, #22D3EE 28px 42px, #8B5CF6 42px 56px)',
            skewX: -24,
            transformOrigin: 'left center',
            opacity: 0.85,
          }}
          animate={prefersReduced || !live ? {} : { x: [0, -56] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION TITLE
// ═══════════════════════════════════════════════════════════════════════════

function SectionTitle({ children, sub }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const prefersReduced = useReducedMotion()
  return (
    <div ref={ref} style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
      <motion.h2
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: prefersReduced ? 0 : 0.6, ease: 'easeOut' }}
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'clamp(1.9rem, 4.5vw, 2.9rem)',
          fontWeight: 700,
          color: 'var(--cream)',
          lineHeight: 1.2,
          marginBottom: sub ? '0.6rem' : 0,
        }}
      >
        {children}
      </motion.h2>
      {sub && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: prefersReduced ? 0 : 0.6, delay: 0.15 }}
          style={{
            fontSize: '1rem',
            color: 'rgba(253,245,230,0.65)',
            fontFamily: 'var(--font-body)',
          }}
        >
          {sub}
        </motion.p>
      )}
      {/* Neon underline draws itself */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={inView ? { scaleX: 1 } : {}}
        transition={{ duration: prefersReduced ? 0 : 0.7, delay: 0.25 }}
        style={{
          height: 2, width: 90,
          margin: '1rem auto 0',
          transformOrigin: 'center',
          background: 'linear-gradient(90deg, transparent, var(--gold), var(--neon), transparent)',
          borderRadius: 2,
        }}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  PLOV CARD — 3D tilt + steam + neon hover
// ═══════════════════════════════════════════════════════════════════════════

function PlovCard({ plov, index, onOrder, lang }) {
  const [hovered, setHovered] = useState(false)
  const prefersReduced = useReducedMotion()
  const coarse = useCoarsePointer()
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-50px' })
  // Phones have no hover — a card "lights up" while it crosses the middle
  // band of the viewport instead (steam, neon border, the works).
  const centered = useInView(ref, { margin: '-38% 0px -38% 0px' })
  const active = coarse ? centered : hovered

  // Pointer-tracking 3D tilt
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(py, [0, 1], [6, -6]), { stiffness: 220, damping: 20 })
  const rotateY = useSpring(useTransform(px, [0, 1], [-6, 6]), { stiffness: 220, damping: 20 })

  const onMove = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width)
    py.set((e.clientY - r.top) / r.height)
  }, [px, py])

  const onLeave = useCallback(() => {
    px.set(0.5)
    py.set(0.5)
    setHovered(false)
  }, [px, py])

  return (
    <motion.article
      ref={ref}
      className="plov-card"
      initial={{ opacity: 0, y: 48 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      whileHover={prefersReduced ? {} : { y: -8 }}
      transition={{
        duration: prefersReduced ? 0 : 0.55,
        delay:    prefersReduced ? 0 : index * 0.11,
        ease: 'easeOut',
      }}
      onPointerMove={prefersReduced ? undefined : onMove}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={onLeave}
      style={{
        position: 'relative',
        background: 'rgba(32, 20, 48, 0.82)',
        border: `1px solid ${active ? 'rgba(34,211,238,0.45)' : 'var(--panel-line)'}`,
        borderRadius: 18,
        padding: '1.75rem 1.6rem 1.5rem',
        boxShadow: active
          ? '0 22px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(34,211,238,0.2), 0 0 34px rgba(34,211,238,0.16)'
          : '0 6px 26px rgba(0,0,0,0.32)',
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        rotateX: prefersReduced ? 0 : rotateX,
        rotateY: prefersReduced ? 0 : rotateY,
        transformPerspective: 900,
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 4, background: plov.accent,
        borderRadius: '18px 18px 0 0',
      }} />

      <CardSteam visible={active} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.09em',
          color: plov.accentLight,
          background: `${plov.accentLight}1F`,
          padding: '3px 10px', borderRadius: 99,
        }}>
          {plov.tag[lang]}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', fontWeight: 500 }}>
          {STRINGS[lang].perPortion}
        </span>
      </div>

      <h3 style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '1.32rem', fontWeight: 700,
        color: 'var(--text)',
        marginBottom: '0.55rem',
      }}>
        {plov.name[lang]}
      </h3>

      <p style={{
        fontSize: '0.91rem', lineHeight: 1.68,
        color: 'var(--text-soft)', flexGrow: 1,
        marginBottom: '1.25rem',
      }}>
        {plov.desc[lang]}
      </p>

      <button
        onClick={() => onOrder(plov.id)}
        style={{
          padding: '0.6rem 1.2rem',
          borderRadius: 10,
          border: `1.5px solid ${plov.accentLight}`,
          background: 'transparent',
          color: plov.accentLight,
          fontSize: '0.88rem', fontWeight: 600,
          cursor: 'pointer',
          letterSpacing: '0.03em',
          transition: 'background 0.2s, color 0.2s',
          alignSelf: 'flex-start',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = plov.accentLight
          e.currentTarget.style.color = '#1A120B'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = plov.accentLight
        }}
      >
        {STRINGS[lang].orderThis}
      </button>
    </motion.article>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  JOURNEY — eras crossfade in place: each one rises in, then evaporates.
//  (Replaced the long horizontal track — на слабых машинах он казался багом.)
// ═══════════════════════════════════════════════════════════════════════════

function EraPanel({ era, lang, fill = true }) {
  return (
    <div
      style={{
        width: '100%',
        height: fill ? '100%' : 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 6rem) clamp(1.25rem, 6vw, 4rem)',
      }}
    >
      {/* Giant year watermark */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-heading)',
        fontWeight: 900,
        fontSize: 'clamp(3.2rem, 10vw, 9rem)',
        color: 'transparent',
        WebkitTextStroke: `1px ${era.accent}26`,
        userSelect: 'none',
        pointerEvents: 'none',
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
      }}>
        {era.year[lang]}
      </div>

      {/* Era radial tint */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 55% 45% at 50% 55%, ${era.accent}14 0%, transparent 70%)`,
      }} />

      <div style={{
        position: 'relative',
        maxWidth: 540,
        textAlign: 'center',
        background: 'rgba(16,10,32,0.78)',
        border: `1px solid ${era.accent}3D`,
        borderRadius: 22,
        padding: 'clamp(1.8rem, 4vw, 2.8rem)',
        boxShadow: `0 18px 60px rgba(0,0,0,0.4), 0 0 40px ${era.accent}14`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.2rem' }}>
          <svg width="40" height="64" viewBox="0 0 40 64" aria-hidden="true" style={{ overflow: 'visible' }}>
            <polygon
              points={ptsStr(steppedDiamond(20, 32, 17, 29, 5))}
              fill="none" stroke={era.accent} strokeWidth="1.5"
              style={{ filter: `drop-shadow(0 0 7px ${era.accent})` }}
            />
            <polygon points={ptsStr(steppedDiamond(20, 32, 8, 14, 3))} fill={era.accent} opacity="0.6" />
          </svg>
        </div>

        <p style={{
          fontSize: '0.74rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.28em',
          color: era.accent, marginBottom: '0.6rem',
        }}>
          {era.year[lang]}
        </p>

        <h3 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'clamp(1.6rem, 4vw, 2.3rem)',
          fontWeight: 700, color: 'var(--cream)',
          marginBottom: '0.9rem', lineHeight: 1.2,
        }}>
          {era.title[lang]}
        </h3>

        <p style={{
          fontSize: '0.96rem', lineHeight: 1.75,
          color: 'var(--text-soft)',
        }}>
          {era.text[lang]}
        </p>
      </div>
    </div>
  )
}

// Rice-burst configs: one stable random set per era, generated at module load.
// Each grain starts somewhere on the card and flies outward on a gravity arc.
const GRAIN_SETS = ERAS.map(() =>
  Array.from({ length: 22 }, (_, i) => {
    const dir = Math.random() * Math.PI * 2
    const dist = 120 + Math.random() * 280
    return {
      id: i,
      sx: (Math.random() - 0.5) * 300,            // start offset from card centre
      sy: (Math.random() - 0.5) * 180,
      dx: Math.cos(dir) * dist,                   // horizontal scatter
      midY: -50 - Math.random() * 90,             // rise of the arc
      endY: 180 + Math.random() * 260,            // fall below
      spin: (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 380),
      w: 5 + Math.random() * 3,
      h: 11 + Math.random() * 5,
      fill: Math.random() > 0.4 ? '#F5DEB3' : '#EED9A0',
    }
  }))

// A single rice grain scrubbed by the slide's exit progress: bursts out of the
// dissolving card, arcs up, tumbles down and fades. Scroll back — it returns.
function FlyingGrain({ exitP, g }) {
  const x = useTransform(exitP, [0, 1], [g.sx, g.sx + g.dx])
  const y = useTransform(exitP, [0, 0.45, 1], [g.sy, g.sy + g.midY, g.sy + g.endY])
  const rotate = useTransform(exitP, [0, 1], [0, g.spin])
  const opacity = useTransform(exitP, [0, 0.1, 0.7, 1], [0, 1, 0.9, 0])
  return (
    <motion.div style={{
      position: 'absolute', left: '50%', top: '50%',
      x, y, rotate, opacity,
      willChange: 'transform, opacity',
    }}>
      <svg width={g.w} height={g.h} viewBox="0 0 6 13">
        <ellipse cx="3" cy="6.5" rx="2.4" ry="6" fill={g.fill} />
      </svg>
    </motion.div>
  )
}

// One era slide: rises from the depth, holds, then FLIES FORWARD into the
// viewer and shatters into rice grains. Transform/opacity only — composited.
function EraSlide({ era, index, total, progress, lang }) {
  const prefersReduced = useReducedMotion()
  const start = index / total
  const end = (index + 1) / total
  const f = 0.34 / total // transition width
  const isFirst = index === 0
  const isLast = index === total - 1

  // All ranges MUST stay inside [0,1] and ascending: Motion promotes
  // scroll-linked values to native WAAPI scroll timelines, where these
  // become keyframe offsets — out-of-range values crash the browser API.
  // Outside its range useTransform clamps, so the first slide simply
  // starts visible and the last one stays visible.
  let range, oOut, sOut, yOut
  if (isFirst) {
    range = [end, end + f]
    oOut = [1, 0]; sOut = [1, 1.6]; yOut = [0, -10]
  } else if (isLast) {
    range = [start - f, start]
    oOut = [0, 1]; sOut = [0.9, 1]; yOut = [26, 0]
  } else {
    range = [start - f, start, end, end + f]
    oOut = [0, 1, 1, 0]; sOut = [0.9, 1, 1, 1.6]; yOut = [26, 0, 0, -10]
  }
  const opacity = useTransform(progress, range, oOut)
  const scale   = useTransform(progress, range, sOut)
  const y       = useTransform(progress, range, yOut)

  // Exit progress 0→1 drives the rice burst (last slide never dissolves).
  const exitP = useTransform(
    progress,
    isLast ? [0.999, 1] : [end, Math.min(end + f * 0.95, 1)],
    [0, 1],
  )
  const showGrains = !isLast && !prefersReduced && !IS_LITE

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* The card itself — dissolves as it flies toward the viewer */}
      <motion.div style={{
        position: 'absolute', inset: 0,
        opacity, scale, y,
        willChange: 'transform, opacity',
      }}>
        <EraPanel era={era} lang={lang} />
      </motion.div>

      {/* Rice burst layer — stays visible while the card fades */}
      {showGrains && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          {GRAIN_SETS[index].map((g) => (
            <FlyingGrain key={g.id} exitP={exitP} g={g} />
          ))}
        </div>
      )}
    </div>
  )
}

function JourneySection({ lang }) {
  const prefersReduced = useReducedMotion()
  const t = STRINGS[lang]
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })

  // Reduced motion: plain vertical stack, no scroll choreography.
  if (prefersReduced) {
    return (
      <section id="journey" style={{ position: 'relative', zIndex: 'var(--z-content)' }}>
        <div style={{ padding: 'clamp(3rem, 8vw, 5rem) 0 0' }}>
          <SectionTitle sub={t.journeySub}>{t.journeyTitle}</SectionTitle>
        </div>
        {ERAS.map((era) => <EraPanel key={era.num} era={era} lang={lang} fill={false} />)}
      </section>
    )
  }

  return (
    <section
      id="journey"
      ref={ref}
      style={{
        position: 'relative',
        height: `${ERAS.length * 100}svh`,
        zIndex: 'var(--z-content)',
      }}
    >
      <div style={{
        position: 'sticky', top: 0,
        height: '100svh',
        overflow: 'hidden',
      }}>
        {/* Era slides, stacked and crossfading */}
        {ERAS.map((era, i) => (
          <EraSlide key={era.num} era={era} index={i} total={ERAS.length}
            progress={scrollYProgress} lang={lang} />
        ))}

        {/* Sticky section header */}
        <div style={{
          position: 'absolute', top: 'clamp(1.5rem, 4vh, 3rem)', left: 0, right: 0,
          textAlign: 'center', zIndex: 2, pointerEvents: 'none',
        }}>
          <p style={{
            fontSize: '0.72rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.3em',
            color: 'var(--gold)', marginBottom: '0.3rem',
          }}>
            {t.journeyTitle}
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)' }}>
            {t.journeySub}
          </p>
        </div>

        {/* Progress thread at the bottom — fills as you travel */}
        <div style={{
          position: 'absolute', bottom: 'clamp(1.2rem, 4vh, 2.4rem)', left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(70vw, 360px)',
          zIndex: 2,
        }}>
          <div style={{
            height: 2, borderRadius: 2,
            background: 'rgba(253,245,230,0.14)',
            overflow: 'hidden',
          }}>
            <motion.div style={{
              height: '100%',
              transformOrigin: 'left center',
              scaleX: scrollYProgress,
              background: 'linear-gradient(90deg, #F59E0B, #E11D48, #10B981, #22D3EE)',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            {ERAS.map((era) => (
              <span key={era.num} style={{
                fontSize: '0.62rem', fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
              }}>
                {era.year[lang]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATS — counters that spin up when scrolled into view
// ═══════════════════════════════════════════════════════════════════════════

function Counter({ to, duration = 1.5, lang = 'en' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const prefersReduced = useReducedMotion()
  const [val, setVal] = useState(0)

  useEffect(() => {
    if (!inView) return
    let raf
    const t0 = performance.now()
    const dur = prefersReduced ? 0 : duration * 1000
    const tick = (t) => {
      const p = dur === 0 ? 1 : Math.min((t - t0) / dur, 1)
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, prefersReduced, to, duration])

  return <span ref={ref}>{val.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}</span>
}

function StatsStrip({ lang }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const prefersReduced = useReducedMotion()
  return (
    <section
      ref={ref}
      style={{
        position: 'relative',
        zIndex: 'var(--z-content)',
        padding: 'clamp(2.5rem, 6vw, 4rem) clamp(1rem, 5vw, 3rem)',
        background: 'linear-gradient(180deg, rgba(20,12,40,0.7) 0%, rgba(14,9,30,0.82) 100%)',
        borderTop: '1px solid rgba(34,211,238,0.12)',
        borderBottom: '1px solid rgba(34,211,238,0.12)',
      }}
    >
      <div style={{
        maxWidth: 1020, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
        gap: '2rem 1.5rem',
        textAlign: 'center',
      }}>
        {STATS.map((s, i) => (
          <motion.div
            key={s.to}
            initial={{ opacity: 0, y: 26 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: prefersReduced ? 0 : 0.5, delay: prefersReduced ? 0 : i * 0.1 }}
          >
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 5vw, 2.9rem)',
              fontWeight: 900,
              color: 'var(--gold-light)',
              textShadow: '0 0 26px rgba(245,158,11,0.35), 0 0 60px rgba(34,211,238,0.18)',
              lineHeight: 1.1,
            }}>
              <Counter to={s.to} lang={lang} />{s.suffix[lang]}
            </div>
            <p style={{
              marginTop: 6,
              fontSize: '0.85rem',
              color: 'var(--text-soft)',
              letterSpacing: '0.02em',
            }}>
              {s.label[lang]}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  ORDER MODAL
// ═══════════════════════════════════════════════════════════════════════════

function WaIcon({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  )
}

function TgIcon({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function OrderModal({ isOpen, onClose, defaultPlov, lang }) {
  const t = STRINGS[lang]
  const [plov, setPlov] = useState(defaultPlov || PLOV_TYPES[0].id)
  const [format, setFormat] = useState('portions')
  const [qty, setQty] = useState(2)
  const [name, setName] = useState('')
  const prefersReduced = useReducedMotion()
  const firstInputRef = useRef(null)

  // Pick up the pre-selected plov each time the modal opens — the sanctioned
  // "adjust state during render" pattern (no effect, no extra paint).
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen)
    if (isOpen && defaultPlov) setPlov(defaultPlov)
  }

  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => firstInputRef.current?.focus(), 50)
      return () => clearTimeout(id)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const minQty = format === 'kazan' ? 3 : 1
  const setFormatSafe = (v) => {
    setFormat(v)
    if (v === 'kazan' && qty < 3) setQty(3)
  }

  // The order is finished in the messenger of choice with a pre-filled text.
  const sendVia = (kind) => {
    const p = PLOV_TYPES.find((x) => x.id === plov)
    const lines = [
      t.msg.hello,
      `• ${t.msg.type}: ${p ? p.name[lang] : ''}`,
      `• ${t.msg.format}: ${t.formats[format]}`,
    ]
    if (format !== 'chef') {
      lines.push(`• ${t.msg.qty}: ${qty} ${format === 'kazan' ? t.msg.kgUnit : t.msg.portionsUnit}`)
    }
    if (name.trim()) lines.push(`• ${t.msg.name}: ${name.trim()}`)
    const msg = lines.join('\n')
    window.open(kind === 'wa' ? waUrl(msg) : tgUrl(msg), '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReduced ? 0 : 0.22 }}
            onClick={onClose}
            aria-hidden="true"
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(10,8,24,0.74)',
              backdropFilter: 'blur(4px)',
              zIndex: 'var(--z-modal)',
            }}
          />

          {/* Flex wrapper guarantees true centering — motion transforms on the
              dialog itself would override a translate(-50%,-50%) hack. */}
          <div
            style={{
              position: 'fixed', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 'calc(var(--z-modal) + 1)',
              pointerEvents: 'none',
            }}
          >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={{ opacity: 0, scale: 0.93, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: 16 }}
            transition={{ duration: prefersReduced ? 0 : 0.28, ease: 'easeOut' }}
            style={{
              position: 'relative',
              width: 'min(92vw, 480px)',
              maxHeight: '90svh',
              overflowY: 'auto',
              background: 'var(--cream)',
              borderRadius: 22,
              padding: '2.2rem 2rem',
              pointerEvents: 'auto',
              boxShadow: '0 28px 90px rgba(8,5,20,0.6), 0 0 60px rgba(34,211,238,0.12)',
            }}
          >
            <button
              aria-label="Close"
              onClick={onClose}
              style={{
                position: 'absolute', top: 14, right: 14,
                background: 'rgba(107,58,42,0.1)',
                border: 'none',
                width: 34, height: 34,
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--brown-mid)',
                fontSize: 16, fontWeight: 700,
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,58,42,0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(107,58,42,0.1)'}
            >
              ✕
            </button>

            <h2 id="modal-title" style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1.65rem', fontWeight: 700,
              color: 'var(--brown-dark)',
              marginBottom: '0.3rem',
            }}>
              {t.mTitle}
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#8B6F56', marginBottom: '1.6rem' }}>
              {t.mSub}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div>
                <label htmlFor="order-plov" style={labelSt}>{t.mPlov}</label>
                <div style={{ position: 'relative' }}>
                  <select
                    id="order-plov" ref={firstInputRef}
                    value={plov}
                    onChange={e => setPlov(e.target.value)}
                    className="plov-input"
                    style={{ ...inputSt, cursor: 'pointer', appearance: 'none', paddingRight: '2.5rem' }}
                  >
                    {PLOV_TYPES.map(p => (
                      <option key={p.id} value={p.id}>{p.name[lang]}</option>
                    ))}
                  </select>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                    stroke="var(--brown-mid)" strokeWidth="2"
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              <div>
                <label htmlFor="order-format" style={labelSt}>{t.mFormat}</label>
                <div style={{ position: 'relative' }}>
                  <select
                    id="order-format"
                    value={format}
                    onChange={e => setFormatSafe(e.target.value)}
                    className="plov-input"
                    style={{ ...inputSt, cursor: 'pointer', appearance: 'none', paddingRight: '2.5rem' }}
                  >
                    <option value="portions">{t.formats.portions}</option>
                    <option value="chef">{t.formats.chef}</option>
                    <option value="kazan">{t.formats.kazan}</option>
                  </select>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                    stroke="var(--brown-mid)" strokeWidth="2"
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              {format !== 'chef' && (
                <div>
                  <label htmlFor="order-qty" style={labelSt}>
                    {format === 'kazan' ? t.mQtyKg : t.mQtyPortions}
                  </label>
                  <input
                    id="order-qty"
                    type="number"
                    min={minQty} max={100} step={1}
                    value={qty}
                    onChange={e => setQty(Math.max(minQty, Math.min(100, Number(e.target.value) || minQty)))}
                    className="plov-input"
                    style={inputSt}
                  />
                </div>
              )}

              <div>
                <label htmlFor="order-name" style={labelSt}>{t.mName}</label>
                <input
                  id="order-name"
                  type="text"
                  placeholder={t.mNamePh}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="plov-input"
                  style={inputSt}
                />
              </div>

              <button type="button" onClick={() => sendVia('wa')} className="cta-btn"
                style={{
                  padding: '0.88rem 1.5rem',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #2BB741 0%, #1B9E4B 100%)',
                  color: '#fff',
                  fontSize: '1rem', fontWeight: 700,
                  cursor: 'pointer',
                  letterSpacing: '0.02em',
                  marginTop: '0.3rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  transition: 'opacity 0.2s, box-shadow 0.25s',
                }}>
                <WaIcon /> {t.mWa}
              </button>

              <button type="button" onClick={() => sendVia('tg')} className="cta-btn"
                style={{
                  padding: '0.88rem 1.5rem',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #34AADF 0%, #1F8FCB 100%)',
                  color: '#fff',
                  fontSize: '1rem', fontWeight: 700,
                  cursor: 'pointer',
                  letterSpacing: '0.02em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  transition: 'opacity 0.2s, box-shadow 0.25s',
                }}>
                <TgIcon /> {t.mTg}
              </button>

              <p style={{ fontSize: '0.8rem', color: '#8B6F56', textAlign: 'center' }}>
                {t.mNote}
              </p>
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

const labelSt = {
  display: 'block',
  fontSize: '0.76rem', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--brown-mid)', marginBottom: '0.4rem',
}

const inputSt = {
  width: '100%',
  padding: '0.72rem 1rem',
  borderRadius: 10,
  border: '1.5px solid #E8D5B5',
  background: '#fff',
  fontSize: '1rem',
  color: 'var(--brown-dark)',
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
}

// ═══════════════════════════════════════════════════════════════════════════
//  HERO — letters, neon arch, holo tiles; melts away as you scroll
// ═══════════════════════════════════════════════════════════════════════════

function HeroSection({ onOrder, lang }) {
  const t = STRINGS[lang]
  const prefersReduced = useReducedMotion()
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  const contentScale = useTransform(scrollYProgress, [0, 1], [1, 0.9])
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -80])
  // Pause every infinite hero animation once the hero is scrolled away —
  // steam, holo tiles, arch dashes and embers stop burning frames.
  const heroVisible = useInView(heroRef)

  return (
    <section
      ref={heroRef}
      style={{
        position: 'relative',
        minHeight: '100svh',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        zIndex: 'var(--z-content)',
        padding: 'clamp(2rem, 5vw, 4rem) clamp(1rem, 5vw, 3rem)',
      }}
    >
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 65% 55% at 50% 60%, rgba(245,158,11,0.1) 0%, transparent 70%)',
      }} />

      {/* Floating holographic bodom tiles (only animate while hero is visible) */}
      {heroVisible && (
        <>
          <HoloTile style={{ left: '7%',  top: '16%' }} size={44} color="#22D3EE" inner="#F59E0B" duration={6}   />
          <HoloTile style={{ right: '9%', top: '22%' }} size={34} color="#E11D48" inner="#FACC15" duration={7.2} delay={1.1} />
          <HoloTile style={{ left: '13%', bottom: '18%' }} size={30} color="#8B5CF6" inner="#22D3EE" duration={5.4} delay={0.6} />
          <HoloTile style={{ right: '14%', bottom: '24%' }} size={48} color="#F59E0B" inner="#E11D48" duration={8}   delay={1.8} />
        </>
      )}

      <motion.div style={{
        textAlign: 'center',
        position: 'relative',
        zIndex: 2,
        maxWidth: 700,
        opacity: prefersReduced ? 1 : contentOpacity,
        scale:   prefersReduced ? 1 : contentScale,
        y:       prefersReduced ? 0 : contentY,
      }}>
        {/* Kazan framed by the neon iwan arch */}
        <div style={{
          position: 'relative', width: 150, height: 130,
          margin: '0 auto 2rem',
        }}>
          {heroVisible && <NeonArch />}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: prefersReduced ? 0 : 0.9, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ position: 'relative', top: 24 }}
          >
            <KazanIcon live={heroVisible} />
          </motion.div>
          {heroVisible && <HeroSteam />}
        </div>

        <motion.p
          initial={{ opacity: 0, letterSpacing: '0.6em' }}
          animate={{ opacity: 1, letterSpacing: '0.22em' }}
          transition={{ duration: prefersReduced ? 0 : 1.1, ease: 'easeOut' }}
          style={{
            fontSize: '0.72rem', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.22em',
            color: 'var(--gold)', marginBottom: '0.7rem',
            fontFamily: 'var(--font-body)',
          }}
        >
          {t.eyebrow}
        </motion.p>

        <motion.h1
          key={lang}
          aria-label={t.title}
          initial="hidden"
          animate="visible"
          variants={{
            visible: {
              transition: { staggerChildren: prefersReduced ? 0 : 0.13, delayChildren: 0.25 },
            },
          }}
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'clamp(4.5rem, 16vw, 9rem)',
            fontWeight: 900, lineHeight: 0.92,
            color: 'var(--cream)',
            margin: '0 0 0.3em',
            letterSpacing: '-0.025em',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {t.title.split('').map((ch, i) => (
            <motion.span
              key={i}
              aria-hidden="true"
              variants={{
                hidden:  { opacity: 0, y: 60, rotateX: -90, filter: 'blur(8px)' },
                visible: {
                  opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)',
                  transition: { duration: prefersReduced ? 0 : 0.7, ease: [0.2, 0.8, 0.2, 1] },
                },
              }}
              style={{
                display: 'inline-block',
                transformOrigin: 'bottom',
                textShadow: '0 0 40px rgba(245,158,11,0.4), 0 0 90px rgba(34,211,238,0.22)',
              }}
            >
              {ch}
            </motion.span>
          ))}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.7, delay: 0.42 }}
          style={{
            fontSize: 'clamp(1.05rem, 3vw, 1.35rem)',
            fontFamily: 'var(--font-heading)',
            fontStyle: 'italic', fontWeight: 400,
            color: 'rgba(253,245,230,0.8)',
            marginBottom: '2.2rem', lineHeight: 1.45,
          }}
        >
          {t.tagline}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: prefersReduced ? 0 : 0.5, delay: 0.85 }}
          style={{ position: 'relative', display: 'inline-block' }}
        >
          {!prefersReduced && heroVisible && (
            <motion.div
              aria-hidden="true"
              animate={{ opacity: [0.45, 0.85, 0.45], scale: [0.95, 1.08, 0.95] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute', inset: -6,
                borderRadius: 18,
                background: 'radial-gradient(ellipse at center, rgba(245,158,11,0.65) 0%, transparent 70%)',
                filter: 'blur(16px)',
                zIndex: 0,
                pointerEvents: 'none',
              }}
            />
          )}
          <motion.button
            whileHover={prefersReduced ? {} : { scale: 1.06 }}
            whileTap={prefersReduced  ? {} : { scale: 0.96 }}
            onClick={() => onOrder()}
            className="cta-btn"
            style={{
              position: 'relative', zIndex: 1,
              padding: '1.05rem 2.8rem',
              borderRadius: 14,
              border: 'none',
              background: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 50%, #D4AF37 100%)',
              color: '#2D1505',
              fontSize: '1.12rem', fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              fontFamily: 'var(--font-body)',
              boxShadow: '0 8px 36px rgba(212,175,55,0.45)',
              transition: 'box-shadow 0.28s',
            }}
          >
            {t.cta}
          </motion.button>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: prefersReduced ? 0 : 1.5 }}
        style={{
          position: 'absolute', bottom: 32, left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 6, color: 'rgba(253,245,230,0.35)',
          fontSize: '0.7rem', letterSpacing: '0.12em',
          textTransform: 'uppercase', fontFamily: 'var(--font-body)',
          pointerEvents: 'none',
        }}
      >
        <span>{t.scrollHint}</span>
        <motion.div
          animate={prefersReduced ? {} : { y: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
            stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.div>
      </motion.div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  LANGUAGE TOGGLE — РУС / ENG pill pinned to the top-right corner
// ═══════════════════════════════════════════════════════════════════════════

function LangToggle({ lang, setLang }) {
  return (
    <div style={{
      position: 'fixed', top: 12, right: 14,
      zIndex: 45,
      display: 'flex', gap: 2, padding: 3,
      borderRadius: 99,
      background: 'rgba(12,8,28,0.78)',
      border: '1px solid rgba(212,175,55,0.3)',
    }}>
      {[['en', 'ENG'], ['ru', 'РУС']].map(([code, label]) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          style={{
            padding: '5px 12px',
            borderRadius: 99,
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.72rem', fontWeight: 700,
            letterSpacing: '0.08em',
            fontFamily: 'var(--font-body)',
            background: lang === code
              ? 'linear-gradient(135deg, #F59E0B, #D4AF37)'
              : 'transparent',
            color: lang === code ? '#2D1505' : 'rgba(253,245,230,0.7)',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  BOOT SPLASH — picks up where the instant HTML splash leaves off, then melts
// ═══════════════════════════════════════════════════════════════════════════

function BootSplash() {
  const prefersReduced = useReducedMotion()
  const [show, setShow] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setShow(false), prefersReduced ? 300 : 1500)
    return () => clearTimeout(t)
  }, [prefersReduced])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden="true"
          exit={{ opacity: 0, scale: prefersReduced ? 1 : 1.06 }}
          transition={{ duration: prefersReduced ? 0.15 : 0.65, ease: 'easeInOut' }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background:
              'radial-gradient(ellipse 90% 70% at 50% 32%, #241438 0%, #160F28 52%, #0C081C 100%)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'relative', width: 140, height: 120 }}>
            <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>
              <KazanIcon />
            </div>
            <HeroSteam />
          </div>
          <p style={{
            marginTop: 26,
            fontFamily: 'var(--font-heading)',
            fontSize: '1.6rem', fontWeight: 700,
            color: 'var(--gold)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
          }}>
            Plov House
          </p>
          <div style={{
            marginTop: 18, width: 130, height: 2, borderRadius: 2,
            background: 'rgba(253,245,230,0.12)',
            overflow: 'hidden', position: 'relative',
          }}>
            <motion.div
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 58, borderRadius: 2,
                background: 'linear-gradient(90deg, #F59E0B, #22D3EE)',
              }}
              animate={prefersReduced ? {} : { x: [-60, 132] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════

export default function App() {
  const [modalOpen, setModalOpen]   = useState(false)
  const [defaultPlov, setDefaultPlov] = useState('')
  const [lang, setLang] = useState(INITIAL_LANG)
  const prefersReduced = useReducedMotion()
  const t = STRINGS[lang]

  // Keep the document in sync with the chosen language.
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = STRINGS[lang].docTitle
    try { localStorage.setItem('plov-lang', lang) } catch { /* private mode */ }
  }, [lang])

  const openOrder = useCallback((plovId = '') => {
    // Tiny haptic tick on phones that support it
    if (navigator.vibrate) navigator.vibrate(12)
    setDefaultPlov(plovId)
    setModalOpen(true)
  }, [])

  const stepsRef = useRef(null)
  const stepsInView = useInView(stepsRef, { once: true, margin: '-60px' })

  const tradRef = useRef(null)
  const tradInView = useInView(tradRef, { once: true, margin: '-60px' })

  // Slow medallion spin behind the tradition quote, driven by page scroll.
  const { scrollYProgress } = useScroll()
  const medallionRotate = useTransform(scrollYProgress, [0, 1], [0, 160])

  return (
    <>
      <BootSplash />
      <IkatBackground />
      <Skyline />
      <RiceRain />
      <ScrollProgress />
      <EdgeGlow />
      <TapRipples />
      <LangToggle lang={lang} setLang={setLang} />
      <OrderModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultPlov={defaultPlov}
        lang={lang}
      />

      <HeroSection onOrder={openOrder} lang={lang} />

      <IkatDivider />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ PLOV TYPES ━━ */}
      <section
        id="menu"
        style={{
          position: 'relative',
          background: 'transparent',
          padding: 'clamp(3rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem)',
          zIndex: 'var(--z-content)',
        }}
      >
        <SectionTitle sub={t.menuSub}>
          {t.menuTitle}
        </SectionTitle>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: '1.5rem',
          maxWidth: 1120, margin: '0 auto',
          position: 'relative', zIndex: 1,
          perspective: 1200,
        }}>
          {PLOV_TYPES.map((plov, i) => (
            <PlovCard key={plov.id} plov={plov} index={i} onOrder={openOrder} lang={lang} />
          ))}
        </div>
      </section>

      <IkatDivider />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━ JOURNEY THROUGH THE CENTURIES ━━ */}
      <JourneySection lang={lang} />

      <StatsStrip lang={lang} />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ HOW TO ORDER ━━ */}
      <section
        id="order"
        style={{
          background: 'linear-gradient(155deg, rgba(30,16,52,0.55) 0%, rgba(46,22,70,0.45) 60%, rgba(20,40,62,0.42) 100%)',
          padding: 'clamp(3rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem)',
          position: 'relative',
          zIndex: 'var(--z-content)',
        }}
      >
        <SectionTitle sub={t.servicesSub}>
          {t.servicesTitle}
        </SectionTitle>

        <div ref={stepsRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
            gap: '1.8rem',
            maxWidth: 920, margin: '0 auto',
          }}
        >
          {SERVICES.map((step, i) => (
            <motion.div key={step.num}
              initial={{ opacity: 0, y: 38 }}
              animate={stepsInView ? { opacity: 1, y: 0 } : {}}
              transition={{
                duration: prefersReduced ? 0 : 0.55,
                delay:    prefersReduced ? 0 : i * 0.14,
                ease: 'easeOut',
              }}
              style={{
                textAlign: 'center',
                padding: '2.2rem 1.6rem',
                borderRadius: 18,
                background: 'rgba(253,245,230,0.055)',
                border: '1px solid rgba(212,175,55,0.18)',
              }}
            >
              <div style={{
                width: 66, height: 66, borderRadius: '50%',
                background: 'rgba(212,175,55,0.13)',
                border: '1.5px solid rgba(212,175,55,0.38)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 1.1rem',
                color: 'var(--gold)',
                boxShadow: '0 0 24px rgba(34,211,238,0.1)',
              }}>
                <step.Icon />
              </div>

              <div style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '0.72rem', fontWeight: 700,
                color: 'var(--gold)', letterSpacing: '0.08em',
                textTransform: 'uppercase', marginBottom: '0.4rem',
              }}>
                {step.num}
              </div>

              <h3 style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.18rem', fontWeight: 600,
                color: 'var(--cream)',
                marginBottom: '0.65rem',
              }}>
                {step.title[lang]}
              </h3>

              <p style={{
                fontSize: '0.9rem', color: 'rgba(253,245,230,0.68)',
                lineHeight: 1.65,
              }}>
                {step.desc[lang]}
              </p>
            </motion.div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <motion.button
            whileHover={prefersReduced ? {} : { scale: 1.05 }}
            whileTap={prefersReduced  ? {} : { scale: 0.96 }}
            onClick={() => openOrder()}
            className="cta-btn"
            style={{
              padding: '1rem 2.6rem',
              borderRadius: 13,
              border: 'none',
              background: 'linear-gradient(135deg, #F59E0B, #D4AF37)',
              color: '#2D1505',
              fontSize: '1.05rem', fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.04em',
              fontFamily: 'var(--font-body)',
              boxShadow: '0 6px 28px rgba(212,175,55,0.35)',
              transition: 'box-shadow 0.28s',
            }}
          >
            {t.ctaNow}
          </motion.button>
        </div>
      </section>

      <IkatDivider />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ TRADITION ━━ */}
      <section
        id="tradition"
        style={{
          background: 'transparent',
          padding: 'clamp(3rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem)',
          position: 'relative',
          zIndex: 'var(--z-content)',
          overflow: 'hidden',
        }}
      >
        {/* Slowly rotating ikat medallion behind the quote */}
        <motion.div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%', top: '50%',
            x: '-50%', y: '-50%',
            rotate: prefersReduced ? 0 : medallionRotate,
            pointerEvents: 'none',
            opacity: 0.5,
          }}
        >
          <svg width="420" height="420" viewBox="0 0 420 420" style={{ overflow: 'visible' }}>
            <polygon
              points={ptsStr(steppedDiamond(210, 210, 180, 180, 9))}
              fill="none" stroke="rgba(212,175,55,0.14)" strokeWidth="1.5"
            />
            <polygon
              points={ptsStr(steppedDiamond(210, 210, 120, 120, 7))}
              fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth="1.5"
            />
            <polygon
              points={ptsStr(steppedDiamond(210, 210, 60, 60, 5))}
              fill="none" stroke="rgba(225,29,72,0.12)" strokeWidth="1.5"
            />
          </svg>
        </motion.div>

        <div ref={tradRef}
          style={{ maxWidth: 740, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}
        >
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={tradInView ? { scaleX: 1, opacity: 1 } : {}}
            transition={{ duration: prefersReduced ? 0 : 0.7 }}
            style={{
              height: 3,
              width: 80,
              background: 'linear-gradient(90deg, transparent, var(--saffron), transparent)',
              margin: '0 auto 2rem',
              borderRadius: 2,
            }}
          />

          <motion.blockquote
            initial={{ opacity: 0, y: 22 }}
            animate={tradInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: prefersReduced ? 0 : 0.7, delay: 0.1 }}
            style={{ margin: 0 }}
          >
            <p style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(1.55rem, 3.8vw, 2.1rem)',
              fontStyle: 'italic', fontWeight: 400,
              color: 'var(--text)',
              lineHeight: 1.45,
              marginBottom: '1.6rem',
            }}>
              {t.quote}
            </p>
          </motion.blockquote>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={tradInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: prefersReduced ? 0 : 0.7, delay: 0.22 }}
          >
            <div style={{
              width: 48, height: 3,
              background: 'var(--saffron)',
              margin: '0 auto 1.6rem', borderRadius: 2,
            }} />

            <p style={{
              fontSize: '1rem', color: 'var(--text-soft)',
              lineHeight: 1.78, fontFamily: 'var(--font-body)',
              maxWidth: 660, margin: '0 auto',
            }}>
              {t.traditionText}
            </p>
          </motion.div>
        </div>
      </section>

      <IkatDivider />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ FOOTER ━━ */}
      <footer
        id="contacts"
        style={{
          background: 'rgba(8,6,18,0.9)',
          borderTop: '1px solid rgba(34,211,238,0.14)',
          padding: 'clamp(2.5rem, 7vw, 4.5rem) clamp(1rem, 5vw, 3rem)',
          position: 'relative',
          zIndex: 'var(--z-content)',
        }}
      >
        <div style={{
          maxWidth: 1120, margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '2.5rem 2rem',
        }}>
          <div>
            <h2 style={{
              fontFamily: 'var(--font-heading)',
              color: 'var(--gold)', fontSize: '1.7rem',
              fontWeight: 700, marginBottom: '0.4rem',
            }}>
              Plov House
            </h2>
            <p style={{ color: 'rgba(253,245,230,0.55)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              {t.footerBrandSub}
            </p>
          </div>

          <div>
            <h3 style={footerHeadSt}>{t.contactsHead}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <a href={waUrl('')} target="_blank" rel="noopener noreferrer" style={footerLinkSt}>
                <span style={{ color: '#25D366', display: 'inline-flex', flexShrink: 0 }}><WaIcon size={15} /></span>
                WhatsApp · +971 52 611 34 77
              </a>
              <a href={tgUrl('')} target="_blank" rel="noopener noreferrer" style={footerLinkSt}>
                <span style={{ color: '#34AADF', display: 'inline-flex', flexShrink: 0 }}><TgIcon size={15} /></span>
                Telegram · @{TG_USER}
              </a>
            </div>
            <h3 style={{ ...footerHeadSt, marginTop: '1.2rem' }}>{t.whereHead}</h3>
            <a href={MAPS_URL} target="_blank" rel="noopener noreferrer" style={footerLinkSt}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {t.whereName}
            </a>
            <p style={{ fontSize: '0.82rem', color: 'rgba(253,245,230,0.45)', marginTop: 4, paddingLeft: 22 }}>
              {t.whereArea}
            </p>
          </div>

          <div>
            <h3 style={footerHeadSt}>{t.infoHead}</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {t.infoLines.map(text => (
                <li key={text} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                  fontSize: '0.9rem', color: 'rgba(253,245,230,0.68)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--saffron)', flexShrink: 0 }} />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={footerHeadSt}>{t.orderHead}</h3>
            <button
              onClick={() => openOrder()}
              className="cta-btn"
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: 11, border: 'none',
                background: 'linear-gradient(135deg, #F59E0B, #D4AF37)',
                color: '#2D1505',
                fontSize: '0.95rem', fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.03em',
                fontFamily: 'var(--font-body)',
                alignSelf: 'flex-start',
                boxShadow: '0 4px 20px rgba(212,175,55,0.28)',
                transition: 'box-shadow 0.28s',
              }}
            >
              {t.orderBtn}
            </button>
            <p style={{ fontSize: '0.8rem', color: 'rgba(253,245,230,0.38)' }}>
              {t.orderNote}
            </p>
          </div>
        </div>

        <div style={{
          maxWidth: 1120, margin: '2.5rem auto 0',
          paddingTop: '1.5rem',
          borderTop: '1px solid rgba(212,175,55,0.12)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap', gap: '0.5rem',
        }}>
          <p style={{ color: 'rgba(253,245,230,0.28)', fontSize: '0.82rem' }}>
            {t.copyright}
          </p>
          <p style={{ color: 'rgba(253,245,230,0.28)', fontSize: '0.82rem' }}>
            {t.location}
          </p>
        </div>
      </footer>
    </>
  )
}

const footerHeadSt = {
  fontSize: '0.75rem', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.1em',
  color: 'rgba(253,245,230,0.5)',
  marginBottom: '0.8rem',
  fontFamily: 'var(--font-body)',
}

const footerLinkSt = {
  display: 'flex', alignItems: 'center', gap: '0.5rem',
  color: 'rgba(253,245,230,0.72)',
  textDecoration: 'none',
  fontSize: '0.9rem',
  transition: 'color 0.2s',
}
