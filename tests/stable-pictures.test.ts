// 2.5.0, slice B: stable pictures. A row is two pictures, its mascot and its text (B2); a text
// picture holds no animation (B3); a mascot's source depends only on what it shows and its
// `born` stamp (B4); times step in tens of seconds, then minutes (B1); the progress row is
// rebuilt at most every 10 seconds (B5) with four twinkle groups (B6); a picture carries only
// its own sprite rules (B7); finished and resting pictures hold still a minute after (B10); the
// idle pane counts on once a minute (B11).
//
// Through the wiring: events in, the Svg sources of the pane and the bar out. Through
// hooks/draw.ts directly where one picture's rule is pinned. The draw functions of a row
// (`agentDrawing`, `mainDrawing`, `plannedDrawing`, `compactAgentDrawing`, `compactMainDrawing`)
// return `{ mascot: Drawing; text: Drawing }` in 2.5.0, with their parameters as in 2.4.0 and
// `Ctx.clock` the mascot's `born` stamp; `Row` below names that shape until hooks/draw.ts
// exports it.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, MainRun, Rates, Settings } from '../types'
import { agentDrawing, compactAgentDrawing, compactMainDrawing, mainDrawing, plannedDrawing, progressDrawing } from '../hooks/draw'
import type { Ctx, Drawing } from '../hooks/draw'
import { FALLBACK_RATES, blankMain, blankUsage } from '../hooks/model'
import type { Planned } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
// A whole minute: every time on show starts its step on one.
const T0 = Date.parse('2026-11-13T10:00:00Z')
const MIN = 60_000

// The owner's settings (FACTS.md): theme cat, text 110%, mascots 200%, hero cards on, bar items
// 5-hour, speed and cache, autoOpen any; the pane 50 columns, the bar 100.
const OWNER_OPTIONS = { theme: 'cat', autoOpen: 'any', barContext: false, barWeek: false, barModelWeek: false, barTurn: false, barTime: false }
const OWNER_STORED = { sizes: { textSize: 110, iconSize: 200, barSize: 100, logLines: 50 }, heroCard: true }
const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - MIN,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T14:00:00Z' }],
  cost: { usd: 11.73 },
}
const PLAN = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', agent: 'engineer' },
    { title: 'Wire the CLI', agent: 'engineer' },
  ],
}
// 2.4.0's sizes at the owner's settings, drawn through this file's harness from commit 956cd6d:
// one picture for each row.
const SIZE_240 = { working: 15_918, finished: 12_394, mainWorking: 14_262, mainResting: 12_309 }

type Row = { mascot: Drawing; text: Drawing }
// A row's two pictures, as 2.5.0's draw functions return them.
const rowOf = (d: unknown): Row => d as Row

type Write = { key: string; at: number }
type Listed = { id: string; status: string; description: string; type: string }
type World = { clock: ReturnType<typeof mock.clock>; listed: Listed[]; writes: Write[] }

// Everything beneath the plugin, as frames.test.ts answers it; `stored` is the mod's store at
// load, `junk` what its values hold until the mod writes them.
async function boot($: Engine, on: On, o: { stored?: Record<string, unknown>; junk?: Record<string, unknown> } = {}): Promise<World> {
  const stored: Record<string, unknown> = { ...o.stored }
  const junk: Record<string, unknown> = { ...o.junk }
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  on('state.set', ((_$: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN) {
      writes.push({ key: e.key, at: clock.now() })
      delete junk[e.key]
    }
    return next(e)
  }) as never)
  on('state.get', ((_$: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN && Object.hasOwn(junk, e.key)) return { value: { value: junk[e.key], version: 0 } }
    return next(e)
  }) as never)
  const open = new Set<string>()
  const listed: Listed[] = []
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  } as never)
  on('tool.call', (() => ({ result: 'ok' })) as never)
  on('store.get', ((_$: unknown, e: { key: string }) => ({ value: stored[e.key] })) as never)
  on('store.set', ((_$: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value
    return { value: undefined }
  }) as never)
  on('store.delete', ((_$: unknown, e: { key: string }) => {
    delete stored[e.key]
    return { value: undefined }
  }) as never)
  on('session.id', (() => ({ value: 'sess-1' })) as never)
  on('config.set', ((_$: unknown, e: { value: unknown }) => ({ value: e.value })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } })) as never)
  on('command.register', ((_$: unknown, e: { name: string }) => ({ value: { command: e.name } })) as never)
  on('session.usage', (() => ({ value: USAGE })) as never)
  on('session.model', (() => ({ value: 'claude-opus-5-5' })) as never)
  on('session.surfaces', (() => ({ value: ['desktop'] })) as never)
  on('ui.open', ((_$: unknown, e: { id: string }) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  }) as never)
  on('ui.close', ((_$: unknown, e: { id: string }) => {
    open.delete(e.id)
    return { value: undefined }
  }) as never)
  on('ui.panes', (() => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) })) as never)
  on('ui.toast', (() => ({ value: undefined })) as never)
  on('agent.list', (() => ({ value: listed })) as never)
  on('mcp.call', (() => ({ deny: 'no MCP server named ccd_session_mgmt' })) as never)
  on('http.fetch', (() => ({ value: { status: 503, ok: false, headers: {}, text: '' } })) as never)
  on('agent.spawn', (() => {
    spawned += 1
    return { model: 'claude-haiku-4-5', agentId: `a${spawned}` }
  }) as never)
  on('prompt.submit', ((_$: unknown, e: { text: string }) => ({ text: e.text })) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  return { clock, listed, writes }
}

