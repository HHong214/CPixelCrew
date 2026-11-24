import { describe, expect, test } from 'claude-code/testing'

import type { AgentRun, ChartKind, Flow, LogEntry, MainRun, PaletteName, Rates, Settings, ThemeName, Usage } from '../types'
import {
  BAR_H,
  ENTER_MS,
  TONES,
  agentDrawing,
  backdropDrawing,
  cacheLine,
  collapsedDrawing,
  compactAgentDrawing,
  compactCardDrawing,
  compactFootDrawing,
  compactMainDrawing,
  entrance,
  gaugeGrid,
  iconDrawing,
  logDrawing,
  mainDrawing,
  meterDrawing,
  pillIconDrawing,
  pillText,
  pillTint,
  plannedDrawing,
  progressDrawing,
  sectionDrawing,
  sessionCardDrawing,
  splitShares,
  stripSegments,
  tipLines,
  titleDrawing,
  usageGauges,
} from '../hooks/draw'
import type { CardData, Ctx, Drawing, IconName, PillData, PillIcon, PillItem, PillKind, PillText, TipTarget } from '../hooks/draw'
import { FALLBACK_RATES, FLOW_ACCENT, FLOW_DONE, OTHER_HUES, PALETTES, agentColor, blankMain, blankRetired, blankUsage, contextGauge, fmtTokens, gaugeOf, retire, shiftColor, tabularWidth, textWidth, totals, usageSplit } from '../hooks/model'
import type { Gauge, Planned, TaskState } from '../hooks/model'
import * as draw from '../hooks/draw'
import { sprite } from '../hooks/sprites'
import type { Pose } from '../hooks/sprites'

const NOW = Date.parse('2026-11-13T12:00:00Z') // a Friday
const MIN = 60_000
const HOUR = 60 * MIN
const rates: Rates = { at: NOW, rates: FALLBACK_RATES, isLive: false }
const THEMES: ThemeName[] = ['clawd', 'cat']
const KINDS: ChartKind[] = ['ring', 'bar']
const PALETTE_LIST: PaletteName[] = ['classic', 'ocean', 'sunset']
const WIDTHS = [240, 320, 480, 700, 1000]
const LONG = 'An extremely long task description that keeps going '.repeat(8)
const CJK = '为面板设计一组新的像素吉祥物并检查它们在深色背景上的对比度'
const CMD = 'Running SRC="/c/Users/someone/AppData/Roaming/Claude/scratch/pixel-crew" && npx tsc -p "$SRC"'

// Settings spelled out so these tests do not lean on model.ts's defaults.
const SETTINGS: Settings = {
  theme: 'clawd',
  palette: 'classic',
  barColors: 'kind',
  background: 'dots',
  animations: true,
  textSize: 100,
  iconSize: 100,
  barSize: 100,
  currency: 'USD',
  panelUsage: 'bar',
  barUsage: 'bar',
  barItems: ['context', 'fiveHour', 'week', 'model_week', 'speed', 'cache'],
  autoOpen: 'plan',
  logLines: 15,
  barTooltips: true,
}
const settingsOf = (o: Partial<Settings> = {}): Settings => ({ ...SETTINGS, ...o })
const ctxOf = (W: number, o: Partial<Settings> = {}, enterAgeMs?: number): Ctx => ({ W, now: NOW, settings: settingsOf(o), rates, ...(enterAgeMs === undefined ? {} : { enterAgeMs }) })

const fullMain = (): MainRun => ({
  ...blankMain(NOW - HOUR),
  status: 'working',
  doing: 'Editing draw.ts',
  model: 'claude-fable-5-2',
  effort: 'high',
  turns: 12,
  turnStartedAt: NOW - 42_000,
  workedMs: 11 * MIN,
  use: { input: 1_200_000, output: 96_000, cacheRead: 14_000_000, cacheWrite: 310_000 },
  costUsd: 9.8,
  contextTokens: 270_000,
  contextMax: 1_000_000,
  log: [],
})

const fullUsage = (): Usage => ({
  ...blankUsage(NOW - HOUR),
  limits: [
    { kind: 'five_hour', percentUsed: 60, resetsAt: new Date(NOW + 3 * HOUR + 5 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 37, resetsAt: new Date(NOW + 88 * HOUR).toISOString() },
    { kind: 'seven_day_fable', percentUsed: 81, resetsAt: new Date(NOW + 88 * HOUR).toISOString() },
  ],
  costUsd: 11.73,
  turnCostUsd: 0.42,
  contextTokens: 517_000,
  contextWindow: 1_000_000,
  contextPercent: 52,
  speed: 91,
  cacheExpiresAt: NOW + 52 * MIN,
})

const run = (o: Partial<AgentRun> = {}): AgentRun => ({
  id: 'r1',
  type: 'pixel-crew:engineer',
  kind: 'refactor',
  tint: 0,
  description: 'Port the progress row',
  model: 'claude-opus-5-5',
  effort: 'high',
  status: 'running',
  startedAt: NOW - 92_000,
  contextTokens: 120_000,
  contextMax: 1_000_000,
  use: { input: 12_000, output: 3_000, cacheRead: 240_000, cacheWrite: 18_000 },
  costUsd: 0.42,
  steps: 4,
  round: 1,
  stepDone: 3,
  stepTotal: 6,
  stepNote: 'ticks',
  doing: 'Editing draw.ts',
  doingSince: NOW,
  log: [],
  ...o,
})

const emptyRun = (): AgentRun => ({
  id: 'r0',
  type: '',
  kind: 'other',
  tint: 0,
  description: '',
  model: '',
  status: 'running',
  startedAt: NOW,
  contextTokens: 0,
  contextMax: 0,
  use: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  steps: 0,
  round: 0,
  doing: '',
  doingSince: NOW,
  log: [],
})

const LOG: LogEntry[] = [
  { at: NOW - 9 * MIN, kind: 'turn', text: 'Build the drawing module', outcome: 'ok' },
  { at: NOW - 8 * MIN, kind: 'think', text: 'Thinking: the spec fixes every height, so start from the rows and work up to the whole panel', outcome: 'ok', ms: 6200 },
  { at: NOW - 7 * MIN, kind: 'tool', text: 'Reading SPEC.md', outcome: 'ok', ms: 140 },
  { at: NOW - 6 * MIN, kind: 'tool', text: 'Running npx tsc', outcome: 'error', ms: 8100 },
  { at: NOW - 5 * MIN, kind: 'tool', text: 'Running rm -rf node_modules', outcome: 'denied', ms: 2400 },
  { at: NOW - 4 * MIN, kind: 'step', text: '3/6 · previews', outcome: 'ok' },
  { at: NOW - 3 * MIN, kind: 'reply', text: 'Writing the reply', outcome: 'ok', ms: 75_000 },
  { at: NOW - 10_000, kind: 'tool', text: 'Running claude plugin test', outcome: 'open' },
]

const planned: Planned = { title: 'Write the README', kind: 'write', model: 'opus', effort: 'medium', after: [2, 3], n: 4 }
const flow = { title: 'pixel-crew build', total: 6, done: 3, running: 2, phase: 'delegate' as const, isFinished: false, tasks: [] }
const STATES: TaskState[] = ['none', 'running', 'paused', 'done']
const limit = (kind: string, used: number, resetIn: number | null): Gauge =>
  gaugeOf({ kind, percentUsed: used, resetsAt: resetIn === null ? null : new Date(NOW + resetIn).toISOString() }, NOW) as Gauge

// Balanced tags, attributes quoted, nothing left open: enough to catch a broken template.
function wellFormed(src: string): string | null {
  const stack: string[] = []
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  let at = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const between = src.slice(at, m.index)
    if (/[<>]/.test(between.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) return `stray bracket before ${m[0].slice(0, 40)}`
    at = re.lastIndex
    const [, close, name, , self] = m
    if (self) continue
    if (close) {
      if (stack.pop() !== name) return `unexpected </${name}>`
    } else stack.push(name ?? '')
  }
  if (/[<>]/.test(src.slice(at))) return 'stray bracket at the end'
  return stack.length ? `unclosed <${stack.join('>, <')}>` : null
}

const unxml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

type Txt = { x: number; y: number; anchor: string; size: number; ls: number; s: string; left: number; right: number }

// Every <text> by the same width estimate the drawings use, with its left and right edge.
function texts(src: string): Txt[] {
  const out: Txt[] = []
  for (const m of src.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = m[3] ?? ''
    const anchor = /text-anchor="(\w+)"/.exec(a)?.[1] ?? 'start'
    const size = Number(/font-size="([\d.]+)"/.exec(a)?.[1] ?? 0)
    const ls = Number(/letter-spacing="([\d.]+)"/.exec(a)?.[1] ?? 0)
    const s = unxml((m[4] ?? '').replace(/<[^>]+>/g, ''))
    const x = Number(m[1])
    const w = textWidth(s, size) + ls * [...s].length
    const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x
    out.push({ x, y: Number(m[2]), anchor, size, ls, s, left, right: left + w })
  }
  return out
}

// No text runs past either edge of its drawing.
function inside(d: Drawing, what: string): void {
  for (const t of texts(d.source)) {
    expect(t.left >= -0.5 && t.right <= d.width + 0.5 ? 'ok' : `${what}: "${t.s}" spans ${Math.round(t.left)}..${Math.round(t.right)} in ${d.width}`).toBe('ok')
  }
}

// No two texts on one baseline overlap.
function apart(d: Drawing, what: string): void {
  const rows = new Map<number, Txt[]>()
  for (const t of texts(d.source)) rows.set(t.y, [...(rows.get(t.y) ?? []), t])
  for (const list of rows.values()) {
    const sorted = [...list].sort((a, b) => a.left - b.left)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1] as Txt
      const b = sorted[i] as Txt
      expect(a.right <= b.left + 0.5 ? 'ok' : `${what}: "${a.s}" overlaps "${b.s}"`).toBe('ok')
    }
  }
}

function check(d: Drawing | null, what: string): void {
  if (!d) return
  const problem = wellFormed(d.source)
  expect(problem === null ? 'ok' : `${what}: ${problem}`).toBe('ok')
  expect(d.source.length).toBeLessThan(131_073)
  expect(d.height).toBeLessThan(4097)
  expect(/NaN|undefined|null|Infinity/.test(d.source) ? `${what}: bad value in source` : 'ok').toBe('ok')
  expect(/NaN|undefined|null|Infinity/.test(d.alt) ? `${what}: bad value in alt` : 'ok').toBe('ok')
  expect(d.source.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}"`)).toBe(true)
  expect(d.alt.length).toBeGreaterThan(3)
  // Control characters make the engine refuse the tree.
  expect(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(d.alt) ? `${what}: control character in alt` : 'ok').toBe('ok')
}

// Sprite style blocks: a document holding a sprite carries its theme's CSS exactly once.
const styleCount = (src: string): number => (src.match(/<style>/g) ?? []).length

// The panel's drawings for one setting of the matrix, full or empty data.
function panel(W: number, theme: ThemeName, kind: ChartKind, full: boolean, iconSize = 100, enterAgeMs?: number): [string, Drawing][] {
  const c = ctxOf(W, { theme, panelUsage: kind, barUsage: kind, iconSize }, enterAgeMs)
  const main = full ? { ...fullMain(), doing: CMD, log: LOG } : blankMain(NOW)
  const usage = full ? fullUsage() : blankUsage(NOW)
  const agents = full ? [run(), run({ id: 'r2', status: 'waiting', kind: 'debug', description: CJK.repeat(7) }), run({ id: 'r3', status: 'done', description: LONG }), run({ id: 'r4', status: 'failed', round: 2, stepTotal: undefined })] : [emptyRun()]
  const t = totals(main, agents, usage, NOW)
  const data: CardData = { main, agents, usage, totals: t, workedMs: full ? 12 * MIN : undefined }
  const out: [string, Drawing][] = [
    ['title', titleDrawing(c, full ? LONG : '')],
    ['card', sessionCardDrawing(c, data)],
    ['card, usage off', sessionCardDrawing(ctxOf(W, { theme, panelUsage: 'off', iconSize }, enterAgeMs), data)],
    ['compact card', compactCardDrawing(c, t, usage)],
    ['compact main', compactMainDrawing(c, main, full ? flow : null, full ? 2 : 0)],
    ['compact foot', compactFootDrawing(c, full ? 1 : 0, full ? 2 : 0, full ? 1 : 0)],
    ['main', mainDrawing(c, main, full ? 2 : 0, usage, full ? { ...flow, title: LONG } : null)],
    ['main, short task', mainDrawing(c, main, full ? 2 : 0, usage, full ? flow : { ...flow, isFinished: true })],
    ['log', logDrawing(c, main.log, '#D97757')],
    ['planned', plannedDrawing(c, full ? { ...planned, title: LONG } : { title: '', kind: '', model: '', effort: '', after: [], n: 1 })],
    ['section', sectionDrawing(c, 'Working', agents.length)],
    ['section, no count', sectionDrawing(c, 'Main agent')],
    ['log with its cache line', logDrawing(c, main.log, '#D97757', cacheLine(main.use))],
  ]
  agents.forEach((a, i) => out.push([`agent ${i}`, agentDrawing(c, a)], [`compact agent ${i}`, compactAgentDrawing(c, a)]))
  return out
}

