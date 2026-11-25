// `/clear` starts the panel over, as a new session: the contract's A1 to A11 (fault 1).
// A session works (a main turn with a tool call, two reported plans, three agents, the first
// plan's row retired by the second), the clock reaches T, the engine's answers turn to a new
// conversation's (a new session id, its cost and `startedAt` started over), and
// `classic.SessionStart` comes with `source: 'clear'`. Its twin is a session freshly started at
// T with the same engine answers: it runs as the first test of this file and leaves what it
// saw in `TWIN`. Two scenarios: nothing active at the clear, and agent a3 still running at it.
//
// The kit gives a test no `$.state.get` (the engine a test drives has no `state` noun, and a
// test hook's own `$.state.get` is refused: "its hooks module does not call it"), so what the
// state holds is read as the mod's last `state.set` of each value (`held`), as
// tests/reopen.test.ts reads it; a value the mod never wrote is undefined, as a get would say.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun, MainRun, Run, Usage, View } from '../types'
import { STUCK_MS, barView, blankMain, blankRetired, heldRun, isMarked, runQuiet, viewFill } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const T0 = Date.parse('2026-11-13T10:00:00Z')
// The clock time of the clear, and of the twin's start.
const T = T0 + 10 * 60_000
const MODEL = 'claude-opus-5-5'
const LIMITS = [{ kind: 'five_hour', percentUsed: 41, resetsAt: '2026-11-13T13:00:00Z' }]
// The engine's figures before the clear, and a new conversation's after it (types :330-332, :15629).
const USAGE_BEFORE = { startedAt: T0 - 60_000, context: { tokens: 270_000, window: 1_000_000, percent: 27 }, rateLimits: LIMITS, cost: { usd: 11.73 } }
const USAGE_AFTER = { startedAt: T, context: { tokens: 18_000, window: 1_000_000, percent: 2 }, rateLimits: LIMITS, cost: { usd: 0 } }
const STEP_USAGE = { input_tokens: 12_000, output_tokens: 3_000, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 18_000 }
// What the test's own `classic.SessionStart` hook, the bottom of the chain, answers.
const BENEATH = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'from beneath' } }
const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }
// The values a clear starts over (A2 to A8).
const KEYS = ['main', 'agents', 'retired', 'run', 'flow', 'usage', 'view'] as const

// The engine's answers a test may turn at the clear; `denyWrites`, `denyUsage` and `denyModel` make the reset fail (A11).
type Answers = { id: string; usage: unknown; listed: { id: string; status: string; description: string; type: string }[]; denyWrites: boolean; denyUsage: boolean; denyModel: boolean }
type World = {
  clock: ReturnType<typeof mock.clock>
  stored: Record<string, unknown>
  answers: Answers
  // The mod's last write of each of its values.
  held: Map<string, unknown>
  // In order: `state:<key>` for each write of a value, `store:<key>` for each store write, `beneath` when the chain's bottom ran.
  order: string[]
}

// Everything beneath the plugin, as tests/reopen.test.ts answers it. `junk`: what the mod's
// values hold at load, as an earlier load may have left them; each reads so until the mod writes it.
async function boot($: Engine, on: On, now: number, o: { answers?: Partial<Answers>; junk?: Record<string, unknown> } = {}): Promise<World> {
  const stored: Record<string, unknown> = { sizes: { textSize: 100, iconSize: 200, barSize: 100, logLines: 5 } }
  const answers: Answers = { id: 'sess-1', usage: USAGE_BEFORE, listed: [], denyWrites: false, denyUsage: false, denyModel: false, ...o.answers }
  const junk: Record<string, unknown> = { ...o.junk }
  const clock = mock.clock(on, { now })
  const held = new Map<string, unknown>()
  const order: string[] = []
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN) {
      if (answers.denyWrites) return { deny: 'refused by the test' }
      held.set(e.key, e.value)
      order.push(`state:${e.key}`)
      delete junk[e.key]
    }
    return next(e)
  }) as never)
  on('state.get', ((_$: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN && Object.hasOwn(junk, e.key)) return { value: { value: junk[e.key], version: 0 } }
    return next(e)
  }) as never)
  const open = new Set<string>()
  let spawned = 0
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number; agentId?: string }) {
    const usage = { ...STEP_USAGE, model: e.agentId ? 'claude-haiku-4-5' : MODEL }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  } as never)
  on('tool.call', (() => ({ result: 'ok' })) as never)
  on('classic.SessionStart', (() => {
    order.push('beneath')
    return { value: BENEATH }
  }) as never)
  on('store.get', ((_$: unknown, e: { key: string }) => ({ value: stored[e.key] })) as never)
  on('store.set', ((_$: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value
    order.push(`store:${e.key}`)
    return { value: undefined }
  }) as never)
  on('store.delete', ((_$: unknown, e: { key: string }) => {
    delete stored[e.key]
    order.push(`store:${e.key}`)
    return { value: undefined }
  }) as never)
  on('session.id', (() => ({ value: answers.id })) as never)
  on('config.set', ((_$: unknown, e: { value: unknown }) => ({ value: e.value })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } })) as never)
  on('command.register', ((_$: unknown, e: { name: string }) => ({ value: { command: e.name } })) as never)
  on('session.usage', (() => (answers.denyUsage ? { deny: 'refused by the test' } : { value: answers.usage })) as never)
  on('session.model', (() => (answers.denyModel ? { deny: 'refused by the test' } : { value: MODEL })) as never)
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
  on('agent.list', (() => ({ value: answers.listed })) as never)
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
  await clock.settle()
  return { clock, stored, answers, held, order }
}