async function userTurn($: Engine, text = 'Go on', turnId = 't1'): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId } as never)
}

async function endMainTurn($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId, reason: 'answer' } as never)
}

// Spawns agent a<n>, listed as running as the engine's own list would show it.
async function spawnCrew($: Engine, w: World, n: number, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `tu${n}`,
    prompt: `Do this: ${description}.`,
    description,
    subagentType: 'pixel-crew:engineer',
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
  w.listed.push({ id: `a${n}`, status: 'running', description, type: 'pixel-crew:engineer' })
}

async function endAgent($: Engine, w: World, agentId: string): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason: 'answer' } as never)
  const i = w.listed.findIndex(x => x.id === agentId)
  if (i >= 0) w.listed.splice(i, 1)
}

const pane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never })
const band = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS as never })

async function sources(ui: Pick<Mounted, 'findAll'>): Promise<string[]> {
  return (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
}

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

// ---------------------------------------------------------------------------
// Reading pictures.

// The mascot a picture draws: its role and pose, from the sprite's own classes.
const SPRITE = /class="(?:ct|cw) (?:ct|cw)-r-([a-z]+) (?:ct|cw)-([a-z]+)"/
const isMascot = (src: string): boolean => SPRITE.test(src)
const isText = (src: string): boolean => !isMascot(src)
// Any animation: a keyframe, or an animation property other than `animation:none`.
const animates = (src: string): boolean => /@keyframes|animation(?!:\s*none)/.test(src)
const stampOf = (src: string): string => /--pc-t:(-?\d+)ms/.exec(src)?.[1] ?? ''
// Each picture short enough to read in a failure.
const label = (src: string): string => {
  const m = SPRITE.exec(src)
  const said = [...src.matchAll(/>([^<>]{2,40})</g)].map(x => x[1]).slice(0, 3).join(' | ')
  return m ? `mascot ${m[1]} ${m[2]}` : `text "${said}"`
}
// The pictures of `after` that `before` does not hold, byte for byte.
const fresh = (before: string[], after: string[]): string[] => after.filter(s => !before.includes(s))

// Every selector of every style rule, @media bodies included, @keyframes left out.
function selectors(src: string): string[] {
  const css = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  const out: string[] = []
  const walk = (s: string): void => {
    let i = 0
    while (i < s.length) {
      const open = s.indexOf('{', i)
      if (open < 0) break
      let depth = 1
      let j = open + 1
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth += 1
        else if (s[j] === '}') depth -= 1
        j += 1
      }
      const head = s.slice(i, open).trim()
      const body = s.slice(open + 1, j - 1)
      i = j
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(body)
      else if (!head.startsWith('@')) out.push(...head.split(',').map(x => x.trim()))
    }
  }
  walk(css)
  return out
}

// B7: the selectors of a picture that name a role or a pose its own mascot is not (a picture
// with no mascot: any role or pose at all).
function strangers(src: string): string[] {
  const own = SPRITE.exec(src)
  const bad = new Set<string>()
  for (const sel of selectors(src)) {
    for (const m of sel.matchAll(/\.(?:ct|cw)-r-([a-z]+)/g)) if (!own || m[1] !== own[1]) bad.add(sel)
    for (const m of sel.matchAll(/\.(?:ct|cw)-(work|rest|wait|done|planned|ride)\b/g)) if (!own || m[1] !== own[2]) bad.add(sel)
  }
  return [...bad]
}

// The elements of a picture that carry a twinkle class (t0 to t3).
const twinkling = (src: string): number => [...src.matchAll(/<\w+\b[^>]*\bclass="([^"]*)"/g)].filter(m => /(?:^|\s)t[0-3](?:\s|$)/.test(m[1] ?? '')).length

// The elements and strings of a drawn tree, and the deepest nesting.
function treeSize(tree: unknown): { count: number; depth: number } {
  let count = 0
  let depth = 0
  const walk = (x: unknown, d: number): void => {
    if (typeof x === 'string') {
      count += 1
      return
    }
    if (Array.isArray(x)) {
      for (const y of x) walk(y, d)
      return
    }
    if (x === null || typeof x !== 'object') return
    const o = x as Record<string, unknown>
    if (typeof o.type === 'string') {
      count += 1
      depth = Math.max(depth, d + 1)
    }
    const props = (o.props ?? {}) as Record<string, unknown>
    walk(o.children ?? props.children, typeof o.type === 'string' ? d + 1 : d)
  }
  walk(tree, 0)
  return { count, depth }
}

// ---------------------------------------------------------------------------
// The five states of B-d1, each reached from T0 with the pane and the bar mounted; `t` is
// chosen as WORKED.md says: every time on show starts its step on a whole minute, the
// progress row was just rebuilt, the cache pill is at a whole minute an hour from its end.

