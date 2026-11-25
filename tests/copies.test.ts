// 2.5.0, section 4: a copy of the mod that is no longer the loaded one writes no frames (L1 to
// L4), and the read cache never holds a value older than one this load wrote or the tick read
// (K1, K2). Everything goes through the wiring, from beneath the mod: events go in; out come
// each `state.set` of the mod's values (key, the clock's time, its `ifVersion` and what it
// answered) and each `state.get` (key, time, the version it answered). A hook beneath answers
// a frame's write with a miss, as the engine does when another copy wrote that frame first; a
// hook on the clock's `every` refuses the mod's tick from some point on, as a hot reload stops
// an old copy's `every`. No test reads the mod's own state or the frames' shape.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const FRAMES = ['paneFrame', 'barFrame'] as const
type FrameKey = (typeof FRAMES)[number]
// The mod's tick: `$.clock.every(TICK_MS)`, started at `session.start` (T0), so it runs at
// every whole second after T0.
const TICK_MS = 1_000

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
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

type Answer = { value?: unknown; deny?: string }
type Next = (x: unknown) => Promise<Answer> | Answer
// One `state.set` of the mod's values: `seq` orders it among every read and write; `isSet` and
// `version` are what the mod was answered.
type Write = { seq: number; key: string; at: number; value: unknown; ifVersion: number | undefined; isSet: boolean | undefined; version: number | undefined }
// One `state.get` of the mod's values, with the version it answered; `seq` is taken once answered.
type Read = { seq: number; key: string; at: number; version: number | undefined }
type World = {
  clock: ReturnType<typeof mock.clock>
  writes: Write[]
  reads: Read[]
  // The keys whose next write is answered with a miss (once each).
  miss: Set<string>
  // A value answered differently from beneath: what each read of that key answers instead.
  answers: Map<string, (v: unknown) => unknown>
  // Once set, every period the mod's tick asks for is refused, which ends the interval.
  ticker: { isStopped: boolean }
  // Keys held by this map are stored here, beneath the mod, instead of in the kit's store:
  // a read answers what stands and its version, a write lands only on that version (or with no
  // `ifVersion`) and moves it on by one, as the engine's `state.set` does. So a value can stand
  // at a version other than 0 before the mod's first write of it.
  held: Map<string, { value: unknown; version: number }>
}

// Everything beneath the plugin, as frames.test.ts answers it, with no site mounted unless a
// test mounts one (so a read of a frame is then outside any draw).
//
// A miss: the write goes on to the store, as another copy's write of that frame would land,
// and the mod is answered `{ isSet: false, version }` with the version the frame stands at now.
// So the version this copy last held is no longer the frame's: only a fresh read gives it.
async function boot($: Engine, on: On): Promise<World> {
  const stored: Record<string, unknown> = {}
  const ticker = { isStopped: false }
  // Registered ahead of `mock.clock`, so it sits above the clock's own hook.
  on('clock.every', { ms: TICK_MS } as never, ((_$: unknown, e: unknown, next: Next) => (ticker.isStopped ? { deny: 'this copy is unloaded' } : next(e))) as never)
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  const reads: Read[] = []
  const miss = new Set<string>()
  const answers = new Map<string, (v: unknown) => unknown>()
  const held = new Map<string, { value: unknown; version: number }>()
  let seq = 0
  on('state.set', (async (_$: unknown, e: { plugin: string; key: string; value: unknown; ifVersion?: number }, next: Next) => {
    if (e.plugin !== PLUGIN) return next(e)
    const at = clock.now()
    seq += 1
    const n = seq
    const cell = held.get(e.key)
    let out: Answer
    if (cell) {
      const isSet = e.ifVersion === undefined || e.ifVersion === cell.version
      if (isSet) held.set(e.key, { value: e.value, version: cell.version + 1 })
      out = { value: { isSet, version: held.get(e.key)?.version } }
    } else out = await next(e)
    const r = (out?.value ?? {}) as { isSet?: boolean; version?: number }
    const isMissed = miss.delete(e.key)
    writes.push({ seq: n, key: e.key, at, value: e.value, ifVersion: e.ifVersion, isSet: isMissed ? false : r.isSet, version: r.version })
    return isMissed ? { value: { isSet: false, version: r.version } } : out
  }) as never)
  on('state.get', (async (_$: unknown, e: { plugin: string; key: string }, next: Next) => {
    if (e.plugin !== PLUGIN) return next(e)
    const at = clock.now()
    const cell = held.get(e.key)
    const out = cell ? { value: { value: cell.value, version: cell.version } } : await next(e)
    const r = (out?.value ?? {}) as { value?: unknown; version?: number }
    seq += 1
    reads.push({ seq, key: e.key, at, version: r.version })
    const change = answers.get(e.key)
    return change ? { value: { value: change(r.value), version: r.version } } : out
  }) as never)
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
  on('ui.open', (() => ({ value: { isPlaced: true } })) as never)
  on('ui.close', (() => ({ value: undefined })) as never)
  on('ui.panes', (() => ({ value: [] })) as never)
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
  return { clock, writes, reads, miss, answers, ticker, held }
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

// A tool call made by an agent: it starts and ends at once.
async function readFile($: Engine, path: string, agentId: string): Promise<unknown> {
  return $.tool.call({ tool: 'Read', file_path: path, agentId } as never)
}

const pane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never })
const band = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS as never })

