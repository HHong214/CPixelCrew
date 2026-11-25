// The approval words come off when the approved call runs: the contract's R1 to R6 (section 3).
// A call goes through the engine's own path: `$.tool.call`, with no `tool.call` hook of the
// test beneath the mod's, so `tool.check`, the ask and `tool.run` all fire. The test's
// `tool.check` answers `{ decision: 'ask' }` for the call that needs approval, and its
// `classic.PermissionRequest` hook answers the ask (allow, after 10 s of the mocked clock, or
// deny). The test's own `tool.run` hook sits beneath the mod's and answers in place of the
// tool: it runs once the ask is settled and before the call ends, after whatever the mod's
// `tool.run` hook writes before its `next(e)`, so the rows it reads are the rows while the
// tool runs. The twin of a scenario is the same call with no ask; it runs first and the
// scenario compares what it read with the twin's.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, LogEntry, MainRun } from '../types'
import { activityOf } from '../hooks/model'
import { register } from '../hooks/register'

const PLUGIN = 'CPixelCrew'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const T1 = T0 + 1_000
const APPROVAL_LINE = 'Waiting for your approval: '
// How long the person takes to answer, on the mocked clock.
const THINK_MS = 10_000
const RESULT = { result: 'ran' }

type Write = { key: string; at: number; value: unknown }
type Answer = 'allow' | 'deny'
// A row as read at a moment: the agent's and the main agent's.
type Moment = { at: number; row: AgentRun | undefined; main: MainRun | undefined; agentWrites: number; mainWrites: number }
type World = {
  clock: ReturnType<typeof mock.clock>
  writes: Write[]
  // The commands whose `tool.check` asks.
  asks: Set<string>
  // A command whose `tool.check` waits this long before it lets the call through, with no ask.
  slowChecks: Map<string, number>
  answer: Answer
  // What the test's hooks read: at each answer to an ask, and at each run, by command.
  atAsk: Map<string, Moment>
  atRun: Map<string, Moment>
  runs: string[]
  // Armed by the answer to an ask: the mod's next write of this key, before the run, is refused.
  refuse: { key: string; armed: boolean; refused: number } | null
}

const lastOf = <T>(w: World, key: string): T | undefined => w.writes.filter(x => x.key === key).at(-1)?.value as T | undefined
const rowOf = (w: World, agentId = 'a1'): AgentRun | undefined => (lastOf<AgentRun[]>(w, 'agents') ?? []).find(a => a.agentId === agentId)
const mainOf = (w: World): MainRun | undefined => lastOf<MainRun>(w, 'main')
const momentOf = (w: World): Moment => ({
  at: w.clock.now(),
  row: rowOf(w),
  main: mainOf(w),
  agentWrites: w.writes.filter(x => x.key === 'agents').length,
  mainWrites: w.writes.filter(x => x.key === 'main').length,
})
// A call's key: its command, or the file a Read call names.
const commandOf = (e: unknown): string => {
  const x = e as { command?: unknown; file_path?: unknown; input?: { command?: unknown; file_path?: unknown } }
  return String(x.input?.command ?? x.input?.file_path ?? x.command ?? x.file_path ?? '')
}

