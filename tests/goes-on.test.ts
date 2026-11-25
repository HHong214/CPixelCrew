// An agent that goes on after its end: the contract's G1 to G5 (its row) and J1 to J4 (the
// run). G2 runs each scenario twice, once so and once as its twin, the same agent resumed
// through `agent.spawn` with its known id and then given the same event, on the same times of
// the mocked clock; the row must equal the twin's in every field `AgentRun` declares. A test
// can hold one engine only, so the twin runs as the test just before its scenario and leaves
// its row in `TWINS`. A row quiet for 15 minutes cannot be made by waiting (the kit lets a hook
// go after ten seconds of real time), so it is stored at load as it would be after the wait,
// as tests/reopen.test.ts does. Events go in; what comes out is each `state.set` of the mod's
// values and a mounted bar.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, MainRun, Run } from '../types'
import { STUCK_MS } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const STEP = 'mcp__CPixelCrew__step'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const END_LINE = 'Stopped: no longer listed'
const LOG_LINES = 5

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
  // `agents`: how many of the next writes of the agent list the engine refuses; `refused`: how many it did.
  refuse: { agents: number; refused: number }
  // The usage each agent's model request answers with (`null` until a test sets one).
  stepUsage: { value: unknown }
}

// A model request's usage, as tests/audit.test.ts answers one.
const STEP_USAGE = { input_tokens: 12_000, output_tokens: 3_000, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 18_000, model: 'claude-haiku-4-5' }

// Everything beneath the plugin, as tests/reopen.test.ts answers it, with Log lines at 5, a
// tool call that can be held open, and writes of the agent list that can be refused. `junk`:
// what the mod's values hold at load; each reads so until the mod writes it.
async function boot($: Engine, on: On, o: { junk?: Record<string, unknown>; listed?: Listed[] } = {}): Promise<World> {
  const stored: Record<string, unknown> = { sizes: { textSize: 100, iconSize: 200, barSize: 100, logLines: LOG_LINES } }
  const junk: Record<string, unknown> = { ...o.junk }
  const clock = mock.clock(on, { now: T0 })
  const writes: Write[] = []
  const holds = new Map<string, number>()
  const refuse = { agents: 0, refused: 0 }
  const stepUsage: { value: unknown } = { value: null }
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN && e.key === 'agents' && refuse.agents > 0) {
      refuse.agents -= 1
      refuse.refused += 1
      return { deny: 'the write was refused' }
    }
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
  const listed: Listed[] = [...(o.listed ?? [])]
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: stepUsage.value } as never
  } as never)
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
  return { clock, listed, writes, holds, respawn, refuse, stepUsage }
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

// The agent's own turn.complete: `answer` ends its row `done`, `error` ends it `failed`.
async function endAgent($: Engine, agentId: string, reason: 'answer' | 'error' = 'answer'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: reason !== 'answer', turnId: `r-${agentId}`, agentId, reason } as never)
}

// The message that woke the agent's loop.
async function agentTurnStart($: Engine, agentId: string): Promise<void> {
  await $.turn.start({ text: 'Go on', turnId: `r2-${agentId}`, agentId } as never)
}

// One model request of the agent's loop, pulled through to its end.
async function agentStep($: Engine, agentId: string): Promise<void> {
  const s = $.turn.step({ index: 0, model: 'claude-haiku-4-5', messageCount: 1, turnId: `r-${agentId}`, agentId } as never) as unknown as AsyncIterator<unknown>
  for (let i = 0; i < 100; i += 1) if ((await s.next()).done) break
}

async function readFile($: Engine, path: string, agentId: string, id: string): Promise<unknown> {
  return $.tool.call({ tool: 'Read', file_path: path, agentId, tool_use_id: id } as never)
}

// A tool call of the agent held open beneath the plugin until `endsAt` on the mocked clock:
// started now, and answered by `release`, which moves the clock there.
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

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

// The bar's words once the frame of every event before it has landed (frames.test.ts, A5).
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
const mainOf = (w: World): MainRun | undefined => lastOf<MainRun>(w, 'main')
const runOf = (w: World): Run | undefined => lastOf<Run>(w, 'run')
const runWrites = (w: World): number => w.writes.filter(x => x.key === 'run').length
const resumedNotes = (a: AgentRun | undefined): number => (a?.log ?? []).filter(e => e.kind === 'note' && e.text === 'Resumed').length