const heldOf = <V>(w: World, key: string): V => w.held.get(key) as V
// What the state holds: the last write, or with none the value's default as the mod declares it.
const DEFAULTS: Record<string, () => unknown> = { agents: () => [], run: () => null, flow: () => null, retired: blankRetired }
const heldOr = (w: World, key: string): unknown => (w.held.has(key) ? w.held.get(key) : DEFAULTS[key]?.())
// The store's writes and the `rates` writes in `order` from index `from` on (A10).
const touched = (w: World, from: number): string[] => w.order.slice(from).filter(x => x.startsWith('store:') || x === 'state:rates')
// The values a clear starts over, as they stand now (a deep copy).
const snapshot = (w: World): Record<string, unknown> => JSON.parse(JSON.stringify(Object.fromEntries(KEYS.map(k => [k, w.held.get(k) ?? null]))))

async function userTurn($: Engine, turnId = 't1'): Promise<void> {
  await $.prompt.submit({ text: 'Go on', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Go on', turnId } as never)
}

const endMainTurn = ($: Engine, turnId = 't1') => $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId, reason: 'answer' } as never)

const spawnCrew = ($: Engine, n: number, description: string) =>
  $.agent.spawn({
    tool_use_id: `tu${n}`,
    prompt: `Do this: ${description}.`,
    description,
    subagentType: 'pixel-crew:engineer',
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: MODEL,
    background: true,
    fork: false,
  } as never)

// One model request, pulled through to its end: the agent's, or the main agent's with no id.
async function step($: Engine, agentId?: string): Promise<void> {
  const s = $.turn.step({ index: 0, model: agentId ? 'claude-haiku-4-5' : MODEL, messageCount: 1, turnId: agentId ? `r-${agentId}` : 't1', ...(agentId ? { agentId } : {}) } as never) as unknown as AsyncIterator<unknown>
  for (let i = 0; i < 100; i += 1) if ((await s.next()).done) break
}

const endAgent = ($: Engine, agentId: string) => $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason: 'answer' } as never)

async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

async function mountPane($: Engine) {
  return $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never })
}

// The session card's words a second on, once the frame of every event before has landed.
async function cardWords($: Engine, w: World): Promise<string> {
  await w.clock.advance(1_000)
  const ui = await mountPane($)
  await w.clock.settle()
  const card = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt)).filter(a => a.startsWith('Session: '))
  await ui.unmount()
  return card.join('\n')
}

// The bar's words a second on.
async function barWords($: Engine, w: World): Promise<string> {
  await w.clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS as never })
  await w.clock.settle()
  const text = await words(ui)
  await ui.unmount()
  return text
}

