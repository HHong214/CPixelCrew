// A row that waits for approval keeps its run open (the contract's section 4, W1 to W4). For
// the run, such a row (`waiting`, its line starting `APPROVAL`) is live until it has been
// quiet for WAIT_STUCK_MS; every other active row is live until STUCK_MS of quiet, as in
// 2.5.0. So `isLive` is `isLost`'s question turned round, and what the run counts follows:
// `runQuiet`, `runCounts`, `runFlow`, `runFill`, `closedRun` and `planFill`. The 12-hour
// limit is pinned by the pure tests alone: the mocked clock resolves every tick on the way.
// Through the wiring, the scenario is C9's (tests/waiting-row.test.ts): 16 quiet minutes
// into an unanswered request, then a person's prompt.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, Flow, Lost, Run } from '../types'
import { APPROVAL, STUCK_MS, WAIT_STUCK_MS, closedRun, isLive, isMarked, partialOf, planFill, runCounts, runFill, runFlow, runQuiet } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const T0 = Date.parse('2026-11-13T10:00:00Z')

// ---------------------------------------------------------------------------
// The rows, pure. Each was last active at `at`; a test asks at `at` plus some quiet.

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
const running = agent()
const approval = agent({ status: 'waiting', doing: `${APPROVAL}Running npm test`, log: [{ at, kind: 'wait', text: `${APPROVAL}Running npm test`, outcome: 'ok' }] })
// Waiting for another reason: the list said idle.
const idle = agent({ status: 'waiting', doing: 'Getting started' })
// Running, though its line is the approval line: it does not wait for approval.
const runningWithLine = agent({ doing: `${APPROVAL}Running npm test` })
const done = agent({ status: 'done', endedAt: at, doing: 'Finished' })
const failed = agent({ status: 'failed', endedAt: at, doing: 'Failed' })
const endedWithLine = agent({ status: 'done', endedAt: at, doing: `${APPROVAL}Running npm test` })
// A row the 15-minute rule closed while it waited for approval: its mark fits (C12).
const mark: Lost = { at: at + STUCK_MS, status: 'waiting', doing: `${APPROVAL}Running npm test`, doingSince: at, open: [1] } as Lost
const marked = agent({ status: 'failed', endedAt: at + STUCK_MS, doing: 'Failed', lost: mark })

// A run of the one row `a1`, joined at `at`.
const runOf1: Run = { startedAt: at, ids: ['a1'], high: 0, joinedAt: at }

// ---------------------------------------------------------------------------
// W1: isLive, to the millisecond.

test('W1: isLive, a running row: live one millisecond under STUCK_MS of quiet, not at STUCK_MS', async () => {
  expect(isLive(running, at + STUCK_MS - 1)).toBe(true)
  expect(isLive(running, at + STUCK_MS)).toBe(false)
  expect(isLive(running, at + WAIT_STUCK_MS)).toBe(false)
})

test('W1: isLive, a row that waits for approval: live at STUCK_MS and one millisecond under WAIT_STUCK_MS, not at WAIT_STUCK_MS', async () => {
  expect(isLive(approval, at + STUCK_MS)).toBe(true)
  expect(isLive(approval, at + WAIT_STUCK_MS - 1)).toBe(true)
  expect(isLive(approval, at + STUCK_MS - 1)).toBe(true)
  expect(isLive(approval, at + WAIT_STUCK_MS)).toBe(false)
})

test('W1: isLive, a row waiting for another reason, and a running row with the approval line: live one millisecond under STUCK_MS, not at STUCK_MS', async () => {
  for (const row of [idle, runningWithLine]) {
    expect(isLive(row, at + STUCK_MS - 1)).toBe(true)
    expect(isLive(row, at + STUCK_MS)).toBe(false)
  }
})

test('W1: isLive, an ended row is never live, with the approval line or a mark', async () => {
  for (const row of [done, failed, endedWithLine, marked]) {
    for (const now of [at, at + STUCK_MS - 1, at + STUCK_MS, at + WAIT_STUCK_MS - 1, at + WAIT_STUCK_MS]) expect(isLive(row, now)).toBe(false)
  }
})