// Every field `AgentRun` declares, `activeAt` and `lost` among them.
const FIELDS = [
  'id',
  'agentId',
  'type',
  'kind',
  'tint',
  'description',
  'model',
  'effort',
  'status',
  'startedAt',
  'endedAt',
  'contextTokens',
  'contextMax',
  'use',
  'costUsd',
  'steps',
  'round',
  'stepDone',
  'stepTotal',
  'stepNote',
  'stepAt',
  'activeAt',
  'lost',
  'doing',
  'doingSince',
  'log',
] as const
const fieldsOf = (a: AgentRun | undefined): Record<string, unknown> => {
  const r = (a ?? {}) as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) if (r[f] !== undefined) out[f] = r[f]
  return out
}

// The history every row scenario starts from: a main turn, agent a1 spawned with two tool
// calls, its own turn.complete (`done` or `failed`), the main turn ends, and two seconds pass.
async function toEnded($: Engine, w: World, ending: 'done' | 'failed'): Promise<void> {
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  for (let i = 0; i < 2; i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
  await endAgent($, 'a1', ending === 'done' ? 'answer' : 'error')
  await endMainTurn($)
  await w.clock.advance(2_000)
  await w.clock.settle()
  // Set-up: the row ended for real, as in 2.5.0.
  const row = rowOf(w)
  expect(row?.status).toBe(ending)
  expect(row?.doing).toBe(ending === 'done' ? 'Finished' : 'Failed')
  expect(row?.endedAt).toBeDefined()
  expect(row?.lost).toBeUndefined()
}

// ---------------------------------------------------------------------------
// G2, by its twin.

const TWINS = new Map<string, Record<string, unknown>>()

// `usage`: what the event's model request answers with, so the compare covers the tokens it adds.
function twinWays(name: string, ending: 'done' | 'failed', event: ($: Engine, w: World) => Promise<void>, usage?: unknown): void {
  for (const isTwin of [true, false]) {
    test(isTwin ? `${name} [twin: resumed by agent.spawn with its known id]` : name, { timeoutMs: 60_000 }, async ($, on) => {
      const w = await boot($, on)
      await toEnded($, w, ending)
      if (isTwin) {
        w.respawn.push('a1')
        await spawnCrew($, 2, 'Write the parser')
        await w.clock.settle()
        // Set-up: the spawn resumed the row (C3, as in 2.5.0).
        expect(rowOf(w)?.doing).toBe('Getting started')
      }
      if (usage !== undefined) w.stepUsage.value = usage
      await event($, w)
      await w.clock.settle()
      const seen = fieldsOf(rowOf(w))
      if (isTwin) {
        // Set-up: the step's usage counted on the twin's row.
        if (usage !== undefined) expect(seen.steps).toBe(1)
        TWINS.set(name, seen)
        return
      }
      const ref = TWINS.get(name)
      if (!ref) throw new Error(`the twin of "${name}" did not run before it`)
      expect(ref.id).toBe('a1')
      expect(seen.status).toBe(ref.status)
      expect(seen.endedAt).toBe(ref.endedAt)
      expect(seen.doing).toBe(ref.doing)
      expect(seen.doingSince).toBe(ref.doingSince)
      expect(seen.log).toEqual(ref.log)
      expect(seen).toEqual(ref)
    })
  }
}

twinWays('G2: a row ended done, then turn.start of its agent: the row equals its twin', 'done', ($: Engine) => agentTurnStart($, 'a1'))
twinWays('G2: a row ended failed, then turn.start of its agent: the row equals its twin', 'failed', ($: Engine) => agentTurnStart($, 'a1'))
twinWays('G2: a row ended done, then turn.step of its agent: the row equals its twin', 'done', ($: Engine) => agentStep($, 'a1'), STEP_USAGE)
twinWays('G2: a row ended failed, then turn.step of its agent: the row equals its twin', 'failed', ($: Engine) => agentStep($, 'a1'), STEP_USAGE)

// G1: a row ended `failed` whose `lost` field does not fit it (`isMarked` false) ended for real.
const FAILED_ROW: AgentRun = {
  id: 'a1',
  agentId: 'a1',
  type: 'pixel-crew:engineer',
  kind: 'build',
  tint: 0,
  description: 'Write the parser',
  model: 'claude-haiku-4-5',
  status: 'failed',
  startedAt: T0 - 60_000,
  endedAt: T0 - 10_000,
  contextTokens: 0,
  contextMax: 200_000,
  use: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  steps: 0,
  round: 1,
  doing: 'Failed',
  doingSince: T0 - 10_000,
  log: [
    { at: T0 - 60_000, kind: 'note', text: 'Started as Build on Haiku 4.5', outcome: 'ok' },
    { at: T0 - 10_000, kind: 'end', text: 'Stopped on an error after 50s', outcome: 'error', ms: 50_000 },
  ],
}
for (const [label, mark] of [
  ['{}', {}],
  ['a mark whose time is not the row end', { at: T0 - 20_000, status: 'running', doing: 'Reading a.ts', doingSince: T0 - 30_000, open: [] }],
] as [string, unknown][]) {
  test(`G1: a stored failed row whose lost field does not fit (${label}) is resumed by turn.start, and the field is gone`, { timeoutMs: 60_000 }, async ($, on) => {
    const w = await boot($, on, { junk: { agents: [{ ...FAILED_ROW, lost: mark }] } })
    await w.clock.advance(6_000)
    await w.clock.settle()
    const at = w.clock.now()
    await agentTurnStart($, 'a1')
    await w.clock.settle()
    const row = rowOf(w)
    expect(row?.doing).toBe('Getting started')
    expect(row).toMatchObject({ status: 'running', doingSince: at })
    expect(row?.endedAt).toBeUndefined()
    expect(resumedNotes(row)).toBe(1)
    expect(Object.hasOwn(row ?? {}, 'lost')).toBe(false)
  })
}

// ---------------------------------------------------------------------------
// G3 and G4.

test('G3: after the resume the next events find the row running and write no second Resumed', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await toEnded($, w, 'done')
  await agentTurnStart($, 'a1')
  await w.clock.advance(1_000)
  await agentStep($, 'a1')
  await w.clock.advance(1_000)
  await agentTurnStart($, 'a1')
  await w.clock.settle()
  const row = rowOf(w)
  expect(row?.status).toBe('running')
  expect(resumedNotes(row)).toBe(1)
})

