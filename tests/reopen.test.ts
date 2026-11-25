// A row that the 15-minute rule closed (A3: quiet for STUCK_MS, and not listed by
// `agent.list`) is reopened by its agent's next event: the contract's C1 to C8. Each scenario
// runs twice, once so and once as its twin, the same agent listed as `running` (so the sync
// never closes it), on the same times of the mocked clock; the reopened row and the main agent
// must equal the twin's. A test can hold one engine only, so the twin runs as the test just
// before its scenario and leaves what it saw in `TWINS`; the scenario compares with it. Events
// go in; what comes out is each `state.set` of the mod's values and a mounted pane or bar.
// No test reads the mark the close leaves on a row (C1); the C12 tests store `lost` (its name
// is fixed by C12) and check only that a mark that does not fit is gone after the next event.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, MainRun } from '../types'
import { STUCK_MS, runQuiet } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const STEP = 'mcp__CPixelCrew__step'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const END_LINE = 'Stopped: no longer listed'
const LOG_LINES = 5

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
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
  // The agent ids the next spawns answer with, before a1, a2 and on: a spawn again of a known agent.
  respawn: string[]
}

// Everything beneath the plugin, as frames.test.ts answers it, with Log lines at 5 and a
// tool call that can be held open. `junk`: what the mod's values hold at load, as an earlier
// load may have left them; each reads so until the mod writes it (frames.test.ts).
async function boot($: Engine, on: On, o: { junk?: Record<string, unknown> } = {}): Promise<World> {
  const stored: Record<string, unknown> = { sizes: { textSize: 100, iconSize: 200, barSize: 100, logLines: LOG_LINES } }
  const junk: Record<string, unknown> = { ...o.junk }
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  const holds = new Map<string, number>()
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN) {
      writes.push({ key: e.key, at: clock.now(), value: e.value })
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
  const respawn: string[] = []
  on('agent.spawn', (() => {
    const again = respawn.shift()
    if (again) return { model: 'claude-haiku-4-5', agentId: again }
    spawned += 1
    return { model: 'claude-haiku-4-5', agentId: `a${spawned}` }
  }) as never)
  on('prompt.submit', ((_$: unknown, e: { text: string }) => ({ text: e.text })) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  return { clock, listed, writes, holds, respawn }
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

async function readFile($: Engine, path: string, agentId: string, id: string): Promise<unknown> {
  return $.tool.call({ tool: 'Read', file_path: path, agentId, tool_use_id: id } as never)
}

// A tool call of the agent held open beneath the plugin until `endsAt` on the mocked clock:
// started now, and answered by `release`, which moves the clock there. The kit lets a hook go
// after ten seconds of real time, so a test releases it well before then.
async function holdCall($: Engine, w: World, path: string, agentId: string, id: string, endsAt: number): Promise<{ release: () => Promise<void> }> {
  w.holds.set(id, endsAt)
  const call = readFile($, path, agentId, id)
  await w.clock.settle()
  return {
    release: async () => {
      await w.clock.advance(Math.max(0, endsAt - w.clock.now()))
      await call
      await w.clock.settle()
    },
  }
}

// One model request of the agent's loop, pulled through to its end.
async function agentStep($: Engine, agentId: string): Promise<void> {
  const s = $.turn.step({ index: 0, model: 'claude-haiku-4-5', messageCount: 1, turnId: `r-${agentId}`, agentId } as never) as unknown as AsyncIterator<unknown>
  for (let i = 0; i < 100; i += 1) if ((await s.next()).done) break
}

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

// A site's words once the frame of every event before it has landed (frames.test.ts, A5).
async function siteWords($: Engine, w: World, component: 'Pane' | 'AbovePrompt'): Promise<string> {
  await w.clock.advance(1_000)
  const ui = await $.ui.mount(
    component === 'Pane'
      ? { plugin: PLUGIN, surface: 'desktop', component, requestId: 'crew-agents', props: PANE_PROPS as never }
      : { plugin: PLUGIN, surface: 'desktop', component, props: BAND_PROPS as never },
  )
  await w.clock.settle()
  const text = await words(ui)
  await ui.unmount()
  return text
}

const lastOf = <T>(w: World, key: string): T | undefined => w.writes.filter(x => x.key === key).at(-1)?.value as T | undefined
const rowOf = (w: World, agentId = 'a1'): AgentRun | undefined => (lastOf<AgentRun[]>(w, 'agents') ?? []).find(a => a.agentId === agentId)
const mainOf = (w: World): MainRun | undefined => lastOf<MainRun>(w, 'main')
const runOf = (w: World): { high?: number; quiet?: string[] } | undefined => lastOf(w, 'run')

// ---------------------------------------------------------------------------
// The twin runner.

// The fields `AgentRun` declares in 2.5.0, less `activeAt`: what a reopened row and its twin share.
const FIELDS = ['id', 'agentId', 'type', 'kind', 'tint', 'description', 'model', 'effort', 'status', 'startedAt', 'endedAt', 'contextTokens', 'contextMax', 'use', 'costUsd', 'steps', 'round', 'stepDone', 'stepTotal', 'stepNote', 'stepAt', 'doing', 'doingSince', 'log'] as const
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

type Way = {
  $: Engine
  w: World
  isTwin: boolean
  // The twin records the row and the main agent; the scenario's own run checks them equal to the twin's.
  same: (moment: string) => Promise<void>
}

// Declares a scenario twice: its twin (the agent listed as `running`), then the scenario.
function bothWays(name: string, body: (x: Way) => Promise<void>, o: { junk?: Record<string, unknown>; noMain?: boolean } = {}): void {
  for (const isTwin of [true, false]) {
    test(isTwin ? `${name} [twin: listed as running]` : name, { timeoutMs: 90_000 }, async ($, on) => {
      const w = await boot($, on, o)
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
          if (!o.noMain) expect(seen.main).toEqual(ref.main)
        },
      })
      // Every moment the twin recorded was compared.
      if (!isTwin) expect([...compared].sort()).toEqual([...twin!.keys()].sort())
      if (isTwin) TWINS.set(name, mine)
    })
  }
}

