// The run view's decided details (1.6.0): which agent titles a run, what the bar shows
// between runs, when the fill may drop, stuck agents, loops set by the clock, stale
// plans, waiting agents, and where the mascots sit. run-progress.test.ts holds the
// reproductions; this file pins the choices made around them.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, Flow, Run } from '../types'
import { agentDrawing, collapsedDrawing, compactAgentDrawing, compactCardDrawing, compactMainDrawing, loopAnchors, mainDrawing, plannedDrawing, progressDrawing } from '../hooks/draw'
import {
  DEFAULT_SETTINGS,
  FALLBACK_RATES,
  closedRun,
  FLOW_DONE,
  PLAN_STALE_MS,
  STUCK_MS,
  blankMain,
  blankUsage,
  creepOf,
  heldRun,
  joinRun,
  runQuiet,
  partialOf,
  planApplies,
  runCounts,
} from '../hooks/model'
import { spriteCss } from '../hooks/sprites'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const STEP = 'mcp__CPixelCrew__step'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const SURFACES = ['desktop', 'terminal'] as const
type Surface = (typeof SURFACES)[number]

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}

// What `agent.list` answers: a test sets it as the engine's own list would read.
type Listed = { id: string; status: string; description: string; type: string }

// What a test watches beneath the plugin: each prompt that reached the bottom and each
// state read, in order; `isStateBroken` makes every state read and write fail.
type Seen = { events: string[]; isStateBroken: boolean }

// Everything beneath the plugin, as run-progress.test.ts answers it.
async function boot($: Engine, on: On): Promise<{ clock: ReturnType<typeof mock.clock>; listed: Listed[]; seen: Seen }> {
  const stored: Record<string, unknown> = {}
  const seen: Seen = { events: [], isStateBroken: false }
  for (const event of ['state.get', 'state.set'] as const) {
    on(event, ((_$: unknown, e: unknown, next: (x: unknown) => unknown) => {
      seen.events.push(event)
      if (seen.isStateBroken) throw new Error('no state on this host')
      return next(e)
    }) as never)
  }
  const clock = mock.clock(on, { now: T0 })
  clocks.set($, clock)
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
  on('config.set', ((_$: unknown, e: { value: unknown }) => ({ value: e.value })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } })) as never)
  on('command.register', ((_$: unknown, e: { name: string }) => ({ value: { command: e.name } })) as never)
  on('session.usage', (() => ({ value: USAGE })) as never)
  on('session.model', (() => ({ value: 'claude-opus-5-5' })) as never)
  // The session draws on a surface, so panes can be opened (none in a headless run).
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
  on('prompt.submit', ((_$: unknown, e: { text: string }) => {
    seen.events.push('prompt')
    return { text: `entered: ${e.text}` }
  }) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  return { clock, listed, seen }
}

async function userTurn($: Engine, text = 'Go on', turnId = 't1', origin: Record<string, unknown> = { kind: 'composer' }): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin } as never)
  await $.turn.start({ text, turnId } as never)
}

async function endMainTurn($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId, reason: 'answer' } as never)
}

async function spawnWorkflowAgent($: Engine, n: number, description: string): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: 'tw1',
    prompt: `Do: ${description}.`,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    workflow: { runId: 'wf_1', agentIndex: n },
  } as never)
}

async function spawnCrew($: Engine, n: number, description: string): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: `tu${n}`,
    prompt: `Do this: ${description}.`,
    description,
    subagentType: 'pixel-crew:engineer',
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
}

async function endAgent($: Engine, agentId: string): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason: 'answer' } as never)
}

// 2.5.0 (A5): the pane and the bar draw from frames, written at most once a second, the
// trailing one 1,000 ms after the write before. A drawing is read after the clock moved one
// second, so the frame for every event before it has landed.
const clocks = new WeakMap<Engine, ReturnType<typeof mock.clock>>()
async function framed<T>($: Engine, mount: () => Promise<T>): Promise<T> {
  await clocks.get($)?.advance(1_000)
  const ui = await mount()
  await clocks.get($)?.settle()
  return ui
}

