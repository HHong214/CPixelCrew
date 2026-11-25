// 2.5.0, slice A, the wiring: the pane and the bar draw from two frames, `paneFrame` and
// `barFrame`, written at most once a second (A4, A5); the stream, the tick and the agent sync
// write only what changed (A3, A6, A7, A8); a planned title with `|`, an empty task list and
// junk stored by an older version break nothing (A9, A10). Events go in; what comes out is
// each `state.set` (by key, with the clock's time), each `state.get` while a site draws, each
// `$.ui.invalidate`, and the drawn trees. The frames' shape is the builder's: no test reads one.
// The pure half is in state-budget.test.ts.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, MainRun } from '../types'
import { STUCK_MS } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const STEP = 'mcp__CPixelCrew__step'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const SURFACES = ['desktop', 'terminal'] as const
type Surface = (typeof SURFACES)[number]

const FRAMES = ['paneFrame', 'barFrame'] as const
// What no render hook reads in 2.5.0 (A4).
const BOOKKEEPING = ['flow', 'run', 'agents', 'retired', 'main', 'usage', 'rates', 'now']

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}
const ALL_ITEMS = { barContext: true, barFiveHour: true, barWeek: true, barModelWeek: true, barSpeed: true, barCache: true, barTurn: true, barTime: true }

const PLAN = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', agent: 'engineer' },
    { title: 'Wire the CLI', agent: 'engineer' },
  ],
}

// What `agent.list` answers: a test sets it as the engine's own list would read.
type Listed = { id: string; status: string; description: string; type: string }
type Write = { key: string; at: number; value: unknown }
type World = {
  clock: ReturnType<typeof mock.clock>
  listed: Listed[]
  // Every `state.set` of the mod's values, in order, with the time it was made.
  writes: Write[]
  // The keys of the mod's values read while `isOn`.
  reads: { isOn: boolean; keys: string[] }
  // The time of each `$.ui.invalidate`.
  invalidations: number[]
  // Each pane opened, by id, and those open now.
  opened: string[]
  open: Set<string>
  // What the main loop's next model request streams.
  script: { chunks: unknown[] }
}

// Everything beneath the plugin, as run-decisions.test.ts answers it. The app's usage tool is
// not there, so its refresh fails and writes no state; the exchange rates fail too.
// `junk`: what the mod's values hold at load, as an older version may have left them; each
// reads so until the mod writes it.
async function boot($: Engine, on: On, o: { stored?: Record<string, unknown>; junk?: Record<string, unknown> } = {}): Promise<World> {
  const stored: Record<string, unknown> = o.stored ?? {}
  const junk: Record<string, unknown> = { ...o.junk }
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  const reads = { isOn: false, keys: [] as string[] }
  const invalidations: number[] = []
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN) {
      writes.push({ key: e.key, at: clock.now(), value: e.value })
      delete junk[e.key]
    }
    return next(e)
  }) as never)
  on('state.get', ((_$: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) => {
    if (reads.isOn && e.plugin === PLUGIN) reads.keys.push(e.key)
    if (e.plugin === PLUGIN && Object.hasOwn(junk, e.key)) return { value: { value: junk[e.key], version: 0 } }
    return next(e)
  }) as never)
  on('ui.invalidate', ((_$: unknown, e: unknown, next: (x: unknown) => unknown) => {
    invalidations.push(clock.now())
    return next(e)
  }) as never)
  const open = new Set<string>()
  const opened: string[] = []
  const listed: Listed[] = []
  const script = { chunks: [] as unknown[] }
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    for (const c of script.chunks) yield c as never
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
    opened.push(e.id)
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
  return { clock, listed, writes, reads, invalidations, opened, open, script }
}

async function userTurn($: Engine, text = 'Go on', turnId = 't1'): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId } as never)
}

async function endMainTurn($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId, reason: 'answer' } as never)
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