test('W1, as today: at a now that is not finite, an active row is live and an ended row is not', async () => {
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const row of [running, approval, idle, runningWithLine]) expect(isLive(row, now)).toBe(true)
    for (const row of [done, failed, marked]) expect(isLive(row, now)).toBe(false)
  }
})

// ---------------------------------------------------------------------------
// W2: the run's quiet list.

test('W2: runQuiet, a run of one row that waits for approval, at STUCK_MS: live, not stuck', async () => {
  expect(runQuiet(runOf1, [approval], at + STUCK_MS)).toEqual({ stuck: [], live: ['a1'] })
  expect(runQuiet(runOf1, [approval], at + WAIT_STUCK_MS - 1)).toEqual({ stuck: [], live: ['a1'] })
})

test('W2: runQuiet, a run of one row that waits for approval, at WAIT_STUCK_MS: stuck, not live', async () => {
  expect(runQuiet(runOf1, [approval], at + WAIT_STUCK_MS)).toEqual({ stuck: ['a1'], live: [] })
})

test('W2: runQuiet, a row whose mark fits is stuck, not live', async () => {
  expect(isMarked(marked)).toBe(true)
  expect(runQuiet(runOf1, [marked], at + STUCK_MS + 1_000)).toEqual({ stuck: ['a1'], live: [] })
})

test('W2: runQuiet never holds a row in both lists, and its live list is what isLive answers', async () => {
  const rows = [running, approval, idle, runningWithLine, done, failed, endedWithLine, marked]
  const nows = [at, at + STUCK_MS - 1, at + STUCK_MS, at + WAIT_STUCK_MS - 1, at + WAIT_STUCK_MS, Number.NaN, Number.POSITIVE_INFINITY]
  for (const row of rows) {
    for (const now of nows) {
      const q = runQuiet(runOf1, [row], now)
      expect(q.stuck.filter(id => q.live.includes(id))).toEqual([])
      expect(q.live).toEqual(isLive(row, now) ? ['a1'] : [])
    }
  }
  expect(runQuiet(runOf1, [running], at + STUCK_MS).stuck).toEqual(['a1'])
  expect(runQuiet(runOf1, [idle], at + STUCK_MS).stuck).toEqual(['a1'])
})

// ---------------------------------------------------------------------------
// W4: what the run counts at STUCK_MS of quiet, with no further change.

test('W4: runCounts, a run of one row that waits for approval, at STUCK_MS: d is 0 and the row is live', async () => {
  const c = runCounts(runOf1, [approval], at + STUCK_MS)
  expect(c.d).toBe(0)
  expect(c.n).toBe(1)
  expect(c.live.map(a => a.id)).toEqual(['a1'])
})

test('W4: runFlow, a run of one row that waits for approval, at STUCK_MS: Agents 0/1, not finished', async () => {
  const f = runFlow(runOf1, [approval], at + STUCK_MS)
  expect(f?.isFinished).toBe(false)
  expect(f).toMatchObject({ total: 1, done: 0, running: 1 })
})

test('W4: runFill, a run of one row that waits for approval, at STUCK_MS: the waiting agent\'s part, not the whole', async () => {
  const now = at + STUCK_MS
  expect(runFill(runOf1, [approval], now)).toBe(partialOf(approval, now))
  expect(partialOf(approval, now)).toBeLessThan(1)
})

test('W4: closedRun leaves the run open at STUCK_MS of quiet while its row waits for approval, and ends it at WAIT_STUCK_MS', async () => {
  expect(closedRun(runOf1, [approval], at + STUCK_MS, at + STUCK_MS)).toBe(runOf1)
  expect(closedRun(runOf1, [approval], at + WAIT_STUCK_MS - 1, at + WAIT_STUCK_MS - 1)).toBe(runOf1)
  expect(closedRun(runOf1, [approval], at + WAIT_STUCK_MS, at + WAIT_STUCK_MS)?.endedAt).toBe(at + WAIT_STUCK_MS)
})