const band = ($: Engine, surface: Surface) => framed($, () => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS as never }))
const pane = ($: Engine, surface: Surface) => framed($, () => $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never }))

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

async function barWords($: Engine, surface: Surface): Promise<string> {
  const bar = await band($, surface)
  const text = await words(bar)
  await bar.unmount()
  return text
}

async function paneWords($: Engine, surface: Surface): Promise<string> {
  const p = await pane($, surface)
  const text = await words(p)
  await p.unmount()
  return text
}

// The desktop progress row's drawing (the bar's first Svg) and the percent it prints.
async function progressSvg($: Engine): Promise<string> {
  const bar = await band($, 'desktop')
  const svg = (await bar.findAll({ type: 'Svg' }))[0]
  await bar.unmount()
  return String(svg?.props.source)
}
const percentOf = (source: string): number => {
  const m = source.match(/>(\d{1,3})%</)
  return m ? Number(m[1]) : -1
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

for (const surface of SURFACES) {
  test(`${surface}: decision 1, the run is titled by the newest agent still active, else by the newest`, async ($, on) => {
    const { clock } = await boot($, on)
    await userTurn($)
    await spawnWorkflowAgent($, 1, 'Alpha job')
    await clock.advance(1_000)
    await spawnWorkflowAgent($, 2, 'Bravo job')
    const both = await barWords($, surface)
    expect(both).toContain('Bravo job')
    expect(both).not.toContain('Alpha job')
    // The newest ends: the one still at work titles the run.
    await endAgent($, 'a2')
    const one = await barWords($, surface)
    expect(one).toContain('Alpha job')
    expect(one).not.toContain('Bravo job')
    expect(one).toContain('Agents 1/2')
    // Every agent is over: the newest titles it again.
    await endAgent($, 'a1')
    const over = await barWords($, surface)
    expect(over).toContain('Bravo job')
    expect(over).toContain('Agents 2/2')
  })

  test(`${surface}: decision 2, between runs the ended run stays shown done and full until a fresh plan arrives`, async ($, on) => {
    await boot($, on)
    await userTurn($, 'First job')
    await spawnWorkflowAgent($, 1, 'first: one')
    await endAgent($, 'a1')
    await endMainTurn($)
    await userTurn($, 'Second job', 't2')
    const between = await barWords($, surface)
    expect(between).toContain('Agents 1/1')
    expect(between).toContain('100%')
    expect(between).not.toContain('Paused')
    expect(between).not.toContain('No task yet')
    if (surface === 'desktop') expect(between).toContain(FLOW_DONE)
    // A fresh plan takes the bar over.
    await $.tool.call(PLAN as never)
    const planned = await barWords($, surface)
    expect(planned).toContain('Tasks 0/2')
    expect(planned).not.toContain('Agents 1/1')
  })

  test(`${surface}: decision 2, a prompt from a notification or a /crew command does not end the run`, async ($, on) => {
    await boot($, on)
    await userTurn($, 'First job')
    await spawnWorkflowAgent($, 1, 'first: one')
    await endAgent($, 'a1')
    await endMainTurn($)
    await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } } as never)
    await $.prompt.submit({ text: '/crew bar', wait: false, origin: { kind: 'composer' }, command: { name: 'crew', args: 'bar' } } as never)
    await $.prompt.submit({ text: 'hidden', wait: false, origin: { kind: 'composer' }, isMeta: true } as never)
    await spawnWorkflowAgent($, 2, 'first: two')
    expect(await barWords($, surface)).toContain('Agents 1/2')
  })

  test(`${surface}: decision 6, an agent quiet for 15 minutes counts as over for the run, while the list still shows it`, async ($, on) => {
    const { clock } = await boot($, on)
    await userTurn($)
    await spawnWorkflowAgent($, 1, 'wf: one')
    await spawnWorkflowAgent($, 2, 'wf: two')
    await endAgent($, 'a1')
    expect(await barWords($, surface)).toContain('Agents 1/2')
    await clock.advance(STUCK_MS + 1_000)
    expect(await barWords($, surface)).toContain('Agents 2/2')
    if (surface === 'terminal') expect(await paneWords($, surface)).toContain('WORKING · 1')
    // Nothing live: the next prompt ends the run, and the next agent starts another.
    await endMainTurn($)
    await userTurn($, 'Next', 't2')
    await spawnWorkflowAgent($, 3, 'wf: three')
    expect(await barWords($, surface)).toContain('Agents 0/1')
  })

  test(`${surface}: decision 8, an unfinished plan unreported for 30 minutes gives way to the run; a report brings it back`, async ($, on) => {
    const { clock } = await boot($, on)
    await $.tool.call(PLAN as never)
    await clock.advance(PLAN_STALE_MS + 1_000)
    await userTurn($)
    await spawnWorkflowAgent($, 1, 'other: one')
    const stale = await barWords($, surface)
    expect(stale).toContain('Agents 0/1')
    expect(stale).not.toContain('Tasks 0/2')
    await $.tool.call({ tool: PROGRESS, done: 1 } as never)
    expect(await barWords($, surface)).toContain('Tasks 1/2')
  })

  test(`${surface}: decision 8, a finished plan shows only when it was reported during the current run`, async ($, on) => {
    const { clock } = await boot($, on)
    await $.tool.call({ ...PLAN, finished: true } as never)
    await clock.advance(1_000)
    await userTurn($)
    await spawnWorkflowAgent($, 1, 'later: one')
    const before = await barWords($, surface)
    expect(before).toContain('Agents 0/1')
    expect(before).not.toContain('Ship the thing')
    // Reported again during this run: the finished plan is what the bar shows.
    await clock.advance(1_000)
    await $.tool.call({ ...PLAN, title: 'Ship the next', finished: true } as never)
    const during = await barWords($, surface)
    expect(during).toContain('Ship the next')
    expect(during).toContain('Done')
  })

  test(`${surface}: decision 9, an agent waiting for approval is active: not paused, and counted among the agents`, async ($, on) => {
    const { clock, listed } = await boot($, on)
    await $.tool.call(PLAN as never)
    await userTurn($)
    await spawnCrew($, 1, 'Write the parser')
    await endMainTurn($)
    listed.push({ id: 'a1', status: 'waiting', description: 'Write the parser', type: 'pixel-crew:engineer' })
    await clock.advance(6_000)
    const text = await barWords($, surface)
    expect(text).toContain('Tasks 0/2')
    expect(text).not.toContain('Paused')
    await $.command.run({ command: 'crew', args: 'bar' } as never)
    expect(await barWords($, surface)).toContain('1 agent')
  })
}