// The work before the clear: a main turn with a step and a tool call; a first plan whose agent
// a1 works and ends; a second plan (a new title, so a1's row goes to the retired tally); a2 and
// a3 on its tasks, a2 with a tool call; a2 ends; a3 ends too unless `keep`; the main turn ends.
async function work($: Engine, w: World, keep: boolean): Promise<void> {
  await userTurn($)
  await step($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', tool_use_id: 'tu-m1' } as never)
  await $.tool.call({ tool: PROGRESS, title: 'First plan', phase: 'delegate', tasks: [{ title: 'Look around', kind: 'research' }] } as never)
  await spawnCrew($, 1, 'Look around')
  await step($, 'a1')
  await endAgent($, 'a1')
  await w.clock.advance(30_000)
  await $.tool.call({ tool: PROGRESS, title: 'Second plan', phase: 'delegate', tasks: [{ title: 'Write the parser', kind: 'build' }, { title: 'Wire the CLI', kind: 'build' }] } as never)
  await spawnCrew($, 2, 'Write the parser')
  await spawnCrew($, 3, 'Wire the CLI')
  await step($, 'a2')
  await $.tool.call({ tool: 'Read', file_path: '/repo/b.ts', agentId: 'a2', tool_use_id: 'tu-a2' } as never)
  await endAgent($, 'a2')
  await step($, 'a3')
  if (!keep) await endAgent($, 'a3')
  await endMainTurn($)
  await w.clock.settle()
}

// The clock to T, then the engine's answers turn to the new conversation's and the clear starts.
async function clear($: Engine, w: World, o: { fail?: boolean; at?: number } = {}): Promise<unknown> {
  await w.clock.advance(T - w.clock.now())
  await w.clock.settle()
  if (o.at !== undefined) await w.clock.advance(o.at - w.clock.now())
  await w.clock.settle()
  w.answers.id = 'sess-2'
  w.answers.usage = USAGE_AFTER
  if (o.fail) Object.assign(w.answers, { denyWrites: true, denyUsage: true, denyModel: true })
  const r = await $.classic.SessionStart({ source: 'clear', session_id: 'sess-2' } as never)
  await w.clock.settle()
  return r
}

// Set-up checks of the work, on today's code: what a clear has to start over is there.
function expectWorked(w: World, keep: boolean): void {
  const rows = heldOf<AgentRun[]>(w, 'agents')
  expect(rows.map(a => `${a.id} ${a.status}`)).toEqual(['a2 done', `a3 ${keep ? 'running' : 'done'}`])
  expect(heldOf<{ costUsd: number }>(w, 'retired').costUsd).toBeGreaterThan(0)
  expect(heldOf<Run>(w, 'run').ids).toEqual(['a1', 'a2', 'a3'])
  expect(heldOf<{ title: string }>(w, 'flow').title).toBe('Second plan')
  expect(heldOf<MainRun>(w, 'main').turns).toBe(1)
  expect(heldOf<Usage>(w, 'usage').costUsd).toBe(11.73)
}

// ---------------------------------------------------------------------------
// The twin: a session freshly started at T with the engine's answers after the clear.

type Twin = { main: MainRun; usage: Usage; card: string }
let TWIN: Twin | null = null
const twin = (): Twin => {
  if (!TWIN) throw new Error('the twin did not run before this test')
  return TWIN
}

test('twin: a session freshly started at T with the answers after the clear', { timeoutMs: 30_000 }, async ($, on) => {
  const w = await boot($, on, T, { answers: { id: 'sess-2', usage: USAGE_AFTER } })
  const main = heldOf<MainRun>(w, 'main')
  const usage = heldOf<Usage>(w, 'usage')
  // What the twin's run holds: a fresh main agent on the session's model, the engine's figures.
  expect(main).toEqual({ ...blankMain(T), model: MODEL, contextMax: 1_000_000 })
  expect(usage.sessionStartedAt).toBe(T)
  expect(usage.costUsd).toBe(0)
  // A fresh session holds no rows, run, plan or retired tally (written as their defaults, or not at all).
  expect(heldOr(w, 'agents')).toEqual([])
  expect(heldOr(w, 'run')).toBeNull()
  expect(heldOr(w, 'flow')).toBeNull()
  expect(heldOr(w, 'retired')).toEqual(blankRetired())
  TWIN = { main, usage, card: await cardWords($, w) }
  expect(TWIN.card).toContain('Session: ')
})

// ---------------------------------------------------------------------------
// The two scenarios, each rule its own test.

const SCENARIOS = [
  { name: 'nothing active at the clear', keep: false },
  { name: 'a3 still running at the clear', keep: true },
] as const

for (const { name, keep } of SCENARIOS) {
  const t = (rule: string, body: ($: Engine, w: World, before: Record<string, unknown>) => Promise<void>) =>
    test(`${rule} (${name})`, { timeoutMs: 60_000 }, async ($, on) => {
      const w = await boot($, on, T0)
      await work($, w, keep)
      await w.clock.advance(T - w.clock.now())
      await w.clock.settle()
      expectWorked(w, keep)
      // The values as they stand at the clear.
      await body($, w, snapshot(w))
    })

  t('A1: a clear runs next(e) first, then writes the pane-open entry, then starts the values over', async ($, w) => {
    const from = w.order.length
    await clear($, w)
    const after = w.order.slice(from)
    // Set-up: the pane opened by itself (`autoOpen: any`), so the clear writes the new id's entry.
    expect(Object.keys(w.stored.paneOpen as object).sort()).toEqual(['sess-1', 'sess-2'])
    expect(after[0]).toBe('beneath')
    const entry = after.indexOf('store:paneOpen')
    expect(entry).toBeGreaterThan(0)
    const firstWrite = after.findIndex(x => x.startsWith('state:'))
    expect(firstWrite).toBeGreaterThan(entry)
    // A10: the pane-open entry is the clear's one write to the store, and the rates are not written.
    expect(touched(w, from)).toEqual(['store:paneOpen'])
  })

  t('A1: a start by startup, resume, compact or fork leaves every value as it was', async ($, w, before) => {
    for (const source of ['startup', 'resume', 'compact', 'fork']) {
      const r = await $.classic.SessionStart({ source, session_id: 'sess-1' } as never)
      await w.clock.settle()
      expect(r).toEqual({ value: BENEATH })
      expect(snapshot(w)).toEqual(before)
    }
  })

  t('A2: the main agent is a fresh session’s, then follows its subagents', async ($, w) => {
    await clear($, w)
    const main = heldOf<MainRun>(w, 'main')
    if (keep) expect(main).toEqual({ ...twin().main, status: 'waiting', doing: 'Waiting for 1 agent' })
    else expect(main).toEqual(twin().main)
  })

  t('A3: the rows a new plan keeps stay exactly as they were, the others are dropped', async ($, w, before) => {
    await clear($, w)
    const kept = (before.agents as AgentRun[]).filter(a => a.status === 'running')
    expect(heldOf<AgentRun[]>(w, 'agents')).toEqual(kept)
  })

  t('A4: the retired tally starts over, the dropped rows not added to it', async ($, w) => {
    await clear($, w)
    expect(heldOf(w, 'retired')).toEqual(blankRetired())
  })

  t('A5: the run is null, or keeps only the kept rows’ ids with its mark afresh', async ($, w, before) => {
    await clear($, w)
    const run = heldOf<Run | null>(w, 'run')
    if (!keep) {
      expect(run).toBeNull()
      return
    }
    const was = before.run as Run
    const rows = heldOf<AgentRun[]>(w, 'agents')
    // The run as A5 leaves it, and then as `holdFill` leaves it at T with no plan.
    const fresh: Run = { ...was, ids: ['a3'], high: 0 }
    delete fresh.highKey
    delete fresh.quiet
    const view = barView(null, fresh, rows, T)
    const expected = heldRun(fresh, view.key, viewFill(view, fresh, rows, T), view.isPlan ? undefined : runQuiet(fresh, rows, T))
    expect(run).toEqual(expected)
    expect(await barWords($, w)).toContain('Agents 0/1')
  })

  t('A6: the plan is gone', async ($, w) => {
    await clear($, w)
    expect(heldOf(w, 'flow')).toBeNull()
  })

  t('A7: the usage is a fresh session’s', async ($, w) => {
    await clear($, w)
    expect(heldOf(w, 'usage')).toEqual(twin().usage)
  })

  test(`A8: the open logs and the row page go, the rest of the view stays (${name})`, { timeoutMs: 60_000 }, async ($, on) => {
    const w = await boot($, on, T0)
    await work($, w, keep)
    // An open log under a2's row (which anchors the page) and the compact panel.
    await w.clock.advance(1_000)
    const p = await mountPane($)
    await w.clock.settle()
    await p.press({ key: 'log-a2' })
    await p.press({ key: 'toggle-done' })
    await p.press({ key: 'toggle-compact' })
    await p.unmount()
    // The bar collapsed: `isBarCollapsed` and `barToggledAt`.
    await $.command.run({ command: 'crew', args: 'bar' } as never)
    await w.clock.settle()
    const was = heldOf<View>(w, 'view')
    // Set-up: what the presses left.
    expect(was.openLogs).toEqual(['a2'])
    expect(was.rowPage).toEqual({ n: 0, first: 'a2' })
    expect(was.isCompact).toBe(true)
    expect(was.isDoneCollapsed).toBe(true)
    expect(was.isBarCollapsed).toBe(true)
    expect(was.barToggledAt).toBeGreaterThan(0)
    expect(was.autoOpenedFor).not.toBe('')
    expect(was.paneOpenedAt).toBeGreaterThan(0)
    const kept = JSON.parse(JSON.stringify(was)) as View
    await clear($, w)
    const expected: View = { ...kept, openLogs: [] }
    delete expected.rowPage
    expect(heldOf(w, 'view')).toEqual(expected)
  })

  t('A1, A10, A12: with the pane closed at the clear the panel still starts over, and the store is not written', async ($, w, before) => {
    await $.command.run({ command: 'crew' } as never)
    await w.clock.settle()
    // Set-up: the pane is closed and its entry forgotten.
    expect(w.stored.paneOpen).toBeUndefined()
    const view = heldOf<View>(w, 'view')
    const from = w.order.length
    await clear($, w)
    const after = w.order.slice(from)
    expect(after[0]).toBe('beneath')
    expect(touched(w, from)).toEqual([])
    expect(after.some(x => x.startsWith('state:'))).toBe(true)
    const rows = (before.agents as AgentRun[]).filter(a => a.status === 'running')
    expect(heldOf<AgentRun[]>(w, 'agents')).toEqual(rows)
    expect(heldOf<MainRun>(w, 'main')).toEqual(keep ? { ...twin().main, status: 'waiting', doing: 'Waiting for 1 agent' } : twin().main)
    expect(heldOf(w, 'retired')).toEqual(blankRetired())
    expect(heldOf(w, 'flow')).toBeNull()
    expect(heldOf(w, 'usage')).toEqual(twin().usage)
    if (keep) expect(heldOf<Run>(w, 'run').ids).toEqual(['a3'])
    else expect(heldOf(w, 'run')).toBeNull()
    expect(heldOf(w, 'view')).toEqual({ ...view, openLogs: [] })
  })

  t('A9: a clear between two ticks stamps now at its own time', async ($, w) => {
    // Set-up: the last stamp is older than the clear.
    expect(heldOf<number>(w, 'now')).toBeLessThan(T + 500)
    await clear($, w, { at: T + 500 })
    expect(heldOf(w, 'now')).toBe(T + 500)
  })

  t('A11: a reset that fails is swallowed, the start not held up and next(e)’s result returned', async ($, w) => {
    const r = await clear($, w, { fail: true })
    expect(r).toEqual({ value: BENEATH })
    // The pane-open entry was written before the reset, as today.
    expect(Object.keys(w.stored.paneOpen as object).sort()).toEqual(['sess-1', 'sess-2'])
  })
}

test('the twin’s words: with nothing active the session card after a clear reads the fresh session’s', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, T0)
  await work($, w, false)
  await clear($, w)
  expect(await cardWords($, w)).toBe(twin().card)
})