for (const [label, event] of [
  ['turn.start', ($: Engine) => agentTurnStart($, 'a1')],
  ['turn.step', ($: Engine) => agentStep($, 'a1')],
] as [string, ($: Engine) => Promise<void>][]) {
  test(`G4: with no main turn running, the main agent waits for 1 agent after a resume by ${label}`, { timeoutMs: 60_000 }, async ($, on) => {
    const w = await boot($, on)
    await toEnded($, w, 'done')
    // Set-up: nothing active, so the main agent rests.
    expect(mainOf(w)).toMatchObject({ status: 'resting', turnStartedAt: null })
    await event($)
    await w.clock.settle()
    expect(mainOf(w)).toMatchObject({ status: 'waiting', doing: 'Waiting for 1 agent' })
  })
}

// ---------------------------------------------------------------------------
// G5: what does not change, where no old test pins it. The rest is pinned in
// tests/reopen.test.ts (a late call end on an ended row: "C8: a row ended by its own
// turn.complete…" and "C8, as in 2.5.0…"; agent.spawn for a known id and turn.step on the
// running row it leaves: "C3, as in 2.5.0…").

test('G5: turn.start of an agent whose row is running leaves the row as it was', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await readFile($, '/repo/file0.ts', 'a1', 'tu-f0')
  await w.clock.advance(2_000)
  await w.clock.settle()
  const before = rowOf(w)
  expect(before?.status).toBe('running')
  await agentTurnStart($, 'a1')
  await w.clock.settle()
  expect(fieldsOf(rowOf(w))).toEqual(fieldsOf(before))
})

test('G5: turn.start of an agent whose row is waiting makes it running, its doing line without the wait, from the event', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', permission_mode: 'default' } as never)
  await w.clock.advance(2_000)
  await w.clock.settle()
  const before = rowOf(w)
  expect(before?.status).toBe('waiting')
  const at = w.clock.now()
  await agentTurnStart($, 'a1')
  await w.clock.settle()
  expect(fieldsOf(rowOf(w))).toEqual(fieldsOf({ ...before!, status: 'running', doing: 'Running ls', doingSince: at }))
})

test('G5: a whole tool call of an agent whose row ended done leaves it done, its end time kept, with no Resumed', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await toEnded($, w, 'done')
  const endedAt = rowOf(w)?.endedAt
  const held = await holdCall($, w, '/repo/next.ts', 'a1', 'tu-next', w.clock.now() + 500)
  try {
    expect(rowOf(w)).toMatchObject({ status: 'done', endedAt, doing: 'Reading next.ts' })
    expect(resumedNotes(rowOf(w))).toBe(0)
  } finally {
    await held.release()
  }
  expect(rowOf(w)).toMatchObject({ status: 'done', endedAt, doing: 'Reading next.ts' })
  expect(resumedNotes(rowOf(w))).toBe(0)
})