// Everything beneath the plugin, as waiting-row.test.ts answers it, except `tool.call`: the
// engine's own path runs, with the test's `tool.check`, its answer to an ask and its `tool.run`.
async function boot($: Engine, on: On, answer: Answer = 'allow'): Promise<World> {
  const stored: Record<string, unknown> = {}
  const clock = mock.clock(on, { now: T0 })
  const w: World = { clock, writes: [], asks: new Set(), slowChecks: new Map(), answer, atAsk: new Map(), atRun: new Map(), runs: [], refuse: null }
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN && w.refuse?.armed && w.refuse.key === e.key) {
      w.refuse.armed = false
      w.refuse.refused += 1
      return { deny: 'refused by the test' }
    }
    if (e.plugin === PLUGIN) w.writes.push({ key: e.key, at: clock.now(), value: e.value })
    return next(e)
  }) as never)
  on('tool.check', (async (_$: unknown, e: unknown, next: (x: unknown) => unknown) => {
    const command = commandOf(e)
    const slow = w.slowChecks.get(command)
    if (slow !== undefined) await clock.sleep(slow)
    return w.asks.has(command) ? { decision: 'ask' } : next(e)
  }) as never)
  // Beneath the mod's hook: read once the mod has written the wait.
  on('classic.PermissionRequest', (async (_$: unknown, e: { tool_input?: unknown }) => {
    const command = commandOf({ input: e.tool_input })
    w.atAsk.set(command, momentOf(w))
    if (w.answer === 'deny') return { decision: { behavior: 'deny', message: 'no' } }
    await clock.sleep(THINK_MS)
    if (w.refuse) w.refuse.armed = true
    return { decision: { behavior: 'allow' } }
  }) as never)
  // Beneath the mod's hook: answers in place of the tool, so it reads the moment the tool runs.
  on('tool.run', ((_$: unknown, e: unknown) => {
    // Only a write between the answer and the run is refused.
    if (w.refuse) w.refuse.armed = false
    const command = commandOf(e)
    w.runs.push(command)
    w.atRun.set(command, momentOf(w))
    return RESULT
  }) as never)
  const open = new Set<string>()
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  } as never)
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
  on('session.usage', (() => ({ value: { startedAt: T0 - 60_000 } })) as never)
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
  return w
}

