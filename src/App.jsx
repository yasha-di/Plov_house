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
function DriftingPattern({ reverse = false, duration = 40, scale = 1, blur = 4, opacity = 0.12 }) {
  const prefersReduced = useReducedMotion()
  return (
    <div style={{ position: 'absolute', inset: '-6%', overflow: 'hidden', transform: `scale(${scale})` }}>
      <motion.div
        style={{
          position: 'absolute',
          top: -TILE_H, bottom: -TILE_H, left: -TILE_W, right: -TILE_W,
          backgroundImage: `${IKAT_FEATHER}, ${IKAT_WARP}, ${IKAT_TILE}`,
          backgroundSize: `24px 24px, 6px 6px, ${TILE_W}px ${TILE_H}px`,
          filter: `blur(${blur}px) saturate(1.25)`,
          opacity,
          willChange: 'transform, filter',
        }}
        animate={prefersReduced ? {} : {
          x: reverse ? [-TILE_W, 0] : [0, -TILE_W],
          filter: [
            `blur(${blur}px) saturate(1.25) hue-rotate(0deg)`,
            `blur(${blur}px) saturate(1.35) hue-rotate(180deg)`,
            `blur(${blur}px) saturate(1.25) hue-rotate(360deg)`,
          ],
        }}
        transition={{
          x:      { duration, repeat: Infinity, ease: 'linear' },
          filter: { duration: 52, repeat: Infinity, ease: 'linear' },
        }}
      />
    </div>
  )
}