test('G5: a permission request of an agent whose row ended done makes it wait, its end time kept, with no Resumed', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await toEnded($, w, 'done')
  const endedAt = rowOf(w)?.endedAt
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', permission_mode: 'default' } as never)
  await w.clock.settle()
  expect(rowOf(w)).toMatchObject({ status: 'waiting', endedAt, doing: 'Waiting for your approval: Running ls' })
  expect(resumedNotes(rowOf(w))).toBe(0)
})

test('G5: a call of the step tool of an agent whose row ended done leaves it done, Finished, with no Resumed', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await toEnded($, w, 'done')
  const endedAt = rowOf(w)?.endedAt
  const answer = (await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 3, note: 'Parser drafted' } as never)) as { result?: unknown }
  expect(String(answer.result)).toBe('ok')
  await w.clock.settle()
  expect(rowOf(w)).toMatchObject({ status: 'done', endedAt, doing: 'Finished', stepDone: 1, stepTotal: 3 })
  expect(resumedNotes(rowOf(w))).toBe(0)
})

// ---------------------------------------------------------------------------
// J1: after an ended run, the agent starts a new count.

// A main turn, agents a1 and a2 spawned and both ended by their own turn.complete, the main
// turn ends, and the next prompt ends their run; two seconds pass.
async function toEndedRunOfTwo($: Engine, w: World): Promise<void> {
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await spawnCrew($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await endAgent($, 'a2')
  await endMainTurn($)
  await userTurn($, 'Next', 't2')
  await w.clock.advance(2_000)
  await w.clock.settle()
  // Set-up: the prompt ended the run of both.
  expect(runOf(w)?.ids).toEqual(['a1', 'a2'])
  expect(runOf(w)?.endedAt).toBeDefined()
}

for (const [label, event] of [
  ['turn.start', ($: Engine) => agentTurnStart($, 'a2')],
  ['turn.step', ($: Engine) => agentStep($, 'a2')],
] as [string, ($: Engine) => Promise<void>][]) {
  test(`J1: after a prompt ended a run of two ended agents, ${label} of one starts a new run of it alone: Agents 0/1 under its title`, { timeoutMs: 60_000 }, async ($, on) => {
    const w = await boot($, on)
    await toEndedRunOfTwo($, w)
    const at = w.clock.now()
    await event($)
    await w.clock.settle()
    const run = runOf(w)
    expect(run?.endedAt).toBeUndefined()
    expect(run?.ids).toEqual(['a2'])
    expect(run?.startedAt).toBe(at)
    const bar = await barWords($, w)
    expect(bar).toContain('Agents 0/1')
    expect(bar).toContain('Wire the CLI')
  })
}

// A row quiet when the prompt ended its run: stored at load as `running`, started 16 minutes
// before T0 and quiet since, in a stored run of its own. The agent list shows it running, so
// the sync never closes it.
const QUIET_START = T0 - 16 * 60_000
const QUIET_ROW: AgentRun = {
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
    { at: QUIET_START, kind: 'tool', text: 'Reading long.ts', outcome: 'ok', callId: 'tu-long', ms: 0 },
  ],
}
const QUIET_RUN: Run = { startedAt: QUIET_START, ids: ['a1'], high: 0, joinedAt: QUIET_START }

async function bootQuietEnded($: Engine, on: On): Promise<World> {
  const w = await boot($, on, {
    junk: { agents: [QUIET_ROW], run: QUIET_RUN },
    listed: [{ id: 'a1', status: 'running', description: 'Write the parser', type: 'pixel-crew:engineer' }],
  })
  await userTurn($)
  await w.clock.settle()
  // Set-up: the prompt ended the run, its one agent quiet; the row is still running.
  expect(runOf(w)?.ids).toEqual(['a1'])
  expect(runOf(w)?.endedAt).toBeDefined()
  expect((rowOf(w) ?? QUIET_ROW).status).toBe('running')
  return w
}

// J1 and J3: a new run (not the ended one reopened), of the row alone, started at the event's time `at`.
const expectInNewRun = (w: World, at: number): void => {
  const run = runOf(w)
  expect(run?.endedAt).toBeUndefined()
  expect(run?.ids).toEqual(['a1'])
  expect(run?.startedAt).toBe(at)
}

test('J1: a row quiet when the prompt ended its run is put in a new run by a tool call starting', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await bootQuietEnded($, on)
  const at = w.clock.now()
  const held = await holdCall($, w, '/repo/next.ts', 'a1', 'tu-next', at + 500)
  try {
    expect(rowOf(w)?.log.at(-1)).toMatchObject({ callId: 'tu-next', outcome: 'open' })
    expectInNewRun(w, at)
  } finally {
    await held.release()
  }
})