type State = 'the main agent working alone' | 'the main agent and four working agents' | 'a plan running' | 'a run finished' | 'idle'
const STATES: State[] = ['the main agent working alone', 'the main agent and four working agents', 'a plan running', 'a run finished', 'idle']
const IS_RUNNING: Record<State, boolean> = {
  'the main agent working alone': true,
  'the main agent and four working agents': true,
  'a plan running': true,
  'a run finished': false,
  idle: false,
}

async function reach($: Engine, w: World, state: State): Promise<number> {
  if (state === 'the main agent working alone') {
    await userTurn($)
  } else if (state === 'the main agent and four working agents') {
    await userTurn($)
    for (const n of [1, 2, 3, 4]) await spawnCrew($, w, n, `Task number ${n}`)
  } else if (state === 'a plan running') {
    await $.tool.call(PLAN as never)
    await userTurn($)
    await spawnCrew($, w, 1, 'Write the parser')
    await spawnCrew($, w, 2, 'Wire the CLI')
  } else if (state === 'a run finished') {
    await userTurn($)
    await spawnCrew($, w, 1, 'Write the parser')
    await spawnCrew($, w, 2, 'Wire the CLI')
    await w.clock.advance(MIN)
    await endAgent($, w, 'a1')
    await endAgent($, w, 'a2')
    await endMainTurn($)
  }
  const t = state === 'a run finished' ? T0 + 3 * MIN : T0 + 2 * MIN
  await w.clock.advance(t - w.clock.now())
  await w.clock.settle()
  return t
}

const SETUPS = [
  { who: "the owner's settings", options: OWNER_OPTIONS, stored: OWNER_STORED },
  { who: 'the defaults', options: {}, stored: {} },
] as const

for (const setup of SETUPS)
  for (const state of STATES) {
    test(`B-d1: ${setup.who}, ${state}: every picture is byte-identical at t, t + 1 s and t + 9 s; at t + 60 s only stepped texts, due mascots and the running progress row differ`, { options: setup.options as never, timeoutMs: 60_000 }, async ($, on) => {
      const w = await boot($, on, { stored: { ...setup.stored } })
      const p = await pane($)
      const b = await band($)
      const t = await reach($, w, state)
      const look = async (): Promise<string[]> => [...(await sources(p)), ...(await sources(b))]
      const at0 = await look()
      expect(at0.length).toBeGreaterThan(2)
      await w.clock.advance(1_000)
      expect(fresh(at0, await look()).map(label)).toEqual([])
      await w.clock.advance(8_000)
      const at9 = await look()
      expect(fresh(at0, at9).map(label)).toEqual([])
      expect(at9.length).toBe(at0.length)
      // t + 60 s: what may differ, and what may not.
      await w.clock.advance(t + MIN - w.clock.now())
      await w.clock.settle()
      const at60 = await look()
      const moved = fresh(at0, at60)
      const allowed = (src: string): boolean => isText(src) || (IS_RUNNING[state] && /(?:ct|cw)-(?:work|wait|ride)"/.test(src))
      expect(moved.filter(src => !allowed(src)).map(label)).toEqual([])
      // A held picture never moves: no still mascot is in what differs.
      if (!IS_RUNNING[state]) expect(moved.filter(isMascot).map(label)).toEqual([])
      // The section headings hold no time: each stands.
      for (const heading of at0.filter(s => isText(s) && s.includes('>Main agent<'))) expect(at60.includes(heading)).toBe(true)
      // B11: a finished run's idle pane counts on: the main row reads the minutes since the turn.
      if (state === 'a run finished') expect(at60.join('\n')).toContain('last turn 3m ago')
      // A running state has times that stepped: something moved.
      if (IS_RUNNING[state]) expect(moved.length).toBeGreaterThan(0)
      await p.unmount()
      await b.unmount()
    })
  }

test('B-d1, B1: times step in tens of seconds under a minute, then in whole minutes, then hours and minutes', async () => {
  const rates: Rates = { at: T0, rates: FALLBACK_RATES, isLive: false }
  const settings = { ...DEFAULTS, heroCard: false }
  const c: Ctx = { W: 480, now: T0, settings, rates }
  const agent = (ms: number): AgentRun => ({ ...AGENT, startedAt: T0 - ms })
  const text = (ms: number): string => rowOf(agentDrawing(c, agent(ms))).text.source
  expect(text(3_000)).toMatch(/· 0s</)
  expect(text(37_000)).toMatch(/· 30s</)
  expect(text(59_999)).toMatch(/· 50s</)
  expect(text(92_000)).toMatch(/· 1m</)
  expect(text(59 * MIN + 59_000)).toMatch(/· 59m</)
  expect(text(62 * MIN + 3_000)).toMatch(/· 1h 0?2m</)
  // No ticking time keeps its seconds.
  for (const ms of [92_000, 11 * MIN + 42_000]) expect(text(ms)).not.toMatch(/\d:\d\d</)
  // The main row's worked time too.
  const main: MainRun = { ...blankMain(T0 - 60 * MIN), status: 'working', turns: 1, turnStartedAt: T0 - 11 * MIN - 42_000, workedMs: 0, doing: 'Editing' }
  const mainText = rowOf(mainDrawing(c, main, 0, blankUsage(T0 - 60 * MIN))).text.source
  expect(mainText).toMatch(/· 11m</)
  expect(mainText).not.toMatch(/11:42/)
})

// ---------------------------------------------------------------------------
// B-d1: what moves.

test('B-d1: the first frame after a load: drawn, then byte-identical 1 and 9 seconds on; at 10 s only text pictures step', { options: OWNER_OPTIONS as never }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  await userTurn($)
  await spawnCrew($, w, 1, 'Write the parser')
  const p = await pane($)
  await w.clock.settle()
  const first = await sources(p)
  expect(first.some(isMascot)).toBe(true)
  await w.clock.advance(1_000)
  expect(fresh(first, await sources(p)).map(label)).toEqual([])
  await w.clock.advance(8_000)
  expect(fresh(first, await sources(p)).map(label)).toEqual([])
  // 0s to 10s: the row and the main row step, as text; no mascot is due yet.
  await w.clock.advance(1_000)
  const moved = fresh(first, await sources(p))
  expect(moved.length).toBeGreaterThan(0)
  expect(moved.filter(isMascot).map(label)).toEqual([])
  await p.unmount()
})