// Twinkling night sky over Samarkand — tiny "data points" of the future.
// Generated once at module load so the layout is stable across re-renders.
const STARS = Array.from({ length: 44 }, (_, i) => ({
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
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {STARS.map((s) => (
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

function IkatBackground() {
  const prefersReduced = useReducedMotion()
  const coarse = useCoarsePointer()
  const glowRef = useRef(null)

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

  // Torch — sharper, brighter fabric revealed under pointer OR finger.
  // Coordinates are written straight to the masked wrapper (which sits at
  // inset:0, so clientX/clientY map 1:1) — no offset, no lag.
  useEffect(() => {
    if (prefersReduced) return
    const setXY = (x, y) => {
      const el = glowRef.current
      if (!el) return
      el.style.setProperty('--mx', `${x}px`)
      el.style.setProperty('--my', `${y}px`)
    }
    const onMove = (e) => setXY(e.clientX, e.clientY)
    // touchmove keeps firing during scroll, so the torch follows the finger
    const onTouch = (e) => {
      const t = e.touches[0]
      if (t) setXY(t.clientX, t.clientY)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('touchmove', onTouch)
    }
  }, [prefersReduced])

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

      {/* Two fabric layers drifting in opposite directions = woven depth.
          On phones the gyroscope adds a silk-sway as the device tilts. */}
      <motion.div style={{ position: 'absolute', inset: 0, y: prefersReduced ? 0 : yShift, x: prefersReduced ? 0 : xShift }}>
        <motion.div style={{ position: 'absolute', inset: 0, x: coarse ? tiltX : 0, y: coarse ? tiltY : 0 }}>
          <DriftingPattern duration={46} blur={3} opacity={0.12} scale={1} />
          <DriftingPattern duration={64} blur={1.2} opacity={0.11} scale={1.45} reverse />
        </motion.div>
      </motion.div>

      {/* Sharp vivid fabric under the cursor only.
          The MASK lives on this stationary wrapper (inset 0 = viewport coords),
          while the fabric drifts inside it — torch stays glued to the cursor. */}
      {!prefersReduced && (
        <div
          ref={glowRef}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            WebkitMaskImage:
              'radial-gradient(circle 250px at var(--mx, -500px) var(--my, -500px), #000 0%, rgba(0,0,0,0.4) 45%, transparent 72%)',
            maskImage:
              'radial-gradient(circle 250px at var(--mx, -500px) var(--my, -500px), #000 0%, rgba(0,0,0,0.4) 45%, transparent 72%)',
          }}
        >
          <motion.div
            style={{
              position: 'absolute',
              top: -TILE_H, bottom: -TILE_H, left: -TILE_W, right: -TILE_W,
              backgroundImage: `${IKAT_FEATHER}, ${IKAT_WARP}, ${IKAT_TILE}`,
              backgroundSize: `24px 24px, 6px 6px, ${TILE_W}px ${TILE_H}px`,
              filter: 'saturate(1.6)',
              opacity: 0.55,
              willChange: 'transform, filter',
            }}
            animate={{
              x: [0, -TILE_W],
              filter: [
                'saturate(1.6) hue-rotate(0deg)',
                'saturate(1.6) hue-rotate(360deg)',
              ],
            }}
            transition={{
              x:      { duration: 46, repeat: Infinity, ease: 'linear' },
              filter: { duration: 52, repeat: Infinity, ease: 'linear' },
            }}
          />
        </div>
      )}

      {/* Holographic scanlines + travelling scan sweep — the "future" layer */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(180,240,255,0.022) 0px, rgba(180,240,255,0.022) 1px, transparent 1px, transparent 3px)',
        }}
      />
      {!prefersReduced && (
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

// A bright light-segment racing along an SVG path — the futuristic "energy"
// tracing the ancient architecture. pathLength={1} normalises every path, so
// dasharray fractions work regardless of real path length.
function TracePath({ d, stroke, width = 2, seg = 0.14, duration = 4, delay = 0, reverse = false }) {
  const prefersReduced = useReducedMotion()
  if (prefersReduced) {
    return <path d={d} stroke={stroke} strokeWidth={width} opacity={0.18} fill="none" />
  }
  return (
    <motion.path
      d={d}
      pathLength={1}
      stroke={stroke}
      strokeWidth={width}
      fill="none"
      strokeLinecap="round"
      strokeDasharray={`${seg} ${1 - seg}`}
      style={{ filter: `drop-shadow(0 0 5px ${stroke})` }}
      initial={{ strokeDashoffset: 0 }}
      animate={{ strokeDashoffset: reverse ? 1 : -1 }}
      transition={{ duration, delay, repeat: Infinity, ease: 'linear' }}
    />
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

      {/* Near silhouette — iwan portal, minarets, ribbed dome, neon edges */}
      <motion.svg
        viewBox="0 0 1600 380"
        preserveAspectRatio="xMidYMax slice"
        style={{
          position: 'absolute', bottom: -10, left: 0,
          width: '100%', height: '100%',
          filter: 'drop-shadow(0 -2px 16px rgba(34,211,238,0.16))',
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

        {/* ── Racing light ornaments — Registan girih patterns drawn in neon ── */}
        <g fill="none" strokeLinecap="round">
          {/* portal frame loop */}
          <TracePath d="M320 120 H640 V340 H320 Z" stroke="#22D3EE" width={2.4} seg={0.16} duration={5} />
          {/* pointed arch sweep */}
          <TracePath d="M400 340 V232 Q400 166 480 148 Q560 166 560 232 V340" stroke="#F59E0B" width={2.2} seg={0.2} duration={3.6} delay={0.6} />
          {/* diamond girih lattice on the left portal face */}
          <TracePath d="M330 160 L390 220 L330 280 L390 340" stroke="#DB2777" width={1.8} seg={0.22} duration={3.2} />
          <TracePath d="M390 160 L330 220 L390 280 L330 340" stroke="#8B5CF6" width={1.8} seg={0.22} duration={3.2} reverse />
          {/* diamond girih lattice on the right portal face */}
          <TracePath d="M570 160 L630 220 L570 280 L630 340" stroke="#8B5CF6" width={1.8} seg={0.22} duration={3.2} delay={0.8} />
          <TracePath d="M630 160 L570 220 L630 280 L570 340" stroke="#DB2777" width={1.8} seg={0.22} duration={3.2} delay={0.8} reverse />
          {/* eight-point star over the arch (two counter-rotating squares) */}
          <TracePath d="M471 119 H489 V137 H471 Z" stroke="#FACC15" width={1.5} seg={0.3} duration={2.6} />
          <TracePath d="M480 115 L493 128 L480 141 L467 128 Z" stroke="#22D3EE" width={1.5} seg={0.3} duration={2.6} reverse />
          {/* dome ribs light up one after another */}
          <TracePath d="M850 108 Q800 180 790 250" stroke="#10B981" width={1.8} seg={0.3} duration={2.8} />
          <TracePath d="M850 108 Q850 180 850 250" stroke="#FACC15" width={1.8} seg={0.3} duration={2.8} delay={0.5} />
          <TracePath d="M850 108 Q900 180 910 250" stroke="#10B981" width={1.8} seg={0.3} duration={2.8} delay={1} />
          {/* dome drum ring */}
          <TracePath d="M760 250 H940" stroke="#F59E0B" width={1.6} seg={0.35} duration={2.2} delay={1.4} />
          {/* light climbing the minarets */}
          <TracePath d="M150 340 L158 100" stroke="#22D3EE" width={2} seg={0.3} duration={3.4} reverse />
          <TracePath d="M1418 340 L1410 120" stroke="#22D3EE" width={2} seg={0.3} duration={3.4} delay={1.7} reverse />
          {/* bazaar domes glow in sequence */}
          <TracePath d="M1040 290 Q1040 260 1072 250 Q1104 260 1104 290" stroke="#FACC15" width={1.6} seg={0.4} duration={2.4} />
          <TracePath d="M1124 290 Q1124 260 1156 250 Q1188 260 1188 290" stroke="#DB2777" width={1.6} seg={0.4} duration={2.4} delay={0.5} />
          <TracePath d="M1208 290 Q1208 260 1240 250 Q1272 260 1272 290" stroke="#22D3EE" width={1.6} seg={0.4} duration={2.4} delay={1} />
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
//  DATA
// ═══════════════════════════════════════════════════════════════════════════

const PLOV_TYPES = [
  {
    id: 'festive',
    name: 'Праздничный',
    desc: 'Бараньи рёбра на медленном огне, целые головки чеснока, айва и сухофрукты. Каждая порция — торжество вкуса, которое готовят к свадьбам и особым событиям.',
    accent: '#991B1B',
    accentLight: '#F87171',
    tag: 'Для торжества',
    weight: '5 кг / казан',
  },
  {
    id: 'tashkent',
    name: 'Ташкентский',
    desc: 'Классика столицы: жёлтая морковь, хлопковое масло, рис дев-зира. Насыщенный зирвак томится три часа — результат говорит сам за себя.',
    accent: '#C46B39',
    accentLight: '#F0A968',
    tag: 'Классика',
    weight: '3 кг / казан',
  },
  {
    id: 'chaikhansky',
    name: 'Чайханский',
    desc: 'Приготовлен мастером у чайханы в большом казане. Лёгкий аромат зиры, изюм кишмиш и нут делают вкус по-настоящему незабываемым.',
    accent: '#B8860B',
    accentLight: '#F5C84B',
    tag: 'Уличный',
    weight: '4 кг / казан',
  },
  {
    id: 'shavlya',
    name: 'Шавля',
    desc: 'Домашний брат плова — больше овощей, сочный томатный соус, нежный рис. Согревает изнутри, как мамина кухня в зимний день.',
    accent: '#6B3A2A',
    accentLight: '#D69A6E',
    tag: 'Домашний',
    weight: '3 кг / казан',
  },
]

const STEPS = [
  {
    num: '01',
    title: 'Выберите плов',
    desc: 'Праздничный, ташкентский или чайханский — каждый вид готовится по своему рецепту и характеру.',
    Icon: () => (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Оставьте заявку',
    desc: 'Укажите имя, телефон и удобное время. Перезвоним в течение 5 минут для подтверждения заказа.',
    Icon: () => (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.07 9.8 19.79 19.79 0 0 1 .01 1.18 2 2 0 0 1 2 0h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L6.09 7.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Получите доставку',
    desc: 'Горячий казанный плов приедет к вам в течение 60 минут. Доставляем в пределах всего Ташкента.',
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
]

const ERAS = [
  {
    num: '01',
    year: 'IX век',
    title: 'Рождение рецепта',
    text: 'Великий врач Авиценна описывает плов как средство, возвращающее силы телу и ясность уму. Семь компонентов — семь начал жизни: лук, морковь, мясо, жир, соль, вода и рис.',
    accent: '#F59E0B',
  },
  {
    num: '02',
    year: 'XIV век',
    title: 'Шёлковый путь',
    text: 'Караваны разносят аромат зирвака от Самарканда до Бухары. На каждой стоянке плов готовят по-своему — так рождаются десятки региональных школ, дошедших до наших дней.',
    accent: '#E11D48',
  },
  {
    num: '03',
    year: 'XX век',
    title: 'Эпоха чайханы',
    text: 'Ошпазы готовят в казанах на сотни гостей. Утренний плов становится ритуалом: его подают на рассвете, и опоздавшим достаются только истории о том, каким он был.',
    accent: '#10B981',
  },
  {
    num: '04',
    year: '2077',
    title: 'Плов будущего',
    text: 'Рецепт не меняется тысячу лет — меняется только скорость доставки. Казан, огонь и руки мастера остаются. Всё остальное мы берём на себя: 60 минут — и история у вас на столе.',
    accent: '#22D3EE',
  },
]

const STATS = [
  { to: 11,   suffix: ' веков', label: 'живой традиции' },
  { to: 60,   suffix: ' мин',   label: 'до вашей двери' },
  { to: 4,    suffix: ' вида',  label: 'плова в меню' },
  { to: 1500, suffix: '+',      label: 'довольных гостей' },
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
const PARTICLE_COUNT = 34

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
  if (prefersReduced) return null

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
      {PARTICLES.map((p) => (
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

function KazanIcon() {
  const prefersReduced = useReducedMotion()
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
          animate={prefersReduced ? {} : { opacity: [0.35, 1, 0.35] }}
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
          animate={prefersReduced ? {} : { x: [0, -56] }}
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

function PlovCard({ plov, index, onOrder }) {
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
        background: 'var(--panel-soft)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
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
          {plov.tag}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', fontWeight: 500 }}>
          {plov.weight}
        </span>
      </div>

      <h3 style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '1.32rem', fontWeight: 700,
        color: 'var(--text)',
        marginBottom: '0.55rem',
      }}>
        {plov.name}
      </h3>

      <p style={{
        fontSize: '0.91rem', lineHeight: 1.68,
        color: 'var(--text-soft)', flexGrow: 1,
        marginBottom: '1.25rem',
      }}>
        {plov.desc}
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
        Заказать этот
      </button>
    </motion.article>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  JOURNEY — vertical scroll drives a horizontal ride through the centuries
// ═══════════════════════════════════════════════════════════════════════════

function EraPanel({ era, fullWidth = true }) {
  return (
    <div
      style={{
        width: fullWidth ? '100vw' : '100%',
        flexShrink: 0,
        minHeight: fullWidth ? '100svh' : 'auto',
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
        fontSize: 'clamp(6rem, 22vw, 18rem)',
        color: 'transparent',
        WebkitTextStroke: `1px ${era.accent}26`,
        userSelect: 'none',
        pointerEvents: 'none',
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
      }}>
        {era.year}
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
        background: 'rgba(16,10,32,0.5)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
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
          {era.year}
        </p>

        <h3 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'clamp(1.6rem, 4vw, 2.3rem)',
          fontWeight: 700, color: 'var(--cream)',
          marginBottom: '0.9rem', lineHeight: 1.2,
        }}>
          {era.title}
        </h3>

        <p style={{
          fontSize: '0.96rem', lineHeight: 1.75,
          color: 'var(--text-soft)',
        }}>
          {era.text}
        </p>
      </div>
    </div>
  )
}

function JourneySection() {
  const prefersReduced = useReducedMotion()
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const x = useTransform(scrollYProgress, [0, 1], ['0vw', `-${(ERAS.length - 1) * 100}vw`])

  // Reduced motion: plain vertical stack, no scroll hijack.
  if (prefersReduced) {
    return (
      <section id="journey" style={{ position: 'relative', zIndex: 'var(--z-content)' }}>
        <div style={{ padding: 'clamp(3rem, 8vw, 5rem) 0 0' }}>
          <SectionTitle sub="Один рецепт — двенадцать столетий пути">Сквозь века</SectionTitle>
        </div>
        {ERAS.map((era) => <EraPanel key={era.num} era={era} fullWidth={false} />)}
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
        display: 'flex',
        flexDirection: 'column',
      }}>
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
            Сквозь века
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)' }}>
            Один рецепт — двенадцать столетий пути
          </p>
        </div>

        {/* The horizontal track itself */}
        <motion.div style={{
          x,
          display: 'flex',
          width: `${ERAS.length * 100}vw`,
          flexGrow: 1,
          willChange: 'transform',
        }}>
          {ERAS.map((era) => <EraPanel key={era.num} era={era} />)}
        </motion.div>

        {/* Progress thread at the bottom — fills as you travel */}
        <div style={{
          position: 'absolute', bottom: 'clamp(1.2rem, 4vh, 2.4rem)', left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(60vw, 320px)',
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
                {era.year}
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

function Counter({ to, duration = 1.5 }) {
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

  return <span ref={ref}>{val.toLocaleString('ru-RU')}</span>
}

function StatsStrip() {
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
        background: 'linear-gradient(180deg, rgba(20,12,40,0.45) 0%, rgba(14,9,30,0.6) 100%)',
        borderTop: '1px solid rgba(34,211,238,0.12)',
        borderBottom: '1px solid rgba(34,211,238,0.12)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
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
            key={s.label}
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
              <Counter to={s.to} />{s.suffix}
            </div>
            <p style={{
              marginTop: 6,
              fontSize: '0.85rem',
              color: 'var(--text-soft)',
              letterSpacing: '0.02em',
            }}>
              {s.label}
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

function OrderModal({ isOpen, onClose, defaultPlov }) {
  const [form, setForm] = useState({ name: '', phone: '', plov: defaultPlov || '' })
  const [submitted, setSubmitted] = useState(false)
  const prefersReduced = useReducedMotion()
  const firstInputRef = useRef(null)

  // Pick up the pre-selected plov each time the modal opens — the sanctioned
  // "adjust state during render" pattern (no effect, no extra paint).
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen)
    if (isOpen && defaultPlov) setForm(f => ({ ...f, plov: defaultPlov }))
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

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
    setTimeout(() => {
      onClose()
      setSubmitted(false)
      setForm({ name: '', phone: '', plov: '' })
    }, 2200)
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
              aria-label="Закрыть форму"
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
              Заказать плов
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#8B6F56', marginBottom: '1.6rem' }}>
              Заполните форму — перезвоним в течение 5 минут
            </p>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ textAlign: 'center', padding: '2rem 0' }}
              >
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #C46B39, #991B1B)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
                    stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p style={{ fontFamily: 'var(--font-heading)', fontSize: '1.3rem', color: 'var(--brown-dark)', marginBottom: '0.4rem' }}>
                  Заявка принята!
                </p>
                <p style={{ fontSize: '0.9rem', color: '#8B6F56' }}>
                  Скоро свяжемся с вами
                </p>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <div>
                  <label htmlFor="order-name" style={labelSt}>Ваше имя</label>
                  <input
                    id="order-name" ref={firstInputRef}
                    type="text" required
                    placeholder="Алишер Навоий"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="plov-input"
                    style={inputSt}
                  />
                </div>
                <div>
                  <label htmlFor="order-phone" style={labelSt}>Телефон</label>
                  <input
                    id="order-phone"
                    type="tel" required
                    placeholder="+998 90 123 45 67"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="plov-input"
                    style={inputSt}
                  />
                </div>
                <div>
                  <label htmlFor="order-plov" style={labelSt}>Вид плова</label>
                  <div style={{ position: 'relative' }}>
                    <select
                      id="order-plov" required
                      value={form.plov}
                      onChange={e => setForm(f => ({ ...f, plov: e.target.value }))}
                      className="plov-input"
                      style={{ ...inputSt, cursor: 'pointer', appearance: 'none', paddingRight: '2.5rem' }}
                    >
                      <option value="">Выберите вид...</option>
                      {PLOV_TYPES.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                      stroke="var(--brown-mid)" strokeWidth="2"
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>
                <button type="submit" className="cta-btn"
                  style={{
                    padding: '0.88rem 1.5rem',
                    borderRadius: 12,
                    border: 'none',
                    background: 'linear-gradient(135deg, #C46B39 0%, #991B1B 100%)',
                    color: 'var(--cream)',
                    fontSize: '1rem', fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: '0.03em',
                    marginTop: '0.3rem',
                    transition: 'opacity 0.2s, box-shadow 0.25s',
                  }}>
                  Отправить заявку
                </button>
              </form>
            )}
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

function HeroSection({ onOrder }) {
  const prefersReduced = useReducedMotion()
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  const contentScale = useTransform(scrollYProgress, [0, 1], [1, 0.9])
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -80])

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

      {/* Floating holographic bodom tiles */}
      <HoloTile style={{ left: '7%',  top: '16%' }} size={44} color="#22D3EE" inner="#F59E0B" duration={6}   />
      <HoloTile style={{ right: '9%', top: '22%' }} size={34} color="#E11D48" inner="#FACC15" duration={7.2} delay={1.1} />
      <HoloTile style={{ left: '13%', bottom: '18%' }} size={30} color="#8B5CF6" inner="#22D3EE" duration={5.4} delay={0.6} />
      <HoloTile style={{ right: '14%', bottom: '24%' }} size={48} color="#F59E0B" inner="#E11D48" duration={8}   delay={1.8} />

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
          <NeonArch />
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: prefersReduced ? 0 : 0.9, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ position: 'relative', top: 24 }}
          >
            <KazanIcon />
          </motion.div>
          <HeroSteam />
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
          Из глубины веков — к вашему столу
        </motion.p>

        <motion.h1
          aria-label="ПЛОВ"
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
          {'ПЛОВ'.split('').map((ch, i) => (
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
          Казанный, с дымком — рецепт IX века, доставка из будущего
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: prefersReduced ? 0 : 0.5, delay: 0.85 }}
          style={{ position: 'relative', display: 'inline-block' }}
        >
          {!prefersReduced && (
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
            Заказать плов
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
        <span>Листать вниз</span>
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
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════

export default function App() {
  const [modalOpen, setModalOpen]   = useState(false)
  const [defaultPlov, setDefaultPlov] = useState('')
  const prefersReduced = useReducedMotion()

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
      <IkatBackground />
      <Skyline />
      <RiceRain />
      <ScrollProgress />
      <EdgeGlow />
      <TapRipples />
      <OrderModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultPlov={defaultPlov}
      />

      <HeroSection onOrder={openOrder} />

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
        <SectionTitle sub="Каждый рецепт хранит вековые секреты узбекской кухни">
          Виды плова
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
            <PlovCard key={plov.id} plov={plov} index={i} onOrder={openOrder} />
          ))}
        </div>
      </section>

      <IkatDivider />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━ JOURNEY THROUGH THE CENTURIES ━━ */}
      <JourneySection />

      <StatsStrip />

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
        <SectionTitle sub="Три простых шага до горячего плова">
          Как заказать
        </SectionTitle>

        <div ref={stepsRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
            gap: '1.8rem',
            maxWidth: 920, margin: '0 auto',
          }}
        >
          {STEPS.map((step, i) => (
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
                Шаг {step.num}
              </div>

              <h3 style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.18rem', fontWeight: 600,
                color: 'var(--cream)',
                marginBottom: '0.65rem',
              }}>
                {step.title}
              </h3>

              <p style={{
                fontSize: '0.9rem', color: 'rgba(253,245,230,0.68)',
                lineHeight: 1.65,
              }}>
                {step.desc}
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
            Заказать сейчас
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
              «Плов — это не просто еда.<br />
              Это ритуал, собирающий людей вместе»
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
              Узбекский плов известен с IX века. Великий врач Авиценна упоминал его
              как «пищу, укрепляющую тело и дух». Традиционно плов готовят мужчины
              в большом чугунном казане на открытом огне — для свадеб, праздников
              и просто ради встречи с близкими. Мы сохранили эту традицию,
              чтобы доставить её прямо к вашему столу.
            </p>
          </motion.div>
        </div>
      </section>

      <IkatDivider />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ FOOTER ━━ */}
      <footer
        id="contacts"
        style={{
          background: 'rgba(8,6,18,0.78)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
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
              Плов Хаус
            </h2>
            <p style={{ color: 'rgba(253,245,230,0.55)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Настоящий узбекский плов<br />с доставкой по Ташкенту
            </p>
          </div>

          <div>
            <h3 style={footerHeadSt}>Контакты</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <a href="tel:+998901234567" style={footerLinkSt}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0 }}>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.07 9.8 19.79 19.79 0 0 1 .01 1.18 2 2 0 0 1 2 0h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L6.09 7.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                +998 90 123-45-67
              </a>
              <a href="mailto:plov@house.uz" style={footerLinkSt}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0 }}>
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                plov@house.uz
              </a>
            </div>
          </div>

          <div>
            <h3 style={footerHeadSt}>Доставка</h3>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {['Весь Ташкент', 'В течение 60 минут', 'Ежедневно 10:00–22:00'].map(text => (
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
            <h3 style={footerHeadSt}>Заказать</h3>
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
              Оформить заказ
            </button>
            <p style={{ fontSize: '0.8rem', color: 'rgba(253,245,230,0.38)' }}>
              Минимальный заказ 3 кг
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
            © 2026 Плов Хаус. Все права защищены.
          </p>
          <p style={{ color: 'rgba(253,245,230,0.28)', fontSize: '0.82rem' }}>
            Ташкент, Узбекистан · IX век — 2077
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
