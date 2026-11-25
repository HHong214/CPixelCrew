// A row that waits for approval and the 15-minute rule: the contract's C9 to C11. Such a
// row (`waiting`, its line `Waiting for your approval: …`) is spared by the sync's close (A3)
// until it has been quiet for 12 hours; every other active row is closed after STUCK_MS of
// quiet as in 2.5.0. Through the wiring, a scenario runs twice, once so and once as its twin
// (the agent listed as `running`, so the sync never closes it), on the same times of the
// mocked clock, and the row must equal the twin's. The pure `isLost` and the constants
// `APPROVAL` and `WAIT_STUCK_MS` of C10 are read through the module object, so this file
// loads before they exist. The close after 12 hours is pinned by the pure test alone: the
// mocked clock resolves every tick on the way, 43,200 of them.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, MainRun } from '../types'
import * as model from '../hooks/model'
import { STUCK_MS, isLive } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const END_LINE = 'Stopped: no longer listed'
const APPROVAL_LINE = 'Waiting for your approval: '
const TWELVE_HOURS = 12 * 60 * 60_000

const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}

type Listed = { id: string; status: string; description: string; type: string }
type Write = { key: string; at: number; value: unknown }
type World = {
  clock: ReturnType<typeof mock.clock>
  listed: Listed[]
  // Every `state.set` of the mod's values, in order, with the time it was made.
  writes: Write[]
  // A tool call whose `tool_use_id` is held here answers at that time of the mocked clock.
  holds: Map<string, number>
}

// Everything beneath the plugin, as frames.test.ts answers it, with a tool call that can be
// held open and an answer to a permission request.
async function boot($: Engine, on: On): Promise<World> {
  const stored: Record<string, unknown> = {}
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  const holds = new Map<string, number>()
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN) writes.push({ key: e.key, at: clock.now(), value: e.value })
    return next(e)
  }) as never)
  const open = new Set<string>()
  const listed: Listed[] = []
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  } as never)
  // A held call waits on the mocked clock until the time it is held to: one wait the clock
  // resolves as it passes, where a bare promise would stall the clock's advance.
  on('tool.call', (async (_$: unknown, e: { tool_use_id?: unknown }) => {
    const held = typeof e.tool_use_id === 'string' ? holds.get(e.tool_use_id) : undefined
    if (held !== undefined && held > clock.now()) await clock.sleep(held - clock.now())
    return { result: 'ok' }
  }) as never)
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
  return { clock, listed, writes, holds }
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

const lastOf = <T>(w: World, key: string): T | undefined => w.writes.filter(x => x.key === key).at(-1)?.value as T | undefined
const rowOf = (w: World, agentId = 'a1'): AgentRun | undefined => (lastOf<AgentRun[]>(w, 'agents') ?? []).find(a => a.agentId === agentId)
const mainOf = (w: World): MainRun | undefined => lastOf<MainRun>(w, 'main')

// ---------------------------------------------------------------------------
// The twin runner.

// Every field `AgentRun` declares in 2.5.0: a spared row is never closed, so it equals its twin's whole.
const FIELDS = ['id', 'agentId', 'type', 'kind', 'tint', 'description', 'model', 'effort', 'status', 'startedAt', 'endedAt', 'activeAt', 'contextTokens', 'contextMax', 'use', 'costUsd', 'steps', 'round', 'stepDone', 'stepTotal', 'stepNote', 'stepAt', 'doing', 'doingSince', 'log'] as const
type Seen = { row: Record<string, unknown>; main: { status?: string; doing?: string } }
const seenOf = (w: World): Seen => {
  const r = rowOf(w) as unknown as Record<string, unknown> | undefined
  const m = mainOf(w)
  const row: Record<string, unknown> = {}
  for (const f of FIELDS) if (r && r[f] !== undefined) row[f] = r[f]
  return { row, main: { status: m?.status, doing: m?.doing } }
}

// What each twin saw, by scenario and moment.
const TWINS = new Map<string, Map<string, Seen>>()

type Way = { $: Engine; w: World; isTwin: boolean; same: (moment: string) => Promise<void> }

// Declares a scenario twice: its twin (the agent listed as `running`), then the scenario,
// which checks what it sees equal to what the twin saw at the same moment.
function bothWays(name: string, body: (x: Way) => Promise<void>): void {
  for (const isTwin of [true, false]) {
    test(isTwin ? `${name} [twin: listed as running]` : name, { timeoutMs: 90_000 }, async ($, on) => {
      const w = await boot($, on)
      if (isTwin) w.listed.push({ id: 'a1', status: 'running', description: 'Write the parser', type: 'pixel-crew:engineer' })
      const mine = new Map<string, Seen>()
      // The moments the scenario's own run compared with its twin's.
      const compared = new Set<string>()
      if (isTwin) TWINS.set(name, mine)
      const twin = TWINS.get(name)
      if (!isTwin && !twin) throw new Error(`the twin of "${name}" did not run before it`)
      await body({
        $,
        w,
        isTwin,
        same: async moment => {
          await w.clock.settle()
          const seen = seenOf(w)
          if (isTwin) {
            mine.set(moment, seen)
            return
          }
          const ref = twin!.get(moment)
          if (!ref) throw new Error(`the twin of "${name}" saw no moment "${moment}"`)
          compared.add(moment)
          expect(ref.row.id).toBeDefined()
          expect(seen.row.status).toBe(ref.row.status)
          expect(seen.row.doing).toBe(ref.row.doing)
          expect(seen.row.endedAt).toBe(ref.row.endedAt)
          expect(seen.row.log).toEqual(ref.row.log)
          expect(seen.row).toEqual(ref.row)
          expect(seen.main).toEqual(ref.main)
        },
      })
      // Every moment the twin recorded was compared.
      if (!isTwin) expect([...compared].sort()).toEqual([...twin!.keys()].sort())
    })
  }
}