test('W4: planFill still counts the part of an agent on a planned task that waits for approval, at STUCK_MS', async () => {
  const flow: Flow = {
    title: 'Ship it',
    total: 2,
    done: 0,
    running: 1,
    phase: 'delegate',
    isFinished: false,
    tasks: [
      { title: 'Do it', kind: '', model: '', effort: '', after: [] },
      { title: 'Then this', kind: '', model: '', effort: '', after: [] },
    ],
  }
  const now = at + STUCK_MS
  expect(planFill(flow, [approval], now)).toBe(partialOf(approval, now) / 2)
  expect(partialOf(approval, now)).toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// Through the wiring: C9's scenario (tests/waiting-row.test.ts), with the bar read.

const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}

type Write = { key: string; at: number; value: unknown }
type World = { clock: ReturnType<typeof mock.clock>; writes: Write[] }

// Everything beneath the plugin, as tests/waiting-row.test.ts answers it: an empty agent
// list, and a permission request answered with nothing.
async function boot($: Engine, on: On): Promise<World> {
  const stored: Record<string, unknown> = {}
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN) writes.push({ key: e.key, at: clock.now(), value: e.value })
    return next(e)
  }) as never)
  const open = new Set<string>()
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  } as never)
  on('tool.call', (() => ({ result: 'ok' })) as never)
  on('classic.PermissionRequest', (() => ({ value: {} })) as never)
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
  return { clock, writes }
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

async function askPermission($: Engine, command: string, agentId: string): Promise<void> {
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command }, agent_id: agentId, permission_mode: 'default' } as never)
}

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

// The bar's words once the frame of every event before it has landed (tests/reopen.test.ts).
async function barWords($: Engine, w: World): Promise<string> {
  await w.clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS as never })
  await w.clock.settle()
  const text = await words(ui)
  await ui.unmount()
  return text
}

const lastOf = <T>(w: World, key: string): T | undefined => w.writes.filter(x => x.key === key).at(-1)?.value as T | undefined
const rowOf = (w: World, agentId = 'a1'): AgentRun | undefined => (lastOf<AgentRun[]>(w, 'agents') ?? []).find(a => a.agentId === agentId)
const runOf = (w: World): Run | undefined => lastOf<Run>(w, 'run')
// What the bar says of the run, as its progress row's alt words it: `Agents d/n, f%`, each
// distinct reading once.
const readingOf = (bar: string): string[] => [...new Set(bar.match(/Agents \d+\/\d+, \d+%/g) ?? [])]

// C9's set-up: the agent asks for approval and the main turn ends; nobody answers. The bar is
// read one minute in (the reading the rule keeps: `Agents 0/1, 50%` on 2.5.0, an agent with no
// steps reported creeping to half its part at most), then 16 quiet minutes in.
async function unanswered($: Engine, w: World): Promise<{ oneMinute: string; sixteen: string }> {
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await askPermission($, 'npm test', 'a1')
  await endMainTurn($)
  await w.clock.advance(60_000)
  const oneMinute = await barWords($, w)
  await w.clock.advance(STUCK_MS - 1_000)
  const sixteen = await barWords($, w)
  return { oneMinute, sixteen }
}

test('W4 through the wiring: 16 quiet minutes into an unanswered request, the row still waits and the bar reads Agents 0/1, as it did one minute in', { timeoutMs: 90_000 }, async ($, on) => {
  const w = await boot($, on)
  const { oneMinute, sixteen } = await unanswered($, w)
  expect(w.clock.now()).toBeGreaterThanOrEqual(T0 + STUCK_MS + 60_000)
  expect(rowOf(w)?.status).toBe('waiting')
  expect(rowOf(w)?.doing.startsWith(APPROVAL)).toBe(true)
  expect(readingOf(oneMinute)).toEqual(['Agents 0/1, 50%'])
  expect(readingOf(sixteen)).toEqual(['Agents 0/1, 50%'])
  expect(sixteen).not.toContain('Agents 1/1')
})

test('W4 through the wiring: a person\'s prompt 16 quiet minutes into an unanswered request leaves the run open and the bar unchanged', { timeoutMs: 90_000 }, async ($, on) => {
  const w = await boot($, on)
  const { sixteen } = await unanswered($, w)
  await userTurn($, 'Next', 't2')
  expect(runOf(w)).toBeDefined()
  expect(runOf(w)?.endedAt).toBeUndefined()
  const after = await barWords($, w)
  expect(readingOf(after)).toEqual(readingOf(sixteen))
  expect(readingOf(after)).toEqual(['Agents 0/1, 50%'])
  expect(rowOf(w)?.status).toBe('waiting')
})
