// 2.5.1, section 2 of the contract: a change of one size writes that one size (S1 to S4), and
// the pane that opened itself for a subagent outside a plan keeps that key for the session (O1
// to O3). Everything goes through the wiring, from beneath the mod: events and commands in;
// out come the objects written under the store key `sizes`, the panes opened, and the view the
// mod keeps as `$.state` (read from each `state.set` of the key `view`: its `autoOpenedFor` is
// one `|`-separated string, and no test reads the place of a key in it, O2).
//
// "The other session" is played by changing the stored object directly, as another session of
// the mod would have written it: the store is shared by every open session and this load reads
// it once, so what this load holds after that is an old copy.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const T0 = Date.parse('2026-11-25T10:00:00Z')
const PANE_PROPS = { title: 'Crew settings', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-25T11:07:00Z' }],
  cost: { usd: 11.73 },
}

// What this load reads at its start: no size at its default, so a drawing shows what was read.
const START = { textSize: 100, iconSize: 90, barSize: 120, logLines: 15 }
type Sizes = typeof START

type World = {
  clock: ReturnType<typeof mock.clock>
  // The store, as the engine's one JSON file: a test changes it directly as another session would.
  stored: Record<string, unknown>
  // Each object written under `sizes`, in order.
  sizeWrites: unknown[]
  opened: string[]
  // Once set, every read of the store key `sizes` rejects; `readsOfSizes` counts the reads since then.
  rejectSizes: { isOn: boolean; reads: number }
  // The `autoOpenedFor` of the last `view` the mod wrote ('' while it wrote none).
  autoOpenedFor: () => string
}

// Everything beneath the plugin, as register.test.ts answers it, with the pieces these tests read.
async function boot($: Engine, on: On, stored: Record<string, unknown> = {}): Promise<World> {
  const views: unknown[] = []
  on('state.set', ((_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.plugin === PLUGIN && e.key === 'view') views.push(e.value)
    return next(e)
  }) as never)
  const clock = mock.clock(on, { now: T0 })
  clocks.set($, clock)
  const sizeWrites: unknown[] = []
  const opened: string[] = []
  const open = new Set<string>()
  const rejectSizes = { isOn: false, reads: 0 }
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  } as never)
  on('tool.call', (() => ({ result: 'file text' })) as never)
  on('store.get', ((_$: unknown, e: { key: string }) => {
    if (e.key === 'sizes' && rejectSizes.isOn) {
      rejectSizes.reads += 1
      return { deny: 'the store cannot be read' }
    }
    return { value: stored[e.key] }
  }) as never)
  on('store.set', ((_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key === 'sizes') sizeWrites.push(e.value)
    stored[e.key] = e.value
    return { value: undefined }
  }) as never)
  on('store.delete', ((_$: unknown, e: { key: string }) => {
    delete stored[e.key]
    return { value: undefined }
  }) as never)
  on('session.id', (() => ({ value: 'sess-1' })) as never)
  on('classic.SessionStart', (() => ({})) as never)
  on('session.attach', ((_$: unknown, e: { clientId: string }) => ({ clientId: e.clientId })) as never)
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
  on('agent.list', (() => ({ value: [] })) as never)
  on('mcp.call', (() => ({ deny: 'no MCP server named ccd_session_mgmt' })) as never)
  on('http.fetch', (() => ({ value: { status: 503, ok: false, headers: {}, text: '' } })) as never)
  let spawned = 0
  on('agent.spawn', (() => {
    spawned += 1
    return { model: 'claude-opus-5-5', agentId: `a${spawned}` }
  }) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  const autoOpenedFor = (): string => {
    const v = views.at(-1) as { autoOpenedFor?: unknown } | undefined
    return typeof v?.autoOpenedFor === 'string' ? v.autoOpenedFor : ''
  }
  return { clock, stored, sizeWrites, opened, rejectSizes, autoOpenedFor }
}