describe('every drawing is well formed', () => {
  test('panel drawings across themes, chart kinds, widths, mascot sizes, full and empty data', async () => {
    for (const W of WIDTHS)
      for (const theme of THEMES)
        for (const kind of KINDS)
          for (const full of [true, false])
            for (const iconSize of [50, 100, 250])
              for (const [what, d] of panel(W, theme, kind, full, iconSize, iconSize === 100 ? 120 : undefined)) {
                const label = `${what} W=${W} ${theme} ${kind} ${full ? 'full' : 'empty'} icon ${iconSize}`
                check(d, label)
                expect(d.width).toBe(W)
                inside(d, label)
              }
  })

  test('nothing overlaps at W 240, 320, 480 and 700', async () => {
    for (const W of [240, 320, 480, 700])
      for (const kind of KINDS)
        for (const full of [true, false])
          for (const [what, d] of panel(W, 'clawd', kind, full)) {
            apart(d, `${what} W=${W} ${kind}`)
          }
  })

  test('bar drawings at every width, full and empty', async () => {
    for (const W of WIDTHS)
      for (const theme of THEMES)
        for (const full of [true, false]) {
          const s = settingsOf({ theme })
          const f = full ? flow : { ...flow, title: '', total: 0, done: 0, running: 0 }
          for (const state of STATES) check(progressDrawing(f, W, s, state, full ? 6 : 0, full ? 2 : 0, full ? 100 : undefined), `progress ${W} ${state}`)
          const idle = progressDrawing(null, W, s, 'none', 0, 0, full ? 100 : undefined)
          check(idle, `idle progress ${W}`)
          inside(idle, `idle progress ${W}`)
          apart(idle, `idle progress ${W}`)
          for (const state of STATES) check(collapsedDrawing({ W, now: NOW, flow: full ? flow : null, state, usage: full ? fullUsage() : blankUsage(NOW), main: full ? fullMain() : blankMain(NOW), settings: s, agentsRunning: full ? 2 : 0, enterAgeMs: 50 }), `collapsed ${W} ${state}`)
        }
  })

  test('the tag checker catches broken markup', async () => {
    expect(wellFormed('<svg><g></svg>')).not.toBeNull()
    expect(wellFormed('<svg><text>a < b</text></svg>')).not.toBeNull()
    expect(wellFormed('<svg><g><rect x="1"/></g></svg>')).toBeNull()
  })

  test('drawings with a sprite carry its CSS once, those without carry none', async () => {
    const c = ctxOf(320, { theme: 'cat' })
    expect(styleCount(mainDrawing(c, fullMain(), 1, fullUsage()).source)).toBe(2)
    expect(styleCount(agentDrawing(c, run()).source)).toBe(2)
    expect(styleCount(compactAgentDrawing(c, run()).source)).toBe(2)
    expect(styleCount(compactMainDrawing(c, fullMain(), flow, 1).source)).toBe(2)
    expect(styleCount(sessionCardDrawing(c, { main: fullMain(), agents: [run()], usage: fullUsage(), totals: totals(fullMain(), [run()], fullUsage(), NOW) }).source)).toBe(1)
    expect(styleCount(sectionDrawing(c, 'Working', 2).source)).toBe(1)
    expect(styleCount(iconDrawing('panel').source)).toBe(1)
    // The entrance rules join the drawing's own style block.
    expect(styleCount(mainDrawing(ctxOf(320, { theme: 'cat' }, 0), fullMain(), 1, fullUsage()).source)).toBe(2)
  })

  test('user text is escaped and stripped of control characters', async () => {
    const d = agentDrawing(ctxOf(700), run({ description: 'a <b> & "c"\u0007\u200b', doing: 'x\ny' }))
    check(d, 'escaped')
    expect(d.source.includes('a &lt;b&gt; &amp; &quot;c&quot;')).toBe(true)
    expect(d.source.includes('\u0007')).toBe(false)
    const log = logDrawing(ctxOf(320), [{ at: NOW, kind: 'tool', text: '<script> & "x"\u0007', outcome: 'ok' }], '"><script>')
    check(log, 'escaped log')
    expect(log.source.includes('<script>')).toBe(false)
  })

  test('junk numbers never reach the markup', async () => {
    const junk = { ...run(), costUsd: NaN, contextTokens: Infinity, startedAt: NaN, stepTotal: NaN, round: NaN } as AgentRun
    check(agentDrawing(ctxOf(320), junk), 'junk agent')
    const m = { ...fullMain(), costUsd: NaN, workedMs: NaN, turnStartedAt: NaN } as unknown as MainRun
    const u = { ...fullUsage(), contextPercent: NaN, contextTokens: NaN, speed: NaN, costUsd: NaN } as Usage
    check(mainDrawing(ctxOf(320), m, NaN, u), 'junk main')
    check(mainDrawing(ctxOf(320, { iconSize: NaN }), m, 1, undefined as unknown as Usage), 'junk icon size, no usage')
    const t = totals(fullMain(), [], fullUsage(), NOW)
    const jt = { ...t, costUsd: NaN, tokens: NaN, timeMs: NaN }
    for (const panelUsage of ['bar', 'ring', 'off'] as const) {
      check(sessionCardDrawing(ctxOf(320, { panelUsage }), { main: m, agents: [junk, null as unknown as AgentRun], usage: u, totals: jt, workedMs: NaN, retired: { junk: 1 } as never }), `junk card ${panelUsage}`)
      check(sessionCardDrawing(ctxOf(NaN, { panelUsage }), undefined as unknown as CardData), `no card data ${panelUsage}`)
    }
    check(compactCardDrawing(ctxOf(320), jt, undefined as unknown as Usage), 'junk compact card')
    check(compactAgentDrawing(ctxOf(320), junk), 'junk compact agent')
    check(compactMainDrawing(ctxOf(NaN), undefined as unknown as MainRun, { ...flow, total: NaN } as Flow, NaN), 'junk compact main')
    check(compactFootDrawing(ctxOf(320), NaN, Infinity, -1), 'junk compact foot')
    expect(gaugeGrid(NaN, NaN)).toEqual({ cols: 0, rows: 0, cellW: 0 })
    const g = { kind: 'five_hour', label: '', used: NaN, left: NaN, resetIn: NaN, tone: 'x' } as unknown as Gauge
    check(meterDrawing(g, settingsOf(), 'bar', NaN), 'junk pill meter')
    check(logDrawing({ ...ctxOf(320), tzOffsetMin: NaN }, [{ at: NaN, kind: 'tool', text: undefined, outcome: 'ok', ms: NaN } as unknown as LogEntry, null as unknown as LogEntry], 'red'), 'junk log')
    check(progressDrawing(flow, NaN, settingsOf(), 'running', NaN, NaN, NaN), 'junk progress')
    check(progressDrawing(flow, 480, settingsOf(), 'bogus' as TaskState, 2, Infinity), 'junk state')
    check(collapsedDrawing({ W: NaN, now: NaN, flow, state: 'bogus' as TaskState, usage: undefined as unknown as Usage, main: undefined as unknown as MainRun, settings: settingsOf(), agentsRunning: NaN }), 'junk collapsed')
  })

  test('the v2 drawings and the v3 panel hover helpers are gone; tipLines is back for the bar', async () => {
    for (const name of ['headerDrawing', 'usageDrawing', 'infoDrawing', 'tipFor', 'gridDrawing', 'tipOf', 'tileDrawing', 'tilesLayout', 'meterRowDrawing', 'ringsDrawing', 'compactDrawing']) expect(name in draw ? `${name} still exported` : 'ok').toBe('ok')
    expect(typeof draw.tipLines).toBe('function')
  })

  test('clip-path ids are unique within each document', async () => {
    const docs: [string, Drawing][] = [
      ['progress', progressDrawing(flow, 480, settingsOf(), 'running', 2, 2)],
      ['main with a task', mainDrawing(ctxOf(480), fullMain(), 1, fullUsage(), flow)],
      ['main, no task', mainDrawing(ctxOf(480), fullMain(), 1, fullUsage(), null)],
      ['collapsed', collapsedDrawing({ W: 480, now: NOW, flow, state: 'running', usage: fullUsage(), main: fullMain(), settings: settingsOf(), agentsRunning: 1 })],
      ['grid', backdropDrawing('grid', 320, 64)],
    ]
    for (const [what, d] of docs) {
      const ids = [...d.source.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
      expect(new Set(ids).size === ids.length ? 'ok' : `${what}: repeated id in ${ids.join(', ')}`).toBe('ok')
      for (const ref of d.source.matchAll(/url\(#([^)]+)\)/g)) expect(ids.includes(ref[1]) ? 'ok' : `${what}: url(#${ref[1]}) has no target`).toBe('ok')
    }
  })
})

// The session card's data for the full sample, or as given.
const cardData = (o: Partial<CardData> = {}): CardData => {
  const main = o.main ?? fullMain()
  const agents = o.agents ?? [run()]
  const usage = o.usage ?? fullUsage()
  return { main, agents, usage, totals: totals(main, agents, usage, NOW, o.retired), workedMs: 12 * MIN, ...o }
}
const card = (W: number, o: Partial<Settings> = {}, d: Partial<CardData> = {}): Drawing => sessionCardDrawing(ctxOf(W, o), cardData(d))
const bigTotals = (): ReturnType<typeof totals> => ({
  ...totals(fullMain(), [], fullUsage(), NOW),
  costUsd: 1590.49,
  isEstimate: true,
  tokens: 114_000_000,
  timeMs: 26 * HOUR + 4 * MIN,
  use: { input: 4_000_000, output: 513_000, cacheRead: 108_000_000, cacheWrite: 2_000_000 },
})
// Where the strips start in a card: the Session heading at 4, the figures at 26, the context
// line at 102, the split after it at 132; with the full sample's split (88), the Plan group's
// rule at 228 and its window cells at 254.
const FIG_Y = 26
const CTX_Y = 102
const PLAN_Y = 254
// The rects of one bar of the card, left to right, by its top and height.
const barRects = (src: string, y: number, h: number): { paint: string; x: number; w: number }[] =>
  [...src.matchAll(/<rect ([^>]*)\/>/g)]
    .map(m => {
      const at = (name: string): string => new RegExp(`(?:^| )${name}="([^"]*)"`).exec(m[1] ?? '')?.[1] ?? ''
      const cls = at('class').split(' ').find(c => !c.startsWith('pc-')) ?? ''
      return { paint: cls ? `.${cls}` : at('fill'), x: Number(at('x')), y: Number(at('y')), w: Number(at('width')), h: Number(at('height')) }
    })
    .filter(x => x.y === y && x.h === h)
    .map(({ paint, x, w }) => ({ paint, x, w }))

describe('session card', () => {
  test('one card as wide as the pane: the figures, the gauges and the split, hairlines between the strips', async () => {
    const d = card(380)
    check(d, 'card')
    expect(d.width).toBe(380)
    // No fill of its own: the pane sets it on the bar's panel (2.0.1).
    expect(d.source.includes('class="tile"')).toBe(false)
    const shown = texts(d.source).map(t => t.s)
    for (const s of ['Cost', 'Tokens', 'Time', 'Context', '5-hour', 'Week', 'Week · Fable']) expect(shown.includes(s) ? 'ok' : `missing ${s}`).toBe('ok')
    expect(shown.some(s => s.startsWith('Router ')) && shown.some(s => s.startsWith('Subagents '))).toBe(true)
    // 4 above; the Session heading 22, figures 76, the context line 30, the split with one
    // legend row 88; the Plan group: a gap of 8, its rule and heading 26, one row of three windows, 64 and 12; 8 below.
    expect(d.height).toBe(4 + 22 + 76 + 30 + 88 + 8 + 26 + 76 + 8)
    expect(shown).toContain('Session')
    expect(shown).toContain('Plan')
    // The strips are cut by hairlines inset 12px from the card's edges; the Plan group by a rule across the card.
    expect(d.source).toContain(`<line class="ln" x1="12" y1="${CTX_Y}" x2="368" y2="${CTX_Y}"/>`)
    expect(d.source).toContain(`<line class="ln" x1="12" y1="${CTX_Y + 30}" x2="368" y2="${CTX_Y + 30}"/>`)
    expect(d.source).toContain(`<line class="ln" x1="0" y1="${PLAN_Y - 26}" x2="380" y2="${PLAN_Y - 26}"/>`)
    expect(d.alt.startsWith('Session: Cost $11.73')).toBe(true)
  })

  test('no text crosses the card or another text at W 200 to 600: bars, rings or none, long figures, three currencies', async () => {
    const big = cardData({ totals: bigTotals(), workedMs: 24 * HOUR + 2 * MIN, usage: { ...fullUsage(), turnCostUsd: 1.62, limits: [...(fullUsage().limits ?? []), { kind: 'seven_day_opus', percentUsed: 100, resetsAt: new Date(NOW + 30 * HOUR).toISOString() }] } })
    const fresh = cardData({ main: blankMain(NOW), agents: [], usage: blankUsage(NOW), workedMs: 0 })
    for (let W = 200; W <= 600; W += 8)
      for (const panelUsage of ['bar', 'ring', 'off'] as const)
        for (const currency of ['GBP', 'USD', 'KRW'] as const)
          for (const [what, data] of [['full', cardData()], ['big', big], ['fresh', fresh]] as const) {
            const d = sessionCardDrawing(ctxOf(W, { panelUsage, currency }), data)
            const label = `${what} ${panelUsage} ${currency} W=${W}`
            check(d, label)
            inside(d, label)
            apart(d, label)
          }
  })

  test('the figures: each value steps from 17px to 15 and 13 before it is cut; each sub-line shortens in order, then goes', async () => {
    const data = cardData({ totals: bigTotals(), workedMs: 24 * MIN + 2_000, usage: { ...fullUsage(), turnCostUsd: 1.3 / 0.79 } })
    const subs = (W: number): string[] =>
      texts(sessionCardDrawing(ctxOf(W, { currency: 'GBP' }), data).source)
        .filter(t => t.y === FIG_Y + 60)
        .sort((a, b) => a.x - b.x)
        .map(t => t.s)
    expect(subs(600)).toEqual(['this turn +£1.30', 'in 114M · out 513k', 'worked 24:02'])
    expect(subs(300)[0]).toBe('+£1.30 turn')
    expect(subs(200)[0]).toBe('+£1.30')
    expect(subs(200)[1]).toBe('114M in')
    expect(subs(200)[2]).toBe('24:02')
    // As the card narrows, a sub-line only gets shorter.
    for (let i = 0; i < 3; i++) {
      let last = Infinity
      for (let W = 640; W >= 120; W -= 2) {
        const s = texts(sessionCardDrawing(ctxOf(W, { currency: 'GBP' }), data).source).filter(t => t.y === FIG_Y + 60 && t.x === Math.round(((i * W) / 3 + 12) * 100) / 100)[0]?.s ?? ''
        const len = s ? textWidth(s, 11) : 0
        expect(len <= last ? 'ok' : `sub ${i} at ${W}: "${s}" after a shorter form`).toBe('ok')
        last = len
      }
    }
    // The value: whole at the largest of 17, 15 and 13 that fits its cell, else cut at 13.
    for (const costUsd of [0.42, 1590.49, 15_627, 250_000])
      for (const currency of ['GBP', 'KRW'] as const)
        for (let W = 200; W <= 600; W += 10) {
          const d = sessionCardDrawing(ctxOf(W, { currency }), cardData({ totals: { ...bigTotals(), costUsd } }))
          const value = texts(d.source).find(t => t.y === FIG_Y + 43 && t.x === 12)
          const full = d.alt.slice('Session: Cost '.length).split(' (')[0] ?? ''
          const room = W / 3 - 20
          const want = [17, 15].find(z => textWidth(full, z) <= room) ?? 13
          expect(value?.size === want ? 'ok' : `${currency} ${costUsd} W=${W}: ${value?.size}px, not ${want}`).toBe('ok')
          if (textWidth(full, 13) <= room) expect(value?.s).toBe(full)
        }
  })

  test('cost: the currency only, ≈ for estimates; tokens: in counts cache reads and writes; time: worked', async () => {
    const engine = texts(card(600).source).map(t => t.s)
    expect(engine).toContain('$11.73')
    expect(engine.some(s => s.includes('≈$11'))).toBe(false)
    expect(engine).toContain('this turn +$0.42')
    expect(engine).toContain('in 16M · out 99k')
    expect(engine).toContain('worked 12:00')
    const est = card(600, {}, { usage: { ...fullUsage(), costUsd: null, turnCostUsd: null } })
    expect(texts(est.source).some(t => t.s.startsWith('≈$'))).toBe(true)
    expect(est.source).not.toContain('this turn')
    for (const [currency, sign] of [['GBP', '£'], ['KRW', '₩']] as const) {
      const shown = texts(card(300, { currency }).source).map(t => t.s).join(' ')
      expect(shown.includes(sign) && !shown.includes('$')).toBe(true)
    }
  })

  test('the gauges wrap: up to four a row while a cell is 80px or more, else rows of two; later rows keep the grid', async () => {
    expect(gaugeGrid(320, 4)).toEqual({ cols: 4, rows: 1, cellW: 80 })
    expect(gaugeGrid(319, 4)).toEqual({ cols: 2, rows: 2, cellW: 159.5 })
    expect(gaugeGrid(300, 3)).toEqual({ cols: 3, rows: 1, cellW: 100 })
    expect(gaugeGrid(230, 3)).toEqual({ cols: 2, rows: 2, cellW: 115 })
    expect(gaugeGrid(380, 5)).toEqual({ cols: 4, rows: 2, cellW: 95 })
    expect(gaugeGrid(300, 5)).toEqual({ cols: 2, rows: 3, cellW: 150 })
    expect(gaugeGrid(120, 2)).toEqual({ cols: 2, rows: 1, cellW: 60 })
    expect(gaugeGrid(380, 1)).toEqual({ cols: 1, rows: 1, cellW: 380 })
    expect(gaugeGrid(380, 0)).toEqual({ cols: 0, rows: 0, cellW: 0 })
    for (let W = 100; W <= 700; W += 7)
      for (let n = 1; n <= 8; n++) {
        const g = gaugeGrid(W, n)
        const want = W / Math.min(4, n) >= 80 ? Math.min(4, n) : Math.min(2, n)
        expect(g.cols === want && g.rows === Math.ceil(n / want) && g.cellW === W / want ? 'ok' : `W=${W} n=${n}: ${JSON.stringify(g)}`).toBe('ok')
      }
    // Drawn: the labels of each row, by their baseline.
    const rows = (d: Drawing): number[] => {
      const by = new Map<number, number>()
      for (const t of texts(d.source)) if (t.size === 11 && t.y > PLAN_Y && t.y < PLAN_Y + 5 * 64 && (t.y - PLAN_Y - 22) % 64 === 0) by.set(t.y, (by.get(t.y) ?? 0) + 1)
      return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)
    }
    const five = { ...fullUsage(), limits: [...(fullUsage().limits ?? []), { kind: 'seven_day_opus', percentUsed: 30, resetsAt: new Date(NOW + 30 * HOUR).toISOString() }] }
    const three = { ...fullUsage(), limits: (fullUsage().limits ?? []).slice(0, 2) }
    // The Plan group's windows only: the context is on its own line in the Session group.
    expect(rows(card(380))).toEqual([3])
    expect(rows(card(230))).toEqual([2, 1])
    expect(rows(card(300, {}, { usage: three }))).toEqual([2])
    expect(rows(card(380, {}, { usage: five }))).toEqual([4])
    expect(rows(card(300, {}, { usage: five }))).toEqual([2, 2])
    // Each row of gauges adds 64px.
    expect(card(300, {}, { usage: five }).height - card(380, {}, { usage: five }).height).toBe(64)
    // The third window starts the second row in the first column, on the first row's grid.
    const third = texts(card(300, {}, { usage: five }).source).find(t => t.s === 'Week · Fable' || t.s === 'Wk · Fable')
    expect([third?.x, third?.y]).toEqual([12, PLAN_Y + 64 + 22])
  })

  test('a gauge cell: its label, the figure with used or left, a 4px bar of what is left in the tone, the detail shortened', async () => {
    const src = card(300).source
    const t = texts(src)
    // The context: on its own line in the Session group.
    expect(t.find(x => x.s === '52% used')?.y).toBe(CTX_Y + 19)
    expect(t.some(x => x.s === '40% left')).toBe(true)
    expect(texts(card(600).source).some(x => x.s === 'resets in 3h 05m')).toBe(true)
    expect(t.some(x => x.s === '517k / 1M')).toBe(true)
    // In a 95px cell the detail drops `resets in`, and Week · Fable stays whole or reads Wk · Fable.
    const four = { ...fullUsage(), limits: [...(fullUsage().limits ?? []), { kind: 'seven_day_opus', percentUsed: 30, resetsAt: new Date(NOW + 30 * HOUR).toISOString() }] }
    const narrow = texts(card(380, {}, { usage: four }).source).map(x => x.s)
    expect(narrow).toContain('3h 05m')
    expect(narrow.includes('Week · Fable') || narrow.includes('Wk · Fable')).toBe(true)
    for (const palette of PALETTE_LIST) {
      const pal = PALETTES[palette]
      // The context line's bar, then the Plan group's cells.
      const fills = (u: Usage): { paint: string; x: number; w: number }[] => {
        const src = card(320, { palette }, { usage: u }).source
        return [...barRects(src, CTX_Y + 13, 4), ...barRects(src, PLAN_Y + 49, 4)]
      }
      const one = (limits: Usage['limits'], ctxPct = 30): { paint: string; w: number }[] => fills({ ...fullUsage(), contextPercent: ctxPct, contextTokens: null, limits })
      const five = one([{ kind: 'five_hour', percentUsed: 60, resetsAt: new Date(NOW + HOUR).toISOString() }])
      // The track, then the fill: the context's 30% used, the 5-hour's 40% left.
      expect(five.map(x => x.paint)).toEqual(['#808080', pal.calm, '#808080', pal.calm])
      expect(five[2]?.w).toBe(320 - 24)
      expect(Math.abs((five[1]?.w ?? 0) / (five[0]?.w ?? 1) - 0.3) < 0.01 && Math.abs((five[3]?.w ?? 0) / (five[2]?.w ?? 1) - 0.4) < 0.01).toBe(true)
      expect(one([], 70)[1]?.paint).toBe(pal.warn)
      expect(one([{ kind: 'seven_day', percentUsed: 95, resetsAt: new Date(NOW + HOUR).toISOString() }])[3]?.paint).toBe(pal.alert)
    }
  })

  test('panelUsage: ring draws a ring in each cell, label above and detail below; off leaves the strip out', async () => {
    const ring = card(380, { panelUsage: 'ring' })
    check(ring, 'ring card')
    const circles = [...ring.source.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="17.5" fill="none" stroke-width="5"/g)]
    // A track and an arc for each of the plan's three windows; the context line has its own small ring.
    expect(circles.length).toBe(6)
    const cy = Number(circles[0]?.[2])
    const label = texts(ring.source).find(t => t.s === '5-hour')
    const detail = texts(ring.source).find(t => t.s === 'resets in 3h 05m' || t.s === '3h 05m')
    expect(label?.anchor).toBe('middle')
    expect((label?.y ?? 0) < cy - 17 && (detail?.y ?? 0) > cy + 17).toBe(true)
    expect(ring.source.includes('>52%<') && ring.source.includes('>40%<')).toBe(true)
    expect(ring.height).toBe(card(380).height + 92 - 64)
    const off = card(380, { panelUsage: 'off' })
    check(off, 'card, usage off')
    expect(off.source.includes('>Context<') || off.source.includes('>5-hour<')).toBe(false)
    // Off: no context line (30) and no Plan group (8, 26, then 76).
    expect(off.height).toBe(card(380).height - 30 - (8 + 26 + 76))
    expect(off.source.includes('Router ')).toBe(true)
  })

  test('a window that has just reset reads resetting…, muted, with an empty meter', async () => {
    const g = gaugeOf({ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(NOW - 2 * MIN).toISOString() }, NOW) as Gauge
    expect(g.isResetting).toBe(true)
    const usage = { ...fullUsage(), limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(NOW - 2 * MIN).toISOString() }] }
    for (const W of [240, 320, 480]) {
      const d = card(W, {}, { usage })
      check(d, `resetting card ${W}`)
      inside(d, `resetting card ${W}`)
      expect(d.source).toContain('class="m" font-size="12" font-weight="600">resetting…<')
      expect(d.source.includes('resets in')).toBe(false)
    }
    // Only the grey track under it: no fill.
    const resetSrc = card(320, {}, { usage }).source
    const cells = [...barRects(resetSrc, CTX_Y + 13, 4), ...barRects(resetSrc, PLAN_Y + 49, 4)]
    expect(cells.map(x => x.paint)).toEqual(['#808080', PALETTES.classic.calm, '#808080'])
    const rings = card(480, { panelUsage: 'ring' }, { usage }).source
    expect(rings.includes('>resetting<') && rings.includes('>…<')).toBe(true)
    expect(compactCardDrawing(ctxOf(480), totals(fullMain(), [], usage, NOW), usage).source).toContain('>…<')
    const pill = meterDrawing(g, settingsOf(), 'bar')
    expect(/<rect fill=/.test(pill.source)).toBe(false)
    expect(pill.alt).toBe('5h resetting…')
    expect(collapsedDrawing({ W: 700, now: NOW, flow: null, state: 'none', usage, main: fullMain(), settings: settingsOf(), agentsRunning: 0 }).source.includes('5h resetting…')).toBe(true)
    expect(tipLines('limit', { gauge: g, settings: settingsOf(), rates, now: NOW }).lines).toEqual(['The window has just reset', 'No fresh figure yet'])
  })

  test('the split: left out before any token; with no subagents the router is 100%', async () => {
    const fresh = card(380, {}, { main: blankMain(NOW), agents: [], usage: blankUsage(NOW) })
    expect(fresh.source.includes('Router')).toBe(false)
    expect(fresh.alt.includes('router')).toBe(false)
    // The Session heading and the figures alone: no gauges are known yet either.
    expect(fresh.height).toBe(4 + 22 + 76 + 8)
    expect(splitShares(usageSplit(blankMain(NOW), [], blankRetired()))).toBeNull()
    const alone = card(380, {}, { agents: [] })
    const heads = texts(alone.source).filter(t => t.s.startsWith('Router') || t.s.startsWith('Subagents')).map(t => t.s)
    // List-price sums: estimates, so they carry the mark (SPEC 2.9.5).
    expect(heads[0]).toMatch(/^Router 100% · ≈\$\d/)
    expect(heads[1]).toMatch(/^Subagents 0% · ≈\$0\.00/)
    // The two shares always make 100.
    for (const [m, a] of [[1, 2], [1, 1], [2, 1], [333, 667], [1, 0]] as const) {
      const s = splitShares({ main: { tokens: m, costUsd: 0 }, agents: { tokens: a, costUsd: 0 }, retired: { tokens: 0, costUsd: 0 }, models: usageSplit(blankMain(NOW), []).models })
      expect((s?.router ?? 0) + (s?.agents ?? 0)).toBe(100)
    }
  })

  test('the split bar: the router in its neutral, one sliver per subagent in its own colour in start order, one muted sliver for retired rows', async () => {
    const tok = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 })
    const a = run({ id: 'a', kind: 'build', tint: 0, startedAt: NOW - 3 * MIN, use: tok(200_000) })
    const b = run({ id: 'b', kind: 'search', tint: 1, type: 'Explore', startedAt: NOW - 5 * MIN, use: tok(100_000), model: 'claude-haiku-5-5' })
    const c = run({ id: 'c', kind: 'build', tint: 1, startedAt: NOW - MIN, use: tok(50_000) })
    const gone = retire(blankRetired(), [run({ id: 'old', use: tok(150_000), model: 'claude-haiku-5-5' })])
    const main = { ...fullMain(), use: tok(500_000), byFamily: undefined }
    const splitY = (d: Drawing): number => {
      const head = texts(d.source).find(t => t.s.startsWith('Router'))
      return (head?.y ?? 0) - 24 + 32
    }
    const d = card(480, {}, { main, agents: [a, c, b], retired: gone })
    const bar = barRects(d.source, splitY(d), 8)
    expect(bar.map(x => x.paint)).toEqual(['.rt', agentColor(b), agentColor(a), agentColor(c), '.m'])
    // Widths in proportion to tokens, 1px apart, across the inner width.
    const room = 480 - 24 - 4
    const want = [500, 100, 200, 50, 150].map(v => (v / 1000) * room)
    bar.forEach((x, i) => expect(Math.abs(x.w - (want[i] ?? 0)) < 0.6 ? 'ok' : `segment ${i}: ${x.w} not ${want[i]}`).toBe('ok'))
    for (let i = 1; i < bar.length; i++) expect(Math.abs((bar[i]?.x ?? 0) - ((bar[i - 1]?.x ?? 0) + (bar[i - 1]?.w ?? 0)) - 1) < 0.02).toBe(true)
    // Subagents 50%: the retired rows count for them.
    expect(texts(d.source).find(t => t.s.startsWith('Subagents'))?.s).toMatch(/^Subagents 50%/)
    // Nothing retired: no muted sliver.
    const kept = card(480, {}, { main, agents: [a, b] })
    expect(barRects(kept.source, splitY(kept), 8).map(x => x.paint)).toEqual(['.rt', agentColor(b), agentColor(a)])
    // A subagent with no tokens yet takes no sliver.
    const idle = card(480, {}, { main, agents: [a, run({ id: 'z', use: tok(0) })] })
    expect(barRects(idle.source, splitY(idle), 8)).toHaveLength(2)
  })

  test('the model bar and legend: largest first, in the palette series, Haiku the neutral', async () => {
    const tok = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 })
    const main = { ...fullMain(), use: tok(400_000), byFamily: undefined }
    const agents = [run({ id: 'h', model: 'claude-haiku-5-5', use: tok(300_000) }), run({ id: 's', model: 'claude-sonnet-5-5', use: tok(100_000) }), run({ id: 'o', model: 'claude-opus-5-5', use: tok(200_000) })]
    for (const palette of PALETTE_LIST) {
      const pal = PALETTES[palette]
      const d = card(480, { palette }, { main, agents })
      const head = texts(d.source).find(t => t.s.startsWith('Router'))
      const models = barRects(d.source, (head?.y ?? 0) + 24, 4)
      expect(models.map(x => x.paint)).toEqual([pal.accent, '.hk', pal.calm, pal.done])
      const names = texts(d.source).filter(t => ['Fable', 'Opus', 'Sonnet', 'Haiku'].includes(t.s))
      expect(names.map(t => t.s)).toEqual(['Fable', 'Haiku', 'Opus', 'Sonnet'])
      expect(texts(d.source).some(t => t.s === '400k · 40%' && t.anchor === 'end')).toBe(true)
    }
    // The new inks, light and dark: the router neutral, the Haiku series, the chip, the muted text.
    const src = card(480).source
    for (const rule of ['.rt{fill:#4a4a46}', '.hk{fill:#a3a39e}', '.chip{fill:#A9472A}', '.m{fill:#85857f}', '.rt{fill:#d6d6d2}', '.hk{fill:#8d8d88}', '.chip{fill:#F0A68C}', '.m{fill:#8f8f8a}']) expect(src).toContain(rule)
  })

  test('usageGauges: context first, then every limit the engine reports, with details', async () => {
    const list = usageGauges(fullUsage(), NOW)
    expect(list.map(g => g.gauge.label)).toEqual(['Context', '5h', 'Week', 'Week · Fable'])
    expect(list.map(g => g.detail)).toEqual(['517k / 1M', 'resets in 3h 05m', 'resets in 3d 16h', 'resets in 3d 16h'])
    expect(usageGauges(blankUsage(NOW), NOW)).toEqual([])
    const past = (ago: number): Usage => ({ ...blankUsage(NOW), limits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: new Date(NOW - ago).toISOString() }] })
    // A window that reset with no fresh figure: resetting, with no detail, for ten minutes; then gone.
    expect(usageGauges(past(MIN), NOW).map(g => [g.gauge.isResetting, g.detail])).toEqual([[true, '']])
    expect(usageGauges(past(10 * MIN), NOW)).toHaveLength(1)
    expect(usageGauges(past(10 * MIN + 1), NOW)).toEqual([])
    const noReset = { ...blankUsage(NOW), limits: [{ kind: 'seven_day', percentUsed: 50, resetsAt: null }] }
    expect(usageGauges(noReset, NOW)[0]?.detail).toBe('')
  })
})

