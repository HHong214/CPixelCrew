// The audit of 1.6.0, carried into 2.0: one proof or more per finding in docs/AUDIT.md
// (test `audit #N` proves finding N), adapted to work kinds and to the decisions of
// SPEC section 2.8. Each states the behaviour the README (or the list price) asks for and
// failed before its fix. Written in the style of register.test.ts / run-progress.test.ts.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import { MAX_DRAWN_ROWS, blankMain, blankRetired, blankUsage, capRows, closeLog, drawnRows, flowSettled, kindName, limitGauges, mergeFlow, mergeLimits, moreLine, normalizeAgent, planKey, plannedOf, priceOf, reopenedFlow, retire, totals, usageSplit } from '../hooks/model'
import type { AgentRun, Flow } from '../types'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const T0 = Date.parse('2026-11-13T10:00:00Z')

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }

const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}
// One model request's usage: Opus 5.5 prices it at $0.30, 273k tokens in all.
const STEP_USAGE = { input_tokens: 12_000, output_tokens: 3_000, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 18_000, model: 'claude-opus-5-5' }

type Gate = { promise: Promise<unknown>; open: (answer: unknown) => void }
type Boot = { clock: ReturnType<typeof mock.clock>; copies: string[]; gates: Map<string, Gate> }
type BootOptions = { usage?: unknown; app?: unknown }

// Everything beneath the plugin, as register.test.ts answers it. A `Read` of a path that has
// a gate waits until the test opens it, so two calls can run at once and end in any order.
async function boot($: Engine, on: On, o: BootOptions = {}): Promise<Boot> {
  const stored: Record<string, unknown> = {}
  const clock = mock.clock(on, { now: T0 })
  clocks.set($, clock)
  const open = new Set<string>()
  const copies: string[] = []
  const gates = new Map<string, Gate>()
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: (e as { usage?: unknown }).usage ?? STEP_USAGE } as never
  } as never)
  on('tool.call', (async (_$: unknown, e: { file_path?: string }) => {
    const gate = typeof e.file_path === 'string' ? gates.get(e.file_path) : undefined
    return gate ? gate.promise : { result: 'file text' }
  }) as never)
  on('store.get', ((_$: unknown, e: { key: string }) => ({ value: stored[e.key] })) as never)
  on('store.set', ((_$: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value
    return { value: undefined }
  }) as never)
  on('config.set', ((_$: unknown, e: { value: unknown }) => ({ value: e.value })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } })) as never)
  on('command.register', ((_$: unknown, e: { name: string }) => ({ value: { command: e.name } })) as never)
  on('session.usage', (() => ({ value: o.usage ?? USAGE })) as never)
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
  on('ui.copy', ((_$: unknown, e: { text: string }) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  }) as never)
  on('ui.toast', (() => ({ value: undefined })) as never)
  on('agent.list', (() => ({ value: [] })) as never)
  on('mcp.call', (() => (o.app === undefined ? { deny: 'no MCP server named ccd_session_mgmt' } : { value: o.app })) as never)
  on('http.fetch', (() => ({ value: { status: 503, ok: false, headers: {}, text: '' } })) as never)
  on('agent.spawn', (() => {
    spawned += 1
    return { model: 'claude-opus-5-5', agentId: `a${spawned}` }
  }) as never)
  on('prompt.submit', ((_$: unknown, e: { text: string }) => ({ text: e.text })) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  return { clock, copies, gates }
}