// A turn of the main agent is under way, with one agent a1 spawned in it, at T0; the clock then
// stands at T1.
async function setUp($: Engine, on: On, answer: Answer = 'allow'): Promise<World> {
  const w = await boot($, on, answer)
  await $.prompt.submit({ text: 'Go', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Go', turnId: 't1' } as never)
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'Do this: Write the parser.',
    description: 'Write the parser',
    subagentType: 'pixel-crew:engineer',
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
  await w.clock.advance(T1 - T0)
  return w
}

type Loop = 'agent' | 'main'
const LOOPS: Loop[] = ['agent', 'main']
const loopOf = (loop: Loop): { agentId?: string } => (loop === 'agent' ? { agentId: 'a1' } : {})
const seenOf = (m: Moment | undefined, loop: Loop): AgentRun | MainRun | undefined => (loop === 'agent' ? m?.row : m?.main)

// A session started with no prompt and no turn; the clock then stands at T1.
async function setUpIdle($: Engine, on: On): Promise<World> {
  const w = await boot($, on)
  await w.clock.advance(T1 - T0)
  return w
}

// The call `npm test` in the loop, past the person's answer: its result.
async function callNpmTest($: Engine, w: World, loop: Loop): Promise<unknown> {
  const call = $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1', ...loopOf(loop) } as never)
  await w.clock.advance(THINK_MS + 1_000)
  return call
}

const endOf = (w: World, loop: Loop): AgentRun | MainRun | undefined => (loop === 'agent' ? rowOf(w) : mainOf(w))

// ---------------------------------------------------------------------------
// R2: while the approved tool runs, the row equals its twin's (the same call allowed with no ask).

// What each twin read while its tool ran, and at the call's end, by loop.
type Twin = { status?: string; doing?: string; end: { status?: string; doing?: string } }
const TWINS = new Map<Loop, Twin>()

for (const loop of LOOPS) {
  const name = loop === 'agent' ? "R2: while an approved call of an agent runs, its row reads as its twin's: the call's own line, running" : "R2: while an approved call of the main agent runs during a turn, it reads as its twin's: the call's own line, working"

  test(`${name} [twin: allowed with no ask]`, { timeoutMs: 30_000 }, async ($, on) => {
    const w = await setUp($, on)
    await callNpmTest($, w, loop)
    expect(w.atAsk.size).toBe(0)
    const seen = seenOf(w.atRun.get('npm test'), loop)
    expect(seen).toBeDefined()
    await w.clock.settle()
    const end = endOf(w, loop)
    TWINS.set(loop, { status: seen?.status, doing: seen?.doing, end: { status: end?.status, doing: end?.doing } })
  })

  test(name, { timeoutMs: 30_000 }, async ($, on) => {
    const twin = TWINS.get(loop)
    if (!twin) throw new Error(`the twin of "${name}" did not run before it`)
    const w = await setUp($, on)
    w.asks.add('npm test')
    await callNpmTest($, w, loop)
    const asked = w.atAsk.get('npm test')
    const ran = w.atRun.get('npm test')
    expect(asked).toBeDefined()
    expect(ran).toBeDefined()
    // The set-up: the ask was raised and the row waited for approval of this call.
    expect(seenOf(asked, loop)?.doing).toBe(`${APPROVAL_LINE}Running npm test`)
    expect(seenOf(asked, loop)?.status).toBe('waiting')
    expect(ran!.at).toBe(asked!.at + THINK_MS)
    const seen = seenOf(ran, loop)
    // The rule.
    expect(seen?.status).toBe(twin.status)
    expect(seen?.doing).toBe(twin.doing)
    expect(seen?.status).toBe(loop === 'agent' ? 'running' : 'working')
    expect(seen?.doing).toBe('Running npm test')
    expect(seen!.doingSince).toBeGreaterThanOrEqual(asked!.at)
    expect(seen!.doingSince).toBe(ran!.at)
  })

  test(`R2 (${loop}), at the end of an approved call: status and line as the twin's at its end, the wait line kept and the call's entry closed ok`, { timeoutMs: 30_000 }, async ($, on) => {
    const twin = TWINS.get(loop)
    if (!twin) throw new Error(`the twin of "${name}" did not run before it`)
    const w = await setUp($, on)
    w.asks.add('npm test')
    expect(await callNpmTest($, w, loop)).toEqual(RESULT)
    await w.clock.settle()
    expect(w.atAsk.has('npm test')).toBe(true)
    const end = endOf(w, loop)
    expect(end?.status).toBe(twin.end.status)
    expect(end?.doing).toBe(twin.end.doing)
    const log = end?.log ?? []
    expect(log.some((x: LogEntry) => x.kind === 'wait' && x.text === `${APPROVAL_LINE}Running npm test`)).toBe(true)
    expect(log.filter((x: LogEntry) => x.callId === 'c1').map(x => x.outcome)).toEqual(['ok'])
  })
}

// R1 and R2: a tool other than Bash that needs an ask comes off its approval words the same way.
test("R1/R2: while an approved Read of an agent runs, its row reads the Read's own line, running, since the run's start", { timeoutMs: 30_000 }, async ($, on) => {
  const file = '/repo/src/parser.ts'
  const line = activityOf('Read', { file_path: file })
  const w = await setUp($, on)
  w.asks.add(file)
  const call = $.tool.call({ tool: 'Read', file_path: file, tool_use_id: 'c2', agentId: 'a1' } as never)
  await w.clock.advance(THINK_MS + 1_000)
  expect(await call).toEqual(RESULT)
  const asked = w.atAsk.get(file)
  const ran = w.atRun.get(file)
  expect(asked).toBeDefined()
  expect(ran).toBeDefined()
  // The set-up: the row waited for approval of this Read.
  expect(asked!.row?.status).toBe('waiting')
  expect(asked!.row?.doing).toBe(`${APPROVAL_LINE}${line}`)
  // The rule.
  expect(ran!.row?.status).toBe('running')
  expect(ran!.row?.doing).toBe(line)
  expect(ran!.row?.doingSince).toBe(ran!.at)
})

// R2: with no turn running, the main agent's line comes off its approval words and its status is left.
test('R2 (main, no turn running): while the approved call runs, the line is the call\'s own and the status is what it was at the ask', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await setUpIdle($, on)
  w.asks.add('npm test')
  expect(await callNpmTest($, w, 'main')).toEqual(RESULT)
  const asked = w.atAsk.get('npm test')
  const ran = w.atRun.get('npm test')
  expect(asked).toBeDefined()
  expect(ran).toBeDefined()
  expect(asked!.main?.turnStartedAt ?? null).toBeNull()
  expect(asked!.main?.doing).toBe(`${APPROVAL_LINE}Running npm test`)
  // The rule.
  expect(ran!.main?.doing).toBe('Running npm test')
  expect(ran!.main?.status).toBe(asked!.main?.status)
})

// R5: a failure of the hook's own bookkeeping is swallowed. The mod's first write of the row
// after the answer and before the run (its own write at the run's start) is refused.
for (const loop of LOOPS) {
  test(`R5 (${loop}): with the mod's write at the run's start refused, the call still returns the tool's result and the tool runs once`, { timeoutMs: 30_000 }, async ($, on) => {
    const w = await setUp($, on)
    w.asks.add('npm test')
    w.refuse = { key: loop === 'agent' ? 'agents' : 'main', armed: false, refused: 0 }
    const result = await callNpmTest($, w, loop)
    expect(w.atAsk.has('npm test')).toBe(true)
    expect(result).toEqual(RESULT)
    expect(w.runs).toEqual(['npm test'])
    expect(w.refuse.refused).toBeLessThanOrEqual(1)
  })
}

// ---------------------------------------------------------------------------
// R4 and R5, for the agent's row and the main agent.

for (const loop of LOOPS) {
  test(`R4 (${loop}): the log is the same just before and just after the approved call starts to run: the wait line is there and the call's entry is open`, { timeoutMs: 30_000 }, async ($, on) => {
    const w = await setUp($, on)
    w.asks.add('npm test')
    await callNpmTest($, w, loop)
    const before = seenOf(w.atAsk.get('npm test'), loop)?.log ?? []
    const after = seenOf(w.atRun.get('npm test'), loop)?.log ?? []
    expect(before.some((x: LogEntry) => x.kind === 'wait' && x.text === `${APPROVAL_LINE}Running npm test`)).toBe(true)
    expect(before.some((x: LogEntry) => x.kind === 'tool' && x.callId === 'c1' && x.outcome === 'open')).toBe(true)
    expect(after).toEqual(before)
  })

  test(`R5 (${loop}): the approved call's result comes back as the tool gave it, and the tool runs once`, { timeoutMs: 30_000 }, async ($, on) => {
    const w = await setUp($, on)
    w.asks.add('npm test')
    const result = await callNpmTest($, w, loop)
    expect(w.atAsk.has('npm test')).toBe(true)
    expect(result).toEqual(RESULT)
    expect(w.runs).toEqual(['npm test'])
  })
}

// ---------------------------------------------------------------------------
// R6, as in 2.5.0: a denied call at its end, and the writes of a call that needs no approval.
// The expected values are what 2.5.0 writes in these set-ups.

const note: LogEntry = { at: T0, kind: 'note', text: 'Started as Refactor on Haiku 4.5', outcome: 'ok' }
const turn: LogEntry = { at: T0, kind: 'turn', text: 'Go', outcome: 'ok' }
const call = (outcome: 'open' | 'ok' | 'error'): LogEntry => ({ at: T1, kind: 'tool', text: 'Running npm test', outcome, callId: 'c1', ...(outcome === 'open' ? {} : { ms: 0 }) }) as LogEntry
const wait: LogEntry = { at: T1, kind: 'wait', text: `${APPROVAL_LINE}Running npm test`, outcome: 'ok' }
const headOf = (loop: Loop): LogEntry => (loop === 'agent' ? note : turn)
const lineOf = (r: AgentRun | MainRun | undefined) => ({ status: r?.status, doing: r?.doing, doingSince: r?.doingSince, log: r?.log })

for (const loop of LOOPS) {
  test(`R6 (${loop}), as in 2.5.0: a denied call reads at its end as it did`, { timeoutMs: 30_000 }, async ($, on) => {
    const w = await setUp($, on, 'deny')
    w.asks.add('npm test')
    const result = (await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1', ...loopOf(loop) } as never)) as { isError?: boolean }
    await w.clock.settle()
    expect(w.atAsk.has('npm test')).toBe(true)
    expect(w.runs).toEqual([])
    expect(result.isError).toBe(true)
    const end = loop === 'agent' ? rowOf(w) : mainOf(w)
    expect(lineOf(end)).toEqual({ status: loop === 'agent' ? 'running' : 'working', doing: 'Running npm test', doingSince: T1, log: [headOf(loop), call('error'), wait] })
  })

  test(`R6 (${loop}), as in 2.5.0: a call that needs no approval writes the same rows as it did`, { timeoutMs: 30_000 }, async ($, on) => {
    const w = await setUp($, on)
    const key = loop === 'agent' ? 'agents' : 'main'
    const from = w.writes.length
    const result = await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1', ...loopOf(loop) } as never)
    await w.clock.settle()
    expect(result).toEqual(RESULT)
    const written = w.writes.slice(from).filter(x => x.key === key).map(x => lineOf(loop === 'agent' ? (x.value as AgentRun[]).find(a => a.agentId === 'a1') : (x.value as MainRun)))
    const status = loop === 'agent' ? 'running' : 'working'
    expect(written).toEqual([
      { status, doing: 'Running npm test', doingSince: T1, log: [headOf(loop), call('open')] },
      { status, doing: 'Running npm test', doingSince: T1, log: [headOf(loop), call('ok')] },
    ])
  })
}

// ---------------------------------------------------------------------------
// R3: a row that waits for the approval of another call is left as it is while a call of the
// same agent runs. `ls` starts first and its check holds it 3 s; `npm test` starts after it,
// asks at T1, and its answer comes 10 s later; so `ls` runs while the row waits for `npm test`.

test("R3: while another call of the agent runs, a row that waits for the approval of a different call is left as it is, and nothing is written", { timeoutMs: 30_000 }, async ($, on) => {
  const w = await setUp($, on)
  w.asks.add('npm test')
  w.slowChecks.set('ls', 3_000)
  const ls = $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'cB', agentId: 'a1' } as never)
  const npm = $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'c1', agentId: 'a1' } as never)
  await w.clock.advance(THINK_MS + 1_000)
  expect(await ls).toEqual(RESULT)
  expect(await npm).toEqual(RESULT)
  const asked = w.atAsk.get('npm test')
  const ran = w.atRun.get('ls')
  expect(asked).toBeDefined()
  expect(ran).toBeDefined()
  // The set-up: the row waits for approval of `npm test`; `ls` started before the ask and ran
  // after it, before the answer.
  expect(asked!.row?.status).toBe('waiting')
  expect(asked!.row?.doing).toBe(`${APPROVAL_LINE}Running npm test`)
  expect(asked!.row?.log.some(x => x.callId === 'cB' && x.outcome === 'open')).toBe(true)
  expect(ran!.at).toBeGreaterThan(asked!.at)
  expect(ran!.at).toBeLessThan(asked!.at + THINK_MS)
  // The rule.
  expect(ran!.row).toEqual(asked!.row)
  expect(ran!.agentWrites).toBe(asked!.agentWrites)
})

// ---------------------------------------------------------------------------
// R1: `register` hooks `tool.run` for every tool, with no matcher. Last in the file: calling
// `register` starts this load's module state afresh, and no test after it boots.

test('R1: register hooks tool.run once, with no matcher', async () => {
  const calls: unknown[][] = []
  const chain: { catch: () => unknown } = { catch: () => chain }
  const recorder = ((...args: unknown[]) => {
    calls.push(args)
    return chain
  }) as never
  register(recorder, {} as never)
  const runs = calls.filter(c => c[0] === 'tool.run')
  expect(runs).toHaveLength(1)
  expect(runs[0]).toHaveLength(2)
  expect(typeof runs[0]?.[1]).toBe('function')
})