test('the twin: with a3 running, its row is unchanged, the run holds it alone, the bar reads Agents 0/1 and Claude waits for it', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, T0)
  await work($, w, true)
  await w.clock.advance(T - w.clock.now())
  await w.clock.settle()
  const row = heldOf<AgentRun[]>(w, 'agents').find(a => a.id === 'a3')
  await clear($, w)
  expect(heldOf<AgentRun[]>(w, 'agents')).toEqual([row])
  expect(heldOf<Run>(w, 'run').ids).toEqual(['a3'])
  expect(heldOf<MainRun>(w, 'main')).toMatchObject({ status: 'waiting', doing: 'Waiting for 1 agent' })
  expect(heldOf(w, 'retired')).toEqual(blankRetired())
  expect(heldOf(w, 'flow')).toBeNull()
  expect(heldOf(w, 'usage')).toEqual(twin().usage)
  expect(await barWords($, w)).toContain('Agents 0/1')
})

// ---------------------------------------------------------------------------
// A3 and A5, the rows a new plan keeps beyond an active one, and an ended run.

// A row a load left running, quiet 16 minutes and not listed: the first sync closes it with a mark that fits.
const QUIET_START = T0 - 16 * 60_000
const STORED_ROW: AgentRun = {
  id: 'a9',
  agentId: 'a9',
  type: 'pixel-crew:engineer',
  kind: 'build',
  tint: 0,
  description: 'Write the lexer',
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
  log: [{ at: QUIET_START, kind: 'note', text: 'Started as Build on Haiku 4.5', outcome: 'ok' }],
}