// A tool call made by an agent (or by the main loop, with no agentId).
async function readFile($: Engine, path: string, agentId?: string, id?: string): Promise<unknown> {
  return $.tool.call({ tool: 'Read', file_path: path, ...(agentId ? { agentId } : {}), ...(id ? { tool_use_id: id } : {}) } as never)
}

// Sites mounted as they stand: no clock moves here, so a test says when frames land.
const pane = ($: Engine, surface: Surface = 'desktop') => $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never })
const band = ($: Engine, surface: Surface = 'desktop') => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS as never })

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

// The writes of one value made from `from` to `to`, both included.
const writesOf = (w: World, key: string, from: number, to: number): Write[] => w.writes.filter(x => x.key === key && x.at >= from && x.at <= to)
const lastOf = <T>(w: World, key: string): T | undefined => w.writes.filter(x => x.key === key).at(-1)?.value as T | undefined
const rowOf = (w: World, agentId: string): AgentRun | undefined => (lastOf<AgentRun[]>(w, 'agents') ?? []).find(a => a.agentId === agentId)
const thinking = (i: number) => ({ kind: 'thinking', index: 0, text: ` Step ${i} is done.` })

// Pulls the main loop's next model request through the plugin one chunk at a time; `between`
// runs after each chunk the stream passed on.
async function stream($: Engine, w: World, chunks: unknown[], between: (i: number) => Promise<void>): Promise<void> {
  w.script.chunks = chunks
  const s = $.turn.step({ index: 0, model: 'claude-opus-5-5', messageCount: 1, turnId: 't1' } as never) as unknown as AsyncIterator<unknown>
  for (let i = 0; i < chunks.length; i += 1) {
    await s.next()
    await between(i)
  }
  for (let n = await s.next(); !n.done; n = await s.next()) {
    // The rest of the stream.
  }
}

// ---------------------------------------------------------------------------
// A5: when a frame is written.

test('A5: the first frame after a load is written at once, and both sites draw before it', async ($, on) => {
  const w = await boot($, on)
  const b = await band($)
  const p = await pane($)
  expect(await words(b)).not.toBe('')
  await w.clock.settle()
  // No clock moved: each frame is written at T0.
  for (const key of FRAMES) expect(writesOf(w, key, T0, T0).length).toBeGreaterThanOrEqual(1)
  await b.unmount()
  await p.unmount()
})

test('A5: a change in the same second as the frame before waits for the trailing write, 1,000 ms after it, then nothing', async ($, on) => {
  const w = await boot($, on)
  await $.tool.call(PLAN as never)
  const b = await band($)
  await w.clock.advance(5_000)
  const t = w.clock.now()
  // No frame for five seconds: this one is written at once.
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  await w.clock.settle()
  expect(writesOf(w, 'barFrame', t, t)).toHaveLength(1)
  expect(await words(b)).toContain('Tasks 1/2')
  // 300 ms on: it waits.
  await w.clock.advance(300)
  await $.tool.call({ tool: PROGRESS, done: 2 } as never)
  await w.clock.settle()
  expect(writesOf(w, 'barFrame', t + 1, t + 999)).toHaveLength(0)
  expect(await words(b)).toContain('Tasks 1/2')
  // The end of that second: the trailing write, with the later change.
  await w.clock.advance(700)
  expect(writesOf(w, 'barFrame', t + 1_000, t + 1_000)).toHaveLength(1)
  expect(await words(b)).toContain('Tasks 2/2')
  // Nothing changed since: nothing more.
  await w.clock.advance(3_000)
  expect(writesOf(w, 'barFrame', t + 1_001, t + 4_000)).toHaveLength(0)
  await b.unmount()
})