test('desktop: decision 5, the fill drops once when an agent joins, then never moves back while the count stays', async ($, on) => {
  await boot($, on)
  await userTurn($, 'Delegate')
  await spawnCrew($, 1, 'Write the parser')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 3, total: 4 } as never)
  expect(percentOf(await progressSvg($))).toBe(75)
  // A second agent joins: three quarters of one task of two. 2.5.0 (A5): each read comes a
  // second after the one before, so the creep may add a point.
  await spawnCrew($, 2, 'Wire the CLI')
  const joined = percentOf(await progressSvg($))
  expect(joined).toBeGreaterThanOrEqual(38)
  expect(joined).toBeLessThanOrEqual(40)
  // The first re-plans to eight steps: its part halves, the bar holds.
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 3, total: 8 } as never)
  const held = percentOf(await progressSvg($))
  expect(held).toBeGreaterThanOrEqual(joined)
  expect(held).toBeLessThanOrEqual(joined + 2)
})

test('desktop: decision 7, a redraw keeps the loops where the clock has them: --pc-t on the root, delays set from it', { options: { theme: 'clawd' } }, async ($, on) => {
  const { clock } = await boot($, on)
  await userTurn($, 'Delegate')
  await spawnCrew($, 1, 'Write the parser')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 4 } as never)
  const first = await progressSvg($)
  await clock.advance(1_000)
  const next = await progressSvg($)
  const tOf = (src: string): number => Number(/--pc-t:-(\d+)ms/.exec(src)?.[1] ?? NaN)
  // 2.5.0 (A5): each read moves the clock a second too, so the second is two seconds on.
  expect(tOf(next) - tOf(first)).toBe(2_000)
  // The twinkle and the mascot's loops take their delay from it; the creep keeps its own.
  expect(next).toContain('.t1{animation-delay:calc(var(--pc-t,0ms) - 700ms)}')
  expect(next).toContain('.cw-work .cw-lb{animation-delay:calc(var(--pc-t,0ms) - 250ms)}')
  expect(next).not.toMatch(/\.pc-creep\{animation-delay:calc/)
  // The panel's rows too.
  expect(await paneWords($, 'desktop')).toMatch(/\.live\{animation-delay:calc\(var\(--pc-t,0ms\) \+ 0ms\)\}/)
})

