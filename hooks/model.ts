// CPixelCrew: pure logic shared by the drawings and the wiring. No `$`, no
// clock, no I/O: every input, time included, arrives as a parameter.

import type {
  AgentRun,
  BarItem,
  ChartKind,
  Flow,
  Kind,
  Limit,
  LogEntry,
  LogOutcome,
  MainRun,
  ModelFamily,
  PaletteName,
  Phase,
  PlannedTask,
  Rates,
  Retired,
  Run,
  Settings,
  Spent,
  Sizes,
  ThemeName,
  TokenUse,
  Usage,
  View,
} from '../types'

export const PLUGIN = 'CPixelCrew'

// A finite number or nothing: tool input and stored state are not trusted.
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------------------------------------------------------------------------
// Text: drawn strings are sized by estimate, since no surface measures for us.

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

export const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// CJK, fullwidth forms and emoji advance about 1em; sized at 0.56em a Chinese title overlapped what followed it.
export const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏！-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

// Rough advance of system UI text, in em; good enough to size a slot.
export const charEm = (ch: string): number =>
  WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56

export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Advance of a figure drawn with tabular numerals (`num: true`): every digit takes the same
// room, so a `1` is as wide as a `0`, and the times sign is taken at its width in the wider
// system fonts. It errs wide: a figure cut at the edge of its drawing reads wrong.
export const tabularWidth = (s: string, size: number): number =>
  [...s].reduce((w, ch) => w + (/\d/.test(ch) ? 0.6 : ch === '×' ? 0.68 : charEm(ch)) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

// As fitText, but always ends in an ellipsis: the text it is given goes on past this line.
const ellipsized = (s: string, size: number, maxW: number): string => {
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out.trimEnd() + '…'
}

// Wrap segments: a run of narrow characters breaks only at spaces, while each wide
// character (CJK, emoji) may start a line, as CJK text has no spaces to break at.
// `gap` is what joins a segment to the one before it on the same line.
const wrapSegments = (s: string): { text: string; gap: string }[] => {
  const out: { text: string; gap: string }[] = []
  for (const word of s.split(/\s+/).filter(Boolean)) {
    let gap = out.length ? ' ' : ''
    let run = ''
    for (const ch of word) {
      if (!WIDE.test(ch)) {
        run += ch
        continue
      }
      if (run) {
        out.push({ text: run, gap })
        gap = ''
        run = ''
      }
      out.push({ text: ch, gap })
      gap = ''
    }
    if (run) out.push({ text: run, gap })
  }
  return out
}

// Greedy word wrap by estimated width. A segment wider than a whole line is broken
// by characters; past `maxLines` the last line is cut with an ellipsis.
export function wrapText(s: string, size: number, maxW: number, maxLines: number): string[] {
  const segments = wrapSegments(typeof s === 'string' ? s : '')
  if (!segments.length) return []
  const cap = Number.isNaN(maxLines) ? 1 : Math.max(1, Math.floor(typeof maxLines === 'number' ? maxLines : 1))
  const fits = (t: string): boolean => textWidth(t, size) <= maxW
  const lines: string[] = []
  let line = ''
  for (const { text, gap } of segments) {
    if (line && fits(line + gap + text)) {
      line += gap + text
      continue
    }
    if (line) lines.push(line)
    line = ''
    // Every line takes at least one character, so a tiny width still ends.
    for (const ch of text) {
      if (line && !fits(line + ch)) {
        lines.push(line)
        line = ''
      }
      line += ch
    }
  }
  if (line) lines.push(line)
  if (lines.length <= cap) return lines
  const kept = lines.slice(0, cap - 1)
  const rest = lines.slice(cap - 1).join(' ')
  return [...kept, ellipsized(rest, size, maxW)]
}

// Deterministic noise so dithered fills do not shimmer between redraws.
export const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// Loose comparison key, so a planned task matches the run spawned for it.
export const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// The engine refuses a tree holding control, format or line-separator characters;
// labels carry paths, commands and thoughts the model wrote.
export function printable(s: string): string {
  const text = typeof s === 'string' ? s : ''
  return text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Kinds: the kind of work a subagent does picks its costume, its label and its colour.

/** The one table of each kind's label, costume (a sprite key in sprites.ts) and base colour. The twelve base hues are at least 17 degrees apart, so a tint (at most 6) stays nearest its own kind. */
export const KINDS: Readonly<Record<Kind, { label: string; sprite: string; color: string }>> = {
  search: { label: 'Search', sprite: 'scout', color: '#2E9BB8' },
  analyze: { label: 'Analyze', sprite: 'analyst', color: '#B6AC20' },
  build: { label: 'Build', sprite: 'chef', color: '#367FDD' },
  refactor: { label: 'Refactor', sprite: 'engineer', color: '#BB811B' },
  quick: { label: 'Quick', sprite: 'sprinter', color: '#23A97F' },
  debug: { label: 'Debug', sprite: 'detective', color: '#D86931' },
  test: { label: 'Test', sprite: 'tester', color: '#5BA23B' },
  review: { label: 'Review', sprite: 'reviewer', color: '#C0453F' },
  design: { label: 'Design', sprite: 'designer', color: '#D4537E' },
  write: { label: 'Write', sprite: 'writer', color: '#B56BC7' },
  plan: { label: 'Plan', sprite: 'planner', color: '#727BCA' },
  hard: { label: 'Hard', sprite: 'ace', color: '#9774DC' },
  // An `other` agent takes one of OTHER_HUES by its description (`kindColor`); this is the first.
  other: { label: 'Helper', sprite: 'helper', color: '#AAC46E' },
}

/** Every kind, in the table's order. */
export const KIND_KEYS: readonly Kind[] = Object.keys(KINDS) as Kind[]

/** The main agent's look. */
export const MAIN_LOOK = { label: 'Claude', sprite: 'main', color: '#D97757' } as const

/** The six fixed colours an `other` agent takes one of, by a hash of its description. Never grey. */
export const OTHER_HUES: readonly string[] = ['#AAC46E', '#6EC47C', '#C46EB3', '#6EC4BE', '#776EC4', '#C47F6E']

// The kinds of the 1.6 roles (the eleven workers and the planner costume), which a plan or stored state may still name.
const LEGACY_ROLES: Readonly<Record<string, Kind>> = {
  ace: 'hard',
  detective: 'debug',
  engineer: 'refactor',
  chef: 'build',
  sprinter: 'quick',
  scout: 'search',
  designer: 'design',
  writer: 'write',
  tester: 'test',
  reviewer: 'review',
  analyst: 'analyze',
  // The 1.6 planner costume, which `Plan` agents wore.
  planner: 'plan',
}

export const isKind = (v: unknown): v is Kind => typeof v === 'string' && Object.hasOwn(KINDS, v)

/**
 * The kind a name stands for, any case: a kind (`debug`), its label (`Helper`), or one of
 * the 1.6 role names, bare or as `pixel-crew:<role>` (`engineer` -> `refactor`). Undefined
 * for anything else.
 */
export function kindName(v: unknown): Kind | undefined {
  if (typeof v !== 'string') return undefined
  const w = v.trim().toLowerCase()
  if (!w) return undefined
  if (isKind(w)) return w
  const byLabel = KIND_KEYS.find(k => KINDS[k].label.toLowerCase() === w)
  if (byLabel) return byLabel
  const bare = w.replace(/^pixel-crew:/, '')
  return Object.hasOwn(LEGACY_ROLES, bare) ? LEGACY_ROLES[bare] : undefined
}

// The kind a subagent type says, tested in this order on the whole type, any case.
const TYPE_RULES: readonly [Kind, RegExp][] = [
  ['search', /^(?:explore|web-fetch|claude-code-guide)$|scout|research|explor|search/],
  ['plan', /plan|architect/],
  ['review', /review/],
  ['test', /test/],
  ['debug', /debug|detective/],
  ['design', /design/],
  ['write', /writer|doc/],
  ['analyze', /analy/],
]

function typeKind(type: unknown): Kind | undefined {
  const t = typeof type === 'string' ? type.trim().toLowerCase() : ''
  if (!t) return undefined
  const rule = TYPE_RULES.find(([, re]) => re.test(t))
  if (rule) return rule[0]
  const legacy = /^pixel-crew:(.+)$/.exec(t)?.[1]
  return legacy !== undefined && Object.hasOwn(LEGACY_ROLES, legacy) ? LEGACY_ROLES[legacy] : undefined
}

// The words a description is read for, tested in this order. A word matches a keyword
// as it is or with an ending (`fixes`, `planned`, `writing`); a keyword ending in `*` is
// a stem any word may start with; a keyword of two words matches them side by side.
const WORD_RULES: readonly [Kind, readonly string[]][] = [
  ['review', ['review', 'audit']],
  ['test', ['test', 'tests', 'tdd']],
  ['debug', ['fix', 'debug', 'bug', 'investigate', 'root cause']],
  ['search', ['research', 'search', 'find', 'look up', 'fetch', 'read', 'map', 'explore', 'collect']],
  ['design', ['design', 'mock', 'ui', 'layout', 'style']],
  ['write', ['write', 'doc', 'readme', 'changelog', 'copy']],
  ['analyze', ['analy*', 'measure', 'benchmark', 'data', 'log']],
  ['plan', ['plan', 'spec']],
  ['refactor', ['refactor', 'rename', 'restructure', 'clean']],
  ['build', ['build', 'implement', 'add', 'create', 'feature']],
  ['quick', ['run', 'install', 'config', 'boilerplate']],
]

const ENDINGS: readonly string[] = ['s', 'es', 'd', 'ed', 'ing', 'er', 'ers']

// `word` is `key`, or `key` with an ending, its last letter doubled or its final `e`
// dropped first where English does: `bugs`, `fixed`, `mapping`, `created`, `writing`.
const wordIs = (word: string, key: string): boolean => {
  if (key.endsWith('*')) return word.startsWith(key.slice(0, -1))
  if (word === key) return true
  const stems = [key, key + key.slice(-1), ...(key.endsWith('e') ? [key.slice(0, -1)] : [])]
  return stems.some(stem => word.length > stem.length && word.startsWith(stem) && ENDINGS.includes(word.slice(stem.length)))
}

function wordKind(description: unknown): Kind | undefined {
  const words = norm(typeof description === 'string' ? description : '').split(' ').filter(Boolean)
  if (!words.length) return undefined
  const has = (key: string): boolean => {
    const parts = key.split(' ')
    return words.some((_, i) => parts.every((p, j) => i + j < words.length && wordIs(words[i + j] as string, p)))
  }
  return WORD_RULES.find(([, keys]) => keys.some(has))?.[0]
}

/**
 * A subagent's kind, first match wins: a planned task its description matches (as
 * `plannedOf` matches) that carries a kind, then one whose 1.6 `agent` names a role; its
 * subagent type; keywords in its description; else `other`.
 */
export function kindOf(type: unknown, description: unknown, tasks: readonly unknown[] = []): Kind {
  const key = norm(typeof description === 'string' ? description : '')
  const mine = key
    ? (Array.isArray(tasks) ? tasks : []).filter((t): t is Record<string, unknown> => isRecord(t) && typeof t.title === 'string' && norm(t.title) === key)
    : []
  const planned = mine.map(t => kindName(t.kind)).find(k => k !== undefined) ?? mine.map(t => kindName(t.agent)).find(k => k !== undefined)
  return planned ?? typeKind(type) ?? wordKind(description) ?? 'other'
}

/** A planned task's kind: the one the plan gave it (or its 1.6 `agent`), else what its title says, else `other`. */
export function taskKind(t: { title?: unknown; kind?: unknown; agent?: unknown }): Kind {
  return kindName(t?.kind) ?? kindName(t?.agent) ?? wordKind(t?.title) ?? 'other'
}

// A run's kind as stored; for a run 1.6 wrote (a `role`, no `kind`) its role's kind, else
// what its type and description say.
const runKind = (a: { kind?: unknown; role?: unknown; type?: unknown; description?: unknown }): Kind => {
  if (isKind(a?.kind)) return a.kind
  const role = typeof a?.role === 'string' ? a.role.trim().toLowerCase() : ''
  return (Object.hasOwn(LEGACY_ROLES, role) ? LEGACY_ROLES[role] : undefined) ?? kindOf(a?.type, a?.description)
}

const tintNum = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0)

/** A run as 2.0 keeps it: one 1.6 wrote gets its kind from its role and tint 0, and loses the role. */
export function normalizeAgent(a: AgentRun): AgentRun {
  const kind = runKind(a)
  const tint = tintNum(a?.tint)
  if (a?.kind === kind && a.tint === tint && !Object.hasOwn(a, 'role')) return a
  const out: Record<string, unknown> = { ...a, kind, tint }
  delete out.role
  return out as AgentRun
}

// FNV-1a over the UTF-16 code units: the same text always picks the same colour.
const hashOf = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/** A kind's base colour; an `other` agent's is one of OTHER_HUES, picked by `text` (its description). */
export function kindColor(kind: Kind, text: string): string {
  if (kind !== 'other' && isKind(kind)) return KINDS[kind].color
  return OTHER_HUES[hashOf(typeof text === 'string' ? text : '') % OTHER_HUES.length] ?? KINDS.other.color
}

// What each tint shifts, by `tint % 6`: hue in degrees and lightness in percentage points
// (HSL). Same-kind agents differ mainly in lightness, so they stay clear of other kinds.
const HUE_SHIFT: readonly number[] = [0, 6, -6, 3, -3, 0]
const LIGHT_SHIFT: readonly number[] = [0, 10, -7, 16, 5, -4]
// Where a shifted colour's lightness is kept, 0 to 1.
const LIGHT_MIN = 0.38
const LIGHT_MAX = 0.72

/**
 * `hex` (`#RRGGBB`) with its hue and lightness shifted for `tint`, the agent's place among
 * those of its kind, its lightness then kept between 38% and 72%. Tint 0 (and 6, 12, …) is
 * `hex` itself. A junk tint reads as 0; a colour that is not six hex digits comes back as given.
 */
export function shiftColor(hex: string, tint: number): string {
  const i = tintNum(tint) % HUE_SHIFT.length
  const dh = HUE_SHIFT[i] ?? 0
  const dl = LIGHT_SHIFT[i] ?? 0
  const m = typeof hex === 'string' ? /^#([0-9a-f]{6})$/i.exec(hex.trim()) : null
  if (!m || (dh === 0 && dl === 0)) return hex
  const v = parseInt(m[1] as string, 16)
  const r = ((v >> 16) & 255) / 255
  const g = ((v >> 8) & 255) / 255
  const b = (v & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  const H = (((h + dh) % 360) + 360) % 360
  const L = clamp(l + dl / 100, LIGHT_MIN, LIGHT_MAX)
  const C = (1 - Math.abs(2 * L - 1)) * s
  const X = C * (1 - Math.abs(((H / 60) % 2) - 1))
  const o = L - C / 2
  const [r1, g1, b1] = H < 60 ? [C, X, 0] : H < 120 ? [X, C, 0] : H < 180 ? [0, C, X] : H < 240 ? [0, X, C] : H < 300 ? [X, 0, C] : [C, 0, X]
  const hx = (c: number): string => Math.round(clamp((c + o) * 255, 0, 255)).toString(16).padStart(2, '0')
  return `#${hx(r1)}${hx(g1)}${hx(b1)}`.toUpperCase()
}

/** An agent's own colour: its kind's base colour shifted by its tint. */
export function agentColor(a: { kind?: unknown; role?: unknown; tint?: unknown; type?: unknown; description?: unknown }): string {
  return shiftColor(kindColor(runKind(a), typeof a?.description === 'string' ? a.description : ''), tintNum(a?.tint))
}

/** An agent's kind: as stored, or for a run 1.6 wrote as `normalizeAgent` reads it. */
export function agentKind(a: { kind?: unknown; role?: unknown; type?: unknown; description?: unknown }): Kind {
  return runKind(a)
}

/** An agent's kind label (`Search`), as its row shows it. */
export function agentLabel(a: { kind?: unknown; role?: unknown; type?: unknown; description?: unknown }): string {
  return KINDS[runKind(a)].label
}

/** A planned task's colour: its kind's base colour (an `other` task's picked by its title). */
export function taskColor(t: { title?: unknown; kind?: unknown; agent?: unknown }): string {
  return kindColor(taskKind(t), typeof t?.title === 'string' ? t.title : '')
}

/**
 * The tint for agent `id` of `kind` as it starts: how many agents of that kind are in its
 * run before it. `run` is the run as read before this agent joins: while it is open, its
 * agents count, and so do active ones started since it began that have not joined yet
 * (agents started side by side); when there is none or it ended, the active agents outside
 * it count, as they start the next run with this one.
 */
export function tintFor(kind: Kind, list: readonly AgentRun[], run: Run | null, id: string): number {
  const rows = (Array.isArray(list) ? list : []).filter(a => isRecord(a) && a.id !== id && runKind(a) === kind)
  const ids = run && Array.isArray(run.ids) ? run.ids : []
  const isOpen = isRecord(run) && run.endedAt === undefined
  const active = (a: AgentRun): boolean => a.status === 'running' || a.status === 'waiting'
  const start = num(run?.startedAt) ?? -Infinity
  return rows.filter(a => (isOpen ? ids.includes(a.id) || (active(a) && (num(a.startedAt) ?? 0) >= start) : active(a) && !ids.includes(a.id))).length
}

/** What a planned row says it runs on: `Opus · high`, `Sonnet 5.5`, `high`, or '' when the plan gave neither. */
export function plannedModel(t: { model?: unknown; effort?: unknown }): string {
  const model = typeof t?.model === 'string' ? printable(t.model) : ''
  const effort = typeof t?.effort === 'string' ? printable(t.effort) : ''
  // `opus` reads `Opus`, `claude-sonnet-5-5` reads `Sonnet 5.5`.
  const name = model ? modelName(model) : ''
  const shown = /^[a-z]/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : name
  return [shown, effort].filter(Boolean).join(' · ')
}

/** The accent of a costume by its sprite key: the main agent's, a kind's base colour, or the first of OTHER_HUES. */
export function spriteColor(key: string): string {
  if (key === MAIN_LOOK.sprite) return MAIN_LOOK.color
  return KIND_KEYS.map(k => KINDS[k]).find(k => k.sprite === key)?.color ?? KINDS.other.color
}

// ---------------------------------------------------------------------------
// Settings: read from the plugin's `userConfig` options and typed by hand in
// `/crew set`, so every path validates.

export const THEMES: readonly ThemeName[] = ['clawd', 'cat']
export const PANEL_USAGES: readonly Settings['panelUsage'][] = ['off', 'bar', 'ring']
export const CHART_KINDS: readonly ChartKind[] = ['bar', 'ring']
export const AUTO_OPENS: readonly Settings['autoOpen'][] = ['any', 'plan', 'never']
export const PALETTE_NAMES: readonly PaletteName[] = ['classic', 'ocean', 'sunset']
export const BAR_COLORS: readonly Settings['barColors'][] = ['kind', 'palette']
export const BACKGROUNDS: readonly Settings['background'][] = ['dots', 'grid', 'plain']

/** The four numbers the Crew settings pane steps; kept in the mod's store, not in the options. */
export const DEFAULT_SIZES: Readonly<Sizes> = { textSize: 100, iconSize: 200, barSize: 100, logLines: 50 }

export const DEFAULT_SETTINGS: Settings = {
  theme: 'cat',
  palette: 'ocean',
  barColors: 'kind',
  background: 'plain',
  currency: 'GBP',
  textSize: DEFAULT_SIZES.textSize,
  iconSize: DEFAULT_SIZES.iconSize,
  barSize: DEFAULT_SIZES.barSize,
  panelUsage: 'bar',
  barUsage: 'ring',
  barItems: ['context', 'fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn', 'time'],
  autoOpen: 'any',
  logLines: DEFAULT_SIZES.logLines,
  animations: true,
  barTooltips: true,
}

// Where each size is clamped: percent for the sizes, entries for `logLines`. Values are whole numbers.
export const SIZE_RANGE = {
  textSize: { min: 70, max: 200 },
  iconSize: { min: 50, max: 250 },
  barSize: { min: 80, max: 160 },
  logLines: { min: 5, max: 200 },
} as const

export type SizeKey = keyof Sizes

/** The four size keys, in the order the Crew settings pane lists them. */
export const SIZE_KEYS: readonly SizeKey[] = ['textSize', 'iconSize', 'barSize', 'logLines']

/** How far one press of a settings stepper moves each size: 10 percent, or 5 log lines. */
export const STEP: Readonly<Record<SizeKey, number>> = { textSize: 10, iconSize: 10, barSize: 10, logLines: 5 }

/** The progress colours of savvy-progress: a running flow and a finished one, whatever the palette. */
export const FLOW_ACCENT = '#8f8cf4'
export const FLOW_DONE = '#5fbf8f'

export type Palette = { label: string; calm: string; warn: string; alert: string; accent: string; done: string }

export const PALETTES: Record<PaletteName, Palette> = {
  classic: { label: 'Classic', calm: '#3fa66b', warn: '#d9962b', alert: '#d64545', accent: '#8f8cf4', done: '#5fbf8f' },
  ocean: { label: 'Ocean', calm: '#2E9BB8', warn: '#E0A030', alert: '#E5484D', accent: '#3B82F6', done: '#22B8A7' },
  sunset: { label: 'Sunset', calm: '#F08A4B', warn: '#E6B422', alert: '#D64545', accent: '#E0567A', done: '#F2A65A' },
}

/** The boolean option that shows or hides one bar item. */
export type BarOption = 'barContext' | 'barFiveHour' | 'barWeek' | 'barModelWeek' | 'barSpeed' | 'barCache' | 'barTurn' | 'barTime'

// Every bar item in its fixed order, which is the order of the pills. `label` names it in
// the settings pane, `name` is its short name in `/crew set barItems`, `option` its boolean.
export const BAR_ITEMS: readonly { key: BarItem; label: string; name: string; option: BarOption }[] = [
  { key: 'context', label: 'Context', name: 'context', option: 'barContext' },
  // Keeps its key, name and option: it shows the 5-hour window, else the week (`usageLeftGauge`).
  { key: 'fiveHour', label: 'Usage left', name: '5h', option: 'barFiveHour' },
  { key: 'week', label: 'Weekly limit', name: 'week', option: 'barWeek' },
  { key: 'model_week', label: 'Model weekly limit', name: 'model', option: 'barModelWeek' },
  { key: 'speed', label: 'Speed', name: 'speed', option: 'barSpeed' },
  { key: 'cache', label: 'Cache countdown', name: 'cache', option: 'barCache' },
  { key: 'turn', label: 'Turn number', name: 'turn', option: 'barTurn' },
  { key: 'time', label: 'Session time', name: 'time', option: 'barTime' },
]

const ITEM_KEYS: readonly BarItem[] = BAR_ITEMS.map(b => b.key)
const BAR_OPTIONS: readonly BarOption[] = BAR_ITEMS.map(b => b.option)

/** The bar's items in their default order, all eight: the order `BAR_ITEMS` lists them in. */
export const DEFAULT_BAR_ORDER: readonly BarItem[] = ITEM_KEYS

/**
 * The person's order of the bar's items (`$.store` key `barOrder`), made whole: every
 * known item once, in the order given (a key or its short name, any case), unknown
 * names and repeats dropped, the missing items appended in the default order. Anything
 * that is not an array reads as the default order.
 */
export function normalizeBarOrder(raw: unknown): BarItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_BAR_ORDER]
  const out: BarItem[] = []
  for (const v of raw) {
    const k = itemOf(v)
    if (k !== undefined && !out.includes(k)) out.push(k)
  }
  for (const k of DEFAULT_BAR_ORDER) if (!out.includes(k)) out.push(k)
  return out
}