// The start's write of the row is refused, so the call's end is the first event that changes the row;
// while the call runs (between the two) the run is still the ended one.
test('J1: a row quiet when the prompt ended its run is put in a new run by a tool call ending', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await bootQuietEnded($, on)
  const ended = runOf(w)
  const n = runWrites(w)
  w.refuse.agents = 1
  const endsAt = w.clock.now() + 500
  const held = await holdCall($, w, '/repo/next.ts', 'a1', 'tu-next', endsAt)
  try {
    // Set-up: the start wrote nothing.
    expect(w.refuse.refused).toBe(1)
    expect((rowOf(w)?.log ?? []).some(e => e.callId === 'tu-next')).toBe(false)
    // J1: no join before the row's write.
    expect(runWrites(w)).toBe(n)
    expect(runOf(w)).toEqual(ended)
  } finally {
    await held.release()
  }
  // Set-up: the end made the row live.
  expect(rowOf(w)?.log.some(e => e.callId === 'tu-next')).toBe(false)
  expect(rowOf(w)?.status).toBe('running')
  expectInNewRun(w, endsAt)
})

test('J1: a row quiet when the prompt ended its run is put in a new run by a permission request', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await bootQuietEnded($, on)
  const at = w.clock.now()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', permission_mode: 'default' } as never)
  await w.clock.settle()
  expect(rowOf(w)?.status).toBe('waiting')
  expectInNewRun(w, at)
})

test('J1: a row quiet when the prompt ended its run is put in a new run by a call of the step tool', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await bootQuietEnded($, on)
  const at = w.clock.now()
  const answer = (await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 3, note: 'Parser drafted' } as never)) as { result?: unknown }
  expect(String(answer.result)).toBe('ok')
  await w.clock.settle()
  expectInNewRun(w, at)
})

test('J2: turn.start that changes nothing on a quiet running row whose run a prompt ended writes nothing to the run', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await bootQuietEnded($, on)
  const before = runOf(w)
  const n = runWrites(w)
  await agentTurnStart($, 'a1')
  await w.clock.settle()
  expect((rowOf(w) ?? QUIET_ROW).status).toBe('running')
  expect(runOf(w)?.endedAt).toBeDefined()
  expect(runWrites(w)).toBe(n)
  expect(runOf(w)).toEqual(before)
})

// J4 says turn.complete joins nothing; the mark it takes afresh after an end (`holdFill`, as in
// 2.5.0, a write of `run`) is left out: the run's join fields are compared, not the whole value.
const joinOf = (r: Run | undefined) => ({ startedAt: r?.startedAt, ids: r?.ids, joinedAt: r?.joinedAt, endedAt: r?.endedAt })
test('J4: turn.complete of the quiet running row of a run a prompt ended joins nothing: the same ended run', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await bootQuietEnded($, on)
  const before = runOf(w)
  await endAgent($, 'a1')
  await w.clock.settle()
  // Set-up: the row ended done.
  expect(rowOf(w)?.status).toBe('done')
  expect(runOf(w)?.endedAt).toBeDefined()
  expect(joinOf(runOf(w))).toEqual(joinOf(before))
})

test('J1: with a newer run of another agent open, turn.start of an ended agent of the ended run joins it: Agents 0/2', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await endAgent($, 'a1')
  await endMainTurn($)
  await userTurn($, 'Next', 't2')
  await spawnCrew($, 2, 'Wire the CLI')
  await w.clock.advance(2_000)
  await w.clock.settle()
  // Set-up: the prompt ended a1's run, and a2 started the next one.
  expect(runOf(w)?.ids).toEqual(['a2'])
  expect(runOf(w)?.endedAt).toBeUndefined()
  await agentTurnStart($, 'a1')
  await w.clock.settle()
  expect(await barWords($, w)).toContain('Agents 0/2')
  expect(runOf(w)?.ids).toEqual(['a2', 'a1'])
  expect(runOf(w)?.endedAt).toBeUndefined()
})

