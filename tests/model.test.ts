import { describe, expect, test } from 'claude-code/testing'

import type { AgentRun, BarItem, Flow, Kind, Limit, LogEntry, MainRun, Rates, Run, Settings, TokenUse, Usage } from '../types'
import {
  AUTO_OPENS,
  BACKGROUNDS,
  BAR_COLORS,
  BAR_ITEMS,
  CHART_KINDS,
  CURRENCIES,
  DEFAULT_BAR_ORDER,
  DEFAULT_SETTINGS,
  DEFAULT_SIZES,
  FALLBACK_RATES,
  FLOW_ACCENT,
  FLOW_DONE,
  KINDS,
  KIND_KEYS,
  MAIN_LOOK,
  MIRROR_KEYS,
  MODEL_FAMILIES,
  RESETTING_MS,
  OPTION_CHOICES,
  OPTION_DEFAULTS,
  OPTION_KEYS,
  OTHER_HUES,
  PALETTES,
  PALETTE_NAMES,
  PANEL_USAGES,
  PLUGIN,
  SETTING_OPTION_KEYS,
  SIZE_KEYS,
  SIZE_RANGE,
  STEP,
  THEMES,
  activityOf,
  addUse,
  agentColor,
  agentKind,
  agentLabel,
  appLimits,
  barItemsOf,
  blankMain,
  blankUsage,
  blankView,
  changedOptions,
  closeLog,
  contextGauge,
  costOf,
  emptyUse,
  familyOf,
  fitText,
  flowLabel,
  flowSettled,
  flowRatio,
  fmtClock,
  fmtMoney,
  fmtSpan,
  fmtTime,
  fmtTokens,
  fmtUsd,
  freshLimits,
  gaugeOf,
  isModelWeek,
  kindColor,
  kindName,
  kindOf,
  limitGauges,
  mainWorkedMs,
  mergeFlow,
  mergeLimits,
  mirrorValues,
  modelLabel,
  modelName,
  money,
  moveBarItem,
  normalizeAgent,
  normalizeBarOrder,
  normalizeSettings,
  normalizeSizes,
  normalizeTasks,
  normalizeView,
  optionKey,
  optionValue,
  paletteOf,
  partialArgsOf,
  pillColor,
  plannedModel,
  plannedOf,
  printable,
  pushLog,
  rateFor,
  rateLine,
  setSetting,
  settingsFromOptions,
  shiftColor,
  shownBarItems,
  sizesOf,
  sortAgents,
  spriteColor,
  stepSetting,
  taskColor,
  taskKind,
  taskState,
  textWidth,
  thoughtOf,
  tintFor,
  toggleBarItem,
  toneOfLeft,
  totals,
  usageSplit,
  useTotal,
  windowOf,
  workColor,
  wrapText,
} from '../hooks/model'

// Money is summed in floating point: compare to a cent's billionth.
const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-9)

const NOW = Date.parse('2026-11-13T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

const run = (o: Partial<AgentRun>): AgentRun => ({
  id: 'r',
  type: 'pixel-crew:engineer',
  kind: 'refactor',
  tint: 0,
  description: 'Work',
  model: 'claude-opus-5-5',
  status: 'running',
  startedAt: 0,
  contextTokens: 0,
  contextMax: 1_000_000,
  use: emptyUse(),
  costUsd: 0,
  steps: 0,
  round: 1,
  doing: '',
  doingSince: 0,
  log: [],
  ...o,
})

const entry = (at: number, outcome: LogEntry['outcome'] = 'open', text = `e${at}`): LogEntry => ({ at, kind: 'tool', text, outcome })

// Characters the engine refuses inside a drawn Text.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

describe('costOf', () => {
  // 1M input, 1M output, 2M cache read, 1M cache write: input + output + 2 x read + write.
  const TURN = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 2e6, cache_creation_input_tokens: 1e6 }
  const PRICED: [string, number][] = [
    ['claude-fable-5-1', 80.5],
    ['claude-mythos-5-1', 80.5],
    ['claude-fable-5', 82],
    ['claude-opus-5-5', 32.4],
    ['claude-opus-5', 41],
    ['claude-opus-4-8', 41],
    ['claude-sonnet-5-5', 16.2],
    ['claude-sonnet-5', 16.4],
    ['claude-sonnet-4-6', 24.6],
    ['claude-haiku-5-5', 0.82],
    ['claude-haiku-4-5', 8.2],
    ['some-other-model', 32.4],
  ]
  for (const [model, usd] of PRICED) {
    test(`a turn on ${model} costs $${usd}`, async () => {
      near(costOf(model, TURN, false), usd)
      near(costOf(model.toUpperCase(), TURN, false), usd)
    })
  }

  test('Haiku 5.5 pays long-prompt prices per request over 100K of prompt', async () => {
    const LONG = { input_tokens: 20_000, output_tokens: 10_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 50_000 }
    near(costOf('claude-haiku-5-5', LONG, true), 0.0875)
    // A turn's sum is not one prompt: ordinary prices.
    near(costOf('claude-haiku-5-5', LONG, false), 0.0175)
    // Exactly 100K is not over the line.
    near(costOf('claude-haiku-5-5', { input_tokens: 100_000 }, true), 0.01)
    // Other models ignore the prompt length.
    near(costOf('claude-haiku-4-5', LONG, true), costOf('claude-haiku-4-5', LONG, false))
  })

  test('missing or NaN fields count as zero', async () => {
    expect(costOf('claude-opus-5-5', {}, true)).toBe(0)
    near(costOf('claude-opus-5-5', { input_tokens: NaN, output_tokens: 1e6 }, true), 20)
  })
})

describe('models and tokens', () => {
  test('modelName and modelLabel read model ids', async () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-fable-5-2[1m]')).toBe('Fable 5.2')
    expect(modelName('claude-sonnet-4-6-20260101')).toBe('Sonnet 4.6')
    expect(modelName('claude-haiku-5')).toBe('Haiku 5')
    expect(modelName('gpt-4[x]')).toBe('gpt-4')
    expect(modelName('')).toBe('—')
    expect(modelLabel('claude-opus-5-5', 'low')).toBe('Opus 5.5 · low')
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  })

  test('windowOf: 200K for Haiku 4 and Claude 3, else 1M', async () => {
    expect(windowOf('claude-haiku-4-5')).toBe(200_000)
    expect(windowOf('claude-3-opus')).toBe(200_000)
    expect(windowOf('claude-haiku-5-5')).toBe(1_000_000)
    expect(windowOf('')).toBe(1_000_000)
  })

  test('addUse sums by kind and ignores junk', async () => {
    const u = addUse(addUse(emptyUse(), { input_tokens: 5, output_tokens: 2 }), {
      input_tokens: 1,
      output_tokens: NaN,
      cache_read_input_tokens: -3,
      cache_creation_input_tokens: 7,
    })
    expect(u).toEqual({ input: 6, output: 2, cacheRead: 0, cacheWrite: 7 })
    expect(useTotal(u)).toBe(15)
    expect(addUse(emptyUse(), null as never)).toEqual(emptyUse())
  })
})

describe('kinds', () => {
  const GREY = /^#(888780|7f7f7f|808080|888888)$/i
  // `#RRGGBB` as hue (degrees) and lightness (percent), to check a shift.
  const hsl = (hex: string): { h: number; l: number } => {
    const v = parseInt(hex.slice(1), 16)
    const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => c / 255) as [number, number, number]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
    return { h: (h + 360) % 360, l: ((max + min) / 2) * 100 }
  }
  const hueGap = (a: number, b: number): number => ((b - a + 540) % 360) - 180

  test('the kind table: thirteen kinds, each with its label, costume and base colour, none grey', async () => {
    expect(KIND_KEYS).toEqual(['search', 'analyze', 'build', 'refactor', 'quick', 'debug', 'test', 'review', 'design', 'write', 'plan', 'hard', 'other'])
    const want: Record<string, [string, string, string]> = {
      search: ['Search', 'scout', '#2E9BB8'],
      analyze: ['Analyze', 'analyst', '#B6AC20'],
      build: ['Build', 'chef', '#367FDD'],
      refactor: ['Refactor', 'engineer', '#BB811B'],
      quick: ['Quick', 'sprinter', '#23A97F'],
      debug: ['Debug', 'detective', '#D86931'],
      test: ['Test', 'tester', '#5BA23B'],
      review: ['Review', 'reviewer', '#C0453F'],
      design: ['Design', 'designer', '#D4537E'],
      write: ['Write', 'writer', '#B56BC7'],
      plan: ['Plan', 'planner', '#727BCA'],
      hard: ['Hard', 'ace', '#9774DC'],
    }
    for (const [k, [label, sprite, color]] of Object.entries(want)) expect(KINDS[k as Kind], k).toEqual({ label, sprite, color })
    expect(KINDS.other.label).toBe('Helper')
    expect(KINDS.other.sprite).toBe('helper')
    expect(OTHER_HUES).toHaveLength(6)
    expect(new Set(OTHER_HUES).size).toBe(6)
    for (const c of [...OTHER_HUES, ...KIND_KEYS.map(k => KINDS[k].color)]) expect(GREY.test(c), c).toBe(false)
    expect(MAIN_LOOK).toEqual({ label: 'Claude', sprite: 'main', color: '#D97757' })
    expect(spriteColor('main')).toBe('#D97757')
    expect(spriteColor('chef')).toBe('#367FDD')
    expect(spriteColor('helper')).toBe(KINDS.other.color)
    expect(spriteColor('nope')).toBe(KINDS.other.color)
  })

  // A subagent with a description that says nothing is read by its type alone.
  const TYPES: [string, Kind][] = [
    ['Explore', 'search'],
    ['web-fetch', 'search'],
    ['claude-code-guide', 'search'],
    ['my-plugin:scout', 'search'],
    ['deep-research', 'search'],
    ['code-explorer', 'search'],
    ['web-search', 'search'],
    ['Plan', 'plan'],
    ['solution-architect', 'plan'],
    ['code-reviewer', 'review'],
    ['unit-tester', 'test'],
    ['debugger', 'debug'],
    ['detective', 'debug'],
    ['ui-designer', 'design'],
    ['tech-writer', 'write'],
    ['docs-bot', 'write'],
    ['data-analyst', 'analyze'],
    ['pixel-crew:ace', 'hard'],
    ['pixel-crew:detective', 'debug'],
    ['pixel-crew:engineer', 'refactor'],
    ['pixel-crew:Engineer', 'refactor'],
    ['pixel-crew:chef', 'build'],
    ['pixel-crew:sprinter', 'quick'],
    ['pixel-crew:scout', 'search'],
    ['pixel-crew:designer', 'design'],
    ['pixel-crew:writer', 'write'],
    ['pixel-crew:tester', 'test'],
    ['pixel-crew:reviewer', 'review'],
    ['pixel-crew:analyst', 'analyze'],
    // Nothing in the type: `other`.
    ['general-purpose', 'other'],
    ['statusline-setup', 'other'],
    ['session-router:worker', 'other'],
    ['other-plugin:ace', 'other'],
    ['', 'other'],
  ]
  for (const [type, kind] of TYPES) {
    test(`kindOf(${JSON.stringify(type)}) with a plain description is ${kind}`, async () => {
      expect(kindOf(type, 'Go on', [])).toBe(kind)
    })
  }

  test('kindOf: keywords in the description, in their order, as words or with an ending', async () => {
    const WORDS: [string, Kind][] = [
      ['Review the diff', 'review'],
      ['Audit the logs and fix the bug', 'review'],
      ['Write tests for the parser', 'test'],
      ['Testing the build', 'test'],
      ['TDD the parser', 'test'],
      ['Fix the failing build', 'debug'],
      ['Investigate the crash', 'debug'],
      ['Find the root cause', 'debug'],
      ['Debugging the bar', 'debug'],
      ['Research prior art', 'search'],
      ['Look up the API', 'search'],
      ['Fetch the docs page', 'search'],
      ['Mapping the code', 'search'],
      ['Read the config', 'search'],
      ['Mock up the panel', 'design'],
      ['Style the bar', 'design'],
      ['Update the README', 'write'],
      ['Write the changelog', 'write'],
      ['Analyse the numbers', 'analyze'],
      ['Benchmark the renderer', 'analyze'],
      ['Spec the format', 'plan'],
      ['Planning the release', 'plan'],
      ['Rename the module', 'refactor'],
      ['Clean up the store', 'refactor'],
      ['Implement the tool', 'build'],
      ['Add a pill', 'build'],
      ['Created the feature', 'build'],
      ['Install the package', 'quick'],
      ['Running the boilerplate', 'quick'],
      // Not words of the list: `readme` is no `read`, `address` no `add`, `login` no `log`.
      ['Address the login', 'other'],
      ['Go on', 'other'],
      ['', 'other'],
    ]
    for (const [description, kind] of WORDS) expect(kindOf('general-purpose', description, []), description).toBe(kind)
    // The type comes before the words.
    expect(kindOf('Explore', 'Fix the bug', [])).toBe('search')
    expect(kindOf('general-purpose', 'Fix the bug')).toBe('debug')
  })

  test('kindOf: a planned task with a kind wins, then a planned 1.6 agent, then the type and the words', async () => {
    const tasks = [
      { title: 'Write the model', kind: 'hard', agent: 'chef', model: '', effort: '', after: [] },
      { title: 'Draw it', kind: '', agent: 'detective', after: [] },
      { title: 'Ship it', kind: '', after: [] },
      { title: 'Check it', kind: 'Review' },
    ]
    expect(kindOf('Explore', 'write  the MODEL!', tasks)).toBe('hard')
    expect(kindOf('Explore', 'Draw it', tasks)).toBe('debug')
    // A planned task with no kind leaves it to the type, then the words.
    expect(kindOf('Explore', 'Ship it', tasks)).toBe('search')
    expect(kindOf('general-purpose', 'Ship it', tasks)).toBe('other')
    expect(kindOf('general-purpose', 'Check it', tasks)).toBe('review')
    // No planned task matches: the type.
    expect(kindOf('Plan', 'Something else', tasks)).toBe('plan')
    for (const junk of [null, 42, 'x', [null, 3, { title: 7 }]]) expect(kindOf('Plan', 'Write the model', junk as never)).toBe('plan')
  })

  test('kindName reads a kind, its label or a 1.6 role, any case; nothing else', async () => {
    expect(kindName('debug')).toBe('debug')
    expect(kindName(' BUILD ')).toBe('build')
    expect(kindName('Helper')).toBe('other')
    expect(kindName('other')).toBe('other')
    expect(kindName('engineer')).toBe('refactor')
    expect(kindName('pixel-crew:scout')).toBe('search')
    expect(kindName('ace')).toBe('hard')
    // The 1.6 planner costume is the plan kind (SPEC 2.9.8).
    expect(kindName('planner')).toBe('plan')
    expect(kindName('pixel-crew:Planner')).toBe('plan')
    for (const junk of ['', 'other-plugin:ace', 'bogus', 3, null, undefined]) expect(kindName(junk), String(junk)).toBeUndefined()
  })

  test('shiftColor: tint 0 is the base; tints 1 to 5 shift hue and lightness as specified; it wraps at 6', async () => {
    const base = '#367FDD'
    expect(shiftColor(base, 0)).toBe(base)
    expect(shiftColor(base, 6)).toBe(base)
    expect(shiftColor(base, 12)).toBe(base)
    const b = hsl(base)
    const want: [number, number][] = [[6, 10], [-6, -7], [3, 16], [-3, 5], [0, -4]]
    want.forEach(([dh, dl], i) => {
      const c = shiftColor(base, i + 1)
      expect(c).toMatch(/^#[0-9A-F]{6}$/)
      const x = hsl(c)
      expect(Math.abs(hueGap(b.h, x.h) - dh), `tint ${i + 1} hue`).toBeLessThan(1.5)
      expect(Math.abs(x.l - b.l - dl), `tint ${i + 1} lightness`).toBeLessThan(0.6)
      expect(shiftColor(base, i + 7)).toBe(c)
    })
    // Six different colours, all related to the base.
    expect(new Set([0, 1, 2, 3, 4, 5].map(t => shiftColor(base, t))).size).toBe(6)
    // Junk tints read as 0; a colour that is not six hex digits comes back as given.
    for (const junk of [-1, 1.5, NaN, Infinity, '2' as never]) expect(shiftColor(base, junk)).toBe(base)
    expect(shiftColor('#abc', 1)).toBe('#abc')
    expect(shiftColor('red', 2)).toBe('red')
    // A grey has no hue to turn: only its lightness moves.
    expect(hsl(shiftColor('#808080', 1)).l).toBeGreaterThan(hsl('#808080').l)
    // A shifted lightness is kept between 38% and 72%.
    for (let t = 1; t < 6; t += 1) {
      for (const c of ['#FFFFFF', '#000000', '#9774DC', '#23A97F', ...KIND_KEYS.map(k => KINDS[k].color)]) {
        const l = hsl(shiftColor(c, t)).l
        expect(l, `${c} tint ${t}`).toBeGreaterThan(37.6)
        expect(l, `${c} tint ${t}`).toBeLessThan(72.4)
      }
    }
    // Hard is light already: tints 1 and 3 both stop at 72%, a few degrees apart in hue.
    expect(Math.abs(hsl(shiftColor('#9774DC', 3)).l - 72)).toBeLessThan(0.4)
  })

  test("the six tints of each kind stay nearer their own kind's base colour than any other kind's, by hue", async () => {
    const kinds = KIND_KEYS.filter(k => k !== 'other')
    const strays: string[] = []
    for (const k of kinds) {
      const own = hsl(KINDS[k].color).h
      for (let t = 0; t < 6; t += 1) {
        const h = hsl(shiftColor(KINDS[k].color, t)).h
        for (const o of kinds) {
          if (o === k) continue
          const other = hsl(KINDS[o].color).h
          if (Math.abs(hueGap(h, other)) < Math.abs(hueGap(h, own))) strays.push(`${k} tint ${t} is nearer ${o}`)
        }
      }
    }
    expect(strays).toEqual([])
  })

  test('kindColor: a kind its base colour; other one of six fixed hues by its description, the same text the same hue', async () => {
    expect(kindColor('build', 'anything')).toBe('#367FDD')
    const seen = new Set<string>()
    for (let i = 0; i < 60; i += 1) {
      const c = kindColor('other', `Task number ${i}`)
      expect(OTHER_HUES).toContain(c)
      expect(kindColor('other', `Task number ${i}`)).toBe(c)
      seen.add(c)
    }
    expect(seen.size).toBe(6)
    expect(OTHER_HUES).toContain(kindColor('other', ''))
    expect(OTHER_HUES).toContain(kindColor('bogus' as never, 'x'))
  })

  test('agentColor: two agents of one kind side by side differ and are related; neither is grey', async () => {
    const a = run({ id: 'a', kind: 'search', tint: 0, type: 'web-fetch', description: 'Fetch a page' })
    const b = run({ id: 'b', kind: 'search', tint: 1, type: 'web-fetch', description: 'Fetch a page' })
    expect(agentColor(a)).toBe('#2E9BB8')
    expect(agentColor(b)).toBe(shiftColor('#2E9BB8', 1))
    expect(agentColor(a)).not.toBe(agentColor(b))
    expect(Math.abs(hueGap(hsl(agentColor(a)).h, hsl(agentColor(b)).h))).toBeLessThan(20)
    const helper = run({ kind: 'other', tint: 0, type: 'general-purpose', description: 'Go on' })
    expect(OTHER_HUES).toContain(agentColor(helper))
    for (const x of [a, b, helper]) expect(GREY.test(agentColor(x))).toBe(false)
    expect(agentLabel(a)).toBe('Search')
    expect(agentLabel(helper)).toBe('Helper')
    expect(agentKind(helper)).toBe('other')
  })

  test('tintFor: its place among the agents of its kind in its run, side-by-side starts included', async () => {
    const r = (id: string, kind: Kind, status: AgentRun['status'] = 'running', startedAt = 10): AgentRun => run({ id, kind, status, startedAt })
    const open: Run = { startedAt: 5, ids: ['a', 'b', 'c'], high: 0 }
    const list = [r('a', 'search', 'done'), r('b', 'build'), r('c', 'search'), r('old', 'search', 'done', 1)]
    // a and c are search agents of the run; old is not in it.
    expect(tintFor('search', list, open, 'new')).toBe(2)
    expect(tintFor('build', list, open, 'new')).toBe(1)
    expect(tintFor('debug', list, open, 'new')).toBe(0)
    // Its own row does not count.
    expect(tintFor('search', list, open, 'c')).toBe(1)
    // An agent started side by side that has not joined yet counts.
    expect(tintFor('search', [...list, r('d', 'search', 'running', 12)], open, 'new')).toBe(3)
    // With no run, or an ended one, the active agents outside it count: they start the next run.
    expect(tintFor('search', [r('x', 'search')], null, 'new')).toBe(1)
    const ended: Run = { ...open, endedAt: 20 }
    expect(tintFor('search', [...list, r('y', 'search', 'running', 30)], ended, 'new')).toBe(1)
    expect(tintFor('search', [], null, 'new')).toBe(0)
    // Rows 1.6 wrote count by their role's kind.
    const legacy = { ...r('z', 'search'), kind: undefined, role: 'scout' } as unknown as AgentRun
    expect(tintFor('search', [legacy], { startedAt: 0, ids: ['z'], high: 0 }, 'new')).toBe(1)
    expect(tintFor('search', null as never, null, 'new')).toBe(0)
  })

  test('normalizeAgent: a run 1.6 wrote gets its kind from its role and tint 0, and loses the role', async () => {
    const clean = run({ kind: 'build', tint: 2 })
    expect(normalizeAgent(clean)).toBe(clean)
    const old = (o: Record<string, unknown>): AgentRun => {
      const x: Record<string, unknown> = { ...run({}), ...o }
      delete x.kind
      delete x.tint
      return x as AgentRun
    }
    const eng = normalizeAgent(old({ role: 'engineer', type: 'pixel-crew:engineer' }))
    expect(eng.kind).toBe('refactor')
    expect(eng.tint).toBe(0)
    expect(Object.keys(eng)).not.toContain('role')
    expect(normalizeAgent(old({ role: 'scout', type: 'Explore' })).kind).toBe('search')
    expect(normalizeAgent(old({ role: 'planner', type: 'Plan' })).kind).toBe('plan')
    // A 1.6 helper (any other type) reads by its type and description: never grey.
    expect(normalizeAgent(old({ role: 'helper', type: 'web-fetch', description: 'Go on' })).kind).toBe('search')
    expect(normalizeAgent(old({ role: 'helper', type: 'general-purpose', description: 'Fix the bug' })).kind).toBe('debug')
    expect(normalizeAgent(old({ type: 'general-purpose', description: 'Go on' })).kind).toBe('other')
    expect(normalizeAgent({ ...clean, tint: -3 }).tint).toBe(0)
    expect(normalizeAgent({ ...clean, kind: 'bogus' as never, type: 'Plan' }).kind).toBe('plan')
  })

  test('taskKind and taskColor: the planned kind, a 1.6 agent, the title, else other', async () => {
    expect(taskKind({ title: 'Anything', kind: 'design' })).toBe('design')
    expect(taskKind({ title: 'Anything', kind: '', agent: 'tester' })).toBe('test')
    expect(taskKind({ title: 'Fix the bar', kind: '' })).toBe('debug')
    expect(taskKind({ title: 'Go on', kind: '' })).toBe('other')
    expect(taskKind({})).toBe('other')
    expect(taskColor({ title: 'Anything', kind: 'design' })).toBe('#D4537E')
    expect(OTHER_HUES).toContain(taskColor({ title: 'Go on', kind: '' }))
  })

  test('plannedModel: the planned model and effort as a row shows them', async () => {
    expect(plannedModel({ model: 'opus', effort: 'high' })).toBe('Opus · high')
    expect(plannedModel({ model: 'claude-sonnet-5-5', effort: '' })).toBe('Sonnet 5.5')
    expect(plannedModel({ model: '', effort: 'low' })).toBe('low')
    expect(plannedModel({ model: 'haiku' })).toBe('Haiku')
    expect(plannedModel({})).toBe('')
    expect(plannedModel({ model: 7, effort: null } as never)).toBe('')
  })
})