test('A3: a row the 15-minute rule closed whose mark fits is kept exactly; an ended row beside it is dropped', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, T0, { junk: { agents: [STORED_ROW] } })
  await w.clock.advance(6_000)
  await w.clock.settle()
  const marked = heldOf<AgentRun[]>(w, 'agents').find(a => a.id === 'a9')
  // Set-up: the sync closed it with a mark that fits.
  expect(marked && isMarked(marked)).toBe(true)
  await userTurn($)
  await spawnCrew($, 1, 'Look around')
  await endAgent($, 'a1')
  await endMainTurn($)
  await w.clock.settle()
  expect(heldOf<AgentRun[]>(w, 'agents').map(a => `${a.id} ${a.status}`)).toEqual(['a9 failed', 'a1 done'])
  const kept = JSON.parse(JSON.stringify(heldOf<AgentRun[]>(w, 'agents').find(a => a.id === 'a9')))
  await clear($, w)
  expect(heldOf<AgentRun[]>(w, 'agents')).toEqual([kept])
  expect(heldOf(w, 'retired')).toEqual(blankRetired())
})

test('A5: a run that ended is null after a clear, though a row of it is kept', { timeoutMs: 120_000 }, async ($, on) => {
  const w = await boot($, on, T0, { answers: { listed: [{ id: 'a1', status: 'running', description: 'Look around', type: 'pixel-crew:engineer' }] } })
  await userTurn($)
  await spawnCrew($, 1, 'Look around')
  await endMainTurn($)
  // a1 quiet past STUCK_MS, still listed so the sync leaves it running: the next prompt ends its run.
  await w.clock.advance(STUCK_MS + 5_000)
  await userTurn($, 't2')
  await endMainTurn($, 't2')
  await w.clock.settle()
  // Set-up: the run ended, a1 still running.
  expect(heldOf<Run>(w, 'run').endedAt).toBeDefined()
  expect(heldOf<AgentRun[]>(w, 'agents').map(a => `${a.id} ${a.status}`)).toEqual(['a1 running'])
  const at = w.clock.now() + 60_000
  await w.clock.advance(at - w.clock.now())
  w.answers.id = 'sess-2'
  w.answers.usage = USAGE_AFTER
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-2' } as never)
  await w.clock.settle()
  expect(heldOf<AgentRun[]>(w, 'agents').map(a => `${a.id} ${a.status}`)).toEqual(['a1 running'])
  expect(heldOf(w, 'run')).toBeNull()
})