// The base scenario up to the close: a main turn, agent a1 spawned and `reads` of its tool
// calls, the main turn ends, and the clock passes STUCK_MS until the sync has closed the row
// (the twin's row stays `running`).
async function toClose(x: Way, o: { reads?: number } = {}): Promise<void> {
  const { $, w } = x
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  for (let i = 0; i < (o.reads ?? 3); i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
  await endMainTurn($)
  await w.clock.advance(STUCK_MS + 5_000)
  await w.clock.advance(1_000)
  const row = rowOf(w)
  if (x.isTwin) {
    expect(row?.status).toBe('running')
  } else {
    // Set-up: the sync closed it, as A3 does in 2.5.0.
    expect(row?.status).toBe('failed')
    expect(row?.doing).toBe('Failed')
    expect(row?.log.at(-1)?.text).toBe(END_LINE)
  }
}

// ---------------------------------------------------------------------------
// C3 and C4: each event that reopens, the row then equal to its twin's.

bothWays('C3: a model request of the agent (turn.step) reopens the row', async x => {
  await toClose(x)
  await agentStep(x.$, 'a1')
  await x.same('reopened')
  expect(rowOf(x.w)?.doing).not.toBe('Failed')
})

bothWays('C3: turn.start of the agent reopens the row', async x => {
  await toClose(x)
  await x.$.turn.start({ text: 'Go on', turnId: 'r-a1', agentId: 'a1' } as never)
  await x.same('reopened')
  expect(rowOf(x.w)?.doing).not.toBe('Failed')
})

bothWays('C3: a new tool call of the agent reopens the row as it starts', async x => {
  await toClose(x)
  const held = await holdCall(x.$, x.w, '/repo/next.ts', 'a1', 'tu-next', x.w.clock.now() + 500)
  try {
    await x.same('started')
    expect(rowOf(x.w)?.status).toBe('running')
    expect(rowOf(x.w)?.log.at(-1)).toMatchObject({ callId: 'tu-next', outcome: 'open' })
  } finally {
    // Answered whatever the checks found, so no call outlives the test.
    await held.release()
  }
  await x.same('ended')
})

bothWays('C3: a call of the step tool reopens the row', async x => {
  await toClose(x)
  const answer = (await x.$.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 3, note: 'Parser drafted' } as never)) as { result?: unknown }
  expect(String(answer.result)).toBe('ok')
  await x.same('reopened')
  expect(rowOf(x.w)?.status).toBe('running')
})