describe('usageSplit', () => {
  const use = (input: number, output = 0, cacheRead = 0, cacheWrite = 0): TokenUse => ({ input, output, cacheRead, cacheWrite })

  test('the main agent against the subagents together, and by model family across both', async () => {
    const main = { ...blankMain(0), model: 'claude-fable-5-1', use: use(100, 10, 1000, 50), costUsd: 1.5 }
    const agents = [
      run({ id: 'a', model: 'claude-opus-5-5', use: use(10, 5, 100, 5), costUsd: 0.25 }),
      run({ id: 'b', model: 'claude-haiku-5-5', use: use(1, 1, 1, 1), costUsd: 0.01 }),
      run({ id: 'c', model: 'claude-opus-4-8', use: use(20), costUsd: 0.5 }),
      run({ id: 'd', model: 'gpt-x', use: use(3), costUsd: 0 }),
    ]
    const split = usageSplit(main, agents)
    expect(split.main).toEqual({ tokens: 1160, costUsd: 1.5 })
    expect(split.agents.tokens).toBe(120 + 4 + 20 + 3)
    near(split.agents.costUsd, 0.76)
    expect(Object.keys(split.models)).toEqual(['Fable', 'Opus', 'Sonnet', 'Haiku', 'other'])
    expect(split.models.Fable).toEqual({ tokens: 1160, costUsd: 1.5 })
    expect(split.models.Opus.tokens).toBe(140)
    near(split.models.Opus.costUsd, 0.75)
    expect(split.models.Sonnet).toEqual({ tokens: 0, costUsd: 0 })
    expect(split.models.Haiku).toEqual({ tokens: 4, costUsd: 0.01 })
    expect(split.models.other).toEqual({ tokens: 3, costUsd: 0 })
    // Tokens as the SESSION tiles count them: the same total.
    expect(split.main.tokens + split.agents.tokens).toBe(totals(main, agents, blankUsage(0), 0).tokens)
  })

  test('total: nothing, junk and negatives count as zero', async () => {
    const zero = { tokens: 0, costUsd: 0 }
    const empty = usageSplit(blankMain(0), [])
    expect(empty).toEqual({ main: zero, agents: zero, retired: zero, models: { Fable: zero, Opus: zero, Sonnet: zero, Haiku: zero, other: zero } })
    expect(usageSplit(null as never, null as never)).toEqual(empty)
    const junk = usageSplit({ ...blankMain(0), use: { input: NaN, output: -5, cacheRead: 'x', cacheWrite: 2 } as never, costUsd: -1 }, [null as never, run({ costUsd: NaN, use: null as never })])
    expect(junk.main).toEqual({ tokens: 2, costUsd: 0 })
    expect(junk.agents).toEqual(zero)
  })

  test('familyOf names the family; Mythos is Fable; anything else is other', async () => {
    expect(MODEL_FAMILIES).toEqual(['Fable', 'Opus', 'Sonnet', 'Haiku', 'other'])
    expect(familyOf('claude-mythos-5')).toBe('Fable')
    expect(familyOf('claude-sonnet-5-5[1m]')).toBe('Sonnet')
    expect(familyOf('')).toBe('other')
    expect(familyOf(null as never)).toBe('other')
  })
})

describe('mergeFlow', () => {
  test('a first call starts a flow and cleans its tasks', async () => {
    const f = mergeFlow(null, {
      title: '  Build the panel  ',
      tasks: [
        { title: 'Model', kind: 'refactor', model: ' opus ', effort: 'high', after: [] },
        { title: '   ' },
        { title: 'Sprites', kind: 'Design', after: [1, 0, -1, 1.5] },
        { title: 'Scan', agent: 'pixel-crew:scout' },
        { title: 'Legacy', agent: 'engineer' },
        { title: 'Both', kind: 'test', agent: 'chef' },
        { title: 'Foreign', agent: 'other:ace' },
        { title: 'Unknown', kind: 'bogus', model: 'm'.repeat(60), effort: 'max\u0007' },
      ],
    })
    expect(f.title).toBe('Build the panel')
    expect(f.total).toBe(7)
    expect(f.done).toBe(0)
    expect(f.phase).toBe('plan')
    expect(f.tasks.map(t => [t.title, t.kind])).toEqual([
      ['Model', 'refactor'],
      ['Sprites', 'design'],
      ['Scan', 'search'],
      ['Legacy', 'refactor'],
      ['Both', 'test'],
      ['Foreign', ''],
      ['Unknown', ''],
    ])
    expect(f.tasks[0]).toEqual({ title: 'Model', kind: 'refactor', model: 'opus', effort: 'high', after: [] })
    expect(f.tasks[1]?.after).toEqual([1])
    expect(f.tasks[1]).toMatchObject({ model: '', effort: '' })
    expect(f.tasks[6]?.model).toHaveLength(40)
    expect(f.tasks[6]?.effort).toBe('max')
    for (const t of f.tasks) expect(Object.keys(t)).toEqual(['title', 'kind', 'model', 'effort', 'after'])
  })

  test('tasks 1.6 stored (an agent, no kind) read as 2.0 keeps them on the next report', async () => {
    const old = { title: 'Old', total: 2, done: 0, running: 0, phase: 'delegate', isFinished: false, tasks: [{ title: 'A', agent: 'tester', after: [] }, { title: 'B', agent: '', after: [1] }] } as unknown as Flow
    const f = mergeFlow(old, { done: 1 })
    expect(f.tasks).toEqual([
      { title: 'A', kind: 'test', model: '', effort: '', after: [] },
      { title: 'B', kind: '', model: '', effort: '', after: [1] },
    ])
    expect(normalizeTasks(old.tasks)).toEqual(f.tasks)
    expect(normalizeTasks(null)).toEqual([])
  })

  test('the research and ask phases are taken and named Research and Asking', async () => {
    const r = mergeFlow(null, { title: 'X', phase: 'research' })
    expect(r.phase).toBe('research')
    expect(flowLabel(r)).toBe('Research')
    const a = mergeFlow(r, { phase: 'ask' })
    expect(a.phase).toBe('ask')
    expect(flowLabel(a)).toBe('Asking')
    expect(mergeFlow(a, { phase: 'bogus' as never }).phase).toBe('ask')
    expect(flowLabel(mergeFlow(a, { finished: true }))).toBe('Done')
  })

  test('the same title keeps the flow; done clamps to 0..total', async () => {
    const a = mergeFlow(null, { title: 'X', total: 3, phase: 'delegate' })
    const b = mergeFlow({ ...a, running: 2 }, { done: 9 })
    expect(b.done).toBe(3)
    expect(b.running).toBe(2)
    expect(b.phase).toBe('delegate')
    expect(mergeFlow(b, { title: 'X', done: -4 }).done).toBe(0)
  })

  test('a new title resets the counters and the tasks', async () => {
    const a = mergeFlow(null, { title: 'A', total: 4, done: 2, tasks: [{ title: 't' }] })
    const b = mergeFlow({ ...a, running: 1 }, { title: 'B' })
    expect(b).toEqual({ title: 'B', total: 0, done: 0, running: 0, phase: 'plan', isFinished: false, tasks: [] })
  })

  test('finished closes the flow, and the next call starts a new one', async () => {
    const a = mergeFlow(null, { title: 'A', total: 2, done: 1, phase: 'review' })
    const done = mergeFlow(a, { finished: true })
    expect(done.isFinished).toBe(true)
    expect(done.phase).toBe('close')
    expect(flowLabel(done)).toBe('Done')
    expect(flowRatio(done)).toBe(1)
    const next = mergeFlow(done, { title: 'A' })
    expect(next.isFinished).toBe(false)
    expect(next.done).toBe(0)
    expect(next.total).toBe(0)
  })

  test('junk input gives a sane flow', async () => {
    const f = mergeFlow(null, null as never)
    expect(f.title).toBe('Plan')
    const g = mergeFlow(null, { title: 'x'.repeat(500), total: 'many', done: NaN, phase: 'bogus', tasks: 'nope' } as never)
    expect(g.title.length).toBe(120)
    expect(g.total).toBe(0)
    expect(g.done).toBe(0)
    expect(g.phase).toBe('plan')
    expect(g.tasks).toEqual([])
    expect(mergeFlow(null, { total: 5000 }).total).toBe(200)
    expect(mergeFlow(null, { tasks: [null, 3, { title: 7 }, { title: 'ok', after: 'x' }] } as never).tasks).toEqual([
      { title: 'ok', kind: '', model: '', effort: '', after: [] },
    ])
  })

  test('flowLabel and flowRatio by phase', async () => {
    const base: Flow = { title: 't', total: 6, done: 3, running: 2, phase: 'delegate', isFinished: false, tasks: [] }
    expect(flowLabel({ ...base, phase: 'plan' })).toBe('Plan')
    expect(flowLabel({ ...base, phase: 'design' })).toBe('Design')
    expect(flowLabel(base)).toBe('Tasks 3/6')
    expect(flowLabel({ ...base, phase: 'review' })).toBe('Review 3/6')
    expect(flowLabel({ ...base, total: 0 })).toBe('Tasks 2 running')
    expect(flowRatio(base)).toBe(0.5)
    expect(flowRatio({ ...base, total: 0 })).toBe(0)
  })
})

describe('plannedOf', () => {
  test('lists tasks no run has started, numbered from 1', async () => {
    const f = mergeFlow(null, { title: 'F', tasks: [{ title: 'Write the model', kind: 'refactor' }, { title: 'Draw it', kind: 'design' }] })
    const left = plannedOf(f, [run({ description: 'write  the MODEL!' })])
    expect(left).toEqual([{ title: 'Draw it', kind: 'design', model: '', effort: '', after: [], n: 2 }])
    expect(plannedOf(null, [])).toEqual([])
    expect(plannedOf(mergeFlow(f, { finished: true }), [])).toEqual([])
  })
})