const isFrame = (key: string) => (FRAMES as readonly string[]).includes(key)
// The frame writes, as key and time from T0.
const frameTimes = (w: World) => w.writes.filter(x => isFrame(x.key)).map(x => [x.key, x.at - T0] as const)
const writesOf = (w: World, key: string, from: number, to: number) => w.writes.filter(x => x.key === key && x.at >= from && x.at <= to)
const holds = (x: unknown, s: string) => JSON.stringify(x ?? null).includes(s)

// ---------------------------------------------------------------------------
// L1: every frame write is conditional.

test('L1: with one copy, every write of each frame carries ifVersion: the first the version read just before it, each later one the version the write before it answered', async ($, on) => {
  const w = await boot($, on)
  // The pane frame stands at version 41 beneath (an older load wrote it); the bar frame was
  // never written (version 0).
  w.held.set('paneFrame', { value: null, version: 41 })
  // No site is mounted until both frames have been written once: no draw reads either first.
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.settle()
  expect(FRAMES.map(key => w.writes.filter(x => x.key === key).length > 0)).toEqual([true, true])
  await pane($)
  await band($)
  await w.clock.advance(400)
  await readFile($, '/repo/a.txt', 'a1')
  await w.clock.advance(1_000)
  await endAgent($, 'a1')
  await w.clock.advance(300)
  await endMainTurn($)
  await w.clock.advance(65_000)
  for (const key of FRAMES) {
    const own = w.writes.filter(x => x.key === key)
    // Set-up: each frame is written more than once here (the pane five times, the bar four).
    expect(own.length).toBeGreaterThanOrEqual(4)
    const first = own[0]
    const before = w.reads.filter(r => r.key === key && r.seq < (first?.seq ?? -1)).at(-1)
    expect({ key, ifVersion: typeof first?.ifVersion }).toEqual({ key, ifVersion: 'number' })
    expect(before?.version).toBe(key === 'paneFrame' ? 41 : 0)
    expect(first?.ifVersion).toBe(before?.version)
    for (let i = 1; i < own.length; i += 1) expect({ key, i, ifVersion: own[i]?.ifVersion }).toEqual({ key, i, ifVersion: own[i - 1]?.version })
    expect(own.every(x => x.isSet === true)).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// L2 and L3: a miss means another copy; only the tick takes the frame back.

test('L2, L3: a pane frame write that misses, with no bar due: the pane is not written again until the next tick, which reads it afresh and writes it on that version; the bar, due meanwhile, is written before the tick', async ($, on) => {
  const w = await boot($, on)
  await $.tool.call(PLAN as never)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.settle()
  await w.clock.advance(2_100)
  // 2,100 ms, more than a second after the last frame: a1 reads a file, which changes the
  // pane alone; the pane's write misses.
  const t = w.clock.now()
  const tick = T0 + 3 * TICK_MS
  w.miss.add('paneFrame')
  await readFile($, '/repo/bbbb.txt', 'a1')
  await w.clock.settle()
  // Set-up: that composition wrote the pane alone, and the write missed.
  const missed = w.writes.filter(x => isFrame(x.key) && x.at >= t)
  expect(missed.map(x => [x.key, x.isSet])).toEqual([['paneFrame', false]])
  // Before the next tick: the agent's events change the pane, and a report changes the bar.
  await w.clock.advance(200)
  await readFile($, '/repo/cccc.txt', 'a1')
  await w.clock.advance(200)
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  await w.clock.advance(200)
  await readFile($, '/repo/dddd.txt', 'a1')
  await w.clock.advance(tick - 1 - w.clock.now())
  // The lost pane is not written; the bar, never lost, is, before the tick.
  expect(writesOf(w, 'paneFrame', t + 1, tick - 1)).toEqual([])
  const bars = writesOf(w, 'barFrame', t + 1, tick - 1)
  expect({ barWrites: bars.length >= 1, allLanded: bars.every(x => x.isSet === true) }).toEqual({ barWrites: true, allLanded: true })
  await w.clock.advance(1)
  // The tick reads the pane frame (no site is mounted: no draw reads it) and writes it on the
  // version that read answered.
  const reread = w.reads.filter(r => r.key === 'paneFrame' && r.seq > (missed[0]?.seq ?? Infinity) && r.at === tick)
  expect(reread.length).toBeGreaterThanOrEqual(1)
  const back = writesOf(w, 'paneFrame', tick, tick)
  expect(back.length).toBeGreaterThanOrEqual(1)
  expect(back[0]?.ifVersion).toBe(reread.filter(r => r.seq < (back[0]?.seq ?? -1)).at(-1)?.version)
  expect(back[0]?.isSet).toBe(true)
})

for (const isHeld of [false, true]) {
  const how = isHeld ? "an agent's tool call held open across the misses ends" : "an agent's tool call ends"
  test(`L3: a copy that no longer ticks writes no frame once each has missed; then ${how}, and no frame is written however far the clock moves`, { timeoutMs: 30_000 }, async ($, on) => {
    let release: () => void = () => undefined
    on('tool.call', { tool: 'Bash' } as never, (() => new Promise(r => { release = () => r({ result: 'ok' }) })) as never)
    const w = await boot($, on)
    await spawnCrew($, 1, 'Write the parser')
    await w.clock.settle()
    await w.clock.advance(2_500)
    // From here every period the tick asks for is refused: after the one already asked for
    // (3,000 ms), it runs no more.
    w.ticker.isStopped = true
    await w.clock.advance(1_000)
    const ticked = w.reads.filter(r => r.key === 'main').length
    await w.clock.advance(3_000)
    // Set-up: the tick reads `main` each second it runs; it does not run.
    expect(w.reads.filter(r => r.key === 'main').length).toBe(ticked)
    // Each frame's next write misses. With `isHeld`, a1's call opens first, and stays open.
    const t = w.clock.now()
    w.miss.add('paneFrame')
    w.miss.add('barFrame')
    const call = isHeld ? $.tool.call({ tool: 'Bash', command: 'echo hhhh', agentId: 'a1' } as never) : null
    await w.clock.settle()
    await w.clock.advance(100)
    // A turn starts: both frames are due.
    await userTurn($)
    await w.clock.advance(1_000)
    const misses = w.writes.filter(x => isFrame(x.key) && x.at >= t && x.isSet === false)
    // Set-up: each frame missed once, in either order.
    expect(misses.map(x => x.key).sort()).toEqual(['barFrame', 'paneFrame'])
    const last = Math.max(...misses.map(x => x.seq))
    // An agent's tool call ends, and the timers run for ten minutes.
    const end = w.writes.length
    if (call) {
      release()
      await call
    } else await readFile($, '/repo/eeee.txt', 'a1')
    await w.clock.settle()
    expect(w.writes.slice(end).filter(x => isFrame(x.key)).map(x => [x.key, x.at - T0])).toEqual([])
    await w.clock.advance(600_000)
    expect(w.writes.filter(x => isFrame(x.key) && x.seq > last).map(x => [x.key, x.at - T0])).toEqual([])
  })
}

// ---------------------------------------------------------------------------
// L4: with one copy and no miss, the same frames at the same times as in 2.5.0.

test('L4: a busy stretch writes the frames of 2.5.0, at its times, and no write misses', async ($, on) => {
  const w = await boot($, on)
  await pane($)
  await band($)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.settle()
  for (const [ms, f] of [[100, 'bbbb'], [400, 'cccc'], [1_800, 'dddd'], [300, 'eeee'], [200, 'ffff']] as const) {
    await w.clock.advance(ms)
    await readFile($, `/repo/${f}.txt`, 'a1')
    await w.clock.settle()
  }
  await w.clock.advance(6_000)
  // As 2.5.0 writes them (recorded on its code).
  expect(frameTimes(w)).toEqual([
    ['paneFrame', 0],
    ['barFrame', 0],
    ['paneFrame', 1_000],
    ['paneFrame', 2_300],
    ['paneFrame', 3_300],
  ])
  expect(w.writes.filter(x => x.isSet !== true)).toEqual([])
})

test('L4: a turn with one agent, then an idle minute, writes the frames of 2.5.0, at its times, and no write misses', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on)
  await pane($)
  await band($)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.advance(400)
  await readFile($, '/repo/a.txt', 'a1')
  await w.clock.advance(1_000)
  await endAgent($, 'a1')
  await w.clock.advance(300)
  await endMainTurn($)
  await w.clock.advance(65_000)
  // As 2.5.0 writes them (recorded on its code): the turn, then B10 and B11 while idle.
  expect(frameTimes(w)).toEqual([
    ['paneFrame', 0],
    ['barFrame', 0],
    ['paneFrame', 1_000],
    ['paneFrame', 2_000],
    ['barFrame', 2_000],
    ['paneFrame', 60_000],
    ['barFrame', 60_000],
    ['paneFrame', 62_000],
    ['barFrame', 62_000],
  ])
  expect(w.writes.filter(x => x.isSet !== true)).toEqual([])
})

// ---------------------------------------------------------------------------
// K1: a write refreshes the cache (probe P7 of task 3).

for (const isLate of [false, true]) {
  const when = isLate ? 'after a tick and before the held frame timer fires' : 'before the tick that comes before the held frame timer'
  test(`K1: while a1's tool call is open, a2's line written ${when} is in the last pane frame written`, async ($, on) => {
    let release: () => void = () => undefined
    on('tool.call', { tool: 'Bash' } as never, (() => new Promise(r => { release = () => r({ result: 'ok' }) })) as never)
    const w = await boot($, on)
    await pane($)
    await band($)
    await spawnCrew($, 1, 'Write the parser')
    await spawnCrew($, 2, 'Wire the CLI')
    await w.clock.settle()
    await w.clock.advance(2_500)
    // 2,500 ms: a pane frame, held till 3,500 ms.
    await readFile($, '/repo/kkkk.txt', 'a2')
    await w.clock.settle()
    await w.clock.advance(100)
    // 2,600 ms: a1's call opens; its hook queues the held frame timer, for 3,500 ms.
    const call = $.tool.call({ tool: 'Bash', command: 'echo hhhh', agentId: 'a1' } as never)
    await w.clock.settle()
    // 2,800 ms, or 3,200 ms (after the tick of 3,000 ms): a2 reads a file.
    await w.clock.advance(isLate ? 600 : 200)
    const t = w.clock.now()
    await readFile($, '/repo/jjjj.txt', 'a2')
    await w.clock.settle()
    await w.clock.advance(4_000)
    // Set-up: a2's line is in the agents written, and a pane frame came after it.
    const after = writesOf(w, 'paneFrame', t, Infinity)
    expect({ written: holds(w.writes.filter(x => x.key === 'agents').at(-1)?.value, 'jjjj'), framesAfter: after.length >= 1 }).toEqual({ written: true, framesAfter: true })
    // The frame the held timer writes (3,500 ms), and the last one, hold it.
    expect(after.map(x => [x.at - T0, holds(x.value, 'jjjj')])[0]).toEqual([3_500, true])
    expect(holds(after.at(-1)?.value, 'jjjj')).toBe(true)
    release()
    await call
  })
}

// ---------------------------------------------------------------------------
// K2: the tick reads afresh.

test('K2: while an agent works, a value answered differently from beneath, with no write by the mod, is in a frame within one tick', async ($, on) => {
  const w = await boot($, on)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.settle()
  await w.clock.advance(2_500)
  // Set-up: the pane frame shows the row's description.
  expect({ shown: holds(w.writes.filter(x => x.key === 'paneFrame').at(-1)?.value, 'Write the parser') }).toEqual({ shown: true })
  // From 2,500 ms the agent list reads with another description, as an older copy still
  // finishing its hooks may have written it.
  const t = w.clock.now()
  w.answers.set('agents', v => (Array.isArray(v) ? v.map(a => ({ ...a, description: 'Rewrite qqqq' })) : v))
  await w.clock.advance(TICK_MS)
  expect(writesOf(w, 'agents', t, t + TICK_MS)).toEqual([])
  const panes = writesOf(w, 'paneFrame', t, t + TICK_MS)
  expect(panes.some(x => holds(x.value, 'qqqq'))).toBe(true)
})

// ---------------------------------------------------------------------------
// K2, at most one read of each value in one tick.

const NINE = ['flow', 'run', 'agents', 'retired', 'main', 'usage', 'view', 'rates', 'now']
// What the mod's values were read, tick by tick. A tick starts with its read of `main` and ends
// with its read of `now`, the last it makes (the order `seq` gives): a frame timer that fires at
// the same time as a tick, as one does at 5,000 ms, reads between two ticks and is not one of
// them. Each group is told by its tick's time from T0, which is one a tick only.
const readsByTick = (w: World, from: number, to: number) => {
  const out = new Map<number, string[]>()
  let open: string[] | null = null
  for (const r of w.reads) {
    if (r.at < from || r.at > to || isFrame(r.key)) continue
    if (r.key === 'main') {
      open = []
      out.set(r.at - T0, open)
    }
    if (!open) continue
    open.push(r.key)
    if (r.key === 'now') open = null
  }
  return out
}

test('K2: one agent works and nothing else happens: in each of five ticks, each of the nine values is read at most once', async ($, on) => {
  const w = await boot($, on)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.settle()
  await w.clock.advance(TICK_MS)
  const t = w.clock.now()
  for (let i = 0; i < 5; i++) await w.clock.advance(TICK_MS)
  const ticks = readsByTick(w, t + TICK_MS, w.clock.now())
  // Set-up: five ticks, one second apart.
  expect([...ticks.keys()]).toEqual([2_000, 3_000, 4_000, 5_000, 6_000])
  const counts = [...ticks].map(([at, keys]) => [at, Object.fromEntries(NINE.map(k => [k, keys.filter(x => x === k).length]).filter(([, n]) => (n as number) > 1))])
  expect(counts).toEqual([2_000, 3_000, 4_000, 5_000, 6_000].map(at => [at, {}]))
})

test('K2: with nothing working and nothing due, a tick reads no more values than today: at most main, agents and usage, once each', async ($, on) => {
  const w = await boot($, on)
  await w.clock.settle()
  await w.clock.advance(TICK_MS)
  const t = w.clock.now()
  await w.clock.advance(TICK_MS)
  const keys = [...readsByTick(w, t + 1, w.clock.now()).values()].flat()
  expect(keys.filter(k => !['main', 'agents', 'usage'].includes(k))).toEqual([])
  expect(keys.length).toBeLessThanOrEqual(3)
})