bothWays('C3: a permission request of the agent reopens the row, which then waits for approval', async x => {
  await toClose(x)
  await x.$.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', permission_mode: 'default' } as never)
  await x.same('reopened')
  expect(rowOf(x.w)?.status).toBe('waiting')
  expect(rowOf(x.w)?.endedAt).toBeUndefined()
})

bothWays('C3: turn.complete of the agent reopens the row, which then ends done as a live row ends', async x => {
  await toClose(x)
  await endAgent(x.$, 'a1')
  await x.same('ended')
  expect(rowOf(x.w)?.status).toBe('done')
  expect(rowOf(x.w)?.log.filter(e => e.text === END_LINE)).toEqual([])
})

// ---------------------------------------------------------------------------
// C2 and C4: the log.

bothWays('C2, C4: the close keeps a 200-entry log whole (201 with its end line), and the reopen gives the log back entry for entry', async x => {
  const { $, w } = x
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  for (let i = 0; i < 210; i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
  expect(rowOf(w)?.log.length).toBe(200)
  const before = rowOf(w)!.log
  await endMainTurn($)
  await w.clock.advance(STUCK_MS + 5_000)
  await w.clock.advance(1_000)
  const closed = rowOf(w)!
  if (x.isTwin) {
    expect(closed.status).toBe('running')
  } else {
    expect(closed.status).toBe('failed')
    expect(closed.log.at(-1)?.text).toBe(END_LINE)
    // C2: nothing cut, not to Log lines (5), and the end line pushed nothing out.
    expect(closed.log.length).toBe(201)
    expect(closed.log.slice(0, 200)).toEqual(before)
  }
  await agentStep($, 'a1')
  await x.same('reopened')
  expect(rowOf(w)?.log.length).toBe(200)
})

// ---------------------------------------------------------------------------
// C5: the main agent.

bothWays('C5: the main agent rests while the row is closed, and after the reopen, with no turn running, waits for 1 agent', async x => {
  await toClose(x)
  if (!x.isTwin) expect(mainOf(x.w)).toMatchObject({ status: 'resting' })
  else expect(mainOf(x.w)).toMatchObject({ status: 'waiting', doing: 'Waiting for 1 agent' })
  await readFile(x.$, '/repo/again.ts', 'a1', 'tu-again')
  await x.w.clock.settle()
  expect(mainOf(x.w)).toMatchObject({ status: 'waiting', doing: 'Waiting for 1 agent' })
  await x.same('reopened')
})

// ---------------------------------------------------------------------------
// C6: the run.

bothWays('C6: one tick after the reopen, the run view counts the agent as not over, and the run mark is below what it was while the row was closed', async x => {
  await toClose(x)
  const closedHigh = runOf(x.w)?.high ?? -1
  expect(closedHigh).toBeGreaterThan(0)
  await readFile(x.$, '/repo/again.ts', 'a1', 'tu-again')
  // One tick on, the bar drawn from its frame.
  const bar = await siteWords(x.$, x.w, 'AbovePrompt')
  expect(bar).toContain('Agents 0/1')
  expect(bar).not.toContain('Agents 1/1')
  expect(runOf(x.w)?.high ?? -1).toBeLessThan(closedHigh)
  await x.same('a tick on')
})

// ---------------------------------------------------------------------------
// C7: no flapping.

bothWays('C7: a row reopened by turn.start alone is closed again only after STUCK_MS from that event, and reopened again by the next event', async x => {
  const { $, w } = x
  await toClose(x)
  const at = w.clock.now()
  await $.turn.start({ text: 'Go on', turnId: 'r-a1', agentId: 'a1' } as never)
  await w.clock.advance(10_000)
  expect(rowOf(w)?.status).toBe('running')
  await x.same('ten seconds on')
  await w.clock.advance(STUCK_MS - 15_000)
  expect(w.clock.now()).toBe(at + STUCK_MS - 5_000)
  expect(rowOf(w)?.status).toBe('running')
  await w.clock.advance(11_000)
  if (x.isTwin) {
    expect(rowOf(w)?.status).toBe('running')
  } else {
    expect(rowOf(w)?.status).toBe('failed')
    expect(rowOf(w)?.log.at(-1)?.text).toBe(END_LINE)
  }
  await readFile($, '/repo/again.ts', 'a1', 'tu-again')
  await x.same('reopened again')
})

// ---------------------------------------------------------------------------
// The pane after a reopen.

bothWays('the pane after a reopen draws the row under Working with its doing line, and no Failed', async x => {
  await toClose(x)
  await readFile(x.$, '/repo/again.ts', 'a1', 'tu-again')
  const text = await siteWords(x.$, x.w, 'Pane')
  const doing = 'Reading again.ts'
  expect(text).toContain('Working')
  expect(text).toContain(doing)
  expect(text.indexOf(doing)).toBeGreaterThan(text.indexOf('Working'))
  expect(text).not.toContain('Failed')
  await x.same('drawn')
  expect(rowOf(x.w)?.doing).toBe(doing)
})

// ---------------------------------------------------------------------------
// C8: what does not change.

test('C8: a row ended by its own turn.complete stays done, Finished, when a late tool-call end of its agent comes', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  const held = await holdCall($, w, '/repo/late.ts', 'a1', 'tu-late', w.clock.now() + 500)
  await endAgent($, 'a1')
  expect(rowOf(w)?.status).toBe('done')
  await held.release()
  const row = rowOf(w)
  expect(row?.status).toBe('done')
  expect(row?.doing).toBe('Finished')
  expect(row?.endedAt).toBeDefined()
})