function gate(): Gate {
  let open: (answer: unknown) => void = () => undefined
  const promise = new Promise<unknown>(resolve => {
    open = resolve
  })
  return { promise, open }
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

const pane = ($: Engine, surface: 'desktop' | 'terminal') => framed($, () => $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never }))
const band = ($: Engine, surface: 'desktop' | 'terminal') => framed($, () => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS as never }))

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}
async function barWords($: Engine, surface: 'desktop' | 'terminal' = 'terminal'): Promise<string> {
  const bar = await band($, surface)
  const text = await words(bar)
  await bar.unmount()
  return text
}
async function paneWords($: Engine, surface: 'desktop' | 'terminal' = 'terminal'): Promise<string> {
  const p = await pane($, surface)
  const text = await words(p)
  await p.unmount()
  return text
}
// The terminal pane's session line: `≈$0.30 · 273k tokens · 1:00`.
async function sessionLine($: Engine): Promise<string> {
  return (await paneWords($)).split(/\r?\n/).find(l => / tokens · /.test(l)) ?? ''
}
// The percent the desktop progress row prints.
async function barPercent($: Engine): Promise<number> {
  const bar = await band($, 'desktop')
  const svg = (await bar.findAll({ type: 'Svg' }))[0]
  await bar.unmount()
  const m = String(svg?.props.source).match(/>(\d{1,3})%</)
  return m ? Number(m[1]) : -1
}

async function userTurn($: Engine, text = 'Go on', turnId = 't1'): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId } as never)
}
async function spawn($: Engine, n: number, description: string, subagentType = 'pixel-crew:engineer'): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: `tu${n}`,
    prompt: `Do this: ${description}.`,
    description,
    subagentType,
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
}
async function agentStep($: Engine, agentId: string, usage: unknown = STEP_USAGE): Promise<void> {
  const stream = $.turn.step({ index: 0, model: 'claude-opus-5-5', messageCount: 1, turnId: `r-${agentId}`, agentId, usage } as never)
  for (let n = await stream.next(); !n.done; n = await stream.next()) {
    // drained
  }
}
async function endAgent($: Engine, agentId: string, reason: 'answer' | 'error' = 'answer'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason } as never)
}

const PLAN = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', kind: 'build' },
    { title: 'Wire the CLI', kind: 'refactor' },
  ],
}

// ---------------------------------------------------------------------------
// #2. Cost estimates: the price table has no Fable 5.2 / Mythos 5.2 row.

test('audit #2: claude-fable-5-2 and claude-mythos-5-2 are priced at Fable 5.2 list prices ($8 / $40, cache reads $0.20)', () => {
  for (const id of ['claude-fable-5-2', 'claude-mythos-5-2', 'claude-fable-5-2[1m]']) {
    const [input, output, cacheRead, cacheWrite] = priceOf(id, 0)
    expect(`${id}: ${input} / ${output} / ${cacheRead} / ${cacheWrite}`).toBe(`${id}: 8 / 40 / 0.2 / 16`)
  }
})

test('audit #2b: a bare family alias is priced as that family\'s current model, not its oldest', () => {
  // `opus` -> Opus 5.5, `sonnet` -> Sonnet 5.5, `haiku` -> Haiku 5.5, `fable[1m]` -> Fable 5.2.
  const want: Record<string, [number, number]> = { opus: [4, 20], sonnet: [2, 10], haiku: [0.1, 0.5], 'fable[1m]': [8, 40], fable: [8, 40] }
  for (const [id, [i, o]] of Object.entries(want)) {
    const [input, output] = priceOf(id, 0)
    expect(`${id}: ${input} / ${output}`).toBe(`${id}: ${i} / ${o}`)
  }
})

// ---------------------------------------------------------------------------
// #1. A plan that settled by itself can never be reopened by the orchestrator.

test('audit #1: after a self-settled plan, a review rejection and re-run is not shown as Done while the re-run works', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await userTurn($, 'Ship it')
  await spawn($, 1, 'Write the parser')
  await spawn($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await endAgent($, 'a2')
  // Both agents answered: the plan settles by itself (README: Done).
  expect(await barWords($)).toContain('Done')
  // The orchestrator reviews, accepts one task only and sends the other back.
  await $.tool.call({ tool: PROGRESS, title: 'Ship the thing', done: 1, phase: 'review' } as never)
  await spawn($, 3, 'Wire the CLI')
  const text = await barWords($)
  // README: Done needs "nothing is still running or waiting"; the tool's `done` is the count accepted after review.
  expect(text).not.toContain('Done')
  expect(text).toContain('1/2')
})