test('A5: a press on the bar writes its frame at once; the next write that is not for a press comes 1,000 ms after it', async ($, on) => {
  const w = await boot($, on)
  await $.tool.call(PLAN as never)
  await userTurn($)
  await endMainTurn($)
  const b = await band($)
  await w.clock.advance(5_000)
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  await w.clock.advance(200)
  const before = await words(b)
  const tp = w.clock.now()
  await b.press({ key: 'bar-collapse' })
  await w.clock.settle()
  expect(writesOf(w, 'barFrame', tp, tp)).toHaveLength(1)
  expect(await words(b)).not.toBe(before)
  await w.clock.advance(200)
  await $.tool.call({ tool: PROGRESS, done: 2 } as never)
  await w.clock.settle()
  expect(writesOf(w, 'barFrame', tp + 1, tp + 999)).toHaveLength(0)
  await w.clock.advance(800)
  expect(writesOf(w, 'barFrame', tp + 1_000, tp + 1_000)).toHaveLength(1)
  await b.unmount()
})

test('A5: a list that was cleared is a change: the frame drops the rows', async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Index the archive')
  await endAgent($, 'a1')
  await endMainTurn($)
  const p = await pane($)
  await w.clock.advance(5_000)
  expect(await words(p)).toContain('Index the archive')
  const t = w.clock.now()
  // A new plan starts with a clean list: the finished row goes.
  await $.tool.call({ ...PLAN, title: 'A fresh plan' } as never)
  await w.clock.advance(1_000)
  expect(rowOf(w, 'a1')).toBeUndefined()
  expect(writesOf(w, 'paneFrame', t, t + 1_000).length).toBeGreaterThanOrEqual(1)
  expect(await words(p)).not.toContain('Index the archive')
  await p.unmount()
})

// ---------------------------------------------------------------------------
// A-d3: a busy second, and a quiet one.

test('A-d3: in one second of 100 stream chunks and 10 tool calls each frame is written once or twice, the last with the last call', async ($, on) => {
  const w = await boot($, on)
  const p = await pane($)
  const b = await band($)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.advance(5_000)
  const t0 = w.clock.now()
  // 100 chunks 9 ms apart; every tenth, the agent makes a call that starts and ends.
  await stream(
    $,
    w,
    Array.from({ length: 100 }, (_, i) => thinking(i)),
    async i => {
      if (i % 10 === 9) await readFile($, `/repo/${i === 99 ? 'last-call' : `file${i}`}.ts`, 'a1', `tu-r${i}`)
      await w.clock.advance(9)
    },
  )
  expect(w.clock.now()).toBeLessThan(t0 + 1_000)
  await w.clock.advance(t0 + 1_000 - w.clock.now())
  // The frame written at the end of the second has the last call.
  expect(await words(p)).toContain('Reading last-call.ts')
  for (const key of FRAMES) {
    const n = writesOf(w, key, t0, t0 + 1_000).length
    expect(`${key}: ${n >= 1 && n <= 2 ? 'once or twice' : `${n} writes`}`).toBe(`${key}: once or twice`)
  }
  await p.unmount()
  await b.unmount()
})

test('A-d3: in a second in which nothing shown changes, neither frame is written', async ($, on) => {
  const w = await boot($, on)
  await $.tool.call(PLAN as never)
  const p = await pane($)
  const b = await band($)
  await w.clock.advance(2_000)
  for (const key of FRAMES) expect(writesOf(w, key, T0, T0 + 2_000).length).toBeGreaterThanOrEqual(1)
  const t = w.clock.now()
  await w.clock.advance(1_000)
  for (const key of FRAMES) expect(writesOf(w, key, t + 1, t + 1_000)).toHaveLength(0)
  await p.unmount()
  await b.unmount()
})

// ---------------------------------------------------------------------------
// A4: what the render hooks read.

for (const surface of SURFACES) {
  test(`A4: ${surface}: while the pane and the bar draw, no value but the frames, view and settings is read`, async ($, on) => {
    const w = await boot($, on)
    await $.tool.call(PLAN as never)
    await userTurn($)
    await spawnCrew($, 1, 'Write the parser')
    await w.clock.advance(2_000)
    w.reads.isOn = true
    const p = await pane($, surface)
    const b = await band($, surface)
    const text = `${await words(p)}\n${await words(b)}`
    await p.unmount()
    await b.unmount()
    w.reads.isOn = false
    expect(text).toContain('Write the parser')
    expect(text).toContain('Tasks 0/2')
    expect(w.reads.keys.filter(k => BOOKKEEPING.includes(k))).toEqual([])
  })
}