// ---------------------------------------------------------------------------
// C9 through the wiring.

bothWays('C9: a row that waits for approval past STUCK_MS is spared: equal to its twin, still waiting, and the main agent waits for 1 agent', async x => {
  const { $, w } = x
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await askPermission($, 'npm test', 'a1')
  await endMainTurn($)
  await w.clock.advance(STUCK_MS + 10_000)
  await x.same('past STUCK_MS')
  const row = rowOf(w)
  expect(row?.status).toBe('waiting')
  expect(row?.doing.startsWith(APPROVAL_LINE)).toBe(true)
  expect(row?.endedAt).toBeUndefined()
  expect(row?.log.at(-1)?.kind).toBe('wait')
  expect(mainOf(w)).toMatchObject({ status: 'waiting', doing: 'Waiting for 1 agent' })
})

test('C9, as in 2.5.0: a row waiting for another reason (the list said idle) is closed after STUCK_MS of quiet once the list drops it', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  w.listed.push({ id: 'a1', status: 'idle', description: 'Write the parser', type: 'pixel-crew:engineer' })
  await w.clock.advance(6_000)
  const waiting = rowOf(w)
  expect(waiting?.status).toBe('waiting')
  expect(waiting?.doing.startsWith(APPROVAL_LINE)).toBe(false)
  w.listed.length = 0
  await endMainTurn($)
  await w.clock.advance(STUCK_MS + 10_000)
  const row = rowOf(w)
  expect(row?.status).toBe('failed')
  expect(row?.doing).toBe('Failed')
  expect(row?.log.at(-1)?.text).toBe(END_LINE)
})

// ---------------------------------------------------------------------------
// C10, pure: `isLost` and its constants, read through the module object until they exist.

const m = model as unknown as { isLost?: unknown; APPROVAL?: unknown; WAIT_STUCK_MS?: unknown }
// `isLost`'s answer, or undefined while hooks/model.ts has no such function.
const lost = (a: AgentRun, now: number): boolean | undefined => (typeof m.isLost === 'function' ? (m.isLost as (a: AgentRun, now: number) => boolean)(a, now) : undefined)

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
const approval = agent({ status: 'waiting', doing: `${APPROVAL_LINE}Running npm test`, log: [{ at, kind: 'wait', text: `${APPROVAL_LINE}Running npm test`, outcome: 'ok' }] })
const idle = agent({ status: 'waiting', doing: 'Getting started' })
const finished = agent({ status: 'done', endedAt: at, doing: 'Finished' })
// Running, though its line is the approval line: C9 asks for both.
const runningWithLine = agent({ doing: `${APPROVAL_LINE}Running npm test` })

test('C10: APPROVAL is the approval line, and WAIT_STUCK_MS is 12 hours', async () => {
  expect(m.APPROVAL).toBe(APPROVAL_LINE)
  expect(m.WAIT_STUCK_MS).toBe(TWELVE_HOURS)
})

test('C10: isLost, a running row: not at one millisecond under STUCK_MS of quiet, and at STUCK_MS', async () => {
  expect(lost(running, at + STUCK_MS - 1)).toBe(false)
  expect(lost(running, at + STUCK_MS)).toBe(true)
})

test('C10: isLost, a row that waits for approval: not at STUCK_MS, nor one millisecond under WAIT_STUCK_MS, and at WAIT_STUCK_MS', async () => {
  expect(lost(approval, at + STUCK_MS)).toBe(false)
  expect(lost(approval, at + TWELVE_HOURS - 1)).toBe(false)
  expect(lost(approval, at + TWELVE_HOURS)).toBe(true)
})

test('C10: isLost, a row waiting without the approval line is lost at STUCK_MS', async () => {
  expect(lost(idle, at + STUCK_MS - 1)).toBe(false)
  expect(lost(idle, at + STUCK_MS)).toBe(true)
})

test('C10: isLost, a finished row is never lost, nor any row at a now that is not finite', async () => {
  expect(lost(finished, at + TWELVE_HOURS)).toBe(false)
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(lost(running, now)).toBe(false)
    expect(lost(approval, now)).toBe(false)
  }
})

test('C10, W3: isLive gives the same rows the run\'s answers, a row waiting for approval still live at STUCK_MS', async () => {
  expect(isLive(approval, at + STUCK_MS)).toBe(true)
  expect(isLive(approval, at + STUCK_MS - 1)).toBe(true)
  expect(isLive(running, at + STUCK_MS - 1)).toBe(true)
  expect(isLive(running, at + STUCK_MS)).toBe(false)
  expect(isLive(idle, at + STUCK_MS)).toBe(false)
  expect(isLive(finished, at + TWELVE_HOURS)).toBe(false)
  expect(isLive(running, Number.NaN)).toBe(true)
  expect(isLive(approval, Number.POSITIVE_INFINITY)).toBe(true)
})

test('C10: isLost, a running row whose line is the approval line is lost at STUCK_MS', async () => {
  expect(lost(runningWithLine, at + STUCK_MS - 1)).toBe(false)
  expect(lost(runningWithLine, at + STUCK_MS)).toBe(true)
})

test('C10: isLost, a now of Infinity or -Infinity gives false', async () => {
  for (const now of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(lost(running, now)).toBe(false)
    expect(lost(approval, now)).toBe(false)
    expect(lost(idle, now)).toBe(false)
  }
})
