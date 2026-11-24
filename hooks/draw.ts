// CPixelCrew: every SVG the agents panel and the bar show. Pure: state, time and
// settings arrive as parameters, and each function returns one whole document.

import type { AgentRun, Flow, LogEntry, MainRun, Rates, Retired, Settings, ThemeName, Usage } from '../types'
import {
  DEFAULT_SETTINGS,
  FLOW_ACCENT,
  FLOW_DONE,
  KINDS,
  MAIN_LOOK,
  MODEL_FAMILIES,
  PALETTES,
  agentColor,
  agentKind,
  agentLabel,
  cardGroups,
  clip,
  contextGauge,
  costOf,
  ctxOf,
  elapsed,
  familyOf,
  fitText,
  flowLabel,
  fmtClock,
  fmtSpan,
  fmtTime,
  fmtTokens,
  limitGauges,
  mainWorkedMs,
  modelLabel,
  modelName,
  money,
  noise,
  paletteOf,
  pillColor,
  plannedModel,
  printable,
  progressOf,
  tabularWidth,
  taskColor,
  taskKind,
  taskState,
  textWidth,
  usageLeftGauge,
  usageSplit,
  workColor,
  wrapText,
  xml,
} from './model'
import type { Gauge, ModelFamily, Palette, PillKind, Planned, TaskState, Totals, UsageSplit } from './model'
import { SPRITE_H, SPRITE_W, sprite, spriteCss } from './sprites'
import type { Pose } from './sprites'

export type { PillKind } from './model'

export type Drawing = { source: string; width: number; height: number; alt: string }
/**
 * `enterAgeMs`: how long ago this drawing's entrance began; none is drawn once it is over.
 * `clock`: the time the drawing is made at. Only a drawing that changes every tick anyway
 * (a working or waiting row, the main row while anything works) sets its loops by it (see
 * `loopAnchors`); a still one ignores it, so it stays the same from one tick to the next.
 */
export type Ctx = { W: number; now: number; settings: Settings; rates: Rates; tzOffsetMin?: number; enterAgeMs?: number; clock?: number }
/** One second of the bar's fill moving on: from `start` to `target` (parts of the whole), `delayMs` into that second. */
export type Creep = { start: number; target: number; delayMs: number }

export const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
export const BAR_H = 24
/** The classic tones; status marks keep them whatever the palette. */
export const TONES = { calm: PALETTES.classic.calm, warn: PALETTES.classic.warn, alert: PALETTES.classic.alert } as const

// ---------------------------------------------------------------------------
// Shared primitives: palette, numbers, text, gauges and marks.

// One set of ink classes for every panel drawing; dark mode swaps them.
const PANE_RULES = `
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#85857f}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.ic{stroke:#6b6b68}.icf{fill:#6b6b68}.ica{fill:#1f1f1f;fill-opacity:.09}.rt{fill:#4a4a46}.hk{fill:#a3a39e}.chip{fill:#A9472A}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#8f8f8a}.k{fill:#2c2c2b}.ln{stroke:#333331}.ic{stroke:#a8a8a4}.icf{fill:#a8a8a4}.ica{fill:#ffffff;fill-opacity:.14}.rt{fill:#d6d6d2}.hk{fill:#8d8d88}.chip{fill:#F0A68C}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
`

// Entrances: rows fade in with a 6px rise (the bar's expanded rows drop in instead);
// arcs sweep and bars grow. `both` holds the first frame through a negative delay, so a
// drawing redrawn mid-entrance carries on from where the motion is instead of restarting.
const ENTER_RULES = `
.pc-in{animation:pc-in .35s ease-out both}@keyframes pc-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pc-drop{animation:pc-drop .35s ease-out both}@keyframes pc-drop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.pc-sweep{animation:pc-sweep .6s ease-out both}@keyframes pc-sweep{from{stroke-dashoffset:var(--pc-d)}to{stroke-dashoffset:0}}
.pc-grow{transform-origin:left;transform-box:fill-box;animation:pc-grow .6s ease-out both}@keyframes pc-grow{from{transform:scaleX(0)}to{transform:none}}
@media (prefers-reduced-motion: reduce){.pc-in,.pc-drop,.pc-sweep,.pc-grow{animation:none}}
`

/** How long each entrance lasts: rows 350ms, sweeps and grows 600ms. */
export const ENTER_MS = { in: 350, drop: 350, sweep: 600, grow: 600 } as const
export type EntranceKind = keyof typeof ENTER_MS
export type Entrance = { className: string; style: string }

const MAX_H = 4096

// State is stored and may be junk: a coordinate or figure is a finite number or the fallback.
const fin = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, fin(v, lo)))
// Two decimals keep the markup short and never print an exponent.
const r = (v: number): number => Math.round(fin(v) * 100) / 100
const widthOf = (W: unknown): number => Math.round(clamp(fin(W, 320), 40, 4096))
const pct = (v: number): string => `${Math.round(clamp(v, 0, 100))}%`
const str = (v: unknown): string => (typeof v === 'string' ? printable(v) : '')
// Alt text is one line, long enough to say what the drawing shows.
const oneLine = (s: string): string => clip(printable(s), 300) || 'CPixelCrew'
// Mascot size in the panel, as a factor.
const iconK = (s: Settings | undefined): number => clamp(fin(s?.iconSize, 100), 50, 250) / 100

/**
 * The class and inline style for one entrance of `kind`. Nothing when animations are
 * off, when no entrance is under way, or once it is older than its duration; otherwise
 * the class with `animation-delay:-<age>ms`, so a redraw continues the same motion.
 */
export function entrance(kind: EntranceKind, enterAgeMs: number | undefined, settings: Settings | undefined): Entrance {
  const D = Object.hasOwn(ENTER_MS, kind) ? ENTER_MS[kind] : 0
  if (settings?.animations === false || typeof enterAgeMs !== 'number' || !Number.isFinite(enterAgeMs) || enterAgeMs >= D) return { className: '', style: '' }
  return { className: `pc-${kind}`, style: `animation-delay:-${Math.max(0, Math.round(enterAgeMs))}ms` }
}

// Every entrance one drawing may use, worked out once.
type Kit = { any: boolean; root: string; grow: Entrance; sweep: Entrance }
const kitOf = (age: number | undefined, s: Settings | undefined, rootKind: EntranceKind = 'in'): Kit => {
  const root = entrance(rootKind, age, s)
  const grow = entrance('grow', age, s)
  const sweep = entrance('sweep', age, s)
  return { any: !!(root.className || grow.className), root: enterAttrs(root), grow, sweep }
}
const NO_KIT: Kit = { any: false, root: '', grow: { className: '', style: '' }, sweep: { className: '', style: '' } }
// ` class="… pc-grow" style="…animation-delay:-120ms"`, or the plain class alone.
const enterAttrs = (e: Entrance, cls = '', style = ''): string => {
  const classes = [cls, e.className].filter(Boolean).join(' ')
  const css = e.className ? `${style}${e.style}` : ''
  return `${classes ? ` class="${classes}"` : ''}${css ? ` style="${css}"` : ''}`
}

// Cuts to the width, or nothing when not even an ellipsis fits.
const fit = (s: string, size: number, maxW: number): string => {
  if (!s || maxW < size * 0.6) return ''
  const out = fitText(s, size, maxW)
  return out === '…' ? '' : out
}

type T = { cls?: string; fill?: string; size: number; weight?: number; anchor?: 'end' | 'middle'; num?: boolean; op?: number; ls?: number }

const attrs = (o: T): string =>
  `${o.cls ? ` class="${o.cls}"` : ''}${o.fill ? ` fill="${o.fill}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''} font-size="${o.size}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.num ? ' font-variant-numeric="tabular-nums"' : ''}${o.op !== undefined ? ` opacity="${o.op}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}`

const text = (x: number, y: number, s: string, o: T): string => (s ? `<text x="${r(x)}" y="${r(y)}"${attrs(o)}>${xml(s)}</text>` : '')

// A figure steps down a size before it is cut, since a cut number reads wrong.
const shrink = (s: string, sizes: number[], maxW: number): [string, number] => {
  const size = sizes.find(z => textWidth(s, z) <= maxW) ?? sizes[sizes.length - 1] ?? 11
  return [fit(s, size, maxW), size]
}

type Part = { s: string; cls?: string; fill?: string; weight?: number; size?: number }
type Run = { s: string; p: Part }

// Styled runs wrapped as one text: wrapText decides the lines, then each character
// is matched back to the run it came from so the styles survive the wrap.
const richWrap = (parts: Part[], size: number, maxW: number, maxLines: number): Run[][] => {
  const ps = parts.filter(p => p.s)
  const src: { ch: string; p: Part }[] = []
  for (const p of ps) for (const ch of p.s.replace(/\s+/g, ' ')) src.push({ ch, p })
  const lines = wrapText(src.map(x => x.ch).join(''), size, maxW, maxLines)
  let i = 0
  return lines.map(line => {
    // The space a line broke at is not drawn.
    while (i < src.length && src[i]?.ch === ' ' && !line.startsWith(' ')) i++
    let cur = src[Math.min(i, src.length - 1)]?.p ?? ps[0] ?? { s: '' }
    const runs: Run[] = []
    for (const ch of line) {
      // An ellipsis, or a space the cut line put between pieces, keeps the style before it.
      if (i < src.length && src[i]?.ch === ch) {
        cur = src[i]?.p ?? cur
        i++
      }
      const last = runs[runs.length - 1]
      if (last && last.p === cur) last.s += ch
      else runs.push({ s: ch, p: cur })
    }
    return runs
  })
}

const tspans = (runs: Run[]): string =>
  runs
    .map(({ s, p }) => `<tspan${p.cls ? ` class="${p.cls}"` : ''}${p.fill ? ` fill="${p.fill}"` : ''}${p.weight ? ` font-weight="${p.weight}"` : ''}${p.size ? ` font-size="${p.size}"` : ''}>${xml(s)}</tspan>`)
    .join('')

// ---------------------------------------------------------------------------
// Loops set by the clock. A redraw starts every CSS animation over, and the bar and the
// rows are redrawn every second while anything works. A drawing given the clock puts
// `--pc-t` (minus the time of day, in ms) on its root, and after its own rules sets each
// looping animation's delay to that plus the delay it had: a redraw picks the loop up
// where the clock says it is, as `entrance` does for the one-time motions.

const LOOP_DAY_MS = 86_400_000
const TIME = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/
const msOf = (t: string): number | undefined => {
  const m = TIME.exec(t.trim())
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : undefined
}
const anchorMemo = new Map<string, string>()

/**
 * The override rules for `css`'s looping animations: for each top-level rule that sets a
 * delay (an `infinite` shorthand, whose delay is its second time or none, or a bare
 * `animation-delay`), the same selector with `animation-delay:calc(var(--pc-t,0ms) ± d)`.
 * Coming after the rules they mirror, with the same selectors, they win exactly where
 * those did. One-time animations (`forwards`, entrances) and @-blocks are left alone.
 */
export function loopAnchors(css: string): string {
  const memo = anchorMemo.get(css)
  if (memo !== undefined) return memo
  const src = String(css).replace(/<\/?style>/g, '')
  const out: string[] = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1
      else if (src[j] === '}') depth -= 1
      j += 1
    }
    const head = src.slice(i, open).trim()
    const body = src.slice(open + 1, j - 1)
    i = j
    if (!head || head.startsWith('@')) continue
    let delay: number | undefined
    for (const decl of body.split(';')) {
      const at = decl.indexOf(':')
      if (at < 0) continue
      const prop = decl.slice(0, at).trim()
      const value = decl.slice(at + 1).trim()
      if (value.includes(',')) continue
      if (prop === 'animation') {
        const times = value.split(/\s+/).map(msOf).filter((t): t is number => t !== undefined)
        delay = /\binfinite\b/.test(value) && !/^none\b/.test(value) ? (times[1] ?? 0) : undefined
      } else if (prop === 'animation-delay') delay = msOf(value)
    }
    if (delay === undefined) continue
    const d = Math.round(delay)
    out.push(`${head}{animation-delay:calc(var(--pc-t,0ms) ${d < 0 ? '-' : '+'} ${Math.abs(d)}ms)}`)
  }
  const anchors = out.join('')
  if (anchorMemo.size > 64) anchorMemo.clear()
  anchorMemo.set(css, anchors)
  return anchors
}

type DocOpts = { theme?: ThemeName; rules?: string; kit?: Kit; clock?: number; hero?: boolean }

const doc = (W: number, H: number, body: string, alt: string, o: DocOpts = {}): Drawing => {
  const h = Math.round(clamp(H, 1, MAX_H))
  const kit = o.kit ?? NO_KIT
  const rules = (o.rules ?? PANE_RULES) + (o.hero ? HERO_RULES : '')
  const css = `<style>${rules}${kit.any ? ENTER_RULES : ''}</style>`
  const sprites = o.theme ? spriteCss(o.theme) : ''
  const loopT = Number.isFinite(o.clock) ? Math.round((((o.clock as number) % LOOP_DAY_MS) + LOOP_DAY_MS) % LOOP_DAY_MS) : undefined
  const anchors = loopT === undefined ? '' : loopAnchors(rules) + (o.theme ? loopAnchors(sprites) : '')
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${FONT}" xml:space="preserve" style="white-space:pre${loopT === undefined ? '' : `;--pc-t:-${loopT}ms`}">${css}${sprites}${anchors ? `<style>${anchors}</style>` : ''}${kit.root ? `<g${kit.root}>${body}</g>` : body}</svg>`,
    width: W,
    height: h,
    alt: oneLine(alt),
  }
}

const themeOf = (s: Settings | undefined): ThemeName => (s?.theme === 'cat' ? 'cat' : 'clawd')
// Pixel art off the pixel grid blurs: the mascot sits on whole pixels. Its scale stays as
// given (2.2 in a row, 4.8 for the main agent), a little soft at a fractional one.
// `role` is the costume's sprite key; `color` its accent, the agent's own colour.
const mascot = (theme: ThemeName, role: string, pose: Pose, x: number, y: number, scale: number, color?: string): string =>
  sprite({ theme, role, pose, x: Math.round(fin(x)), y: Math.round(fin(y)), scale: r(scale), ...(color ? { color } : {}) })

// The hero card: a see-through glass card with a one-pixel frame and notched corners, 34 x 32
// grid pixels, behind the mascot of each row of the panel. `hero-f` is the glass, `hero-r` the
// frame; two paths, so the see-through fill shows no seams. A drawing that holds one carries
// its two colour rules, and no other drawing does.
const HERO_GLASS = 'M2 1H32V2H33V30H32V31H2V30H1V2H2Z'
const HERO_FRAME = 'M1 0H33V1H34V31H33V32H1V31H0V1H1ZM2 1H32V2H33V30H32V31H2V30H1V2H2Z'
const HERO_RULES = `
.hero-f{fill:#1F1E1D;fill-opacity:.05}.hero-r{fill:#1F1E1D;fill-opacity:.3}
@media (prefers-color-scheme: dark){.hero-f{fill:#F4F1E8;fill-opacity:.3}.hero-r{fill:#F4F1E8;fill-opacity:.62}}`
// A card is drawn only when the setting says so; with no settings there is none.
const heroOn = (s: Settings | undefined): boolean => s?.heroCard === true
// The card at (x, y) and the mascot exactly 2k inside it, `k` already rounded so the mascot's
// pixels meet the frame's.
const heroed = (theme: ThemeName, role: string, pose: Pose, x: number, y: number, k: number, color?: string): string =>
  `<g class="hero" transform="translate(${r(x)},${r(y)}) scale(${k})"${pose === 'planned' ? ' opacity="0.45"' : ''}><path class="hero-f" d="${HERO_GLASS}"/><path class="hero-r" fill-rule="evenodd" d="${HERO_FRAME}"/></g>` +
  sprite({ theme, role, pose, x: fin(x) + 2 * k, y: fin(y) + 2 * k, scale: k, ...(color ? { color } : {}) })