/** `item` moved one place later (1) or earlier (-1) in the order; a no-op at an end, for an unknown item or direction. Always a whole order. */
export function moveBarItem(order: readonly BarItem[], item: BarItem, direction: 1 | -1): BarItem[] {
  const out = normalizeBarOrder(order)
  const i = out.indexOf(item)
  const j = i + direction
  if (i < 0 || (direction !== 1 && direction !== -1) || j < 0 || j >= out.length) return out
  const other = out[j] as BarItem
  out[j] = item
  out[i] = other
  return out
}

// Case-insensitive, so `/crew set palette Ocean` works as typed.
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' ? list.find(x => x.toLowerCase() === v.trim().toLowerCase()) : undefined

// The values 1.6 stored under their old names: `role` is `kind`, `crew` is `plan`.
const barColorsOf = (v: unknown): Settings['barColors'] | undefined => pick(BAR_COLORS, v) ?? (pick(['role'], v) ? 'kind' : undefined)
const autoOpenOf = (v: unknown): Settings['autoOpen'] | undefined => pick(AUTO_OPENS, v) ?? (pick(['crew'], v) ? 'plan' : undefined)

const currencyOf = (v: unknown): string | undefined =>
  typeof v === 'string' ? CURRENCIES.find(c => c.code === v.trim().toUpperCase())?.code : undefined

// A plain decimal, as typed or stored as text: no signs, exponents or separators.
const decimalOf = (v: string): number | undefined => (/^(\d+\.?\d*|\.\d+)$/.test(v) ? num(Number(v)) : undefined)

// A number, or its text with an optional percent sign (`120`, `120%`).
const sizeNumOf = (v: unknown): number | undefined =>
  typeof v === 'string' ? decimalOf(v.trim().replace(/\s*%$/, '')) : num(v)

// Clamped to the range and rounded to a whole number.
const inRange = (key: SizeKey, v: number): number => Math.round(clamp(v, SIZE_RANGE[key].min, SIZE_RANGE[key].max))

// A bar item by its short name (`5h`, `model`) or its key (`fiveHour`, `model_week`), any case.
const itemOf = (v: unknown): BarItem | undefined => {
  if (typeof v !== 'string') return undefined
  const w = v.trim().toLowerCase()
  return w ? BAR_ITEMS.find(b => b.name === w || b.key.toLowerCase() === w)?.key : undefined
}

// The known items among `items`, once each, in the fixed order: the order they arrive in does not count.
const uniqueItems = (items: readonly unknown[]): BarItem[] => {
  const named = new Set(items.map(itemOf))
  return ITEM_KEYS.filter(k => named.has(k))
}

const ITEM_SPLIT = /[\s,]+/

// An item list as text (`/crew set barItems`, or the v3 `barItems` option): names separated
// by commas or spaces, any case; unknown names are dropped, `all` is every item, and an
// empty text means none. The result is in the fixed order.
export function barItemsOf(text: string): BarItem[] {
  if (typeof text !== 'string') return []
  if (text.trim().toLowerCase() === 'all') return [...ITEM_KEYS]
  return uniqueItems(text.split(ITEM_SPLIT))
}

const flag = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

const ON = ['on', 'true', 'yes'] as const
const OFF = ['off', 'false', 'no'] as const
const boolOf = (v: string): boolean | undefined => (pick(ON, v) ? true : pick(OFF, v) ? false : undefined)

// An option's boolean, or its text (`true`, `off`).
const optionFlag = (v: unknown, d: boolean): boolean => (typeof v === 'string' ? (boolOf(v) ?? d) : flag(v, d))

// An option's boolean or its text; undefined when it holds neither.
const optionBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : typeof v === 'string' ? boolOf(v) : undefined)