const clocks = new WeakMap<Engine, ReturnType<typeof mock.clock>>()

const settingsPane = ($: Engine, surface: 'desktop' | 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-settings', props: PANE_PROPS as never })

// The texts a settings pane shows: the four sizes among them (`140%`, `15`).
async function shown(sp: Awaited<ReturnType<typeof settingsPane>>): Promise<string[]> {
  return (await sp.findAll({ type: 'Text' })).map(t => t.text)
}

const runCrew = async ($: Engine, args: string): Promise<string> => String(((await $.command.run({ command: 'crew', args } as never)) as { text?: unknown })?.text)
const last = (w: World): unknown => w.sizeWrites.at(-1)

// What the other session did: one size changed in the stored object, the rest as they stood.
function otherSession(w: World, change: Partial<Sizes>): void {
  w.stored.sizes = { ...(w.stored.sizes as Sizes), ...change }
}

// ---------------------------------------------------------------------------
// Fault 2: the sizes.

// S1 by `/crew set`. This session changes A, the other session changes B, this session changes C.
test('S1: /crew set writes the changed size and, for the others, what the store holds at that moment; this load then draws them', async ($, on) => {
  const w = await boot($, on, { sizes: { ...START } })
  // A: the set-up. This load has read the store and writes what it read, with A on.
  expect(await runCrew($, 'set textSize 120')).toBe('Set textSize to 120.')
  expect(last(w)).toEqual({ textSize: 120, iconSize: 90, barSize: 120, logLines: 15 })
  // B, by the other session.
  otherSession(w, { barSize: 150 })
  // C: B's stored value stands, not what this load read.
  expect(await runCrew($, 'set logLines 30')).toBe('Set logLines to 30.')
  expect(last(w)).toEqual({ textSize: 120, iconSize: 90, barSize: 150, logLines: 30 })
  // This load's copy is what was written: the settings pane shows B as stored.
  const sp = await settingsPane($, 'desktop')
  await w.clock.settle()
  const texts = await shown(sp)
  for (const v of ['120%', '90%', '150%', '30']) expect(texts).toContain(v)
  expect(texts).not.toContain('100%')
  await sp.unmount()
})

// S1 by a stepper of the settings pane, on both surfaces.
for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: S1: a stepper press writes the changed size and what the store holds for the others; the pane then draws them`, async ($, on) => {
    const w = await boot($, on, { sizes: { ...START } })
    const sp = await settingsPane($, surface)
    await w.clock.settle()
    // This load drew what it read.
    for (const v of ['100%', '90%', '120%', '15']) expect(await shown(sp)).toContain(v)
    await sp.press({ key: 'size-textSize-up' })
    await w.clock.settle()
    expect(last(w)).toEqual({ textSize: 110, iconSize: 90, barSize: 120, logLines: 15 })
    otherSession(w, { barSize: 150 })
    // The log lines step by 5.
    await sp.press({ key: 'size-logLines-up' })
    await w.clock.settle()
    expect(last(w)).toEqual({ textSize: 110, iconSize: 90, barSize: 150, logLines: 20 })
    const texts = await shown(sp)
    for (const v of ['110%', '90%', '150%', '20']) expect(texts).toContain(v)
    expect(texts).not.toContain('120%')
    await sp.unmount()
  })
}

// S2: the changed key's value comes from this load's copy, whatever the other session stored for it.
test('S2: when the other session changed the very key a press steps, the press steps the value the pane shows', async ($, on) => {
  const w = await boot($, on, { sizes: { ...START } })
  const sp = await settingsPane($, 'desktop')
  await w.clock.settle()
  for (const v of ['100%', '90%', '120%', '15']) expect(await shown(sp)).toContain(v)
  // The other session raised the text size to 150 and the bar to 150.
  otherSession(w, { textSize: 150, barSize: 150 })
  await sp.press({ key: 'size-textSize-up' })
  await w.clock.settle()
  const written = last(w) as Sizes
  // One step on the value shown, 100, not on the stored 150.
  expect(written.textSize).toBe(110)
  // The others as stored.
  expect(written).toEqual({ textSize: 110, iconSize: 90, barSize: 150, logLines: 15 })
  const texts = await shown(sp)
  expect(texts).toContain('110%')
  expect(texts).not.toContain('160%')
  await sp.unmount()
})

// S1: what the store holds is normalized as `loadSizes` does (model.test.ts: clamped, rounded, `130%` as 130).
test('S1: the stored sizes are read as the load reads them: clamped, rounded, text as a number, junk fields as their defaults', async ($, on) => {
  const w = await boot($, on, { sizes: { ...START } })
  const sp = await settingsPane($, 'desktop')
  await w.clock.settle()
  expect(await shown(sp)).toContain('120%')
  await sp.unmount()
  w.stored.sizes = { textSize: '130%', iconSize: 'wide', barSize: 500, logLines: 12.6 }
  expect(await runCrew($, 'set iconSize 80')).toBe('Set iconSize to 80.')
  expect(last(w)).toEqual({ textSize: 130, iconSize: 80, barSize: 160, logLines: 13 })
})

// S3: a store with no `sizes` (or junk) reads as the defaults.
test('S3: a store that holds no sizes gives the defaults for the other keys', async ($, on) => {
  const w = await boot($, on, { sizes: { ...START } })
  const sp = await settingsPane($, 'desktop')
  await w.clock.settle()
  expect(await shown(sp)).toContain('120%')
  await sp.unmount()
  delete w.stored.sizes
  expect(await runCrew($, 'set logLines 30')).toBe('Set logLines to 30.')
  expect(last(w)).toEqual({ textSize: 100, iconSize: 200, barSize: 100, logLines: 30 })
  // Junk is no sizes either.
  w.stored.sizes = 'huge'
  expect(await runCrew($, 'set barSize 90')).toBe('Set barSize to 90.')
  expect(last(w)).toEqual({ textSize: 100, iconSize: 200, barSize: 90, logLines: 50 })
})

// S3: a read that rejects. The write is made from this load's copy, and still stored and reported.
test('S3: when the read of the stored sizes rejects, the write is made from this load\'s copy', async ($, on) => {
  const w = await boot($, on, { sizes: { ...START } })
  const sp = await settingsPane($, 'desktop')
  await w.clock.settle()
  expect(await shown(sp)).toContain('120%')
  await sp.unmount()
  otherSession(w, { barSize: 150 })
  w.rejectSizes.isOn = true
  expect(await runCrew($, 'set logLines 30')).toBe('Set logLines to 30.')
  // The change read the store, and that read rejected.
  expect(w.rejectSizes.reads).toBeGreaterThan(0)
  expect(last(w)).toEqual({ textSize: 100, iconSize: 90, barSize: 120, logLines: 30 })
  // And a press does the same.
  const again = await settingsPane($, 'terminal')
  await w.clock.settle()
  await again.press({ key: 'size-textSize-up' })
  await w.clock.settle()
  expect(last(w)).toEqual({ textSize: 110, iconSize: 90, barSize: 120, logLines: 30 })
  await again.unmount()
})

// ---------------------------------------------------------------------------
// Fault 3: what the pane has opened for.

// A plan with its own title, as the progress tool takes it; its tasks are not what a subagent below is called.
const planOf = (n: number) => ({
  tool: PROGRESS,
  title: `Plan ${String(n).padStart(2, '0')}`,
  phase: 'delegate',
  tasks: [{ title: 'Write the parser' }, { title: 'Wire the CLI' }],
})

// A built-in subagent as the Agent tool starts one, on no task of any plan.
async function spawnFetch($: Engine, n: number): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: `tf${n}`,
    prompt: 'Fetch the mod interface docs and sum them up.',
    description: 'Fetch mod interface docs',
    subagentType: 'web-fetch',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as never)
}

const closePane = async ($: Engine): Promise<void> => {
  expect(await runCrew($, '')).toBe('Agents panel closed.')
}
const report = async ($: Engine, n: number): Promise<void> => {
  expect(await $.tool.call(planOf(n) as never)).toMatchObject({ result: expect.stringMatching(/^ok: /) })
}
const keysOf = (w: World): Set<string> => new Set(w.autoOpenedFor().split('|').filter(Boolean))
const title = (n: number): string => planOf(n).title

// O1: with `any`, the key `any-agent` outlives 20 plans.
test('O1: with autoOpen any, 20 plans reported after the first subagent do not make the next subagent outside a plan open the pane again', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await $.turn.start({ text: 'Fix the bug', turnId: 't1' } as never)
  await spawnFetch($, 1)
  expect(w.opened).toEqual(['crew-agents'])
  await closePane($)
  for (let n = 1; n <= 20; n += 1) {
    await report($, n)
    expect(w.opened).toHaveLength(n + 1)
    await closePane($)
  }
  // A subagent on no task of the plan: the pane was opened for that kind of agent once, and closed.
  await spawnFetch($, 2)
  expect(w.opened).toHaveLength(21)
  expect(keysOf(w).has('any-agent')).toBe(true)
  // The last plan's title is still there too.
  expect(keysOf(w).has(title(20))).toBe(true)
})

// O1's bound: `any-agent` and the newest 20 other keys. O3: a title opens the pane once while it is among them.
test('O1: after 25 plans the record holds any-agent and the newest 20 titles; a title among them opens nothing, the first one opens again', { timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on)
  await $.turn.start({ text: 'Fix the bug', turnId: 't1' } as never)
  await spawnFetch($, 1)
  await closePane($)
  for (let n = 1; n <= 25; n += 1) {
    await report($, n)
    await closePane($)
  }
  expect(w.opened).toHaveLength(26)
  const newest = Array.from({ length: 20 }, (_, i) => title(i + 6))
  expect(keysOf(w)).toEqual(new Set(['any-agent', ...newest]))
  // O3, as today: a title still among them opens nothing, the plan's own again or an earlier one.
  await report($, 25)
  await report($, 10)
  expect(w.opened).toHaveLength(26)
  // The first title was cut long ago: reported again, it opens the pane again, as today.
  await report($, 1)
  expect(w.opened).toHaveLength(27)
  await closePane($)
  // And it takes the oldest title's place; `any-agent` stays.
  const later = [...Array.from({ length: 19 }, (_, i) => title(i + 7)), title(1)]
  expect(keysOf(w)).toEqual(new Set(['any-agent', ...later]))
})

// O3, unchanged: `plan` never writes any-agent.
test('O3: with autoOpen plan the record holds the plans\' titles and never any-agent', { options: { autoOpen: 'plan' } }, async ($, on) => {
  const w = await boot($, on)
  await $.turn.start({ text: 'Fix the bug', turnId: 't1' } as never)
  await spawnFetch($, 1)
  expect(w.opened).toEqual([])
  await report($, 1)
  expect(w.opened).toEqual(['crew-agents'])
  await closePane($)
  await spawnFetch($, 2)
  await report($, 2)
  expect(w.opened).toHaveLength(2)
  expect(keysOf(w)).toEqual(new Set([title(1), title(2)]))
})

// O3, unchanged: `never` writes nothing.
test('O3: with autoOpen never nothing opens and nothing is recorded', { options: { autoOpen: 'never' } }, async ($, on) => {
  const w = await boot($, on)
  await $.turn.start({ text: 'Fix the bug', turnId: 't1' } as never)
  await spawnFetch($, 1)
  await report($, 1)
  await spawnFetch($, 2)
  expect(w.opened).toEqual([])
  expect(w.autoOpenedFor()).toBe('')
})