// ---------------------------------------------------------------------------
// A6: the stream writes the main row at most once a second.

test('A6: 100 chunks over 2.5 seconds write the main row at most once a second, and its last line lands', async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await w.clock.advance(5_000)
  const t0 = w.clock.now()
  await stream(
    $,
    w,
    Array.from({ length: 100 }, (_, i) => thinking(i)),
    async i => {
      if (i < 99) await w.clock.advance(25)
    },
  )
  const tLast = t0 + 99 * 25
  const at = writesOf(w, 'main', t0, tLast).map(x => x.at)
  expect(at.length).toBeGreaterThanOrEqual(2)
  const gaps = at.slice(1).map((x, i) => x - at[i]!)
  expect(gaps.filter(g => g < 1_000)).toEqual([])
  // The line held back is written within the second after.
  await w.clock.advance(1_000)
  expect(lastOf<MainRun>(w, 'main')?.doing).toContain('Step 99')
})

// ---------------------------------------------------------------------------
// A8: an event that changes nothing shown writes nothing.

test('A8: a step reported for an agent no row has writes nothing, the run’s mark included', async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 3 } as never)
  await w.clock.settle()
  const from = w.writes.length
  const answer = (await $.tool.call({ tool: STEP, agentId: 'zz', done: 2, total: 3 } as never)) as { result?: unknown }
  await w.clock.settle()
  expect(String(answer.result)).toContain('ignored')
  expect(w.writes.slice(from).map(x => x.key)).toEqual([])
})

// ---------------------------------------------------------------------------
// A-d1 through the wiring: what a row's log keeps.

test('A-d1: a live row that took 400 log entries holds 200 at most, and once finished the newest Log lines (10 here)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on, { stored: { sizes: { textSize: 100, iconSize: 200, barSize: 100, logLines: 10 } } })
  await w.clock.advance(2_000)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  for (let i = 0; i < 400; i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
  const live = rowOf(w, 'a1')
  expect(live?.status).toBe('running')
  expect(live!.log.length).toBeGreaterThan(0)
  expect(live!.log.length).toBeLessThanOrEqual(200)
  expect(live!.log.at(-1)?.text).toContain('file399')
  await endAgent($, 'a1')
  const done = rowOf(w, 'a1')
  expect(done?.status).toBe('done')
  expect(done!.log.length).toBeGreaterThan(0)
  expect(done!.log.length).toBeLessThanOrEqual(10)
  expect(done!.log.at(-1)?.kind).toBe('end')
})

// ---------------------------------------------------------------------------
// A-d2: a row whose end was missed.

test('A-d2: an active row its agent list no longer shows is failed after STUCK_MS and the next sync; then 60 s pass with no write', { options: { barCache: false }, timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await endMainTurn($)
  // `agent.list` lists nothing: the end of a1 was missed.
  await w.clock.advance(STUCK_MS + 5_000)
  await w.clock.advance(1_000)
  const row = rowOf(w, 'a1')
  expect(row?.status).toBe('failed')
  expect(row?.log.at(-1)?.text).toContain('Stopped: no longer listed')
  const t = w.clock.now()
  await w.clock.advance(60_000)
  expect(w.writes.filter(x => x.at > t).map(x => x.key)).toEqual([])
})

test('A-d2: a row the agent list still shows as running is left alone, quiet or not', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await endMainTurn($)
  w.listed.push({ id: 'a1', status: 'running', description: 'Write the parser', type: 'pixel-crew:engineer' })
  await w.clock.advance(STUCK_MS + 10_000)
  expect(rowOf(w, 'a1')?.status).toBe('running')
})