describe('compact mode', () => {
  test('the card: line 1 the cost, tokens and time with the turn at the right; line 2 one small cell per gauge; 62px', async () => {
    const t = totals(fullMain(), [run()], fullUsage(), NOW)
    const d = compactCardDrawing(ctxOf(380), t, fullUsage())
    check(d, 'compact card')
    expect(d.height).toBe(4 + 62 + 8)
    expect(d.source.includes('class="tile"')).toBe(false)
    const line1 = texts(d.source).filter(x => x.y === 26).sort((a, b) => a.x - b.x)
    expect(line1.map(x => x.s)).toEqual(['$11.73', `${fmtTokens(t.tokens)} · 1:00:00`, '+$0.42 turn'])
    expect(line1[0]?.size).toBe(13)
    expect(line1[2]?.anchor).toBe('end')
    const line2 = texts(d.source).filter(x => x.y === 48).map(x => x.s)
    expect(line2).toEqual(['Ctx 52%', '5h 40%', 'Wk 63%', 'Fable 19%'])
    expect(barRects(d.source, 54, 3).filter(x => x.paint === '#808080')).toHaveLength(4)
    // The cells share the card from its 12px inset to its edge.
    expect(texts(d.source).filter(x => x.y === 48).map(x => x.x)).toEqual([12, 104, 196, 288])
    // No gauge, or panelUsage off: line 1 alone.
    const off = compactCardDrawing(ctxOf(380, { panelUsage: 'off' }), t, fullUsage())
    expect(off.height).toBe(4 + 36 + 8)
    expect(texts(off.source).some(x => x.y === 48)).toBe(false)
    expect(compactCardDrawing(ctxOf(380), totals(blankMain(NOW), [], blankUsage(NOW), NOW), blankUsage(NOW)).height).toBe(48)
    // Narrow: the turn and the time go before anything is cut; a cell keeps its figure.
    for (let W = 160; W <= 600; W += 4) {
      const n = compactCardDrawing(ctxOf(W, { currency: 'KRW' }), { ...bigTotals() }, { ...fullUsage(), limits: [...(fullUsage().limits ?? []), { kind: 'seven_day_opus', percentUsed: 30, resetsAt: null }] })
      check(n, `compact card ${W}`)
      inside(n, `compact card ${W}`)
      apart(n, `compact card ${W}`)
      expect(texts(n.source).filter(x => x.y === 48)).toHaveLength(5)
    }
  })

  test('one line per agent, 30px: title, kind and model, its step or tokens 16px in from its status mark', async () => {
    const d = compactAgentDrawing(ctxOf(380), run())
    check(d, 'compact agent')
    expect(d.height).toBe(30)
    const t = texts(d.source)
    expect(t.find(x => x.anchor === 'start')?.s).toBe('Port the progress row  Refactor · Opus')
    expect(d.source).toContain(`<tspan fill="${agentColor(run())}" font-weight="600" font-size="11.5">Refactor</tspan>`)
    const right = t.find(x => x.anchor === 'end')
    expect([right?.s, right?.x]).toEqual(['3/6', 364])
    expect(d.source).toContain('font-weight="600" font-variant-numeric="tabular-nums">3/6<')
    expect(d.source).toContain('<circle class="live" cx="374"')
    // No steps: its tokens, plain; finished: its mark, and it holds still.
    const done = compactAgentDrawing(ctxOf(380), run({ stepTotal: undefined, status: 'done', endedAt: NOW }))
    expect(texts(done.source).find(x => x.anchor === 'end')?.s).toBe('273k')
    expect(done.source).toContain(`stroke="${TONES.calm}"`)
    // Narrow: the model goes, then the kind, before the title is cut below 64px.
    const narrow = (W: number): string => texts(compactAgentDrawing(ctxOf(W), run({ description: 'Port the progress row to the new card' })).source).find(x => x.anchor === 'start')?.s ?? ''
    expect(narrow(600)).toBe('Port the progress row to the new card  Refactor · Opus')
    expect(narrow(240)).toMatch(/…  Refactor · Opus$|…  Refactor$|…$/)
    for (let W = 120; W <= 600; W += 4) {
      const l = compactAgentDrawing(ctxOf(W, { iconSize: 250 }), run({ description: LONG }))
      check(l, `compact line ${W}`)
      inside(l, `compact line ${W}`)
      apart(l, `compact line ${W}`)
    }
    // Taller mascots make taller lines.
    expect(compactAgentDrawing(ctxOf(380, { iconSize: 250 }), run()).height).toBe(62)
    // The main agent's line: its status word in the chip ink, its model, the plan's count.
    const main = compactMainDrawing(ctxOf(380), fullMain(), flow, 2)
    expect(texts(main.source).find(x => x.anchor === 'start')?.s).toBe('Claude  working · Fable 5.2')
    expect(main.source).toContain('<tspan class="chip" font-weight="600" font-size="11.5">working</tspan>')
    expect(texts(main.source).find(x => x.anchor === 'end')?.s).toBe('3/6')
    expect(texts(compactMainDrawing(ctxOf(380), fullMain(), null, 0).source).some(x => x.anchor === 'end')).toBe(false)
  })

  test('the last line: the Planned and Finished counts, the failed count in the alert colour', async () => {
    const d = compactFootDrawing(ctxOf(380), 2, 3, 1)
    check(d, 'compact foot')
    expect(d.height).toBe(34)
    expect(texts(d.source)[0]?.s).toBe('Planned 2 · Finished 3  1 failed')
    expect(d.source).toContain(`<tspan fill="${TONES.alert}">  1 failed</tspan>`)
    expect(texts(compactFootDrawing(ctxOf(380), 0, 2, 0).source)[0]?.s).toBe('Finished 2')
    expect(texts(compactFootDrawing(ctxOf(380), 2, 0, 0).source)[0]?.s).toBe('Planned 2')
    check(compactFootDrawing(ctxOf(380), 0, 0, 0), 'empty foot')
  })

  test('compact: each mascot wears its agent colour, and the live dot follows barColors', async () => {
    const a = run({ id: 'a', kind: 'build', tint: 0 })
    const b = run({ id: 'b', kind: 'build', tint: 2 })
    expect(compactAgentDrawing(ctxOf(480), a).source).toContain('#367FDD')
    expect(compactAgentDrawing(ctxOf(480), b).source).toContain(shiftColor('#367FDD', 2))
    const pal = compactAgentDrawing(ctxOf(480, { barColors: 'palette' }), a).source
    expect(pal).toContain(`r="3.5" fill="${PALETTES.classic.accent}"`)
    expect(pal).toContain('#367FDD')
  })
})