test('B-d1: an emptied list: the cleared row’s pictures go, and what stays is byte-identical 1 and 9 seconds on', { options: OWNER_OPTIONS as never }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  await userTurn($)
  await spawnCrew($, w, 1, 'Index the archive')
  await endAgent($, w, 'a1')
  await endMainTurn($)
  const p = await pane($)
  await w.clock.advance(5_000)
  expect((await sources(p)).some(s => s.includes('ct-r-engineer'))).toBe(true)
  // A new plan starts with a clean list.
  await $.tool.call({ ...PLAN, title: 'A fresh plan' } as never)
  await w.clock.advance(1_000)
  const after = await sources(p)
  // Its text and its finished mascot go (the new plan's planned rows wear the engineer's costume too, dimmed).
  expect(after.some(s => s.includes('Index the archive') || /ct-r-engineer ct-done/.test(s))).toBe(false)
  await w.clock.advance(1_000)
  expect(fresh(after, await sources(p)).map(label)).toEqual([])
  await w.clock.advance(8_000)
  expect(fresh(after, await sources(p)).map(label)).toEqual([])
  await p.unmount()
})

// ---------------------------------------------------------------------------
// B-d2: a line changes.

test("B-d2: one working row's line changes: exactly one picture differs, its text picture, under 5,000 characters; its mascot stays the same bytes", { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  const b = await band($)
  await userTurn($)
  for (const n of [1, 2, 3, 4]) await spawnCrew($, w, n, `Task number ${n}`)
  await w.clock.advance(T0 + 2 * MIN + 5_000 - w.clock.now())
  await w.clock.settle()
  const look = async (): Promise<string[]> => [...(await sources(p)), ...(await sources(b))]
  const before = await look()
  await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/parser.ts', agentId: 'a2', tool_use_id: 'tu-read' } as never)
  await w.clock.advance(1_000)
  const after = await look()
  const moved = fresh(before, after)
  expect(moved.map(label)).toHaveLength(1)
  const changed = moved[0] ?? ''
  expect(isText(changed)).toBe(true)
  expect(changed).toContain('Task number 2')
  expect(changed).toContain('parser.ts')
  expect(changed.length).toBeLessThan(5_000)
  // Every mascot is the same bytes as before.
  for (const m of before.filter(isMascot)) expect(after.includes(m) ? 'kept' : label(m)).toBe('kept')
  await p.unmount()
  await b.unmount()
})

test("B-d2: a pose changes: that row's mascot is drawn anew in its new pose, the other mascots stay the same bytes", { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  await userTurn($)
  await spawnCrew($, w, 1, 'Write the parser')
  await spawnCrew($, w, 2, 'Wire the CLI')
  await w.clock.advance(T0 + 2 * MIN + 2_000 - w.clock.now())
  await w.clock.settle()
  const before = await sources(p)
  // a1 waits for approval: the next sync of the agent list says so.
  w.listed[0] = { ...w.listed[0]!, status: 'waiting' }
  await w.clock.advance(6_000)
  const after = await sources(p)
  const mascots = fresh(before, after).filter(isMascot)
  expect(mascots.map(label)).toEqual(['mascot engineer wait'])
  expect(strangers(mascots[0] ?? '')).toEqual([])
  // The main mascot and a2's are the same bytes; a1's working mascot is gone.
  expect(before.filter(isMascot).filter(m => !after.includes(m)).map(label)).toEqual(['mascot engineer work'])
  await p.unmount()
})

// ---------------------------------------------------------------------------
// B-d3: what a picture holds.

for (const state of STATES) {
  test(`B-d3: ${state}: no text picture animates and no picture holds a stranger's sprite rule`, { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
    const w = await boot($, on, { stored: OWNER_STORED })
    const p = await pane($)
    const b = await band($)
    await reach($, w, state)
    const all = [...(await sources(p)), ...(await sources(b))]
    for (const src of all.filter(isText)) expect(animates(src) || src.includes('--pc-t') ? `${label(src)} animates` : 'ok').toBe('ok')
    for (const src of all) expect([label(src), strangers(src).slice(0, 3)]).toEqual([label(src), []])
    await p.unmount()
    await b.unmount()
  })
}