describe('task state', () => {
  const plan = (): Flow => mergeFlow(null, { title: 'F', tasks: [{ title: 'Write the model', kind: 'refactor' }, { title: 'Draw it', kind: 'design' }, { title: 'Test it', kind: 'test' }] })

  test('taskState: none, running, paused, done', async () => {
    const f = plan()
    expect(taskState(null, true, 3)).toBe('none')
    expect(taskState(null, false, 0)).toBe('none')
    expect(taskState(f, true, 0)).toBe('running')
    expect(taskState(f, false, 1)).toBe('running')
    expect(taskState(f, true, 2)).toBe('running')
    expect(taskState(f, false, 0)).toBe('paused')
    const done = mergeFlow(f, { finished: true })
    for (const [w, n] of [[true, 2], [false, 0]] as const) expect(taskState(done, w, n)).toBe('done')
    // flow.running is not an agent running: a stale count left after a reload pauses nothing.
    expect(taskState({ ...f, running: 4 }, false, 0)).toBe('paused')
    // Junk counts read as none running.
    expect(taskState(f, false, NaN)).toBe('paused')
    expect(taskState(f, 'yes' as never, -1)).toBe('paused')
    expect(taskState(undefined as never, true, 1)).toBe('none')
  })

  test('flowSettled: every planned task with a run that ended done, nothing working: finished with done = total', async () => {
    const f = { ...plan(), done: 1, running: 2 }
    const runs = [
      run({ id: 'a', description: 'write  the MODEL!', status: 'done', startedAt: 1 }),
      run({ id: 'b', description: 'Draw it', status: 'done', startedAt: 2 }),
      run({ id: 'c', description: 'Test it.', status: 'done', startedAt: 3 }),
      // A run for no planned task does not matter once it has ended.
      run({ id: 'x', description: 'Look around', type: 'Explore', kind: 'search', status: 'failed', startedAt: 4 }),
    ]
    const settled = flowSettled(f, runs)
    // It keeps what it had before it settled, so a reopening can bring it back (audit finding 1).
    expect(settled).toEqual({ ...f, total: 3, done: 3, phase: 'close', isFinished: true, settled: { done: 1, phase: 'plan' } })
    expect(taskState(settled, false, 0)).toBe('done')
    expect(flowLabel(settled as Flow)).toBe('Done')
    // A task run twice counts by its latest run: failed then done is done; done then failed is not.
    const retried = [...runs, run({ id: 'a0', description: 'Write the model', status: 'failed', startedAt: 0 })]
    expect(flowSettled(f, retried)?.isFinished).toBe(true)
    const broke = [...runs, run({ id: 'a2', description: 'Write the model', status: 'failed', startedAt: 9 })]
    expect(flowSettled(f, broke)).toBe(f)
  })

  test('flowSettled leaves the flow as it is: a failed run, a missing one, one still running or waiting, no task list', async () => {
    const f = plan()
    const done = (description: string, startedAt: number): AgentRun => run({ id: description, description, status: 'done', startedAt })
    const all = [done('Write the model', 1), done('Draw it', 2), done('Test it', 3)]
    // The same object comes back, so the caller stores it only when it changed.
    expect(flowSettled(f, all.map(a => (a.description === 'Draw it' ? { ...a, status: 'failed' as const } : a)))).toBe(f)
    expect(flowSettled(f, all.slice(0, 2))).toBe(f)
    expect(flowSettled(f, [...all, run({ id: 'w', description: 'Review', status: 'running' })])).toBe(f)
    expect(flowSettled(f, [...all, run({ id: 'w', description: 'Review', status: 'waiting' })])).toBe(f)
    expect(flowSettled(f, all.map(a => (a.description === 'Test it' ? { ...a, status: 'running' as const } : a)))).toBe(f)
    expect(flowSettled(f, [])).toBe(f)
    // No task list: never changed, whatever the runs.
    const bare = mergeFlow(null, { title: 'Bare', total: 3, done: 1 })
    expect(bare.tasks).toEqual([])
    for (const list of [[], all, [run({ status: 'done' })]]) expect(flowSettled(bare, list)).toBe(bare)
    expect(flowSettled(null, all)).toBeNull()
    // Junk runs read as none.
    expect(flowSettled(f, null as never)).toBe(f)
    expect(flowSettled(f, [null, 3, { description: 7 }] as never)).toBe(f)
  })

  test('flowSettled never un-finishes a flow and never changes one with no task list, whatever the runs', async () => {
    const statuses: AgentRun['status'][] = ['running', 'waiting', 'done', 'failed']
    const titles = ['Write the model', 'Draw it', 'Test it', 'Other']
    const finished = mergeFlow(plan(), { finished: true })
    const bare = mergeFlow(null, { title: 'Bare', total: 3 })
    let n = 0
    // Every pairing of a status with each title, two runs at a time.
    for (const s1 of statuses)
      for (const s2 of statuses)
        for (const t1 of titles)
          for (const t2 of titles) {
            const list = [run({ id: 'a', description: t1, status: s1, startedAt: 1 }), run({ id: 'b', description: t2, status: s2, startedAt: 2 })]
            expect(flowSettled(finished, list)).toBe(finished)
            expect(flowSettled(bare, list)).toBe(bare)
            const out = flowSettled(plan(), list)
            // Settling only ever finishes: done never drops, total never changes.
            expect(out === null ? 'null' : out.isFinished ? (out.done === out.total ? 'ok' : 'done short') : 'ok').toBe('ok')
            n++
          }
    expect(n).toBe(256)
  })
})

const ALL_ITEMS: BarItem[] = ['context', 'fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn', 'time']
const SHORT_NAMES = ['context', '5h', 'week', 'model', 'speed', 'cache', 'turn', 'time']
const BAR_KEYS = ['barContext', 'barFiveHour', 'barWeek', 'barModelWeek', 'barSpeed', 'barCache', 'barTurn', 'barTime']
const DEFAULT_ITEMS: BarItem[] = [...ALL_ITEMS]
// 1.6's default items: all but the turn and the time.
const SIX: BarItem[] = ['context', 'fiveHour', 'week', 'model_week', 'speed', 'cache']
const SIX_ON: Settings = { ...DEFAULT_SETTINGS, barItems: SIX }

// The eight bar booleans with exactly `on` switched on.
const barOptions = (on: readonly BarItem[]): Record<string, boolean> => Object.fromEntries(ALL_ITEMS.map((k, i) => [BAR_KEYS[i], on.includes(k)]))

// Anything an options object, an older state or a typo may hold.
const SHAPES: unknown[] = [
  null,
  undefined,
  'junk',
  42,
  [],
  { theme: 7 },
  { theme: 'cat', currency: 'GBP', panelSize: 'large', panelUsage: 'bar', barItems: ['week', 'model'], autoOpen: 'any', logLines: 20 },
  { currency: 'EUR' },
  { barOrder: ['time', 'model', 'time', 'bogus', 3], barItems: ['cost', 'turnCost', 'model', 'time', 'model'] },
  { barOrder: 'model', barItems: 'model' },
  { textSize: 105, iconSize: '255%', barSize: -4, customRate: -1, logLines: 1000 },
  { textSize: NaN, iconSize: Infinity, barSize: '1e3', customRate: '1.5', tooltips: 'false', animations: 0, guide: 'TRUE' },
  { palette: 'OCEAN', barColors: ' Palette ', rateSource: 'CUSTOM', customRate: 1e300, background: 'Grid' },
  { palette: 'forest', background: 'stripes' },
  { ...OPTION_DEFAULTS },
  { ...OPTION_DEFAULTS, textSize: '120', iconSize: '120%', logLines: '40', barTime: 'on', barContext: 'OFF', barWeek: 'maybe' },
  { ...OPTION_DEFAULTS, ...barOptions([]) },
  { ...OPTION_DEFAULTS, ...barOptions(ALL_ITEMS) },
  { ...OPTION_DEFAULTS, barTurn: 1, barTime: null, animations: 'false' },
  // v3 options: barItems as text, in any order, and no booleans.
  { theme: 'cat', barItems: 'time, 5h, bogus, 5H, model_week', tooltips: false, guide: true },
  { barItems: '' },
  { barItems: ['time', 'fiveHour', 'time'] },
  { barItems: 42, textSize: true, guide: 1, animations: 'false', tooltips: 'off' },
  { ...DEFAULT_SETTINGS, barItems: ['time', 'model_week', 'model_week'] },
  // Booleans and an old list together: the booleans win.
  { barItems: 'time, turn', barTime: false, barContext: true },
]

const hasRepeats = (items: readonly string[]): boolean => new Set(items).size !== items.length
// In the fixed order: each item comes after every item before it in ALL_ITEMS.
const inFixedOrder = (items: readonly BarItem[]): boolean => items.every((k, i) => i === 0 || ALL_ITEMS.indexOf(items[i - 1] as BarItem) < ALL_ITEMS.indexOf(k))