test('J1: a row the 15-minute rule closed, reopened by its agent next event after a prompt ended the run, starts a new run', { timeoutMs: 90_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  for (let i = 0; i < 3; i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
  await endMainTurn($)
  await w.clock.advance(STUCK_MS + 5_000)
  await w.clock.advance(1_000)
  // Set-up: the sync closed the row, as A3 does in 2.5.0, and the next prompt ended the run.
  expect(rowOf(w)?.status).toBe('failed')
  expect(rowOf(w)?.log.at(-1)?.text).toBe(END_LINE)
  await userTurn($, 'Next', 't2')
  await w.clock.settle()
  expect(runOf(w)?.endedAt).toBeDefined()
  const at = w.clock.now()
  await agentStep($, 'a1')
  await w.clock.settle()
  // Set-up: the event reopened the row (C3).
  expect(rowOf(w)?.status).toBe('running')
  expectInNewRun(w, at)
  expect(await barWords($, w)).toContain('Agents 0/1')
})

// ---------------------------------------------------------------------------
// J2: nothing written to the run.

test('J2: a late call end on a done row after the prompt ended the run leaves the run as stored', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  const held = await holdCall($, w, '/repo/late.ts', 'a1', 'tu-late', w.clock.now() + 500)
  let before: Run | undefined
  let n = -1
  try {
    await endAgent($, 'a1')
    await endMainTurn($)
    await userTurn($, 'Next', 't2')
    await w.clock.settle()
    // Set-up: the row ended done, and the prompt ended the run.
    expect(rowOf(w)?.status).toBe('done')
    before = runOf(w)
    expect(before?.endedAt).toBeDefined()
    n = runWrites(w)
  } finally {
    await held.release()
  }
  expect(rowOf(w)).toMatchObject({ status: 'done', doing: 'Finished' })
  expect(runWrites(w)).toBe(n)
  expect(runOf(w)).toEqual(before)
})

test('J2: events of an agent whose row is live and already in the open run leave the run untouched, joinedAt included', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.advance(2_000)
  await w.clock.settle()
  const before = runOf(w)
  expect(before?.ids).toEqual(['a1'])
  const n = runWrites(w)
  await readFile($, '/repo/file0.ts', 'a1', 'tu-f0')
  await agentStep($, 'a1')
  await agentTurnStart($, 'a1')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', permission_mode: 'default' } as never)
  await w.clock.settle()
  expect(runWrites(w)).toBe(n)
  expect(runOf(w)).toEqual(before)
  expect(runOf(w)?.joinedAt).toBe(before?.joinedAt)
})

// ---------------------------------------------------------------------------
// J4: with no prompt in between, the open run counts the resumed agent again by itself.

test('J4: with no prompt in between, a resumed agent is counted again by the open run, Agents 1/2, and the run is not written', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await spawnCrew($, 2, 'Wire the CLI')
  await endAgent($, 'a1')
  await endAgent($, 'a2')
  // Set-up: both over, the run still open.
  expect(await barWords($, w)).toContain('Agents 2/2')
  expect(runOf(w)?.endedAt).toBeUndefined()
  const n = runWrites(w)
  await agentTurnStart($, 'a1')
  await w.clock.settle()
  expect(runWrites(w)).toBe(n)
  expect(await barWords($, w)).toContain('Agents 1/2')
})

// ---------------------------------------------------------------------------
// J5 and J6: what the join of an agent that goes on costs, and what it does when it fails.
// Both are pinned by what the old hooks do: no join, so a read of `agents` only where the row's
// own write makes it, none of `run` once this load has read or written it, and no failure.

type Taps = { reads: string[]; fail: { read: boolean; write: boolean } }

// Registered before `boot`, so these two sit above boot's own `state.get` and `state.set` and see
// every call of the mod, those boot answers itself included. The mod's reads are listed by key;
// while `fail.read` is set the host's read of `run` is refused (the call is counted, then refused),
// and while `fail.write` is set its write of `run` is. The kit refuses a read or a write for one
// key and answers every other.
function tap(on: On): Taps {
  const t: Taps = { reads: [], fail: { read: false, write: false } }
  type Next = (x: unknown) => unknown
  for (const key of ['agents', 'run']) {
    on('state.get', { key } as never, ((_$: unknown, e: { plugin: string; key: string }, next: Next) => {
      if (e.plugin !== PLUGIN) return next(e)
      t.reads.push(e.key)
      if (t.fail.read && e.key === 'run') return { deny: 'the read was refused' }
      return next(e)
    }) as never)
  }
  // What answers a call of the step tool when the mod's hook for it is skipped (its error), as the mod's own answer is 'ok'.
  on('tool.call', { tool: STEP } as never, (() => ({ result: 'beneath: the mod answered nothing' })) as never)
  on('state.set', { key: 'run' } as never, ((_$: unknown, e: { plugin: string }, next: Next) => {
    if (e.plugin === PLUGIN && t.fail.write) return { deny: 'the write was refused' }
    return next(e)
  }) as never)
  return t
}