// ---------------------------------------------------------------------------
// C4: an entry open at the close, from stored state. A held call cannot outlast the 15
// minutes (the kit lets a hook go after ten seconds of real time), so the row is stored at
// load: running, started 16 minutes before T0 and quiet since, with one tool entry open.

const QUIET_START = T0 - 16 * 60_000
const STORED_ROW: AgentRun = {
  id: 'a1',
  agentId: 'a1',
  type: 'pixel-crew:engineer',
  kind: 'build',
  tint: 0,
  description: 'Write the parser',
  model: 'claude-haiku-4-5',
  status: 'running',
  startedAt: QUIET_START,
  contextTokens: 0,
  contextMax: 200_000,
  use: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  steps: 0,
  round: 1,
  doing: 'Reading long.ts',
  doingSince: QUIET_START,
  log: [
    { at: QUIET_START, kind: 'note', text: 'Started as Build on Haiku 4.5', outcome: 'ok' },
    { at: QUIET_START, kind: 'tool', text: 'Reading long.ts', outcome: 'open', callId: 'tu-long' },
  ],
}

bothWays(
  'C4: a stored row with an entry open at the close: turn.step reopens it with the entry open again, then its turn.complete closes the entry',
  async x => {
    const { $, w } = x
    await w.clock.advance(6_000)
    const closed = rowOf(w)
    if (x.isTwin) {
      expect(closed?.status ?? 'running').toBe('running')
    } else {
      // Set-up: the first sync closed it, as A3 does in 2.5.0.
      expect(closed?.status).toBe('failed')
      expect(closed?.log.at(-1)?.text).toBe(END_LINE)
    }
    await agentStep($, 'a1')
    await x.same('reopened')
    expect(rowOf(w)?.log.find(e => e.callId === 'tu-long')).toEqual({ at: QUIET_START, kind: 'tool', text: 'Reading long.ts', outcome: 'open', callId: 'tu-long' })
    expect(rowOf(w)?.log.filter(e => e.text === END_LINE)).toEqual([])
    await endAgent($, 'a1')
    await x.same('ended')
    expect(rowOf(w)?.log.find(e => e.callId === 'tu-long')?.outcome).toBe('ok')
  },
  { junk: { agents: [STORED_ROW] }, noMain: true }, // The stored state holds no main agent that was ever settled, so its twin's stays blank: C5 has its own test.
)

// ---------------------------------------------------------------------------
// C3 and C8, as in 2.5.0: what a spawn again of a closed row's agent does, and a real end.