// ---------------------------------------------------------------------------
// The pure parts.

const at = T0
const agent = (o: Partial<AgentRun> = {}): AgentRun => ({
  id: 'a1',
  agentId: 'a1',
  type: 'general-purpose',
  kind: 'other',
  tint: 0,
  description: 'Do it',
  model: 'claude-haiku-4-5',
  status: 'running',
  startedAt: at,
  contextTokens: 0,
  contextMax: 200_000,
  use: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  steps: 0,
  round: 1,
  doing: 'Getting started',
  doingSince: at,
  log: [],
  ...o,
})

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

describe('the creep and the parts', () => {
  test('creepOf rises toward 0.9 and never past it; partialOf adds it to the steps done', async () => {
    expect(creepOf(0)).toBe(0)
    expect(creepOf(-5)).toBe(0)
    expect(near(creepOf(45_000), 0.9 * (1 - Math.exp(-1)))).toBe(true)
    expect(near(creepOf(1e9), 0.9)).toBe(true)
    expect(partialOf(agent({ stepDone: 1, stepTotal: 4, stepAt: at }), at)).toBe(0.25)
    expect(near(partialOf(agent({ stepDone: 1, stepTotal: 4, stepAt: at }), at + 45_000), (1 + creepOf(45_000)) / 4)).toBe(true)
    // All steps done: no creep past the whole.
    expect(partialOf(agent({ stepDone: 4, stepTotal: 4, stepAt: at }), at + 60_000)).toBe(1)
    // No steps: half a task at most.
    expect(partialOf(agent(), at + 1e9)).toBe(0.5)
    expect(partialOf(agent({ status: 'failed' }), at)).toBe(1)
  })

  test('a stuck agent is over for its run; the title skips no active agent', async () => {
    const run: Run = { startedAt: at, ids: ['a1', 'a2'], high: 0 }
    const list = [agent(), agent({ id: 'a2', agentId: 'a2', description: 'Second', startedAt: at + 1 })]
    expect(runCounts(run, list, at)).toMatchObject({ n: 2, d: 0, title: 'Second' })
    const later = at + 1 + STUCK_MS
    expect(runCounts(run, list, later)).toMatchObject({ n: 2, d: 2 })
    // A missing row (a new plan cleared it) counts as over.
    expect(runCounts(run, [list[0] as AgentRun], at)).toMatchObject({ n: 2, d: 1 })
  })

  test('joinRun starts afresh after an ended run and resets the mark as the count grows; heldRun never lowers it under one key', async () => {
    const first = joinRun(null, 'a1', at)
    expect(first).toEqual({ startedAt: at, ids: ['a1'], high: 0, joinedAt: at })
    const held = heldRun(first, 'run:1', 0.6)
    expect(heldRun(held, 'run:1', 0.2).high).toBe(0.6)
    // A join keeps the mark; the run view's key names the count, so the larger count starts it afresh.
    const grown = joinRun(held, 'a2', at + 1)
    expect(grown).toMatchObject({ ids: ['a1', 'a2'], high: 0.6, highKey: 'run:1', joinedAt: at + 1 })
    expect(heldRun(grown, 'run:2', 0.3).high).toBe(0.3)
    // Under a plan the key does not change with a join: the mark holds.
    const planned = heldRun(first, 'plan:p:3', 0.48)
    expect(heldRun(joinRun(planned, 'a2', at + 1), 'plan:p:3', 0.17).high).toBe(0.48)
    expect(joinRun({ ...grown, endedAt: at + 2 }, 'a3', at + 3)).toEqual({ startedAt: at + 3, ids: ['a3'], high: 0, joinedAt: at + 3 })
  })

  test('planApplies: fresh and unfinished, or finished and reported during the current run', async () => {
    const plan: Flow = { title: 'P', total: 2, done: 0, running: 0, phase: 'delegate', isFinished: false, tasks: [], reportedAt: at }
    const run: Run = { startedAt: at + 10, ids: ['a1'], high: 0 }
    expect(planApplies(plan, null, at + PLAN_STALE_MS)).toBe(true)
    expect(planApplies(plan, null, at + PLAN_STALE_MS + 1)).toBe(false)
    expect(planApplies({ ...plan, reportedAt: undefined }, null, at)).toBe(false)
    expect(planApplies({ ...plan, isFinished: true }, run, at + 20)).toBe(false)
    expect(planApplies({ ...plan, isFinished: true, reportedAt: at + 11 }, run, at + 20)).toBe(true)
    expect(planApplies({ ...plan, isFinished: true }, null, at)).toBe(false)
  })
})

