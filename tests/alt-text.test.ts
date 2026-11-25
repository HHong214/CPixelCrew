// Every picture the mod hands to the app has an alt of at least one character after trimming, as
// the app's own rule says: the desktop app drops an `Svg` whose alt is empty, so a row's mascot or
// line with an empty alt is blank on screen, and so is an invisible spacer (the icon gap and the
// scroll gutter), which loses the room it holds. There is no exemption. A picture "paints
// something" when its source is not an svg element with nothing inside; the counts of those guard
// that a mount is not empty, and a picture that paints nothing is named `spacer` in a failure.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const MIN = 60_000

const OWNER_OPTIONS = { theme: 'cat', autoOpen: 'any', barContext: false, barWeek: false, barModelWeek: false, barTurn: false, barTime: false }
const OWNER_STORED = { sizes: { textSize: 110, iconSize: 200, barSize: 100, logLines: 50 }, heroCard: true }
const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const USAGE = {
  startedAt: T0 - MIN,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T14:00:00Z' }],
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

type Listed = { id: string; status: string; description: string; type: string }
type World = { clock: ReturnType<typeof mock.clock>; listed: Listed[] }

// Everything beneath the plugin, as stable-pictures.test.ts answers it.
async function boot($: Engine, on: On, stored0: Record<string, unknown>): Promise<World> {
  const stored: Record<string, unknown> = { ...stored0 }
  const clock = mock.clock(on, { now: T0 })
  const open = new Set<string>()
  const listed: Listed[] = []
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
  return { clock, listed }
}

async function spawnCrew($: Engine, w: World, n: number, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `tu${n}`,
    prompt: `Do this: ${description}.`,
    description,
    subagentType: 'pixel-crew:engineer',
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
  w.listed.push({ id: `a${n}`, status: 'running', description, type: 'pixel-crew:engineer' })
}

async function endAgent($: Engine, w: World, agentId: string): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason: 'answer' } as never)
  const i = w.listed.findIndex(x => x.id === agentId)
  if (i >= 0) w.listed.splice(i, 1)
}

// An svg element with nothing inside paints nothing.
const paints = (src: string): boolean => !/^\s*<svg\b[^>]*>\s*<\/svg>\s*$/i.test(src) && !/^\s*<svg\b[^>]*\/>\s*$/i.test(src)

type Offender = { key: string; len: number; head: string; kind: string; size: string }

// Every picture: how many paint something, and those whose alt is empty after trimming.
async function look(ui: Pick<Mounted, 'findAll'>): Promise<{ painting: number; offenders: Offender[] }> {
  const all = await ui.findAll({ type: 'Svg' })
  const painting = all.filter(s => paints(String(s.props.source)))
  const bad = all.filter(s => String(s.props.alt ?? '').trim().length < 1)
  const offenders = bad.map(s => {
    const src = String(s.props.source)
    const key = (s as unknown as { key?: unknown }).key ?? s.props.key
    const kind = !paints(src) ? 'spacer' : /class="(?:ct|cw) /.test(src) ? 'mascot' : /\sheight="1"/.test(src) ? 'line' : 'picture'
    return { key: key === undefined ? '(no key)' : String(key), len: src.length, head: src.slice(0, 80), kind, size: `${String(s.props.width)}x${String(s.props.height)}` }
  })
  return { painting: painting.length, offenders }
}

const describe = (os: Offender[]): string => os.map(o => `${o.kind} ${o.size} key=${o.key} len=${o.len} source=${JSON.stringify(o.head)}`).join('\n')

function expectNone(where: string, r: { painting: number; offenders: Offender[] }): void {
  expect(r.offenders.length, `${where}: ${r.offenders.length} pictures have an empty alt (${r.painting} paint something):\n${describe(r.offenders)}`).toBe(0)
}

const pane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never })
const sidePane = ($: Engine, id: string) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: id, props: PANE_PROPS as never })
const band = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS as never })

async function settle(w: World, ms: number): Promise<void> {
  await w.clock.advance(ms)
  await w.clock.settle()
}

const SETUPS = [
  { who: "the owner's settings", options: OWNER_OPTIONS, stored: OWNER_STORED },
  { who: 'the default settings', options: {}, stored: {} },
] as const
const VIEWS = [
  { name: 'full view', stored: {} },
  { name: 'compact view', stored: { compact: { isCompact: true } } },
] as const