test("B-d3: at the owner's settings a row's two pictures together are smaller than its one picture in 2.4.0: working, finished, the main row working and resting", { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  await userTurn($)
  await spawnCrew($, w, 1, 'Write the parser')
  await spawnCrew($, w, 2, 'Wire the CLI')
  await w.clock.advance(30_000)
  await endAgent($, w, 'a2')
  await w.clock.advance(MIN)
  const pair = (all: string[], said: string, role: string, pose: string): number => {
    const mascot = all.find(s => isMascot(s) && SPRITE.exec(s)?.[1] === role && SPRITE.exec(s)?.[2] === pose) ?? ''
    const text = all.find(s => isText(s) && s.includes(said)) ?? ''
    expect([said, mascot !== '', text !== '']).toEqual([said, true, true])
    return mascot.length + text.length
  }
  const working = await sources(p)
  expect(pair(working, 'Write the parser', 'engineer', 'work')).toBeLessThan(SIZE_240.working)
  expect(pair(working, 'Wire the CLI', 'engineer', 'done')).toBeLessThan(SIZE_240.finished)
  expect(pair(working, '>Claude<', 'main', 'work')).toBeLessThan(SIZE_240.mainWorking)
  await endAgent($, w, 'a1')
  await endMainTurn($)
  await w.clock.advance(2 * MIN)
  expect(pair(await sources(p), '>Claude<', 'main', 'rest')).toBeLessThan(SIZE_240.mainResting)
  await p.unmount()
})

// Drawn directly: every row function, both themes, every pose a row takes.
const DEFAULTS: Settings = {
  theme: 'cat',
  palette: 'classic',
  barColors: 'kind',
  background: 'plain',
  animations: true,
  textSize: 100,
  iconSize: 200,
  barSize: 100,
  currency: 'USD',
  panelUsage: 'bar',
  barUsage: 'bar',
  barItems: ['fiveHour', 'speed', 'cache'],
  autoOpen: 'any',
  logLines: 50,
  barTooltips: true,
  heroCard: true,
}
const AGENT: AgentRun = {
  id: 'r1',
  type: 'pixel-crew:engineer',
  kind: 'refactor',
  tint: 0,
  description: 'Port the progress row',
  model: 'claude-opus-5-5',
  effort: 'high',
  status: 'running',
  startedAt: T0 - 92_000,
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
  doingSince: T0,
  log: [],
} as AgentRun
const PLANNED: Planned = { title: 'Wire the CLI', kind: 'refactor', model: '', effort: '', after: [], n: 2 } as Planned

function everyRow(theme: 'cat' | 'clawd', clock?: number): [string, Row][] {
  const rates: Rates = { at: T0, rates: FALLBACK_RATES, isLive: false }
  const c: Ctx = { W: 480, now: T0, settings: { ...DEFAULTS, theme }, rates, enterAgeMs: 100, ...(clock === undefined ? {} : { clock }) }
  const usage = blankUsage(T0 - 60 * MIN)
  const out: [string, Row][] = []
  for (const status of ['working', 'waiting', 'resting'] as const) {
    const main: MainRun = { ...blankMain(T0 - 60 * MIN), status, turns: 1, turnStartedAt: status === 'resting' ? null : T0 - 42_000, doing: 'Editing' }
    out.push([`main ${status}`, rowOf(mainDrawing(c, main, 1, usage))], [`compact main ${status}`, rowOf(compactMainDrawing(c, main, null, 1))])
  }
  for (const status of ['running', 'waiting', 'done', 'failed'] as const) {
    const a = { ...AGENT, status, ...(status === 'running' || status === 'waiting' ? {} : { endedAt: T0 - 5_000 }) } as AgentRun
    out.push([`agent ${status}`, rowOf(agentDrawing(c, a))], [`compact agent ${status}`, rowOf(compactAgentDrawing(c, a))])
  }
  out.push(['planned', rowOf(plannedDrawing(c, PLANNED))])
  return out
}

test('B-d3: drawn directly, every row is a mascot picture and a text picture; the text holds no animation, @keyframes, --pc-t or sprite; the mascot holds only its own sprite rules', async () => {
  for (const theme of ['cat', 'clawd'] as const)
    for (const [what, r] of everyRow(theme, T0)) {
      const name = `${theme} ${what}`
      expect([name, isMascot(r.mascot.source), isText(r.text.source)]).toEqual([name, true, true])
      expect([name, animates(r.text.source), r.text.source.includes('--pc-t')]).toEqual([name, false, false])
      expect([name, strangers(r.mascot.source).slice(0, 3)]).toEqual([name, []])
      expect([name, strangers(r.text.source).slice(0, 3)]).toEqual([name, []])
      // The row's words are the text picture's, not the mascot's.
      expect([name, r.mascot.source.includes('<text')]).toEqual([name, false])
    }
})