describe('drawings', () => {
  const rates = { at: 0, rates: { ...FALLBACK_RATES }, isLive: false }
  const ctx = { W: 480, now: at, settings: DEFAULT_SETTINGS, rates }
  const runFlow: Flow = { title: 'wf: one', total: 3, done: 2, running: 1, phase: 'delegate', isFinished: false, tasks: [], unit: 'Agents' }

  test('a run reads Agents d/n in every state, done included', async () => {
    expect(progressDrawing(runFlow, 480, DEFAULT_SETTINGS, 'running', 3, 1).source).toContain('Agents 2/3')
    expect(progressDrawing({ ...runFlow, done: 3, isFinished: true }, 480, DEFAULT_SETTINGS, 'done', 3, 0).source).toContain('Agents 3/3')
    const line = collapsedDrawing({ W: 480, now: at, flow: { ...runFlow, done: 3, isFinished: true }, state: 'done', usage: blankUsage(at), main: blankMain(at), settings: DEFAULT_SETTINGS, agentsRunning: 0 })
    expect(line.source).toContain('Agents 3/3')
  })

  test('the creep: dots up to the target grow from the start inside the entrance wrapper, the pill slides, the percent says the start', async () => {
    const src = progressDrawing(runFlow, 480, DEFAULT_SETTINGS, 'running', 3, 1, 10, { start: 0.4, target: 0.5, delayMs: 300 }).source
    expect(src).toMatch(/<g class="pc-grow" style="animation-delay:-10ms"><g class="pc-creep" style="--pc-s:0\.8;animation-delay:-300ms">/)
    expect(src).toMatch(/<g class="pc-creep-x" style="--pc-x:-\d+px;animation-delay:-300ms">/)
    expect(src).toContain('>40%<')
    // No creep when it has nowhere to go.
    expect(progressDrawing(runFlow, 480, DEFAULT_SETTINGS, 'running', 3, 1, undefined, { start: 0.5, target: 0.5, delayMs: 0 }).source).not.toContain('pc-creep')
  })

  test('loopAnchors mirrors looping rules only, delays from the clock', async () => {
    expect(loopAnchors('.a{animation:x 1s steps(1) infinite -.25s}.b{animation:y 1s forwards}.c{animation-duration:2s;animation-delay:-1.3s}@media (x){.a{animation:none}}')).toBe(
      '.a{animation-delay:calc(var(--pc-t,0ms) - 250ms)}.c{animation-delay:calc(var(--pc-t,0ms) - 1300ms)}',
    )
    // Every sprite loop has its mirror.
    for (const theme of ['clawd', 'cat'] as const) expect(loopAnchors(spriteCss(theme)).length).toBeGreaterThan(200)
    // Without the clock a drawing carries none.
    expect(progressDrawing(runFlow, 480, DEFAULT_SETTINGS, 'running', 3, 1).source).not.toContain('--pc-t')
  })

  test('decision 4: mascots sit on whole pixels at the scales they had', async () => {
    const translates = (src: string): string[] => [...src.matchAll(/<g transform="translate\(([^)]*)\) scale\(([\d.]+)\)"/g)].map(m => `${m[1]} ${m[2]}`)
    // Without the hero card (with it, the card sits on whole pixels and the mascot 2K inside it, as below).
    const bare = { ...ctx, settings: { ...DEFAULT_SETTINGS, heroCard: false } }
    for (const t of translates(agentDrawing(bare, agent()).source)) expect(t).toMatch(/^-?\d+,-?\d+ 2\.2$/)
    for (const t of translates(mainDrawing(bare, blankMain(at), 0, blankUsage(at)).source)) expect(t).toMatch(/^-?\d+,-?\d+ 4\.8$/)
    for (const t of translates(progressDrawing(runFlow, 480, DEFAULT_SETTINGS, 'running', 3, 1).source)) expect(t).toMatch(/^-?\d+,-?\d+ 0\.8$/)
    // The hero card (contract-hero-card.md): the card on whole pixels, the mascot exactly 2K in from its corner.
    const carded = { ...ctx, settings: { ...DEFAULT_SETTINGS, heroCard: true } }
    for (const [src, k] of [
      [agentDrawing(carded, agent()).source, 2.2],
      [mainDrawing(carded, blankMain(at), 0, blankUsage(at)).source, 4.8],
    ] as const) {
      const card = /<g class="hero" transform="translate\((-?\d+),(-?\d+)\) scale\(([\d.]+)\)"/.exec(src)
      expect(card?.[3]).toBe(String(k))
      const mascot = translates(src.slice(src.indexOf('</g>', card?.index ?? 0)))[0]?.split(/[ ,]/).map(Number) ?? []
      expect(Math.abs((mascot[0] ?? NaN) - (Number(card?.[1]) + 2 * k)) < 0.006 && Math.abs((mascot[1] ?? NaN) - (Number(card?.[2]) + 2 * k)) < 0.006).toBe(true)
      expect(mascot[2]).toBe(k)
    }
  })
})