test('C3, as in 2.5.0: after the close a spawn again of the agent makes it running, Getting started, a Resumed line after the end line; a turn.step then puts nothing back', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  for (let i = 0; i < 3; i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
  await endMainTurn($)
  await w.clock.advance(STUCK_MS + 5_000)
  await w.clock.advance(1_000)
  expect(rowOf(w)?.status).toBe('failed')
  w.respawn.push('a1')
  await spawnCrew($, 2, 'Write the parser')
  const resumed = rowOf(w)
  expect(resumed?.status).toBe('running')
  expect(resumed?.endedAt).toBeUndefined()
  expect(resumed?.doing).toBe('Getting started')
  expect(resumed?.log.slice(-2).map(e => e.text)).toEqual([END_LINE, 'Resumed'])
  await agentStep($, 'a1')
  const stepped = rowOf(w)
  expect(stepped?.doing).toBe('Getting started')
  expect(stepped?.log.slice(-2)).toEqual(resumed?.log.slice(-2))
})

test('C8, as in 2.5.0: a row the sync closes because the list says completed stays done, Finished, when a call of its agent still open then ends', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  const held = await holdCall($, w, '/repo/late.ts', 'a1', 'tu-late', w.clock.now() + 8_000)
  w.listed.push({ id: 'a1', status: 'completed', description: 'Write the parser', type: 'pixel-crew:engineer' })
  try {
    await w.clock.advance(6_000)
    const closed = rowOf(w)
    expect(closed?.status).toBe('done')
    expect(closed?.doing).toBe('Finished')
  } finally {
    await held.release()
  }
  const row = rowOf(w)
  expect(row?.status).toBe('done')
  expect(row?.doing).toBe('Finished')
  expect(row?.endedAt).toBeDefined()
})

// ---------------------------------------------------------------------------
// C12: a mark that no longer fits. Each scenario runs twice from stored state: first with the
// row as stored but no `lost` field ([plain]), then with `lost` on it; after the event the row
// must equal the plain one in every field `AgentRun` declares, `activeAt` included, and carry
// no `lost` field. A test can hold one engine only, so the plain run leaves its row in `PLAIN`.

// What closeLost writes today on the row it closes (the C4 stored row, closed by the sync at T0 + 5 s).
const TODAY_MARK = { status: 'running', doing: 'Reading long.ts', doingSince: QUIET_START, open: [1] }
// A row ended by its own turn.complete, its end line last (as the mod writes it on today's build).
const DONE_ROW: AgentRun = {
  ...STORED_ROW,
  kind: 'refactor',
  status: 'done',
  startedAt: T0,
  endedAt: T0 + 3_000,
  doing: 'Finished',
  doingSince: T0 + 3_000,
  activeAt: T0,
  log: [
    { at: T0, kind: 'note', text: 'Started as Refactor on Haiku 4.5', outcome: 'ok' },
    { at: T0, kind: 'tool', text: 'Reading long.ts', outcome: 'ok', callId: 'tu-long', ms: 0 },
    { at: T0 + 3_000, kind: 'end', text: 'Finished in 0:03', outcome: 'ok', ms: 3_000 },
  ],
}
// A live running row, active at T0, so the sync does not close it within the test.
const RUNNING_ROW: AgentRun = {
  ...STORED_ROW,
  startedAt: T0 - 60_000,
  doing: 'Reading a.ts',
  doingSince: T0 - 2_000,
  activeAt: T0,
  log: [
    { at: T0 - 60_000, kind: 'note', text: 'Started as Build on Haiku 4.5', outcome: 'ok' },
    { at: T0 - 2_000, kind: 'tool', text: 'Reading a.ts', outcome: 'ok', callId: 'tu-a', ms: 2_000 },
  ],
}
// The C4 stored row exactly as the sync's close leaves it on today's build, less its mark.
const CLOSED_ROW: AgentRun = {
  ...STORED_ROW,
  status: 'failed',
  endedAt: T0 + 5_000,
  doing: 'Failed',
  doingSince: T0 + 5_000,
  log: [
    { at: QUIET_START, kind: 'note', text: 'Started as Build on Haiku 4.5', outcome: 'ok' },
    { at: QUIET_START, kind: 'tool', text: 'Reading long.ts', outcome: 'error', callId: 'tu-long', ms: 965_000 },
    { at: T0 + 5_000, kind: 'end', text: END_LINE, outcome: 'error', ms: 965_000 },
  ],
}

const C12_FIELDS = [...FIELDS, 'activeAt'] as const
const PLAIN = new Map<string, Record<string, unknown>>()