// ---------------------------------------------------------------------------
// A5 and A11: a stored run of an unexpected shape (an older version's) must not stop the reset.

const JUNK_RUNS = [
  { name: 'no ids at all', run: { startedAt: T0, high: 0.5 } },
  { name: 'ids is a string', run: { startedAt: T0, ids: 'a1,a2', high: 0.5 } },
] as const

for (const { name, run } of JUNK_RUNS) {
  test(`A5, A11: a stored run with ${name} does not stop the reset the clear makes`, { timeoutMs: 60_000 }, async ($, on) => {
    // The mod's `run` and `view` read so at load, until the mod writes them; the view has an open log.
    const w = await boot($, on, T0, { junk: { run, view: { openLogs: ['a2'] } } })
    // No prompt: a prompt would end the stored run (`endedAt`), and the reset's step for `run` returns early for an ended one.
    await $.tool.call({ tool: PROGRESS, title: 'Second plan', phase: 'delegate', tasks: [{ title: 'Write the parser', kind: 'build' }] } as never)
    await w.clock.settle()
    await w.clock.advance(T - w.clock.now())
    await w.clock.settle()
    // What the mod holds: its last write; with none, what `boot` hands it (a hand-made value reads so until the mod writes that key).
    const stored = (key: string, handed: unknown): unknown => (w.held.has(key) ? w.held.get(key) : handed)
    // Set-up: the mod never wrote `run`, so the junk is what it reads and holds; a plan is reported; the log is open.
    expect(w.held.has('run')).toBe(false)
    expect(stored('flow', null)).toMatchObject({ title: 'Second plan' })
    expect((stored('view', { openLogs: ['a2'] }) as View).openLogs).toEqual(['a2'])
    await clear($, w)
    // The run's step is the reset's third write; every value after it has to be put back too.
    expect(stored('run', run)).toBeNull()
    expect(stored('flow', null)).toBeNull()
    expect(stored('usage', null)).toEqual(twin().usage)
    expect((stored('view', { openLogs: ['a2'] }) as View).openLogs).toEqual([])
    expect(stored('main', null)).toEqual(twin().main)
  })
}