// ---------------------------------------------------------------------------
// The review round: the mark under a plan, the prompt first, still drawings, plans
// that settle, the join race, stuck agents that come back, stale planned rows, and a
// plan kept while its tasks run.

const PLAN3 = {
  tool: PROGRESS,
  title: 'Ship three',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', agent: 'engineer' },
    { title: 'Wire the CLI', agent: 'engineer' },
    { title: 'Write the docs', agent: 'writer' },
  ],
}

test('desktop: under a plan, an agent joining never moves the bar back while the plan total stays', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN3 as never)
  await userTurn($, 'Go')
  await spawnCrew($, 1, 'Write the parser')
  await spawnCrew($, 2, 'Wire the CLI')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 3, total: 4 } as never)
  // 2.5.0 (A5): each read comes a second after the one before, so the creep may add a point.
  const before = percentOf(await progressSvg($))
  expect(before).toBeGreaterThanOrEqual(25)
  expect(before).toBeLessThanOrEqual(27)
  // a1 is over before the orchestrator reports it: its part leaves the honest fill, not the bar.
  await endAgent($, 'a1')
  const held = percentOf(await progressSvg($))
  expect(held).toBeGreaterThanOrEqual(before)
  expect(held).toBeLessThanOrEqual(before + 2)
  await spawnCrew($, 3, 'Write the docs')
  const after = await progressSvg($)
  expect(after).toContain('Tasks 0/3')
  expect(percentOf(after)).toBeGreaterThanOrEqual(held)
  expect(percentOf(after)).toBeLessThanOrEqual(held + 2)
})