// ---------------------------------------------------------------------------
// #4. Usage limits: a stale engine window hides the app's fresh one.

test('audit #4 (model): where the engine\'s window has reset and the app has a fresh figure, the fresh figure is shown', () => {
  const now = Date.parse('2026-11-13T14:20:00Z')
  // The engine's last figure is from before the reset at 14:00; the app asked at 14:19.
  const engine = [{ kind: 'five_hour', percentUsed: 97, resetsAt: '2026-11-13T14:00:00Z' }]
  const app = [{ kind: 'five_hour', percentUsed: 4, resetsAt: '2026-11-13T19:00:00Z' }]
  const five = limitGauges({ ...blankUsage(now), limits: mergeLimits(engine, app, now) }, now).find(g => g.kind === 'five_hour')
  expect(five?.left).toBe(96)
  expect(five?.isResetting).toBeUndefined()
  // Before the engine's reset time, or with an app window that resets no later, the engine's kind wins.
  expect(mergeLimits(engine, app, Date.parse('2026-11-13T13:59:00Z'))).toEqual(engine)
  expect(mergeLimits(engine, [{ ...app[0]!, resetsAt: '2026-11-13T13:00:00Z' }], now)).toEqual(engine)
  expect(mergeLimits(engine, app)).toEqual(engine)
})

test('audit #4 (wiring): an idle session past a 5-hour reset shows the app\'s fresh 5h figure, not nothing', async ($, on) => {
  const stale = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(T0 - 20 * 60_000).toISOString() }] }
  const app = {
    content: [{ type: 'text', text: JSON.stringify({ plan: { status: 'ok', windows: [{ label: '5-hour limit', percentUsed: 4, resetsAt: new Date(T0 + 5 * 3_600_000).toISOString() }] } }) }],
    isError: false,
  }
  const { clock } = await boot($, on, { usage: stale, app })
  await clock.advance(1)
  await clock.settle()
  expect(await barWords($)).toContain('5h 96% left')
})

// ---------------------------------------------------------------------------
// #3. Session totals are summed over the visible rows, which a new plan prunes.

test('audit #3: the session tokens and estimated cost do not drop when a new plan starts', { options: { currency: 'USD' } }, async ($, on) => {
  // No engine cost: the session cost is the estimate.
  await boot($, on, { usage: { ...USAGE, cost: undefined } })
  await $.tool.call(PLAN as never)
  await spawn($, 1, 'Write the parser')
  await agentStep($, 'a1')
  await endAgent($, 'a1')
  expect(await sessionLine($)).toContain('≈$0.30 · 273k tokens')
  // The next plan of the session.
  await $.tool.call({ tool: PROGRESS, title: 'Next thing', phase: 'delegate', tasks: [{ title: 'Write the docs', kind: 'write' }] } as never)
  expect(await sessionLine($)).toContain('≈$0.30 · 273k tokens')
})

// ---------------------------------------------------------------------------
// #6. Logs: an ending tool call closes the newest open entry, not its own.

test('audit #6: two tool calls running at once are each closed with their own outcome', async ($, on) => {
  const { clock, copies, gates } = await boot($, on)
  await $.turn.start({ text: 'Read both', turnId: 't1' } as never)
  const a = gate()
  const b = gate()
  gates.set('/repo/a.ts', a)
  gates.set('/repo/b.ts', b)
  const callA = $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await clock.settle()
  const callB = $.tool.call({ tool: 'Read', file_path: '/repo/b.ts' } as never)
  await clock.settle()
  // a.ts fails first; b.ts succeeds four seconds later.
  a.open({ result: 'ENOENT', isError: true })
  await callA
  await clock.advance(4_000)
  b.open({ result: 'file text' })
  await callB
  const p = await pane($, 'terminal')
  await p.press({ key: 'log-main' })
  await p.press({ key: 'copy-main' })
  await p.unmount()
  const lines = String(copies.at(-1)).split('\n')
  const lineA = lines.find(l => l.includes('Reading a.ts')) ?? ''
  const lineB = lines.find(l => l.includes('Reading b.ts')) ?? ''
  expect(lineA).toContain('✗')
  expect(lineB).toContain('✓')
})