type Cost = { agents: number; run: number; agentWrites: number }

// The mod's `state.get` calls of `agents` and `run` made while `event` runs and settles, and its
// writes of the agent list. The mocked clock is not moved by `settle`, so no tick is counted.
async function costOf($: Engine, w: World, t: Taps, event: () => Promise<unknown>): Promise<Cost> {
  const count = (key: string): number => t.reads.filter(k => k === key).length
  const a0 = count('agents')
  const r0 = count('run')
  const w0 = w.writes.filter(x => x.key === 'agents').length
  await event()
  await w.clock.settle()
  return { agents: count('agents') - a0, run: count('run') - r0, agentWrites: w.writes.filter(x => x.key === 'agents').length - w0 }
}

const stepTool = ($: Engine, agentId: string): Promise<unknown> => $.tool.call({ tool: STEP, agentId, done: 1, total: 3, note: 'Parser drafted' } as never)

// A tool call of the agent held until one millisecond later (no tick falls between): the cost of its
// start, then, once the clock has moved, of its end.
async function callCosts($: Engine, w: World, t: Taps): Promise<{ start: Cost; end: Cost }> {
  w.holds.set('tu-x', w.clock.now() + 1)
  let call: Promise<unknown> = Promise.resolve()
  const start = await costOf($, w, t, async () => {
    call = readFile($, '/repo/x.ts', 'a1', 'tu-x')
  })
  const end = await costOf($, w, t, async () => {
    await w.clock.advance(1)
    await call
  })
  return { start, end }
}

// A live row of a run still open: the run was written by the spawn, so this load holds it.
async function bootLiveInOpenRun($: Engine, on: On): Promise<{ w: World; t: Taps }> {
  const t = tap(on)
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  await w.clock.advance(2_000)
  await w.clock.settle()
  // Set-up: the row is running, its run open and holding it.
  expect(rowOf(w)?.status).toBe('running')
  expect(runOf(w)?.ids).toEqual(['a1'])
  expect(runOf(w)?.endedAt).toBeUndefined()
  return { w, t }
}

// J5. The numbers are the old hooks' (they join nothing): the join reads no agent list beyond what
// the row's own write reads, and no `run`, which this load wrote. Counted by key around each event.
const OLD_LIVE: Record<string, { agents: number; run: number }> = {
  'a tool call starting': { agents: 1, run: 0 },
  'a tool call ending': { agents: 1, run: 0 },
  'a model request ending': { agents: 1, run: 0 },
  'a call of the step tool': { agents: 3, run: 4 },
}
for (const [label, old] of Object.entries(OLD_LIVE)) {
  test(`J5: ${label} of a live row already in the open run reads the agent list and the run no more than before the join`, { timeoutMs: 60_000 }, async ($, on) => {
    const { w, t } = await bootLiveInOpenRun($, on)
    let cost: Cost
    if (label === 'a tool call starting') cost = (await callCosts($, w, t)).start
    else if (label === 'a tool call ending') cost = (await callCosts($, w, t)).end
    else if (label === 'a model request ending') cost = await costOf($, w, t, () => agentStep($, 'a1'))
    else cost = await costOf($, w, t, () => stepTool($, 'a1'))
    // Set-up: the event wrote the row.
    expect(cost.agentWrites).toBeGreaterThan(0)
    expect(cost.agents).toBeLessThanOrEqual(old.agents)
    expect(cost.run).toBeLessThanOrEqual(old.run)
  })
}

// J5, a row that is not live: a call started while the row ran ends after its agent's own end
// and after a prompt ended the run, on a row that stays `done`.
test('J5: a late call end on a done row reads the agent list and the run no more than before the join', { timeoutMs: 60_000 }, async ($, on) => {
  const t = tap(on)
  const w = await boot($, on)
  await userTurn($)
  await spawnCrew($, 1, 'Write the parser')
  w.holds.set('tu-late', w.clock.now() + 1)
  const call = readFile($, '/repo/late.ts', 'a1', 'tu-late')
  await w.clock.settle()
  await endAgent($, 'a1')
  await endMainTurn($)
  await userTurn($, 'Next', 't2')
  await w.clock.settle()
  // Set-up: the row ended done and the prompt ended the run; this load wrote both.
  expect(rowOf(w)?.status).toBe('done')
  expect(runOf(w)?.endedAt).toBeDefined()
  const cost = await costOf($, w, t, async () => {
    await w.clock.advance(1)
    await call
  })
  // Set-up: the end wrote the row, which stays done.
  expect(cost.agentWrites).toBeGreaterThan(0)
  expect(rowOf(w)).toMatchObject({ status: 'done', doing: 'Finished' })
  expect(cost.agents).toBeLessThanOrEqual(2)
  expect(cost.run).toBe(0)
})