test('B-d3, B4: a mascot picture depends on its looks and its stamp alone: other times, other words, the same bytes', async () => {
  const rates: Rates = { at: T0, rates: FALLBACK_RATES, isLive: false }
  const c = (now: number, clock: number): Ctx => ({ W: 480, now, settings: DEFAULTS, rates, clock })
  const a = AGENT
  const b = { ...AGENT, description: 'Something else', doing: 'Reading x.ts', stepDone: 1, costUsd: 3, startedAt: T0 - 7 * MIN }
  const m1 = rowOf(agentDrawing(c(T0, T0 - 30_000), a)).mascot.source
  const m2 = rowOf(agentDrawing(c(T0 + 45_000, T0 - 30_000), b)).mascot.source
  expect(m2).toBe(m1)
  // Its stamp is `born`: given as the drawing's clock.
  expect(stampOf(m1)).not.toBe('')
  expect(rowOf(agentDrawing(c(T0, T0 - 20_000), a)).mascot.source).not.toBe(m1)
  // A text picture never carries the stamp: the same at two clocks.
  expect(rowOf(agentDrawing(c(T0, T0 - 30_000), a)).text.source).toBe(rowOf(agentDrawing(c(T0, T0 + 9_000), a)).text.source)
})

// ---------------------------------------------------------------------------
// B-d4: the progress row.

test('B-d4: with a plan running and nothing changing, the progress row is byte-identical at t and t + 9 s, and at most four of its elements twinkle', { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const b = await band($)
  await reach($, w, 'a plan running')
  const first = (await sources(b))[0] ?? ''
  expect(first).toContain('Ship the thing')
  expect(twinkling(first)).toBeGreaterThan(0)
  expect(twinkling(first)).toBeLessThanOrEqual(4)
  await w.clock.advance(1_000)
  expect((await sources(b))[0]).toBe(first)
  await w.clock.advance(8_000)
  expect((await sources(b))[0]).toBe(first)
  await b.unmount()
})

test('B-d4, B6: drawn directly, a running and a done progress row each give the twinkle to four groups at most, and keep their dots', async () => {
  const flow = { title: 'Ship the thing', total: 6, done: 3, running: 2, phase: 'delegate', isFinished: false, tasks: [] }
  for (const [f, state] of [
    [flow, 'running'],
    [{ ...flow, done: 6, running: 0, isFinished: true }, 'done'],
  ] as const) {
    const src = progressDrawing(f as never, 700, DEFAULTS, state, 2, state === 'running' ? 2 : 0).source
    expect([state, twinkling(src) > 0 && twinkling(src) <= 4]).toEqual([state, true])
    // The look stays: the dithered dots are all still there.
    expect([state, (src.match(/<rect\b[^>]*width="2" height="2"/g) ?? []).length > 20]).toEqual([state, true])
  }
})

// ---------------------------------------------------------------------------
// B-d5: the largest pane.

for (const [who, options, stored] of [
  ['the smallest text and mascots, no card', {}, { sizes: { textSize: 70, iconSize: 50, barSize: 100, logLines: 50 }, heroCard: false }],
  ["the owner's settings", OWNER_OPTIONS, OWNER_STORED],
] as const) {
  test(`B-d5: ${who}: 70 working agents, logs closed: the pane stays within PANE_BUDGET, every Svg under 131,072 characters, the tree under 1,500 elements and strings`, { options: options as never, timeoutMs: 120_000 }, async ($, on) => {
    const w = await boot($, on, { stored: { ...stored } })
    await userTurn($)
    for (let n = 1; n <= 70; n += 1) await spawnCrew($, w, n, `Task number ${n}`)
    await w.clock.advance(2_000)
    const p = await pane($)
    await w.clock.settle()
    const all = await sources(p)
    expect(all.filter(isMascot).length).toBeGreaterThan(1)
    const total = all.reduce((n, s) => n + s.length, 0)
    expect(total).toBeLessThanOrEqual(120_000)
    for (const s of all) expect(s.length).toBeLessThan(131_072)
    const tree = await p.drawn()
    const size = treeSize(tree)
    expect(size.count).toBeLessThan(1_500)
    expect(size.depth).toBeLessThanOrEqual(32)
    expect(JSON.stringify(tree).length).toBeLessThan(262_144)
    await p.unmount()
  })
}

// ---------------------------------------------------------------------------
// B-d7: finished and resting pictures hold still a minute after.

test("B-d7: 59 seconds after a row finishes its mascot still animates; 60 seconds after it holds none and does not change again", { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  await userTurn($)
  await spawnCrew($, w, 1, 'Write the parser')
  await w.clock.advance(30_000)
  const tf = w.clock.now()
  await endAgent($, w, 'a1')
  const mascotOf = async (): Promise<string> => (await sources(p)).find(s => s.includes('ct-r-engineer')) ?? ''
  await w.clock.advance(59_000)
  const at59 = await mascotOf()
  expect(at59).toContain('ct-done')
  expect(animates(at59)).toBe(true)
  await w.clock.advance(tf + MIN - w.clock.now())
  await w.clock.settle()
  const at60 = await mascotOf()
  expect(at60).toContain('ct-done')
  expect(animates(at60)).toBe(false)
  expect(stampOf(at60)).toBe('')
  await w.clock.advance(2 * MIN)
  expect(await mascotOf()).toBe(at60)
  await p.unmount()
})