// A row's mascot, with its card when the setting says so: its layout size and a function that
// draws it at (x, y). With a card the scale is rounded once and the card's size (the mascot's
// box and two pixels each side) and the mascot's offset in it all use that one value.
const heroSprite = (s: Settings | undefined, theme: ThemeName, k: number, role: string, pose: Pose, color?: string): { w: number; h: number; draw: (x: number, y: number) => string } => {
  if (!heroOn(s)) return { w: SPRITE_W * k, h: SPRITE_H * k, draw: (x, y) => mascot(theme, role, pose, x, y, k, color) }
  const kr = r(k)
  return { w: (SPRITE_W + 4) * kr, h: (SPRITE_H + 4) * kr, draw: (x, y) => heroed(theme, role, pose, x, y, kr, color) }
}

// The cat on its flying broom, for the bar's progress row. `ride` is joining the sprites'
// `Pose`; until it does, it is named here and `sprite()` draws an unknown pose as `done`.
const RIDE = 'ride' as Pose

/** The mascot's pose in the bar's progress row: the cat rides its broom while the plan runs and when it is done; the crab works, then is done; both rest otherwise. */
const progressPose = (theme: ThemeName, state: TaskState): Pose =>
  state === 'running' ? (theme === 'cat' ? RIDE : 'work') : state === 'done' ? (theme === 'cat' ? RIDE : 'done') : 'rest'

// The neutral track every meter sits on: translucent grey reads on light and dark alike.
const TRACK = '#808080'
const TRACK_OP = 0.25

// Ring gauge: a faint full track and the arc from 12 o'clock, clockwise. On entry the
// arc sweeps in from empty: its dash starts pushed back by its own length.
const ring = (cx: number, cy: number, d: number, sw: number, frac: number, color: string, sweep: Entrance, neutral = false): string => {
  const rad = (d - sw) / 2
  const c = 2 * Math.PI * rad
  const f = clamp(frac, 0, 1)
  const base = `cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="none" stroke-width="${sw}"`
  const len = r(f * c)
  // A zero-length dash with round caps would still paint a dot.
  const arc =
    f > 0
      ? `<circle ${base} stroke="${color}" stroke-linecap="round" stroke-dasharray="${len} ${r(c + 10)}" transform="rotate(-90 ${r(cx)} ${r(cy)})"${enterAttrs(sweep, '', `--pc-d:${r(len + 3)};`)}/>`
      : ''
  const track = neutral ? `<circle ${base} stroke="${TRACK}" stroke-opacity="${TRACK_OP}"/>` : `<circle ${base} stroke="${color}" stroke-opacity=".2"/>`
  return track + arc
}

// Bar gauge: a track and a fill from the left that grows in on entry. `fill` is a colour,
// or empty with `cls` naming a class that paints it. `soft`: the translucent grey track.
const bar = (x: number, y: number, w: number, h: number, frac: number, fill: string, grow: Entrance, o: { cls?: string; soft?: boolean } = {}): string => {
  const ww = Math.max(0, w)
  const fw = r(ww * clamp(frac, 0, 1))
  const track = o.soft
    ? `<rect x="${r(x)}" y="${r(y)}" width="${r(ww)}" height="${h}" rx="${h / 2}" fill="${TRACK}" fill-opacity="${TRACK_OP}"/>`
    : `<rect class="k" x="${r(x)}" y="${r(y)}" width="${r(ww)}" height="${h}" rx="${h / 2}"/>`
  // A sliver narrower than the bar is tall is drawn as wide as tall, so it keeps its round ends.
  const shown = fw > 0 ? Math.min(ww, Math.max(fw, h)) : 0
  return `${track}${shown > 0 ? `<rect${enterAttrs(grow, o.cls ?? '')}${o.cls ? '' : ` fill="${fill}"`} x="${r(x)}" y="${r(y)}" width="${r(shown)}" height="${h}" rx="${h / 2}"/>` : ''}`
}

// Session-band's hourglass, drawn in a `size` box at (x, y).
const hourglass = (x: number, y: number, size: number, color: string, cls = ''): string => {
  const k = size / 12
  const paint = cls ? ` class="${cls}"` : ` stroke="${color}"`
  return `<g transform="translate(${r(x - 6 * k)},${r(y - 6.5 * k)}) scale(${r(k)})" fill="none"${paint} stroke-width="${r(1.6 / k)}" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 .5h7M2.5 12.5h7M3.5 .5c0 3 5 3.5 5 6s-5 3-5 6M8.5 .5c0 3-5 3.5-5 6s5 3 5 6"/></g>`
}

