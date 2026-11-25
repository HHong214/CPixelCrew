// Reproductions for the progress bar with no plan, the run of subagents, the creeping
// fill and the frozen sprites. Every test here states the decided behaviour and fails
// on the code as it stands; see the implementation brief for what each one pins.
//
// A run: the subagents started from the first one after the previous run ended, until
// no subagent runs and the person has begun a new turn. With no plan the pill reads
// `Agents d/n` (n started in the run, d finished); with a plan it keeps `Tasks d/n`.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import { progressDrawing } from '../hooks/draw'
import { DEFAULT_SETTINGS } from '../hooks/model'
import { SPRITE_ROLES, sprite } from '../hooks/sprites'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const STEP = 'mcp__CPixelCrew__step'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const SURFACES = ['desktop', 'terminal'] as const
type Surface = (typeof SURFACES)[number]

const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}

// Everything beneath the plugin, as register.test.ts answers it, plus `prompt.submit`.
async function boot($: Engine, on: On): Promise<{ clock: ReturnType<typeof mock.clock> }> {
  const stored: Record<string, unknown> = {}
  const clock = mock.clock(on, { now: T0 })
  clocks.set($, clock)
  const open = new Set<string>()
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
  on('agent.list', (() => ({ value: [] })) as never)
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
  return { clock }
}

// The person types a prompt and the main loop's turn starts with it.
async function userTurn($: Engine, text = 'Go on', turnId = 't1'): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId } as never)
}

async function endMainTurn($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId, reason: 'answer' } as never)
}

// A workflow script's `agent()`: the agent types the user saw left out of the bar.
async function spawnWorkflowAgent($: Engine, n: number, subagentType: string, description: string): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: 'tw1',
    prompt: `Do: ${description}.`,
    description,
    subagentType,
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

async function endAgent($: Engine, agentId: string, reason: 'answer' | 'error' = 'answer'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason } as never)
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

// The desktop progress row's drawing (the first Svg of the bar, before its icons) and the
// percent it prints.
async function progressSvg($: Engine): Promise<string> {
  const bar = await band($, 'desktop')
  const svg = (await bar.findAll({ type: 'Svg' }))[0]
  await bar.unmount()
  expect(svg).toBeDefined()
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
  test(`${surface}: no plan, a workflow's subagents of every type are one run: the total grows as they start, Agents d/n`, async ($, on) => {
    await boot($, on)
    await userTurn($, 'Check the build')
    await spawnWorkflowAgent($, 1, 'general-purpose', 'check: tests')
    expect(await barWords($, surface)).toContain('Agents 0/1')
    await spawnWorkflowAgent($, 2, 'Explore', 'check: audit')
    await spawnWorkflowAgent($, 3, 'web-fetch', 'check: tests, audit, sizes')
    const three = await barWords($, surface)
    expect(three).toContain('Agents 0/3')
    // The newest agent is not a one-task plan of its own.
    expect(three).not.toContain('Tasks 0/1')
    await endAgent($, 'a1')
    await endAgent($, 'a2')
    const two = await barWords($, surface)
    expect(two).toContain('Agents 2/3')
    expect(two).toMatch(/[x×]3/)
  })

  test(`${surface}: no plan, a crew agent started through the Agent tool makes no crew-flow plan; its run ends Agents 1/1`, async ($, on) => {
    await boot($, on)
    await userTurn($, 'Delegate the parser')
    await $.tool.call({ tool: 'Agent', description: 'Write the parser', prompt: 'Write it.', subagent_type: 'pixel-crew:engineer', run_in_background: true } as never)
    await spawnCrew($, 1, 'Write the parser')
    const running = await barWords($, surface)
    expect(running).not.toContain('crew-flow')
    expect(running).toContain('Agents 0/1')
    await endAgent($, 'a1')
    await endMainTurn($)
    const done = await barWords($, surface)
    expect(done).not.toContain('crew-flow')
    expect(done).toContain('Agents 1/1')
  })

  test(`${surface}: a run ends at a new user turn with nothing running; the next subagent starts a new run`, async ($, on) => {
    await boot($, on)
    await userTurn($, 'First job')
    await spawnWorkflowAgent($, 1, 'general-purpose', 'first: one')
    await spawnWorkflowAgent($, 2, 'general-purpose', 'first: two')
    await endAgent($, 'a1')
    // The newest agent of the run fails: the run is over all the same.
    await endAgent($, 'a2', 'error')
    await endMainTurn($)
    expect(await barWords($, surface)).toContain('Agents 2/2')
    await userTurn($, 'Second job', 't2')
    // Between runs the old run is over: it is not left paused (what the bar shows until
    // the next run starts is an open design question, so only that is pinned).
    expect(await barWords($, surface)).not.toContain('Paused')
    await spawnWorkflowAgent($, 1, 'Explore', 'second: one')
    const next = await barWords($, surface)
    expect(next).toContain('Agents 0/1')
    expect(next).toMatch(/[x×]1(?!\d)/)
  })

  test(`${surface}: a background run that spans turns stays one run`, async ($, on) => {
    await boot($, on)
    await userTurn($, 'Run the workflow')
    await spawnWorkflowAgent($, 1, 'general-purpose', 'wf: one')
    await spawnWorkflowAgent($, 2, 'general-purpose', 'wf: two')
    await endAgent($, 'a1')
    await endMainTurn($)
    // The person types again while a2 still runs: the run goes on.
    await userTurn($, 'How is it going?', 't2')
    await spawnWorkflowAgent($, 3, 'general-purpose', 'wf: three')
    expect(await barWords($, surface)).toContain('Agents 1/3')
  })
}