test('B-d7: the main row 60 seconds after its turn ended: its resting mascot animates at 59 s, holds none at 60 s, and stays', { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  await userTurn($)
  await w.clock.advance(30_000)
  const te = w.clock.now()
  await endMainTurn($)
  const mascotOf = async (): Promise<string> => (await sources(p)).find(s => s.includes('ct-r-main')) ?? ''
  await w.clock.advance(59_000)
  const at59 = await mascotOf()
  expect(at59).toContain('ct-rest')
  expect(animates(at59)).toBe(true)
  await w.clock.advance(te + MIN - w.clock.now())
  await w.clock.settle()
  const at60 = await mascotOf()
  expect(animates(at60)).toBe(false)
  expect(stampOf(at60)).toBe('')
  await w.clock.advance(3 * MIN)
  expect(await mascotOf()).toBe(at60)
  await p.unmount()
})

test('B-d7: the progress row 60 seconds after its plan finished: it twinkles at 59 s, holds no animation at 60 s, and stays', { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const b = await band($)
  // Reported during the current run, so the bar shows the finished plan (decision 8).
  await userTurn($)
  await $.tool.call(PLAN as never)
  await w.clock.advance(30_000)
  const tp = w.clock.now()
  await $.tool.call({ ...PLAN, done: 2, finished: true } as never)
  const row = async (): Promise<string> => (await sources(b))[0] ?? ''
  await w.clock.advance(59_000)
  const at59 = await row()
  expect(await words(b)).toContain('Done')
  expect(animates(at59)).toBe(true)
  await w.clock.advance(tp + MIN - w.clock.now())
  await w.clock.settle()
  const at60 = await row()
  expect(await words(b)).toContain('Done')
  expect(animates(at60)).toBe(false)
  expect(stampOf(at60)).toBe('')
  await w.clock.advance(2 * MIN)
  expect(await row()).toBe(at60)
  await b.unmount()
})

// ---------------------------------------------------------------------------
// B-d8: the idle pane counts on, once a minute.

test('B-d8: with the pane mounted and nothing running, ten minutes bring at most ten pane frames, a minute apart at least; the main row reads the whole minutes; each mascot stays the same bytes', { options: { ...OWNER_OPTIONS, barCache: false } as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  await userTurn($)
  await endMainTurn($)
  await w.clock.advance(2 * MIN)
  await w.clock.settle()
  const from = w.clock.now()
  const still = (await sources(p)).filter(isMascot)
  expect(still.length).toBeGreaterThan(0)
  for (let m = 3; m <= 12; m += 1) {
    await w.clock.advance(T0 + m * MIN + 1_000 - w.clock.now())
    const all = await sources(p)
    expect(all.join('\n')).toContain(`last turn ${m}m ago`)
    for (const s of still) expect(all.includes(s) ? 'kept' : label(s)).toBe('kept')
  }
  const at = w.writes.filter(x => x.key === 'paneFrame').map(x => x.at)
  const inside = at.filter(x => x > from && x <= from + 10 * MIN)
  expect(inside.length).toBeLessThanOrEqual(10)
  const before = at.filter(x => x <= from).at(-1)
  const seq = [...(before === undefined ? [] : [before]), ...inside]
  expect(seq.slice(1).map((x, i) => x - seq[i]!).filter(g => g < MIN)).toEqual([])
  await p.unmount()
})

// ---------------------------------------------------------------------------
// Carried from the review of slice A.

test('CA-1: the cache pill counts its last five minutes once a second, then one frame shows it expired, and nothing is written after', { timeoutMs: 120_000 }, async ($, on) => {
  const w = await boot($, on)
  const b = await band($)
  await userTurn($)
  await endMainTurn($)
  // The cache was written at T0, for an hour.
  await w.clock.advance(55 * MIN)
  const from = w.clock.now()
  await w.clock.advance(5 * MIN)
  const last5 = w.writes.filter(x => x.key === 'barFrame' && x.at > from && x.at <= from + 5 * MIN).length
  expect(last5).toBeGreaterThanOrEqual(295)
  expect(last5).toBeLessThanOrEqual(301)
  await w.clock.advance(2_000)
  const shown = await words(b)
  expect(shown).toContain('expired')
  expect(shown).not.toMatch(/\b0:0[01]\b/)
  const t = w.clock.now()
  await w.clock.advance(MIN)
  expect(w.writes.filter(x => x.key === 'barFrame' && x.at > t).length).toBe(0)
  expect(await words(b)).toContain('expired')
  await b.unmount()
})

test('CA-2: a usage refresh that changes nothing shown writes no frame', { options: { barCache: false } as never }, async ($, on) => {
  const w = await boot($, on)
  const p = await pane($)
  const b = await band($)
  await userTurn($)
  await endMainTurn($)
  // Mid-minute, well clear of the idle pane's minute and the resting mascot's hold.
  await w.clock.advance(2 * MIN + 20_000)
  await $.session.measure({ ...USAGE, changed: ['rateLimits'] } as never)
  await w.clock.settle()
  const t = w.clock.now()
  await $.session.measure({ ...USAGE, changed: ['rateLimits', 'context'] } as never)
  await w.clock.advance(5_000)
  expect(w.writes.filter(x => (x.key === 'paneFrame' || x.key === 'barFrame') && x.at >= t).map(x => x.key)).toEqual([])
  await p.unmount()
  await b.unmount()
})