for (const setup of SETUPS)
  for (const view of VIEWS) {
    const opts = { options: setup.options as never, timeoutMs: 60_000 }
    const start = async ($: Engine, on: On) => {
      const w = await boot($, on, { ...setup.stored, ...view.stored })
      const p = await pane($)
      await $.prompt.submit({ text: 'Go on', wait: false, origin: { kind: 'composer' } } as never)
      await $.turn.start({ text: 'Go on', turnId: 't1' } as never)
      return { w, p }
    }
    const endMain = async ($: Engine, w: World) => {
      await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
      await settle(w, 20_000)
    }

    test(`alt: ${setup.who}, ${view.name}: the main agent alone, its turn ended: every picture has an alt`, opts, async ($, on) => {
      const { w, p } = await start($, on)
      await endMain($, w)
      const r = await look(p)
      expect(r.painting, 'the pane draws painting pictures').toBeGreaterThan(0)
      expectNone('main alone', r)
    })

    test(`alt: ${setup.who}, ${view.name}: plus a running subagent: every picture has an alt`, opts, async ($, on) => {
      const { w, p } = await start($, on)
      await endMain($, w)
      const before = await look(p)
      await spawnCrew($, w, 1, 'Write the parser')
      await settle(w, 20_000)
      const r = await look(p)
      expect(before.painting, 'the main row draws painting pictures').toBeGreaterThan(0)
      expect(r.painting, 'the subagent row adds painting pictures').toBeGreaterThan(before.painting)
      expectNone('main + running subagent', r)
    })

    test(`alt: ${setup.who}, ${view.name}: plus a finished subagent: every picture has an alt`, opts, async ($, on) => {
      const { w, p } = await start($, on)
      await endMain($, w)
      const before = await look(p)
      await spawnCrew($, w, 1, 'Write the parser')
      await settle(w, 20_000)
      const running = await look(p)
      await endAgent($, w, 'a1')
      await settle(w, 20_000)
      const r = await look(p)
      expect(before.painting, 'the main row draws painting pictures').toBeGreaterThan(0)
      expect(running.painting, 'the running row adds painting pictures').toBeGreaterThan(before.painting)
      expect(r.painting, 'the finished subagent still draws painting pictures').toBeGreaterThan(before.painting)
      expectNone('main + finished subagent', r)
    })

    test(`alt: ${setup.who}, ${view.name}: plus a planned row: every picture has an alt`, opts, async ($, on) => {
      const { w, p } = await start($, on)
      await endMain($, w)
      const before = await look(p)
      await $.tool.call(PLAN as never)
      await settle(w, 20_000)
      const r = await look(p)
      expect(before.painting, 'the main row draws painting pictures').toBeGreaterThan(0)
      expect(r.painting, 'the planned rows add painting pictures').toBeGreaterThan(before.painting)
      expectNone('main + planned rows', r)
    })
  }

test('alt: the bar: every picture has an alt, the helper can pass', { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
  const w = await boot($, on, OWNER_STORED)
  const b = await band($)
  await $.prompt.submit({ text: 'Go on', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Go on', turnId: 't1' } as never)
  await settle(w, 20_000)
  const r = await look(b)
  expect(r.painting, 'the bar draws painting pictures').toBeGreaterThan(0)
  expectNone('bar', r)
})

for (const [id, what] of [['crew-settings', 'settings'], ['crew-guide', 'guide']] as const)
  test(`alt: the ${what} pane on the desktop: every picture has an alt`, { options: OWNER_OPTIONS as never, timeoutMs: 60_000 }, async ($, on) => {
    const w = await boot($, on, OWNER_STORED)
    const p = await sidePane($, id)
    await settle(w, 20_000)
    const r = await look(p)
    expect((await p.findAll({ type: 'Svg' })).length, `the ${what} pane draws pictures`).toBeGreaterThan(0)
    expectNone(`${what} pane`, r)
  })

// What a spacer carries. The agents pane with 24 agents at work is longer than a page, so the foot
// (`rows-prev` / `rows-next`) is drawn with the first page's Previous control empty: an icon gap
// (`iconGap` in hooks/register.tsx, from `pageFoot`), beside the scroll gutter (12 wide, 1 high).
test('alt: every invisible spacer in the agents pane has the alt Spacer', { options: OWNER_OPTIONS as never, timeoutMs: 120_000 }, async ($, on) => {
  const w = await boot($, on, OWNER_STORED)
  const p = await pane($)
  await $.prompt.submit({ text: 'Go on', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Go on', turnId: 't1' } as never)
  for (let i = 1; i <= 24; i += 1) await spawnCrew($, w, i, `shard ${i}`)
  await settle(w, 20_000)
  expect(await p.find({ key: 'rows-next' }), 'the 24 rows fill more than one page').toBeDefined()
  expect(await p.find({ key: 'rows-prev-gap' }), 'the first page leaves Previous empty').toBeDefined()
  const spacers = (await p.findAll({ type: 'Svg' })).filter(s => !paints(String(s.props.source)))
  const isGutter = (s: (typeof spacers)[number]): boolean => Number(s.props.width) === 12 && Number(s.props.height) === 1
  expect(spacers.filter(isGutter).length, 'one scroll gutter, 12 wide and 1 high').toBe(1)
  expect(spacers.filter(s => !isGutter(s)).length, 'at least one icon gap').toBeGreaterThanOrEqual(1)
  expect(spacers.map(s => `${String(s.props.width)}x${String(s.props.height)} alt=${JSON.stringify(s.props.alt)}`).filter(x => !x.endsWith('alt="Spacer"'))).toEqual([])
})