// The items shown, in the fixed order. Each follows its own boolean option when that is
// set; else (a `Settings` object, v3 options or state) whether a `barItems` list, array or
// text, names it; else its default.
const barItemsFrom = (r: Record<string, unknown>): BarItem[] => {
  const old = r.barItems
  const listed = Array.isArray(old) ? uniqueItems(old) : typeof old === 'string' ? barItemsOf(old) : DEFAULT_SETTINGS.barItems
  return BAR_ITEMS.filter(b => optionBool(r[b.option]) ?? listed.includes(b.key)).map(b => b.key)
}

// One item switched on or off; the rest keep their state and the fixed order.
const withItem = (s: Settings, item: BarItem, on: boolean): Settings => ({
  ...s,
  barItems: ITEM_KEYS.filter(k => (k === item ? on : s.barItems.includes(k))),
})

// One size from a number or its text (`120`, `120%`), clamped and rounded; its default otherwise.
const sizeFrom = (r: Record<string, unknown>, key: SizeKey): number => {
  const n = sizeNumOf(r[key])
  return n === undefined ? DEFAULT_SIZES[key] : inRange(key, n)
}

// The one reader of settings: a `Settings` object or the plugin's options object (the
// same keys, with the eight `bar*` booleans for `barItems`), and anything older state,
// v3 options (`barItems` as text) or a typo may hold. Keys v5 removed (`rateSource`,
// `customRate`) are ignored.
export function normalizeSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_SETTINGS
  return {
    theme: pick(THEMES, r.theme) ?? d.theme,
    palette: pick(PALETTE_NAMES, r.palette) ?? d.palette,
    barColors: barColorsOf(r.barColors) ?? d.barColors,
    background: pick(BACKGROUNDS, r.background) ?? d.background,
    currency: currencyOf(r.currency) ?? d.currency,
    textSize: sizeFrom(r, 'textSize'),
    iconSize: sizeFrom(r, 'iconSize'),
    barSize: sizeFrom(r, 'barSize'),
    panelUsage: pick(PANEL_USAGES, r.panelUsage) ?? d.panelUsage,
    barUsage: pick(CHART_KINDS, r.barUsage) ?? d.barUsage,
    barItems: barItemsFrom(r),
    autoOpen: autoOpenOf(r.autoOpen) ?? d.autoOpen,
    logLines: sizeFrom(r, 'logLines'),
    animations: optionFlag(r.animations, d.animations),
    barTooltips: optionFlag(r.barTooltips, d.barTooltips),
  }
}

/** The stored sizes (`$.store` key `sizes`), field by field: clamped to `SIZE_RANGE` and rounded, the default for a missing or junk field. */
export function normalizeSizes(raw: unknown): Sizes {
  const r = isRecord(raw) ? raw : {}
  return { textSize: sizeFrom(r, 'textSize'), iconSize: sizeFrom(r, 'iconSize'), barSize: sizeFrom(r, 'barSize'), logLines: sizeFrom(r, 'logLines') }
}

/** The four sizes a settings object holds. */
export function sizesOf(s: Settings): Sizes {
  return normalizeSizes(s)
}

/**
 * `register(on, options)`'s options, the stored sizes and the stored bar order as
 * settings; total, whatever they hold. Choices and toggles come from `options`; the four
 * numbers come only from `sizes` (a size an old options object still holds is ignored),
 * so with no sizes stored they are `DEFAULT_SIZES`. `barItems` is the items switched on,
 * in the order `order` gives (`normalizeBarOrder`: missing or junk is the default order).
 * The mirror options are never read.
 */
export function settingsFromOptions(options: unknown, sizes?: unknown, order?: unknown): Settings {
  const base = normalizeSettings(options)
  const barItems = normalizeBarOrder(order).filter(k => base.barItems.includes(k))
  return { ...base, ...normalizeSizes(sizes), barItems }
}

// The option keys that are real settings, in the manifest's order.
const SETTING_KEYS: readonly SettingOptionKey[] = [
  'theme',
  'palette',
  'barColors',
  'background',
  'animations',
  'currency',
  'panelUsage',
  'autoOpen',
  'barUsage',
  ...BAR_OPTIONS,
  'barTooltips',
]

// What `/crew set` takes: every setting option, the four sizes, and `barItems` to set the eight booleans at once.
const SET_KEYS: readonly (SettingOptionKey | SizeKey | 'barItems')[] = [...SETTING_KEYS, ...SIZE_KEYS, 'barItems']

// `all`, `none`, or a list naming only known items; anything else is a typo.
const barItemsSet = (v: string): BarItem[] | undefined => {
  const word = v.toLowerCase()
  if (word === 'all') return [...ITEM_KEYS]
  if (word === 'none') return []
  const parts = v.split(ITEM_SPLIT).filter(Boolean)
  if (!parts.length || parts.some(p => !itemOf(p))) return undefined
  return uniqueItems(parts)
}

const rangedOf = (key: SizeKey, v: string): number | undefined => {
  const n = sizeNumOf(v)
  return n === undefined ? undefined : inRange(key, n)
}

// One setting typed as `/crew set <key> <value>`: the settings with it changed, or null
// for an unknown key or a value it does not take. Every setting option is taken, and the
// four sizes (a number, a percent sign allowed, clamped to `SIZE_RANGE`); the mirror
// options are not settings. The eight `bar*` keys and `barItems` change
// `barItems`; the wiring compares before and after (`changedOptions` for the options,
// `sizesOf` for the sizes) to know what to write.
export function setSetting(s: Settings, key: string, value: string): Settings | null {
  const k = pick(SET_KEYS, key)
  const v = typeof value === 'string' ? value.trim() : ''
  const base = normalizeSettings(s)
  const set = <K extends keyof Settings>(field: K, x: Settings[K] | undefined): Settings | null =>
    x === undefined ? null : { ...base, [field]: x }
  const item = BAR_ITEMS.find(b => b.option === k)
  if (item) {
    const on = boolOf(v)
    return on === undefined ? null : withItem(base, item.key, on)
  }
  switch (k) {
    case 'theme':
      return set('theme', pick(THEMES, v))
    case 'palette':
      return set('palette', pick(PALETTE_NAMES, v))
    case 'barColors':
      return set('barColors', barColorsOf(v))
    case 'background':
      return set('background', pick(BACKGROUNDS, v))
    case 'currency':
      return set('currency', currencyOf(v))
    case 'textSize':
    case 'iconSize':
    case 'barSize':
    case 'logLines':
      return set(k, rangedOf(k, v))
    case 'panelUsage':
      return set('panelUsage', pick(PANEL_USAGES, v))
    case 'barUsage':
      return set('barUsage', pick(CHART_KINDS, v))
    case 'barItems':
      return set('barItems', barItemsSet(v))
    case 'autoOpen':
      return set('autoOpen', autoOpenOf(v))
    case 'animations':
      return set('animations', boolOf(v))
    case 'barTooltips':
      return set('barTooltips', boolOf(v))
    default:
      return null
  }
}

// Switches one item off, or on in its place in the fixed order.
export function toggleBarItem(s: Settings, item: BarItem): Settings {
  const base = normalizeSettings(s)
  if (!ITEM_KEYS.includes(item)) return base
  return withItem(base, item, !base.barItems.includes(item))
}

// The bar's items in the order they are shown: the fixed order.
export function shownBarItems(s: Settings): BarItem[] {
  return normalizeSettings(s).barItems
}

/**
 * One press of a settings stepper: `key` moved one `STEP` up (1) or down (-1), clamped to
 * `SIZE_RANGE`. An off-grid value (105) first snaps to the grid in that direction (110 up,
 * 100 down). An unknown key or direction changes nothing.
 */
export function stepSetting(s: Settings, key: SizeKey, direction: 1 | -1): Settings {
  const base = normalizeSettings(s)
  if (typeof key !== 'string' || !Object.hasOwn(SIZE_RANGE, key) || (direction !== 1 && direction !== -1)) return base
  const step = STEP[key]
  const v = base[key]
  const next = direction === 1 ? Math.floor(v / step) * step + step : Math.ceil(v / step) * step - step
  return { ...base, [key]: inRange(key, next) }
}

export function paletteOf(s: Settings): Palette {
  return PALETTES[pick(PALETTE_NAMES, s?.palette) ?? DEFAULT_SETTINGS.palette]
}

// A working agent's bar and dot: the palette's accent, or the agent's own colour.
export function workColor(s: Settings, a: Parameters<typeof agentColor>[0]): string {
  return barColorsOf(s?.barColors) === 'palette' ? paletteOf(s).accent : agentColor(a)
}

/** What a bar pill shows, for its tint: a meter (`context`, `limit`), a figure, or the cache countdown. */
export type PillKind = 'context' | 'limit' | 'speed' | 'cache' | 'turn' | 'time'

/**
 * The palette colour a pill is tinted with. Meters take their tone's colour at every tone,
 * calm included; `cache` takes the tone its caller gives by time left (calm, warn, alert);
 * `speed`, `turn` and `time` take the accent. A missing tone reads as calm.
 */
export function pillColor(kind: PillKind, tone: Gauge['tone'] | undefined, s: Settings): string {
  const pal = paletteOf(s)
  if (kind === 'speed' || kind === 'turn' || kind === 'time') return pal.accent
  return tone === 'alert' ? pal.alert : tone === 'warn' ? pal.warn : pal.calm
}

// ---------------------------------------------------------------------------
// Money: costs are USD and drawn in the person's currency only, through `money`.

export const CURRENCIES: readonly { code: string; symbol: string; name: string; decimals: number }[] = [
  { code: 'USD', symbol: '$', name: 'US dollar', decimals: 2 },
  { code: 'GBP', symbol: '£', name: 'Pound sterling', decimals: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2 },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese yuan', decimals: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese yen', decimals: 0 },
  { code: 'KRW', symbol: '₩', name: 'South Korean won', decimals: 0 },
  { code: 'INR', symbol: '₹', name: 'Indian rupee', decimals: 2 },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian dollar', decimals: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar', decimals: 2 },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand dollar', decimals: 2 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar', decimals: 2 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit', decimals: 2 },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong dollar', decimals: 2 },
  { code: 'TWD', symbol: 'NT$', name: 'New Taiwan dollar', decimals: 2 },
  { code: 'THB', symbol: '฿', name: 'Thai baht', decimals: 2 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian rupiah', decimals: 0 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese dong', decimals: 0 },
  { code: 'PHP', symbol: '₱', name: 'Philippine peso', decimals: 2 },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss franc', decimals: 2 },
  { code: 'SEK', symbol: 'SEK ', name: 'Swedish krona', decimals: 2 },
  { code: 'NOK', symbol: 'NOK ', name: 'Norwegian krone', decimals: 2 },
  { code: 'DKK', symbol: 'DKK ', name: 'Danish krone', decimals: 2 },
  { code: 'PLN', symbol: 'zł ', name: 'Polish złoty', decimals: 2 },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian real', decimals: 2 },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican peso', decimals: 2 },
  { code: 'AED', symbol: 'AED ', name: 'UAE dirham', decimals: 2 },
  { code: 'SAR', symbol: 'SAR ', name: 'Saudi riyal', decimals: 2 },
  { code: 'ZAR', symbol: 'R ', name: 'South African rand', decimals: 2 },
  { code: 'TRY', symbol: '₺', name: 'Turkish lira', decimals: 2 },
  { code: 'ILS', symbol: '₪', name: 'Israeli new shekel', decimals: 2 },
]

// Units per 1 USD, rough late-2026 values. They stand in only until live rates load
// (or when the fetch fails), so a cost is never shown as nothing.
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  GBP: 0.79,
  EUR: 0.92,
  CNY: 7.2,
  JPY: 150,
  KRW: 1400,
  INR: 86,
  CAD: 1.38,
  AUD: 1.53,
  NZD: 1.7,
  SGD: 1.33,
  MYR: 4.4,
  HKD: 7.8,
  TWD: 32,
  THB: 35,
  IDR: 16_300,
  VND: 25_800,
  PHP: 58,
  CHF: 0.88,
  SEK: 10.6,
  NOK: 10.9,
  DKK: 6.9,
  PLN: 3.9,
  BRL: 5.6,
  MXN: 18.8,
  AED: 3.67,
  SAR: 3.75,
  ZAR: 18.2,
  TRY: 42,
  ILS: 3.7,
}

const grouped = (fixed: string): string => {
  const [int = '', frac] = fixed.split('.')
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac === undefined ? '' : `.${frac}`)
}

// Cents matter under 100 units; above that the figure is whole. Places are chosen on the rounded figure.
const amount = (symbol: string, v: number, places: (abs: number) => number): string => {
  const abs = Math.abs(v)
  const text = abs.toFixed(places(Number(abs.toFixed(places(abs)))))
  const sign = v < 0 && /[1-9]/.test(text) ? '-' : ''
  return `${sign}${symbol}${grouped(text)}`
}

export function fmtUsd(usd: number): string {
  return amount('$', num(usd) ?? 0, a => (a < 100 ? 2 : 0))
}

export function fmtMoney(usd: number, currency: string, rates: Rates): string | null {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  const c = CURRENCIES.find(x => x.code === code)
  if (!c || code === 'USD') return null
  const live = num(rates?.rates?.[code])
  const rate = live !== undefined && live > 0 ? live : FALLBACK_RATES[code]
  const value = num(usd) !== undefined && rate !== undefined ? num(usd * rate) : undefined
  if (value === undefined) return null
  return amount(c.symbol, value, a => (a < 100 ? c.decimals : 0))
}

const USD_CURRENCY = { code: 'USD', symbol: '$', name: 'US dollar', decimals: 2 } as const