describe('main agent row', () => {
  // The task strip's segments: 8px rects, by their paint, left to right.
  const segments = (src: string): string[] =>
    [...src.matchAll(/<rect ([^>]*)\/>/g)]
      .map(m => m[1] ?? '')
      .filter(a => a.includes('height="8"') && a.includes('rx="2"') && !a.includes('stroke='))
      .map(a => /fill="(#\w+)"/.exec(a)?.[1] ?? '')
  const tracks = (src: string): number => segments(src).filter(f => f === '#808080').length

  test('the task strip replaces the context bar: no ctx anywhere, with or without a task', async () => {
    for (const W of [240, 320, 480, 700])
      for (const f of [flow, null, { ...flow, isFinished: true }])
        for (const status of ['working', 'waiting', 'resting'] as const) {
          const d = mainDrawing(ctxOf(W), { ...fullMain(), status }, 1, fullUsage(), f)
          expect(/ctx/i.test(d.source) || /context \d/.test(d.alt) ? `W=${W} ${status}: ctx in the main row` : 'ok').toBe('ok')
          check(d, `main W=${W} ${status}`)
          inside(d, `main W=${W} ${status}`)
        }
    // Called as v4 did, with no flow: the strip reads No task yet.
    expect(mainDrawing(ctxOf(480), fullMain(), 0, fullUsage()).source.includes('>No task yet<')).toBe(true)
  })

  test('stripSegments: done first, then one per agent running while the plan runs, then one per agent waiting, then the rest', async () => {
    expect(stripSegments(flow, 'running', 2, 1)).toEqual(['done', 'done', 'done', 'run', 'run', 'wait'])
    expect(stripSegments(flow, 'running', 9, 9)).toEqual(['done', 'done', 'done', 'run', 'run', 'run'])
    expect(stripSegments(flow, 'paused', 2, 1)).toEqual(['done', 'done', 'done', 'wait', 'plan', 'plan'])
    expect(stripSegments({ ...flow, isFinished: true }, 'done', 0, 0)).toEqual(Array(6).fill('done'))
    expect(stripSegments(flow, 'none', 2, 0)).toEqual([])
    expect(stripSegments(null, 'running', 2, 0)).toEqual([])
    expect(stripSegments({ ...flow, total: 0, done: 0 }, 'running', 2, 0)).toEqual([])
    expect(stripSegments({ ...flow, done: 9 }, 'running', 1, 0)).toEqual(Array(6).fill('done'))
    expect(stripSegments({ ...flow, total: NaN, done: NaN } as Flow, 'running', NaN, NaN)).toEqual([])
  })

  test('a running task: its name, the count and percent at the right, one segment a task in the flow colours', async () => {
    for (const palette of PALETTE_LIST) {
      const src = mainDrawing(ctxOf(480, { palette }), fullMain(), 2, fullUsage(), flow, undefined, 1).source
      const t = texts(src)
      expect(t.find(x => x.s === flow.title)?.size).toBe(11.5)
      expect(src).toContain(`class="s" font-size="11.5">${flow.title}<`)
      const right = t.find(x => x.s === '3/6 · 50%')
      expect(right?.anchor).toBe('end')
      expect(src).toContain('<tspan class="t" font-weight="600">3/6</tspan><tspan class="m"> · 50%</tspan>')
      // Three done, two running (a track under the accent), one waiting (a track and an amber outline).
      expect(segments(src).filter(f => f === FLOW_DONE)).toHaveLength(3)
      expect(segments(src).filter(f => f === FLOW_ACCENT)).toHaveLength(2)
      expect(tracks(src)).toBe(3)
      expect(src).toContain(`fill="none" stroke="${TONES.warn}" stroke-width="1.5"`)
      expect(src.includes(PALETTES[palette].accent) && palette !== 'classic' ? 'palette accent used' : 'ok').toBe('ok')
    }
    // Finished: every segment in the done colour, the whole count, 100%.
    const done = mainDrawing(ctxOf(480), fullMain(), 0, fullUsage(), { ...flow, done: 6, isFinished: true }).source
    expect(segments(done).filter(f => f === FLOW_DONE)).toHaveLength(6)
    expect(texts(done).some(x => x.s === '6/6 · 100%')).toBe(true)
    // A run's flow still names its agents in the alt.
    expect(mainDrawing(ctxOf(480), fullMain(), 0, fullUsage(), { ...flow, phase: 'review', done: 4, total: 5 }).alt).toContain('Review 4/5')
  })

  test('a running segment is filled as far as the fill says, in turn; with no fill, half', async () => {
    const runs = (fill?: number): number[] =>
      [...mainDrawing(ctxOf(480), fullMain(), 2, fullUsage(), flow, fill).source.matchAll(new RegExp(`<rect fill="${FLOW_ACCENT}" x="[\\d.]+" y="[\\d.]+" width="([\\d.]+)"`, 'g'))].map(m => Number(m[1]))
    const seg = Number(/<rect fill="#5fbf8f" x="[\d.]+" y="[\d.]+" width="([\d.]+)"/.exec(mainDrawing(ctxOf(480), fullMain(), 2, fullUsage(), flow).source)?.[1])
    // 0.75 of six tasks is 4.5: three done, the first running one full, the second half.
    const [a, b] = runs(0.75)
    expect(Math.abs((a ?? 0) - seg) < 0.02 && Math.abs((b ?? 0) - seg / 2) < 0.02).toBe(true)
    expect(runs().map(w => Math.abs(w - seg / 2) < 0.02)).toEqual([true, true])
    // Never less than a sliver.
    expect(runs(0.5).every(w => w >= Math.max(4, seg * 0.15) - 0.02)).toBe(true)
  })

  test('paused (a task on, nothing working): the name muted, done segments grey, no accent, no done colour', async () => {
    for (const status of ['resting', 'waiting'] as const) {
      const src = mainDrawing(ctxOf(480), { ...fullMain(), status, turnStartedAt: null }, 0, fullUsage(), flow).source
      expect(src).toContain(`class="m" font-size="11.5">${flow.title}<`)
      expect(segments(src).filter(f => f === '#9a9a96')).toHaveLength(3)
      for (const c of [FLOW_ACCENT, FLOW_DONE]) expect(src.includes(c)).toBe(false)
      expect(/class="t[0-3]"/.test(src) || src.includes('@keyframes tw')).toBe(false)
      expect(texts(src).some(x => x.s === '3/6 · 50%')).toBe(true)
    }
    expect(mainDrawing(ctxOf(480), { ...fullMain(), status: 'resting', turnStartedAt: null }, 0, fullUsage(), flow).alt).toContain('Paused · 3/6')
  })

  test('the strip follows the four task states: the main agent working or an agent running is running', async () => {
    const strip = (status: MainRun['status'], running: number, f: Flow | null): string => mainDrawing(ctxOf(480), { ...fullMain(), status }, running, fullUsage(), f).source
    // Resting while an agent runs: running, one running segment.
    expect(segments(strip('resting', 1, flow)).filter(f => f === FLOW_ACCENT)).toHaveLength(1)
    // Working with no agents: running, no running segment.
    const alone = strip('working', 0, flow)
    expect(alone.includes(FLOW_ACCENT)).toBe(false)
    expect(segments(alone).filter(f => f === FLOW_DONE)).toHaveLength(3)
    // Done, even while resting.
    expect(segments(strip('resting', 0, { ...flow, isFinished: true })).filter(f => f === FLOW_DONE)).toHaveLength(6)
    // None: No task yet.
    expect(strip('working', 2, null).includes('>No task yet<')).toBe(true)
    // flow.running is never drawn: a stale count with nothing running draws no running segment.
    expect(strip('working', 0, { ...flow, running: 5 }).includes(FLOW_ACCENT)).toBe(false)
  })

  test('no task: a muted No task yet over an empty track, no count, no percent', async () => {
    for (const status of ['working', 'resting'] as const) {
      const src = mainDrawing(ctxOf(480), { ...fullMain(), status }, 0, fullUsage(), null).source
      expect(src).toContain('class="m" font-size="11.5">No task yet<')
      expect(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="8" rx="4" fill="#808080"/.test(src)).toBe(true)
      expect(/>\d+%</.test(src) || /\d+\/\d+/.test(texts(src).map(x => x.s).join(' '))).toBe(false)
      for (const c of [FLOW_ACCENT, FLOW_DONE]) expect(src.includes(c)).toBe(false)
    }
  })

  test('too many tasks for segments: one bar filled to the plan', async () => {
    const many = { ...flow, total: 200, done: 50 }
    const src = mainDrawing(ctxOf(240), fullMain(), 1, fullUsage(), many).source
    expect(segments(src)).toHaveLength(0)
    expect(/<rect fill="#8f8cf4" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="8" rx="4"\/>/.test(src)).toBe(true)
    expect(texts(src).some(x => x.s === '50/200 · 25%')).toBe(true)
  })

  test('status, chip and figures', async () => {
    const c = ctxOf(700)
    const working = mainDrawing(c, fullMain(), 2, fullUsage()).source
    expect(working).toContain(`<rect fill="#D97757" fill-opacity=".2"`)
    expect(working).toContain('height="18" rx="9"/>')
    expect(working).toContain('class="chip" text-anchor="middle" font-size="11" font-weight="600">working<')
    expect(mainDrawing(c, { ...fullMain(), status: 'waiting' }, 2, fullUsage()).source.includes('>waiting<')).toBe(true)
    // Resting, the time since the last turn counts in whole minutes (audit finding 5).
    const rest = mainDrawing(c, { ...fullMain(), status: 'resting', turnStartedAt: null, doingSince: NOW - 42_000 }, 0, fullUsage())
    expect(rest.source.includes('Resting · last turn just now')).toBe(true)
    const later = mainDrawing(c, { ...fullMain(), status: 'resting', turnStartedAt: null, doingSince: NOW - 5 * MIN - 42_000 }, 0, fullUsage())
    expect(later.source.includes('Resting · last turn 5m ago')).toBe(true)
    // Within the same minute the drawing is the same, clock or no clock.
    const at = (now: number) => mainDrawing({ ...c, now, clock: now }, { ...fullMain(), status: 'resting', turnStartedAt: null, doingSince: NOW - 5 * MIN }, 0, fullUsage()).source
    expect(at(NOW + 10_000)).toBe(at(NOW + 50_000))
    expect(at(NOW + 70_000)).toContain('last turn 6m ago')
  })

  test('the whole doing line and every figure at W 300-480, mascot 100% and 250%; figures wrap between figures', async () => {
    const doing = 'Running SRC="/c/Users/me/pixel-crew" && npx tsc -p "$SRC"'
    for (const W of [300, 320, 400, 480])
      for (const iconSize of [100, 250]) {
        const d = mainDrawing(ctxOf(W, { iconSize, currency: 'GBP' }), { ...fullMain(), use: { input: 20, output: 96_000, cacheRead: 14_000_000, cacheWrite: 310_000 }, doing }, 2, fullUsage())
        const shown = texts(d.source).map(t => t.s)
        const all = shown.join(' ').replace(/\s+/g, ' ')
        const label = `W=${W} icon ${iconSize}`
        // A word wider than the line breaks inside it: every character is still there.
        expect(all.replace(/\s+/g, '').includes(doing.replace(/\s+/g, '')) ? 'ok' : `${label}: doing line cut: ${shown.join(' | ')}`).toBe('ok')
        for (const stat of ['in 14M · out 96k', '≈£7.74', '11:42', 'No task yet', '2 agents', 'Fable 5.2 · high'])
          expect(all.includes(stat) ? 'ok' : `${label}: missing ${stat} in ${shown.join(' | ')}`).toBe('ok')
        // A figure line never starts or ends on its separator.
        for (const s of shown) expect(/^·|·$/.test(s.trim()) ? `${label}: "${s}"` : 'ok').toBe('ok')
        expect(d.source.includes('cache')).toBe(false)
        expect(d.source.includes('…')).toBe(false)
        inside(d, label)
      }
  })
})