test('prompt.submit: the prompt goes on first and comes back as next gave it; the run ends after; failing state breaks nothing', async ($, on) => {
  const { seen } = await boot($, on)
  await userTurn($)
  await spawnWorkflowAgent($, 1, 'wf: one')
  await endAgent($, 'a1')
  seen.events.length = 0
  const out = await $.prompt.submit({ text: 'Next', wait: false, origin: { kind: 'composer' } } as never)
  expect(out).toMatchObject({ text: 'entered: Next' })
  // Nothing was read before the prompt went on; the bookkeeping came after it.
  expect(seen.events[0]).toBe('prompt')
  expect(seen.events.slice(1)).toContain('state.get')
  await spawnWorkflowAgent($, 2, 'wf: two')
  expect(await barWords($, 'terminal')).toContain('Agents 0/1')
  seen.isStateBroken = true
  const broken = await $.prompt.submit({ text: 'Again', wait: false, origin: { kind: 'composer' } } as never)
  seen.isStateBroken = false
  expect(broken).toMatchObject({ text: 'entered: Again' })
})

for (const surface of SURFACES) {
  test(`${surface}: a plan that finishes by itself during the run stays shown, Done, though last reported before the run`, async ($, on) => {
    const { clock } = await boot($, on)
    await $.tool.call(PLAN as never)
    await clock.advance(1_000)
    await userTurn($)
    await spawnCrew($, 1, 'Write the parser')
    await spawnCrew($, 2, 'Wire the CLI')
    await endAgent($, 'a1')
    await endAgent($, 'a2')
    const text = await barWords($, surface)
    expect(text).toContain('Ship the thing')
    expect(text).toContain('Done')
    expect(text).not.toContain('Agents 2/2')
  })

  test(`${surface}: decision 6, a stuck agent that works again counts as working, and the fill drops back to its honest value`, async ($, on) => {
    const { clock } = await boot($, on)
    await userTurn($)
    await spawnWorkflowAgent($, 1, 'wf: one')
    await spawnWorkflowAgent($, 2, 'wf: two')
    await endAgent($, 'a1')
    await clock.advance(STUCK_MS + 1_000)
    const stuck = await barWords($, surface)
    expect(stuck).toContain('Agents 2/2')
    expect(stuck).toContain('100%')
    // One tool call: a2 is live again.
    await $.tool.call({ tool: 'Read', agentId: 'a2', file_path: '/repo/README.md' } as never)
    const back = await barWords($, surface)
    expect(back).toContain('Agents 1/2')
    expect(back).toContain('75%')
    await clock.advance(1_000)
    expect(await barWords($, surface)).toContain('75%')
  })

  test(`${surface}: decision 8, an unfinished plan stays while an agent on one of its tasks is active, past 30 minutes unreported`, async ($, on) => {
    const { clock } = await boot($, on)
    await $.tool.call(PLAN as never)
    await userTurn($)
    await spawnCrew($, 1, 'Write the parser')
    await clock.advance(PLAN_STALE_MS + 60_000)
    const long = await barWords($, surface)
    expect(long).toContain('Tasks 0/2')
    expect(long).not.toContain('Agents')
    // Its agent is over and nobody reported: the run takes the bar.
    await endAgent($, 'a1')
    expect(await barWords($, surface)).toContain('Agents 1/1')
  })
}

test('terminal: the planned rows follow the bar: a stale plan has none', async ($, on) => {
  const { clock } = await boot($, on)
  await $.tool.call(PLAN as never)
  expect(await paneWords($, 'terminal')).toContain('PLANNED · 2')
  await clock.advance(PLAN_STALE_MS + 1_000)
  const stale = await paneWords($, 'terminal')
  expect(stale).not.toContain('PLANNED')
  expect(stale).not.toContain('Wire the CLI')
})