describe('settings', () => {
  test('defaults, option lists, bar items and currencies are as specified', async () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'cat',
      palette: 'ocean',
      barColors: 'kind',
      background: 'plain',
      animations: true,
      textSize: 100,
      iconSize: 200,
      barSize: 100,
      currency: 'GBP',
      panelUsage: 'bar',
      barUsage: 'ring',
      barItems: DEFAULT_ITEMS,
      autoOpen: 'any',
      logLines: 50,
      barTooltips: true,
    })
    for (const gone of ['tooltips', 'guide', 'rateSource', 'customRate']) expect(Object.keys(DEFAULT_SETTINGS)).not.toContain(gone)
    expect(DEFAULT_SIZES).toEqual({ textSize: 100, iconSize: 200, barSize: 100, logLines: 50 })
    expect(SIZE_KEYS).toEqual(['textSize', 'iconSize', 'barSize', 'logLines'])
    expect(sizesOf(DEFAULT_SETTINGS)).toEqual(DEFAULT_SIZES)
    expect([FLOW_ACCENT, FLOW_DONE]).toEqual(['#8f8cf4', '#5fbf8f'])
    expect(SIZE_RANGE).toEqual({
      textSize: { min: 70, max: 200 },
      iconSize: { min: 50, max: 250 },
      barSize: { min: 80, max: 160 },
      logLines: { min: 5, max: 200 },
    })
    expect(STEP).toEqual({ textSize: 10, iconSize: 10, barSize: 10, logLines: 5 })
    expect(THEMES).toEqual(['clawd', 'cat'])
    expect(PANEL_USAGES).toEqual(['off', 'bar', 'ring'])
    expect(CHART_KINDS).toEqual(['bar', 'ring'])
    expect(AUTO_OPENS).toEqual(['any', 'plan', 'never'])
    expect(PALETTE_NAMES).toEqual(['classic', 'ocean', 'sunset'])
    expect(BAR_COLORS).toEqual(['kind', 'palette'])
    expect(BACKGROUNDS).toEqual(['dots', 'grid', 'plain'])
    expect(BAR_ITEMS.map(b => b.key)).toEqual(ALL_ITEMS)
    expect(BAR_ITEMS.map(b => b.name)).toEqual(SHORT_NAMES)
    expect(BAR_ITEMS.map(b => b.option)).toEqual(BAR_KEYS)
    expect(BAR_ITEMS.map(b => b.label)).toEqual(['Context', 'Usage left', 'Weekly limit', 'Model weekly limit', 'Speed', 'Cache countdown', 'Turn number', 'Session time'])
    expect(CURRENCIES).toHaveLength(30)
    expect(new Set(CURRENCIES.map(c => c.code)).size).toBe(30)
    for (const c of CURRENCIES) {
      expect(FALLBACK_RATES[c.code], c.code).toBeGreaterThan(0)
      expect(c.decimals, c.code).toBe(['JPY', 'KRW', 'IDR', 'VND'].includes(c.code) ? 0 : 2)
      expect(c.symbol.length, c.code).toBeGreaterThan(0)
    }
  })

  test('normalizeSettings turns junk into the defaults', async () => {
    for (const junk of [null, undefined, 'junk', 42, [], { theme: 7 }, {}]) expect(normalizeSettings(junk)).toEqual(DEFAULT_SETTINGS)
  })

  test('normalizeSettings reads v1, v2, v3 and v4 shapes and drops what v4 and v5 removed', async () => {
    const v1 = normalizeSettings({
      theme: 'cat',
      currency: 'GBP',
      panelSize: 'large',
      panelUsage: 'bar',
      barUsage: 'ring',
      barItems: ['week', 'model'],
      autoOpen: 'any',
      logLines: 20,
    })
    expect(v1).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'cat',
      currency: 'GBP',
      panelUsage: 'bar',
      barUsage: 'ring',
      barItems: ['week', 'model_week'],
      autoOpen: 'any',
      logLines: 20,
    })
    expect(Object.keys(v1)).not.toContain('panelSize')
    expect(Object.keys(v1).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
    // A v2 store: barOrder is gone, and so are the Model, Cost and Turn cost items.
    const v2 = normalizeSettings({ ...DEFAULT_SETTINGS, barOrder: ['time', 'cost'], barItems: ['cost', 'turnCost', 'time', 'context'], palette: 'candy' })
    expect(v2).toEqual({ ...DEFAULT_SETTINGS, barItems: ['context', 'time'] })
    expect(Object.keys(v2)).not.toContain('barOrder')
    // v3 settings and options: tooltips and guide are gone, barItems text is read in the fixed order.
    const v3 = normalizeSettings({ ...DEFAULT_SETTINGS, tooltips: false, guide: true, barItems: 'time, cache, 5h' })
    expect(v3).toEqual({ ...DEFAULT_SETTINGS, barItems: ['fiveHour', 'cache', 'time'] })
    expect(Object.keys(v3)).not.toContain('tooltips')
    expect(Object.keys(v3)).not.toContain('guide')
    expect(normalizeSettings({ currency: ' eur ' })).toEqual({ ...DEFAULT_SETTINGS, currency: 'EUR' })
    expect(normalizeSettings({ currency: 'XYZ' }).currency).toBe('GBP')
    // v4 settings: the custom rate and its source are gone.
    const v4 = normalizeSettings({ ...DEFAULT_SETTINGS, rateSource: 'custom', customRate: 0.5 })
    expect(v4).toEqual(DEFAULT_SETTINGS)
    expect(Object.keys(v4)).not.toContain('rateSource')
    expect(Object.keys(v4)).not.toContain('customRate')
  })

  test('normalizeSettings: barItems come from the booleans, else an old list, always in the fixed order', async () => {
    const items = (raw: Record<string, unknown>): BarItem[] => normalizeSettings(raw).barItems
    // From the booleans.
    expect(items(barOptions(['time', 'context']))).toEqual(['context', 'time'])
    expect(items(barOptions([]))).toEqual([])
    expect(items(barOptions(ALL_ITEMS))).toEqual(ALL_ITEMS)
    expect(items({ barTurn: false })).toEqual(ALL_ITEMS.filter(k => k !== 'turn'))
    expect(items({ barContext: false, barTime: true })).toEqual(['fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn', 'time'])
    // Boolean text is read; anything else leaves the item at its default.
    expect(items({ barTurn: 'on', barCache: 'OFF', barTime: 'yes', barWeek: 'maybe', barSpeed: 1 })).toEqual(['context', 'fiveHour', 'week', 'model_week', 'speed', 'turn', 'time'])
    // An old list, array or text, when the booleans are absent: known names once each, in the fixed order.
    expect(items({ barItems: ['week', 'context', 'week', 'bogus', 3, 'CACHE'] })).toEqual(['context', 'week', 'cache'])
    expect(items({ barItems: ['time', '5h', 'model_week', 'Model', 'fiveHour'] })).toEqual(['fiveHour', 'model_week', 'time'])
    expect(items({ barItems: [] })).toEqual([])
    expect(items({ barItems: 'time, 5h' })).toEqual(['fiveHour', 'time'])
    expect(items({ barItems: '' })).toEqual([])
    expect(items({ barItems: 'bogus' })).toEqual([])
    expect(items({ barItems: 'all' })).toEqual(ALL_ITEMS)
    for (const junk of [undefined, null, 42, true, {}]) expect(items({ barItems: junk })).toEqual(DEFAULT_ITEMS)
    // A boolean beats the old list for its own item; the other items follow the list.
    expect(items({ barItems: 'time, turn', barTime: false, barContext: true })).toEqual(['context', 'turn'])
    for (const raw of SHAPES) {
      const got = normalizeSettings(raw).barItems
      expect(hasRepeats(got), JSON.stringify(raw)).toBe(false)
      expect(inFixedOrder(got), JSON.stringify(raw)).toBe(true)
    }
  })

  test('normalizeSettings: sizes and logLines clamped and rounded, number text accepted', async () => {
    const size = (textSize: unknown): number => normalizeSettings({ textSize }).textSize
    expect(size(105)).toBe(105)
    expect(size(104.6)).toBe(105)
    expect(size(104.4)).toBe(104)
    expect(size(10)).toBe(70)
    expect(size(999)).toBe(200)
    expect(size('120%')).toBe(120)
    expect(size('120')).toBe(120)
    expect(size(' 133 % ')).toBe(133)
    expect(size(NaN)).toBe(100)
    expect(size(Infinity)).toBe(100)
    expect(size('big')).toBe(100)
    expect(size('')).toBe(100)
    expect(size('-120')).toBe(100)
    expect(size(true)).toBe(100)
    expect(normalizeSettings({ iconSize: 255 }).iconSize).toBe(250)
    expect(normalizeSettings({ iconSize: 44 }).iconSize).toBe(50)
    expect(normalizeSettings({ iconSize: 'x' }).iconSize).toBe(200)
    expect(normalizeSettings({ barSize: 75 }).barSize).toBe(80)
    expect(normalizeSettings({ barSize: 1000 }).barSize).toBe(160)
    const lines = (logLines: unknown): number => normalizeSettings({ logLines }).logLines
    expect(lines(40)).toBe(40)
    expect(lines('40')).toBe(40)
    expect(lines(12.6)).toBe(13)
    expect(lines(1)).toBe(5)
    expect(lines(1000)).toBe(200)
    expect(lines('lots')).toBe(50)
    expect(lines(NaN)).toBe(50)
  })

  test('normalizeSettings: booleans from booleans or their text, enums case-insensitive', async () => {
    expect(normalizeSettings({ animations: false }).animations).toBe(false)
    expect(normalizeSettings({ animations: 'FALSE' }).animations).toBe(false)
    expect(normalizeSettings({ animations: 'off' }).animations).toBe(false)
    expect(normalizeSettings({ animations: 0 }).animations).toBe(true)
    expect(normalizeSettings({ animations: 'maybe' }).animations).toBe(true)
    expect(normalizeSettings({ barTooltips: false }).barTooltips).toBe(false)
    expect(normalizeSettings({ barTooltips: 'no' }).barTooltips).toBe(false)
    expect(normalizeSettings({ barTooltips: 'perhaps' }).barTooltips).toBe(true)
    expect(normalizeSettings({ barTooltips: 1 }).barTooltips).toBe(true)
    expect(normalizeSettings({ palette: 'OCEAN', barColors: ' Palette ', background: 'Grid' })).toMatchObject({
      palette: 'ocean',
      barColors: 'palette',
      background: 'grid',
    })
    expect(normalizeSettings({ palette: 'neon', barColors: 'rainbow', background: 'stripes' })).toMatchObject({
      palette: 'ocean',
      barColors: 'kind',
      background: 'plain',
    })
    for (const gone of ['forest', 'candy', 'mono']) expect(normalizeSettings({ palette: gone }).palette).toBe('ocean')
    // What 1.6 stored under the old names: role is kind, crew is plan.
    expect(normalizeSettings({ barColors: 'role', autoOpen: 'crew' })).toMatchObject({ barColors: 'kind', autoOpen: 'plan' })
    expect(normalizeSettings({ barColors: ' Role ', autoOpen: 'CREW' })).toMatchObject({ barColors: 'kind', autoOpen: 'plan' })
    expect(setSetting(DEFAULT_SETTINGS, 'barColors', 'role')?.barColors).toBe('kind')
    expect(setSetting(DEFAULT_SETTINGS, 'autoOpen', 'crew')?.autoOpen).toBe('plan')
  })

  test('normalizeSizes: field by field, clamped and rounded, the default for missing or junk', async () => {
    expect(normalizeSizes(DEFAULT_SIZES)).toEqual(DEFAULT_SIZES)
    for (const junk of [undefined, null, 'sizes', 42, [], {}, [100, 200], { textSize: {} }]) expect(normalizeSizes(junk), JSON.stringify(junk)).toEqual(DEFAULT_SIZES)
    expect(normalizeSizes({ textSize: 130 })).toEqual({ ...DEFAULT_SIZES, textSize: 130 })
    expect(normalizeSizes({ textSize: '130%', iconSize: 999, barSize: 1, logLines: 12.6 })).toEqual({ textSize: 130, iconSize: 250, barSize: 80, logLines: 13 })
    expect(normalizeSizes({ textSize: NaN, iconSize: Infinity, barSize: 'big', logLines: '-3' })).toEqual(DEFAULT_SIZES)
    expect(normalizeSizes({ logLines: -3 })).toEqual({ ...DEFAULT_SIZES, logLines: 5 })
    // Only the four sizes, never anything else the stored value holds.
    expect(Object.keys(normalizeSizes({ ...DEFAULT_SIZES, theme: 'cat', extra: 1 })).sort()).toEqual([...SIZE_KEYS].sort())
    // A fresh object each time.
    expect(normalizeSizes(null)).not.toBe(DEFAULT_SIZES)
    // sizesOf reads the four sizes out of settings.
    expect(sizesOf({ ...DEFAULT_SETTINGS, textSize: 140, logLines: 25 })).toEqual({ ...DEFAULT_SIZES, textSize: 140, logLines: 25 })
    expect(sizesOf(null as never)).toEqual(DEFAULT_SIZES)
  })

  test('normalizeSettings is idempotent and never hands out the defaults themselves', async () => {
    for (const raw of SHAPES) {
      const once = normalizeSettings(raw)
      expect(normalizeSettings(once)).toEqual(once)
      expect(normalizeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once)
    }
    const s = normalizeSettings(null)
    s.barItems.pop()
    expect(DEFAULT_SETTINGS.barItems).toContain('time')
    const t = settingsFromOptions(OPTION_DEFAULTS)
    t.barItems.reverse()
    expect(DEFAULT_SETTINGS.barItems[0]).toBe('context')
  })

  test('setSetting sets each key and refuses bad values', async () => {
    const s = DEFAULT_SETTINGS
    expect(setSetting(s, 'theme', 'clawd')?.theme).toBe('clawd')
    expect(setSetting(s, 'theme', 'dog')).toBeNull()
    expect(setSetting(s, 'currency', 'jpy')?.currency).toBe('JPY')
    expect(setSetting(s, 'currency', 'GBP')?.currency).toBe('GBP')
    expect(setSetting(s, 'currency', 'XXX')).toBeNull()
    expect(setSetting(s, 'panelUsage', 'off')?.panelUsage).toBe('off')
    expect(setSetting(s, 'barUsage', 'bar')?.barUsage).toBe('bar')
    expect(setSetting(s, 'barUsage', 'off')).toBeNull()
    expect(setSetting(s, 'autoOpen', 'never')?.autoOpen).toBe('never')
    expect(setSetting(s, 'autoOpen', 'sometimes')).toBeNull()
    expect(setSetting(s, 'background', 'Grid')).toEqual({ ...s, background: 'grid' })
    expect(setSetting(s, 'background', 'plain')?.background).toBe('plain')
    expect(setSetting(s, 'background', 'stripes')).toBeNull()
    expect(setSetting(s, 'logLines', '40')).toEqual({ ...s, logLines: 40 })
    expect(setSetting(s, 'logLines', '1000')?.logLines).toBe(200)
    expect(setSetting(s, 'logLines', '0')?.logLines).toBe(5)
    expect(setSetting(s, 'logLines', 'lots')).toBeNull()
    expect(setSetting(s, 'barTooltips', 'off')).toEqual({ ...s, barTooltips: false })
    expect(setSetting({ ...s, barTooltips: false }, 'BarTooltips', 'yes')?.barTooltips).toBe(true)
    expect(setSetting(s, 'barTooltips', 'sometimes')).toBeNull()
    // Removed in v2, v3, v4 or v5.
    expect(setSetting(s, 'panelSize', 'large')).toBeNull()
    expect(setSetting(s, 'barOrder', 'time')).toBeNull()
    expect(setSetting(s, 'tooltips', 'off')).toBeNull()
    expect(setSetting(s, 'guide', 'on')).toBeNull()
    expect(setSetting(s, 'rateSource', 'custom')).toBeNull()
    expect(setSetting(s, 'customRate', '0.5')).toBeNull()
    // The mirrors and resetAll are not settings.
    for (const k of [...MIRROR_KEYS, 'resetAll']) {
      expect(setSetting(s, k, '120%'), k).toBeNull()
      expect(setSetting(s, k, 'on'), k).toBeNull()
    }
    expect(setSetting(s, 'colour', 'red')).toBeNull()
    expect(setSetting(s, '', '')).toBeNull()
    expect(setSetting(s, 'theme', undefined as never)).toBeNull()
    expect(setSetting(null as never, 'theme', 'clawd')).toEqual({ ...DEFAULT_SETTINGS, theme: 'clawd' })
    // Only the named key changes.
    expect(setSetting(s, 'theme', 'clawd')).toEqual({ ...s, theme: 'clawd' })
    expect(s.theme).toBe('cat')
  })

  test('setSetting: each bar boolean switches its item, in the fixed order', async () => {
    const s = SIX_ON
    expect(setSetting(s, 'barTurn', 'on')?.barItems).toEqual([...SIX, 'turn'])
    expect(setSetting(s, 'BARTIME', 'yes')?.barItems).toEqual([...SIX, 'time'])
    expect(setSetting(s, 'barContext', 'off')?.barItems).toEqual(['fiveHour', 'week', 'model_week', 'speed', 'cache'])
    expect(setSetting(s, 'barContext', 'true')).toEqual(s)
    // Switched on again, an item goes back to its own place, not to the end.
    const noWeek = setSetting(s, 'barWeek', 'no') as Settings
    expect(setSetting(noWeek, 'barWeek', 'on')?.barItems).toEqual(SIX)
    for (const k of BAR_KEYS) {
      expect(setSetting(s, k, 'maybe'), k).toBeNull()
      expect(setSetting(s, k, ''), k).toBeNull()
      const off = setSetting(barOptions(ALL_ITEMS) as never, k, 'off') as Settings
      expect(off.barItems).toHaveLength(7)
      expect(changedOptions({ ...s, barItems: ALL_ITEMS }, off)).toEqual([{ key: k, value: false }])
    }
  })

  test('setSetting: barItems takes a list in any order, all or none, and gives the fixed order', async () => {
    const s = SIX_ON
    const items = (v: string): BarItem[] | undefined => setSetting(s, 'barItems', v)?.barItems
    expect(items('context, week')).toEqual(['context', 'week'])
    expect(items('5h,model,context')).toEqual(['context', 'fiveHour', 'model_week'])
    expect(items(' time,  MODEL ')).toEqual(['model_week', 'time'])
    expect(items('fiveHour, model_week, 5H')).toEqual(['fiveHour', 'model_week'])
    expect(items('cache week')).toEqual(['week', 'cache'])
    expect(items('all')).toEqual(ALL_ITEMS)
    expect(items('ALL')).toEqual(ALL_ITEMS)
    expect(items('none')).toEqual([])
    expect(items('model,bogus')).toBeUndefined()
    expect(items('cost')).toBeUndefined()
    expect(items('')).toBeUndefined()
    expect(items(' , ')).toBeUndefined()
    expect(setSetting(s, 'barItems', 'time')).toEqual({ ...s, barItems: ['time'] })
    // The wiring writes the booleans that changed.
    expect(changedOptions(s, setSetting(s, 'barItems', 'context, week') as Settings)).toEqual([
      { key: 'barFiveHour', value: false },
      { key: 'barModelWeek', value: false },
      { key: 'barSpeed', value: false },
      { key: 'barCache', value: false },
    ])
    expect(changedOptions(s, setSetting(s, 'barItems', 'all') as Settings)).toEqual([
      { key: 'barTurn', value: true },
      { key: 'barTime', value: true },
    ])
  })

  test('setSetting: palette and barColors', async () => {
    const s = DEFAULT_SETTINGS
    expect(setSetting(s, 'palette', 'Ocean')).toEqual({ ...s, palette: 'ocean' })
    expect(setSetting(s, 'PALETTE', 'classic')?.palette).toBe('classic')
    expect(setSetting(s, 'palette', 'mono')).toBeNull()
    expect(setSetting(s, 'palette', 'neon')).toBeNull()
    expect(setSetting(s, 'barColors', 'palette')).toEqual({ ...s, barColors: 'palette' })
    expect(setSetting(s, 'barColors', 'rainbow')).toBeNull()
  })

  test('setSetting: sizes take a number with an optional percent sign, clamped and rounded', async () => {
    const s = DEFAULT_SETTINGS
    expect(setSetting(s, 'textSize', '120%')).toEqual({ ...s, textSize: 120 })
    expect(setSetting(s, 'textSize', '125')?.textSize).toBe(125)
    expect(setSetting(s, 'textSize', '125.5')?.textSize).toBe(126)
    expect(setSetting(s, 'textSize', '5')?.textSize).toBe(70)
    expect(setSetting(s, 'textSize', '999')?.textSize).toBe(200)
    expect(setSetting(s, 'iconSize', '250')?.iconSize).toBe(250)
    expect(setSetting(s, 'iconSize', '251%')?.iconSize).toBe(250)
    expect(setSetting(s, 'barSize', '90 %')?.barSize).toBe(90)
    expect(setSetting(s, 'barSize', '200')?.barSize).toBe(160)
    expect(setSetting(s, 'logLines', '75%')?.logLines).toBe(75)
    for (const bad of ['big', '-10', '', '%', '10%%']) expect(setSetting(s, 'textSize', bad), bad).toBeNull()
    // A size change is no option change: the wiring stores it and updates the mirror.
    const bigger = setSetting(s, 'iconSize', '150') as Settings
    expect(changedOptions(s, bigger)).toEqual([])
    expect(sizesOf(bigger)).toEqual({ ...DEFAULT_SIZES, iconSize: 150 })
  })

  test('setSetting: animations takes on/off/true/false/yes/no', async () => {
    const s = DEFAULT_SETTINGS
    expect(setSetting(s, 'animations', 'off')).toEqual({ ...s, animations: false })
    expect(setSetting(s, 'animations', 'NO')?.animations).toBe(false)
    expect(setSetting(s, 'Animations', 'false')?.animations).toBe(false)
    expect(setSetting({ ...s, animations: false }, 'animations', 'on')?.animations).toBe(true)
    expect(setSetting({ ...s, animations: false }, 'animations', 'Yes')?.animations).toBe(true)
    expect(setSetting({ ...s, animations: false }, 'animations', 'true')?.animations).toBe(true)
    expect(setSetting(s, 'animations', 'maybe')).toBeNull()
    expect(setSetting(s, 'animations', '')).toBeNull()
  })

  test('toggleBarItem switches one item off, or on in its own place', async () => {
    const on = toggleBarItem(SIX_ON, 'time')
    expect(on.barItems).toEqual([...SIX, 'time'])
    expect(toggleBarItem(on, 'week').barItems).toEqual(['context', 'fiveHour', 'model_week', 'speed', 'cache', 'time'])
    expect(toggleBarItem(on, 'turn').barItems).toEqual([...SIX, 'turn', 'time'])
    expect(toggleBarItem(toggleBarItem(DEFAULT_SETTINGS, 'context'), 'context').barItems).toEqual(DEFAULT_ITEMS)
    expect(toggleBarItem(DEFAULT_SETTINGS, 'bogus' as never)).toEqual(DEFAULT_SETTINGS)
    expect(toggleBarItem(DEFAULT_SETTINGS, 'time').barItems).toEqual(ALL_ITEMS.filter(k => k !== 'time'))
  })

  test('shownBarItems is barItems, in the fixed order', async () => {
    expect(shownBarItems(DEFAULT_SETTINGS)).toEqual(DEFAULT_ITEMS)
    expect(shownBarItems({ ...DEFAULT_SETTINGS, barItems: ['time', 'context'] })).toEqual(['context', 'time'])
    expect(shownBarItems({ ...DEFAULT_SETTINGS, barItems: [] })).toEqual([])
    expect(shownBarItems(null as never)).toEqual(DEFAULT_SETTINGS.barItems)
    for (const raw of SHAPES) expect(shownBarItems(raw as Settings)).toEqual(normalizeSettings(raw).barItems)
  })

  test('stepSetting moves one step, snaps off-grid values first, and never leaves the range', async () => {
    const s = DEFAULT_SETTINGS
    expect(stepSetting(s, 'textSize', 1)).toEqual({ ...s, textSize: 110 })
    expect(stepSetting(s, 'textSize', -1)).toEqual({ ...s, textSize: 90 })
    expect(stepSetting(s, 'logLines', 1).logLines).toBe(55)
    expect(stepSetting(s, 'logLines', -1).logLines).toBe(45)
    expect(stepSetting(s, 'iconSize', 1).iconSize).toBe(210)
    // Off the grid: to the next grid value in that direction.
    expect(stepSetting({ ...s, textSize: 105 }, 'textSize', 1).textSize).toBe(110)
    expect(stepSetting({ ...s, textSize: 105 }, 'textSize', -1).textSize).toBe(100)
    expect(stepSetting({ ...s, barSize: 133 }, 'barSize', 1).barSize).toBe(140)
    expect(stepSetting({ ...s, barSize: 133 }, 'barSize', -1).barSize).toBe(130)
    expect(stepSetting({ ...s, logLines: 13 }, 'logLines', 1).logLines).toBe(15)
    expect(stepSetting({ ...s, logLines: 13 }, 'logLines', -1).logLines).toBe(10)
    // At the ends it stays.
    expect(stepSetting({ ...s, textSize: 200 }, 'textSize', 1).textSize).toBe(200)
    expect(stepSetting({ ...s, textSize: 70 }, 'textSize', -1).textSize).toBe(70)
    expect(stepSetting({ ...s, logLines: 5 }, 'logLines', -1).logLines).toBe(5)
    // Unknown keys and directions change nothing; junk settings read as their normal form.
    expect(stepSetting(s, 'theme' as never, 1)).toEqual(s)
    expect(stepSetting(s, 'textSize', 0 as never)).toEqual(s)
    expect(stepSetting(s, 'textSize', 10 as never)).toEqual(s)
    expect(stepSetting(null as never, 'iconSize', 1)).toEqual({ ...DEFAULT_SETTINGS, iconSize: 210 })
    // A step never changes an option, only a size.
    expect(changedOptions(s, stepSetting(s, 'barSize', 1))).toEqual([])
    // Every start value in and around each range, many presses each way: always inside the range, on the grid once moved.
    const problems: string[] = []
    for (const key of ['textSize', 'iconSize', 'barSize', 'logLines'] as const) {
      const { min, max } = SIZE_RANGE[key]
      for (let v = min - 20; v <= max + 20; v++) {
        for (const dir of [1, -1] as const) {
          let cur = normalizeSettings({ ...s, [key]: v })
          for (let i = 0; i < 40; i++) {
            const next = stepSetting(cur, key, dir)
            const n = next[key]
            if (n < min || n > max) problems.push(`${key} from ${v} by ${dir}: ${n} out of range`)
            if (n % STEP[key] !== 0) problems.push(`${key} from ${v} by ${dir}: ${n} off the grid`)
            if (dir === 1 ? n < cur[key] : n > cur[key]) problems.push(`${key} from ${v} by ${dir}: went the wrong way to ${n}`)
            cur = next
          }
          if (cur[key] !== (dir === 1 ? max : min)) problems.push(`${key} from ${v} by ${dir}: stopped at ${cur[key]}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('options', () => {
  const MIRRORS = ['rateNow', 'textSizeNow', 'iconSizeNow', 'barSizeNow', 'logLinesNow']
  const MANIFEST_ORDER = [
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
    ...BAR_KEYS,
    'barTooltips',
    'textSizeNow',
    'iconSizeNow',
    'barSizeNow',
    'logLinesNow',
  ]
  const SETTING_ORDER = MANIFEST_ORDER.filter(k => !MIRRORS.includes(k))
  const BOOLEAN_KEYS = ['animations', ...BAR_KEYS, 'barTooltips']
  const builtIn: Rates = { at: 0, rates: FALLBACK_RATES, isLive: false }

  // An options object rebuilt from settings, as the config rows would hold the settings.
  const optionsOf = (s: Settings): Record<string, unknown> => Object.fromEntries(SETTING_OPTION_KEYS.map(k => [k, optionValue(s, k)]))

  test('the option keys: 23, in the manifest order; the settings among them; the mirrors; no resetAll', async () => {
    expect(OPTION_KEYS).toHaveLength(23)
    expect(OPTION_KEYS).toEqual(MANIFEST_ORDER)
    expect(Object.keys(OPTION_DEFAULTS)).toEqual(MANIFEST_ORDER)
    expect(SETTING_OPTION_KEYS).toEqual(SETTING_ORDER)
    expect(SETTING_OPTION_KEYS).toHaveLength(18)
    expect(MIRROR_KEYS).toEqual(MIRRORS)
    // Every setting is an option, but barItems (the eight booleans) and the four sizes (in the store).
    expect([...SETTING_OPTION_KEYS.filter(k => !BAR_KEYS.includes(k)), 'barItems', ...SIZE_KEYS].sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
    for (const gone of ['guide', 'tooltips', 'barItems', 'rateSource', 'customRate', 'textSize', 'iconSize', 'barSize', 'logLines', 'resetAll']) expect(OPTION_KEYS).not.toContain(gone)
    expect('resetAll' in OPTION_DEFAULTS).toBe(false)
  })

  test('the defaults hold the right kinds, and read as DEFAULT_SETTINGS', async () => {
    const defaults: Record<string, unknown> = { ...OPTION_DEFAULTS }
    for (const k of OPTION_KEYS) expect(typeof defaults[k], k).toBe(BOOLEAN_KEYS.includes(k) ? 'boolean' : 'string')
    expect(BAR_KEYS.map(k => defaults[k])).toEqual([true, true, true, true, true, true, true, true])
    expect(defaults.barTooltips).toBe(true)
    expect(settingsFromOptions(OPTION_DEFAULTS, DEFAULT_SIZES, DEFAULT_BAR_ORDER)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions(OPTION_DEFAULTS, DEFAULT_SIZES)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions(OPTION_DEFAULTS)).toEqual(DEFAULT_SETTINGS)
    expect(optionsOf(DEFAULT_SETTINGS)).toEqual(Object.fromEntries(SETTING_ORDER.map(k => [k, defaults[k]])))
    // The size mirrors' defaults are what the mod writes for the default sizes; the rate's is empty.
    const mirrors = mirrorValues(DEFAULT_SETTINGS, builtIn)
    for (const k of ['textSizeNow', 'iconSizeNow', 'barSizeNow', 'logLinesNow']) expect(defaults[k], k).toBe(mirrors[k])
    expect(defaults.rateNow).toBe('')
  })

  test('mirrorValues: the rate in use and the four sizes as text', async () => {
    expect(mirrorValues(DEFAULT_SETTINGS, builtIn)).toEqual({
      rateNow: `1 USD = ${(FALLBACK_RATES.GBP ?? 0).toFixed(4)} GBP · built-in estimate`,
      textSizeNow: '100%',
      iconSizeNow: '200%',
      barSizeNow: '100%',
      logLinesNow: '50',
    })
    const live: Rates = { at: Date.UTC(2026, 10, 14, 8), rates: { GBP: 0.75512 }, isLive: true }
    expect(mirrorValues({ ...DEFAULT_SETTINGS, textSize: 130, iconSize: 50, barSize: 160, logLines: 5 }, live)).toEqual({
      rateNow: '1 USD = 0.7551 GBP · online, 2026-11-14',
      textSizeNow: '130%',
      iconSizeNow: '50%',
      barSizeNow: '160%',
      logLinesNow: '5',
    })
    expect(mirrorValues({ ...DEFAULT_SETTINGS, currency: 'USD' }, live).rateNow).toBe('US dollars, no conversion')
    expect(Object.keys(mirrorValues(DEFAULT_SETTINGS, live))).toEqual(MIRRORS)
    // Junk settings read as their normal form; junk rates as the built-in table.
    expect(mirrorValues(null as never, null as never)).toEqual(mirrorValues(DEFAULT_SETTINGS, builtIn))
    for (const raw of SHAPES) for (const v of Object.values(mirrorValues(raw as Settings, builtIn))) expect(/NaN|undefined|Infinity/.test(v), v).toBe(false)
  })

  test('each picker lists the values the setting allows, its default among them', async () => {
    const choices: Record<string, readonly string[] | undefined> = { ...OPTION_CHOICES }
    const defaults: Record<string, unknown> = { ...OPTION_DEFAULTS }
    expect(Object.keys(choices).sort()).toEqual(SETTING_ORDER.filter(k => !BOOLEAN_KEYS.includes(k)).sort())
    for (const k of [...MIRRORS, 'resetAll']) expect(choices[k], k).toBeUndefined()
    // The plugin screen lists each picker's default first.
    expect(choices.currency).toEqual(['GBP', ...CURRENCIES.map(c => c.code).filter(c => c !== 'GBP')])
    expect(choices.palette).toEqual(['ocean', 'sunset', 'classic'])
    expect(choices.background).toEqual(['plain', 'dots', 'grid'])
    expect(choices.panelUsage).toEqual(['bar', 'ring', 'off'])
    expect(choices.theme).toEqual(['cat', 'clawd'])
    expect(choices.barColors).toEqual(['kind', 'palette'])
    expect(choices.autoOpen).toEqual(['any', 'plan', 'never'])
    expect(choices.barUsage).toEqual(['ring', 'bar'])
    // Each one allows exactly what the setting takes.
    const allowed: Record<string, readonly string[]> = { theme: THEMES, palette: PALETTE_NAMES, barColors: BAR_COLORS, background: BACKGROUNDS, currency: CURRENCIES.map(c => c.code), panelUsage: PANEL_USAGES, autoOpen: AUTO_OPENS, barUsage: CHART_KINDS }
    for (const [k, list = []] of Object.entries(choices)) expect([...list].sort(), k).toEqual([...(allowed[k] ?? [])].sort())
    for (const [k, list = []] of Object.entries(choices)) {
      expect(list[0], `${k} lists its default first`).toBe(defaults[k])
      expect(list, k).toContain(defaults[k])
      expect(hasRepeats(list), k).toBe(false)
      for (const v of list) {
        expect(v.length, `${k} ${v}`).toBeGreaterThanOrEqual(1)
        expect(v.length, `${k} ${v}`).toBeLessThanOrEqual(64)
        // Every choice is a value the settings keep as it is.
        expect(optionValue(settingsFromOptions({ ...OPTION_DEFAULTS, [k]: v }), k), `${k} ${v}`).toBe(v)
      }
    }
  })

  test('settingsFromOptions: choices and toggles from the options, the four sizes from the store only', async () => {
    expect(settingsFromOptions({})).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions(undefined, undefined)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions({ guide: true, tooltips: false, rateSource: 'custom', customRate: 0.5 })).toEqual(DEFAULT_SETTINGS)
    // Sizes an old (v4) options object still holds are ignored; the stored sizes are read.
    const v4 = { ...OPTION_DEFAULTS, textSize: 150, iconSize: 100, barSize: 120, logLines: 15 }
    expect(settingsFromOptions(v4)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions(v4, { textSize: 130, iconSize: '120%', barSize: 140.4, logLines: 30 })).toEqual({ ...DEFAULT_SETTINGS, textSize: 130, iconSize: 120, barSize: 140, logLines: 30 })
    // Junk sizes, field by field.
    for (const junk of [null, 'big', 42, [], { textSize: 'x' }]) expect(settingsFromOptions(OPTION_DEFAULTS, junk), JSON.stringify(junk)).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions(OPTION_DEFAULTS, { textSize: 9999, logLines: 'lots' })).toEqual({ ...DEFAULT_SETTINGS, textSize: 200 })
    // The mirrors and resetAll are never read, whatever they hold.
    expect(settingsFromOptions({ ...OPTION_DEFAULTS, textSizeNow: '180%', iconSizeNow: '50%', barSizeNow: 'x', logLinesNow: '5', rateNow: '1 USD = 9 GBP', resetAll: true }, DEFAULT_SIZES)).toEqual(DEFAULT_SETTINGS)
    expect(
      settingsFromOptions(
        {
          ...OPTION_DEFAULTS,
          animations: 'false',
          barTooltips: false,
          barContext: false,
          barTime: 'true',
        },
        { ...DEFAULT_SIZES, textSize: '120' },
      ),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      textSize: 120,
      animations: false,
      barTooltips: false,
      barItems: ['fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn', 'time'],
    })
    // Options as v3 sent them: a barItems text in its own order, no booleans.
    const v3 = Object.fromEntries(Object.entries(OPTION_DEFAULTS).filter(([k]) => !BAR_KEYS.includes(k)))
    expect(settingsFromOptions({ ...v3, barItems: 'time, model, 5h' }).barItems).toEqual(['fiveHour', 'model_week', 'time'])
    expect(settingsFromOptions({ ...v3, barItems: '' }).barItems).toEqual([])
    expect(settingsFromOptions({ ...v3, barItems: 'Turn,TIME,turn' }).barItems).toEqual(['turn', 'time'])
    expect(settingsFromOptions({ ...v3, barItems: ['time', 'model', 'fiveHour'] }).barItems).toEqual(['fiveHour', 'model_week', 'time'])
    // With the booleans present, a stale barItems is ignored.
    expect(settingsFromOptions({ ...OPTION_DEFAULTS, barItems: 'time' })).toEqual(DEFAULT_SETTINGS)
    expect(settingsFromOptions({ ...OPTION_DEFAULTS, theme: 'dog', textSize: 'huge', barTurn: 'perhaps' })).toEqual(DEFAULT_SETTINGS)
    // Total over anything an options object or a store may hold.
    for (const raw of SHAPES) for (const sizes of [undefined, raw, DEFAULT_SIZES]) expect(Object.keys(settingsFromOptions(raw, sizes)).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })

  test('pills come in the fixed order however the options were set', async () => {
    const want = ALL_ITEMS
    const orders = [ALL_ITEMS, [...ALL_ITEMS].reverse(), ['time', 'context', 'turn', 'week', 'cache', 'fiveHour', 'speed', 'model_week'] as BarItem[]]
    for (const order of orders) {
      // Booleans written in any order.
      const opts: Record<string, unknown> = { ...OPTION_DEFAULTS }
      for (const k of order) opts[BAR_KEYS[ALL_ITEMS.indexOf(k)] as string] = true
      expect(settingsFromOptions(opts).barItems).toEqual(want)
      // An old text list in any order.
      expect(settingsFromOptions({ barItems: order.join(', ') }).barItems).toEqual(want)
      // One by one through setSetting.
      let s: Settings = { ...DEFAULT_SETTINGS, barItems: [] }
      for (const k of order) s = setSetting(s, BAR_KEYS[ALL_ITEMS.indexOf(k)] as string, 'on') as Settings
      expect(s.barItems).toEqual(want)
    }
  })

  test('optionValue gives each setting option its kind; a bar key whether its item is shown; nothing for the rest', async () => {
    const s: Settings = { ...DEFAULT_SETTINGS, theme: 'cat', textSize: 130, barTooltips: false, barItems: ['fiveHour', 'model_week', 'time'] }
    expect(optionValue(s, 'theme')).toBe('cat')
    expect(optionValue(s, 'animations')).toBe(true)
    expect(optionValue(s, 'barTooltips')).toBe(false)
    expect(optionValue(s, 'currency')).toBe('GBP')
    expect(BAR_KEYS.map(k => optionValue(s, k))).toEqual([false, true, false, true, false, false, false, true])
    expect(optionValue(s, 'BarTime')).toBe(true)
    for (const k of SETTING_OPTION_KEYS) expect(['boolean', 'string'], k).toContain(typeof optionValue(s, k))
    // Sizes, mirrors, resetAll and removed keys are not setting options.
    for (const gone of ['barItems', 'guide', 'tooltips', 'barOrder', 'bogus', '', 'textSize', 'TextSize', 'logLines', 'rateSource', 'customRate', ...MIRRORS, 'resetAll'])
      expect(optionValue(s, gone), gone).toBeUndefined()
    expect(optionValue(null as never, 'palette')).toBe('ocean')
    expect(optionValue(null as never, 'barCache')).toBe(true)
    expect(optionKey('PALETTE')).toBe('palette')
    expect(optionKey(' barModelWeek ')).toBe('barModelWeek')
    expect(optionKey('barTooltips')).toBe('barTooltips')
    for (const k of ['barItems', 'barOrder', 'textSize', ...MIRRORS, 'resetAll']) expect(optionKey(k), k).toBeUndefined()
    for (const k of SETTING_OPTION_KEYS) expect(optionKey(k)).toBe(k)
  })

  test('settings survive a trip through their option values', async () => {
    const samples: Settings[] = SHAPES.map(raw => normalizeSettings(raw))
    samples.push({
      ...DEFAULT_SETTINGS,
      theme: 'cat',
      palette: 'sunset',
      barColors: 'palette',
      background: 'grid',
      currency: 'KRW',
      textSize: 133,
      iconSize: 250,
      barSize: 80,
      panelUsage: 'off',
      barUsage: 'ring',
      barItems: ['model_week', 'turn', 'time'],
      autoOpen: 'never',
      logLines: 200,
      animations: false,
      barTooltips: false,
    })
    // Every subset of the items.
    for (let mask = 0; mask < 1 << ALL_ITEMS.length; mask++) samples.push({ ...DEFAULT_SETTINGS, barItems: ALL_ITEMS.filter((_, i) => mask & (1 << i)) })
    for (const s of samples) {
      const options = optionsOf(s)
      expect(Object.keys(options)).toHaveLength(18)
      for (const v of Object.values(options)) expect(['boolean', 'string']).toContain(typeof v)
      expect(settingsFromOptions(options, sizesOf(s))).toEqual(s)
      expect(settingsFromOptions(JSON.parse(JSON.stringify(options)), JSON.parse(JSON.stringify(sizesOf(s))))).toEqual(s)
      expect(optionsOf(settingsFromOptions(options))).toEqual(options)
      expect(changedOptions(s, s)).toEqual([])
      expect(changedOptions(s, settingsFromOptions(options))).toEqual([])
    }
  })

  test('changedOptions lists what differs, in option order, with the new value; a reset to the defaults', async () => {
    const d = DEFAULT_SETTINGS
    expect(changedOptions(d, d)).toEqual([])
    expect(changedOptions(d, { ...d })).toEqual([])
    const s: Settings = { ...d, barSize: 120, theme: 'clawd', barTooltips: false, currency: 'USD', barItems: ['context', 'turn'] }
    expect(changedOptions(d, s)).toEqual([
      { key: 'theme', value: 'clawd' },
      { key: 'currency', value: 'USD' },
      { key: 'barFiveHour', value: false },
      { key: 'barWeek', value: false },
      { key: 'barModelWeek', value: false },
      { key: 'barSpeed', value: false },
      { key: 'barCache', value: false },
      { key: 'barTime', value: false },
      { key: 'barTooltips', value: false },
    ])
    // Reset: only what differs from the defaults; never a size, a mirror or resetAll.
    expect(changedOptions(s, d)).toEqual([
      { key: 'theme', value: 'cat' },
      { key: 'currency', value: 'GBP' },
      { key: 'barFiveHour', value: true },
      { key: 'barWeek', value: true },
      { key: 'barModelWeek', value: true },
      { key: 'barSpeed', value: true },
      { key: 'barCache', value: true },
      { key: 'barTime', value: true },
      { key: 'barTooltips', value: true },
    ])
    // A reset from 1.6's defaults writes the new ones, option by option.
    const old = settingsFromOptions({ theme: 'clawd', palette: 'sunset', barColors: 'role', autoOpen: 'crew', barUsage: 'bar', barTurn: false, barTime: false })
    expect(changedOptions(old, d)).toEqual([
      { key: 'theme', value: 'cat' },
      { key: 'palette', value: 'ocean' },
      { key: 'autoOpen', value: 'any' },
      { key: 'barUsage', value: 'ring' },
      { key: 'barTurn', value: true },
      { key: 'barTime', value: true },
    ])
    expect(changedOptions(stepSetting(d, 'logLines', 1), d)).toEqual([])
    const sized: Settings = { ...d, textSize: 200, iconSize: 50, barSize: 160, logLines: 5 }
    expect(changedOptions(sized, d)).toEqual([])
    expect(changedOptions(d, sized)).toEqual([])
    for (const raw of SHAPES)
      for (const c of [...changedOptions(d, normalizeSettings(raw)), ...changedOptions(normalizeSettings(raw), d)])
        expect(SETTING_OPTION_KEYS.includes(c.key) && !MIRRORS.includes(c.key) && !(SIZE_KEYS as readonly string[]).includes(c.key) && c.key !== 'resetAll', c.key).toBe(true)
    // Junk on either side reads as its normal form.
    expect(changedOptions(null as never, d)).toEqual([])
    for (const raw of SHAPES) {
      const s2 = normalizeSettings(raw)
      for (const c of changedOptions(d, s2)) expect(optionValue(s2, c.key), c.key).toBe(c.value)
      const keys = changedOptions(d, s2).map(c => c.key)
      expect(keys).toEqual(OPTION_KEYS.filter(k => keys.includes(k)))
    }
  })

  test('bar order: the default is every item in BAR_ITEMS order', async () => {
    expect([...DEFAULT_BAR_ORDER]).toEqual(ALL_ITEMS)
    expect(BAR_ITEMS.map(b => b.key)).toEqual([...DEFAULT_BAR_ORDER])
  })

  test('normalizeBarOrder: the order given, unknown names and repeats dropped, missing items appended in the default order', async () => {
    expect(normalizeBarOrder(['time', 'context', 'turn', 'week', 'cache', 'fiveHour', 'speed', 'model_week'])).toEqual(['time', 'context', 'turn', 'week', 'cache', 'fiveHour', 'speed', 'model_week'])
    expect(normalizeBarOrder(['time', 'bogus', 'time', 3, null, 'speed'])).toEqual(['time', 'speed', 'context', 'fiveHour', 'week', 'model_week', 'cache', 'turn'])
    // Short names and any case, as /crew set takes them.
    expect(normalizeBarOrder(['5h', 'MODEL', 'Time'])).toEqual(['fiveHour', 'model_week', 'time', 'context', 'week', 'speed', 'cache', 'turn'])
    // Missing or junk: the default order.
    for (const junk of [undefined, null, 'time,context', 42, {}, [], ['nope']]) expect(normalizeBarOrder(junk), JSON.stringify(junk)).toEqual(ALL_ITEMS)
    // Always all eight, once each.
    for (const raw of [...SHAPES, ['time', 'time'], ALL_ITEMS.slice().reverse()]) {
      const o = normalizeBarOrder(raw)
      expect([...o].sort()).toEqual([...ALL_ITEMS].sort())
    }
  })

  test('moveBarItem: one place up or down, a no-op at either end', async () => {
    expect(moveBarItem(DEFAULT_BAR_ORDER, 'week', -1)).toEqual(['context', 'week', 'fiveHour', 'model_week', 'speed', 'cache', 'turn', 'time'])
    expect(moveBarItem(DEFAULT_BAR_ORDER, 'week', 1)).toEqual(['context', 'fiveHour', 'model_week', 'week', 'speed', 'cache', 'turn', 'time'])
    expect(moveBarItem(DEFAULT_BAR_ORDER, 'context', -1)).toEqual(ALL_ITEMS)
    expect(moveBarItem(DEFAULT_BAR_ORDER, 'time', 1)).toEqual(ALL_ITEMS)
    // Down then up is where it started.
    for (const item of ALL_ITEMS) expect(moveBarItem(moveBarItem(DEFAULT_BAR_ORDER, item, 1), item, -1)).toEqual(item === 'time' ? moveBarItem(DEFAULT_BAR_ORDER, 'time', -1) : ALL_ITEMS)
    // A junk order is made whole first; an unknown item or direction changes nothing.
    expect(moveBarItem(['time'] as BarItem[], 'time', 1)).toEqual(['context', 'time', 'fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn'])
    expect(moveBarItem(DEFAULT_BAR_ORDER, 'bogus' as BarItem, 1)).toEqual(ALL_ITEMS)
    expect(moveBarItem(DEFAULT_BAR_ORDER, 'week', 2 as never)).toEqual(ALL_ITEMS)
    // The order given is not changed in place.
    const mine: BarItem[] = [...ALL_ITEMS]
    moveBarItem(mine, 'week', 1)
    expect(mine).toEqual(ALL_ITEMS)
  })

  test('settingsFromOptions applies the stored order: the items switched on, in that order', async () => {
    expect(settingsFromOptions(OPTION_DEFAULTS, DEFAULT_SIZES, DEFAULT_BAR_ORDER)).toEqual(DEFAULT_SETTINGS)
    const order: BarItem[] = ['cache', 'time', 'context', 'speed', 'turn', 'week', 'fiveHour', 'model_week']
    expect(settingsFromOptions(OPTION_DEFAULTS, DEFAULT_SIZES, order).barItems).toEqual(order)
    expect(settingsFromOptions({ ...OPTION_DEFAULTS, barTurn: false, barContext: false }, DEFAULT_SIZES, order).barItems).toEqual(['cache', 'time', 'speed', 'week', 'fiveHour', 'model_week'])
    // Missing or junk order: the default order.
    for (const junk of [undefined, null, 'x', {}, [3]]) expect(settingsFromOptions(OPTION_DEFAULTS, DEFAULT_SIZES, junk)).toEqual(DEFAULT_SETTINGS)
    // A partial order: the items it names first, the rest after, in the default order.
    expect(settingsFromOptions(OPTION_DEFAULTS, undefined, ['speed']).barItems).toEqual(['speed', 'context', 'fiveHour', 'week', 'model_week', 'cache', 'turn', 'time'])
  })

  test('barItems is always a subsequence of the normalised order, whatever options and order hold', async () => {
    const orders: unknown[] = [undefined, DEFAULT_BAR_ORDER, [...ALL_ITEMS].reverse(), ['time', 'bogus', 'speed', 'time'], ['5h', 'model'], 'junk', [null]]
    const isSubsequence = (sub: readonly string[], seq: readonly string[]): boolean => {
      let i = 0
      for (const x of seq) if (x === sub[i]) i++
      return i === sub.length
    }
    let n = 0
    for (const raw of SHAPES)
      for (const order of orders)
        for (let mask = 0; mask < 1 << ALL_ITEMS.length; mask += 37) {
          const opts: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
          BAR_KEYS.forEach((k, i) => {
            if (mask & (1 << i)) opts[k] = (mask >> 3) % 2 === 0
          })
          const items = settingsFromOptions(opts, undefined, order).barItems
          expect(isSubsequence(items, normalizeBarOrder(order)) ? 'ok' : `${JSON.stringify(order)}: ${items.join(',')}`).toBe('ok')
          expect(new Set(items).size).toBe(items.length)
          n++
        }
    expect(n > 100).toBe(true)
  })

  test('barItemsOf reads a list as text, in the fixed order', async () => {
    expect(barItemsOf('context, 5h, week, model, speed, cache, turn, time')).toEqual(DEFAULT_SETTINGS.barItems)
    expect(barItemsOf('TIME,5H , Model_Week ,fivehour, bogus,, turn')).toEqual(['fiveHour', 'model_week', 'turn', 'time'])
    expect(barItemsOf('cost turnCost model')).toEqual(['model_week'])
    expect(barItemsOf('all')).toEqual(ALL_ITEMS)
    expect(barItemsOf('')).toEqual([])
    expect(barItemsOf('  ,  ')).toEqual([])
    expect(barItemsOf(undefined as never)).toEqual([])
    // Every subset of the items, named forwards and backwards.
    for (let mask = 0; mask < 1 << ALL_ITEMS.length; mask++) {
      const subset = ALL_ITEMS.filter((_, i) => mask & (1 << i))
      const names = SHORT_NAMES.filter((_, i) => mask & (1 << i))
      for (const text of [names.join(', '), [...names].reverse().join(' ')]) {
        expect(barItemsOf(text), text).toEqual(subset)
        expect(hasRepeats(barItemsOf(text))).toBe(false)
      }
    }
  })
})

describe('palettes', () => {
  test('each palette is as specified', async () => {
    const TABLE: [string, string, string[]][] = [
      ['classic', 'Classic', ['#3fa66b', '#d9962b', '#d64545', '#8f8cf4', '#5fbf8f']],
      ['ocean', 'Ocean', ['#2E9BB8', '#E0A030', '#E5484D', '#3B82F6', '#22B8A7']],
      ['sunset', 'Sunset', ['#F08A4B', '#E6B422', '#D64545', '#E0567A', '#F2A65A']],
    ]
    expect(Object.keys(PALETTES)).toEqual(TABLE.map(t => t[0]))
    for (const [name, label, [calm, warn, alert, accent, done]] of TABLE) {
      expect(PALETTES[name as keyof typeof PALETTES]).toEqual({ label, calm, warn, alert, accent, done })
    }
  })

  test('every palette name has a palette, and every palette a name', async () => {
    for (const name of PALETTE_NAMES) expect(PALETTES[name], name).toBeDefined()
    expect(Object.keys(PALETTES).sort()).toEqual([...PALETTE_NAMES].sort())
  })

  test('paletteOf and workColor', async () => {
    const d = DEFAULT_SETTINGS
    expect(paletteOf(d)).toEqual(PALETTES.ocean)
    expect(paletteOf({ ...d, palette: 'sunset' }).accent).toBe('#E0567A')
    expect(paletteOf({ ...d, palette: 'neon' as never })).toEqual(PALETTES.ocean)
    expect(paletteOf({ ...d, palette: 'mono' as never })).toEqual(PALETTES.ocean)
    expect(paletteOf(null as never)).toEqual(PALETTES.ocean)
    const chef = run({ kind: 'build', tint: 0 })
    const second = run({ kind: 'build', tint: 1 })
    expect(workColor(d, chef)).toBe('#367FDD')
    expect(workColor(d, second)).toBe(shiftColor('#367FDD', 1))
    expect(workColor({ ...d, palette: 'sunset' }, chef)).toBe('#367FDD')
    expect(workColor({ ...d, barColors: 'palette', palette: 'classic' }, chef)).toBe(PALETTES.classic.accent)
    expect(workColor({ ...d, barColors: 'palette', palette: 'sunset' }, second)).toBe('#E0567A')
    // 1.6's role value is the agent's own colour.
    expect(workColor({ ...d, barColors: 'role' as never }, second)).toBe(shiftColor('#367FDD', 1))
    expect(OTHER_HUES).toContain(workColor(d, run({ kind: 'bogus' as never, type: 'general-purpose' })))
  })
})

describe('money', () => {
  const rates: Rates = { at: 0, rates: { GBP: 0.8, KRW: 1400, JPY: 100, EUR: 1, CHF: 1 }, isLive: true }
  const none: Rates = { at: 0, rates: {}, isLive: false }
  const inCur = (currency: string, o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, currency, ...o })

  test('fmtUsd: two places under $100, none above', async () => {
    expect(fmtUsd(0)).toBe('$0.00')
    expect(fmtUsd(0.42)).toBe('$0.42')
    expect(fmtUsd(12.4)).toBe('$12.40')
    expect(fmtUsd(128)).toBe('$128')
    expect(fmtUsd(9.996)).toBe('$10.00')
    expect(fmtUsd(99.96)).toBe('$99.96')
    expect(fmtUsd(99.996)).toBe('$100')
    expect(fmtUsd(1_234_567)).toBe('$1,234,567')
    expect(fmtUsd(-0.42)).toBe('-$0.42')
    expect(fmtUsd(-0.001)).toBe('$0.00')
    expect(fmtUsd(NaN)).toBe('$0.00')
    expect(fmtUsd(Infinity)).toBe('$0.00')
    expect(fmtUsd(1e25)).toMatch(/^\$/)
  })

  test('fmtMoney converts with live rates, else the fallback table', async () => {
    expect(fmtMoney(11.5875, 'GBP', rates)).toBe('£9.27')
    expect(fmtMoney(11.5875, 'gbp', rates)).toBe('£9.27')
    expect(fmtMoney(10, 'GBP', none)).toBe(`£${(10 * (FALLBACK_RATES.GBP ?? 0)).toFixed(2)}`)
    expect(fmtMoney(10, 'GBP', { ...rates, rates: { GBP: 0 } })).toBe(fmtMoney(10, 'GBP', none))
    expect(fmtMoney(10, 'GBP', {} as never)).toBe(fmtMoney(10, 'GBP', none))
    expect(fmtMoney(11.3, 'KRW', rates)).toBe('₩15,820')
    expect(fmtMoney(0.042, 'JPY', rates)).toBe('¥4')
    expect(fmtMoney(1234.5, 'EUR', rates)).toBe('€1,235')
    expect(fmtMoney(2, 'CHF', rates)).toBe('CHF 2.00')
    expect(fmtMoney(-2, 'EUR', rates)).toBe('-€2.00')
  })

  test('fmtMoney is null for USD, unknown codes and non-finite amounts', async () => {
    expect(fmtMoney(1, 'USD', rates)).toBeNull()
    expect(fmtMoney(1, 'XYZ', rates)).toBeNull()
    expect(fmtMoney(1, '', rates)).toBeNull()
    expect(fmtMoney(NaN, 'GBP', rates)).toBeNull()
    expect(fmtMoney(Infinity, 'GBP', rates)).toBeNull()
  })

  test('rateFor: usd, live and built-in; no custom rate any more', async () => {
    expect(rateFor(inCur('USD'), rates)).toEqual({ rate: 1, source: 'usd' })
    expect(rateFor(DEFAULT_SETTINGS, rates)).toEqual({ rate: 0.8, source: 'live' })
    // A v4 custom rate left in state is ignored.
    expect(rateFor({ ...inCur('GBP'), rateSource: 'custom', customRate: 0.5 } as Settings, rates)).toEqual({ rate: 0.8, source: 'live' })
    expect(rateFor(inCur('GBP'), { ...rates, isLive: false })).toEqual({ rate: 0.8, source: 'built-in' })
    expect(rateFor(inCur('GBP'), none)).toEqual({ rate: FALLBACK_RATES.GBP, source: 'built-in' })
    expect(rateFor(inCur('GBP'), { ...rates, rates: { GBP: -1 } })).toEqual({ rate: FALLBACK_RATES.GBP, source: 'built-in' })
    expect(rateFor(inCur('GBP'), { ...rates, rates: { GBP: NaN } })).toEqual({ rate: FALLBACK_RATES.GBP, source: 'built-in' })
    expect(rateFor(inCur('GBP'), null as never)).toEqual({ rate: FALLBACK_RATES.GBP, source: 'built-in' })
    expect(rateFor(inCur('XYZ'), rates)).toEqual({ rate: 0.8, source: 'live' })
  })

  test('money shows the chosen currency only', async () => {
    expect(money(53.8, inCur('USD'), rates)).toBe('$53.80')
    expect(money(128.4, inCur('USD'), rates)).toBe('$128')
    expect(money(1_234_567, inCur('USD'), rates)).toBe('$1,234,567')
    expect(money(10, DEFAULT_SETTINGS, rates)).toBe('£8.00')
    expect(money(11.5875, inCur('GBP'), rates)).toBe('£9.27')
    expect(money(51.27, inCur('KRW'), rates)).toBe('₩71,778')
    expect(money(0.042, inCur('JPY'), rates)).toBe('¥4')
    expect(money(1234.5, inCur('EUR'), rates)).toBe('€1,235')
    expect(money(2, inCur('CHF'), rates)).toBe('CHF 2.00')
    expect(money(-2, inCur('EUR'), rates)).toBe('-€2.00')
    expect(money(10, inCur('GBP'), none)).toBe(`£${(10 * (FALLBACK_RATES.GBP ?? 0)).toFixed(2)}`)
    // Cents below 100 units, chosen on the rounded figure.
    expect(money(124.995, inCur('GBP'), rates)).toBe('£100')
    expect(money(124.98, inCur('GBP'), rates)).toBe('£99.98')
  })

  test('money never throws and never shows NaN', async () => {
    expect(money(NaN, inCur('USD'), rates)).toBe('$0.00')
    expect(money(Infinity, inCur('GBP'), rates)).toBe('£0.00')
    expect(money(-Infinity, inCur('KRW'), rates)).toBe('₩0')
    expect(money(1e300, inCur('KRW'), { ...rates, rates: { KRW: 1e300 } })).toBe('₩0')
    expect(money('3' as never, inCur('GBP'), rates)).toBe('£0.00')
    for (const raw of SHAPES) {
      for (const usd of [0, 0.004, 1, 99.995, 1e9, 1e25, -5, NaN, Infinity]) {
        for (const r of [rates, none, null as never, { at: NaN, rates: { GBP: Infinity, EUR: NaN }, isLive: true }]) {
          const shown = money(usd, raw as Settings, r)
          expect(shown).not.toContain('NaN')
          expect(shown).not.toContain('Infinity')
        }
      }
    }
  })

  test('rateLine names the rate and where it came from', async () => {
    const at = Date.UTC(2026, 10, 13, 23, 59, 59)
    const live: Rates = { at, rates: { GBP: 0.75512, KRW: 1400.4, JPY: 151.236 }, isLive: true }
    expect(rateLine(inCur('USD'), live)).toBe('US dollars, no conversion')
    expect(rateLine(inCur('GBP'), live)).toBe('1 USD = 0.7551 GBP · online, 2026-11-13')
    expect(rateLine(DEFAULT_SETTINGS, live)).toBe('1 USD = 0.7551 GBP · online, 2026-11-13')
    expect(rateLine(inCur('KRW'), live)).toBe('1 USD = 1,400 KRW · online, 2026-11-13')
    expect(rateLine(inCur('JPY'), live)).toBe('1 USD = 151 JPY · online, 2026-11-13')
    expect(rateLine(inCur('GBP'), { ...live, isLive: false })).toBe('1 USD = 0.7551 GBP · built-in estimate')
    expect(rateLine(inCur('KRW'), none)).toBe('1 USD = 1,400 KRW · built-in estimate')
    expect(rateLine(inCur('GBP'), { ...live, at: NaN })).toBe('1 USD = 0.7551 GBP · online')
    expect(rateLine(inCur('IDR'), { ...live, rates: { IDR: 16_300.6 } })).toBe('1 USD = 16,301 IDR · online, 2026-11-13')
    // A tiny rate still shows a figure rather than 0.0000.
    expect(rateLine(inCur('GBP'), { ...live, rates: { GBP: 0.00001234 } })).toBe('1 USD = 0.00001234 GBP · online, 2026-11-13')
    // A v4 custom rate left in state is not shown.
    expect(rateLine({ ...inCur('GBP'), rateSource: 'custom', customRate: 0.5 } as Settings, live)).toBe('1 USD = 0.7551 GBP · online, 2026-11-13')
  })

  test('rateLine dates are the UTC date of rates.at', async () => {
    const STAMPS = [
      0,
      -1000,
      Date.UTC(2000, 1, 29, 12),
      Date.UTC(2024, 1, 29, 23, 59, 59, 999),
      Date.UTC(2024, 2, 1),
      Date.UTC(2100, 1, 28, 18),
      Date.UTC(2100, 2, 1),
      Date.UTC(1999, 11, 31, 23, 59, 59),
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 11, 31, 12),
    ]
    for (let t = Date.UTC(2023, 0, 1, 7); t < Date.UTC(2029, 0, 1); t += 86_400_000 * 13 + 3_600_000) STAMPS.push(t)
    for (const at of STAMPS) {
      const line = rateLine(inCur('GBP'), { at, rates: { GBP: 0.8 }, isLive: true })
      expect(line, String(at)).toBe(`1 USD = 0.8000 GBP · online, ${new Date(at).toISOString().slice(0, 10)}`)
    }
  })
})

describe('numbers and times', () => {
  test('fmtTokens', async () => {
    const CASES: [number, string][] = [
      [0, '0'],
      [999, '999'],
      [999.6, '1k'],
      [96_000, '96k'],
      [999_499, '999k'],
      [999_500, '1M'],
      [1_000_000, '1M'],
      [1_200_000, '1.2M'],
      [9_960_000, '10M'],
      [14_000_000, '14M'],
      [1e15, '1,000,000,000M'],
      [-5, '0'],
      [NaN, '0'],
      [Infinity, '0'],
    ]
    for (const [n, shown] of CASES) expect(fmtTokens(n), String(n)).toBe(shown)
  })

  test('fmtTime', async () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(92_000)).toBe('1:32')
    expect(fmtTime(3_723_000)).toBe('1:02:03')
    expect(fmtTime(-5000)).toBe('0:00')
    expect(fmtTime(NaN)).toBe('0:00')
  })

  test('fmtSpan', async () => {
    expect(fmtSpan(50_000)).toBe('50s')
    expect(fmtSpan(59_600)).toBe('1m')
    expect(fmtSpan(42 * MIN + 59_000)).toBe('42m')
    expect(fmtSpan(67 * MIN)).toBe('1h 07m')
    expect(fmtSpan((3 * 24 + 19) * HOUR)).toBe('3d 19h')
    expect(fmtSpan(24 * HOUR + 5 * HOUR)).toBe('1d 05h')
    expect(fmtSpan(-1)).toBe('0s')
    expect(fmtSpan(NaN)).toBe('0s')
    expect(fmtSpan(1e18)).toMatch(/^\d+d \d\dh$/)
  })

  test('fmtClock', async () => {
    const at = Date.UTC(2026, 10, 13, 9, 5, 7, 900)
    expect(fmtClock(at)).toBe('09:05:07')
    expect(fmtClock(at, 60)).toBe('10:05:07')
    expect(fmtClock(at, -600)).toBe('23:05:07')
    expect(fmtClock(-1000)).toBe('23:59:59')
    expect(fmtClock(NaN)).toBe('--:--:--')
    expect(fmtClock(at, NaN)).toBe('09:05:07')
  })
})

describe('text', () => {
  test('fitText sizes CJK as wide', async () => {
    expect(textWidth('中文', 13)).toBe(26)
    expect(fitText('hello', 13, 200)).toBe('hello')
    const cjk = fitText('中文标题很长很长很长很长', 13, 60)
    expect(cjk).toEndWith('…')
    expect(textWidth(cjk, 13)).toBeLessThanOrEqual(60)
    const latin = fitText('abcdefghijklmnopqrstuvwxyz', 13, 60)
    expect([...cjk].length).toBeLessThan([...latin].length)
  })

  test('printable strips control and format characters to one line', async () => {
    expect(printable('a\u0000b\r\nc\u202Ed\u2028 e\t')).toBe('a b cd e')
    expect(printable(undefined as never)).toBe('')
  })
})

describe('wrapText', () => {
  const CJK = '中文标题很长很长很长很长'

  test('empty or blank text gives no lines', async () => {
    expect(wrapText('', 10, 100, 3)).toEqual([])
    expect(wrapText('  \n\t ', 10, 100, 3)).toEqual([])
    expect(wrapText(undefined as never, 10, 100, 3)).toEqual([])
  })

  test('greedy wrap on spaces', async () => {
    expect(wrapText('hello world', 10, 200, 3)).toEqual(['hello world'])
    expect(wrapText('hello world', 10, 40, 3)).toEqual(['hello', 'world'])
    expect(wrapText('  a\n\tb  ', 10, 200, 3)).toEqual(['a b'])
  })

  test('a word longer than a line is broken by characters', async () => {
    const word = 'x'.repeat(50)
    const lines = wrapText(word, 10, 60, 10)
    expect(lines).toEqual(Array.from({ length: 5 }, () => 'x'.repeat(10)))
    const mixed = wrapText(`go ${'a'.repeat(30)} end`, 10, 60, 20)
    expect(mixed.join('').replace(/ /g, '')).toBe(`go${'a'.repeat(30)}end`)
    for (const l of mixed) expect(textWidth(l, 10)).toBeLessThanOrEqual(60)
  })

  test('CJK without spaces is split by characters', async () => {
    expect(wrapText(CJK, 13, 60, 5)).toEqual(['中文标题', '很长很长', '很长很长'])
    // A CJK run may break anywhere, so it does not leave a short line behind it.
    const mixed = wrapText('Build 中文界面中文界面 now', 10, 50, 10)
    expect(mixed[0]).toStartWith('Build 中')
    expect(mixed.join('').replace(/ /g, '')).toBe('Build中文界面中文界面now'.replace(/ /g, ''))
  })

  test('past maxLines the last line ends with an ellipsis and still fits', async () => {
    const text = 'one two three four five six seven eight nine ten'
    const all = wrapText(text, 10, 50, 99)
    expect(all.length).toBeGreaterThan(2)
    expect(all.join(' ')).toBe(text)
    const two = wrapText(text, 10, 50, 2)
    expect(two).toHaveLength(2)
    expect(two[0]).toBe(all[0])
    expect(two[1]).toEndWith('…')
    for (const l of two) expect(textWidth(l, 10)).toBeLessThanOrEqual(50)
    expect(wrapText(CJK, 13, 60, 2)).toEqual(['中文标题', '很长很长…'])
    const one = wrapText(text, 10, 50, 1)
    expect(one).toHaveLength(1)
    expect(one[0]).toEndWith('…')
    expect(textWidth(one[0] ?? '', 10)).toBeLessThanOrEqual(50)
    // Exactly enough lines: no ellipsis.
    expect(wrapText(text, 10, 50, all.length)).toEqual(all)
  })

  test('never empty for non-empty text, whatever the limits', async () => {
    expect(wrapText('abc', 10, 0, 10)).toEqual(['a', 'b', 'c'])
    expect(wrapText('abc', 10, 0, 1)).toEqual(['…'])
    expect(wrapText('abc def', 10, 100, 0)).toHaveLength(1)
    expect(wrapText('abc def', 10, 100, NaN)).toHaveLength(1)
    expect(wrapText('abc def', 10, NaN, 3).length).toBeGreaterThan(0)
    expect(wrapText('abc def', 10, 30, Infinity)).toEqual(['abc', 'def'])
  })

  test('lines fit, carry no edge spaces and keep every character', async () => {
    const TEXTS = [
      'Running SRC="/c/Users/someone/AppData/Roaming/Claude/scratch" && npm test -- --watch=false',
      'Editing register.tsx to wrap the bar items onto a second line',
      '把设置面板分成清楚的几个部分，每部分有标题',
      'mixed 中文 and English, with a verylongidentifierthatneverends in the middle',
    ]
    for (const text of TEXTS) {
      for (const maxW of [40, 90, 160, 400]) {
        const lines = wrapText(text, 12, maxW, 50)
        expect(lines.length).toBeGreaterThan(0)
        for (const l of lines) {
          expect(l.length).toBeGreaterThan(0)
          expect(l).toBe(l.trim())
          expect(textWidth(l, 12), `${maxW}: ${l}`).toBeLessThanOrEqual(maxW)
        }
        expect(lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
      }
    }
  })
})

describe('sortAgents', () => {
  test('working by start, waiting by wait, finished newest first', async () => {
    const list = [
      run({ id: 'r2', status: 'running', startedAt: 20 }),
      run({ id: 'd1', status: 'done', startedAt: 1, endedAt: 50 }),
      run({ id: 'w2', status: 'waiting', doingSince: 40 }),
      run({ id: 'r1', status: 'running', startedAt: 10 }),
      run({ id: 'f1', status: 'failed', startedAt: 2, endedAt: 70 }),
      run({ id: 'w1', status: 'waiting', doingSince: 30 }),
      run({ id: 'd0', status: 'done', startedAt: 60 }),
    ]
    const ids = (l: AgentRun[]): string[] => l.map(a => a.id)
    const s = sortAgents(list)
    expect(ids(s.working)).toEqual(['r1', 'r2'])
    expect(ids(s.waiting)).toEqual(['w1', 'w2'])
    expect(ids(s.finished)).toEqual(['f1', 'd0', 'd1'])
    expect(list[0]?.id).toBe('r2')
    expect(sortAgents([])).toEqual({ working: [], waiting: [], finished: [] })
  })
})

describe('gauges', () => {
  const limit = (kind: string, percentUsed: number, resetsAt: string | null) => ({ kind, percentUsed, resetsAt })
  const inHour = new Date(NOW + 67 * MIN).toISOString()

  test('gaugeOf reads what is left, with tones', async () => {
    expect(gaugeOf(limit('five_hour', 93, inHour), NOW)).toEqual({
      kind: 'five_hour',
      label: '5h',
      used: 93,
      left: 7,
      resetIn: 67 * MIN,
      tone: 'alert',
    })
    expect(gaugeOf(limit('five_hour', 90, inHour), NOW)?.tone).toBe('alert')
    expect(gaugeOf(limit('five_hour', 89, inHour), NOW)?.tone).toBe('warn')
    expect(gaugeOf(limit('five_hour', 70, inHour), NOW)?.tone).toBe('warn')
    expect(gaugeOf(limit('five_hour', 69, inHour), NOW)?.tone).toBe('calm')
    expect(gaugeOf(limit('seven_day', 29, inHour), NOW)?.label).toBe('Week')
    expect(gaugeOf(limit('spend_limit', 0, inHour), NOW)?.label).toBe('Spend')
    expect(gaugeOf(limit('other', 0, inHour), NOW)?.label).toBe('other')
    // Exactly at 10 and 30 left, and just past them.
    expect(gaugeOf(limit('five_hour', 89.9, inHour), NOW)?.tone).toBe('warn')
    expect(gaugeOf(limit('five_hour', 69.9, inHour), NOW)?.tone).toBe('calm')
    expect(gaugeOf(limit('five_hour', 100, inHour), NOW)?.tone).toBe('alert')
    expect(gaugeOf(limit('five_hour', 150, inHour), NOW)).toMatchObject({ used: 100, left: 0 })
    // A window with no figure is left out (audit finding 9).
    expect(gaugeOf(limit('five_hour', NaN, inHour), NOW)).toBeNull()
  })

  test('toneOfLeft: alert at 10 left or less, warn at 30 or less, else calm', async () => {
    for (const [left, tone] of [[0, 'alert'], [9.99, 'alert'], [10, 'alert'], [10.01, 'warn'], [29.99, 'warn'], [30, 'warn'], [30.01, 'calm'], [100, 'calm']] as const) expect(`${left}: ${toneOfLeft(left)}`).toBe(`${left}: ${tone}`)
    expect(toneOfLeft(NaN)).toBe('calm')
  })

  test('gaugeOf: a window whose reset time has passed is resetting for ten minutes, then null; copes with no reset time', async () => {
    const ago = (ms: number): Limit => limit('five_hour', 100, new Date(NOW - ms).toISOString())
    for (const ms of [0, MIN, RESETTING_MS]) expect(gaugeOf(ago(ms), NOW)).toEqual({ kind: 'five_hour', label: '5h', used: 100, left: 0, resetIn: null, tone: 'calm', isResetting: true })
    expect(RESETTING_MS).toBe(10 * MIN)
    expect(gaugeOf(ago(RESETTING_MS + 1), NOW)).toBeNull()
    expect(gaugeOf(ago(HOUR), NOW)).toBeNull()
    // A window still running is not resetting.
    expect('isResetting' in (gaugeOf(limit('five_hour', 50, new Date(NOW + 1).toISOString()), NOW) ?? {})).toBe(false)
    expect(gaugeOf(limit('five_hour', 50, null), NOW)).toMatchObject({ resetIn: null, left: 50 })
    expect(gaugeOf(limit('five_hour', 50, 'soon'), NOW)).toMatchObject({ resetIn: null })
  })

  test('gaugeOf labels extra weekly windows by their name', async () => {
    expect(gaugeOf(limit('seven_day_fable', 40, inHour), NOW)).toMatchObject({ kind: 'seven_day_fable', label: 'Week · Fable', left: 60 })
    expect(gaugeOf(limit('seven_day_opus', 0, null), NOW)?.label).toBe('Week · Opus')
    expect(gaugeOf(limit('seven_day_sonnet_5', 0, null), NOW)?.label).toBe('Week · Sonnet 5')
    expect(gaugeOf(limit('seven_day_', 0, null), NOW)?.label).toBe('seven_day_')
    expect(gaugeOf(limit('seven_day_x\u0000y', 0, null), NOW)?.label).toBe('Week · X y')
    expect(gaugeOf(limit('constructor', 0, null), NOW)?.label).toBe('constructor')
    expect(gaugeOf(null as never, NOW)).toBeNull()
    expect(gaugeOf({ percentUsed: 5, resetsAt: null } as never, NOW)).toBeNull()
  })

  test('isModelWeek is true for seven_day_<name> only', async () => {
    expect(isModelWeek('seven_day_fable')).toBe(true)
    expect(isModelWeek('seven_day_opus')).toBe(true)
    expect(isModelWeek('seven_day')).toBe(false)
    expect(isModelWeek('seven_day_')).toBe(false)
    expect(isModelWeek('five_hour')).toBe(false)
    expect(isModelWeek('spend_limit')).toBe(false)
    expect(isModelWeek(undefined as never)).toBe(false)
  })

  test('limitGauges: every reported limit once, 5h, Week, model weeks, Spend, then the rest', async () => {
    const usage = (limits: unknown[]): Usage => ({ ...blankUsage(NOW), limits: limits as Usage['limits'] })
    const kinds = (limits: unknown[]): string[] => limitGauges(usage(limits), NOW).map(g => g.kind)
    expect(
      kinds([
        limit('zeta', 1, null),
        limit('spend_limit', 1, null),
        limit('seven_day_opus', 1, null),
        limit('seven_day', 1, null),
        limit('alpha', 1, null),
        limit('seven_day_fable', 1, null),
        limit('five_hour', 1, null),
      ]),
    ).toEqual(['five_hour', 'seven_day', 'seven_day_fable', 'seven_day_opus', 'spend_limit', 'alpha', 'zeta'])
    // Today's machine: only the two standard windows.
    expect(limitGauges(usage([limit('seven_day', 37, inHour), limit('five_hour', 60, inHour)]), NOW).map(g => g.label)).toEqual(['5h', 'Week'])
    // A window that reset over ten minutes ago is left out, one that reset just now is resetting; a repeated kind counts once, the first reported.
    const past = new Date(NOW - RESETTING_MS - MIN).toISOString()
    expect(kinds([limit('five_hour', 1, past), limit('seven_day', 1, null)])).toEqual(['seven_day'])
    const just = new Date(NOW - MIN).toISOString()
    expect(limitGauges(usage([limit('seven_day', 1, null), limit('five_hour', 1, just)]), NOW).map(g => [g.kind, g.isResetting === true])).toEqual([['five_hour', true], ['seven_day', false]])
    expect(limitGauges(usage([limit('seven_day', 10, null), limit('seven_day', 90, null)]), NOW).map(g => g.used)).toEqual([10])
    expect(kinds([null, 3, { kind: 7 }, limit('five_hour', 1, null)])).toEqual(['five_hour'])
    expect(limitGauges(blankUsage(NOW), NOW)).toEqual([])
    expect(limitGauges({ limits: 'x' } as never, NOW)).toEqual([])
    expect(limitGauges(null as never, NOW)).toEqual([])
  })

  test('contextGauge reads what is used', async () => {
    const u = blankUsage(NOW)
    expect(contextGauge({ ...u, contextPercent: 27 })).toMatchObject({ label: 'Context', used: 27, left: 73, tone: 'calm', resetIn: null })
    // The limits' rule on what is left of the window: warn at 70% used, alert at 90%.
    expect(contextGauge({ ...u, contextPercent: 69.9 }).tone).toBe('calm')
    expect(contextGauge({ ...u, contextPercent: 70 }).tone).toBe('warn')
    expect(contextGauge({ ...u, contextPercent: 85 }).tone).toBe('warn')
    expect(contextGauge({ ...u, contextPercent: 89.9 }).tone).toBe('warn')
    expect(contextGauge({ ...u, contextPercent: 90 }).tone).toBe('alert')
    expect(contextGauge({ ...u, contextTokens: 900_000, contextWindow: 1_000_000 }).tone).toBe('alert')
    expect(contextGauge({ ...u, contextTokens: 500_000, contextWindow: 1_000_000 }).used).toBe(50)
    expect(contextGauge({ ...u, contextTokens: 5, contextWindow: 0 }).used).toBe(0)
    expect(contextGauge(u).used).toBe(0)
  })
})

describe('last known limits', () => {
  const iso = (at: number): string => new Date(at).toISOString()
  const FIVE = { kind: 'five_hour', percentUsed: 60, resetsAt: iso(NOW + 3 * HOUR) }
  const WEEK = { kind: 'seven_day', percentUsed: 37, resetsAt: iso(NOW + 88 * HOUR) }
  const FABLE = { kind: 'seven_day_fable', percentUsed: 81, resetsAt: iso(NOW + 88 * HOUR) }

  test('freshLimits keeps the windows that have not reset yet', async () => {
    expect(freshLimits({ at: NOW - HOUR, limits: [FIVE, WEEK, FABLE] }, NOW)).toEqual([FIVE, WEEK, FABLE])
    // A window that reset, or resets right now, is dropped; so is one with no reset time.
    const passed = { kind: 'five_hour', percentUsed: 99, resetsAt: iso(NOW - MIN) }
    const now = { ...WEEK, resetsAt: iso(NOW) }
    const none = { kind: 'spend_limit', percentUsed: 10, resetsAt: null }
    expect(freshLimits({ at: NOW - 6 * HOUR, limits: [passed, now, none, FABLE] }, NOW)).toEqual([FABLE])
    expect(freshLimits({ at: NOW - 6 * HOUR, limits: [FIVE] }, NOW + 3 * HOUR)).toEqual([])
    // Only the limit's own fields are kept.
    expect(freshLimits({ at: 0, limits: [{ ...FIVE, extra: 'x' }] }, NOW)).toEqual([FIVE])
    // What comes back is what gaugeOf reads.
    expect(limitGauges({ ...blankUsage(NOW), limits: freshLimits({ at: 0, limits: [FABLE, FIVE] }, NOW) }, NOW).map(g => g.label)).toEqual(['5h', 'Week · Fable'])
  })

  test('freshLimits reads junk as none', async () => {
    for (const junk of [undefined, null, 0, 'limits', [], [FIVE], {}, { at: NOW }, { limits: 'x' }, { limits: {} }]) expect(freshLimits(junk, NOW), JSON.stringify(junk)).toEqual([])
    const bad = [
      null,
      3,
      'five_hour',
      { kind: '', percentUsed: 1, resetsAt: FIVE.resetsAt },
      { kind: 7, percentUsed: 1, resetsAt: FIVE.resetsAt },
      { kind: 'five_hour', percentUsed: NaN, resetsAt: FIVE.resetsAt },
      { kind: 'five_hour', percentUsed: '60', resetsAt: FIVE.resetsAt },
      { kind: 'five_hour', percentUsed: 60, resetsAt: 'soon' },
      { kind: 'five_hour', percentUsed: 60, resetsAt: NOW + HOUR },
    ]
    expect(freshLimits({ at: NOW, limits: [...bad, WEEK] }, NOW)).toEqual([WEEK])
    expect(freshLimits({ at: NOW, limits: [FIVE] }, NaN)).toEqual([])
    // Bounded, so a corrupt store cannot grow state.
    expect(freshLimits({ at: NOW, limits: Array.from({ length: 500 }, () => FIVE) }, NOW).length).toBeLessThanOrEqual(20)
  })
})

describe("the desktop app's usage", () => {
  // The answer the app's get_usage tool gave, as text.
  const SAMPLE = JSON.stringify({
    plan: {
      status: 'ok',
      windows: [
        { label: '5-hour limit', percentUsed: 100, resetsAt: '2026-11-14T02:59:59.803Z' },
        { label: 'Weekly · all models', percentUsed: 41, resetsAt: '2026-11-18T09:00:00.000Z' },
        { label: 'Weekly · Fable', percentUsed: 81, resetsAt: '2026-11-18T09:00:00.000Z' },
      ],
    },
  })
  const answer = (windows: unknown[], status: unknown = 'ok'): string => JSON.stringify({ plan: { status, windows } })

  test('appLimits reads the sample: 5-hour, weekly and the Fable week', async () => {
    expect(appLimits(SAMPLE)).toEqual([
      { kind: 'five_hour', percentUsed: 100, resetsAt: '2026-11-14T02:59:59.803Z' },
      { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-11-18T09:00:00.000Z' },
      { kind: 'seven_day_fable', percentUsed: 81, resetsAt: '2026-11-18T09:00:00.000Z' },
    ])
    // What gaugeOf makes of them: the Fable week is labelled by name.
    const now = Date.parse('2026-11-14T00:00:00Z')
    expect(limitGauges({ ...blankUsage(now), limits: appLimits(SAMPLE) }, now).map(g => g.label)).toEqual(['5h', 'Week', 'Week · Fable'])
  })

  test('appLimits: other weekly names, extra labels ignored, each kind once', async () => {
    expect(
      appLimits(
        answer([
          { label: 'Weekly · Opus 5', percentUsed: 10, resetsAt: null },
          { label: 'weekly · SONNET-5.5', percentUsed: 20, resetsAt: 'soon' },
          { label: 'Monthly spend', percentUsed: 5, resetsAt: null },
          { label: 'Extra usage', percentUsed: 5 },
          { label: '5-hour limit', percentUsed: 30 },
          { label: '5-hour limit', percentUsed: 99 },
          { label: 'Weekly · ', percentUsed: 1 },
          { label: 'Weekly · !!!', percentUsed: 1 },
        ]),
      ),
    ).toEqual([
      { kind: 'seven_day_opus_5', percentUsed: 10, resetsAt: null },
      { kind: 'seven_day_sonnet_5_5', percentUsed: 20, resetsAt: null },
      { kind: 'five_hour', percentUsed: 30, resetsAt: null },
    ])
    // Windows without a usable label or figure are skipped, the rest kept.
    expect(appLimits(answer([null, 3, 'x', { label: 7, percentUsed: 1 }, { label: '5-hour limit', percentUsed: '50' }, { label: '5-hour limit', percentUsed: NaN }, { label: 'Weekly · Fable', percentUsed: 12 }]))).toEqual([
      { kind: 'seven_day_fable', percentUsed: 12, resetsAt: null },
    ])
  })

  test('appLimits: junk, a non-ok status or unparseable text give none, and it never throws', async () => {
    const junk: unknown[] = [
      '',
      'not json',
      '{"plan":',
      'null',
      '42',
      '"text"',
      '[]',
      '{}',
      JSON.stringify({ plan: null }),
      JSON.stringify({ plan: { status: 'ok' } }),
      JSON.stringify({ plan: { status: 'ok', windows: {} } }),
      JSON.stringify({ windows: [{ label: '5-hour limit', percentUsed: 1 }] }),
      answer([{ label: '5-hour limit', percentUsed: 1, resetsAt: null }], 'error'),
      answer([{ label: '5-hour limit', percentUsed: 1, resetsAt: null }], 'OK '),
      answer([{ label: '5-hour limit', percentUsed: 1, resetsAt: null }], null),
      undefined,
      null,
      42,
      {},
      ['x'],
    ]
    for (const j of junk) expect(appLimits(j as string), String(j)).toEqual([])
    // Bounded, so a long answer cannot grow state.
    expect(appLimits(answer(Array.from({ length: 500 }, (_, i) => ({ label: `Weekly · M${i}`, percentUsed: 1 })))).length).toBeLessThanOrEqual(20)
  })

  test("mergeLimits: the engine's kinds win, in its order; the app adds the kinds it lacks", async () => {
    const e5 = { kind: 'five_hour', percentUsed: 60, resetsAt: null }
    const e7 = { kind: 'seven_day', percentUsed: 37, resetsAt: null }
    const app = appLimits(SAMPLE)
    expect(mergeLimits([e7, e5], app)).toEqual([e7, e5, { kind: 'seven_day_fable', percentUsed: 81, resetsAt: '2026-11-18T09:00:00.000Z' }])
    expect(mergeLimits([], app)).toEqual(app)
    expect(mergeLimits([e5], [])).toEqual([e5])
    // The app's own repeats count once; junk on either side is skipped.
    const fable = { kind: 'seven_day_fable', percentUsed: 1, resetsAt: null }
    expect(mergeLimits([e5, null, { kind: 3 }] as never, [fable, { ...fable, percentUsed: 99 }, null, 'x'] as never)).toEqual([e5, fable])
    for (const a of [undefined, null, 'x', 42, {}]) {
      expect(mergeLimits(a as never, app)).toEqual(app)
      expect(mergeLimits(app, a as never)).toEqual(app)
    }
    // A new array; the inputs are left as they were.
    const engine = [e5]
    expect(mergeLimits(engine, app)).not.toBe(engine)
    expect(engine).toEqual([e5])
  })
})

describe('pill colours', () => {
  test('meters by tone at every tone, cache by the tone given, the rest by the accent', async () => {
    for (const palette of PALETTE_NAMES) {
      const s = { ...DEFAULT_SETTINGS, palette }
      const p = PALETTES[palette]
      for (const kind of ['context', 'limit', 'cache'] as const) {
        expect(pillColor(kind, 'calm', s)).toBe(p.calm)
        expect(pillColor(kind, 'warn', s)).toBe(p.warn)
        expect(pillColor(kind, 'alert', s)).toBe(p.alert)
        expect(pillColor(kind, undefined, s)).toBe(p.calm)
      }
      for (const kind of ['speed', 'turn', 'time'] as const) for (const tone of ['calm', 'warn', 'alert', undefined] as const) expect(pillColor(kind, tone, s)).toBe(p.accent)
    }
    expect(pillColor('limit', 'alert', null as never)).toBe(PALETTES.ocean.alert)
  })
})

describe('activityOf', () => {
  const CASES: [string, Record<string, unknown>, string][] = [
    ['Bash', { description: 'Run the tests', command: 'npm test' }, 'Run the tests'],
    ['Bash', { command: 'npm test' }, 'Running npm test'],
    ['PowerShell', {}, 'Running a command'],
    ['Read', { file_path: 'C:\\Users\\me\\hooks\\register.tsx' }, 'Reading register.tsx'],
    ['Read', { file_path: '/home/me/hooks/model.ts' }, 'Reading model.ts'],
    ['Read', { file_path: '/home/me/hooks/' }, 'Reading hooks'],
    ['Read', {}, 'Reading a file'],
    ['Edit', { file_path: 'hooks/draw.ts' }, 'Editing draw.ts'],
    ['Write', { file_path: 'C:/x/README.md' }, 'Writing README.md'],
    ['NotebookEdit', { notebook_path: '/n/a.ipynb' }, 'Editing a.ipynb'],
    ['Grep', { pattern: 'roleOf' }, 'Searching for "roleOf"'],
    ['Glob', { pattern: '**/*.ts' }, 'Finding files **/*.ts'],
    ['WebFetch', { url: 'https://user@docs.example.com:8080/a?b=1' }, 'Fetching docs.example.com:8080'],
    ['WebFetch', { url: 'not a url' }, 'Fetching not a url'],
    ['WebSearch', { query: 'pixel art' }, 'Searching the web for "pixel art"'],
    ['Agent', { description: 'Write sprites' }, 'Running an agent: Write sprites'],
    ['Task', { description: 'Write sprites' }, 'Running an agent: Write sprites'],
    ['TodoWrite', { todos: [] }, 'Updating the todo list'],
    ['AskUserQuestion', {}, 'Waiting for your answer'],
    ['Skill', { skill: 'pdf' }, 'Using the pdf skill'],
    ['ToolSearch', { query: 'select:Read' }, 'Looking up tools: select:Read'],
    ['ToolSearch', {}, 'Looking up tools'],
    ['mcp__github__create_issue', {}, 'Using github: create_issue'],
    ['mcp__CPixelCrew__progress', {}, 'Using CPixelCrew: progress'],
    ['mcp__srv__a__b', {}, 'Using srv: a__b'],
    ['mcp__', {}, 'Using a tool'],
    ['FancyTool', { x: 1 }, 'Using FancyTool'],
    ['', {}, 'Using a tool'],
  ]
  for (const [tool, args, shown] of CASES) {
    test(`${tool || '(empty)'} ${JSON.stringify(args)} reads "${shown}"`, async () => {
      expect(activityOf(tool, args)).toBe(shown)
    })
  }

  test('labels are printable, one line and at most 80 characters', async () => {
    expect(activityOf('Bash', { description: 'a\nb\u0007c\u200Bd' })).toBe('a b cd')
    expect(activityOf('Read', { file_path: `/${'d'.repeat(300)}/end.ts` })).toBe('Reading end.ts')
    expect(activityOf('Read', null as never)).toBe('Reading a file')
    expect(activityOf('Grep', { pattern: 42 })).toBe('Searching files')
    const long = 'x'.repeat(300)
    for (const tool of ['Bash', 'Read', 'Grep', 'WebSearch', 'Agent', 'Skill', `mcp__${long}__${long}`, long]) {
      const label = activityOf(tool, { description: long, command: long, file_path: long, pattern: long, query: long, skill: long })
      expect(label.length, tool.slice(0, 20)).toBeLessThanOrEqual(80)
      expect(UNPRINTABLE.test(label)).toBe(false)
    }
    expect(activityOf(`mcp__${long}__x`, {})).toEndWith('…')
  })
})

describe('streamed input', () => {
  test('partialArgsOf reads string arguments from partial JSON', async () => {
    expect(partialArgsOf('{"file_path": "C:\\\\Users\\\\a.ts", "old_str')).toEqual({ file_path: 'C:\\Users\\a.ts' })
    expect(partialArgsOf('{"command": "echo hi')).toEqual({ command: 'echo hi' })
    expect(partialArgsOf('{"description": "caf\\u00')).toEqual({ description: 'caf' })
    expect(partialArgsOf('{"description": "caf\\u00e9"')).toEqual({ description: 'café' })
    expect(partialArgsOf('{"limit": 5, "path": "x", "path": "y"}')).toEqual({ path: 'x' })
    expect(partialArgsOf('{"subagentType": "Explore"')).toEqual({ subagentType: 'Explore' })
    expect(partialArgsOf('')).toEqual({})
    expect(partialArgsOf('not json at all')).toEqual({})
    expect(partialArgsOf(undefined as never)).toEqual({})
  })

  test('thoughtOf keeps the latest sentence, cut from the front', async () => {
    expect(thoughtOf('')).toBe('')
    expect(thoughtOf('I will read the spec first. Then edit it.')).toBe('I will read the spec first. Then edit it.')
    expect(thoughtOf('First I read. Now the model module needs its pricing table checked.')).toBe(
      'Now the model module needs its pricing table checked.',
    )
    expect(thoughtOf('**Plan**: go\nnow')).toBe('Plan: go now')
    const long = thoughtOf('word '.repeat(40))
    expect(long.length).toBe(70)
    expect(long).toStartWith('…')
    expect(UNPRINTABLE.test(thoughtOf('a\u0000b\u200Fc'))).toBe(false)
  })
})

describe('logs', () => {
  test('pushLog keeps the newest entries up to the cap, 400 by default', async () => {
    let log: LogEntry[] = []
    for (let i = 0; i < 405; i++) log = pushLog(log, entry(i, 'ok'))
    expect(log).toHaveLength(400)
    expect(log[0]?.at).toBe(5)
    expect(log.at(-1)?.at).toBe(404)
    expect(pushLog(log, entry(999), 3).map(e => e.at)).toEqual([403, 404, 999])
    expect(pushLog([], entry(1), 0)).toHaveLength(1)
    expect(pushLog([], entry(1), NaN)).toHaveLength(1)
  })

  test('closeLog closes the newest open entry and sets its duration', async () => {
    const log = [entry(1000), entry(1500, 'ok'), entry(2000), entry(2500, 'error')]
    const closed = closeLog(log, 3500, 'denied')
    expect(closed[2]).toEqual({ at: 2000, kind: 'tool', text: 'e2000', outcome: 'denied', ms: 1500 })
    expect(closed[0]?.outcome).toBe('open')
    expect(log[2]?.outcome).toBe('open')
    expect(closeLog(closed, 4000, 'ok')[0]).toMatchObject({ outcome: 'ok', ms: 3000 })
    const none = [entry(1, 'ok')]
    expect(closeLog(none, 5, 'ok')).toBe(none)
    expect(closeLog([entry(10)], 5, 'ok')[0]?.ms).toBe(0)
  })
})

describe('totals and blanks', () => {
  const main: MainRun = { ...blankMain(0), use: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, costUsd: 0.5 }
  const agents = [
    run({ costUsd: 0.25, use: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 } }),
    run({ costUsd: 0.1, use: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 } }),
  ]
  const usage: Usage = { ...blankUsage(1000), sessionStartedAt: 1000 }

  test('without engine cost: the estimate is main plus agents', async () => {
    const t = totals(main, agents, usage, 61_000)
    near(t.costUsd, 0.85)
    expect(t.isEstimate).toBe(true)
    expect(t.use).toEqual({ input: 111, output: 22, cacheRead: 33, cacheWrite: 44 })
    expect(t.tokens).toBe(210)
    expect(t.timeMs).toBe(60_000)
    expect(main.use.input).toBe(1)
  })

  test("with engine cost: the engine's figure, not an estimate", async () => {
    const t = totals(main, agents, { ...usage, costUsd: 2 }, 500)
    expect(t.costUsd).toBe(2)
    expect(t.isEstimate).toBe(false)
    expect(t.timeMs).toBe(0)
    expect(totals(blankMain(0), [], { ...usage, costUsd: 0 }, 1000)).toMatchObject({ costUsd: 0, isEstimate: false, tokens: 0 })
  })

  test('mainWorkedMs adds the open turn', async () => {
    const m = { ...blankMain(0), workedMs: 1000 }
    expect(mainWorkedMs(m, 8000)).toBe(1000)
    expect(mainWorkedMs({ ...m, turnStartedAt: 5000 }, 8000)).toBe(4000)
    expect(mainWorkedMs({ ...m, turnStartedAt: 9000 }, 8000)).toBe(1000)
  })

  test('blank state is empty and stamped with the time given', async () => {
    const m = blankMain(42)
    expect(m).toMatchObject({ status: 'resting', doingSince: 42, turns: 0, turnStartedAt: null, workedMs: 0, costUsd: 0, log: [] })
    expect(blankUsage(42)).toMatchObject({ at: 42, sessionStartedAt: 42, limits: [], costUsd: null, speed: null, cacheExpiresAt: null })
    expect(blankView()).toEqual({
      isCompact: false,
      isDoneCollapsed: false,
      openLogs: [],
      isBarCollapsed: false,
      autoOpenedFor: '',
      paneOpenedAt: 0,
      barToggledAt: 0,
    })
    // Each call is a fresh object, so state never shares arrays.
    expect(blankMain(0).log).not.toBe(blankMain(0).log)
    expect(blankView()).not.toBe(blankView())
  })
})

describe('normalizeView', () => {
  test('junk gives the blank view', async () => {
    for (const junk of [null, undefined, 'x', 3, [], {}]) expect(normalizeView(junk)).toEqual(blankView())
  })

  test('a v1 view keeps its open logs', async () => {
    const v = normalizeView({ isCompact: true, isDoneCollapsed: true, openLogs: ['main', 'a1'], isBarCollapsed: true, autoOpenedFor: 'flow' })
    expect(v).toEqual({ ...blankView(), isCompact: true, isDoneCollapsed: true, openLogs: ['main', 'a1'], isBarCollapsed: true, autoOpenedFor: 'flow' })
    expect(Object.keys(v).sort()).toEqual(Object.keys(blankView()).sort())
  })

  test("a v2 view's logFor becomes no open logs", async () => {
    const v = normalizeView({ isCompact: true, logFor: 'a1', paneOpenedAt: 5, barToggledAt: 9 })
    expect(v).toEqual({ ...blankView(), isCompact: true, openLogs: [], paneOpenedAt: 5, barToggledAt: 9 })
    expect(Object.keys(v)).not.toContain('logFor')
  })

  test('field by field defaults for bad values', async () => {
    expect(
      normalizeView({ isCompact: 'yes', isDoneCollapsed: 1, openLogs: 'main', isBarCollapsed: null, autoOpenedFor: {}, paneOpenedAt: NaN, barToggledAt: '5' }),
    ).toEqual(blankView())
    expect(normalizeView({ openLogs: ['main', 3, null, 'a1', 'main'] }).openLogs).toEqual(['main', 'a1'])
    const good = { isCompact: true, isDoneCollapsed: false, openLogs: ['a1'], isBarCollapsed: true, autoOpenedFor: 'x', paneOpenedAt: 5, barToggledAt: 9 }
    expect(normalizeView(good)).toEqual(good)
    expect(normalizeView(normalizeView(good))).toEqual(good)
    // A fresh array each time, so state never shares it.
    expect(normalizeView(good).openLogs).not.toBe(good.openLogs)
    expect(blankView().openLogs).not.toBe(blankView().openLogs)
  })
})

// Settings sit in `$.state`, which holds JSON: what normalizeSettings returns must survive it.
test('settings survive a JSON round trip unchanged', async () => {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    theme: 'cat',
    palette: 'sunset',
    background: 'grid',
    currency: 'KRW',
    textSize: 133,
    iconSize: 250,
    barSize: 80,
    barItems: ['fiveHour', 'turn', 'time'],
    logLines: 99,
    animations: false,
    barTooltips: false,
  }
  expect(normalizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
})

describe('the plugin name', () => {
  test('is CPixelCrew', () => {
    expect(PLUGIN).toBe('CPixelCrew')
  })
})