describe('agent rows', () => {
  test('tokens read in · out with the cache counted in in, then cost and time; the cache figures open the log instead', async () => {
    const d = agentDrawing(ctxOf(480), run())
    const shown = texts(d.source).map(t => t.s)
    expect(shown).toContain('in 270k · out 3k · ≈$0.42 · 1:32')
    expect(texts(d.source).find(t => t.s.startsWith('in 270k'))?.size).toBe(11)
    expect(d.source.includes('cache')).toBe(false)
    expect(cacheLine(run().use)).toBe('Cache read 240k · write 18k')
    expect(cacheLine({ input: 5, output: 5, cacheRead: 0, cacheWrite: 0 })).toBe('')
    expect(cacheLine(undefined)).toBe('')
    // Title 13, kind and model 11.5 with the kind in 600, doing 12 with its step first.
    expect(texts(d.source).find(t => t.s === 'Port the progress row')?.size).toBe(13)
    expect(d.source).toContain(`<tspan fill="${agentColor(run())}" font-weight="600">Refactor</tspan>`)
    expect(texts(d.source).find(t => t.s.startsWith('3/6 · ticks'))?.size).toBe(12)
  })

  test('a working or waiting row ends in its thin bar; a finished one has none and is 10px shorter', async () => {
    const bars = (src: string): number => (src.match(/height="4" rx="2"/g) ?? []).length
    for (const status of ['running', 'waiting'] as const) expect(bars(agentDrawing(ctxOf(480), run({ status })).source)).toBe(2)
    for (const status of ['done', 'failed'] as const) {
      const fin = agentDrawing(ctxOf(480), run({ status, endedAt: NOW }))
      expect(bars(fin.source)).toBe(0)
      expect(agentDrawing(ctxOf(480), run()).height - fin.height).toBe(10)
    }
  })
})

describe('rows grow instead of cutting', () => {
  test('row heights grow with long text and with iconSize 250', async () => {
    for (const W of [320, 480]) {
      const c = ctxOf(W)
      expect(agentDrawing(c, run({ description: LONG })).height).toBeGreaterThan(agentDrawing(c, run()).height)
      expect(agentDrawing(c, run({ doing: CMD })).height).toBeGreaterThan(agentDrawing(c, run()).height)
      expect(plannedDrawing(c, { ...planned, title: LONG }).height).toBeGreaterThan(plannedDrawing(c, planned).height)
      const big = ctxOf(W, { iconSize: 250 })
      expect(mainDrawing(big, fullMain(), 0, fullUsage()).height).toBeGreaterThan(mainDrawing(c, fullMain(), 0, fullUsage()).height)
      expect(mainDrawing(big, fullMain(), 0, fullUsage()).source.includes('scale(6)')).toBe(true)
      expect(agentDrawing(big, run()).source.includes('scale(2.75)')).toBe(true)
    }
  })

  test('a long title is capped at two lines and the doing line at three', async () => {
    for (const W of [240, 320])
      for (const title of [LONG, CJK.repeat(7)]) {
        const d = agentDrawing(ctxOf(W), run({ description: title, doing: title, stepNote: title }))
        check(d, 'long agent')
        expect(texts(d.source).filter(t => t.size === 13).length).toBe(2)
        expect(texts(d.source).filter(t => t.size === 12).length).toBe(3)
        inside(d, 'long agent')
      }
  })

  test('the plan title is one fitted line, 28px', async () => {
    const d = titleDrawing(ctxOf(240), LONG)
    expect(d.height).toBe(28)
    expect(texts(d.source).length).toBe(1)
    expect(d.source.includes('…')).toBe(true)
    inside(d, 'title')
    expect(titleDrawing(ctxOf(480), 'Ship v3').source.includes('>Ship v3<')).toBe(true)
    expect(titleDrawing(ctxOf(480), 'Ship v3').source.includes('class="t"')).toBe(true)
  })

  test('with no plan the title is a muted No task, the same height', async () => {
    for (const empty of ['', '   ', '\u0007', undefined as never]) {
      const d = titleDrawing(ctxOf(320), empty)
      check(d, 'no-task title')
      expect(d.height).toBe(28)
      expect(d.source.includes('<text x="0" y="19" class="m"')).toBe(true)
      expect(d.source.includes('>No task yet<')).toBe(true)
      expect(d.alt).toBe('No task yet')
    }
  })
})

describe('inline log', () => {
  test('time, mark, text and duration per entry, newest last, a rule in the colour', async () => {
    const d = logDrawing(ctxOf(480), LOG, '#BB811B')
    const t = texts(d.source)
    expect(d.source.includes('<rect x="0" y="0" width="2"') && d.source.includes('fill="#BB811B"')).toBe(true)
    for (const mark of ['›', '∴', '✓', '✗', '⊘', '•', '✎', '…']) expect(t.some(x => x.s === mark) ? 'ok' : `missing ${mark}`).toBe('ok')
    expect(t[0]?.s).toBe('11:51:00')
    expect(t.some(x => x.s === '11:59:50')).toBe(true)
    const durations = t.filter(x => x.anchor === 'end').map(x => x.s)
    expect(durations).toEqual(['6.2s', '0.1s', '8.1s', '2.4s', '1:15'])
    // The open entry, the newest, is drawn last.
    expect(t[t.length - 1]?.s).toBe('Running claude plugin test')
    expect(logDrawing({ ...ctxOf(480), tzOffsetMin: 60 }, LOG, '#BB811B').source.includes('>12:51:00<')).toBe(true)
  })

  test('text wraps to two lines at most', async () => {
    const long: LogEntry = { at: NOW, kind: 'tool', text: LONG, outcome: 'ok', ms: 1200 }
    const d = logDrawing(ctxOf(320), [long], '#BB811B')
    const lines = texts(d.source).filter(x => x.size === 11.5 && x.s !== '✓')
    expect(lines.length).toBe(2)
    expect(lines[1]?.s.endsWith('…')).toBe(true)
    inside(d, 'long log')
  })

  test('at most logLines entries, never taller than 4000px', async () => {
    const short: LogEntry[] = Array.from({ length: 300 }, (_, i) => ({ at: NOW - (300 - i) * 1000, kind: 'tool', text: `Entry ${i}`, outcome: 'ok', ms: 100 }))
    const five = logDrawing(ctxOf(480, { logLines: 5 }), short, '#BB811B')
    expect(texts(five.source).filter(x => /^\d\d:\d\d:\d\d$/.test(x.s)).map(x => x.s)).toEqual(['11:59:55', '11:59:56', '11:59:57', '11:59:58', '11:59:59'])
    expect(five.source.includes('>Entry 299<') && !five.source.includes('>Entry 294<')).toBe(true)
    const tall = short.map(e => ({ ...e, text: `${LONG} ${e.text}` }))
    const all = logDrawing(ctxOf(240, { logLines: 200 }), tall, '#BB811B')
    check(all, 'tall log')
    expect(all.height <= 4000).toBe(true)
    // The newest stays; the oldest went to keep it under 4000px.
    const times = texts(all.source).filter(x => /^\d\d:\d\d:\d\d$/.test(x.s)).map(x => x.s)
    expect(times[times.length - 1]).toBe('11:59:59')
    expect(times.length < 200).toBe(true)
  })

  test('the row\'s cache figures open the log, muted, over its entries or over No activity yet', async () => {
    const head = cacheLine(run().use)
    const d = logDrawing(ctxOf(480), LOG, '#BB811B', head)
    const t = texts(d.source)
    expect([t[0]?.s, t[0]?.y, t[0]?.size]).toEqual(['Cache read 240k · write 18k', 18, 11])
    expect(d.source).toContain('class="m" font-size="11" font-variant-numeric="tabular-nums">Cache read 240k')
    // Every entry one line further down.
    const plain = texts(logDrawing(ctxOf(480), LOG, '#BB811B').source)
    expect((t.find(x => x.s === '11:51:00')?.y ?? 0) - (plain.find(x => x.s === '11:51:00')?.y ?? 0)).toBe(19)
    expect(d.height - logDrawing(ctxOf(480), LOG, '#BB811B').height).toBe(19)
    expect(d.alt).toContain(head)
    const empty = logDrawing(ctxOf(320), [], '#BB811B', head)
    expect(texts(empty.source).map(x => x.s)).toEqual([head, 'No activity yet.'])
    check(empty, 'empty log with its cache line')
    inside(logDrawing(ctxOf(120), LOG, '#BB811B', head), 'narrow log with its cache line')
  })

  test('an empty log says so; a bad colour falls back', async () => {
    const d = logDrawing(ctxOf(320), [], 'url(#x)')
    expect(d.source.includes('No activity yet.')).toBe(true)
    expect(d.source.includes('url(')).toBe(false)
    check(d, 'empty log')
  })
})