describe('the review round, pure', () => {
  test('closedRun leaves a run open when an agent joined after the list was read', async () => {
    const list = [agent({ status: 'done', endedAt: at })]
    const run: Run = { startedAt: at, ids: ['a1', 'a2'], high: 0, joinedAt: at + 5 }
    expect(closedRun(run, list, at, at)).toBe(run)
    expect(closedRun({ ...run, joinedAt: at }, list, at, at)?.endedAt).toBe(at)
  })

  test('heldRun starts the mark afresh when an agent counted stuck is live again, and only then', async () => {
    const run: Run = { startedAt: at, ids: ['a1', 'a2'], high: 1, highKey: 'run:2', quiet: ['a2'] }
    expect(heldRun(run, 'run:2', 0.75, { stuck: [], live: ['a2'] })).toMatchObject({ high: 0.75, quiet: [] })
    expect(heldRun(run, 'run:2', 0.75, { stuck: ['a2'], live: [] }).high).toBe(1)
    // Plan view: no quiet given, the mark holds.
    expect(heldRun(run, 'run:2', 0.75).high).toBe(1)
    const list = [agent(), agent({ id: 'a2', agentId: 'a2', startedAt: at - STUCK_MS, doingSince: at - STUCK_MS })]
    expect(runQuiet(run, list, at)).toEqual({ stuck: ['a2'], live: ['a1'] })
  })

  test('still drawings are byte-identical at two clocks; working ones set their loops by it', async () => {
    const rates = { at: 0, rates: { ...FALLBACK_RATES }, isLive: false }
    const c = (clock: number) => ({ W: 480, now: at, settings: DEFAULT_SETTINGS, rates, clock })
    const done = agent({ status: 'done', endedAt: at + 5_000 })
    const p = { title: 'Wire the CLI', kind: 'refactor' as const, model: '', effort: '', after: [], n: 2 }
    const totals = { costUsd: 0, isEstimate: true, use: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tokens: 0, timeMs: 0 }
    expect(agentDrawing(c(at + 10_000), done).source).toBe(agentDrawing(c(at + 11_000), done).source)
    expect(plannedDrawing(c(at + 10_000), p).source).toBe(plannedDrawing(c(at + 11_000), p).source)
    const resting = blankMain(at)
    expect(mainDrawing(c(at + 10_000), resting, 0, blankUsage(at)).source).toBe(mainDrawing(c(at + 11_000), resting, 0, blankUsage(at)).source)
    expect(compactMainDrawing(c(at + 10_000), resting, null, 0).source).toBe(compactMainDrawing(c(at + 11_000), resting, null, 0).source)
    expect(compactAgentDrawing(c(at + 10_000), done).source).toBe(compactAgentDrawing(c(at + 11_000), done).source)
    expect(compactCardDrawing(c(at + 10_000), totals, blankUsage(at)).source).toBe(compactCardDrawing(c(at + 11_000), totals, blankUsage(at)).source)
    // The idle, paused and done bar rows too.
    const plan: Flow = { title: 'P', total: 2, done: 1, running: 0, phase: 'delegate', isFinished: false, tasks: [] }
    const still: [Flow | null, 'none' | 'paused' | 'done'][] = [
      [null, 'none'],
      [plan, 'paused'],
      [{ ...plan, done: 2, isFinished: true }, 'done'],
    ]
    for (const [f, state] of still) {
      expect(progressDrawing(f, 480, DEFAULT_SETTINGS, state, 2, 0, undefined, undefined, at).source).toBe(
        progressDrawing(f, 480, DEFAULT_SETTINGS, state, 2, 0, undefined, undefined, at + 1_000).source,
      )
    }
    // A working row and the running bar set their loops by the clock.
    expect(agentDrawing(c(at + 10_000), agent()).source).toContain('--pc-t:')
    // A working compact line too, so its mascot's loops do not restart on each redraw.
    expect(compactAgentDrawing(c(at + 10_000), agent()).source).toContain('--pc-t:')
    expect(compactMainDrawing(c(at + 10_000), { ...resting, status: 'working' }, null, 0).source).toContain('--pc-t:')
    expect(progressDrawing(plan, 480, DEFAULT_SETTINGS, 'running', 2, 1, undefined, undefined, at).source).toContain('--pc-t:')
  })
})