// Units of the chosen currency per 1 USD, and where that figure came from: the fetched
// table when it has the currency, else the built-in one.
export function rateFor(s: Settings, rates: Rates): { rate: number; source: 'usd' | 'live' | 'built-in' } {
  const b = normalizeSettings(s)
  const code = b.currency
  if (code === 'USD') return { rate: 1, source: 'usd' }
  const fetched = num(rates?.rates?.[code])
  if (fetched !== undefined && fetched > 0) return { rate: fetched, source: rates?.isLive === true ? 'live' : 'built-in' }
  return { rate: FALLBACK_RATES[code] ?? 1, source: 'built-in' }
}

// The amount in the chosen currency only: '$53.80', '£40.63', '₩71,779'. Total: junk is zero.
export function money(usd: number, s: Settings, rates: Rates): string {
  const b = normalizeSettings(s)
  const c = CURRENCIES.find(x => x.code === b.currency) ?? USD_CURRENCY
  const value = num((num(usd) ?? 0) * rateFor(b, rates).rate) ?? 0
  return amount(c.symbol, value, a => (a < 100 ? c.decimals : 0))
}

// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm): no Date or Intl here.
const utcDate = (at: number): string => {
  const z = Math.floor(at / 86_400_000) + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

// Four decimals under 100 units (more when a tiny rate would read as zero), whole units from 100 up.
const fmtRate = (rate: number): string => {
  const four = rate.toFixed(4)
  if (Number(four) >= 100) return grouped(rate.toFixed(0))
  if (Number(four) === 0 && rate > 0) return String(Number(rate.toPrecision(4)))
  return four
}

// '1 USD = 0.7551 GBP · online, 2026-11-14' | '… · built-in estimate' | 'US dollars, no conversion'
export function rateLine(s: Settings, rates: Rates): string {
  const b = normalizeSettings(s)
  const { rate, source } = rateFor(b, rates)
  if (source === 'usd') return 'US dollars, no conversion'
  const at = num(rates?.at)
  const where = source === 'live' ? (at === undefined ? 'online' : `online, ${utcDate(at)}`) : 'built-in estimate'
  return `1 USD = ${fmtRate(rate)} ${b.currency} · ${where}`
}

// ---------------------------------------------------------------------------
// Options: plugin.json's `userConfig`. The choices and toggles are settings (one field per
// setting key except `barItems`, which is one boolean per item); five text mirrors show
// the rate and the stored sizes on the plugin screen. Each picker lists its default first.
// `tests/check-manifest.mjs` holds the manifest to what is here.

export type OptionValue = boolean | number | string

/** The option keys that are real settings. */
export type SettingOptionKey =
  | 'theme'
  | 'palette'
  | 'barColors'
  | 'background'
  | 'animations'
  | 'currency'
  | 'panelUsage'
  | 'autoOpen'
  | 'barUsage'
  | BarOption
  | 'barTooltips'

/** The text options the mod writes so the plugin screen shows the current rate and sizes; never read back. */
export type MirrorKey = 'rateNow' | 'textSizeNow' | 'iconSizeNow' | 'barSizeNow' | 'logLinesNow'

/** The values `register(on, options)` receives, defaults filled in. */
export type CrewOptions = {
  theme: string
  palette: string
  barColors: string
  background: string
  animations: boolean
  currency: string
  panelUsage: string
  autoOpen: string
  barUsage: string
  barTooltips: boolean
} & Record<BarOption, boolean> &
  Record<MirrorKey, string>

/** The five mirror options, in the manifest's order. */
export const MIRROR_KEYS: readonly string[] = ['rateNow', 'textSizeNow', 'iconSizeNow', 'barSizeNow', 'logLinesNow'] satisfies MirrorKey[]

/** The option keys that are real settings, in the manifest's order: every option but the mirrors. */
export const SETTING_OPTION_KEYS: readonly string[] = SETTING_KEYS

/** Every option key, in the manifest's order (23). */
export const OPTION_KEYS: readonly string[] = [
  'theme',
  'palette',
  'barColors',
  'background',
  'animations',
  'currency',
  'rateNow',
  'panelUsage',
  'autoOpen',
  'barUsage',
  ...BAR_OPTIONS,
  'barTooltips',
  'textSizeNow',
  'iconSizeNow',
  'barSizeNow',
  'logLinesNow',
] satisfies (keyof CrewOptions)[]

/**
 * What the mirror options should read for these settings: the rate in use (`rateLine`)
 * and the four sizes as text (`100%`, `200%`, `100%`, `50`).
 */
export function mirrorValues(s: Settings, rates: Rates): Record<string, string> {
  const b = normalizeSettings(s)
  return {
    rateNow: rateLine(b, rates),
    textSizeNow: `${b.textSize}%`,
    iconSizeNow: `${b.iconSize}%`,
    barSizeNow: `${b.barSize}%`,
    logLinesNow: `${b.logLines}`,
  }
}

/** The manifest's defaults. */
export const OPTION_DEFAULTS: Readonly<CrewOptions> = {
  theme: 'cat',
  palette: 'ocean',
  barColors: 'kind',
  background: 'plain',
  animations: true,
  currency: 'GBP',
  rateNow: '',
  panelUsage: 'bar',
  autoOpen: 'any',
  barUsage: 'ring',
  barContext: true,
  barFiveHour: true,
  barWeek: true,
  barModelWeek: true,
  barSpeed: true,
  barCache: true,
  barTurn: true,
  barTime: true,
  barTooltips: true,
  textSizeNow: `${DEFAULT_SIZES.textSize}%`,
  iconSizeNow: `${DEFAULT_SIZES.iconSize}%`,
  barSizeNow: `${DEFAULT_SIZES.barSize}%`,
  logLinesNow: `${DEFAULT_SIZES.logLines}`,
}

// The plugin screen lists a picker's values in this order: its default first, the rest as they are.
const defaultFirst = (list: readonly string[], d: string): readonly string[] => [d, ...list.filter(x => x !== d)]

/** The values each picker option (a string with `options`) allows, in the manifest's order: the default first. */
export const OPTION_CHOICES: Readonly<Partial<Record<keyof CrewOptions, readonly string[]>>> = {
  theme: defaultFirst(THEMES, OPTION_DEFAULTS.theme),
  // ocean, then sunset, then classic, as the plugin screen lists them.
  palette: ['ocean', 'sunset', 'classic'] satisfies PaletteName[],
  barColors: defaultFirst(BAR_COLORS, OPTION_DEFAULTS.barColors),
  background: defaultFirst(BACKGROUNDS, OPTION_DEFAULTS.background),
  currency: defaultFirst(
    CURRENCIES.map(c => c.code),
    OPTION_DEFAULTS.currency,
  ),
  // bar, then ring, then off: off last, as the plugin screen lists it.
  panelUsage: ['bar', 'ring', 'off'] satisfies Settings['panelUsage'][],
  autoOpen: defaultFirst(AUTO_OPENS, OPTION_DEFAULTS.autoOpen),
  barUsage: defaultFirst(CHART_KINDS, OPTION_DEFAULTS.barUsage),
}

/** The setting option a typed name stands for (`PALETTE` -> `palette`); undefined for anything else, a mirror or a size included. */
export function optionKey(key: string): SettingOptionKey | undefined {
  return pick(SETTING_KEYS, key)
}

/** The value `$.config.set` takes for one setting option, of its kind; a `bar*` key answers whether its item is shown. Undefined for any other key (the mirrors and the sizes included). */
export function optionValue(s: Settings, key: string): OptionValue | undefined {
  const k = pick(SETTING_KEYS, key)
  if (!k) return undefined
  const b = normalizeSettings(s)
  const item = BAR_ITEMS.find(x => x.option === k)
  if (item) return b.barItems.includes(item.key)
  return b[k as Exclude<SettingOptionKey, BarOption>]
}

/**
 * The setting options whose value differs between two settings, in `OPTION_KEYS` order,
 * each with its value in `after`: what to write through `$.config.set` after `setSetting`,
 * or (with `after` the defaults) for a reset. Never a size or a mirror.
 */
export function changedOptions(before: Settings, after: Settings): { key: string; value: OptionValue }[] {
  const out: { key: string; value: OptionValue }[] = []
  for (const key of SETTING_KEYS) {
    const value = optionValue(after, key)
    if (value !== undefined && value !== optionValue(before, key)) out.push({ key, value })
  }
  return out
}

// ---------------------------------------------------------------------------
// Tokens, prices and models.

export function emptyUse(): TokenUse {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

type RequestUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

const count = (v: unknown): number => Math.max(0, num(v) ?? 0)

export function addUse(a: TokenUse, u: RequestUsage): TokenUse {
  return {
    input: a.input + count(u?.input_tokens),
    output: a.output + count(u?.output_tokens),
    cacheRead: a.cacheRead + count(u?.cache_read_input_tokens),
    cacheWrite: a.cacheWrite + count(u?.cache_creation_input_tokens),
  }
}

export function useTotal(u: TokenUse): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

// USD per million tokens: input, output, cache read, cache write. The first row that
// matches a model id wins, so a release sits above its family. The engine reports one
// cache-write count with no split by lifetime; writes are priced at the 1-hour rate
// (2x input), which is what Claude Code writes on a subscription.
export type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

// A version is matched whole, as `modelName` reads it: a dated id such as
// `claude-fable-5-20260301` is Fable 5, not 5.2.
export const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-2(?!\d)/, [8, 40, 0.2, 16]],
  [/(fable|mythos)-5-1(?!\d)/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5(?!\d)/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5(?!\d)/, [2, 10, 0.1, 4]],
  [/sonnet-5(?!\d)/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5(?!\d)/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 is priced by prompt length: a request whose prompt (input, cache reads and
// cache writes together) is over 100,000 tokens pays these prices instead.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]
const FALLBACK_PRICE: Price = [4, 20, 0.2, 8]

// A bare alias, with or without `[1m]`, is the current model of its family.
const ALIASES: Readonly<Record<string, string>> = { fable: 'claude-fable-5-2', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }

/** A model id with a bare family alias (`opus`, `fable[1m]`) read as that family's current model; any other id as it is, lower case. */
export function modelId(model: string): string {
  const id = typeof model === 'string' ? model.trim().toLowerCase() : ''
  const alias = /^([a-z]+)(?:\[1m\])?$/.exec(id)?.[1]
  return alias !== undefined && Object.hasOwn(ALIASES, alias) ? (ALIASES[alias] as string) : id
}

export function priceOf(model: string, prompt: number): Price {
  const id = modelId(model)
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5(?!\d)/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? FALLBACK_PRICE
}

// `isRequest` says the usage is one model request, which is what a prompt-length price
// is set by; a turn's sum is priced at the model's ordinary prices.
export function costOf(model: string, u: RequestUsage, isRequest: boolean): number {
  const prompt = isRequest ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
  const [i, o, r, w] = priceOf(model, prompt)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

// Haiku 4.5 and the Claude 3 models have a 200K window; the rest, Haiku 5.5 included, 1M.
export const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

// `Opus 5.5 · low` for a run, or just the model when no effort was seen.
export const modelLabel = (model: string, effort?: string): string =>
  effort ? `${modelName(model)} · ${effort}` : modelName(model)

// ---------------------------------------------------------------------------
// Numbers and times as drawn; total, since bad state must never break a drawing.

export function fmtTokens(n: number): string {
  const v = Math.max(0, num(n) ?? 0)
  if (Math.round(v) < 1000) return `${Math.round(v)}`
  if (Math.round(v / 1e3) < 1000) return `${Math.round(v / 1e3)}k`
  const m = v / 1e6
  return m < 9.95 ? `${m.toFixed(1).replace(/\.0$/, '')}M` : `${grouped(m.toFixed(0))}M`
}

const seconds = (ms: number): number => Math.max(0, Math.round((num(ms) ?? 0) / 1000))
const pad = (n: number): string => String(n).padStart(2, '0')

export function fmtTime(ms: number): string {
  const s = seconds(ms)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// The two largest units, for countdowns: `3d 19h`, `1h 07m`, `42m`, `50s`.
export function fmtSpan(ms: number): string {
  const s = seconds(ms)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${pad(m % 60)}m`
  return `${Math.floor(h / 24)}d ${pad(h % 24)}h`
}

// Local wall time for log rows; the offset is passed in because this file reads no clock.
export function fmtClock(at: number, tzOffsetMin = 0): string {
  const t = num(at)
  if (t === undefined) return '--:--:--'
  const day = 86_400
  const s = ((Math.floor((t + (num(tzOffsetMin) ?? 0) * 60_000) / 1000) % day) + day) % day
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

// ---------------------------------------------------------------------------
// Fresh state.

export function blankMain(now: number): MainRun {
  return {
    status: 'resting',
    doing: '',
    doingSince: now,
    model: '',
    turns: 0,
    turnStartedAt: null,
    workedMs: 0,
    use: emptyUse(),
    costUsd: 0,
    contextTokens: 0,
    contextMax: windowOf(''),
    log: [],
  }
}

export function blankUsage(now: number): Usage {
  return {
    at: now,
    sessionStartedAt: now,
    limits: [],
    costUsd: null,
    costAtTurnStart: 0,
    turnCostUsd: null,
    contextTokens: null,
    contextWindow: windowOf(''),
    contextPercent: null,
    speed: null,
    cacheExpiresAt: null,
  }
}

export function blankView(): View {
  return {
    isCompact: false,
    isDoneCollapsed: false,
    openLogs: [],
    isBarCollapsed: false,
    autoOpenedFor: '',
    paneOpenedAt: 0,
    barToggledAt: 0,
  }
}

// Field by field, since state written by v1 or v2 (v2's `logFor`, no timestamps) meets a hot reload.
export function normalizeView(raw: unknown): View {
  const r = isRecord(raw) ? raw : {}
  const d = blankView()
  const text = (v: unknown, x: string): string => (typeof v === 'string' ? v : x)
  const ids = Array.isArray(r.openLogs) ? r.openLogs.filter((x): x is string => typeof x === 'string') : d.openLogs
  const v: View = {
    isCompact: flag(r.isCompact, d.isCompact),
    isDoneCollapsed: flag(r.isDoneCollapsed, d.isDoneCollapsed),
    openLogs: [...new Set(ids)],
    isBarCollapsed: flag(r.isBarCollapsed, d.isBarCollapsed),
    autoOpenedFor: text(r.autoOpenedFor, d.autoOpenedFor),
    paneOpenedAt: num(r.paneOpenedAt) ?? d.paneOpenedAt,
    barToggledAt: num(r.barToggledAt) ?? d.barToggledAt,
  }
  // The panel's page of rows: the page and the row it follows (`anchoredPage`).
  const page = isRecord(r.rowPage) ? r.rowPage : undefined
  const n = num(page?.n)
  if (page && n !== undefined && n >= 0 && typeof page.first === 'string' && page.first) v.rowPage = { n: Math.floor(n), first: page.first }
  return v
}

// ---------------------------------------------------------------------------
// Flow: the plan the orchestrator reports through the `progress` tool. The tool's
// schema is advice to the model, not a check, so what a call may draw is bounded here.

const PHASES: readonly Phase[] = ['research', 'ask', 'plan', 'design', 'delegate', 'review', 'close']
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120
const MAX_MODEL = 40
const MAX_EFFORT = 20

/** A `progress` call. A task's `agent` is the older name of `kind`, and may name a 1.6 role. */
export type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; kind?: string; agent?: string; model?: string; effort?: string; after?: number[] }[]
}

const blankFlow = (): Flow => ({
  title: 'Plan',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

const shortText = (v: unknown, max: number): string => (typeof v === 'string' ? clip(printable(v), max) : '')

/** A plan or task title as kept, so a title given again compares equal to the stored one: trimmed, clipped to 120 characters. */
export const clipTitle = (s: string): string => clip(typeof s === 'string' ? s.trim() : '', MAX_TITLE)

// Titles made distinct, as runs are matched to tasks by title: a task whose normalised
// title an earlier one has gets ` (2)`, ` (3)`, … A re-run of a task reuses its title.
const distinctTitles = (tasks: PlannedTask[]): PlannedTask[] => {
  const used = new Set<string>()
  return tasks.map(t => {
    let title = t.title
    for (let n = 2; used.has(norm(title)); n += 1) {
      const tag = ` (${n})`
      title = clip(t.title, MAX_TITLE - tag.length) + tag
    }
    used.add(norm(title))
    return title === t.title ? t : { ...t, title }
  })
}

/**
 * What the `progress` reply adds when the report gave two tasks the same title: the
 * titles to use as the Agent descriptions, in plan order. Empty when every title was kept.
 */
export function renamedNote(input: ProgressInput, flow: Flow): string {
  const given = (isRecord(input) && Array.isArray(input.tasks) ? input.tasks : [])
    .filter((t): t is Record<string, unknown> => isRecord(t) && typeof t.title === 'string' && t.title.trim() !== '')
    .slice(0, MAX_TASKS)
    .map(t => clipTitle(String(t.title)))
  const kept = (isRecord(flow) && Array.isArray(flow.tasks) ? flow.tasks : []).map(t => t.title)
  if (!given.length || given.every((t, i) => kept[i] === t)) return ''
  return ` Some tasks had the same title, so the later ones were numbered; use these titles as the Agent descriptions: ${kept.map((t, i) => `${i + 1}. ${t}`).join('; ')}.`
}

// The tasks as kept: `kind` from `kind`, else from `agent` (a kind or a 1.6 role), '' when
// neither names one. Tasks 1.6 stored (`agent`, no `kind`) come out the same way.
const cleanTasks = (tasks: unknown): PlannedTask[] | undefined => {
  const list = cleanTaskList(tasks)
  return list && distinctTitles(list)
}

const cleanTaskList = (tasks: unknown): PlannedTask[] | undefined =>
  Array.isArray(tasks)
    ? tasks
        .filter((t): t is Record<string, unknown> => isRecord(t) && typeof t.title === 'string' && t.title.trim() !== '')
        .slice(0, MAX_TASKS)
        .map(t => ({
          title: clip(String(t.title).trim(), MAX_TITLE),
          kind: kindName(t.kind) ?? kindName(t.agent) ?? '',
          model: shortText(t.model, MAX_MODEL),
          effort: shortText(t.effort, MAX_EFFORT),
          after: (Array.isArray(t.after) ? t.after : [])
            .filter((n): n is number => Number.isInteger(n) && n > 0)
            .slice(0, MAX_AFTER),
        }))
    : undefined

/** A flow's planned tasks as 2.0 keeps them, whatever state 1.6 left. */
export function normalizeTasks(tasks: unknown): PlannedTask[] {
  return cleanTasks(tasks) ?? []
}

export function mergeFlow(prev: Flow | null, input: ProgressInput): Flow {
  const i: Record<string, unknown> = isRecord(input) ? input : {}
  const title = typeof i.title === 'string' && i.title.trim() ? clip(i.title.trim(), MAX_TITLE) : undefined
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = !prev || prev.isFinished || (title !== undefined && title !== prev.title) ? blankFlow() : { ...blankFlow(), ...prev }
  const tasks = cleanTasks(i.tasks) ?? normalizeTasks(base.tasks)
  const total = clamp(Math.round(num(i.total) ?? (Array.isArray(i.tasks) ? tasks.length : base.total)), 0, MAX_TASKS)
  const done = clamp(Math.round(num(i.done) ?? base.done), 0, total || MAX_TASKS)
  const phase = pick(PHASES, i.phase) ?? base.phase
  const isFinished = i.finished === true
  return {
    ...base,
    title: title ?? base.title,
    total,
    done,
    phase: isFinished ? 'close' : phase,
    isFinished,
    tasks,
  }
}

export function flowLabel(f: Flow): string {
  // A run's count reads the same in every state: `Agents 7/7` once it is over.
  if (typeof f.unit === 'string' && f.unit) return `${f.unit} ${f.done}/${f.total}`
  if (f.isFinished) return 'Done'
  if (f.phase === 'research') return 'Research'
  if (f.phase === 'ask') return 'Asking'
  if (f.phase === 'plan') return 'Plan'
  if (f.phase === 'design') return 'Design'
  const n = f.total ? `${f.done}/${f.total}` : `${f.running} running`
  return `${f.phase === 'review' ? 'Review' : 'Tasks'} ${n}`
}

export const flowRatio = (f: Flow): number => (f.isFinished ? 1 : f.total ? clamp(f.done / f.total, 0, 1) : 0)

/** What the progress row says of the plan: none reported, running, paused with nothing working, or done. */
export type TaskState = 'none' | 'running' | 'paused' | 'done'

/**
 * `none`: no flow. `done`: the flow is finished. `running`: an unfinished flow while the
 * main agent works or any agent runs. `paused`: an unfinished flow with nothing working.
 */
export function taskState(flow: Flow | null, isMainWorking: boolean, agentsRunning: number): TaskState {
  if (!isRecord(flow)) return 'none'
  if (flow.isFinished === true) return 'done'
  return isMainWorking === true || (num(agentsRunning) ?? 0) > 0 ? 'running' : 'paused'
}

/**
 * The flow, finished when its runs show it is: every planned task has a run (matched by
 * title, as `plannedOf` matches) whose latest run ended `done`, and no run is still
 * running or waiting. Then it comes back finished with `done = total` (phase `close`).
 * Otherwise (no flow, already finished, no task list, a task whose latest run failed or
 * that has no run, anything still working) the same flow object comes back unchanged,
 * so the caller can store it only when it differs.
 */
export function flowSettled(flow: Flow | null, agents: AgentRun[]): Flow | null {
  if (!isRecord(flow) || flow.isFinished === true) return flow
  const tasks: unknown[] = Array.isArray(flow.tasks) ? flow.tasks : []
  if (!tasks.length) return flow
  const runs = (Array.isArray(agents) ? agents : []).filter((a): a is AgentRun => isRecord(a))
  if (runs.some(a => a.status === 'running' || a.status === 'waiting')) return flow
  for (const t of tasks) {
    if (!isRecord(t) || typeof t.title !== 'string') return flow
    const key = norm(t.title)
    let latest: AgentRun | undefined
    for (const a of runs) {
      if (typeof a.description !== 'string' || norm(a.description) !== key) continue
      if (!latest || (num(a.startedAt) ?? 0) >= (num(latest.startedAt) ?? 0)) latest = a
    }
    if (latest?.status !== 'done') return flow
  }
  const total = Math.max(0, Math.round(num(flow.total) ?? 0))
  return { ...flow, total, done: total, phase: 'close', isFinished: true, settled: { done: clamp(Math.round(num(flow.done) ?? 0), 0, total), phase: flow.phase } }
}

/**
 * A plan that finished by itself, reopened: by a report that contradicts its settled state
 * (`done` below `total`, or a phase other than `close`), which then gives the counts, or
 * (`input` null) by a new run on one of its tasks, which brings back the `done` and
 * `phase` it had before it settled. Null when it stays as it is: not settled, finished by
 * a report, or a report that agrees (`done` equal to `total`, `finished: true`, no phase).
 */
export function reopenedFlow(flow: Flow | null, input: ProgressInput | null): Flow | null {
  if (!isRecord(flow) || flow.isFinished !== true || !isRecord(flow.settled)) return null
  const before = flow.settled
  const open = (done: number, phase: Phase): Flow => {
    const out: Flow = { ...flow, isFinished: false, done: clamp(Math.round(done), 0, flow.total || MAX_TASKS), phase }
    delete out.settled
    return out
  }
  const back: Phase = pick(PHASES, before.phase) && before.phase !== 'close' ? before.phase : 'delegate'
  if (input === null) return open(num(before.done) ?? 0, back)
  const i: Record<string, unknown> = isRecord(input) ? input : {}
  if (i.finished === true) return null
  const done = num(i.done)
  const phase = pick(PHASES, i.phase)
  const isBelow = done !== undefined && Math.round(done) < flow.total
  const isOtherPhase = phase !== undefined && phase !== 'close'
  if (!isBelow && !isOtherPhase) return null
  return open(done ?? (num(before.done) ?? 0), phase ?? back)
}

// ---------------------------------------------------------------------------
// Runs: with no plan on, the bar counts every subagent of the run, `Agents d/n`, and its
// fill creeps forward while they work, so it moves between the events that finish them.

/** An active agent with no tool call, model request, step or status change for this long counts as ended for its run. */
export const STUCK_MS = 15 * 60_000
/** A plan unfinished and unreported for this long gives way to the run. */
export const PLAN_STALE_MS = 30 * 60_000
/** The synthetic flow of a run counts agents. */
export const RUN_UNIT = 'Agents'
// The creep: 90% of the way to the next step at most, two thirds of that after 45s.
const CREEP_MAX = 0.9
const CREEP_MS = 45_000
// An agent that reports no steps creeps to half a task at most: nothing says how far it is.
const UNSTEPPED_MAX = 0.5
// A run keeps at most this many ids; older ones only ever count as over.
const MAX_RUN_IDS = 1_000

const isActiveRun = (a: AgentRun): boolean => a.status === 'running' || a.status === 'waiting'

/** How far an agent working for `ms` has crept toward its next step, 0 to 0.9. */
export const creepOf = (ms: number): number => CREEP_MAX * (1 - Math.exp(-Math.max(0, num(ms) ?? 0) / CREEP_MS))

/** The last sign of life: its start, a status or doing change, a step, a request or tool call ending, a log entry. */
export function lastActiveOf(a: AgentRun): number {
  const log = Array.isArray(a.log) ? a.log : []
  return Math.max(num(a.startedAt) ?? 0, num(a.doingSince) ?? 0, num(a.stepAt) ?? 0, num(a.activeAt) ?? 0, num(log[log.length - 1]?.at) ?? 0)
}

/** Active, but quiet for `STUCK_MS`: its end was most likely missed. The list still shows it. */
export const isStuck = (a: AgentRun, now: number): boolean => isActiveRun(a) && Number.isFinite(now) && now - lastActiveOf(a) >= STUCK_MS

/** Active and not stuck: what a run waits for. */
export const isLive = (a: AgentRun, now: number): boolean => isActiveRun(a) && !isStuck(a, now)

/**
 * How much of its own task an agent has done, 0 to 1. With steps reported: the steps
 * done plus the creep since the last one, over the total. With none: the creep since it
 * started, capped at half. An agent that is over has done its part.
 */
export function partialOf(a: AgentRun, now: number): number {
  if (!isActiveRun(a)) return 1
  const total = Math.max(0, Math.round(num(a.stepTotal) ?? 0))
  if (total > 0) {
    const done = Math.min(total, Math.max(0, Math.round(num(a.stepDone) ?? 0)))
    const since = num(a.stepAt) ?? num(a.startedAt) ?? now
    return Math.min(1, (done + (done < total ? creepOf(now - since) : 0)) / total)
  }
  return Math.min(UNSTEPPED_MAX, creepOf(now - (num(a.startedAt) ?? now)))
}

/**
 * The run with agent `id` in it, joined at `at`: a new run when there is none or the last
 * one ended, else the same run one agent longer. The mark is kept: under a plan the count
 * is the plan's and a join changes nothing of it; in the run view the mark's key names
 * the agent count, so `heldRun` starts it afresh as the count grows.
 */
export function joinRun(run: Run | null, id: string, at: number): Run {
  if (!run || run.endedAt !== undefined || !Array.isArray(run.ids)) return { startedAt: at, ids: [id], high: 0, joinedAt: at }
  if (run.ids.includes(id)) return { ...run, joinedAt: at }
  return { ...run, ids: [...run.ids, id].slice(-MAX_RUN_IDS), joinedAt: at }
}

/**
 * The run, ended at `at` when none of its agents is live in `list`, read at `now`;
 * otherwise as it was. An agent that joined after `now` may be missing from that list, so a
 * run joined since is left open.
 */
export function closedRun(run: Run | null, list: AgentRun[], now: number, at: number): Run | null {
  if (!run || run.endedAt !== undefined) return run
  if ((num(run.joinedAt) ?? -Infinity) > now) return run
  const rows = new Map(list.map(a => [a.id, a]))
  const isWaitedFor = (Array.isArray(run.ids) ? run.ids : []).some(id => {
    const a = rows.get(id)
    return a !== undefined && isLive(a, now)
  })
  return isWaitedFor ? run : { ...run, endedAt: at }
}

export type RunCounts = { n: number; d: number; live: AgentRun[]; title: string }

/**
 * `n` agents started in the run and `d` of them over (done, failed, stuck, or no longer
 * listed), the live ones, and the title: the description of the most recently started
 * agent still active, else of the most recently started one. An ended run is all over.
 */
export function runCounts(run: Run | null, list: AgentRun[], now: number): RunCounts {
  const ids = run && Array.isArray(run.ids) ? run.ids : []
  const rows = new Map((Array.isArray(list) ? list : []).map(a => [a.id, a]))
  const mine = ids.map(id => rows.get(id)).filter((a): a is AgentRun => a !== undefined)
  const live = run?.endedAt === undefined ? mine.filter(a => isLive(a, now)) : []
  const newest = (xs: AgentRun[]): AgentRun | undefined =>
    xs.reduce<AgentRun | undefined>((b, a) => (!b || (num(a.startedAt) ?? 0) >= (num(b.startedAt) ?? 0) ? a : b), undefined)
  const lead = newest(mine.filter(isActiveRun)) ?? newest(mine)
  return { n: ids.length, d: ids.length - live.length, live, title: lead ? lead.description || lead.type || '' : '' }
}

/** The run's agents active but stuck, and those live, by id. */
export function runQuiet(run: Run | null, list: AgentRun[], now: number): { stuck: string[]; live: string[] } {
  const ids = run && Array.isArray(run.ids) ? run.ids : []
  const rows = new Map((Array.isArray(list) ? list : []).map(a => [a.id, a]))
  const mine = ids.map(id => rows.get(id)).filter((a): a is AgentRun => a !== undefined)
  return { stuck: mine.filter(a => isStuck(a, now)).map(a => a.id), live: mine.filter(a => isLive(a, now)).map(a => a.id) }
}

/** The run's fill: the agents over, plus how far each live one has got, over all of them. */
export function runFill(run: Run | null, list: AgentRun[], now: number): number {
  const c = runCounts(run, list, now)
  if (!c.n) return 0
  return clamp((c.d + c.live.reduce((sum, a) => sum + partialOf(a, now), 0)) / c.n, 0, 1)
}

/** The plan's fill: the tasks done, plus how far the live agents on planned tasks have got, never past the total. */
export function planFill(flow: Flow | null, list: AgentRun[], now: number): number {
  if (!isRecord(flow)) return 0
  if (flow.isFinished === true) return 1
  const total = Math.max(0, Math.round(num(flow.total) ?? 0))
  if (!total) return 0
  const done = clamp(Math.round(num(flow.done) ?? 0), 0, total)
  const titles = new Set((Array.isArray(flow.tasks) ? flow.tasks : []).map(t => norm(String(t?.title ?? ''))))
  const partials = (Array.isArray(list) ? list : [])
    .filter(a => isLive(a, now) && titles.has(norm(String(a.description ?? ''))))
    .reduce((sum, a) => sum + partialOf(a, now), 0)
  return clamp((done + Math.min(total - done, partials)) / total, 0, 1)
}

/** The run as a flow the bar draws: `Agents d/n`, finished once every agent is over. Null with no run. */
export function runFlow(run: Run | null, list: AgentRun[], now: number): Flow | null {
  const c = runCounts(run, list, now)
  if (!c.n) return null
  return { title: c.title, total: c.n, done: c.d, running: c.live.length, phase: 'delegate', isFinished: c.d >= c.n, tasks: [], unit: RUN_UNIT }
}

/**
 * Whether the reported plan is what the bar shows: unfinished and either reported within
 * `PLAN_STALE_MS` or with an agent on one of its planned tasks still active (so a long
 * task does not flip the bar mid-flow), or finished and reported (or settled) during the
 * current run (the last one, ended or not). Otherwise the run is shown.
 */
export function planApplies(flow: Flow | null, run: Run | null, now: number, list: AgentRun[] = []): boolean {
  if (!isRecord(flow)) return false
  const at = num(flow.reportedAt)
  if (at === undefined) return false
  if (flow.isFinished !== true) {
    if (now - at <= PLAN_STALE_MS) return true
    const titles = new Set((Array.isArray(flow.tasks) ? flow.tasks : []).map(t => norm(String(t?.title ?? ''))))
    return (Array.isArray(list) ? list : []).some(a => isActiveRun(a) && titles.has(norm(String(a.description ?? ''))))
  }
  return isRecord(run) && at >= (num(run.startedAt) ?? Infinity)
}

/** What the bar and the main row show: the plan, the run, or nothing. `key` names what the fill is measured against; `crew` is the `×N`. */
export type BarView = { flow: Flow | null; isPlan: boolean; key: string; crew: number }

/** What the fill's mark of a plan is measured against: the plan itself, by when it was first reported, so a re-plan keeps its fill and another plan of the same title starts empty. A plan an older version stored goes by its title and count. */
export function planKey(flow: Flow): string {
  const at = num(flow?.startedAt)
  return at !== undefined ? `plan@${at}` : `plan:${norm(String(flow?.title ?? ''))}:${num(flow?.total) ?? 0}`
}

export function barView(flow: Flow | null, run: Run | null, list: AgentRun[], now: number): BarView {
  if (flow && planApplies(flow, run, now, list)) return { flow, isPlan: true, key: planKey(flow), crew: list.length + plannedOf(flow, list).length }
  const f = runFlow(run, list, now)
  return f ? { flow: f, isPlan: false, key: `run:${f.total}`, crew: f.total } : { flow: null, isPlan: false, key: '', crew: 0 }
}

/** The view's honest fill at `now`, 0 to 1. */
export function viewFill(view: BarView, run: Run | null, list: AgentRun[], now: number): number {
  if (!view.flow) return 0
  return view.isPlan ? planFill(view.flow, list, now) : runFill(run, list, now)
}

/**
 * The run with its high-water mark raised to `fill`. A new key starts the mark afresh,
 * and so does, given the run's `quiet` agents (`runQuiet`, run view only), an agent last
 * counted stuck that is live again: it was counted over, so the fill drops back once.
 */
export function heldRun(run: Run, key: string, fill: number, quiet?: { stuck: string[]; live: string[] }): Run {
  const f = clamp(num(fill) ?? 0, 0, 1)
  const wasQuiet = Array.isArray(run.quiet) ? run.quiet : []
  const isRevived = !!quiet && wasQuiet.some(id => quiet.live.includes(id))
  const stuck = quiet ? quiet.stuck : run.quiet
  const sameQuiet = (stuck ?? []).join('|') === wasQuiet.join('|')
  if (run.highKey !== key || isRevived) return { ...run, high: f, highKey: key, ...(stuck ? { quiet: stuck } : {}) }
  const high = Math.max(num(run.high) ?? 0, f)
  if (high === run.high && sameQuiet) return run
  return { ...run, high, ...(stuck ? { quiet: stuck } : {}) }
}

/**
 * One second of creep for the bar: from the fill shown now (never under the high-water
 * mark) to where it will be a second on, and how far into that second the clock is.
 */
export function creepSpan(high: number, now: number, later: number, intoMs: number): { start: number; target: number; delayMs: number } {
  const start = clamp(Math.max(num(high) ?? 0, num(now) ?? 0), 0, 1)
  return { start, target: clamp(Math.max(start, num(later) ?? 0), 0, 1), delayMs: Math.round(clamp(num(intoMs) ?? 0, 0, 1_000)) }
}

// ---------------------------------------------------------------------------
// Agents: what the rows show and the order they come in.

// Reported steps when the worker sends them; null when it has said nothing.
export const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return clamp((a.stepDone ?? 0) / a.stepTotal, 0, 1)
  return null
}

export const ctxOf = (a: { contextTokens: number; contextMax: number }): number =>
  a.contextMax > 0 ? clamp(Math.round((a.contextTokens / a.contextMax) * 100), 0, 100) || 0 : 0

export const elapsed = (a: AgentRun, now: number): number => Math.max(0, (a.endedAt ?? Math.max(now, a.startedAt)) - a.startedAt)

export function mainWorkedMs(main: MainRun, now: number): number {
  return main.workedMs + (main.turnStartedAt === null ? 0 : Math.max(0, now - main.turnStartedAt))
}

export type Planned = PlannedTask & { n: number }

/** The agent rows the list keeps: finished ones are evicted past this many rows in all. */
export const MAX_ROWS = 200
/** Active rows are never evicted for finished ones; past this many, the oldest active go. */
export const MAX_ACTIVE_ROWS = 1_000

/**
 * The rows the list keeps, in their order, and those it lets go. Past `max` rows the
 * finished ones go first, the longest finished first, and never an active one; past
 * `maxActive` active rows, the oldest started active ones go.
 */
export function capRows(list: AgentRun[], max = MAX_ROWS, maxActive = MAX_ACTIVE_ROWS): { kept: AgentRun[]; removed: AgentRun[] } {
  const rows = (Array.isArray(list) ? list : []).filter(a => isRecord(a))
  const gone = new Set<AgentRun>()
  const active = rows.filter(isActiveRun)
  if (active.length > maxActive) {
    const oldest = [...active].sort((a, b) => (num(a.startedAt) ?? 0) - (num(b.startedAt) ?? 0))
    for (const a of oldest.slice(0, active.length - maxActive)) gone.add(a)
  }
  const over = rows.length - gone.size - max
  if (over > 0) {
    const finished = rows.filter(a => !isActiveRun(a)).sort((a, b) => (num(a.endedAt) ?? num(a.startedAt) ?? 0) - (num(b.endedAt) ?? num(b.startedAt) ?? 0))
    for (const a of finished.slice(0, over)) gone.add(a)
  }
  return { kept: rows.filter(a => !gone.has(a)), removed: rows.filter(a => gone.has(a)) }
}

// Planned tasks no run has started yet, matched loosely on the run's description.
export function plannedOf(f: Flow | null, list: AgentRun[]): Planned[] {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

export type Sorted = { working: AgentRun[]; waiting: AgentRun[]; finished: AgentRun[] }

/** The most rows the panel draws in full, in all its sections together. */
export const MAX_DRAWN_ROWS = 60

/**
 * The drawing budget: the rows of each section the panel draws in full, in the order the
 * sections are given (working, waiting, planned, finished with the newest first), at most
 * `max` in all, and how many each leaves out, for its `+N more` line. The sections' own
 * counts stay whole: only what is drawn is cut.
 */
export function drawnRows<T>(sections: readonly (readonly T[])[], max = MAX_DRAWN_ROWS): { shown: T[]; more: number }[] {
  let room = Math.max(0, Math.floor(num(max) ?? MAX_DRAWN_ROWS))
  return (Array.isArray(sections) ? sections : []).map(list => {
    const rows = Array.isArray(list) ? list : []
    const shown = rows.slice(0, room)
    room -= shown.length
    return { shown, more: rows.length - shown.length }
  })
}

/** The line that ends a section the drawing budget cut. */
export const moreLine = (n: number): string => `+${Math.max(0, Math.round(num(n) ?? 0))} more`

/**
 * The page the panel shows, from what the view kept (`{ n, first }`): the first page that
 * holds the row whose id is `first`, so the view follows its row as rows come and go;
 * when no page holds it, `n` clamped into the pages there are (floored; junk reads as 0);
 * 0 with nothing kept, an empty list or junk. Never throws.
 */
export function anchoredPage<T>(pages: readonly (readonly T[])[], idOf: (row: T) => string, kept?: { n: number; first: string }): number {
  try {
    if (!Array.isArray(pages) || !pages.length || !isRecord(kept) || typeof idOf !== 'function') return 0
    const last = pages.length - 1
    if (typeof kept.first === 'string') {
      for (const [i, page] of pages.entries()) if (Array.isArray(page) && page.some(row => idOf(row) === kept.first)) return i
    }
    const n = typeof kept.n === 'number' && !Number.isNaN(kept.n) ? Math.floor(kept.n) : 0
    return clamp(n, 0, last)
  } catch {
    return 0
  }
}

/** One page of the panel's rows: every page, the one shown, and how many rows lie before and after it. */
export type RowPages<T> = { pages: T[][]; page: number; rows: T[]; before: number; after: number; count: number }

/**
 * The panel's rows cut into pages, in order, greedily: a row joins the current page while
 * the page's cost stays at or below `budget` and it holds fewer than `max` rows, else it
 * starts the next page; a row over the budget alone has a page of its own. An empty list
 * is one empty page. `page` is clamped into range (junk reads as 0). A cost that is not a
 * number, or a cost function that throws, counts as 0. Never throws.
 */
export function rowPages<T>(rows: readonly T[], costOf: (row: T) => number, budget: number, page = 0, max = MAX_DRAWN_ROWS): RowPages<T> {
  const list: readonly T[] = Array.isArray(rows) ? rows : []
  const cap = Math.max(1, Math.floor(num(max) ?? MAX_DRAWN_ROWS))
  const room = num(budget) ?? 0
  const pages: T[][] = []
  let cur: T[] = []
  let spent = 0
  for (const x of list) {
    let c = 0
    try {
      c = Math.max(0, num(typeof costOf === 'function' ? costOf(x) : 0) ?? 0)
    } catch {
      c = 0
    }
    if (cur.length && (spent + c > room || cur.length >= cap)) {
      pages.push(cur)
      cur = []
      spent = 0
    }
    cur.push(x)
    spent += c
  }
  pages.push(cur)
  const at = clamp(Math.floor(num(page) ?? 0), 0, pages.length - 1)
  const before = pages.slice(0, at).reduce((n, p) => n + p.length, 0)
  const shown = pages[at] ?? []
  return { pages, page: at, rows: shown, before, after: list.length - before - shown.length, count: pages.length }
}

export function sortAgents(list: AgentRun[]): Sorted {
  return {
    working: list.filter(a => a.status === 'running').sort((a, b) => a.startedAt - b.startedAt),
    waiting: list.filter(a => a.status === 'waiting').sort((a, b) => a.doingSince - b.doingSince),
    finished: list
      .filter(a => a.status === 'done' || a.status === 'failed')
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)),
  }
}

export type Totals = { costUsd: number; isEstimate: boolean; use: TokenUse; tokens: number; timeMs: number }

// A token count as kept: whole fields, junk as zero.
const useOf = (u: unknown): TokenUse => {
  const x = isRecord(u) ? u : {}
  return { input: count(x.input), output: count(x.output), cacheRead: count(x.cacheRead), cacheWrite: count(x.cacheWrite) }
}
const plusUse = (a: TokenUse, b: TokenUse): TokenUse => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})
const usd = (v: unknown): number => Math.max(0, num(v) ?? 0)
const spentOf = (x: unknown): Spent => (isRecord(x) ? { use: useOf(x.use), costUsd: usd(x.costUsd) } : { use: emptyUse(), costUsd: 0 })
const plusSpent = (a: Spent, b: Spent): Spent => ({ use: plusUse(a.use, b.use), costUsd: a.costUsd + b.costUsd })

/** Nothing retired yet. */
export function blankRetired(): Retired {
  return { use: emptyUse(), costUsd: 0, byFamily: {} }
}

/** The retired tally as kept, whatever older state holds: junk and a missing tally read as zero. */
export function normalizeRetired(raw: unknown): Retired {
  const r = isRecord(raw) ? raw : {}
  const fams = isRecord(r.byFamily) ? r.byFamily : {}
  const byFamily: Partial<Record<ModelFamily, Spent>> = {}
  for (const f of MODEL_FAMILIES) if (isRecord(fams[f])) byFamily[f] = spentOf(fams[f])
  return { ...spentOf(r), byFamily }
}

/** The tally with the rows that leave the list added, each once, under its model's family. */
export function retire(retired: Retired, rows: readonly AgentRun[]): Retired {
  let out = normalizeRetired(retired)
  for (const a of Array.isArray(rows) ? rows : []) {
    if (!isRecord(a)) continue
    const spent = spentOf(a)
    const family = familyOf(typeof a.model === 'string' ? a.model : '')
    out = { ...plusSpent(out, spent), byFamily: { ...out.byFamily, [family]: plusSpent(out.byFamily[family] ?? { use: emptyUse(), costUsd: 0 }, spent) } }
  }
  return out
}

/** The main agent's usage with one request's added under the family of the model it ran on. */
export function tallyMain(main: MainRun, model: string, u: RequestUsage, costUsd: number): Partial<Record<ModelFamily, Spent>> {
  const fams = isRecord(main?.byFamily) ? main.byFamily : {}
  const family = familyOf(model)
  return { ...fams, [family]: plusSpent(spentOf(fams[family]), { use: addUse(emptyUse(), u), costUsd: usd(costUsd) }) }
}

// The engine's own session cost beats our sum of list prices whenever it reports one. The
// rows no longer listed count through `retired`, so the totals never go down.
export function totals(main: MainRun, agents: AgentRun[], usage: Usage, now: number, retired?: Retired): Totals {
  const gone = normalizeRetired(retired)
  const use = agents.reduce(
    (u, a) => ({
      input: u.input + a.use.input,
      output: u.output + a.use.output,
      cacheRead: u.cacheRead + a.use.cacheRead,
      cacheWrite: u.cacheWrite + a.use.cacheWrite,
    }),
    plusUse(main.use, gone.use),
  )
  const engine = num(usage.costUsd)
  return {
    costUsd: engine ?? agents.reduce((s, a) => s + a.costUsd, main.costUsd + gone.costUsd),
    isEstimate: engine === undefined,
    use,
    tokens: useTotal(use),
    timeMs: Math.max(0, now - usage.sessionStartedAt),
  }
}

/** The model families the usage split counts by. */
export type { ModelFamily }
export const MODEL_FAMILIES: readonly ModelFamily[] = ['Fable', 'Opus', 'Sonnet', 'Haiku', 'other']

/** A model id's family: `claude-opus-5-5` is `Opus`, Mythos counts as Fable, anything else is `other`. */
export function familyOf(model: string): ModelFamily {
  const id = typeof model === 'string' ? model.toLowerCase() : ''
  if (/fable|mythos/.test(id)) return 'Fable'
  if (/opus/.test(id)) return 'Opus'
  if (/sonnet/.test(id)) return 'Sonnet'
  if (/haiku/.test(id)) return 'Haiku'
  return 'other'
}

export type UsagePart = { tokens: number; costUsd: number }

/**
 * The session's tokens and list-price cost: the main agent against the subagents together
 * (`retired` is the part of the subagents' that the rows no longer listed had spent), and
 * by model family across both.
 */
export type UsageSplit = { main: UsagePart; agents: UsagePart; retired: UsagePart; models: Record<ModelFamily, UsagePart> }

/**
 * The usage split: tokens counted as the SESSION tiles count them (input, output, cache
 * reads and cache writes), cost as each run's sum of list prices. The main agent's usage
 * counts under the family each request ran on (`MainRun.byFamily`); what that tally lacks
 * (state from an older version) counts under the model it runs on now. Rows no longer
 * listed count through `retired`, by their families. Total: junk counts as zero.
 */
export function usageSplit(main: MainRun, agents: AgentRun[], retired?: Retired): UsageSplit {
  const tokensOf = (u: unknown): number => useTotal(useOf(u))
  const models = Object.fromEntries(MODEL_FAMILIES.map(f => [f, { tokens: 0, costUsd: 0 }])) as Record<ModelFamily, UsagePart>
  const add = (part: UsagePart, family: ModelFamily, tokens: number, costUsd: number): void => {
    part.tokens += tokens
    part.costUsd += costUsd
    models[family].tokens += tokens
    models[family].costUsd += costUsd
  }
  const mainPart: UsagePart = { tokens: 0, costUsd: 0 }
  const agentsPart: UsagePart = { tokens: 0, costUsd: 0 }
  const retiredPart: UsagePart = { tokens: 0, costUsd: 0 }
  if (isRecord(main)) {
    const fams = isRecord(main.byFamily) ? main.byFamily : {}
    let tokens = 0
    let costUsd = 0
    for (const f of MODEL_FAMILIES) {
      if (!isRecord(fams[f])) continue
      const x = spentOf(fams[f])
      add(mainPart, f, useTotal(x.use), x.costUsd)
      tokens += useTotal(x.use)
      costUsd += x.costUsd
    }
    const rest = Math.max(0, tokensOf(main.use) - tokens)
    const restUsd = Math.max(0, usd(main.costUsd) - costUsd)
    if (rest > 0 || restUsd > 0) add(mainPart, familyOf(typeof main.model === 'string' ? main.model : ''), rest, restUsd)
  }
  for (const a of Array.isArray(agents) ? agents : []) if (isRecord(a)) add(agentsPart, familyOf(typeof a.model === 'string' ? a.model : ''), tokensOf(a.use), usd(a.costUsd))
  const gone = normalizeRetired(retired)
  for (const f of MODEL_FAMILIES) {
    const x = gone.byFamily[f]
    if (!x) continue
    add(agentsPart, f, useTotal(x.use), x.costUsd)
    retiredPart.tokens += useTotal(x.use)
    retiredPart.costUsd += x.costUsd
  }
  return { main: mainPart, agents: agentsPart, retired: retiredPart, models }
}

// ---------------------------------------------------------------------------
// Gauges: rate limits read as what is left, context as what is used.

/**
 * One meter. `isResetting`: a limit whose reset time has passed while no fresh figure has
 * arrived (see `RESETTING_MS`); its `used`/`left` are the stale figures, `resetIn` is
 * null and `tone` calm, and it is drawn muted with an empty meter, reading `resetting…`.
 */
export type Gauge = { kind: string; label: string; used: number; left: number; resetIn: number | null; tone: 'calm' | 'warn' | 'alert'; isResetting?: boolean }

/** How long a limit whose reset time has passed is still shown, as `resetting…`, before it is dropped. */
export const RESETTING_MS = 10 * 60_000

/** The tone of what is left, in percent: alert at 10 or less, warn at 30 or less, else calm. */
export function toneOfLeft(left: number): Gauge['tone'] {
  const v = num(left) ?? 100
  return v <= 10 ? 'alert' : v <= 30 ? 'warn' : 'calm'
}

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }

const MODEL_WEEK = 'seven_day_'

// A model-specific weekly window (`seven_day_fable`), shown by the `model_week` bar item.
export function isModelWeek(kind: string): boolean {
  return typeof kind === 'string' && kind.startsWith(MODEL_WEEK) && kind.length > MODEL_WEEK.length
}

// `seven_day_fable` -> `Week · Fable`, `seven_day_opus_5` -> `Week · Opus 5`.
const limitLabel = (kind: string): string => {
  const known = Object.hasOwn(LIMIT_LABELS, kind) ? LIMIT_LABELS[kind] : undefined
  if (known) return known
  if (!isModelWeek(kind)) return printable(kind)
  const name = printable(
    kind
      .slice(MODEL_WEEK.length)
      .split('_')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  )
  return name ? `Week · ${name}` : printable(kind)
}

/**
 * A limit as a gauge of what is left; tone by `toneOfLeft`. A window whose reset time has
 * passed says nothing about the new one: for `RESETTING_MS` after it, the gauge is marked
 * `isResetting` (calm, no reset time); later it is null.
 */
export function gaugeOf(limit: Limit, now: number): Gauge | null {
  if (!isRecord(limit) || typeof limit.kind !== 'string') return null
  // A window with no figure yet is left out.
  const percent = num(limit.percentUsed)
  if (percent === undefined) return null
  const at = typeof limit.resetsAt === 'string' ? Date.parse(limit.resetsAt) : NaN
  const used = clamp(percent, 0, 100)
  const left = clamp(100 - used, 0, 100)
  const base = { kind: limit.kind, label: limitLabel(limit.kind), used, left }
  if (Number.isFinite(at) && at <= now) {
    if (now - at > RESETTING_MS) return null
    return { ...base, resetIn: null, tone: 'calm', isResetting: true }
  }
  return { ...base, resetIn: Number.isFinite(at) ? at - now : null, tone: toneOfLeft(left) }
}

const limitRank = (kind: string): number =>
  kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : isModelWeek(kind) ? 2 : kind === 'spend_limit' ? 3 : 4

// The gauge of every limit the engine reports, once per kind (the first reported wins):
// 5h, Week, the model-specific weekly windows by name, Spend, then any other kind by name.
// A window that reset within `RESETTING_MS` is among them, marked `isResetting`.
export function limitGauges(usage: Usage, now: number): Gauge[] {
  const limits: unknown[] = Array.isArray(usage?.limits) ? usage.limits : []
  const seen = new Set<string>()
  const out: Gauge[] = []
  for (const l of limits) {
    const g = gaugeOf(l as Limit, now)
    if (!g || seen.has(g.kind)) continue
    seen.add(g.kind)
    out.push(g)
  }
  return out.sort((a, b) => limitRank(a.kind) - limitRank(b.kind) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
}

const isGauge = (g: unknown): g is Gauge => isRecord(g) && typeof g.kind === 'string'

/**
 * The gauge the bar's "Usage left" item shows: the 5-hour window, else the week, else the
 * first model week in the order given; undefined when there is none. Never throws.
 */
export function usageLeftGauge(gauges: Gauge[]): Gauge | undefined {
  const list = (Array.isArray(gauges) ? gauges : []).filter(isGauge)
  return list.find(g => g.kind === 'five_hour') ?? list.find(g => g.kind === 'seven_day') ?? list.find(g => isModelWeek(g.kind))
}

/**
 * The bar's limit items in the person's order, with the gauge each shows: `fiveHour` shows
 * `usageLeftGauge`, `week` the week, `model_week` one entry per model week in the gauges'
 * order. A gauge is shown once: the earlier item keeps it. An item with nothing left to
 * show, and every other item, gives no entry. Never throws; the inputs are left as they are.
 */
export function barLimitGauges(items: readonly string[], gauges: Gauge[]): { item: string; gauge: Gauge }[] {
  if (!Array.isArray(items)) return []
  const list = (Array.isArray(gauges) ? gauges : []).filter(isGauge)
  const taken = new Set<string>()
  const done = new Set<string>()
  const out: { item: string; gauge: Gauge }[] = []
  const give = (item: string, g: Gauge | undefined): void => {
    if (!g || taken.has(g.kind)) return
    taken.add(g.kind)
    out.push({ item, gauge: g })
  }
  for (const item of items) {
    if (typeof item !== 'string' || done.has(item)) continue
    done.add(item)
    if (item === 'fiveHour') give(item, usageLeftGauge(list))
    else if (item === 'week') give(item, list.find(g => g.kind === 'seven_day'))
    else if (item === 'model_week') for (const g of list.filter(x => isModelWeek(x.kind))) give(item, g)
  }
  return out
}

/** One group of the session card: its heading, the figures it shows and its gauge entries. */
export type CardGroup<T> = { key: 'session' | 'plan'; title: string; figures: string[]; entries: T[] }

/**
 * The session card in two groups. `Session`: the figures (Cost, Tokens, Time) and the
 * Context entry. `Plan · <name>` (`Plan` when the name is not known): the plan's windows,
 * the 5-hour first, then the week, the model weeks in the order given, then any other
 * limit; left out when there is none. Entries are passed through as they came. Never throws.
 */
export function cardGroups<T extends { gauge: Gauge }>(entries: T[], plan?: string): CardGroup<T>[] {
  const list = (Array.isArray(entries) ? entries : []).filter((x): x is T => isRecord(x) && isGauge(x.gauge))
  const context = list.filter(x => x.gauge.kind === 'context')
  const limits = list.filter(x => x.gauge.kind !== 'context')
  const rank = (kind: string): number => (kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : isModelWeek(kind) ? 2 : 3)
  // A stable sort: the model weeks keep the order they came in.
  const windows = limits.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x.gauge.kind) - rank(b.x.gauge.kind) || a.i - b.i).map(a => a.x)
  const out: CardGroup<T>[] = [{ key: 'session', title: 'Session', figures: ['Cost', 'Tokens', 'Time'], entries: context }]
  const name = typeof plan === 'string' ? printable(plan) : ''
  if (windows.length) out.push({ key: 'plan', title: name ? `Plan · ${name}` : 'Plan', figures: [], entries: windows })
  return out
}

const MAX_STORED_LIMITS = 20

/**
 * The last known limits, read back from what was stored (`{ at, limits }`): each well-formed
 * limit whose `resetsAt` is still after `now`. A window that has reset, or has no reset
 * time, says nothing about the current one and is dropped; junk reads as none.
 */
export function freshLimits(stored: unknown, now: number): Limit[] {
  if (!isRecord(stored) || !Array.isArray(stored.limits) || num(now) === undefined) return []
  const out: Limit[] = []
  for (const l of stored.limits.slice(0, MAX_STORED_LIMITS)) {
    if (!isRecord(l) || typeof l.kind !== 'string' || !l.kind || typeof l.resetsAt !== 'string') continue
    const percentUsed = num(l.percentUsed)
    const at = Date.parse(l.resetsAt)
    if (percentUsed === undefined || !Number.isFinite(at) || at <= now) continue
    out.push({ kind: l.kind, percentUsed, resetsAt: l.resetsAt })
  }
  return out
}

const MAX_APP_WINDOWS = 20

// The app's window label as a limit kind: `5-hour limit` -> `five_hour`, `Weekly · all
// models` -> `seven_day`, `Weekly · Fable` -> `seven_day_fable`; undefined for any other.
const appKind = (label: unknown): string | undefined => {
  if (typeof label !== 'string') return undefined
  const text = label.replace(/\s+/g, ' ').trim().toLowerCase()
  if (text === '5-hour limit') return 'five_hour'
  const week = /^weekly\s*[·•:|–—-]\s*(.+)$/.exec(text)
  if (!week) return undefined
  const name = (week[1] ?? '').trim()
  if (name === 'all models') return 'seven_day'
  const key = name.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return key ? `${MODEL_WEEK}${key}` : undefined
}

/**
 * The limits in the desktop app's usage answer (`get_usage` on its session server), from
 * its JSON text: `{ plan: { status: 'ok', windows: [{ label, percentUsed, resetsAt }] } }`.
 * Known labels only (see `appKind`), each kind once (the first wins); a reset time that is
 * not a date reads as unknown. Junk, unparseable text or a status other than `ok` give
 * `[]`. Never throws.
 */
export function appLimits(text: string): Limit[] {
  if (typeof text !== 'string') return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const plan = isRecord(data) ? data.plan : undefined
  if (!isRecord(plan) || plan.status !== 'ok' || !Array.isArray(plan.windows)) return []
  const out: Limit[] = []
  for (const w of plan.windows.slice(0, MAX_APP_WINDOWS)) {
    if (!isRecord(w)) continue
    const kind = appKind(w.label)
    const percentUsed = num(w.percentUsed)
    if (kind === undefined || percentUsed === undefined || out.some(l => l.kind === kind)) continue
    const resetsAt = typeof w.resetsAt === 'string' && Number.isFinite(Date.parse(w.resetsAt)) ? w.resetsAt : null
    out.push({ kind, percentUsed, resetsAt })
  }
  return out
}

const MAX_PLAN_NAME = 24

/**
 * The plan's name in the desktop app's usage answer (`plan.plan`, `Ultra`), read from the
 * same JSON text as `appLimits`: only with `plan.status` 'ok' and a name that is a
 * non-empty string. Control characters are removed, the rest trimmed and cut to 24
 * characters. Undefined for anything else. Never throws.
 */
export function appPlan(text: string): string | undefined {
  if (typeof text !== 'string') return undefined
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  const plan = isRecord(data) ? data.plan : undefined
  if (!isRecord(plan) || plan.status !== 'ok' || typeof plan.plan !== 'string') return undefined
  const name = plan.plan
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PLAN_NAME)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trim()
  return name || undefined
}

/**
 * The engine's limits with the app's added: every well-formed engine limit in its own
 * order (its kinds win), then each app limit whose kind the engine did not report, in the
 * app's order, once. Given `now`, an engine limit whose reset time has passed gives way to
 * the app's of the same kind when the app's resets later: the app's figure is the fresh
 * one. Junk on either side is skipped. Never throws.
 */
export function mergeLimits(engine: Limit[], app: Limit[], now?: number): Limit[] {
  const ok = (l: unknown): l is Limit => isRecord(l) && typeof l.kind === 'string' && l.kind !== ''
  const resets = (l: Limit): number => (typeof l.resetsAt === 'string' ? Date.parse(l.resetsAt) : NaN)
  const apps = (Array.isArray(app) ? app : []).filter(ok)
  const out: Limit[] = (Array.isArray(engine) ? engine : []).filter(ok).map(l => {
    const at = resets(l)
    if (num(now) === undefined || !Number.isFinite(at) || at > (now as number)) return l
    const fresh = apps.find(x => x.kind === l.kind && resets(x) > at)
    return fresh ?? l
  })
  const seen = new Set(out.map(l => l.kind))
  for (const l of Array.isArray(app) ? app : []) {
    if (!ok(l) || seen.has(l.kind)) continue
    seen.add(l.kind)
    out.push(l)
  }
  return out
}

export function contextGauge(usage: Usage): Gauge {
  const fromTokens =
    num(usage.contextTokens) !== undefined && usage.contextWindow > 0 ? ((usage.contextTokens ?? 0) / usage.contextWindow) * 100 : undefined
  const used = clamp(num(usage.contextPercent) ?? num(fromTokens) ?? 0, 0, 100)
  // The limits' rule on what is left of the window: alert from 90% used, warn from 70%.
  return { kind: 'context', label: 'Context', used, left: 100 - used, resetIn: null, tone: toneOfLeft(100 - used) }
}

// ---------------------------------------------------------------------------
// Activity: a few words on what a tool call or a thought is doing.

const MAX_DETAIL = 60
const MAX_ACTIVITY = 80

const baseName = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed || path
}

// No URL global in a pure module: the host is everything between `//` and the path.
const hostOf = (url: string): string => /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i.exec(url)?.[1] ?? url

export function activityOf(tool: string, args: Record<string, unknown>): string {
  const name = typeof tool === 'string' ? tool : ''
  const a = isRecord(args) ? args : {}
  const raw = (key: string): string => {
    const v = a[key]
    return typeof v === 'string' ? printable(v) : ''
  }
  const arg = (key: string): string => clip(raw(key), MAX_DETAIL)
  // The name is cut after the folders go: a long path keeps its file name.
  const file = (key: string): string => clip(baseName(raw(key)), MAX_DETAIL)
  const or = (detail: string, withIt: (d: string) => string, without: string): string => (detail ? withIt(detail) : without)

  const label = ((): string => {
    switch (name) {
      case 'Bash':
      case 'PowerShell':
        return arg('description') || or(arg('command'), d => `Running ${d}`, 'Running a command')
      case 'Read':
        return or(file('file_path'), d => `Reading ${d}`, 'Reading a file')
      case 'Edit':
      case 'MultiEdit':
        return or(file('file_path'), d => `Editing ${d}`, 'Editing a file')
      case 'Write':
        return or(file('file_path'), d => `Writing ${d}`, 'Writing a file')
      case 'NotebookEdit':
        return or(file('notebook_path'), d => `Editing ${d}`, 'Editing a notebook')
      case 'Grep':
        return or(arg('pattern'), d => `Searching for "${d}"`, 'Searching files')
      case 'Glob':
        return or(arg('pattern'), d => `Finding files ${d}`, 'Finding files')
      case 'WebFetch':
        return or(arg('url'), d => `Fetching ${hostOf(d)}`, 'Fetching a page')
      case 'WebSearch':
        return or(arg('query'), d => `Searching the web for "${d}"`, 'Searching the web')
      case 'Agent':
      case 'Task':
        return or(arg('description'), d => `Running an agent: ${d}`, 'Running an agent')
      case 'TodoWrite':
        return 'Updating the todo list'
      case 'AskUserQuestion':
        return 'Waiting for your answer'
      case 'Skill':
        return or(arg('skill'), d => `Using the ${d} skill`, 'Using a skill')
      case 'ToolSearch':
        return or(arg('query'), d => `Looking up tools: ${d}`, 'Looking up tools')
    }
    if (name.startsWith('mcp__')) {
      const [server = '', ...rest] = name.slice(5).split('__')
      const fn = rest.join('__')
      return server && fn ? `Using ${server}: ${fn}` : `Using ${server || fn || 'a tool'}`
    }
    return name.trim() ? `Using ${name}` : 'Using a tool'
  })()
  return clip(printable(label), MAX_ACTIVITY)
}

// The string arguments a call's input has streamed so far, read from its partial
// JSON: enough to name the file or command before the input is whole.
export function partialArgsOf(json: string): Record<string, string> {
  const args: Record<string, string> = {}
  if (typeof json !== 'string') return args
  for (const match of json.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"((?:[^"\\]|\\.)*)/g)) {
    const [, key = '', raw = ''] = match
    args[key] ??= unescaped(raw)
  }
  return args
}