test('CA-6: frames compose from nested junk: log entries that are not records, limits that are not a list, a run without ids', async ($, on) => {
  const w = await boot($, on, {
    junk: {
      main: { status: 'working', turnStartedAt: T0 - 5_000, log: [null, 5, 'x', { at: T0 }] },
      agents: [{ id: 'r1', description: 'Junk row', status: 'running', startedAt: T0, log: [null, 7, 'y'] }],
      usage: { limits: 'nope', cacheExpiresAt: T0 + 10 * MIN },
      run: { key: 'run:1', startedAt: T0 },
    },
  })
  const p = await pane($)
  const b = await band($)
  await w.clock.settle()
  await w.clock.advance(1_000)
  expect(w.writes.some(x => x.key === 'paneFrame')).toBe(true)
  expect(w.writes.some(x => x.key === 'barFrame')).toBe(true)
  expect(await words(p)).toContain('Junk row')
  expect(await words(b)).not.toBe('')
  await p.unmount()
  await b.unmount()
})

// ---------------------------------------------------------------------------
// Found in the review of the slice B build.

test('B8: while a turn and an agent work, 9 seconds in which no shown time steps and the progress row is not due write neither frame', { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, { stored: OWNER_STORED })
  const p = await pane($)
  const b = await band($)
  await userTurn($)
  await spawnCrew($, w, 1, 'Write the parser')
  // t: the times on show stepped to 2m, the progress row was just rebuilt; nothing is due before t + 10 s.
  const t = T0 + 2 * MIN
  await w.clock.advance(t - w.clock.now())
  await w.clock.settle()
  await w.clock.advance(9_000)
  expect(w.writes.filter(x => (x.key === 'barFrame' || x.key === 'paneFrame') && x.at > t).map(x => `${x.key} at t + ${x.at - t} ms`)).toEqual([])
  await p.unmount()
  await b.unmount()
})

test('B4: drawn directly beside its text, with hero cards on, at mascots 200% and 150%, a row’s mascot is the same bytes whatever its words and its step bar', async () => {
  const rates: Rates = { at: T0, rates: FALLBACK_RATES, isLive: false }
  for (const iconSize of [200, 150]) {
    const c: Ctx = { W: 480, now: T0, settings: { ...DEFAULTS, heroCard: true, iconSize }, rates, clock: T0 - 30_000 }
    const long = 'Running a long command that wraps over three lines of the row: npx tsc -p tsconfig.json && node tools/check.mjs --all --verbose'
    // Short rows first: there the text's height decides most often how a mascot was centred in 2.4.0.
    const short = { ...AGENT, description: 'Fix', model: '', doing: '', stepTotal: 0, stepDone: 0, stepNote: '' }
    for (const status of ['running', 'done'] as const) {
      const base = { ...short, status, ...(status === 'done' ? { endedAt: T0 - 5_000 } : {}) } as AgentRun
      const rows: [string, AgentRun][] = [
        ['empty doing', base],
        ['one line of doing', { ...base, doing: 'Reading x.ts' }],
        ['long doing', { ...base, doing: long }],
        ['no step bar', base],
        ['a step bar', { ...base, stepTotal: 6, stepDone: 3, stepNote: 'ticks' }],
      ]
      const drawn = rows.map(([what, a]) => [what, rowOf(agentDrawing(c, a))] as const)
      // Side by side at this width: no mascot laid over its text.
      for (const [what, r] of drawn) expect([iconSize, status, what, (r as Row & { over?: boolean }).over === true]).toEqual([iconSize, status, what, false])
      const first = drawn[0]?.[1].mascot.source ?? ''
      for (const [what, r] of drawn) expect([iconSize, status, what, r.mascot.source === first]).toEqual([iconSize, status, what, true])
    }
  }
})

test('B11: with the pane never mounted, ten idle minutes write no pane frame; a pane closed with the bar’s panel button gets none after it is closed', { options: { barCache: false } as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  const b = await band($)
  await userTurn($)
  await endMainTurn($)
  await w.clock.advance(5_000)
  const from = w.clock.now()
  await w.clock.advance(10 * MIN)
  expect(w.writes.filter(x => x.key === 'paneFrame' && x.at > from).map(x => `paneFrame at +${Math.round((x.at - from) / 1000)} s`)).toEqual([])
  // Opened, drawn, then closed with the bar's panel button.
  await $.command.run({ command: 'crew', args: 'open' } as never)
  const p = await pane($)
  await w.clock.advance(2 * MIN)
  await b.press({ key: 'bar-panel' })
  await p.unmount()
  const closed = w.clock.now()
  await w.clock.advance(10 * MIN)
  expect(w.writes.filter(x => x.key === 'paneFrame' && x.at > closed).map(x => `paneFrame at +${Math.round((x.at - closed) / 1000)} s`)).toEqual([])
  await b.unmount()
})