describe('progress row', () => {
  const xOf = (src: string, re: RegExp): number => Number(re.exec(src)?.[1])
  const FAINT = /opacity="0\.45"|width="1\.7"/
  const progress = (f: Flow | null, state: TaskState, o: { W?: number; s?: Partial<Settings>; crew?: number; running?: number; age?: number } = {}): string =>
    progressDrawing(f, o.W ?? 700, settingsOf(o.s), state, o.crew ?? 0, o.running ?? 0, o.age).source

  test('percent, then the mascot 6px after it, then ×N 4px after that', async () => {
    for (const W of [240, 320, 480, 700]) {
      const d = progressDrawing(flow, W, settingsOf(), 'running', 6, 2)
      const t = texts(d.source)
      const percent = t.find(x => x.s === '50%')
      const count = t.find(x => x.s === '×6')
      const mascot = xOf(d.source, /<g[^>]*transform="translate\(([\d.]+),[\d.]+\) scale\(0\.8\)/)
      expect(percent?.anchor).toBe('end')
      expect(Math.round(mascot - (percent?.x ?? 0))).toBe(6)
      expect(Math.round((count?.x ?? 0) - mascot)).toBe(24 + 4)
      expect((count?.right ?? 999) <= W).toBe(true)
      expect(d.source.includes('font-size="12" font-variant-numeric="tabular-nums">×6<')).toBe(true)
      expect(d.height).toBe(BAR_H)
    }
  })

  // The count is drawn with tabular numerals, where `1` is as wide as `0`. Sized as plain
  // text, `×16` got the room of a narrow `1` and its last digit was cut at the row's edge.
  test('a count with a 1 in it stays inside the row: ×10, ×11, ×16, ×100, ×111', async () => {
    for (const crew of [10, 11, 16, 100, 111]) {
      for (const W of [240, 320, 480, 700]) {
        const d = progressDrawing(flow, W, settingsOf(), 'running', crew, 2)
        const count = texts(d.source).find(x => x.s === `×${crew}`)
        // Every digit at least as wide as `0`.
        const right = (count?.x ?? Infinity) + textWidth(`×${crew}`.replace(/\d/g, '0'), 12)
        expect(right <= W ? 'ok' : `×${crew} ends at ${Math.round(right)} in ${W}`).toBe('ok')
      }
    }
  })

  test('no count when the crew is empty', async () => {
    expect(progress(flow, 'running', { W: 480 }).includes('×')).toBe(false)
  })

  test("running: savvy-progress's accent under every palette, the pill, the percent, the twinkle", async () => {
    for (const palette of PALETTE_LIST) {
      const pal = PALETTES[palette]
      const running = progress(flow, 'running', { s: { palette }, crew: 2, running: 2 })
      const done = progress({ ...flow, done: 6, isFinished: true }, 'done', { s: { palette } })
      expect(running.includes(`<circle cx="5" cy="12" r="4" fill="${FLOW_ACCENT}"/>`)).toBe(true)
      expect(running.includes(`<g fill="${FLOW_ACCENT}">`) && running.includes(`<g fill="${FLOW_ACCENT}" opacity="0.45">`)).toBe(true)
      expect(new RegExp(`<rect x="\\d+" width="\\d+" height="16" rx="8" fill="${FLOW_ACCENT}"/>`).test(running)).toBe(true)
      expect(running.includes('>Tasks 3/6<') && running.includes('>50%<')).toBe(true)
      expect(done.includes(`<circle cx="5" cy="12" r="4" fill="${FLOW_DONE}"/>`) && done.includes(`<g fill="${FLOW_DONE}">`)).toBe(true)
      expect(running.includes(FLOW_DONE)).toBe(false)
      // No palette colour on the row, whichever palette (classic's accent and done are the flow colours).
      if (palette !== 'classic') for (const c of [pal.accent, pal.done, pal.calm]) expect(running.includes(c) || done.includes(c) ? `${palette} ${c} on the row` : 'ok').toBe('ok')
    }
    expect(progressDrawing({ ...flow, title: LONG }, 320, settingsOf(), 'running', 3, 3).source.includes(LONG)).toBe(false)
  })

  test('running: the faint layer reaches min(total, done + agents really running) / total, never from flow.running', async () => {
    const faintEnd = (src: string): number => Math.max(0, ...[...src.matchAll(/<rect class="t[0-3]" x="(\d+)" y="\d+" width="1\.7"/g)].map(m => Number(m[1])))
    const fillEnd = (src: string): number => Math.max(0, ...[...src.matchAll(/<rect class="t[0-3]" x="(\d+)" y="\d+" width="2"/g)].map(m => Number(m[1])))
    const track = (src: string): number => Number(/<rect class="ftk" width="(\d+)"/.exec(src)?.[1])
    // With a stale flow.running and no agent running: no faint layer at all.
    expect(FAINT.test(progress({ ...flow, running: 3 }, 'running', { running: 0 }))).toBe(false)
    // One agent: up to 4/6 of the track; two: 5/6; ten: capped at the whole track.
    for (const [n, upTo] of [[1, 4 / 6], [2, 5 / 6], [10, 1]] as const) {
      const src = progress({ ...flow, running: 0 }, 'running', { running: n })
      const w = track(src)
      expect(fillEnd(src) < w / 2 + 3).toBe(true)
      expect(faintEnd(src) > w / 2 && faintEnd(src) <= w * upTo + 1 && faintEnd(src) > w * upTo - 20 ? 'ok' : `${n}: faint ends at ${faintEnd(src)} of ${w}`).toBe('ok')
    }
  })

  test('none, paused and done never draw the faint layer, whatever flow.running or agentsRunning say', async () => {
    for (const state of ['none', 'paused', 'done'] as const)
      for (const running of [0, 2, 9])
        for (const f of [{ ...flow, running: 4 }, { ...flow, done: 6, isFinished: true, running: 4 }, null])
          for (const W of [240, 480, 700]) {
            const src = progress(f, state, { W, running, crew: running })
            expect(FAINT.test(src) ? `${state} running ${running} W=${W}: faint layer` : 'ok').toBe('ok')
          }
  })

  test('paused: the same row in neutral grey, still, the pill Paused · 3/6 (else the bare count)', async () => {
    const src = progress(flow, 'paused', { crew: 2 })
    expect(src.includes('<circle cx="5" cy="12" r="4" fill="#9a9a96"/>')).toBe(true)
    expect(src.includes('<g fill="#9a9a96">')).toBe(true)
    expect(/<rect x="\d+" width="\d+" height="16" rx="8" fill="#9a9a96"\/>/.test(src)).toBe(true)
    expect(src.includes('>Paused · 3/6<') && src.includes('>50%<')).toBe(true)
    for (const c of [FLOW_ACCENT, FLOW_DONE]) expect(src.includes(c)).toBe(false)
    expect(/class="t[0-3]"/.test(src) || src.includes('@keyframes tw')).toBe(false)
    // A short track falls back to the bare count, then to nothing.
    const labels = [240, 200, 170, 150].map(W => texts(progress(flow, 'paused', { W })).filter(x => x.size === 11).map(x => x.s))
    for (const l of labels) expect(['Paused · 3/6', '3/6'].includes(l[0] ?? '') || l.length === 0).toBe(true)
    expect(labels.some(l => l[0] === '3/6')).toBe(true)
    // No count to show: Paused alone.
    expect(progress({ ...flow, phase: 'plan', total: 0, done: 0 }, 'paused').includes('>Paused<')).toBe(true)
  })

  test('done: the done colour, Done, 100%, the slow twinkle', async () => {
    // Done follows the state, even before the flow itself says so.
    for (const f of [{ ...flow, done: 6, isFinished: true }, flow]) {
      const src = progress(f, 'done')
      expect(src.includes(`<circle cx="5" cy="12" r="4" fill="${FLOW_DONE}"/>`)).toBe(true)
      expect(src.includes('>Done<') && src.includes('>100%<')).toBe(true)
      expect(src.includes('.t0,.t1,.t2,.t3{animation:tw 3.2s ease-in-out infinite}')).toBe(true)
    }
  })

  test("the twinkle: savvy-progress's four groups, durations and delays, running and done", async () => {
    const running = progress(flow, 'running', { crew: 2, running: 2 })
    const done = progress({ ...flow, done: 6, isFinished: true }, 'done')
    expect(running.includes('.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}')).toBe(true)
    expect(running.includes('.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}')).toBe(true)
    expect(running.includes('@keyframes tw{0%,100%{opacity:1}50%{opacity:0.3}}')).toBe(true)
    expect(done.includes('.t0,.t1,.t2,.t3{animation:tw 3.2s ease-in-out infinite}')).toBe(true)
    expect(done.includes('.t1{animation-duration:3.8s;animation-delay:-.7s}.t2{animation-duration:4.4s;animation-delay:-1.3s}.t3{animation-duration:3.5s;animation-delay:-.4s}')).toBe(true)
    expect(done.includes('@keyframes tw{0%,100%{opacity:1}50%{opacity:0.8}}')).toBe(true)
    for (const src of [running, done]) {
      expect(src.includes('@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}')).toBe(true)
      for (const k of [0, 1, 2, 3]) expect(src.includes(`<rect class="t${k}" `), `t${k}`).toBe(true)
      // Only the dots carry the twinkle classes: nothing else is a t0-t3 element.
      expect([...src.matchAll(/<(\w+) class="t[0-3]"/g)].every(m => m[1] === 'rect')).toBe(true)
    }
    // The twinkle does not follow the animations setting (that is for entrances), nor an entrance in progress.
    const still = progress(flow, 'running', { s: { animations: false }, crew: 2, running: 2 })
    expect(still.includes('.t0,.t1,.t2,.t3{animation:tw 2.2s') && /<rect class="t[0-3]"/.test(still)).toBe(true)
    const entering = progress(flow, 'running', { crew: 2, running: 2, age: 100 })
    expect(entering.includes('.t0,.t1,.t2,.t3{animation:tw 2.2s')).toBe(true)
    // The entrance sits on wrapper groups, never on a dot: a dot's own element has no style or pc- class.
    expect(/<rect class="[^"]*pc-|<rect class="t[0-3][^"]*" style=/.test(entering)).toBe(false)
  })

  test('the dither matches savvy-progress: cells of 3px, 2px dots, a faint layer for handed-out work, ticks on the rest', async () => {
    const src = progress(flow, 'running', { crew: 2, running: 2 })
    expect(/<rect class="t[0-3]" x="\d+" y="\d+" width="2" height="2"\/>/.test(src)).toBe(true)
    expect(/<g fill="#8f8cf4" opacity="0\.45"><rect class="t[0-3]" x="\d+" y="\d+" width="1\.7" height="1\.7"\/>/.test(src)).toBe(true)
    expect(/<g class="tk"><rect x="\d+" y="4" width="1\.5" height="8" rx="0\.75"\/>/.test(src)).toBe(true)
    expect(src.includes('<clipPath id="pc-flow">') && src.includes('clip-path="url(#pc-flow)"')).toBe(true)
  })

  test('the mascot: the crab works running and is done when done; the cat rides its broom in both; both rest otherwise', async () => {
    const poseOf = (src: string): string => /<g class="(?:cw|ct) (?:cw|ct)-r-main (?:cw|ct)-(\w+)"/.exec(src)?.[1] ?? ''
    // `ride` is joining the sprites' poses; until it has, the sprites draw an unknown pose as `done`.
    const ride = /\bct-ride\b/.test(sprite({ theme: 'cat', role: 'main', pose: 'ride' as Pose, x: 0, y: 0 })) ? 'ride' : 'done'
    const want: Record<ThemeName, Record<TaskState, string>> = {
      clawd: { none: 'rest', running: 'work', paused: 'rest', done: 'done' },
      cat: { none: 'rest', running: ride, paused: 'rest', done: ride },
    }
    for (const theme of THEMES)
      for (const state of STATES) {
        const f = state === 'done' ? { ...flow, isFinished: true } : flow
        expect(`${theme} ${state}: ${poseOf(progress(state === 'none' ? null : f, state, { s: { theme } }))}`).toBe(`${theme} ${state}: ${want[theme][state]}`)
      }
    // No smile is asked of the sprites anywhere.
    for (const theme of THEMES) expect(progress(flow, 'running', { s: { theme } }).includes('ct-smiling')).toBe(false)
  })

  test('collapsed row: No task yet, Tasks 3/6, Paused 3/6 or Done, then agents, context and the 5-hour window', async () => {
    const line = (f: Flow | null, state: TaskState, running = 0): string =>
      texts(collapsedDrawing({ W: 700, now: NOW, flow: f, state, usage: fullUsage(), main: fullMain(), settings: settingsOf(), agentsRunning: running }).source)[0]?.s ?? ''
    expect(line(flow, 'running', 2)).toBe('Tasks 3/6 · 2 agents · ctx 52% · 5h 40% left')
    expect(line(flow, 'paused')).toBe('Paused 3/6 · ctx 52% · 5h 40% left')
    expect(line({ ...flow, isFinished: true }, 'done')).toBe('Done · ctx 52% · 5h 40% left')
    expect(line(null, 'none')).toBe('No task yet · ctx 52% · 5h 40% left')
    // A flow handed with state none, or no flow with another state: no task yet.
    expect(line(flow, 'none')).toBe('No task yet · ctx 52% · 5h 40% left')
    expect(line(null, 'running', 1)).toBe('No task yet · 1 agent · ctx 52% · 5h 40% left')
    const d = collapsedDrawing({ W: 700, now: NOW, flow, state: 'running', usage: fullUsage(), main: fullMain(), settings: settingsOf(), agentsRunning: 2 })
    expect(d.height).toBe(20)
    const bare = collapsedDrawing({ W: 480, now: NOW, flow: null, state: 'none', usage: blankUsage(NOW), main: blankMain(NOW), settings: settingsOf(), agentsRunning: 0 })
    expect(bare.source.includes('>No task yet<')).toBe(true)
    expect(bare.source.includes('Ready')).toBe(false)
    check(bare, 'collapsed, no task')
  })

  // The idle row's parts: the mascot's x, the track's box, and every text.
  const mascotX = (src: string): number => xOf(src, /<g[^>]*transform="translate\(([\d.]+),[\d.]+\) scale\(0\.8\)/)
  const idleTrack = (src: string): { x: number; w: number; h: number } => {
    const m = /<rect class="k" x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/.exec(src)
    return { x: Number(m?.[1]), w: Number(m?.[2]), h: Number(m?.[3]) }
  }
  const flowTrack = (src: string): { x: number; w: number; h: number } => {
    const x = xOf(src, /<g transform="translate\(([\d.]+),[\d.]+\)">\s*<defs><clipPath id="pc-flow">/)
    const m = /<rect class="ftk" width="([\d.]+)" height="([\d.]+)"/.exec(src)
    return { x, w: Number(m?.[1]), h: Number(m?.[2]) }
  }

  test('none: a muted dot and No task yet, an empty track, no pill or percent, the resting mascot and a muted ×0', async () => {
    for (const W of [240, 320, 480, 700, 1000]) {
      const d = progressDrawing(null, W, settingsOf(), 'none', 5, 3)
      check(d, `idle ${W}`)
      expect(d.height).toBe(BAR_H)
      const t = texts(d.source)
      // Whole from 320; at 240 the title is fitted as any title is, so the bar keeps its 60px.
      const title = W >= 320 ? 'No task yet' : (t[0]?.s ?? '')
      expect(W >= 320 || /^No task/.test(title)).toBe(true)
      expect(t.map(x => x.s)).toEqual([title, '×0'])
      expect(d.source.includes('<circle class="m" cx="5"')).toBe(true)
      expect(d.source.includes(`class="m" font-size="13" font-weight="500">${title}<`)).toBe(true)
      expect(d.source.includes('class="m" font-size="12" font-variant-numeric="tabular-nums">×0<')).toBe(true)
      // No pill, no percent, no fill on the track, and no palette colour anywhere.
      expect(d.source.includes('%<')).toBe(false)
      expect(d.source.includes('fill="#ffffff"')).toBe(false)
      expect(d.source.includes('clip-path')).toBe(false)
      for (const c of [PALETTES.classic.accent, PALETTES.classic.done]) expect(d.source.includes(c)).toBe(false)
      const track = idleTrack(d.source)
      expect(track.h).toBe(16)
      expect(track.w).toBeGreaterThanOrEqual(60)
      // The percent column is as wide as `100%` drawn in tabular figures, as the percent is.
      expect(Math.round(mascotX(d.source) - (track.x + track.w))).toBe(8 + Math.ceil(tabularWidth('100%', 12.5)) + 6)
    }
    // A flow handed in with state none still draws the idle row, as does no flow with any state.
    expect(progress(flow, 'none').includes('>No task yet<')).toBe(true)
    for (const state of STATES) expect(progress(null, state).includes('>No task yet<')).toBe(true)
    expect(progressDrawing(undefined as never, 480, settingsOf(), 'running', 0, 0).source.includes('>No task yet<')).toBe(true)
  })

  test('the resting mascot of the idle row matches the paused row', async () => {
    const spriteOf = (src: string): string => /<g[^>]*scale\(0\.8\)[\s\S]*$/.exec(src)?.[0].replace(/translate\([\d.]+,/, 'translate(X,').replace(/(<text[\s\S]*)?<\/svg>$/, '') ?? ''
    for (const theme of THEMES) {
      const idle = progress(null, 'none', { W: 480, s: { theme } })
      expect(spriteOf(idle)).toBe(spriteOf(progress(flow, 'paused', { W: 480, s: { theme } })))
      expect(spriteOf(idle)).not.toBe(spriteOf(progress(flow, 'running', { W: 480, s: { theme } })))
    }
  })

  test('nothing jumps when a plan starts: the mascot, the track end and the height match the row with a flow', async () => {
    const plans = [
      { ...flow, phase: 'plan' as const, total: 0, done: 0, running: 0 },
      flow,
      { ...flow, title: LONG },
      { ...flow, title: '' },
      { ...flow, title: CJK },
    ]
    for (const W of [160, 200, 240, 320, 480, 700, 1000])
      for (const theme of THEMES) {
        const s = settingsOf({ theme })
        const idle = progressDrawing(null, W, s, 'none', 0, 0)
        for (const f of plans)
          for (const state of ['running', 'paused', 'done'] as const)
            for (const crew of [0, 1, 6, 9]) {
              const d = progressDrawing(f, W, s, state, crew, crew)
              const what = `W=${W} ${theme} ${state} "${f.title.slice(0, 10)}" crew ${crew}`
              expect(d.height === idle.height ? 'ok' : `${what}: height`).toBe('ok')
              expect(Math.abs(mascotX(d.source) - mascotX(idle.source)) < 1 ? 'ok' : `${what}: mascot ${mascotX(d.source)} vs ${mascotX(idle.source)}`).toBe('ok')
              const a = flowTrack(d.source)
              const b = idleTrack(idle.source)
              expect(Math.abs(a.x + a.w - (b.x + b.w)) < 1 && a.h === b.h ? 'ok' : `${what}: track ends ${a.x + a.w} vs ${b.x + b.w}`).toBe('ok')
            }
      }
  })

  test('with no flow the row drops in like the flow row', async () => {
    expect(progress(null, 'none', { W: 480, age: 10 }).includes('<g class="pc-drop" style="animation-delay:-10ms">')).toBe(true)
    expect(/pc-(in|drop|grow|sweep)/.test(progress(null, 'none', { W: 480, age: 1000 }))).toBe(false)
    expect(/pc-(in|drop|grow|sweep)/.test(progress(null, 'none', { W: 480, s: { animations: false }, age: 10 }))).toBe(false)
  })
})

describe('pill parts', () => {
  test('meters: a 68x8 bar or a 13px ring in a 17px drawing, scaled, filled in the tone', async () => {
    const g = limit('five_hour', 60, HOUR)
    const b = meterDrawing(g, settingsOf(), 'bar')
    expect([b.width, b.height]).toEqual([68, 8])
    expect(/fill="#3fa66b" x="0" y="0" width="27.2"/.test(b.source)).toBe(true)
    const ring = meterDrawing(g, settingsOf({ palette: 'sunset' }), 'ring')
    expect([ring.width, ring.height]).toEqual([13, 17])
    expect(ring.source.includes(PALETTES.sunset.calm)).toBe(true)
    expect(ring.source.includes('rotate(-90 6.5 8.5)')).toBe(true)
    const big = meterDrawing(g, settingsOf(), 'bar', 1.5)
    expect([big.width, big.height]).toEqual([102, 12])
    check(big, 'scaled meter')
    // Context fills what is used.
    expect(/width="47.6"/.test(meterDrawing(contextGauge({ ...fullUsage(), contextPercent: 70 }), settingsOf(), 'bar').source)).toBe(true)
    for (const kind of ['bar', 'ring'] as const)
      for (const used of [0, 50, 75, 95, 100]) check(meterDrawing(limit('seven_day', used, HOUR), settingsOf(), kind), `meter ${kind} ${used}`)
  })

  test('the pill ring has 2px of clear space above and below, at every scale', async () => {
    for (const scale of [undefined, 0.8, 1, 1.25, 1.6]) {
      const d = meterDrawing(limit('five_hour', 60, HOUR), settingsOf(), 'ring', scale)
      check(d, `ring ${scale}`)
      const k = scale ?? 1
      // The ring's outer edge: its centre, its radius and half its stroke, in the drawing's own units.
      const m = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="none" stroke-width="([\d.]+)"/.exec(d.source)
      const [cy, rad, sw] = [Number(m?.[2]), Number(m?.[3]), Number(m?.[4])]
      expect(Math.abs(rad * 2 + sw - 13) < 0.01).toBe(true)
      expect(Math.abs(cy - 8.5) < 0.01).toBe(true)
      const top = (cy - rad - sw / 2) * (d.height / 17)
      const bottom = d.height - (cy + rad + sw / 2) * (d.height / 17)
      expect(Math.abs(top - 2 * k) < 0.35 && Math.abs(bottom - 2 * k) < 0.35 ? 'ok' : `scale ${scale}: ${top} above, ${bottom} below`).toBe('ok')
      expect(d.width).toBe(Math.round(13 * k))
    }
  })

  test('icons: 14px, each its own, in the colour given', async () => {
    const names: PillIcon[] = ['fiveHour', 'week', 'speed', 'cache', 'time']
    const seen = new Set<string>()
    for (const n of names) {
      const d = pillIconDrawing(n, '#2E9BB8')
      check(d, `pill icon ${n}`)
      expect([d.width, d.height]).toEqual([14, 14])
      expect(d.source.includes('#2E9BB8')).toBe(true)
      seen.add(d.source)
      expect(pillIconDrawing(n, '#2E9BB8', 1.5).width).toBe(21)
    }
    expect(seen.size).toBe(names.length)
    expect(pillIconDrawing('time', 'javascript:x').source.includes('javascript')).toBe(false)
  })

  test('tints follow the palette: a soft fill at 0.12 and a stronger outline at 0.5 of one colour', async () => {
    const rgb = (hex: string): string => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')
    const pair = (hex: string): { border: string; back: string } => ({ border: `rgba(${rgb(hex)},0.5)`, back: `rgba(${rgb(hex)},0.12)` })
    expect(pillTint('limit', 'alert', settingsOf())).toEqual({ border: 'rgba(214,69,69,0.5)', back: 'rgba(214,69,69,0.12)' })
    for (const palette of PALETTE_LIST) {
      const s = settingsOf({ palette })
      const p = PALETTES[palette]
      // Meters: their tone's colour at every tone, calm included.
      for (const kind of ['context', 'limit'] as PillKind[]) {
        expect(pillTint(kind, 'calm', s)).toEqual(pair(p.calm))
        expect(pillTint(kind, 'warn', s)).toEqual(pair(p.warn))
        expect(pillTint(kind, 'alert', s)).toEqual(pair(p.alert))
      }
      // The cache countdown: the tone its caller gives by time left.
      expect(pillTint('cache', 'calm', s)).toEqual(pair(p.calm))
      expect(pillTint('cache', 'warn', s)).toEqual(pair(p.warn))
      expect(pillTint('cache', 'alert', s)).toEqual(pair(p.alert))
      expect(pillTint('cache', undefined, s)).toEqual(pair(p.calm))
      // Speed, turn and time: the accent, whatever tone is passed.
      for (const kind of ['speed', 'turn', 'time'] as PillKind[]) for (const tone of ['calm', 'alert', undefined] as const) expect(pillTint(kind, tone, s)).toEqual(pair(p.accent))
    }
    // Junk: a tone it does not know reads as calm; a kind it does not know gets a neutral grey pair.
    expect(pillTint('limit', 'bogus' as never, settingsOf())).toEqual(pair(PALETTES.classic.calm))
    const n = pillTint('bogus' as never, 'alert', settingsOf())
    expect(/^rgba\(127,127,127,0\.\d+\)$/.test(n.border) && /^rgba\(127,127,127,0\.\d+\)$/.test(n.back)).toBe(true)
    expect(pillTint('time', undefined, null as never)).toEqual(pair(PALETTES.ocean.accent))
    // The muted tone of a pill with no figure yet: the neutral grey pair, whatever the kind.
    for (const kind of ['limit', 'speed', 'cache'] as PillKind[]) expect(pillTint(kind, 'muted', settingsOf())).toEqual(n)
  })
})

describe('pill texts', () => {
  const T = (item: PillItem, o: Partial<PillData> = {}): PillText | null => pillText(item, { usage: fullUsage(), main: fullMain(), now: NOW, ...o })
  const lim = (used: number, resetIn: number | null = 3 * HOUR + 5 * MIN): Gauge => limit('five_hour', used, resetIn)

  test('context: label, percent used, tokens, the tone of what is left (warn at 30 left, alert at 10)', async () => {
    expect(T('context')).toEqual({ label: 'Context', value: '52%', detail: '517k / 1M', tone: 'calm' })
    const at = (used: number): PillText | null => T('context', { usage: { ...fullUsage(), contextPercent: used } })
    expect(at(69.9)?.tone).toBe('calm')
    expect(at(70)?.tone).toBe('warn')
    expect(at(89.9)?.tone).toBe('warn')
    expect(at(90)?.tone).toBe('alert')
    expect(at(100)).toEqual({ label: 'Context', value: '100%', detail: '517k / 1M', tone: 'alert' })
    expect(T('context', { usage: { ...blankUsage(NOW), contextPercent: 10 } })?.detail).toBe('')
    expect(T('context', { usage: undefined })).toBeNull()
  })

  test('limit: percent left and when it resets; the tone flips exactly at 30 and 10 left', async () => {
    expect(T('limit', { gauge: lim(60) })).toEqual({ label: '5h', value: '40% left', detail: 'resets in 3h 05m', tone: 'calm' })
    expect(T('limit', { gauge: lim(60), isNarrow: true })?.detail).toBe('3h 05m')
    expect(T('limit', { gauge: lim(69) })?.tone).toBe('calm')
    expect(T('limit', { gauge: lim(70) })?.tone).toBe('warn')
    expect(T('limit', { gauge: lim(89) })?.tone).toBe('warn')
    expect(T('limit', { gauge: lim(90) })?.tone).toBe('alert')
    expect(T('limit', { gauge: lim(60, null) })?.detail).toBe('')
    expect(T('limit', { gauge: limit('seven_day_fable', 81, 88 * HOUR) })).toEqual({ label: 'Week · Fable', value: '19% left', detail: 'resets in 3d 16h', tone: 'warn' })
    expect(T('limit')).toBeNull()
  })

  test('limit: used up reads limit reached, red, with when it resets', async () => {
    for (const used of [100, 99.6, 150]) expect(T('limit', { gauge: lim(used) })).toEqual({ label: '5h', value: 'limit reached', detail: 'resets in 3h 05m', tone: 'alert' })
    expect(T('limit', { gauge: lim(99) })?.value).toBe('1% left')
  })

  test('limit: a window whose reset time passed with no fresh figure reads resetting…, muted, for ten minutes', async () => {
    const after = (ago: number): Gauge | null => gaugeOf({ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(NOW - ago).toISOString() }, NOW)
    expect(T('limit', { gauge: after(0) as Gauge })).toEqual({ label: '5h', value: 'resetting…', detail: '', tone: 'muted' })
    expect(T('limit', { gauge: after(10 * MIN) as Gauge })?.value).toBe('resetting…')
    expect(after(10 * MIN + 1)).toBeNull()
    expect(meterDrawing(after(MIN) as Gauge, settingsOf(), 'ring').source.includes('stroke-dasharray')).toBe(false)
  })

  test('speed: tok/s, and — tok/s until a reading exists', async () => {
    expect(T('speed')).toEqual({ label: '', value: '91 tok/s', detail: '', tone: 'calm' })
    expect(T('speed', { usage: { ...fullUsage(), speed: 84.4 } })?.value).toBe('84 tok/s')
    for (const speed of [null, NaN, undefined]) expect(T('speed', { usage: { ...fullUsage(), speed } as unknown as Usage })).toEqual({ label: '', value: '— tok/s', detail: '', tone: 'muted' })
    expect(T('speed', { usage: undefined })?.value).toBe('— tok/s')
  })

  test('cache: — before the first response, … while anything works, mm:ss counting down, expired at zero', async () => {
    const left = (ms: number | null, isWorking = false): PillText | null => T('cache', { usage: { ...fullUsage(), cacheExpiresAt: ms === null ? null : NOW + ms }, isWorking })
    expect(left(null)).toEqual({ label: '', value: '—', detail: '', tone: 'muted' })
    expect(left(null, true)?.value).toBe('—')
    expect(left(52 * MIN, true)).toEqual({ label: '', value: '…', detail: '', tone: 'calm' })
    expect(left(-MIN, true)?.value).toBe('…')
    expect(left(52 * MIN + 10_000)).toEqual({ label: '', value: '52:10', detail: '', tone: 'calm' })
    expect(left(18 * MIN + 1000)?.tone).toBe('calm')
    expect(left(18 * MIN)).toEqual({ label: '', value: '18:00', detail: '', tone: 'warn' })
    expect(left(6 * MIN + 1000)?.tone).toBe('warn')
    expect(left(6 * MIN)).toEqual({ label: '', value: '06:00', detail: '', tone: 'alert' })
    expect(left(9_000)?.value).toBe('00:09')
    expect(left(1)?.value).toBe('00:01')
    for (const ms of [0, -1, -3 * HOUR]) expect(left(ms)).toEqual({ label: '', value: 'expired', detail: '', tone: 'alert' })
  })

  test('turn: hidden until the first turn; time: always', async () => {
    expect(T('turn')).toEqual({ label: '', value: '#12', detail: '', tone: 'calm' })
    expect(T('turn', { main: blankMain(NOW) })).toBeNull()
    expect(T('turn', { main: undefined })).toBeNull()
    expect(T('time')).toEqual({ label: '', value: '1:00:00', detail: '', tone: 'calm' })
    expect(T('time', { usage: blankUsage(NOW) })?.value).toBe('0:00')
    expect(T('time', { usage: undefined })?.value).toBe('0:00')
  })

  test('junk in, never throwing, never a bad value', async () => {
    const items: PillItem[] = ['context', 'limit', 'speed', 'cache', 'turn', 'time']
    const junkUsage = { ...fullUsage(), contextTokens: NaN, contextWindow: NaN, contextPercent: NaN, speed: Infinity, cacheExpiresAt: NaN, sessionStartedAt: NaN } as Usage
    const junkGauge = { kind: 'five_hour', label: '', used: NaN, left: NaN, resetIn: NaN, tone: 'x' } as unknown as Gauge
    for (const item of items)
      for (const d of [{}, { usage: junkUsage, gauge: junkGauge }, { usage: undefined, main: undefined }, { now: NaN }]) {
        const r = T(item, d)
        if (!r) continue
        for (const v of [r.label, r.value, r.detail]) expect(/NaN|undefined|null|Infinity|[\p{Cc}\p{Cf}]/u.test(v) ? `${item}: bad "${v}"` : 'ok').toBe('ok')
        expect(['calm', 'warn', 'alert', 'muted']).toContain(r.tone)
      }
    expect(pillText('bogus' as never, { now: NOW })).toBeNull()
    expect(pillText('limit', null as never)).toBeNull()
  })
})


describe('hover cards', () => {
  const data = (o: Partial<Parameters<typeof tipLines>[1]> = {}): Parameters<typeof tipLines>[1] => ({ usage: fullUsage(), main: fullMain(), settings: settingsOf({ currency: 'GBP' }), rates, now: NOW, ...o })
  const short = (r: { title: string; lines: string[] }, what: string): void => {
    expect(r.title.length > 0 && r.title.length < 64 ? 'ok' : `${what}: title "${r.title}"`).toBe('ok')
    for (const l of r.lines) expect(l.length < 64 ? 'ok' : `${what}: "${l}" is ${l.length} long`).toBe('ok')
    for (const s of [r.title, ...r.lines]) expect(/NaN|undefined|null|Infinity|[\p{Cc}\p{Cf}]/u.test(s) ? `${what}: bad "${s}"` : 'ok').toBe('ok')
  }

  test('a limit: what is left, the reset day, time and time left, and the pace', async () => {
    // 60% of the five hours used with 3h 05m to go: 38% of the window gone, 22 points ahead of it.
    const five = tipLines('limit', data({ gauge: limit('five_hour', 60, 3 * HOUR + 5 * MIN) }))
    expect(five).toEqual({ title: '5-hour limit', lines: ['40% left · 60% used', 'Resets Fri 15:05 (in 3h 05m)', 'Pace: 22 points more used than time gone'] })
    // A weekly window with 88h to go: 47.6% gone; 37% used is 11 points under.
    const week = tipLines('limit', data({ gauge: limit('seven_day', 37, 88 * HOUR), tzOffsetMin: 60 }))
    expect(week).toEqual({ title: 'Weekly limit', lines: ['63% left · 37% used', 'Resets Tue 05:00 (in 3d 16h)', 'Pace: 11 points less used than time gone'] })
    // Any seven_day_* kind is a weekly window, titled by its model.
    const fable = tipLines('limit', data({ gauge: limit('seven_day_fable', 81, 88 * HOUR) }))
    expect(fable.title).toBe('Weekly limit · Fable')
    expect(fable.lines[2]).toBe('Pace: 33 points more used than time gone')
    // No reset time: no pace line.
    expect(tipLines('limit', data({ gauge: limit('seven_day', 50, null) })).lines).toEqual(['50% left · 50% used', 'Reset time not known'])
    // A kind with no known window: no pace.
    expect(tipLines('limit', data({ gauge: limit('spend_limit', 10, HOUR) })).lines).toHaveLength(2)
    expect(tipLines('limit', data()).lines).toEqual(['No figures yet'])
    // Even pace.
    expect(tipLines('limit', data({ gauge: limit('five_hour', 50, 2.5 * HOUR) })).lines[2]).toBe('Pace: even with the time gone')
  })

  test('context: tokens used of the window and what is left', async () => {
    expect(tipLines('context', data())).toEqual({ title: 'Context', lines: ['517k of 1M tokens used', '48% of the window left'] })
    expect(tipLines('context', data({ usage: { ...blankUsage(NOW), contextPercent: 30 }, main: { ...blankMain(NOW), contextTokens: NaN } }))).toEqual({ title: 'Context', lines: ['30% of the window used', '70% of the window left'] })
  })

  test('cache: when it expires, and what a cold cache costs against a warm one', async () => {
    const r = tipLines('cache', data())
    expect(r.title).toBe('Prompt cache')
    expect(r.lines[0]).toBe('Expires at 12:52 (in 52m)')
    // 517k tokens on Fable 5.2: written $16 per million, read $0.20 per million (audit finding 2); in pounds at the built-in rate.
    expect(r.lines[1]).toBe(`Cold: writing 517k tokens again costs £${(0.517 * 16 * (FALLBACK_RATES.GBP ?? 0)).toFixed(2)}`)
    expect(r.lines[2]).toBe(`Warm: reading them costs £${(0.517 * 0.2 * (FALLBACK_RATES.GBP ?? 0)).toFixed(2)}`)
    expect(tipLines('cache', data({ usage: { ...fullUsage(), cacheExpiresAt: NOW - 3 * MIN } })).lines[0]).toBe('Expired 3m ago')
    expect(tipLines('cache', data({ usage: { ...blankUsage(NOW) }, main: blankMain(NOW) })).lines).toEqual(['No cache yet: the next reply writes it', 'A cold cache writes the whole prompt again, at a higher price'])
  })

  test('speed, turn and clock: one line each', async () => {
    expect(tipLines('speed', data())).toEqual({ title: 'Speed', lines: ['91 output tokens a second in the last reply'] })
    expect(tipLines('speed', data({ usage: blankUsage(NOW) })).lines).toEqual(['No reply timed yet'])
    expect(tipLines('turn', data())).toEqual({ title: 'Turn', lines: ['Turn 12 of this session'] })
    expect(tipLines('turn', data({ main: blankMain(NOW) })).lines).toEqual(['No turn yet in this session'])
    expect(tipLines('clock', data())).toEqual({ title: 'Session time', lines: ['1:00:00 since it started at 11:00'] })
  })

  test('every target, any data: a short title and at most four short lines, never throwing', async () => {
    const targets: TipTarget[] = ['context', 'limit', 'cache', 'speed', 'turn', 'clock']
    const junkUsage = { ...fullUsage(), contextTokens: NaN, contextWindow: NaN, speed: Infinity, cacheExpiresAt: NaN, sessionStartedAt: NaN } as Usage
    const junkGauge = { kind: 'five_hour', label: '', used: NaN, left: NaN, resetIn: NaN, tone: 'x' } as unknown as Gauge
    for (const target of targets)
      for (const d of [data(), data({ usage: junkUsage, gauge: junkGauge }), data({ usage: undefined, main: undefined }), data({ gauge: limit('seven_day_x', 99, 1000) }), data({ now: NaN, tzOffsetMin: NaN })]) {
        const r = tipLines(target, d)
        short(r, target)
        expect(r.lines.length).toBeLessThanOrEqual(4)
        expect(r.lines.length).toBeGreaterThanOrEqual(1)
      }
    expect(tipLines('bogus' as never, data()).lines).toEqual([])
    expect(tipLines('limit', null as never).lines).toEqual(['No figures yet'])
  })
})

describe('entrance animation', () => {
  test('the helper: nothing when off, unset or over; else the class and a negative delay', async () => {
    expect(entrance('in', undefined, settingsOf())).toEqual({ className: '', style: '' })
    expect(entrance('in', 100, settingsOf({ animations: false }))).toEqual({ className: '', style: '' })
    expect(entrance('in', ENTER_MS.in, settingsOf())).toEqual({ className: '', style: '' })
    expect(entrance('grow', 599, settingsOf())).toEqual({ className: 'pc-grow', style: 'animation-delay:-599ms' })
    expect(entrance('in', 0, settingsOf())).toEqual({ className: 'pc-in', style: 'animation-delay:-0ms' })
    expect(entrance('sweep', NaN, settingsOf())).toEqual({ className: '', style: '' })
    expect([ENTER_MS.in, ENTER_MS.drop, ENTER_MS.grow, ENTER_MS.sweep]).toEqual([350, 350, 600, 600])
  })

  const drawings = (age: number | undefined, animations: boolean): [string, Drawing][] => {
    const c = ctxOf(480, { animations }, age)
    const t = totals(fullMain(), [], fullUsage(), NOW)
    const data: CardData = { main: fullMain(), agents: [run()], usage: fullUsage(), totals: t }
    return [
      ['title', titleDrawing(c, 'Flow')],
      ['card', sessionCardDrawing(c, data)],
      ['ring card', sessionCardDrawing({ ...c, settings: { ...c.settings, panelUsage: 'ring' } }, data)],
      ['main', mainDrawing(c, fullMain(), 1, fullUsage())],
      ['agent', agentDrawing(c, run())],
      ['planned', plannedDrawing(c, planned)],
      ['compact card', compactCardDrawing(c, t, fullUsage())],
      ['compact main', compactMainDrawing(c, fullMain(), flow, 1)],
      ['compact agent', compactAgentDrawing(c, run())],
      ['compact foot', compactFootDrawing(c, 1, 1, 0)],
      ['log', logDrawing(c, LOG, '#BB811B')],
      ['section', sectionDrawing(c, 'Working', 1)],
      ['progress', progressDrawing(flow, 480, c.settings, 'running', 2, 2, age)],
      ['paused progress', progressDrawing(flow, 480, c.settings, 'paused', 0, 0, age)],
      ['idle progress', progressDrawing(null, 480, c.settings, 'none', 0, 0, age)],
      ['no-task title', titleDrawing(c, '')],
      ['collapsed', collapsedDrawing({ W: 480, now: NOW, flow, state: 'running', usage: fullUsage(), main: fullMain(), settings: c.settings, agentsRunning: 1, enterAgeMs: age })],
    ]
  }

  test('a fresh entrance carries a negative delay; past its duration it has no class at all', async () => {
    for (const animations of [true, false]) {
      for (const [what, d] of drawings(100, animations)) {
        const src = d.source
        const on = /pc-(in|drop|sweep|grow)/.test(src)
        expect(on === animations ? 'ok' : `${what}: animations ${animations}`).toBe('ok')
        if (animations) {
          expect(src.includes('style="animation-delay:-100ms"') || src.includes(';animation-delay:-100ms"') ? 'ok' : `${what}: no delay`).toBe('ok')
          expect(src.includes('ease-out both')).toBe(true)
          expect(src.includes('prefers-reduced-motion: reduce){.pc-in,.pc-drop,.pc-sweep,.pc-grow{animation:none}}')).toBe(true)
        }
      }
      // No class, and not even the rules: the drawing is as if it never entered.
      for (const [what, d] of [...drawings(700, animations), ...drawings(undefined, animations)]) expect(/pc-(in|drop|sweep|grow)/.test(d.source) ? `${what}: entrance after it ended` : 'ok').toBe('ok')
    }
  })

  test('between 350 and 600ms only the bars and arcs still move, continued from where they are', async () => {
    const data: CardData = { main: fullMain(), agents: [run()], usage: fullUsage(), totals: totals(fullMain(), [run()], fullUsage(), NOW) }
    const meter = sessionCardDrawing(ctxOf(480, {}, 400), data).source
    expect(meter.includes('class="pc-in"')).toBe(false)
    expect(meter.includes('class="pc-grow" style="animation-delay:-400ms"')).toBe(true)
    const rings = sessionCardDrawing(ctxOf(480, { panelUsage: 'ring' }, 400), data).source
    expect(/class="pc-sweep" style="--pc-d:[\d.]+;animation-delay:-400ms"/.test(rings)).toBe(true)
    expect(agentDrawing(ctxOf(480, {}, 400), run()).source.includes('pc-grow')).toBe(true)
  })

  test('rows rise in; the progress row drops in', async () => {
    expect(sectionDrawing(ctxOf(480, {}, 10), 'Usage').source.includes('<g class="pc-in" style="animation-delay:-10ms">')).toBe(true)
    expect(progressDrawing(flow, 480, settingsOf(), 'running', 1, 1, 10).source.includes('<g class="pc-drop" style="animation-delay:-10ms">')).toBe(true)
    expect(collapsedDrawing({ W: 480, now: NOW, flow, state: 'running', usage: fullUsage(), main: fullMain(), settings: settingsOf(), agentsRunning: 1, enterAgeMs: 10 }).source.includes('<g class="pc-in"')).toBe(true)
  })
})

describe('no periodic smile', () => {
  test('no drawing asks the sprites for a smile, at any second', async () => {
    const t = Math.floor(NOW / 7000) * 7000 + 6000
    for (const now of [t, t + 1000]) {
      const c = { ...ctxOf(480, { theme: 'cat' }), now }
      const srcs = [
        mainDrawing(c, { ...fullMain(), turnStartedAt: now - 1000 }, 0, fullUsage()).source,
        agentDrawing(c, run()).source,
        compactMainDrawing(c, fullMain(), flow, 1).source,
        compactAgentDrawing(c, run()).source,
        progressDrawing(flow, 480, c.settings, 'running', 1, 1).source,
      ]
      for (const src of srcs) expect(src.includes('ct-smiling')).toBe(false)
    }
  })
})

describe('section headings and backdrops', () => {
  test('sentence case: the label in 12px semibold, its count muted, a hairline from 10px after it to the edge, 32px', async () => {
    const d = sectionDrawing(ctxOf(320), 'Working', 3)
    const [label, count] = texts(d.source)
    expect([label?.s, label?.x, label?.y, label?.size]).toEqual(['Working', 0, 22, 12])
    expect(d.source).toContain('class="s" font-size="12" font-weight="600">Working<')
    expect([count?.s, count?.x]).toEqual(['3', Math.round((textWidth('Working', 12) + 6) * 100) / 100])
    expect(d.source).toContain('class="m" font-size="12" font-variant-numeric="tabular-nums">3<')
    const end = Math.round((textWidth('Working', 12) + 6 + textWidth('3', 12) + 10) * 100) / 100
    expect(d.source).toContain(`<line class="ln" x1="${end}" y1="18" x2="320" y2="18"/>`)
    expect(d.height).toBe(32)
    expect(d.alt).toBe('Working 3')
    expect(d.source.includes('WORKING')).toBe(false)
    // No count: the hairline follows the label.
    const main = sectionDrawing(ctxOf(320), 'Main agent')
    expect(texts(main.source).map(t => t.s)).toEqual(['Main agent'])
    expect(main.height).toBe(32)
    // A label too long for the pane is cut; nothing crosses its edge.
    for (const W of [40, 80, 120]) inside(sectionDrawing(ctxOf(W), LONG, 12), `section ${W}`)
  })

  test('dots and grid, faint in both schemes, tiles of at most 4096px', async () => {
    const dots = backdropDrawing('dots', 320, 300)
    const grid = backdropDrawing('grid', 320, 300)
    check(dots, 'dots')
    check(grid, 'grid')
    expect(dots.source.includes('<circle class="d"')).toBe(true)
    expect(grid.source.includes('<path class="g" d="M16 .5H.5V16"')).toBe(true)
    expect(grid.source.includes('stroke-opacity:.055') && grid.source.includes('prefers-color-scheme: dark')).toBe(true)
    expect(backdropDrawing('grid', 320, 9000).height).toBe(4096)
    expect(backdropDrawing('dots', 656, 300).width).toBe(656)
  })
})

describe('icons', () => {
  test('every icon draws at its size, distinct, and active shades it', async () => {
    const names: IconName[] = ['collapse', 'expand', 'panel', 'panelOpen', 'log', 'logOpen', 'copy', 'compact', 'full', 'fold', 'unfold', 'gear', 'help']
    const sources = new Set<string>()
    for (const name of names) {
      const d = iconDrawing(name)
      check(d, `icon ${name}`)
      expect([d.width, d.height]).toEqual([22, 22])
      sources.add(d.source)
      expect(iconDrawing(name, 30).width).toBe(30)
      const on = iconDrawing(name, 22, true)
      check(on, `icon ${name} active`)
      expect(on.source.includes('class="ica"')).toBe(true)
      expect(d.source.includes('class="ica"')).toBe(false)
    }
    expect(sources.size).toBe(names.length)
  })

  test('no outline in any state: the glyph alone, and the active one keeps its soft fill as its only cue', async () => {
    const names: IconName[] = ['collapse', 'expand', 'panel', 'panelOpen', 'log', 'logOpen', 'copy', 'compact', 'full', 'fold', 'unfold', 'gear', 'help']
    const squares = (src: string): string[] => [...src.matchAll(/<rect ([^>]*)\/>/g)].map(m => m[1] ?? '').filter(a => /width="20"/.test(a) && /height="20"/.test(a))
    for (const name of names) {
      for (const size of [22, 30]) {
        // Idle: no square at all.
        expect(squares(iconDrawing(name, size).source)).toEqual([])
        // Active: one square, the fill, never stroked.
        const on = squares(iconDrawing(name, size, true).source)
        expect(on).toHaveLength(1)
        expect(on[0]).toContain('class="ica"')
        expect(on[0]).toContain('stroke="none"')
      }
    }
  })

  test('gear and help: the settings and guide controls, named for what they open', async () => {
    expect(iconDrawing('gear').alt).toBe('Crew settings')
    expect(iconDrawing('help').alt).toBe('Crew guide')
    expect(iconDrawing('gear', 22, true).alt).toBe('Crew settings (on)')
    expect(iconDrawing('help', 22, true).alt).toBe('Crew guide (on)')
    // The same muted ink as every other control, in light and dark.
    for (const name of ['gear', 'help'] as const) expect(iconDrawing(name).source.includes('class="ic"')).toBe(true)
  })
})

describe('work kinds in the rows', () => {
  test('an agent row: the kind label and the costume in the agent colour; a running bar follows barColors', async () => {
    const second = run({ kind: 'search', tint: 1, type: 'web-fetch', description: 'Fetch the docs' })
    const own = shiftColor('#2E9BB8', 1)
    const d = agentDrawing(ctxOf(480), second)
    expect(d.alt).toContain('Search agent, running: Fetch the docs')
    expect(d.source).toContain(`fill="${own}"`)
    expect(d.source).not.toContain('#888780')
    // With the palette's accent, the label and the costume keep the agent colour.
    const pal = agentDrawing(ctxOf(480, { barColors: 'palette' }), second).source
    expect(pal).toContain(PALETTES.classic.accent)
    expect(pal).toContain(`fill="${own}"`)
    // A run 1.6 left (a role, no kind) draws by its role's kind.
    const old = { ...run({ description: 'Old one' }), kind: undefined, tint: undefined, role: 'tester' } as unknown as AgentRun
    expect(agentDrawing(ctxOf(480), old).alt).toContain('Test agent')
  })

  test('a planned row: the kind label, then the planned model and effort', async () => {
    const d = plannedDrawing(ctxOf(480), planned)
    expect(d.alt).toBe('Planned: 4. Write the README, for Write, after 2, 3')
    expect(d.source).toContain('Opus · medium')
    expect(d.source).toContain('#B56BC7')
    // No kind given: what its title says, else Helper in one of the six hues.
    expect(plannedDrawing(ctxOf(480), { title: 'Fix the bar', kind: '', model: '', effort: '', after: [], n: 1 }).alt).toContain('for Debug')
    const other = plannedDrawing(ctxOf(480), { title: 'Go on', kind: '', model: '', effort: 'low', after: [], n: 1 })
    expect(other.alt).toContain('for Helper')
    expect(other.source).toContain('low')
    expect(OTHER_HUES.some(c => other.source.includes(c))).toBe(true)
  })
})