// `event` may answer the row to compare (one it saw before the scenario ended), else the last row written is compared.
function markWays(name: string, row: AgentRun, mark: unknown, event: ($: Engine, w: World) => Promise<AgentRun | undefined | void>): void {
  for (const isPlain of [true, false]) {
    test(isPlain ? `${name} [plain: no lost field]` : name, { timeoutMs: 60_000 }, async ($, on) => {
      const stored = isPlain ? row : ({ ...row, lost: mark } as unknown as AgentRun)
      const w = await boot($, on, { junk: { agents: [stored] } })
      await w.clock.advance(6_000)
      const answered = await event($, w)
      await w.clock.settle()
      // No write of `agents` at all: the stored row is what the mod still holds (the event's change was lost).
      const r = (answered ?? rowOf(w) ?? (w.writes.some(x => x.key === 'agents') ? undefined : stored)) as unknown as Record<string, unknown> | undefined
      expect(r).toBeDefined()
      const seen: Record<string, unknown> = {}
      for (const f of C12_FIELDS) if (r && r[f] !== undefined) seen[f] = r[f]
      if (isPlain) {
        PLAIN.set(name, seen)
        return
      }
      const ref = PLAIN.get(name)
      if (!ref) throw new Error(`the plain run of "${name}" did not run before it`)
      expect(seen.status).toBe(ref.status)
      expect(seen.doing).toBe(ref.doing)
      expect(seen.endedAt).toBe(ref.endedAt)
      expect(seen.log).toEqual(ref.log)
      expect(seen).toEqual(ref)
      expect(Object.hasOwn(r ?? {}, 'lost')).toBe(false)
    })
  }
}

const onStep = async ($: Engine): Promise<void> => agentStep($, 'a1')
// A tool call of the agent, compared while it is still open; then it ends.
const onCallStart = async ($: Engine, w: World): Promise<AgentRun | undefined> => {
  const held = await holdCall($, w, '/repo/next.ts', 'a1', 'tu-next', w.clock.now() + 500)
  await w.clock.settle()
  const atStart = rowOf(w)
  await held.release()
  return atStart
}
const onCallEnd = async ($: Engine, w: World): Promise<void> => {
  await readFile($, '/repo/next.ts', 'a1', 'tu-next')
}

markWays('C12: a stored done row that carries a mark of today\'s shape: turn.step changes it as a row with no lost field', DONE_ROW, TODAY_MARK, onStep)
markWays('C12: a stored done row that carries a mark of today\'s shape: a tool call starting changes it as a row with no lost field', DONE_ROW, TODAY_MARK, onCallStart)
markWays('C12: a stored running row that carries a mark of today\'s shape: turn.step changes it as a row with no lost field', RUNNING_ROW, TODAY_MARK, onStep)
markWays('C12: a stored running row that carries a mark of today\'s shape: a tool call starting changes it as a row with no lost field', RUNNING_ROW, TODAY_MARK, onCallStart)

const JUNK_MARKS: [string, unknown][] = [
  ['{}', {}],
  ['5', 5],
  ["'x'", 'x'],
  ['[]', []],
  ['null', null],
  ['wrong types inside', { status: 'done', doing: 1, doingSince: 'x', open: 'y' }],
]
for (const [label, mark] of JUNK_MARKS) {
  markWays(`C12: a closed row whose mark is ${label}: turn.step changes it as a row with no lost field`, CLOSED_ROW, mark, onStep)
  markWays(`C12: a closed row whose mark is ${label}: a tool call starting changes it as a row with no lost field`, CLOSED_ROW, mark, onCallStart)
  markWays(`C12: a closed row whose mark is ${label}: a tool call ending changes it as a row with no lost field`, CLOSED_ROW, mark, onCallEnd)
}

// C12, pure: the run does not count a live row whose mark does not fit among its stuck ids.
for (const [label, mark] of [['{}', {}], ['null', null], ["today's shape", TODAY_MARK]] as [string, unknown][]) {
  test(`C12: runQuiet counts a live running row that carries ${label} as lost among live and not among stuck`, async () => {
    const row = { ...RUNNING_ROW, lost: mark } as unknown as AgentRun
    const q = runQuiet({ startedAt: T0 - 60_000, ids: ['a1'], high: 0 }, [row], T0 + 1_000)
    expect(q.live).toEqual(['a1'])
    expect(q.stuck).toEqual([])
  })
}