test('desktop: no plan, the fill creeps while an agent works between steps, and never moves backwards', async ($, on) => {
  const { clock } = await boot($, on)
  await userTurn($, 'Delegate')
  await spawnCrew($, 1, 'Write the parser')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 4, note: 'Reading' } as never)
  const first = percentOf(await progressSvg($))
  await clock.advance(60_000)
  const later = percentOf(await progressSvg($))
  // One step of four done, then a minute into the second: past 25% and still under 50%.
  expect(later).toBeGreaterThan(first)
  expect(later).toBeGreaterThan(25)
  expect(later).toBeLessThan(50)
  // The worker re-plans to eight steps: its partial drops to 1/8, the bar does not.
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 8, note: 'Re-planned' } as never)
  expect(percentOf(await progressSvg($))).toBeGreaterThanOrEqual(later)
})

test('desktop: no plan and no steps reported, the creep alone stops at half a task', async ($, on) => {
  const { clock } = await boot($, on)
  await userTurn($, 'Look around')
  await spawnWorkflowAgent($, 1, 'Explore', 'look: around')
  await clock.advance(30_000)
  const half = percentOf(await progressSvg($))
  expect(half).toBeGreaterThan(0)
  await clock.advance(600_000)
  expect(percentOf(await progressSvg($))).toBe(50)
})

test('desktop: with a plan, Tasks d/n stays and the fill takes in the running planned tasks\' steps', async ($, on) => {
  const { clock } = await boot($, on)
  await $.tool.call(PLAN as never)
  await userTurn($, 'Go')
  await spawnCrew($, 1, 'Write the parser')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 2, total: 4, note: 'Half way' } as never)
  await clock.advance(10_000)
  const src = await progressSvg($)
  expect(src).toContain('Tasks 0/2')
  // Half of one task of two, plus a little creep: over 25%.
  expect(percentOf(src)).toBeGreaterThanOrEqual(25)
})

test('desktop: while an agent runs, the progress row animates its fill between redraws (pc-creep, scaleX, forwards)', async ($, on) => {
  await boot($, on)
  await userTurn($, 'Delegate')
  await spawnCrew($, 1, 'Write the parser')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 4 } as never)
  const src = await progressSvg($)
  expect(src).toMatch(/@keyframes pc-creep\{[^}]*scaleX\(/)
  expect(src).toMatch(/pc-creep[^;}"]*forwards|forwards[^;}"]*pc-creep/)
})

test('no sprite sets shape-rendering, so the desktop app runs its animations', async () => {
  for (const theme of ['clawd', 'cat'] as const) {
    for (const role of SPRITE_ROLES) {
      for (const pose of ['work', 'rest', 'wait', 'done', 'planned', 'ride'] as const) {
        expect(`${theme}/${role}/${pose}: ${sprite({ theme, role, pose, x: 0, y: 0, scale: 2 }).includes('shape-rendering')}`).toBe(`${theme}/${role}/${pose}: false`)
      }
    }
  }
  const flow = { title: 'Ship', total: 2, done: 1, running: 0, phase: 'delegate' as const, isFinished: false, tasks: [] }
  expect(progressDrawing(flow, 480, DEFAULT_SETTINGS, 'running', 2, 1).source).not.toContain('crispEdges')
})