// A value cut mid-stream can end inside a `\u` escape; drop the stub and read the rest.
const unescaped = (raw: string): string => {
  for (const text of [raw, raw.replace(/\\u[0-9a-fA-F]{0,3}$/, '')]) {
    try {
      return JSON.parse(`"${text}"`) as string
    } catch {
      // Try the next reading.
    }
  }
  return raw
}

const MAX_THOUGHT = 70

// The sentence Claude is thinking now, with the one before when the current one has
// barely started; cut from the front, since the newest words matter most.
export function thoughtOf(buffer: string): string {
  const flat = printable(typeof buffer === 'string' ? buffer.replace(/[*_`#>]/g, '') : '')
  if (!flat) return ''
  const sentences = flat.split(/(?<=[.!?:])\s+/)
  const last = sentences.at(-1) ?? ''
  const before = sentences.at(-2)
  const tail = last.length < 25 && before !== undefined ? `${before} ${last}` : last
  return tail.length > MAX_THOUGHT ? `…${tail.slice(-(MAX_THOUGHT - 1))}` : tail
}

// ---------------------------------------------------------------------------
// Logs: each row's recent history, bounded so state stays small.

export function pushLog(log: LogEntry[], entry: LogEntry, cap = 400): LogEntry[] {
  const n = Math.max(1, Math.floor(num(cap) ?? 400))
  return [...log, entry].slice(-n)
}

/** The open entry of call `callId` closed with `outcome`; with no id known, the newest open entry. */
export function closeLog(log: LogEntry[], at: number, outcome: LogOutcome, callId?: string): LogEntry[] {
  const i = callId !== undefined ? log.findLastIndex(e => e.outcome === 'open' && e.callId === callId) : log.findLastIndex(e => e.outcome === 'open')
  const open = log[i]
  if (!open) return log
  const next = [...log]
  next[i] = { ...open, outcome, ms: Math.max(0, at - open.at) }
  return next
}

// ---------------------------------------------------------------------------
// The agents pane across a restart of the session's process.

/** The most sessions the open-pane record keeps; past it the oldest entry goes. */
export const MAX_PANE_OPEN = 20

/**
 * The open-pane record as stored: one entry per session whose agents pane is open, its id
 * to the time the entry was written. Junk (another shape, a non-number time) is dropped.
 */
export function paneOpenEntries(stored: unknown): Record<string, number> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return Object.fromEntries(Object.entries(stored).filter(([id, at]) => id && typeof at === 'number' && Number.isFinite(at)))
}

/** The record with session `id`'s entry written at `at`, keeping the newest MAX_PANE_OPEN. */
export function withPaneOpen(stored: unknown, id: string, at: number): Record<string, number> {
  const rest = Object.entries(paneOpenEntries(stored)).filter(([k]) => k !== id)
  const kept = rest.sort((a, b) => b[1] - a[1]).slice(0, MAX_PANE_OPEN - 1)
  return Object.fromEntries([...kept, [id, at]])
}

/** The record without session `id`'s entry; the others stay. */
export function withoutPaneOpen(stored: unknown, id: string): Record<string, number> {
  return Object.fromEntries(Object.entries(paneOpenEntries(stored)).filter(([k]) => k !== id))
}

/** Whether a close of the agents pane forgets that it is open: the mod's or the person's do; an unload (the process going) does not. */
export function closeForgetsPane(origin: { kind?: unknown } | undefined): boolean {
  return origin?.kind !== 'unload'
}

/** Whether a session start reopens the agents pane: a resume of a session whose entry the record holds. */
export function reopensPane(source: unknown, sessionId: unknown, stored: unknown): boolean {
  return source === 'resume' && typeof sessionId === 'string' && sessionId !== '' && Object.prototype.hasOwnProperty.call(paneOpenEntries(stored), sessionId)
}