// ---------------------------------------------------------------------------
// A-d4 and A7: idle.

test('A-d4: with the cache pill on and 50 minutes left, a minute passes with no pane frame, one bar frame at most, no invalidate and no now', { options: ALL_ITEMS, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  const p = await pane($)
  const b = await band($)
  await userTurn($)
  await endMainTurn($)
  // The cache was written at T0: 50 minutes left ten minutes on.
  await w.clock.advance(10 * 60_000)
  const t = w.clock.now()
  await w.clock.advance(60_000)
  const after = (key: string): number => w.writes.filter(x => x.key === key && x.at > t).length
  expect(w.invalidations.filter(at => at > t)).toEqual([])
  expect(after('now')).toBe(0)
  expect(after('paneFrame')).toBe(0)
  expect(after('barFrame')).toBeLessThanOrEqual(1)
  expect(w.writes.some(x => x.key === 'barFrame')).toBe(true)
  // A7: whole minutes until five are left.
  expect(await words(b)).toMatch(/\b49m\b/)
  await p.unmount()
  await b.unmount()
})

test('A7: idle with nothing on the bar to count down, a minute passes with no write at all and no invalidate', { options: { barCache: false } }, async ($, on) => {
  const w = await boot($, on)
  const b = await band($)
  await userTurn($)
  await endMainTurn($)
  await w.clock.advance(5_000)
  expect(w.writes.some(x => x.key === 'barFrame')).toBe(true)
  const t = w.clock.now()
  await w.clock.advance(60_000)
  expect(w.invalidations.filter(at => at > t)).toEqual([])
  expect(w.writes.filter(x => x.at > t && x.key !== 'barFrame').map(x => x.key)).toEqual([])
  await b.unmount()
})

// ---------------------------------------------------------------------------
// A-d5 and A9, A10 through the wiring.

test('A-d5: a plan titled a|b opens the pane once across three planned spawns', async ($, on) => {
  const w = await boot($, on)
  await $.tool.call({ tool: PROGRESS, title: 'a|b', phase: 'delegate', tasks: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] } as never)
  expect(w.opened).toEqual(['crew-agents'])
  await userTurn($)
  const b = await band($)
  const spawns: [number, string][] = [
    [1, 'One'],
    [2, 'Two'],
    [3, 'Three'],
  ]
  for (const [n, description] of spawns) {
    // The person closed it with the bar's panel button: closing stays their decision.
    if (w.open.has('crew-agents')) await b.press({ key: 'bar-panel' })
    expect(w.open.has('crew-agents')).toBe(false)
    await spawnCrew($, n, description)
  }
  expect(w.opened).toEqual(['crew-agents'])
  await b.unmount()
})

test('A-d5: a progress call with tasks: [] keeps the plan: the answer and the bar still say Tasks 0/2', async ($, on) => {
  const w = await boot($, on)
  await $.tool.call(PLAN as never)
  expect(await $.tool.call({ tool: PROGRESS, tasks: [] } as never)).toMatchObject({ result: 'ok: Tasks 0/2' })
  await w.clock.advance(1_000)
  const b = await band($)
  await w.clock.settle()
  expect(await words(b)).toContain('Tasks 0/2')
  await b.unmount()
})

test('A-d5: frames compose from junk an older version stored: both are written and both sites draw', async ($, on) => {
  const w = await boot($, on, { junk: { agents: [null, 5, {}, { id: 1 }], flow: 'nope', main: { status: 'working' } } })
  for (const surface of SURFACES) {
    const p = await pane($, surface)
    const b = await band($, surface)
    await w.clock.settle()
    expect(await words(p)).not.toBe('')
    expect(await words(b)).not.toBe('')
    await p.unmount()
    await b.unmount()
  }
  await w.clock.advance(1_000)
  for (const key of FRAMES) expect(w.writes.some(x => x.key === key)).toBe(true)
})