// ---------------------------------------------------------------------------
// #10. The 200-row cap evicts the oldest rows, running or not.

test('audit #10: with 201 agents running and none finished, the run counts none finished', async ($, on) => {
  await boot($, on)
  await userTurn($, 'Fan out')
  for (let i = 1; i <= 201; i += 1) await spawn($, i, `shard ${i}`, 'general-purpose')
  const text = await barWords($)
  expect(text).toContain('Agents 0/201')
})

// ---------------------------------------------------------------------------
// #7. The fill's high-water mark is keyed by title and count only.

test('audit #7: a new plan with the same title and task count starts from an empty bar, not a full one', async ($, on) => {
  const { clock } = await boot($, on)
  await $.tool.call(PLAN as never)
  await userTurn($, 'Ship it')
  await spawn($, 1, 'Write the parser')
  await spawn($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await endAgent($, 'a2')
  // The main turn is still open: the ticker holds the finished plan's fill (100%).
  await clock.advance(2_000)
  await clock.settle()
  expect(await barPercent($)).toBe(100)
  // The same plan run again (say, for the next release): nothing of it is done yet.
  await $.tool.call(PLAN as never)
  const text = await barWords($, 'desktop')
  expect(text).toContain('Tasks 0/2')
  expect(await barPercent($)).toBeLessThan(10)
})

// ---------------------------------------------------------------------------
// #8. Planned tasks are matched to runs by normalised title alone.

const run = (id: string, description: string, status: AgentRun['status'], startedAt = T0): AgentRun => ({
  id,
  agentId: id,
  type: 'pixel-crew:reviewer',
  kind: 'review',
  tint: 0,
  description,
  model: 'claude-opus-5-5',
  status,
  startedAt,
  contextTokens: 0,
  contextMax: 1_000_000,
  use: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  steps: 0,
  round: 1,
  doing: '',
  doingSince: startedAt,
  log: [],
})

// SPEC 2.8: matching stays by title; the `progress` tool makes the titles distinct.
test('audit #8: two planned tasks with the same title need two runs, before Planned drops them or the plan settles', () => {
  const flow: Flow = {
    ...mergeFlow(null, {
      title: 'Ship with two reviews',
      phase: 'delegate',
      tasks: [
        { title: 'Review the changes', kind: 'review', after: [] },
        { title: 'Write the parser', kind: 'build', after: [1] },
        { title: 'review: the CHANGES', kind: 'review', after: [2] },
      ],
    }),
    reportedAt: T0,
  }
  // The later one is told apart; a third copy would be (3).
  expect(flow.tasks.map(t => t.title)).toEqual(['Review the changes', 'Write the parser', 'review: the CHANGES (2)'])
  expect(mergeFlow(null, { title: 'x', tasks: [{ title: 'A' }, { title: 'a' }, { title: 'A.' }] }).tasks.map(t => t.title)).toEqual(['A', 'a (2)', 'A. (3)'])
  // The first review is under way: task 3 has not started.
  expect(plannedOf(flow, [run('a1', 'Review the changes', 'running')]).map(t => t.n)).toEqual([2, 3])
  // The first review and the parser are done; the second review never ran.
  const settled = flowSettled(flow, [run('a1', 'Review the changes', 'done'), run('a2', 'Write the parser', 'done', T0 + 1)])
  expect(settled?.isFinished).toBe(false)
  // A re-run of a task reuses its title and counts for it.
  const all = [run('a1', 'Review the changes', 'failed'), run('a2', 'Write the parser', 'done', T0 + 1), run('a3', 'review: the CHANGES (2)', 'done', T0 + 2), run('a4', 'Review the changes', 'done', T0 + 3)]
  expect(flowSettled(flow, all)?.isFinished).toBe(true)
})

test('audit #8 (wiring): the progress reply names the titles to use when it had to tell two apart', async ($, on) => {
  await boot($, on)
  const reply = (await $.tool.call({ tool: PROGRESS, title: 'Two reviews', tasks: [{ title: 'Review it', kind: 'review' }, { title: 'Build it' }, { title: 'Review it', kind: 'review' }] } as never)) as { result: string }
  expect(reply.result).toContain('ok: ')
  expect(reply.result).toContain('1. Review it; 2. Build it; 3. Review it (2)')
  // Distinct titles get the plain reply.
  const plain = (await $.tool.call(PLAN as never)) as { result: string }
  expect(plain.result).toBe('ok: Tasks 0/2')
})

// ---------------------------------------------------------------------------
// #11. A title over 120 characters is clipped when stored but compared unclipped.

test('audit #11: a long-titled plan\'s closing report keeps its finished agents in the panel', async ($, on) => {
  const LONG = `Ship the thing: ${'migrate every config loader to the new schema, '.repeat(3)}`.trim()
  expect(LONG.length).toBeGreaterThan(120)
  await boot($, on)
  await $.tool.call({ ...PLAN, title: LONG } as never)
  await userTurn($, 'Ship it')
  await spawn($, 1, 'Write the parser')
  await spawn($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await endAgent($, 'a2')
  expect(await paneWords($)).toContain('FINISHED · 2')
  // The orchestrator's last report, with the plan's title as it was given.
  await $.tool.call({ tool: PROGRESS, title: LONG, finished: true } as never)
  const text = await paneWords($)
  expect(text).toContain('FINISHED · 2')
  expect(text).toContain('Write the parser')
})

// ---------------------------------------------------------------------------
// #9. An engine window with no figure is drawn as 100% left.

test('audit #9: an engine limit with no percent is left out, not shown as 100% left', async ($, on) => {
  const noFigure = { ...USAGE, rateLimits: [{ kind: 'five_hour', resetsAt: '2026-11-13T11:07:00Z' }, { kind: 'seven_day', percentUsed: null, resetsAt: '2026-11-17T03:00:00Z' }] }
  await boot($, on, { usage: noFigure })
  const text = await barWords($)
  // README: "A limit with no figure yet is left out."
  expect(text).not.toContain('5h 100% left')
  expect(text).not.toContain('Week 100% left')
})

// ---------------------------------------------------------------------------
// #5. While nothing works, the panel reads the clock of the last event, not now.

test('audit #5: five idle minutes after a turn, the main row says last turn 5m ago and the time on the session card has moved on', async ($, on) => {
  const { clock } = await boot($, on)
  await $.turn.start({ text: 'Quick one', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(5 * 60_000)
  await clock.settle()
  // 2.5.0 (A7): the pane's frame does not change while idle; a frame written after the five
  // minutes, here the one for opening the pane, shows them.
  await $.command.run({ command: 'crew', args: 'open' } as never)
  const p = await pane($, 'desktop')
  const alts = (await p.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
  await p.unmount()
  expect(alts.find(a => a.startsWith('Claude,'))).toContain('last turn 5m ago')
  // The session started a minute before T0: six minutes in (the read itself is a second on).
  expect(alts.find(a => a.startsWith('Session: '))).toMatch(/Time 6:0[01]/)
})

test('audit #3b: the session tokens do not drop once the session has passed 200 agents', async ($, on) => {
  await boot($, on)
  await userTurn($, 'Fan out')
  await spawn($, 1, 'shard 1', 'general-purpose')
  await agentStep($, 'a1')
  await endAgent($, 'a1')
  expect(await sessionLine($)).toContain('273k tokens')
  for (let i = 2; i <= 201; i += 1) {
    await spawn($, i, `shard ${i}`, 'general-purpose')
    await endAgent($, `a${i}`)
  }
  expect(await sessionLine($)).toContain('273k tokens')
})

// ---------------------------------------------------------------------------
// The decisions of SPEC 2.8 where the audit left a choice.

test('audit #1b: a settled plan ignores reports that agree with it, and reopens for a new run of one of its tasks', async ($, on) => {
  const { clock } = await boot($, on)
  await $.tool.call(PLAN as never)
  await userTurn($, 'Ship it')
  await spawn($, 1, 'Write the parser')
  await spawn($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await endAgent($, 'a2')
  await clock.advance(2_000)
  await clock.settle()
  expect(await barPercent($)).toBe(100)
  // A late report that agrees changes nothing.
  expect(await $.tool.call({ tool: PROGRESS, done: 2 } as never)).toMatchObject({ result: 'ok: Done' })
  // No report: the task is simply run again. The plan reopens, and its fill starts afresh.
  await spawn($, 3, 'Wire the CLI')
  const text = await barWords($)
  expect(text).not.toContain('Done')
  expect(text).toContain('Tasks 0/2')
  expect(await barPercent($)).toBeLessThan(100)
})

test('audit #1c: reopenedFlow takes a report that contradicts the settled state, and brings back what a re-run finds', () => {
  const plan = { ...mergeFlow(null, { title: 'P', done: 1, phase: 'review', tasks: [{ title: 'A' }, { title: 'B' }] }), reportedAt: T0 }
  const runs = [run('a', 'A', 'done'), run('b', 'B', 'done', T0 + 1)]
  const settled = flowSettled(plan, runs)
  expect(settled).toMatchObject({ isFinished: true, done: 2, phase: 'close', settled: { done: 1, phase: 'review' } })
  for (const agree of [{ done: 2 }, { finished: true }, { phase: 'close' as const }, {}]) expect(reopenedFlow(settled, agree)).toBeNull()
  expect(reopenedFlow(settled, { done: 1 })).toMatchObject({ isFinished: false, done: 1, phase: 'review' })
  expect(reopenedFlow(settled, { phase: 'delegate' })).toMatchObject({ isFinished: false, done: 1, phase: 'delegate' })
  const back = reopenedFlow(settled, null)
  expect(back).toMatchObject({ isFinished: false, done: 1, phase: 'review' })
  expect(back && 'settled' in back).toBe(false)
  // A plan finished by a report is not reopened.
  expect(reopenedFlow(mergeFlow(plan, { finished: true }), { done: 0 })).toBeNull()
  expect(reopenedFlow(null, null)).toBeNull()
})

test('audit #2c: the price list of SPEC 2.8, and bare aliases with or without [1m]', () => {
  const want: Record<string, [number, number, number]> = {
    'claude-fable-5-2': [8, 40, 0.2],
    'claude-mythos-5-2': [8, 40, 0.2],
    'claude-fable-5-1': [10, 50, 0.25],
    'claude-fable-5': [10, 50, 1],
    'claude-opus-5-5': [4, 20, 0.2],
    'claude-opus-5': [5, 25, 0.5],
    'claude-opus-4-8': [5, 25, 0.5],
    'claude-sonnet-5-5': [2, 10, 0.1],
    'claude-sonnet-5': [2, 10, 0.2],
    'claude-haiku-5-5': [0.1, 0.5, 0.01],
    'claude-haiku-4-5': [1, 5, 0.1],
    fable: [8, 40, 0.2],
    'Opus[1m]': [4, 20, 0.2],
    'sonnet[1m]': [2, 10, 0.1],
    HAIKU: [0.1, 0.5, 0.01],
  }
  for (const [id, [i, o, r]] of Object.entries(want)) {
    const [input, output, cacheRead, cacheWrite] = priceOf(id, 0)
    expect(`${id}: ${input} / ${output} / ${cacheRead} / ${cacheWrite}`).toBe(`${id}: ${i} / ${o} / ${r} / ${i * 2}`)
  }
  // An alias of Haiku 5.5 takes its long-prompt prices too.
  expect(priceOf('haiku', 200_000)).toEqual(priceOf('claude-haiku-5-5', 200_000))
})

test('audit #3c: retired rows and the main agent count by the family that spent them, in the totals and the split', () => {
  const use = (input: number) => ({ input, output: 0, cacheRead: 0, cacheWrite: 0 })
  const row = (id: string, model: string, input: number, costUsd: number): AgentRun => ({ ...run(id, id, 'done'), model, use: use(input), costUsd })
  const retired = retire(blankRetired(), [row('a', 'claude-opus-5-5', 100, 1), row('b', 'claude-haiku-5-5', 10, 0.1)])
  expect(retired.use.input).toBe(110)
  expect(retired.byFamily.Opus).toEqual({ use: use(100), costUsd: 1 })
  // The main agent changed model part way: its earlier tokens stay under Opus.
  const main = { ...blankMain(T0), model: 'claude-sonnet-5-5', use: use(1_000), costUsd: 3, byFamily: { Opus: { use: use(600), costUsd: 2 } } }
  const split = usageSplit(main, [row('c', 'claude-opus-5-5', 5, 0.05)], retired)
  expect(split.main).toEqual({ tokens: 1_000, costUsd: 3 })
  expect(split.models.Opus.tokens).toBe(600 + 5 + 100)
  expect(split.models.Sonnet.tokens).toBe(400)
  expect(split.models.Haiku.tokens).toBe(10)
  expect(split.agents.tokens).toBe(5 + 110)
  expect(split.retired.tokens).toBe(110)
  // The totals count the retired rows once; state with no tally reads as zero.
  const usage = { ...blankUsage(T0), costUsd: null }
  expect(totals(main, [], usage, T0, retired).tokens).toBe(1_110)
  expect(totals(main, [], usage, T0, undefined).tokens).toBe(1_000)
  expect(Math.abs(totals(main, [], usage, T0, retired).costUsd - 4.1)).toBeLessThan(1e-9)
  expect(usageSplit(main, [], null as never).agents.tokens).toBe(0)
})

test('audit #6b: with no call id known the newest open entry closes; an id closes only its own entry', () => {
  const open = (at: number, text: string, callId?: string) => ({ at, kind: 'tool' as const, text, outcome: 'open' as const, ...(callId ? { callId } : {}) })
  const log = [open(0, 'a', 'c1'), open(1, 'b', 'c2')]
  expect(closeLog(log, 5, 'error', 'c1').map(e => e.outcome)).toEqual(['error', 'open'])
  expect(closeLog(log, 5, 'ok').map(e => e.outcome)).toEqual(['open', 'ok'])
  // An id whose entry is gone closes nothing.
  expect(closeLog(log, 5, 'ok', 'c9')).toEqual(log)
})

test('audit #7b: the mark names the plan instance: a re-plan keeps its fill, another plan of the same title starts empty', async ($, on) => {
  const { clock } = await boot($, on)
  await $.tool.call(PLAN as never)
  await userTurn($, 'Ship it')
  await spawn($, 1, 'Write the parser')
  await spawn($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  await clock.advance(2_000)
  await clock.settle()
  const before = await barPercent($)
  expect(before).toBeGreaterThanOrEqual(50)
  // The same plan, re-planned to three tasks: its fill does not move back.
  await $.tool.call({ ...PLAN, title: undefined, tasks: [...PLAN.tasks, { title: 'Test the CLI', kind: 'test' }] } as never)
  expect(await barPercent($)).toBeGreaterThanOrEqual(before)
  // Keys: by when the plan was first reported; a plan an older version stored, by title and count.
  const f = mergeFlow(null, { title: 'P', tasks: [{ title: 'A' }] })
  expect(planKey({ ...f, startedAt: 5 })).toBe(planKey({ ...f, total: 4, startedAt: 5 }))
  expect(planKey({ ...f, startedAt: 5 })).not.toBe(planKey({ ...f, startedAt: 6 }))
  expect(planKey(f)).toBe('plan:p:1')
})

test('audit #10b: the row cap lets finished rows go first, oldest finished first, and never an active one under 1,000', () => {
  const r = (id: string, status: AgentRun['status'], t: number): AgentRun => ({ ...run(id, id, status, t), ...(status === 'done' ? { endedAt: t + 10 } : {}) })
  const list = [r('old-done', 'done', 1), r('active-1', 'running', 2), r('new-done', 'done', 3), r('active-2', 'waiting', 4)]
  expect(capRows(list, 3).removed.map(a => a.id)).toEqual(['old-done'])
  expect(capRows(list, 2).removed.map(a => a.id)).toEqual(['old-done', 'new-done'])
  // Past the cap with only active rows left: none goes.
  expect(capRows(list, 1).kept.map(a => a.id)).toEqual(['active-1', 'active-2'])
  // Active rows have their own cap: the oldest started go.
  const many = Array.from({ length: 5 }, (_, i) => r(`a${i}`, 'running', i))
  expect(capRows(many, 2, 3).removed.map(a => a.id)).toEqual(['a0', 'a1'])
  expect(capRows(list).kept).toEqual(list)
})

// ---------------------------------------------------------------------------
// SPEC 2.9.3: a price row matches its version whole.

test('2.9.3: a dated Fable 5 or Mythos 5 id is priced as 5, not 5.2; dated ids of the other rows keep their own row', () => {
  for (const id of ['claude-fable-5-20260301', 'claude-mythos-5-20260301']) expect(`${id}: ${priceOf(id, 0).join(' / ')}`).toBe(`${id}: 10 / 50 / 1 / 20`)
  expect(priceOf('claude-fable-5-1-20260301', 0)).toEqual([10, 50, 0.25, 20])
  expect(priceOf('claude-fable-5-2-20260301', 0)).toEqual([8, 40, 0.2, 16])
  expect(priceOf('claude-opus-5-5-20260301', 0)).toEqual([4, 20, 0.2, 8])
  expect(priceOf('claude-opus-5-50', 0)).toEqual([5, 25, 0.5, 10])
  expect(priceOf('claude-sonnet-5-5-20260301', 0)).toEqual([2, 10, 0.1, 4])
  expect(priceOf('claude-sonnet-5-20260301', 0)).toEqual([2, 10, 0.2, 4])
  expect(priceOf('claude-sonnet-50', 0)).toEqual([3, 15, 0.3, 6])
  expect(priceOf('claude-haiku-5-5-20260301', 200_000)).toEqual([0.5, 2.5, 0.05, 1])
  expect(priceOf('claude-haiku-5-50', 200_000)).toEqual([1, 5, 0.1, 2])
})

// ---------------------------------------------------------------------------
// SPEC 2.9.6: the drawing budget.

test('2.9.6: drawnRows takes rows in section order up to the cap and counts what each section leaves out', () => {
  const n = (k: number, tag: string): string[] => Array.from({ length: k }, (_, i) => `${tag}${i}`)
  expect(MAX_DRAWN_ROWS).toBe(60)
  const [w, wa, p, f] = drawnRows([n(50, 'w'), n(5, 'a'), n(10, 'p'), n(7, 'f')])
  expect([w?.shown.length, w?.more, wa?.shown.length, wa?.more, p?.shown.length, p?.more, f?.shown.length, f?.more]).toEqual([50, 0, 5, 0, 5, 5, 0, 7])
  expect(p?.shown).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
  expect(drawnRows([n(3, 'x')], 2)).toEqual([{ shown: ['x0', 'x1'], more: 1 }])
  expect(drawnRows([n(3, 'x')])).toEqual([{ shown: n(3, 'x'), more: 0 }])
  expect(drawnRows([], 60)).toEqual([])
  expect(moreLine(440)).toBe('+440 more')
})

// ---------------------------------------------------------------------------
// SPEC 2.9.8: the 1.6 planner role.

test('2.9.8: kindName and a 1.6 planner run read the planner as the plan kind', () => {
  expect(kindName('planner')).toBe('plan')
  const old = { ...run('p', 'Lay it out', 'running'), kind: undefined, role: 'planner', type: 'general-purpose' } as unknown as AgentRun
  expect(normalizeAgent(old).kind).toBe('plan')
  expect(mergeFlow(null, { title: 'x', tasks: [{ title: 'Lay it out', agent: 'planner' }] }).tasks[0]?.kind).toBe('plan')
})