// Row status at the right edge: pulsing dot, hourglass, check, cross, or a clock for planned.
const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${r(x)}" cy="${r(y)}" r="3.5" fill="${color}"/>`
  if (status === 'waiting') return hourglass(x, y, 11, TONES.warn)
  if (status === 'done') return `<path d="M${r(x - 5)} ${r(y)}l3.5 3.5 6.5-7" fill="none" stroke="${TONES.calm}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${r(x - 4)} ${r(y - 4)}l8 8M${r(x + 4)} ${r(y - 4)}l-8 8" stroke="${TONES.alert}" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${r(x)}" cy="${r(y)}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${r(x)} ${r(y - 2.5)}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const hairline = (W: number, y: number): string => `<line class="ln" x1="0" y1="${r(y)}" x2="${W}" y2="${r(y)}"/>`

// A colour handed in from outside goes into an attribute: only a hex colour is taken.
const colorOf = (c: unknown, d: string): string => (typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : d)

// ---------------------------------------------------------------------------
// savvy-progress's flow track, shared by the bar's progress row and the main row's task
// strip so the two always look alike: a dithered fill, sparse at the start and dense
// toward the head; a faint second layer for work handed out but not yet done; ticks on
// the part still to go; the pill riding the head; the dots twinkling in four groups.

const CELL = 3

// The track and its ticks, light and dark.
const TRACK_INK = `.ftk{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.ftk{fill:#2c2c2c}.tk{fill:#5a5a5a}}
`

// The dots twinkle in four out-of-phase groups with savvy-progress's durations; a finished
// bar settles to a slow glow. Only the dots carry `t0`-`t3`, and nothing else animates them;
// reduced motion stops it. It does not follow `settings.animations`, which is for entrances.
// A drawing made with the clock keeps the groups' phases across redraws (`loopAnchors`).
const twinkleRules = (finished: boolean): string => `
.t0,.t1,.t2,.t3{animation:tw ${finished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${finished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${finished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${finished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${finished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
`

/** The style rules a flow track needs: its inks, and the twinkle when it twinkles. */
const trackRules = (twinkle: boolean, finished: boolean): string => TRACK_INK + (twinkle ? twinkleRules(finished) : '')

// The fill's second of creep: the dots, drawn up to where the fill will be, grow from
// where it is (`--pc-s`, a part of their width) and the pill slides along (`--pc-x`).
// `forwards` holds the end until the next redraw starts the next second from there.
const CREEP_RULES = `
.pc-creep{transform-origin:left;transform-box:fill-box;animation:pc-creep 1000ms ease-out forwards}@keyframes pc-creep{from{transform:scaleX(var(--pc-s))}to{transform:none}}
.pc-creep-x{animation:pc-creep-x 1000ms ease-out forwards}@keyframes pc-creep-x{from{transform:translateX(var(--pc-x))}to{transform:none}}
@media (prefers-reduced-motion: reduce){.pc-creep,.pc-creep-x{animation:none}}
`

type TrackOpts = {
  /** Track size; the track is drawn at (0, 0), the caller places it. */
  w: number
  h: number
  /** Done, and done plus handed out, as parts of the whole. */
  ratio: number
  runningRatio: number
  /** Tasks in the plan: one tick between each, on the part still to go. */
  total: number
  color: string
  /** The dots carry the twinkle classes. */
  twinkle: boolean
  finished: boolean
  /** Makes the clip-path id unique within one document. */
  idKey: string
  /** The one-time entrance of the fill: on a wrapper round the dots, never on the dots. */
  grow?: Entrance
  /** The pill at the head, `size` its font size (11 in a 16px track): the first of `labels` that fits the track (the label, then the bare count), else nothing. */
  pill?: { labels: string[]; size: number }
  /** Where the fill was a moment ago (a part of the whole, at most `ratio`): the dots grow from there to `ratio` over one second, `delayMs` into it. Nested inside the entrance wrapper. */
  creep?: { from: number; delayMs: number }
}

// A flow label's pill texts: whole, then without its first word (`Tasks 3/6`, `3/6`).
const pillLabels = (label: string): string[] => [label, label.replace(/^\S+\s+/, '')]

/** One flow track: its markup, and the rules to put in the document's style block. */
const ditherTrack = (o: TrackOpts): { body: string; rules: string } => {
  const w = Math.max(0, Math.round(fin(o.w)))
  const h = Math.max(1, fin(o.h, 16))
  const ratio = clamp(o.ratio, 0, 1)
  const fillW = Math.round(w * ratio)
  const runW = Math.round(w * clamp(o.runningRatio, 0, 1))
  const total = Math.max(0, Math.round(fin(o.total)))
  const cls = (n: number): string => (o.twinkle ? ` class="t${Math.floor(n * 4)}"` : '')
  const dots: string[] = []
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(h / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let y = 0; y < rows; y++) {
      if (noise(c, y) < density) dots.push(`<rect${cls(noise(y, c))} x="${c * CELL + 1}" y="${y * CELL + 1}" width="2" height="2"/>`)
    }
  }
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let y = 0; y < rows; y++) {
      if (noise(c + 7, y + 3) < 0.2) faint.push(`<rect${cls(noise(y + 5, c))} x="${c * CELL + 1}" y="${y * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }
  const ticks: string[] = []
  for (let i = 1; i < Math.min(total, 200); i++) {
    const x = Math.round((w * i) / total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${r(h / 2 - 4)}" width="1.5" height="8" rx="0.75"/>`)
  }
  // Creeping: the dots up to `ratio` grow from `from`, and the pill slides from where it stood there.
  const from = o.creep ? clamp(fin(o.creep.from), 0, ratio) : ratio
  const isCreeping = !!o.creep && dots.length > 0 && ratio > 0 && from < ratio
  const delay = `animation-delay:-${Math.round(clamp(fin(o.creep?.delayMs), 0, 1000))}ms`
  let pill = ''
  if (o.pill) {
    const k = clamp(fin(o.pill.size, 11), 6, 16) / 11
    const pillOf = (s: string): number => Math.round((18 + s.length * 6.6) * k)
    const label = (Array.isArray(o.pill.labels) ? o.pill.labels : []).map(str).find(s => s && pillOf(s) <= w) ?? ''
    if (label) {
      const pillW = pillOf(label)
      const xAt = (fw: number): number => Math.max(0, Math.min(w - pillW, fw - pillW))
      const pillX = xAt(fillW)
      pill = `<rect x="${pillX}" width="${pillW}" height="${h}" rx="${h / 2}" fill="${o.color}"/>${text(pillX + pillW / 2, h / 2 + 4 * k, label, { fill: '#ffffff', size: r(11 * k), weight: 600, anchor: 'middle' })}`
      const dx = isCreeping ? xAt(Math.round(w * from)) - pillX : 0
      if (dx !== 0) pill = `<g class="pc-creep-x" style="--pc-x:${dx}px;${delay}">${pill}</g>`
    }
  }
  const fill = `<g fill="${o.color}">${dots.join('')}</g>`
  const id = `pc-${o.idKey}`
  const body = `<defs><clipPath id="${id}"><rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}"/></clipPath></defs>
<rect class="ftk" width="${w}" height="${h}" rx="${h / 2}"/>
<g clip-path="url(#${id})">
<g${enterAttrs(o.grow ?? { className: '', style: '' })}>${isCreeping ? `<g class="pc-creep" style="--pc-s:${Math.round((from / ratio) * 1000) / 1000};${delay}">${fill}</g>` : fill}${faint.length ? `
<g fill="${o.color}" opacity="0.45">${faint.join('')}</g>` : ''}</g>
<g class="tk">${ticks.join('')}</g>
</g>
${pill}`
  return { body, rules: trackRules(o.twinkle, o.finished) + (isCreeping ? CREEP_RULES : '') }
}

const hasContext = (u: Usage | undefined): boolean =>
  !!u && (Number.isFinite(u.contextPercent as number) || (Number.isFinite(u.contextTokens as number) && fin(u.contextWindow) > 0))
const ctxGauge = (u: Usage | undefined): Gauge | null => (u && hasContext(u) ? contextGauge(u) : null)
const isLimit = (g: Gauge): boolean => g.kind !== 'context'
// Limits read as what is left, context as what is used.
const gaugeFrac = (g: Gauge): number => (isLimit(g) ? g.left : g.used) / 100
const toneOf = (pal: Palette, tone: Gauge['tone']): string => (tone === 'alert' ? pal.alert : tone === 'warn' ? pal.warn : pal.calm)

// A gauge handed in may be junk: every figure finite, the tone one of three. Only a
// limit can be resetting; a resetting one has no reset time and is calm.
const gaugeSafe = (g: Gauge | null | undefined): Gauge => {
  const used = clamp(fin(g?.used), 0, 100)
  const kind = str(g?.kind) || 'context'
  const isResetting = g?.isResetting === true && kind !== 'context'
  const out: Gauge = {
    kind,
    label: str(g?.label) || (kind === 'context' ? 'Context' : kind),
    used,
    left: clamp(fin(g?.left, 100 - used), 0, 100),
    resetIn: !isResetting && Number.isFinite(g?.resetIn as number) ? (g?.resetIn as number) : null,
    tone: !isResetting && (g?.tone === 'alert' || g?.tone === 'warn') ? g.tone : 'calm',
  }
  return isResetting ? { ...out, isResetting } : out
}

/** What a limit reads while its window resets with no fresh figure yet. */
const RESETTING = 'resetting…'
// The neutral grey of a muted meter or figure.
const MUTED = '#9a9a96'

// Every limit the engine reports, as gauges; a window that reset within ten minutes is
// among them as resetting, an older one is left out.
const limitsOf = (usage: Usage | undefined, now: number): Gauge[] => (usage && typeof usage === 'object' ? limitGauges(usage, fin(now)) : [])

// Every cost drawn: the chosen currency only, `≈` when it is an estimate.
const cost = (usd: unknown, c: { settings?: Settings; rates?: Rates } | undefined, approx: boolean): string =>
  `${approx ? '≈' : ''}${money(fin(usd), c?.settings as Settings, c?.rates as Rates)}`

type Use = { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined
// Everything read counts as in: fresh input plus cache reads and writes.
const inOut = (u: Use): string => `in ${fmtTokens(fin(u?.input) + fin(u?.cacheRead) + fin(u?.cacheWrite))} · out ${fmtTokens(fin(u?.output))}`

/** The cache figures a row's log opens with, now its stats count the cache in `in`: `Cache read 240k · write 18k`; nothing with none. */
export function cacheLine(u: Use): string {
  const read = fin(u?.cacheRead)
  const write = fin(u?.cacheWrite)
  return read > 0 || write > 0 ? `Cache read ${fmtTokens(read)} · write ${fmtTokens(write)}` : ''
}

// Figures joined by ` · `, wrapped between figures, never inside one; a figure wider than
// a line is cut, and past `maxLines` the last line is cut.
const joinWrap = (items: string[], size: number, w: number, maxLines: number): string[] => {
  const lines: string[] = []
  let line = ''
  for (const raw of items.filter(Boolean)) {
    const item = textWidth(raw, size) <= w ? raw : fit(raw, size, w)
    if (!item) continue
    const next = line ? `${line} · ${item}` : item
    if (!line || textWidth(next, size) <= w) line = next
    else {
      lines.push(line)
      line = item
    }
  }
  if (line) lines.push(line)
  const cap = Math.max(1, maxLines)
  return lines.length <= cap ? lines : [...lines.slice(0, cap - 1), fit(lines.slice(cap - 1).join(' · '), size, w)]
}

// ---------------------------------------------------------------------------
// Row layout: blocks of lines stacked beside (or under) a mascot.

type Block = { h: number; draw: (x: number, y: number) => string }

const PAD = 10
// Narrower than this beside the mascot, the row stacks: text moves under the mascot.
const SIDE_MIN = 150
// Narrower than this, even the title moves under the mascot.
const BESIDE_MIN = 90

// Wrapped styled lines: `lh` apart, the first baseline `base` below the block's top.
const richBlock = (parts: Part[], size: number, lh: number, base: number, w: number, maxLines: number, o: Omit<T, 'size'> = {}): Block => {
  const lines = richWrap(parts, size, Math.max(1, w), maxLines)
  return {
    h: lines.length * lh,
    draw: (x, y) => lines.map((runs, i) => `<text x="${r(x)}" y="${r(y + base + i * lh)}"${attrs({ ...o, size })}>${tspans(runs)}</text>`).join(''),
  }
}

const lineBlock = (s: string, size: number, lh: number, base: number, w: number, maxLines: number, o: Omit<T, 'size'>): Block =>
  richBlock([{ s }], size, lh, base, w, maxLines, o)

const sumH = (bs: Block[]): number => bs.reduce((h, b) => h + b.h, 0)
const placeAll = (bs: Block[], x: number, y0: number): string => {
  let y = y0
  let out = ''
  for (const b of bs) {
    out += b.draw(x, y)
    y += b.h
  }
  return out
}

type Build = (topW: number, restW: number) => { top: Block[]; rest: Block[] }

// The mascot on the left and every block in the column beside it; when that column
// would be under SIDE_MIN, only `top` stays beside it and `rest` runs full width below;
// under BESIDE_MIN the mascot sits alone on top.
const rowLayout = (W: number, sw: number, sh: number, pad: number, build: Build, drawMascot: (x: number, y: number) => string): { body: string; H: number } => {
  const R = W - 2
  const x0 = Math.round(sw + 10)
  const col = R - x0
  if (col >= SIDE_MIN) {
    const { top, rest } = build(col, col)
    const all = [...top, ...rest]
    const H = Math.ceil(Math.max(pad * 2 + sumH(all), sh + 12))
    const y = Math.min((H - sh) / 2, pad + 2)
    return { body: drawMascot(0, Math.round(y)) + placeAll(all, x0, pad), H }
  }
  if (col >= BESIDE_MIN) {
    const { top, rest } = build(col, R)
    const topH = Math.ceil(Math.max(pad + sumH(top), 6 + sh) + 6)
    return { body: drawMascot(0, 6) + placeAll(top, x0, pad) + placeAll(rest, 0, topH), H: topH + sumH(rest) + pad }
  }
  const { top, rest } = build(R, R)
  const y = Math.ceil(6 + sh + 6)
  const all = [...top, ...rest]
  return { body: drawMascot(0, 6) + placeAll(all, 0, y), H: y + sumH(all) + pad }
}

// ---------------------------------------------------------------------------
// Panel: the title and the session card.

const TITLE_H = 28

const NO_TASK = 'No task yet'

// The plan's name above the session card, in its own case, on one fitted line; with no plan, a muted `No task yet`.
export function titleDrawing(c: Ctx, title: string): Drawing {
  const W = widthOf(c?.W)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const name = str(title)
  return doc(W, TITLE_H, text(0, 19, fit(name || NO_TASK, 14, W), { cls: name ? 't' : 'm', size: 14, weight: 600 }), name || NO_TASK, { kit })
}

// The session card: one card cut into strips that share a column grid (figures, gauges,
// the usage split), hairlines between its cells. Texts sit `CELL_IN` in from a cell's left.
const CELL_IN = 12
// Space above and below the card, inside its drawing.
const CARD_TOP = 4
const CARD_BOTTOM = 8
const FIGURES_H = 76
const GAUGE_ROW = 64
const RING_ROW = 92
const RING_CELL_D = 40
// A gauge cell is never narrower than this while four share a row; narrower, two do.
const GAUGE_MIN = 80
const STRIP_END = 12
const LEGEND_ROW = 20

const vline = (x: number, y1: number, y2: number): string => `<line class="ln" x1="${r(x)}" y1="${r(y1)}" x2="${r(x)}" y2="${r(y2)}"/>`
const hline = (x1: number, x2: number, y: number): string => (x2 > x1 ? `<line class="ln" x1="${r(x1)}" y1="${r(y)}" x2="${r(x2)}" y2="${r(y)}"/>` : '')

// The first form that fits `room` whole, else nothing.
const firstFit = (forms: readonly string[], size: number, room: number): string => forms.find(s => !!s && textWidth(s, size) <= room) ?? ''

const partsW = (parts: Part[], size: number): number => parts.reduce((w, p) => w + textWidth(p.s, size), 0)

// Styled runs as one text on one line, unwrapped: the caller has made sure they fit.
const rich = (x: number, y: number, parts: Part[], size: number, anchor?: 'end'): string => {
  const ps = parts.filter(p => p.s)
  return ps.length ? `<text x="${r(x)}" y="${r(y)}"${attrs({ size, anchor, num: true })}>${tspans(ps.map(p => ({ s: p.s, p })))}</text>` : ''
}

type Seg = { v: number; fill?: string; cls?: string }

// A bar cut into segments by value, 1px apart, from the left; the gaps go when they would
// take more than a quarter of the bar. Segments of no value are left out.
const stackBar = (x: number, y: number, w: number, h: number, segs: Seg[], rx: number, grow: Entrance): string => {
  const list = segs.filter(s => fin(s.v) > 0)
  const total = list.reduce((a, s) => a + s.v, 0)
  if (!list.length || !(total > 0) || !(w > 0)) return ''
  const gap = list.length > 1 && list.length - 1 <= w / 4 ? 1 : 0
  const room = w - gap * (list.length - 1)
  let cx = x
  const out = list
    .map(s => {
      const sw = (s.v / total) * room
      const piece =
        sw >= 0.25
          ? `<rect${s.cls ? ` class="${s.cls}"` : ` fill="${s.fill ?? MUTED}"`} x="${r(cx)}" y="${r(y)}" width="${r(sw)}" height="${h}" rx="${r(Math.min(rx, sw / 2))}"/>`
          : ''
      cx += sw + gap
      return piece
    })
    .join('')
  return `<g${enterAttrs(grow)}>${out}</g>`
}

/**
 * How `n` gauge cells share a strip `w` wide: up to four in a row while each is at least
 * GAUGE_MIN wide, else rows of two; the rows that follow keep the first row's grid.
 */
export function gaugeGrid(w: number, n: number): { cols: number; rows: number; cellW: number } {
  const count = Math.max(0, Math.round(fin(n)))
  const W = Math.max(0, fin(w))
  if (!count) return { cols: 0, rows: 0, cellW: 0 }
  const four = Math.min(4, count)
  const cols = W / four >= GAUGE_MIN ? four : Math.min(2, count)
  return { cols, rows: Math.ceil(count / cols), cellW: W / cols }
}

// A gauge's name in its cell, and its short name in the compact card.
const gaugeTitle = (g: Gauge): string => (g.kind === 'five_hour' ? '5-hour' : g.label)
// The cell's label, shortened (`Week · Fable` → `Wk · Fable`) before it is cut.
const gaugeLabel = (g: Gauge, room: number): string => {
  const t = gaugeTitle(g)
  return firstFit([t, t.replace(/^Week · /, 'Wk · ')], 11, room) || fit(t, 11, room)
}
const gaugeTiny = (g: Gauge): string =>
  g.kind === 'context' ? 'Ctx' : g.kind === 'five_hour' ? '5h' : g.kind === 'seven_day' ? 'Wk' : g.label.startsWith('Week · ') ? g.label.slice(7) : g.label
// A gauge's detail, then its shorter form: `resets in 3h 05m` → `3h 05m`, `517k / 1M` → `517k/1M`.
const detailForms = (d: string): string[] => (!d ? [] : d.startsWith('resets in ') ? [d, d.slice(10)] : [d, d.replace(/ \/ /g, '/')])
const gaugeWords = (g: Gauge): string => (g.isResetting ? `${gaugeTitle(g)} ${RESETTING}` : isLimit(g) ? `${gaugeTitle(g)} ${pct(g.left)} left` : `${gaugeTitle(g)} ${pct(g.used)} used`)

/** What the session card reads. `workedMs`: the main agent's time worked; `plan`: the plan's name, when the app said it. */
export type CardData = { main: MainRun; agents: AgentRun[]; retired?: Retired; usage: Usage; totals: Totals; workedMs?: number; plan?: string }

// Strip 1: Cost, Tokens, Time, each with its sub-line, which takes the first form that fits.
const figuresStrip = (c: Ctx, d: CardData, W: number, y0: number): { body: string; alt: string } => {
  const t = d?.totals
  const turn = d?.usage?.turnCostUsd
  const turnS = cost(turn, c, false)
  const u = t?.use
  const inAll = fin(u?.input) + fin(u?.cacheRead) + fin(u?.cacheWrite)
  const worked = fmtTime(fin(d?.workedMs))
  const cells = [
    { label: 'Cost', value: cost(t?.costUsd, c, t?.isEstimate !== false), subs: Number.isFinite(turn as number) ? [`this turn +${turnS}`, `+${turnS} turn`, `+${turnS}`] : [] },
    { label: 'Tokens', value: fmtTokens(fin(t?.tokens)), subs: [inOut(u), `${fmtTokens(inAll)} in`] },
    { label: 'Time', value: fmtTime(fin(t?.timeMs)), subs: Number.isFinite(d?.workedMs as number) ? [`worked ${worked}`, worked] : [] },
  ]
  const c3 = W / 3
  const room = Math.max(0, c3 - CELL_IN - 8)
  const body = cells
    .map((f, i) => {
      const x = i * c3 + CELL_IN
      const [vs, vz] = shrink(f.value, [17, 15, 13], room)
      return (
        (i ? vline(i * c3, y0 + 12, y0 + 64) : '') +
        text(x, y0 + 22, fit(f.label, 11, room), { cls: 's', size: 11 }) +
        text(x, y0 + 43, vs, { cls: 't', size: vz, weight: 600, num: true }) +
        text(x, y0 + 60, firstFit(f.subs, 11, room), { cls: 'm', size: 11, num: true })
      )
    })
    .join('')
  return { body, alt: cells.map(f => `${f.label} ${f.value}${f.subs[0] ? ` (${f.subs[0]})` : ''}`).join(', ') }
}

// Strip 2: one cell per gauge on `gaugeGrid`, as a bar (label, figure, bar, detail) or a
// ring (label above, ring, detail below). A window waiting for a fresh figure reads
// `resetting…`, muted, with an empty meter.
const gaugesStrip = (c: Ctx, kit: Kit, list: { gauge: Gauge; detail: string }[], asRing: boolean, W: number, y0: number): { body: string; h: number } => {
  const pal = paletteOf(c?.settings)
  const { cols, rows, cellW } = gaugeGrid(W, list.length)
  const rowH = asRing ? RING_ROW : GAUGE_ROW
  const body = list
    .map((x, i) => {
      const g = gaugeSafe(x.gauge)
      const col = i % cols
      const cx0 = col * cellW
      const cy = y0 + Math.floor(i / cols) * rowH
      const resetting = g.isResetting === true
      const color = resetting ? MUTED : toneOf(pal, g.tone)
      const frac = resetting ? 0 : gaugeFrac(g)
      const details = resetting ? [] : detailForms(str(x.detail))
      const rule = col ? vline(cx0, cy + 12, cy + rowH - 4) : ''
      if (asRing) {
        const mid = cx0 + cellW / 2
        const room = Math.max(0, cellW - 16)
        return (
          rule +
          text(mid, cy + 20, fit(gaugeTitle(g), 11, room), { cls: 's', size: 11, anchor: 'middle' }) +
          ring(mid, cy + 48, RING_CELL_D, RINGS_SW, frac, color, kit.sweep, resetting) +
          text(mid, cy + 52, resetting ? '…' : pct(isLimit(g) ? g.left : g.used), { cls: resetting ? 'm' : 't', size: 11, weight: 600, anchor: 'middle', num: true }) +
          text(mid, cy + 84, firstFit(resetting ? ['resetting'] : details, 10.5, room), { cls: 'm', size: 10.5, anchor: 'middle', num: true })
        )
      }
      const x0 = cx0 + CELL_IN
      const room = Math.max(0, cellW - CELL_IN * 2)
      let figure = text(x0, cy + 42, fit(RESETTING, 12, room), { cls: 'm', size: 12, weight: 600 })
      if (!resetting) {
        const fig = pct(isLimit(g) ? g.left : g.used)
        const unit = isLimit(g) ? ' left' : ' used'
        const ink: Omit<Part, 's'> = g.tone === 'calm' ? { cls: 't' } : { fill: color }
        // The figure and its word as one text, so they keep the font's own spacing.
        const parts: Part[] = [{ s: fig, ...ink, weight: 600 }, ...(textWidth(fig, 15) + textWidth(unit, 11) <= room ? [{ s: unit, cls: 's', size: 11 }] : [])]
        figure = rich(x0, cy + 42, parts, 15)
      }
      return (
        rule +
        text(x0, cy + 22, gaugeLabel(g, cellW - CELL_IN - 2), { cls: 's', size: 11 }) +
        figure +
        (room >= 8 ? bar(x0, cy + 49, room, 4, frac, color, kit.grow, { soft: true }) : '') +
        text(x0, cy + 66, firstFit(details, 10.5, room), { cls: 'm', size: 10.5, num: true })
      )
    })
    .join('')
  return { body, h: rows * rowH + STRIP_END }
}

const FAMILY_NAME: Record<ModelFamily, string> = { Fable: 'Fable', Opus: 'Opus', Sonnet: 'Sonnet', Haiku: 'Haiku', other: 'Other' }

// A model family's series: Fable the accent, Opus calm, Sonnet done, Haiku a neutral; any other model the muted ink.
const familyInk = (pal: Palette, f: ModelFamily): { fill?: string; cls?: string } =>
  f === 'Fable' ? { fill: pal.accent } : f === 'Opus' ? { fill: pal.calm } : f === 'Sonnet' ? { fill: pal.done } : f === 'Haiku' ? { cls: 'hk' } : { cls: 'm' }

const runTokens = (a: AgentRun): number => fin(a?.use?.input) + fin(a?.use?.output) + fin(a?.use?.cacheRead) + fin(a?.use?.cacheWrite)

/** The router's share of the session's tokens, in whole percent, and the subagents' (the rest); null before any token. */
export function splitShares(split: UsageSplit): { router: number; agents: number } | null {
  const total = fin(split?.main?.tokens) + fin(split?.agents?.tokens)
  if (!(total > 0)) return null
  const router = Math.round((fin(split?.main?.tokens) / total) * 100)
  return { router, agents: 100 - router }
}

// Strip 3: the router against the subagents, with the split bar (the router in its neutral,
// then one sliver per subagent in its own colour in start order, then one muted sliver for
// the rows no longer listed), then the model bar and its two-column legend. Null before
// the session has any tokens.
const splitStrip = (c: Ctx, kit: Kit, d: CardData, W: number, y0: number): { body: string; h: number; alt: string } | null => {
  const pal = paletteOf(c?.settings)
  const agents = (Array.isArray(d?.agents) ? d.agents : []).filter(a => !!a && typeof a === 'object')
  const split = usageSplit(d?.main, agents, d?.retired)
  const shares = splitShares(split)
  if (!shares) return null
  const total = split.main.tokens + split.agents.tokens
  const ix = CELL_IN
  const iw = Math.max(0, W - CELL_IN * 2)
  const side = (name: string, share: number, usd: number, withCost: boolean): Part[] => [
    { s: `${name} `, cls: 's' },
    { s: `${share}%`, cls: 't', weight: 600 },
    // Sums of list prices: estimates, marked as every other estimate is.
    { s: withCost ? ` · ${cost(usd, c, true)}` : '', cls: 's' },
  ]
  let heads = ''
  for (const withCost of [true, false]) {
    const L = side('Router', shares.router, split.main.costUsd, withCost)
    const R = side('Subagents', shares.agents, split.agents.costUsd, withCost)
    if (partsW(L, 11.5) + 12 + partsW(R, 11.5) <= iw) {
      heads = rich(ix, y0 + 24, L, 11.5) + rich(W - CELL_IN, y0 + 24, R, 11.5, 'end')
      break
    }
  }
  if (!heads) {
    const half = Math.max(0, (iw - 12) / 2)
    heads =
      text(ix, y0 + 24, fit(`Router ${shares.router}%`, 11.5, half), { cls: 's', size: 11.5, num: true }) +
      text(W - CELL_IN, y0 + 24, fit(`Subagents ${shares.agents}%`, 11.5, half), { cls: 's', size: 11.5, anchor: 'end', num: true })
  }
  const started = [...agents].sort((a, b) => fin(a.startedAt) - fin(b.startedAt))
  const segs: Seg[] = [{ v: split.main.tokens, cls: 'rt' }, ...started.map(a => ({ v: runTokens(a), fill: agentColor(a) })), { v: split.retired.tokens, cls: 'm' }]
  const models = MODEL_FAMILIES.map(f => ({ f, tokens: split.models[f].tokens })).filter(m => m.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const lw = W / 2
  const legend = models
    .map((m, i) => {
      const col = i % 2
      const cx = col * lw + CELL_IN
      const cy = y0 + 60 + Math.floor(i / 2) * LEGEND_ROW
      const right = (col + 1) * lw - CELL_IN
      const share = Math.round((m.tokens / total) * 100)
      const full: Part[] = [{ s: fmtTokens(m.tokens), cls: 't', weight: 600 }, { s: ` · ${share}%`, cls: 'm' }]
      const nameX = cx + 13
      // The share goes before the name is cut.
      const figure = partsW(full, 11) + 8 + textWidth(FAMILY_NAME[m.f], 11) <= right - nameX ? full : full.slice(0, 1)
      const fw = partsW(figure, 11)
      const ink = familyInk(pal, m.f)
      return (
        (col ? vline(lw, cy + 2, cy + 16) : '') +
        `<rect${ink.cls ? ` class="${ink.cls}"` : ` fill="${ink.fill}"`} x="${r(cx)}" y="${r(cy + 4)}" width="8" height="8" rx="2"/>` +
        text(nameX, cy + 12, fit(FAMILY_NAME[m.f], 11, right - nameX - fw - 8), { cls: 's', size: 11 }) +
        (fw <= right - nameX ? rich(right, cy + 12, figure, 11, 'end') : '')
      )
    })
    .join('')
  const body =
    heads +
    stackBar(ix, y0 + 32, iw, 8, segs, 2, kit.grow) +
    stackBar(ix, y0 + 48, iw, 4, models.map(m => ({ v: m.tokens, ...familyInk(pal, m.f) })), 1.5, kit.grow) +
    legend
  const alt = `router ${shares.router}%, subagents ${shares.agents}%; ${models.map(m => `${FAMILY_NAME[m.f]} ${fmtTokens(m.tokens)}`).join(', ')}`
  return { body, h: 60 + Math.ceil(models.length / 2) * LEGEND_ROW + 8, alt }
}

// A group's heading: its name, small and strong, at the card's inset.
const GROUP_H = 22
const GROUP_GAP = 8
const groupHead = (title: string, W: number, y0: number): string => text(CELL_IN, y0 + 15, fit(title, 11.5, Math.max(0, W - CELL_IN * 2)), { cls: 't', size: 11.5, weight: 600 })

// The Session group's context gauge, one line across the card: the label and figure at the
// left, the detail at the right, the meter (a bar, or with `ring` a small ring) between.
const CTX_ROW = 30
const CTX_RING_D = 14
const contextRow = (c: Ctx, kit: Kit, x: { gauge: Gauge; detail: string }, asRing: boolean, W: number, y0: number): string => {
  const pal = paletteOf(c?.settings)
  const g = gaugeSafe(x.gauge)
  const color = toneOf(pal, g.tone)
  const base = y0 + 19
  const right = W - CELL_IN
  const inner = Math.max(0, right - CELL_IN)
  const label = fit('Context', 11, inner)
  const lx = CELL_IN + (label ? textWidth(label, 11) + 8 : 0)
  const ink: Omit<Part, 's'> = g.tone === 'calm' ? { cls: 't' } : { fill: color }
  const fig: Part[] = [{ s: pct(g.used), ...ink, weight: 600 }, { s: ' used', cls: 's', size: 11 }]
  const figure = partsW(fig, 13) <= right - lx ? fig : fig.slice(0, 1)
  const fw = partsW(figure, 13) <= right - lx ? partsW(figure, 13) : 0
  const mx = lx + fw + 12
  const detail = firstFit(detailForms(str(x.detail)), 10.5, Math.max(0, right - mx - 12))
  const dw = detail ? textWidth(detail, 10.5) + 12 : 0
  const mw = right - dw - mx
  const meter = asRing
    ? mw >= CTX_RING_D
      ? ring(mx + CTX_RING_D / 2, y0 + 15, CTX_RING_D, 3, gaugeFrac(g), color, kit.sweep)
      : ''
    : mw >= 24
      ? bar(mx, y0 + 13, mw, 4, gaugeFrac(g), color, kit.grow, { soft: true })
      : ''
  return (
    text(CELL_IN, base, label, { cls: 's', size: 11 }) +
    (fw ? rich(lx, base, figure, 13) : '') +
    meter +
    text(right, base, detail, { cls: 'm', size: 10.5, anchor: 'end', num: true })
  )
}

/**
 * The session card, Normal mode, in two groups under small headings (`cardGroups`).
 * Session: the figures strip (Cost, Tokens, Time), the context on one line and the split
 * strip (router against subagents, then by model; left out before any token). Plan ·
 * <name>: one cell per window of the plan, as usage left, on `gaugeGrid`; left out when no
 * window is known. `panelUsage` draws the meters as bars or rings; `off` leaves out the
 * context line and the Plan group.
 */
export function sessionCardDrawing(c: Ctx, d: CardData): Drawing {
  const W = widthOf(c?.W)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const mode = c?.settings?.panelUsage
  const asRing = mode === 'ring'
  const groups = cardGroups(mode === 'off' ? [] : usageGauges(d?.usage, fin(c?.now)), d?.plan)
  const session = groups.find(g => g.key === 'session')
  const plan = groups.find(g => g.key === 'plan')
  let y = CARD_TOP
  let body = groupHead(session?.title ?? 'Session', W, y)
  y += GROUP_H
  const fig = figuresStrip(c, d, W, y)
  body += fig.body
  const alt = [fig.alt]
  y += FIGURES_H
  const ctx = session?.entries[0]
  if (ctx) {
    body += hline(CELL_IN, W - CELL_IN, y) + contextRow(c, kit, ctx, asRing, W, y)
    alt.push(gaugeWords(gaugeSafe(ctx.gauge)))
    y += CTX_ROW
  }
  const split = splitStrip(c, kit, d, W, y)
  if (split) {
    body += hline(CELL_IN, W - CELL_IN, y) + split.body
    alt.push(split.alt)
    y += split.h
  }
  let planAlt = ''
  if (plan) {
    // The plan's windows stand apart: a gap, a rule across the card, then their heading.
    y += GROUP_GAP
    body += hline(0, W, y) + groupHead(plan.title, W, y + 4)
    y += GROUP_H + 4
    const g = gaugesStrip(c, kit, plan.entries, asRing, W, y)
    body += g.body
    planAlt = `; ${plan.title}: ${plan.entries.map(x => gaugeWords(gaugeSafe(x.gauge))).join(', ')}`
    y += g.h
  }
  // No fill of its own: the pane lays the card on the bar's panel.
  return doc(W, Math.ceil(y + CARD_BOTTOM), body, `Session: ${alt.join('; ')}${planAlt}`, { kit })
}

/** Context first (when known), then every limit the engine reports, each with its dim detail. */
export function usageGauges(usage: Usage, now: number): { gauge: Gauge; detail: string }[] {
  const out: { gauge: Gauge; detail: string }[] = []
  const ctx = ctxGauge(usage)
  if (ctx) {
    const known = Number.isFinite(usage?.contextTokens as number) && fin(usage?.contextWindow) > 0
    out.push({ gauge: ctx, detail: known ? `${fmtTokens(usage.contextTokens as number)} / ${fmtTokens(usage.contextWindow)}` : '' })
  }
  for (const g of limitsOf(usage, now)) out.push({ gauge: g, detail: g.resetIn === null || g.isResetting ? '' : `resets in ${fmtSpan(g.resetIn)}` })
  return out
}

const RINGS_SW = 5

// ---------------------------------------------------------------------------
// Panel: agent rows.

const MAIN_SCALE = 2.4
const MAIN_PAD = 9
const ROW_SCALE = 1.1
const STATUS_WORD = { working: 'working', waiting: 'waiting', resting: 'resting' } as const

// The task strip under the main row's figures: the plan's name with its count and percent
// at the right, then one segment per task.
const STRIP_NAME = 11.5
const STRIP_SEG_Y = 18
const STRIP_SEG_H = 8
const STRIP_H = 30
/** What the bar's progress row and the main row's task strip read with no plan reported. */
const NO_TASK_YET = 'No task yet'

const TASK_STATES: readonly TaskState[] = ['none', 'running', 'paused', 'done']

/**
 * How a flow track looks in each task state, shared by the progress row and the task
 * strip. `none`: nothing on the track. `running`: the flow accent, twinkling, the pill
 * with the flow's label, the faint layer for the agents really running. `paused`: the
 * same in neutral grey, still, no faint layer, the pill `Paused · 1/3` (else the bare
 * count). `done`: the done colour, the slow twinkle, `Done`, 100%. A run's flow (one with
 * a `unit`) reads `Agents d/n` in every state. `fill`, when given, is how far the track is
 * filled instead of `done / total`.
 */
type TrackLook = { color: string; twinkle: boolean; finished: boolean; ratio: number; runningRatio: number; labels: string[]; percent: string; label: string }
const trackLook = (flow: Flow | null, state: TaskState, agentsRunning: number, fill?: number): TrackLook => {
  if (!flow || state === 'none') return { color: MUTED, twinkle: false, finished: false, ratio: 0, runningRatio: 0, labels: [], percent: '', label: '' }
  const counted = flow.unit ? flowLabel(flow) : ''
  if (state === 'done') {
    const label = counted || 'Done'
    return { color: FLOW_DONE, twinkle: true, finished: true, ratio: 1, runningRatio: 1, labels: counted ? pillLabels(label) : [label], percent: '100%', label }
  }
  const ratio = clamp(Number.isFinite(fill) ? (fill as number) : flow.total ? flow.done / flow.total : 0, 0, 1)
  const percent = `${Math.round(ratio * 100)}%`
  const count = flow.total ? `${flow.done}/${flow.total}` : ''
  if (state === 'paused') {
    const label = counted || (count ? `Paused · ${count}` : 'Paused')
    return { color: MUTED, twinkle: false, finished: false, ratio, runningRatio: ratio, labels: counted ? pillLabels(label) : count ? [label, count] : [label], percent, label }
  }
  // Running: handed out but not yet done, as far as the agents really running reach.
  const n = Math.max(0, Math.round(fin(agentsRunning)))
  const runningRatio = flow.total ? Math.max(ratio, Math.min(flow.total, flow.done + n) / flow.total) : ratio
  // A plan with no task count names the agents running: the real count, never `flow.running`.
  const label = flowLabel({ ...flow, isFinished: false, running: n })
  return { color: FLOW_ACCENT, twinkle: true, finished: false, ratio, runningRatio, labels: pillLabels(label), percent, label }
}

// A task state handed in may be junk: one of the four, `none` with no flow.
const stateOf = (state: unknown, flow: Flow | null): TaskState =>
  !flow ? 'none' : TASK_STATES.includes(state as TaskState) ? (state as TaskState) : flow.isFinished ? 'done' : 'paused'

/** A task segment's state: done, run (an agent works on it), wait (an agent waits), or plan (not started). */
export type SegState = 'done' | 'run' | 'wait' | 'plan'

/**
 * The task strip's segments, one per task in order: the done ones first, then one per
 * agent running (only while the plan runs), then one per agent waiting, then the rest.
 * Done: every segment done. No plan, or none counted: no segments.
 */
export function stripSegments(flow: Flow | null, state: TaskState, agentsRunning: number, agentsWaiting: number): SegState[] {
  const total = flow && state !== 'none' ? Math.max(0, Math.round(fin(flow.total))) : 0
  if (!total) return []
  const done = state === 'done' ? total : Math.min(total, Math.max(0, Math.round(fin(flow?.done))))
  const run = state === 'running' ? Math.min(total - done, Math.max(0, Math.round(fin(agentsRunning)))) : 0
  const wait = state === 'running' || state === 'paused' ? Math.min(total - done - run, Math.max(0, Math.round(fin(agentsWaiting)))) : 0
  return Array.from({ length: total }, (_, i): SegState => (i < done ? 'done' : i < done + run ? 'run' : i < done + run + wait ? 'wait' : 'plan'))
}

const trackRect = (x: number, y: number, w: number, h: number, rx: number): string =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(0, w))}" height="${h}" rx="${rx}" fill="${TRACK}" fill-opacity="${TRACK_OP}"/>`

// The main agent's task strip: the plan's name (muted while paused or with none), its count
// and percent at the right, then one segment per task in the bar's flow colours: done
// green (grey while paused), running the flow accent filled as far as the bar's fill says,
// waiting outlined amber, the rest an empty track. With no plan, `No task yet` over an
// empty track; with too many tasks for segments, one bar filled to the plan's ratio.
const taskStrip = (
  flow: Flow | null,
  state: TaskState,
  agentsRunning: number,
  agentsWaiting: number,
  grow: Entrance,
  fill?: number,
): { block: (w: number) => Block; alt: string } => {
  const look = trackLook(flow, state, agentsRunning, fill)
  const hasPlan = !!flow && state !== 'none'
  const name = hasPlan ? (flow?.title ?? '') : ''
  const segs = stripSegments(flow, state, agentsRunning, agentsWaiting)
  const total = segs.length
  const doneN = segs.filter(s => s === 'done').length
  const count = total ? `${doneN}/${total}` : ''
  const right: Part[] = hasPlan ? [{ s: count, cls: 't', weight: 600 }, { s: count ? ` · ${look.percent}` : look.percent, cls: 'm' }] : []
  // How far each running segment is filled: what the fill holds past the done ones, in turn.
  const extra = Number.isFinite(fill) ? clamp(fill as number, 0, 1) * total - doneN : NaN
  const block = (w: number): Block => ({
    h: STRIP_H,
    draw: (x, y) => {
      const rw = partsW(right, STRIP_NAME)
      const shownRight = rw <= w ? right : []
      const head =
        text(x, y + 12, fit(name || NO_TASK_YET, STRIP_NAME, w - (shownRight.length ? rw + 10 : 0)), { cls: name && state !== 'paused' ? 's' : 'm', size: STRIP_NAME }) +
        rich(x + w, y + 12, shownRight, STRIP_NAME, 'end')
      const sy = y + STRIP_SEG_Y
      let gap = 3
      let sw = total ? (w - gap * (total - 1)) / total : 0
      if (total && sw < 6) {
        gap = 1
        sw = (w - (total - 1)) / total
      }
      if (!total || sw < 2) {
        const ratio = state === 'done' ? 1 : look.ratio
        const color = state === 'paused' ? MUTED : state === 'done' ? FLOW_DONE : FLOW_ACCENT
        return head + (w >= 8 ? bar(x, sy, w, STRIP_SEG_H, hasPlan ? ratio : 0, color, grow, { soft: true }) : '')
      }
      let runIndex = 0
      const parts = segs.map((s, i) => {
        const sx = x + i * (sw + gap)
        if (s === 'done') return `<rect fill="${state === 'paused' ? MUTED : FLOW_DONE}" x="${r(sx)}" y="${r(sy)}" width="${r(sw)}" height="${STRIP_SEG_H}" rx="2"/>`
        if (s === 'run') {
          const f = Number.isFinite(extra) ? clamp(extra - runIndex, 0.15, 1) : 0.5
          runIndex += 1
          return trackRect(sx, sy, sw, STRIP_SEG_H, 2) + `<rect fill="${FLOW_ACCENT}" x="${r(sx)}" y="${r(sy)}" width="${r(Math.max(4, sw * f))}" height="${STRIP_SEG_H}" rx="2"/>`
        }
        if (s === 'wait')
          return trackRect(sx, sy, sw, STRIP_SEG_H, 2) + `<rect x="${r(sx + 0.75)}" y="${r(sy + 0.75)}" width="${r(Math.max(0, sw - 1.5))}" height="6.5" rx="1.5" fill="none" stroke="${TONES.warn}" stroke-width="1.5"/>`
        return trackRect(sx, sy, sw, STRIP_SEG_H, 2)
      })
      return head + `<g${enterAttrs(grow)}>${parts.join('')}</g>`
    },
  })
  return { block, alt: hasPlan ? `task ${name || 'untitled'}: ${look.label}, ${look.percent}` : 'no task yet' }
}

// A flow handed in from state may be junk: counts whole and non-negative, a known phase.
const flowSafe = (f: Flow | null | undefined): Flow | null => {
  if (!f || typeof f !== 'object') return null
  const total = Math.max(0, Math.round(fin(f.total)))
  return {
    title: str(f.title),
    total,
    done: Math.max(0, Math.round(fin(f.done))),
    running: Math.max(0, Math.round(fin(f.running))),
    phase: f.phase ?? 'plan',
    isFinished: f.isFinished === true,
    tasks: [],
    ...(str(f.unit) ? { unit: str(f.unit) } : {}),
  }
}

// The status chip: working in the main colour at a fifth, its word in the chip ink; waiting
// solid amber; resting the plain fill.
const chipLook = (status: 'working' | 'waiting' | 'resting'): { rect: string; ink: Omit<T, 'size'> } =>
  status === 'working'
    ? { rect: ` fill="${MAIN_LOOK.color}" fill-opacity=".2"`, ink: { cls: 'chip' } }
    : status === 'waiting'
      ? { rect: ` fill="${TONES.warn}"`, ink: { fill: '#ffffff' } }
      : { rect: ' class="k"', ink: { cls: 's' } }

// The main agent: a big mascot, name and status chip, model, what it does, figures and
// its task strip. `fill`, when given, is how far the task strip is filled (the bar's own
// fill); `agentsWaiting` marks as many waiting segments.
export function mainDrawing(c: Ctx, main: MainRun, agentsRunning: number, usage: Usage, flow: Flow | null = null, fill?: number, agentsWaiting = 0): Drawing {
  const W = widthOf(c?.W)
  const now = fin(c?.now)
  const theme = themeOf(c?.settings)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const k = MAIN_SCALE * iconK(c?.settings)
  const status = main?.status === 'working' || main?.status === 'waiting' ? main.status : 'resting'
  const pose: Pose = status === 'working' ? 'work' : status === 'waiting' ? 'wait' : 'rest'

  const name = 'Claude'
  const word = STATUS_WORD[status]
  const n = Math.max(0, Math.round(fin(agentsRunning)))
  const crew = n ? `${n} agent${n === 1 ? '' : 's'}` : ''
  const model = str(main?.model) ? modelLabel(str(main.model), str(main.effort) || undefined) : ''
  const since = Math.max(0, now - fin(main?.doingSince, now))
  // Resting, the time since the last turn counts in whole minutes, so the row changes once a minute at most.
  const mins = Math.floor(since / 60_000)
  const hasRested = status === 'resting' && fin(main?.turns) > 0
  const doing =
    status === 'resting'
      ? hasRested
        ? `Resting · last turn ${mins < 1 ? 'just now' : `${fmtSpan(mins * 60_000)} ago`}`
        : 'Resting'
      : str(main?.doing) || (status === 'working' ? 'Working' : 'Waiting')
  const worked = fmtTime(mainWorkedMs({ ...main, workedMs: fin(main?.workedMs), turnStartedAt: Number.isFinite(main?.turnStartedAt as number) ? (main.turnStartedAt as number) : null }, now))
  const spent = cost(main?.costUsd, c, true)
  const plan = flowSafe(flow)
  const strip = taskStrip(plan, taskState(plan, status === 'working', n), n, Math.max(0, Math.round(fin(agentsWaiting))), kit.grow, fill)
  const chipW = Math.round(textWidth(word, 11) + 16)
  const nameW = textWidth(name, 15)
  const chip = chipLook(status)
  const figures = [inOut(main?.use), spent, worked]
  const stats = figures.join(' · ')

  const build: Build = (topW, restW) => {
    // Line 1: name and status chip; the chip takes a line of its own when it does not fit
    // beside the name, and the agent count joins the model line when it does not fit here.
    const chipBeside = nameW + 8 + chipW <= topW
    const crewBeside = !!crew && chipBeside && nameW + 8 + chipW + 12 + textWidth(crew, 11) <= topW
    const head: Block = {
      h: chipBeside ? 20 : 42,
      draw: (x, y) => {
        const cx = chipBeside ? x + nameW + 8 : x
        const cy = chipBeside ? y + 1 : y + 22
        return (
          text(x, y + 15, fit(name, 15, topW), { cls: 't', size: 15, weight: 600 }) +
          `<rect${chip.rect} x="${r(cx)}" y="${r(cy)}" width="${chipW}" height="18" rx="9"/>${text(cx + chipW / 2, cy + 13, word, { ...chip.ink, size: 11, weight: 600, anchor: 'middle' })}` +
          (crewBeside ? text(x + topW, y + 15, crew, { cls: 'm', size: 11, anchor: 'end' }) : '')
        )
      },
    }
    // The model wraps; an agent count that left line 1 goes at the end of its last line, whole.
    const models = model ? wrapText(model, 12, topW, 2) : []
    const lastW = textWidth(models[models.length - 1] ?? '', 12)
    const crewHere = crew && !crewBeside ? (models.length && lastW + 12 + textWidth(crew, 11) <= topW ? 'end' : 'line') : ''
    const lines = models.length + (crewHere === 'line' ? 1 : 0)
    const modelBlock: Block = {
      h: lines ? lines * 16 + 2 : 0,
      draw: (x, y) =>
        models.map((s, i) => text(x, y + 13 + i * 16, s, { cls: 's', size: 12 })).join('') +
        (crewHere === 'end' ? text(x + topW, y + 13 + (models.length - 1) * 16, crew, { cls: 'm', size: 11, anchor: 'end' }) : '') +
        (crewHere === 'line' ? text(x, y + 13 + models.length * 16, fit(crew, 11, topW), { cls: 'm', size: 11 }) : ''),
    }
    const statLines = joinWrap(figures, 11.5, Math.max(1, restW), 2)
    const statsBlock: Block = {
      h: statLines.length * 15 + 9,
      draw: (x, y) => statLines.map((s, i) => text(x, y + 16 + i * 15, s, { cls: 's', size: 11.5, num: true })).join(''),
    }
    return {
      top: [head, modelBlock],
      rest: [lineBlock(doing, 13, 17, 15, restW, 3, { cls: status === 'resting' ? 'm' : 't' }), statsBlock, strip.block(restW)],
    }
  }
  const hs = heroSprite(c?.settings, theme, k, 'main', pose)
  const { body, H } = rowLayout(W, hs.w, hs.h, MAIN_PAD, build, hs.draw)
  const alt = `Claude, ${word}: ${doing}.${model ? ' ' + model + '.' : ''} ${stats}; ${strip.alt}${n ? `; ${crew} running` : ''}`
  // Redrawn every tick while it or any agent works; resting, it holds still. A resting row
  // whose minutes move is anchored to the moment its text last changed, so the mascot's
  // loops go on where they were rather than restart with the new text.
  const isMoving = status !== 'resting' || n > 0
  const restAnchor = hasRested && Number.isFinite(c?.clock) ? fin(main?.doingSince, now) + mins * 60_000 : undefined
  return doc(W, H, body, alt, { theme, kit, clock: isMoving ? c?.clock : restAnchor, hero: heroOn(c?.settings) })
}

const runPose = (s: string): Pose => (s === 'running' ? 'work' : s === 'waiting' ? 'wait' : 'done')

// One subagent: description and status, kind and model, what it does (steps first),
// tokens (`in` counts the cache) with cost and time, and while it works a thin bar of its
// steps, or else of its context.
export function agentDrawing(c: Ctx, a: AgentRun): Drawing {
  const W = widthOf(c?.W)
  const now = fin(c?.now)
  const theme = themeOf(c?.settings)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const k = ROW_SCALE * iconK(c?.settings)
  const own = agentColor(a ?? {})
  const costume = KINDS[agentKind(a ?? {})].sprite
  const status = a?.status ?? 'running'
  // A running agent's dot and bar follow the colour setting; the kind label keeps the agent's own colour.
  const color = status === 'running' ? workColor(c?.settings, a ?? {}) : own
  const title = str(a?.description) || str(a?.type) || 'Agent'
  const meta = [str(a?.model) ? modelLabel(str(a.model), str(a.effort) || undefined) : '']
  if (fin(a?.round) > 1) meta.push(`round ${Math.round(fin(a.round))}`)
  if (status === 'failed') meta.push('error')
  const metaText = meta.filter(Boolean).join(' · ')
  const label = agentLabel(a ?? {})
  const stepTotal = Math.round(fin(a?.stepTotal))
  const steps = stepTotal > 0 ? `${Math.round(clamp(fin(a.stepDone), 0, stepTotal))}/${stepTotal}${str(a.stepNote) ? ' · ' + str(a.stepNote) : ''}` : ''
  const doing = str(a?.doing)
  const progress = a ? progressOf({ ...a, stepTotal: stepTotal || undefined }) : null
  const ctx = ctxOf({ contextTokens: fin(a?.contextTokens), contextMax: fin(a?.contextMax) })
  const time = fmtTime(a ? elapsed({ ...a, startedAt: fin(a.startedAt, now), endedAt: Number.isFinite(a.endedAt as number) ? a.endedAt : undefined }, now) : 0)
  const spent = cost(a?.costUsd, c, true)
  const figures = [inOut(a?.use), spent, time]
  const stats = figures.join(' · ')
  const isMoving = status === 'running' || status === 'waiting'

  const build: Build = (topW, restW) => {
    // The title leaves room at its right for the status mark.
    const lines = wrapText(title, 13, Math.max(1, topW - 18), 2)
    const head: Block = {
      h: lines.length * 17,
      draw: (x, y) => lines.map((s, i) => text(x, y + 14 + i * 17, s, { cls: 't', size: 13, weight: 600 })).join('') + statusMark(x + topW - 6, y + 10, status, color),
    }
    const metaBlock = richBlock([{ s: label, fill: own, weight: 600 }, { s: metaText ? ' · ' + metaText : '', cls: 's' }], 11.5, 15, 14, topW, 2)
    const doingBlock = richBlock([{ s: steps, cls: 't', weight: 600 }, { s: steps && doing ? ' · ' : '', cls: 's' }, { s: doing, cls: 's' }], 12, 16, 14, restW, 3)
    const statLines = joinWrap(figures, 11, Math.max(1, restW), 2)
    const statsBlock: Block = {
      h: statLines.length * 14 + 2,
      draw: (x, y) => statLines.map((s, i) => text(x, y + 14 + i * 14, s, { cls: 'm', size: 11, num: true })).join(''),
    }
    const progressBar: Block = {
      h: 10,
      draw: (x, y) => bar(x, y + 6, restW, 4, progress ?? ctx / 100, color, kit.grow, progress === null ? { cls: 'm' } : {}),
    }
    return {
      top: [head, { h: metaBlock.h + 3, draw: metaBlock.draw }],
      rest: [{ h: doingBlock.h + (doingBlock.h ? 1 : 0), draw: doingBlock.draw }, statsBlock, ...(isMoving ? [progressBar] : [])],
    }
  }
  const hs = heroSprite(c?.settings, theme, k, costume, runPose(status), own)
  const { body, H } = rowLayout(W, hs.w, hs.h, PAD, build, hs.draw)
  const alt = `${label} agent, ${status}: ${title}.${doing ? ' ' + doing + '.' : ''}${steps ? ' Step ' + steps + '.' : ''} ${stats}`
  // A working or waiting row is redrawn every tick (its clock runs); a finished one holds still.
  return doc(W, H, body + hairline(W, H - 0.5), alt, { theme, kit, clock: isMoving ? c?.clock : undefined, hero: heroOn(c?.settings) })
}

// A task the plan holds that no agent has started: dimmed mascot, number, title, kind,
// and the model and effort it is planned for.
export function plannedDrawing(c: Ctx, p: Planned): Drawing {
  const W = widthOf(c?.W)
  const theme = themeOf(c?.settings)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const k = ROW_SCALE * iconK(c?.settings)
  const kind = taskKind(p ?? {})
  const own = taskColor(p ?? {})
  const title = `${Math.max(1, Math.round(fin(p?.n, 1)))}. ${str(p?.title) || 'Task'}`
  const after = Array.isArray(p?.after) ? p.after.filter(n => Number.isInteger(n)) : []
  const meta = [plannedModel(p ?? {}), after.length ? `after ${after.join(', ')}` : ''].filter(Boolean)
  const label = KINDS[kind].label
  const build: Build = topW => {
    const lines = wrapText(title, 13, Math.max(1, topW - 18), 2)
    const head: Block = {
      h: lines.length * 17,
      draw: (x, y) => lines.map((s, i) => text(x, y + 14 + i * 17, s, { cls: 's', size: 13, weight: 600 })).join('') + statusMark(x + topW - 6, y + 10, 'planned', own),
    }
    return { top: [head, richBlock([{ s: label, fill: own, weight: 600 }, { s: meta.length ? (label ? ' · ' : '') + meta.join(' · ') : '', cls: 'm' }], 11.5, 15, 14, topW, 2)], rest: [] }
  }
  const hs = heroSprite(c?.settings, theme, k, KINDS[kind].sprite, 'planned', own)
  const { body, H } = rowLayout(W, hs.w, hs.h, PAD, build, hs.draw)
  return doc(W, H, body + hairline(W, H - 0.5), `Planned: ${title}${label ? ', for ' + label : ''}${after.length ? ', after ' + after.join(', ') : ''}`, { theme, kit, hero: heroOn(c?.settings) })
}

// ---------------------------------------------------------------------------
// Panel, compact mode: a small card, one line per agent, one line of counts.

const COMPACT_CARD_H = 62
const COMPACT_CARD_H1 = 36
const COMPACT_SCALE = 0.8
const COMPACT_LINE_H = 30
const COMPACT_FOOT_H = 34
// The widest a model's name may be on a compact line.
const COMPACT_MODEL_W = 64

/**
 * The compact card: line 1 the cost, tokens and time, with this turn's cost at the right
 * (each shortened, then dropped, while they do not fit); line 2 one small cell per gauge,
 * `Ctx 52%` over a 3px bar (the bare figure when the label does not fit). With no gauge
 * (none known, or `panelUsage` off) the card is line 1 alone.
 */
export function compactCardDrawing(c: Ctx, t: Totals, usage: Usage): Drawing {
  const W = widthOf(c?.W)
  const pal = paletteOf(c?.settings)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  // The same order as the Normal card's groups: the context, then the plan's windows.
  const gauges = c?.settings?.panelUsage === 'off' ? [] : cardGroups(usageGauges(usage, fin(c?.now))).flatMap(g => g.entries)
  const top = CARD_TOP
  const inner = Math.max(0, W - CELL_IN * 2)
  const [vs, vz] = shrink(cost(t?.costUsd, c, t?.isEstimate !== false), [13, 12], inner)
  const vw = vs ? textWidth(vs, vz) : 0
  const tok = fmtTokens(fin(t?.tokens))
  const turn = usage?.turnCostUsd
  const turnS = cost(turn, c, false)
  const rights = Number.isFinite(turn as number) ? [`+${turnS} turn`, `+${turnS}`, ''] : ['']
  const pick = ((): [string, string] => {
    for (const s of [`${tok} · ${fmtTime(fin(t?.timeMs))}`, tok, ''])
      for (const rt of rights) if (vw + (s ? 8 + textWidth(s, 12) : 0) + (rt ? 12 + textWidth(rt, 11) : 0) <= inner) return [s, rt]
    return ['', '']
  })()
  const base = top + 22
  let body =
    text(CELL_IN, base, vs, { cls: 't', size: vz, weight: 600, num: true }) +
    text(CELL_IN + vw + 8, base, pick[0], { cls: 's', size: 12, num: true }) +
    text(W - CELL_IN, base, pick[1], { cls: 'm', size: 11, anchor: 'end', num: true })
  const n = gauges.length
  // The cells share the card from its inset to its edge; in each, the words run to 8px
  // short of the next cell and the bar to 20px short.
  const cw = n ? Math.max(0, W - CELL_IN) / n : 0
  gauges.forEach((x, i) => {
    const g = gaugeSafe(x.gauge)
    const resetting = g.isResetting === true
    const cx = CELL_IN + i * cw
    const room = Math.max(0, cw - 8)
    const barW = Math.max(0, cw - 20)
    const value = resetting ? '…' : pct(isLimit(g) ? g.left : g.used)
    const label = `${gaugeTiny(g)} `
    const ink: Omit<Part, 's'> = resetting ? { cls: 'm' } : g.tone === 'calm' ? { cls: 't' } : { fill: toneOf(pal, g.tone) }
    const words: Part[] = textWidth(label, 11) + textWidth(value, 11) <= room ? [{ s: label, cls: 's' }, { s: value, ...ink, weight: 600 }] : textWidth(value, 11) <= room ? [{ s: value, ...ink, weight: 600 }] : []
    body +=
      rich(cx, top + 44, words, 11) +
      (barW >= 8 ? bar(cx, top + 50, barW, 3, resetting ? 0 : gaugeFrac(g), resetting ? MUTED : toneOf(pal, g.tone), kit.grow, { soft: true }) : '')
  })
  const cardH = n ? COMPACT_CARD_H : COMPACT_CARD_H1
  const alt = `Session: ${vs}, ${tok} tokens, ${fmtTime(fin(t?.timeMs))}${n ? '; ' + gauges.map(x => gaugeWords(gaugeSafe(x.gauge))).join(', ') : ''}`
  // No fill of its own: the pane lays the card on the bar's panel.
  return doc(W, top + cardH + CARD_BOTTOM, body, alt, { kit })
}

type LineSpec = { costume: string; pose: Pose; color?: string; title: string; metas: Part[][]; right: string; strong: boolean; mark: (x: number, y: number) => string; alt: string; isMoving: boolean }

// One compact line: the small mascot, the title, the kind and model (shortened, then
// dropped, before the title is cut below its width or 64px), the step or tokens at the
// right, 16px in from the status mark.
const compactLine = (c: Ctx, o: LineSpec): Drawing => {
  const W = widthOf(c?.W)
  const theme = themeOf(c?.settings)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const k = COMPACT_SCALE * iconK(c?.settings)
  const hs = heroSprite(c?.settings, theme, k, o.costume, o.pose, o.color)
  const sw = hs.w
  const sh = hs.h
  const H = Math.max(COMPACT_LINE_H, Math.ceil(sh + 6))
  const base = H / 2 + 4
  const x = Math.round(sw + 8)
  const right = textWidth(o.right, 11.5) <= Math.max(0, W - 16 - x) ? o.right : ''
  const end = W - 16 - (right ? textWidth(right, 11.5) + 10 : 0)
  // The title and the kind run as one text, so they keep the font's own spacing.
  const GAP = '  '
  const metaW = (m: Part[]): number => (m.length ? textWidth(GAP, 12.5) + partsW(m, 11.5) : 0)
  const tw0 = textWidth(o.title, 12.5)
  const want = Math.min(tw0, 64)
  const meta = o.metas.find(m => !m.length || Math.min(tw0, end - x - metaW(m)) >= want) ?? []
  const title = fit(o.title, 12.5, end - x - metaW(meta))
  const line: Part[] = title ? [{ s: title, cls: 't', weight: 600 }, ...(meta.length ? [{ s: GAP }, ...meta.map(p => ({ ...p, size: 11.5 }))] : [])] : []
  const body =
    hs.draw(0, Math.round((H - sh) / 2)) +
    rich(x, base, line, 12.5) +
    text(W - 16, base, right, { cls: o.strong ? 't' : 's', size: 11.5, weight: o.strong ? 600 : undefined, anchor: 'end', num: true }) +
    o.mark(W - 6, H / 2)
  return doc(W, H, body, o.alt, { theme, kit, clock: o.isMoving ? c?.clock : undefined, hero: heroOn(c?.settings) })
}

/** The main agent's compact line: `Claude`, its status word and model, the plan's count at the right. */
export function compactMainDrawing(c: Ctx, main: MainRun, flow: Flow | null, agentsRunning: number): Drawing {
  const status = main?.status === 'working' || main?.status === 'waiting' ? main.status : 'resting'
  const word = STATUS_WORD[status]
  const ink: Part = status === 'working' ? { s: word, cls: 'chip', weight: 600 } : status === 'waiting' ? { s: word, fill: TONES.warn, weight: 600 } : { s: word, cls: 'm', weight: 600 }
  const model = str(main?.model) ? fit(modelName(str(main.model)), 11.5, COMPACT_MODEL_W) : ''
  const plan = flowSafe(flow)
  const state = taskState(plan, status === 'working', Math.max(0, Math.round(fin(agentsRunning))))
  const segs = stripSegments(plan, state, 0, 0)
  const count = segs.length ? `${segs.filter(s => s === 'done').length}/${segs.length}` : ''
  return compactLine(c, {
    costume: 'main',
    pose: status === 'working' ? 'work' : status === 'waiting' ? 'wait' : 'rest',
    title: 'Claude',
    metas: [[ink, { s: model ? ` · ${model}` : '', cls: 's' }], [ink], []],
    right: count,
    strong: true,
    mark: () => '',
    alt: `Claude, ${word}${model ? ', ' + model : ''}${count ? `; tasks ${count}` : ''}`,
    isMoving: status !== 'resting',
  })
}

/** One subagent's compact line: title, kind and model family, its step or its tokens, its status mark. */
export function compactAgentDrawing(c: Ctx, a: AgentRun): Drawing {
  const own = agentColor(a ?? {})
  const status = a?.status ?? 'running'
  const color = status === 'running' ? workColor(c?.settings, a ?? {}) : own
  const label = agentLabel(a ?? {})
  const id = str(a?.model)
  const family = id ? familyOf(id) : 'other'
  const model = family !== 'other' ? family : id ? fit(modelName(id), 11.5, COMPACT_MODEL_W) : ''
  const stepTotal = Math.round(fin(a?.stepTotal))
  const steps = stepTotal > 0 ? `${Math.round(clamp(fin(a?.stepDone), 0, stepTotal))}/${stepTotal}` : ''
  const right = steps || fmtTokens(runTokens(a))
  const kindPart: Part = { s: label, fill: own, weight: 600 }
  return compactLine(c, {
    costume: KINDS[agentKind(a ?? {})].sprite,
    pose: runPose(status),
    color: own,
    title: str(a?.description) || str(a?.type) || 'Agent',
    metas: [[kindPart, { s: model ? ` · ${model}` : '', cls: 's' }], [kindPart], []],
    right,
    strong: !!steps,
    mark: (mx, my) => statusMark(mx, my, status, color),
    alt: `${label} agent, ${status}: ${str(a?.description) || 'Agent'}; ${steps ? 'step ' + steps : right + ' tokens'}`,
    isMoving: status === 'running' || status === 'waiting',
  })
}

/** The compact panel's last line: how many tasks are planned and agents finished, the failed ones in the alert colour. */
export function compactFootDrawing(c: Ctx, planned: number, finished: number, failed: number): Drawing {
  const W = widthOf(c?.W)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const p = Math.max(0, Math.round(fin(planned)))
  const f = Math.max(0, Math.round(fin(finished)))
  const x = Math.max(0, Math.round(fin(failed)))
  const parts: Part[] = []
  if (p) parts.push({ s: 'Planned ', cls: 's' }, { s: String(p), cls: 't', weight: 600 })
  if (f) parts.push({ s: p ? ' · Finished ' : 'Finished ', cls: 's' }, { s: String(f), cls: 't', weight: 600 })
  if (f && x) parts.push({ s: `  ${x} failed`, fill: TONES.alert })
  // One line; cut at the end when even that does not fit.
  const line = partsW(parts, 12) <= W ? rich(0, 24, parts, 12) : `<text x="0" y="24"${attrs({ size: 12, num: true })}>${tspans(richWrap(parts, 12, W, 1)[0] ?? [])}</text>`
  const alt = [p ? `${p} planned` : '', f ? `${f} finished` : '', f && x ? `${x} failed` : ''].filter(Boolean).join(', ') || 'Nothing planned or finished'
  return doc(W, COMPACT_FOOT_H, hline(0, W, 4.5) + (parts.length ? line : ''), alt, { kit })
}

const LOG_LH = 16
const LOG_PAD = 6
const LOG_GAP = 3
const LOG_MAX_H = 4000

const logMark = (e: LogEntry, pal: Palette, color: string): { s: string; fill?: string; cls?: string } => {
  if (e.outcome === 'open') return { s: '…', fill: color }
  if (e.outcome === 'error') return { s: '✗', fill: pal.alert }
  if (e.outcome === 'denied') return { s: '⊘', fill: pal.warn }
  if (e.kind === 'turn') return { s: '›', cls: 's' }
  if (e.kind === 'think') return { s: '∴', cls: 'm' }
  if (e.kind === 'reply') return { s: '✎', cls: 'm' }
  if (e.kind === 'step') return { s: '•', fill: color }
  return { s: '✓', fill: pal.calm }
}

// `2.1s`, `42s`, `1:15`: how long an entry took, once it closed.
const duration = (ms: unknown): string => {
  if (!Number.isFinite(ms as number)) return ''
  const v = Math.max(0, ms as number)
  if (v < 10_000) return `${(v / 1000).toFixed(1)}s`
  if (v < 60_000) return `${Math.round(v / 1000)}s`
  return fmtTime(v)
}

// A row's log, opened under it: a rule in its colour, then `head` (the row's cache
// figures) when given, then one entry per row (time, mark, text over up to two lines,
// duration at the right), newest last.
export function logDrawing(c: Ctx, log: LogEntry[], color: string, head = ''): Drawing {
  const W = widthOf(c?.W)
  const pal = paletteOf(c?.settings)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const ink = colorOf(color, pal.accent)
  const cap = Math.round(clamp(fin(c?.settings?.logLines, 15), 5, 200))
  const entries = (Array.isArray(log) ? log : []).filter((e): e is LogEntry => !!e && typeof e === 'object').slice(-cap)
  const timeW = Math.ceil(textWidth('00:00:00', 10.5))
  const x0 = 10
  const markX = x0 + timeW + 7
  const textX = markX + 14
  const rows = entries.map(e => {
    const dur = duration(e.ms)
    const durW = dur ? Math.ceil(textWidth(dur, 10.5)) + 8 : 0
    const lines = wrapText(str(e.text) || (e.kind === 'turn' ? 'Turn' : 'Entry'), 11.5, Math.max(20, W - textX - durW - 2), 2)
    return { e, dur, lines, h: Math.max(1, lines.length) * LOG_LH + LOG_GAP }
  })
  // Never taller than the cap: the oldest entries go first.
  const top = str(head) ? fit(str(head), 11, W - x0) : ''
  const headH = top ? LOG_LH + LOG_GAP : 0
  let total = rows.reduce((h, row) => h + row.h, 0) + LOG_PAD * 2 + headH
  while (rows.length > 1 && total > LOG_MAX_H) total -= rows.shift()?.h ?? 0
  let y = LOG_PAD + headH
  const body = rows
    .map(({ e, dur, lines, h }) => {
      const base = y + 12
      const mark = logMark(e, pal, ink)
      const out =
        text(x0, base, fmtClock(fin(e.at), fin(c?.tzOffsetMin)), { cls: 'm', size: 10.5, num: true }) +
        text(markX, base, mark.s, { cls: mark.cls, fill: mark.fill, size: 11.5, weight: 600 }) +
        lines.map((s, i) => text(textX, base + i * LOG_LH, s, { cls: e.outcome === 'open' ? 't' : 's', size: 11.5 })).join('') +
        (dur ? text(W - 2, base, dur, { cls: 'm', size: 10.5, anchor: 'end', num: true }) : '')
      y += h
      return out
    })
    .join('')
  const H = rows.length ? Math.ceil(y + LOG_PAD - LOG_GAP) : LOG_PAD * 2 + LOG_LH + headH
  const empty = rows.length ? '' : text(x0, LOG_PAD + headH + 12, fit('No activity yet.', 11.5, W - x0), { cls: 'm', size: 11.5 })
  const headText = top ? text(x0, LOG_PAD + 12, top, { cls: 'm', size: 11, num: true }) : ''
  const rule = `<rect x="0" y="0" width="2" height="${Math.round(clamp(H, 1, MAX_H))}" rx="1" fill="${ink}"/>`
  const last = rows[rows.length - 1]
  const alt = rows.length ? `Log, ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}; latest: ${str(last?.e.text)}` : 'Log: no activity yet'
  return doc(W, H, rule + headText + body + empty, top ? `${alt}; ${top}` : alt, { kit })
}

const HEAD_H = 32
const HEAD_BASE = 22

// A section heading in sentence case: `Working`, its count muted after it, a hairline from
// there to the edge.
export function sectionDrawing(c: Ctx, text_: string, count?: number): Drawing {
  const W = widthOf(c?.W)
  const kit = kitOf(c?.enterAgeMs, c?.settings)
  const hasCount = typeof count === 'number' && Number.isFinite(count)
  const label = str(text_) || 'Agents'
  const n = hasCount ? String(Math.max(0, Math.round(count))) : ''
  const nw = n ? textWidth(n, 12) : 0
  const shown = fit(label, 12, Math.max(0, W - (n ? nw + 6 : 0)))
  const lw = shown ? textWidth(shown, 12) : 0
  const end = lw + (n ? 6 + nw : 0) + 10
  const body =
    text(0, HEAD_BASE, shown, { cls: 's', size: 12, weight: 600 }) +
    (n && lw + 6 + nw <= W ? text(lw + 6, HEAD_BASE, n, { cls: 'm', size: 12, num: true }) : '') +
    (end < W ? hline(end, W, HEAD_BASE - 4) : '')
  return doc(W, HEAD_H, body, n ? `${label} ${n}` : label, { kit })
}

const BACK_STEP = 16

// The pane's backdrop tile: dots, or 1px hairlines every 16px; the caller stacks tiles of at most 4096px.
export function backdropDrawing(kind: 'dots' | 'grid', W: number, H: number): Drawing {
  const w = widthOf(W)
  const h = Math.round(clamp(fin(H, BACK_STEP), 1, MAX_H))
  if (kind === 'grid') {
    const rules = `.g{stroke:#1f1f1f;stroke-opacity:.055}@media (prefers-color-scheme: dark){.g{stroke:#ffffff;stroke-opacity:.06}}`
    return doc(
      w,
      h,
      `<defs><pattern id="g" width="${BACK_STEP}" height="${BACK_STEP}" patternUnits="userSpaceOnUse"><path class="g" d="M${BACK_STEP} .5H.5V${BACK_STEP}" fill="none" stroke-width="1"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`,
      'Grid backdrop',
      { rules },
    )
  }
  const rules = `.d{fill:#d9d8d4}@media (prefers-color-scheme: dark){.d{fill:#3a3a38}}`
  return doc(
    w,
    h,
    `<defs><pattern id="g" width="${BACK_STEP}" height="${BACK_STEP}" patternUnits="userSpaceOnUse"><circle class="d" cx="${BACK_STEP / 2}" cy="${BACK_STEP / 2}" r="1"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`,
    'Dotted backdrop',
    { rules },
  )
}

// ---------------------------------------------------------------------------
// Bar drawings: the rows above the prompt.

const TRACK_H = 16
const HEAD_SCALE = 0.8
const HEAD_W = SPRITE_W * HEAD_SCALE

// The row's right end, from the bar's end: the percent column, the mascot, the count.
// The percent column is as wide as `100%` and the count column never narrower than `×0`,
// so neither the bar nor the mascot moves as the figures change, or when a plan starts.
// The percent and the count are drawn with tabular numerals, so their columns are sized as
// such: sized as plain text, `×16` had the room of a narrow `1` and lost its last digit, and
// `100%` reached 5px into the gap after the bar.
const progressTail = (count: string): { PCT_W: number; MASCOT_W: number; countW: number; tail: number } => {
  const PCT_W = Math.ceil(tabularWidth('100%', 12.5))
  const MASCOT_W = Math.round(HEAD_W)
  const countW = Math.ceil(Math.max(tabularWidth(count, 12), tabularWidth('×0', 12)))
  return { PCT_W, MASCOT_W, countW, tail: 8 + PCT_W + 6 + MASCOT_W + 4 + countW }
}

// The row with no plan reported (state `none`): a muted dot and `No task yet`, an empty
// track where the bar goes, no pill and no percent, then the resting mascot and a muted
// `×0`, each at the x and height it has in the row with a plan.
const idleProgress = (W: number, settings: Settings, agentsRunning: number, enterAgeMs: number | undefined): Drawing => {
  const H = BAR_H
  const theme = themeOf(settings)
  const kit = kitOf(enterAgeMs, settings, 'drop')
  const { PCT_W, MASCOT_W, tail } = progressTail('×0')
  const title = fit(NO_TASK_YET, 13, Math.min(Math.max(60, W * 0.4), W - 16 - 12 - 60 - tail))
  const BAR_X = Math.round(16 + (title ? textWidth(title, 13) + 12 : 0))
  const BAR_W = Math.max(60, W - BAR_X - tail)
  const mascotX = BAR_X + BAR_W + 8 + PCT_W + 6
  const countX = mascotX + MASCOT_W + 4
  const rules = `
.m{fill:#8a8a8a}.k{fill:#e4e4e2}
@media (prefers-color-scheme: dark){.m{fill:#9a9a9a}.k{fill:#2c2c2c}}
`
  const n = Math.max(0, Math.round(fin(agentsRunning)))
  const body = `<circle class="m" cx="5" cy="${H / 2}" r="4"/>
${text(16, H / 2 + 4.5, title, { cls: 'm', size: 13, weight: 500 })}
<rect class="k" x="${BAR_X}" y="${(H - TRACK_H) / 2}" width="${BAR_W}" height="${TRACK_H}" rx="${TRACK_H / 2}"/>
${mascot(theme, 'main', progressPose(theme, 'none'), mascotX, (H - SPRITE_H * HEAD_SCALE) / 2, HEAD_SCALE)}${text(countX, H / 2 + 4.5, '×0', { cls: 'm', size: 12, num: true })}`
  return doc(W, H, body, `${NO_TASK_YET}; ${n ? `${n} agent${n === 1 ? '' : 's'}` : 'no agents'} running`, { theme, rules, kit })
}

/**
 * savvy-progress's flow row: title, the dithered bar with its pill and ticks, percent,
 * then the mascot and the crew count right after it, in savvy-progress's own colours
 * whatever the palette, as the task state says (see `trackLook`):
 * - `none` (or no flow): the idle row, `No task yet`.
 * - `running`: the flow accent, twinkling, the pill and the percent; the faint layer
 *   reaches `min(total, done + agentsRunning) / total`, never from `flow.running`.
 * - `paused`: the same row in neutral grey, still, no faint layer, `Paused · 1/3`.
 * - `done`: the done colour, `Done`, `100%`, the slow twinkle.
 * The mascot: the crab works while running, is done when done; the cat rides its broom
 * in both; both rest otherwise. `crew` is the `×N` count after the mascot.
 * `creep`: short of done, the fill moves from `start` to `target` over a second (the
 * percent says `start`), instead of standing at `done / total`. `clock` sets the loops
 * (the twinkle, the mascot) so a redraw does not start them over; only while running,
 * when the row changes every tick anyway: idle, paused and done rows hold still.
 */
export function progressDrawing(
  f: Flow | null,
  W_: number,
  settings: Settings,
  state: TaskState,
  crew: number,
  agentsRunning: number,
  enterAgeMs?: number,
  creep?: Creep,
  clock?: number,
): Drawing {
  const W = widthOf(W_)
  const flow = flowSafe(f)
  const st = stateOf(state, flow)
  if (flow === null || st === 'none') return idleProgress(W, settings, agentsRunning, enterAgeMs)
  const H = BAR_H
  const theme = themeOf(settings)
  const kit = kitOf(enterAgeMs, settings, 'drop')
  const moving = creep && st !== 'done' ? { start: clamp(fin(creep.start), 0, 1), target: clamp(fin(creep.target), 0, 1), delayMs: fin(creep.delayMs) } : null
  const look = trackLook(flow, st, agentsRunning, moving ? Math.max(moving.start, moving.target) : undefined)
  const percent = moving ? pct(moving.start * 100) : look.percent
  const n = Math.max(0, Math.round(fin(crew)))
  const count = n ? `×${n}` : ''
  const { PCT_W, MASCOT_W, tail } = progressTail(count)
  // The title takes what it needs, up to 40% of the row, and never squeezes the bar under 60px.
  const title = fit(flow.title, 13, Math.min(Math.max(60, W * 0.4), W - 16 - 12 - 60 - tail))
  const BAR_X = Math.round(16 + (title ? textWidth(title, 13) + 12 : 0))
  const BAR_W = Math.max(60, W - BAR_X - tail)
  const pctEnd = BAR_X + BAR_W + 8 + PCT_W
  const mascotX = pctEnd + 6
  const countX = mascotX + MASCOT_W + 4
  const y0 = (H - TRACK_H) / 2
  const track = ditherTrack({
    w: BAR_W,
    h: TRACK_H,
    ratio: look.ratio,
    runningRatio: look.runningRatio,
    total: flow.total,
    color: look.color,
    twinkle: look.twinkle,
    finished: look.finished,
    idKey: 'flow',
    grow: kit.grow,
    pill: { labels: look.labels, size: 11 },
    creep: moving ? { from: moving.start, delayMs: moving.delayMs } : undefined,
  })
  const rules = `
.t{fill:#1f1f1f}.m{fill:#8a8a8a}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}}
${track.rules}`
  const body = `<circle cx="5" cy="${H / 2}" r="4" fill="${look.color}"/>
${text(16, H / 2 + 4.5, title, { cls: 't', size: 13, weight: 500 })}
<g transform="translate(${BAR_X},${y0})">
${track.body}
</g>
${text(pctEnd, H / 2 + 4.5, percent, { cls: 'm', size: 12.5, num: true, anchor: 'end' })}
${mascot(theme, 'main', progressPose(theme, st), mascotX, (H - SPRITE_H * HEAD_SCALE) / 2, HEAD_SCALE)}${count ? text(countX, H / 2 + 4.5, count, { cls: 'm', size: 12, num: true }) : ''}`
  return doc(W, H, body, `${flow.title || 'Flow'}: ${look.label}, ${percent}${n ? `, ${n} agent${n === 1 ? '' : 's'} running` : ''}`, { theme, rules, kit, clock: st === 'running' ? clock : undefined })
}

// The collapsed row's word for the plan: `No task yet`, `Tasks 1/3` (the flow's label),
// `Paused 1/3` or `Done`; a run's `Agents 2/3` in every state.
const collapsedLabel = (flow: Flow | null, state: TaskState, agentsRunning: number): string => {
  if (!flow || state === 'none') return NO_TASK_YET
  if (flow.unit) return flowLabel(flow)
  if (state === 'done') return 'Done'
  if (state === 'paused') return flow.total ? `Paused ${flow.done}/${flow.total}` : 'Paused'
  return flowLabel({ ...flow, isFinished: false, running: Math.max(0, Math.round(fin(agentsRunning))) })
}

// One line when the bar is collapsed: the mascot's head and a muted summary, the plan
// first, as its task state says.
export function collapsedDrawing(o: {
  W: number
  now: number
  flow: Flow | null
  state: TaskState
  usage: Usage
  main: MainRun
  settings: Settings
  agentsRunning: number
  enterAgeMs?: number
}): Drawing {
  const W = widthOf(o?.W)
  const H = 20
  const theme = themeOf(o?.settings)
  const kit = kitOf(o?.enterAgeMs, o?.settings)
  const now = fin(o?.now)
  const n = Math.max(0, Math.round(fin(o?.agentsRunning)))
  const ctx = ctxGauge(o?.usage)
  // Usage left: the 5-hour window, else the week, else a model's week, by its short name.
  const left = usageLeftGauge(limitsOf(o?.usage, now))
  const flow = flowSafe(o?.flow)
  const parts = [
    collapsedLabel(flow, stateOf(o?.state, flow), n),
    n ? `${n} agent${n === 1 ? '' : 's'}` : '',
    ctx ? `ctx ${pct(ctx.used)}` : '',
    left ? `${gaugeTiny(left)} ${left.isResetting ? RESETTING : `${pct(left.left)} left`}` : '',
  ].filter(Boolean)
  const status = o?.main?.status
  const pose: Pose = status === 'working' ? 'work' : status === 'waiting' ? 'wait' : 'rest'
  const line = parts.join(' · ')
  const x = HEAD_W + 8
  // The head sits in the row; the clip keeps hats and marks from spilling over its edges.
  const body = `<defs><clipPath id="hd"><rect width="${r(HEAD_W)}" height="${H}"/></clipPath></defs><g clip-path="url(#hd)">${mascot(theme, 'main', pose, 0, -2.5, HEAD_SCALE)}</g>${text(x, 14, fit(line, 12, W - x), { cls: 's', size: 12, num: true })}`
  return doc(W, H, body, `Claude ${status ?? 'resting'}${parts.length ? ': ' + parts.join(', ') : ''}`, { theme, kit })
}

// ---------------------------------------------------------------------------
// Hover cards: the text of the card over each of the bar's pills (and nowhere else).

/** What a bar pill's hover card describes: `limit` covers every rate-limit pill. */
export type TipTarget = 'context' | 'limit' | 'cache' | 'speed' | 'turn' | 'clock'
/**
 * What `tipLines` reads; `gauge` is the pill's own gauge (context or a limit). `isUsageLeft`:
 * the pill is the bar's Usage left item, so its card is titled `Usage left · <window>`.
 */
export type TipData = { gauge?: Gauge; usage?: Usage; main?: MainRun; settings: Settings; rates: Rates; now: number; tzOffsetMin?: number; isUsageLeft?: boolean }

const TIP_MAX = 63
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
// 1970-01-01 was a Thursday.
const WEEKDAYS = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'] as const

// `Sat 15:05`: the local weekday and time of `at`.
const dayTime = (at: number, tz: number): string => {
  const day = WEEKDAYS[(((Math.floor((at + tz * 60_000) / DAY_MS) % 7) + 7) % 7)] ?? ''
  return `${day} ${fmtClock(at, tz).slice(0, 5)}`
}

// How long a limit's window is: 5 hours, or 7 days for every weekly kind; null for any other.
const windowMs = (kind: string): number | null =>
  kind === 'five_hour' ? 5 * HOUR_MS : kind === 'seven_day' || kind.startsWith('seven_day_') ? 7 * DAY_MS : null

const LIMIT_TITLE: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', spend_limit: 'Spend limit' }
// The window a Usage left card names after its title: `Usage left · Weekly · Fable`.
const WINDOW_NAME: Record<string, string> = { five_hour: '5-hour window', seven_day: 'Weekly' }
const windowName = (g: Gauge): string => WINDOW_NAME[g.kind] ?? (g.label.startsWith('Week · ') ? `Weekly · ${g.label.slice(7)}` : g.label)

const tipOut = (title: string, lines: string[]): { title: string; lines: string[] } => ({
  title: clip(printable(title), TIP_MAX) || 'Usage',
  lines: lines.map(s => clip(printable(s), TIP_MAX)).filter(Boolean).slice(0, 4),
})

/**
 * The hover card over one of the bar's pills: a short title and a few lines of real
 * figures, each under 64 characters. `limit`: what is left, when it resets and the pace
 * (percent used minus percent of the window gone; left out when the reset time is
 * unknown); `context`: tokens used of the window and what is left; `cache`: when the
 * prompt cache expires and what a cold one costs; `speed`, `turn`, `clock`: one line each.
 */
export function tipLines(target: TipTarget, data: TipData): { title: string; lines: string[] } {
  const now = fin(data?.now)
  const tz = fin(data?.tzOffsetMin)
  const usage = data?.usage
  const main = data?.main
  const priced = { settings: data?.settings, rates: data?.rates }
  switch (target) {
    case 'limit': {
      if (!data?.gauge) return tipOut(data?.isUsageLeft === true ? 'Usage left' : 'Usage limit', ['No figures yet'])
      const g = gaugeSafe(data.gauge)
      const title =
        data.isUsageLeft === true
          ? `Usage left · ${windowName(g)}`
          : (LIMIT_TITLE[g.kind] ?? (g.label.startsWith('Week · ') ? `Weekly limit · ${g.label.slice(7)}` : g.label))
      if (g.isResetting) return tipOut(title, ['The window has just reset', 'No fresh figure yet'])
      const lines = [`${pct(g.left)} left · ${pct(g.used)} used`]
      if (g.resetIn === null) lines.push('Reset time not known')
      else {
        const resetIn = Math.max(0, g.resetIn)
        lines.push(`Resets ${dayTime(now + resetIn, tz)} (in ${fmtSpan(resetIn)})`)
        const span = windowMs(g.kind)
        if (span !== null) {
          const gone = clamp(((span - resetIn) / span) * 100, 0, 100)
          const pace = Math.round(g.used - gone)
          lines.push(pace === 0 ? 'Pace: even with the time gone' : `Pace: ${Math.abs(pace)} points ${pace > 0 ? 'more' : 'less'} used than time gone`)
        }
      }
      return tipOut(title, lines)
    }
    case 'context': {
      const g = gaugeSafe(data?.gauge ?? ctxGauge(usage) ?? { kind: 'context', label: 'Context', used: 0, left: 100, resetIn: null, tone: 'calm' })
      const tokens = Number.isFinite(usage?.contextTokens as number) ? fin(usage?.contextTokens) : fin(main?.contextTokens, NaN)
      const window = fin(usage?.contextWindow) > 0 ? fin(usage?.contextWindow) : fin(main?.contextMax)
      const lines = Number.isFinite(tokens) && window > 0 ? [`${fmtTokens(tokens)} of ${fmtTokens(window)} tokens used`] : [`${pct(g.used)} of the window used`]
      lines.push(`${pct(g.left)} of the window left`)
      return tipOut('Context', lines)
    }
    case 'cache': {
      const at = usage?.cacheExpiresAt
      const lines: string[] = []
      if (!Number.isFinite(at as number)) lines.push('No cache yet: the next reply writes it')
      else if ((at as number) > now) lines.push(`Expires at ${fmtClock(at as number, tz).slice(0, 5)} (in ${fmtSpan((at as number) - now)})`)
      else lines.push(`Expired ${fmtSpan(now - (at as number))} ago`)
      const tokens = Number.isFinite(usage?.contextTokens as number) ? fin(usage?.contextTokens) : fin(main?.contextTokens)
      const model = str(main?.model)
      if (tokens > 0) {
        lines.push(`Cold: writing ${fmtTokens(tokens)} tokens again costs ${cost(costOf(model, { cache_creation_input_tokens: tokens }, true), priced, false)}`)
        lines.push(`Warm: reading them costs ${cost(costOf(model, { cache_read_input_tokens: tokens }, true), priced, false)}`)
      } else lines.push('A cold cache writes the whole prompt again, at a higher price')
      return tipOut('Prompt cache', lines)
    }
    case 'speed': {
      const speed = fin(usage?.speed)
      return tipOut('Speed', [speed > 0 ? `${Math.round(speed)} output tokens a second in the last reply` : 'No reply timed yet'])
    }
    case 'turn': {
      const turns = Math.max(0, Math.round(fin(main?.turns)))
      return tipOut('Turn', [turns > 0 ? `Turn ${turns} of this session` : 'No turn yet in this session'])
    }
    case 'clock': {
      const start = usage?.sessionStartedAt
      return tipOut('Session time', [
        Number.isFinite(start as number) ? `${fmtTime(now - (start as number))} since it started at ${fmtClock(start as number, tz).slice(0, 5)}` : 'Session start not known',
      ])
    }
    default:
      return tipOut('Usage', [])
  }
}

/** The bar's pills that `pillText` words; `limit` covers every rate-limit pill. */
export type PillItem = 'context' | 'limit' | 'speed' | 'cache' | 'turn' | 'time'
/** A pill's tone: the gauge tones, and `muted` for a pill with no figure to show yet. */
export type PillTone = 'calm' | 'warn' | 'alert' | 'muted'
/** What one pill says: a label before its meter (`Context`, `5h`; '' for none), the value, a dim detail ('' for none) and its tone. */
export type PillText = { label: string; value: string; detail: string; tone: PillTone }
/**
 * What `pillText` reads. `gauge`: the pill's own gauge (a limit's, required for `limit`;
 * for `context`, else read from `usage`). `isWorking`: the main agent or any agent is
 * working. `isNarrow`: the bar is narrow, details shorten.
 */
export type PillData = { gauge?: Gauge; usage?: Usage; main?: MainRun; isWorking?: boolean; now: number; isNarrow?: boolean }

/** The cache countdown turns amber at 18 minutes left or less, red at 6 or less. */
export const CACHE_WARN_MS = 18 * 60_000
export const CACHE_ALERT_MS = 6 * 60_000

const pillOut = (label: string, value: string, detail: string, tone: PillTone): PillText => ({ label: str(label), value: str(value), detail: str(detail), tone })

/**
 * The words and tone of one of the bar's pills, every edge included, so the wiring holds
 * no display rules; null when the pill is not shown.
 * - `context`: `Context`, `52%`, `517k / 1M`; tone by what is left of the window.
 * - `limit`: `5h`, `40% left`, `resets in 3h 05m` (`3h 05m` when narrow), tone by what is
 *   left; at 0 left `limit reached` (alert) with the same detail; a window that reset with
 *   no fresh figure `resetting…` (muted, no detail). Null without a gauge.
 * - `speed`: `84 tok/s`; `— tok/s` (muted) until a reading exists.
 * - `cache`: `—` (muted) before the session's first response; `…` while anything works;
 *   `mm:ss` counting down, warn at 18 minutes or less, alert at 6 or less; `expired`
 *   (alert) at zero, until the next response.
 * - `turn`: `#12`; null before the first turn.
 * - `time`: the session time, always.
 */
export function pillText(item: PillItem, data: PillData): PillText | null {
  const now = fin(data?.now)
  const usage = data?.usage
  switch (item) {
    case 'context': {
      const raw = data?.gauge ?? (usage && typeof usage === 'object' ? contextGauge(usage) : null)
      if (!raw) return null
      const g = gaugeSafe({ ...raw, kind: 'context' })
      const known = Number.isFinite(usage?.contextTokens as number) && fin(usage?.contextWindow) > 0
      return pillOut('Context', pct(g.used), known ? `${fmtTokens(fin(usage?.contextTokens))} / ${fmtTokens(fin(usage?.contextWindow))}` : '', g.tone)
    }
    case 'limit': {
      if (!data?.gauge) return null
      const g = gaugeSafe(data.gauge)
      if (g.isResetting) return pillOut(g.label, RESETTING, '', 'muted')
      const detail = g.resetIn === null ? '' : data.isNarrow === true ? fmtSpan(g.resetIn) : `resets in ${fmtSpan(g.resetIn)}`
      if (Math.round(g.left) <= 0) return pillOut(g.label, 'limit reached', detail, 'alert')
      return pillOut(g.label, `${pct(g.left)} left`, detail, g.tone)
    }
    case 'speed': {
      const speed = usage?.speed
      if (!Number.isFinite(speed as number) || (speed as number) < 0) return pillOut('', '— tok/s', '', 'muted')
      return pillOut('', `${Math.round(speed as number)} tok/s`, '', 'calm')
    }
    case 'cache': {
      const at = usage?.cacheExpiresAt
      if (!Number.isFinite(at as number)) return pillOut('', '—', '', 'muted')
      if (data?.isWorking === true) return pillOut('', '…', '', 'calm')
      const left = (at as number) - now
      if (left <= 0) return pillOut('', 'expired', '', 'alert')
      const sec = Math.ceil(left / 1000)
      const value = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
      return pillOut('', value, '', sec * 1000 <= CACHE_ALERT_MS ? 'alert' : sec * 1000 <= CACHE_WARN_MS ? 'warn' : 'calm')
    }
    case 'turn': {
      const turns = Math.round(fin(data?.main?.turns))
      return turns > 0 ? pillOut('', `#${turns}`, '', 'calm') : null
    }
    case 'time': {
      const start = usage?.sessionStartedAt
      return pillOut('', fmtTime(Number.isFinite(start as number) ? now - (start as number) : 0), '', 'calm')
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Pill parts: the bar's info row is native pills holding these small drawings.

const METER_W = 68
const METER_BAR_H = 8
// The pill's ring: 13px across, centred in a drawing 2px taller above and below, so it
// never touches the pill's border; its stroke scaled from the 16px ring's 2.6.
const RING_D = 13
const RING_CLEAR = 2
const RING_H = RING_D + RING_CLEAR * 2
const RING_SW = 2.2

// A small drawing at `scale`: the size grows and the content is scaled to match.
const scaled = (w0: number, h0: number, scale: unknown, body: string, alt: string): Drawing => {
  const k = clamp(fin(scale, 1), 0.25, 8)
  const w = Math.max(1, Math.round(w0 * k))
  const h = Math.max(1, Math.round(h0 * k))
  return doc(w, h, `<g transform="scale(${r(w / w0)},${r(h / h0)})">${body}</g>`, alt, { rules: '' })
}

/**
 * The pill's small meter: a 68x8 bar, or a 13px ring in a drawing 17px tall (13 wide);
 * limits fill what is left, context what is used. A resetting window is an empty meter.
 */
export function meterDrawing(g: Gauge, settings: Settings, kind: 'bar' | 'ring', scale?: number): Drawing {
  const gauge = gaugeSafe(g)
  const resetting = gauge.isResetting === true
  const color = resetting ? MUTED : toneOf(paletteOf(settings), gauge.tone)
  const frac = resetting ? 0 : gaugeFrac(gauge)
  const figure = resetting ? RESETTING : isLimit(gauge) ? `${pct(gauge.left)} left` : `${pct(gauge.used)} used`
  const alt = `${gauge.label} ${figure}`
  if (kind === 'ring') return scaled(RING_D, RING_H, scale, ring(RING_D / 2, RING_H / 2, RING_D, RING_SW, frac, color, NO_KIT.sweep, true), alt)
  return scaled(METER_W, METER_BAR_H, scale, bar(0, 0, METER_W, METER_BAR_H, frac, color, NO_KIT.grow, { soft: true }), alt)
}

export type PillIcon = 'fiveHour' | 'week' | 'speed' | 'cache' | 'time'

const PILL_ICON = 14
// Line icons on a 24-unit grid, in the pill's colour.
const PILL_GLYPHS: Record<PillIcon, (c: string) => string> = {
  // A dial with its filled half: what the five-hour window has used.
  fiveHour: c =>
    `<g fill="none" stroke="${c}" stroke-linecap="round" stroke-width="2.2"><path d="M4 17.5a8 8 0 1 1 16 0" stroke-opacity=".35"/><path d="M4 17.5a8 8 0 0 1 8-8"/></g><circle cx="12" cy="17.5" r="1.8" fill="${c}"/><path d="M12 17.5l3.6-4.2" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  week: c =>
    `<g fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/></g><g fill="${c}"><circle cx="8.5" cy="14" r="1.2"/><circle cx="12" cy="14" r="1.2"/><circle cx="15.5" cy="14" r="1.2"/><circle cx="8.5" cy="17.3" r="1.2"/></g>`,
  // A speedometer: ticks round a dial and the needle well over to the right.
  speed: c =>
    `<g fill="none" stroke="${c}" stroke-linecap="round" stroke-width="2"><path d="M5 18a8.5 8.5 0 1 1 14 0"/><path d="M12 6.8v1.6M6.3 9.3l1.1 1.1M17.7 9.3l-1.1 1.1M4.3 14.5h1.5M18.2 14.5h1.5"/><path d="M12 15l4.4-3.4" stroke-width="2.2"/></g><circle cx="12" cy="15" r="1.7" fill="${c}"/>`,
  cache: c =>
    `<g fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h11M6.5 21h11M7.8 3c0 4.6 8.4 5.2 8.4 9s-8.4 4.4-8.4 9M16.2 3c0 4.6-8.4 5.2-8.4 9s8.4 4.4 8.4 9"/></g><path d="M9.6 19.4c.6-1.6 4.2-1.6 4.8 0z" fill="${c}"/>`,
  time: c => `<circle cx="12" cy="12" r="8.6" fill="none" stroke="${c}" stroke-width="2"/><path d="M12 7.2V12l3.4 2.1" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
}
const PILL_ALT: Record<PillIcon, string> = { fiveHour: 'Five-hour window', week: 'Weekly window', speed: 'Speed', cache: 'Prompt cache', time: 'Session time' }

/** A 14px line icon for a pill, in `color`. */
export function pillIconDrawing(icon: PillIcon, color: string, scale?: number): Drawing {
  const key: PillIcon = Object.hasOwn(PILL_GLYPHS, icon) ? icon : 'time'
  return scaled(PILL_ICON, PILL_ICON, scale, `<g transform="scale(${r(PILL_ICON / 24)})">${PILL_GLYPHS[key](colorOf(color, paletteOf(DEFAULT_SETTINGS).accent))}</g>`, PILL_ALT[key])
}

// `#d64545` at `a` -> `rgba(214,69,69,0.45)`.
const rgba = (hex: string, a: number): string => {
  const h = colorOf(hex, '#7f7f7f').slice(1)
  const full = h.length === 3 ? [...h].map(ch => ch + ch).join('') : h
  const [R, G, B] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  return `rgba(${R},${G},${B},${a})`
}

const PILL_KINDS: readonly PillKind[] = ['context', 'limit', 'speed', 'cache', 'turn', 'time']
// Translucent, so one pair reads on light and dark backgrounds alike: a soft fill and a matching, stronger outline.
const TINT_BORDER = 0.5
const TINT_BACK = 0.12

/**
 * A pill's outline and fill, in the palette colour `pillColor` picks for it: meters by
 * their tone (calm included), `cache` by the tone its caller gives, `speed`, `turn` and
 * `time` by the accent. An unknown kind, or the `muted` tone of a pill with no figure yet
 * (`pillText`), gets a neutral grey pair.
 */
export function pillTint(kind: PillKind, tone: PillTone | undefined, settings: Settings): { border: string; back: string } {
  if (!PILL_KINDS.includes(kind) || tone === 'muted') return { border: 'rgba(127,127,127,0.4)', back: 'rgba(127,127,127,0.1)' }
  const t = tone === 'warn' || tone === 'alert' ? tone : 'calm'
  const color = pillColor(kind, t, settings)
  return { border: rgba(color, TINT_BORDER), back: rgba(color, TINT_BACK) }
}

// ---------------------------------------------------------------------------
// Icon controls.

export type IconName = 'collapse' | 'expand' | 'panel' | 'panelOpen' | 'log' | 'logOpen' | 'copy' | 'compact' | 'full' | 'fold' | 'unfold' | 'gear' | 'help' | 'prev' | 'next'

// Glyphs on a 22-unit grid, drawn alone: no outline round them.
const GLYPHS: Record<IconName, string> = {
  // The bar folding down onto its line, and rising off it.
  collapse: '<path d="M7.5 7.5l3.5 3.5 3.5-3.5M7 15h8"/>',
  expand: '<path d="M7.5 11l3.5-3.5 3.5 3.5M7 15h8"/>',
  panel: '<rect x="5" y="6" width="12" height="10" rx="1.5"/><path d="M12.5 6v10"/>',
  panelOpen: '<rect x="5" y="6" width="12" height="10" rx="1.5"/><path d="M12.5 6v10"/><rect class="icf" stroke="none" x="12.5" y="6.8" width="3.7" height="8.4" rx=".7"/>',
  log: '<path d="M6.5 7.5h9M6.5 11h9M6.5 14.5h6"/>',
  logOpen: '<path d="M5.5 7.5h7M5.5 11h7M5.5 14.5h5"/><path d="M14.5 10.2l1.9 1.9 1.9-1.9"/>',
  copy: '<rect x="8.5" y="8.5" width="8" height="8.5" rx="1.5"/><path d="M13.5 8.5V6.5a1.5 1.5 0 0 0-1.5-1.5H7a1.5 1.5 0 0 0-1.5 1.5v5.5A1.5 1.5 0 0 0 7 13.5h1.5"/>',
  // Four corners pointing in (to compact) and out (back to full rows).
  compact: '<path d="M9 5.5V9H5.5M13 5.5V9h3.5M16.5 13H13v3.5M5.5 13H9v3.5"/>',
  full: '<path d="M5.5 9V5.5H9M13 5.5h3.5V9M16.5 13v3.5H13M9 16.5H5.5V13"/>',
  fold: '<path d="M6.5 13.2l4.5-4.5 4.5 4.5"/>',
  unfold: '<path d="M6.5 8.8l4.5 4.5 4.5-4.5"/>',
  // An eight-toothed cog round a hole: the settings pane.
  gear: '<path d="M10.15 4.66L11.85 4.66L12.23 6.36L13.41 6.85L14.88 5.91L16.09 7.12L15.15 8.59L15.64 9.77L17.34 10.15L17.34 11.85L15.64 12.23L15.15 13.41L16.09 14.88L14.88 16.09L13.41 15.15L12.23 15.64L11.85 17.34L10.15 17.34L9.77 15.64L8.59 15.15L7.12 16.09L5.91 14.88L6.85 13.41L6.36 12.23L4.66 11.85L4.66 10.15L6.36 9.77L6.85 8.59L5.91 7.12L7.12 5.91L8.59 6.85L9.77 6.36Z"/><circle cx="11" cy="11" r="2"/>',
  // A question mark: the guide pane.
  help: '<path d="M8.4 8.7a2.6 2.6 0 1 1 3.9 2.25c-.8.46-1.3 1.05-1.3 1.9v.5"/><circle class="icf" stroke="none" cx="11" cy="15.9" r="1"/>',
  // Chevrons pointing back and on: the agents panel's earlier and later rows.
  prev: '<path d="M13.2 6.5l-4.5 4.5 4.5 4.5"/>',
  next: '<path d="M8.8 6.5l4.5 4.5-4.5 4.5"/>',
}

const ICON_ALT: Record<IconName, string> = {
  collapse: 'Collapse the bar',
  expand: 'Expand the bar',
  panel: 'Open the agents panel',
  panelOpen: 'Close the agents panel',
  log: 'Show log',
  logOpen: 'Hide log',
  copy: 'Copy the log',
  compact: 'Compact rows',
  full: 'Full rows',
  fold: 'Hide finished agents',
  unfold: 'Show finished agents',
  gear: 'Crew settings',
  help: 'Crew guide',
  prev: 'Earlier rows',
  next: 'Later rows',
}

// A control icon: muted 1.6px strokes, drawn at `size` px with no outline; `active`
// shades a soft rounded square behind the glyph while what it opens is showing.
export function iconDrawing(name: IconName, size = 22, active = false): Drawing {
  const s = Math.round(clamp(fin(size, 22), 8, 256))
  const key: IconName = Object.hasOwn(GLYPHS, name) ? name : 'panel'
  const k = r(s / 22)
  const fill = active === true ? '<rect class="ica" stroke="none" x="1" y="1" width="20" height="20" rx="6"/>' : ''
  const body = `<g transform="scale(${k})" fill="none" class="ic" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${fill}${GLYPHS[key]}</g>`
  return doc(s, s, body, `${ICON_ALT[key]}${active === true ? ' (on)' : ''}`)
}