// J6. A quiet running row whose run a prompt ended: the join is due. The host's read of `run`
// is refused (`read`), or its write is (`write`), only while the event runs.
const FAULTS = ['read', 'write'] as const

for (const fault of FAULTS) {
  test(`J6: the host's ${fault} of run failing, a call of the step tool of a quiet running row whose run a prompt ended still answers ok and its row is written`, { timeoutMs: 60_000 }, async ($, on) => {
    const t = tap(on)
    const w = await bootQuietEnded($, on)
    t.fail[fault] = true
    const answer = (await stepTool($, 'a1')) as { result?: unknown }
    await w.clock.settle()
    t.fail[fault] = false
    expect(String(answer.result)).toBe('ok')
    expect(rowOf(w)).toMatchObject({ status: 'running', stepDone: 1, stepTotal: 3, stepNote: 'Parser drafted' })
  })

  test(`J6: the host's ${fault} of run failing, a tool call of a quiet running row whose run a prompt ended still answers and its row is written`, { timeoutMs: 60_000 }, async ($, on) => {
    const t = tap(on)
    const w = await bootQuietEnded($, on)
    t.fail[fault] = true
    const answer = (await readFile($, '/repo/next.ts', 'a1', 'tu-next')) as { result?: unknown; deny?: unknown }
    await w.clock.settle()
    t.fail[fault] = false
    expect(String(answer.result)).toBe('ok')
    expect(answer.deny).toBeUndefined()
    const entry = rowOf(w)?.log.find(e => e.callId === 'tu-next')
    expect(entry).toMatchObject({ outcome: 'ok' })
    expect(rowOf(w)?.status).toBe('running')
  })

  for (const [label, event] of [
    ['turn.step', ($: Engine) => agentStep($, 'a1')],
    ['turn.start', ($: Engine) => agentTurnStart($, 'a1')],
  ] as [string, ($: Engine) => Promise<void>][]) {
    test(`J6: the host's ${fault} of run failing, ${label} of a row the 15-minute rule closed reopens it after a prompt ended the run, and the main agent still waits for 1 agent`, { timeoutMs: 90_000 }, async ($, on) => {
      const t = tap(on)
      const w = await boot($, on)
      await userTurn($)
      await spawnCrew($, 1, 'Write the parser')
      for (let i = 0; i < 3; i += 1) await readFile($, `/repo/file${i}.ts`, 'a1', `tu-f${i}`)
      await endMainTurn($)
      await w.clock.advance(STUCK_MS + 5_000)
      await w.clock.advance(1_000)
      // Set-up: the sync closed the row, as A3 does in 2.5.0, and the next prompt ended the run.
      expect(rowOf(w)?.status).toBe('failed')
      expect(rowOf(w)?.log.at(-1)?.text).toBe(END_LINE)
      await userTurn($, 'Next', 't2')
      await endMainTurn($, 't2')
      await w.clock.settle()
      expect(runOf(w)?.endedAt).toBeDefined()
      t.fail[fault] = true
      await event($)
      await w.clock.settle()
      t.fail[fault] = false
      // Set-up: the event reopened the row (C3).
      expect(rowOf(w)?.status).toBe('running')
      expect(mainOf(w)).toMatchObject({ status: 'waiting', doing: 'Waiting for 1 agent' })
    })
  }
}

// J6, the first read of `run` this load makes: stored at load as the run a prompt ended (nothing
// read or wrote it since), so a join that reads the host reads it here.
test("J6: the host's read of run failing as the first this load makes, a call of the step tool of a quiet running row still answers ok and its row is written", { timeoutMs: 60_000 }, async ($, on) => {
  const t = tap(on)
  const w = await boot($, on, {
    junk: { agents: [QUIET_ROW], run: { ...QUIET_RUN, endedAt: QUIET_START + 60_000 } },
    listed: [{ id: 'a1', status: 'running', description: 'Write the parser', type: 'pixel-crew:engineer' }],
  })
  t.fail.read = true
  const answer = (await stepTool($, 'a1')) as { result?: unknown }
  await w.clock.settle()
  t.fail.read = false
  expect(String(answer.result)).toBe('ok')
  expect(rowOf(w)).toMatchObject({ status: 'running', stepDone: 1, stepTotal: 3, stepNote: 'Parser drafted' })
})
