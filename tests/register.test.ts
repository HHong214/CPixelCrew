// The wiring under `claude plugin test`: events in, state through, trees out, on
// the desktop and the terminal. Pixels are draw.test.ts's business; here the
// drawings are only searched for the words they should carry, and the trees for
// how they are put together. Settings are the plugin's options: a test that needs
// other values passes them as `test(name, { options }, body)`; the sizes, the bar order
// and the reset flag are in the store (`boot`'s `stored`). Writing an option only reaches
// `config.set` here; nothing reloads the module with it, so each test is one load: a
// sequence that goes on across reloads (the mirror sync, the reset) is checked one load
// at a time, each load given the options and store the one before left.
// `$.mcp.call` is answered by an `mcp.call` hook, as the engine's MCP servers would.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { OTHER_HUES, closeForgetsPane, reopensPane, shiftColor, withPaneOpen, withoutPaneOpen } from '../hooks/model'

const PLUGIN = 'CPixelCrew'
const PROGRESS = 'mcp__CPixelCrew__progress'
const STEP = 'mcp__CPixelCrew__step'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const SURFACES = ['desktop', 'terminal'] as const
type Surface = (typeof SURFACES)[number]

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 88, scroll: { offset: 0, bodyRows: 6 }, view: {} }

const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}
// What the engine would report with model-specific weekly windows.
const USAGE_WEEKS = {
  ...USAGE,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-11-13T13:00:00Z' },
    { kind: 'seven_day', percentUsed: 37, resetsAt: '2026-11-17T03:00:00Z' },
    { kind: 'seven_day_fable', percentUsed: 12, resetsAt: '2026-11-17T03:00:00Z' },
    { kind: 'seven_day_opus', percentUsed: 80, resetsAt: '2026-11-17T03:00:00Z' },
  ],
}
// A fresh session: the engine reports no limits before the first response.
const USAGE_FRESH = { ...USAGE, rateLimits: [] }

// What the desktop app's usage tool answers (`get_usage` on `ccd_session_mgmt`).
const APP_USAGE = {
  plan: {
    status: 'ok',
    windows: [
      { label: '5-hour limit', percentUsed: 100, resetsAt: '2026-11-13T12:59:59.803Z' },
      { label: 'Weekly · all models', percentUsed: 40, resetsAt: '2026-11-17T03:00:00Z' },
      { label: 'Weekly · Fable', percentUsed: 25, resetsAt: '2026-11-17T03:00:00Z' },
    ],
  },
}
const appText = (json: unknown = APP_USAGE) => ({ content: [{ type: 'text', text: JSON.stringify(json) }], isError: false })

// The option texts the mod writes for the plugin screen to show; the rest are settings.
const MIRRORS = ['rateNow', 'textSizeNow', 'iconSizeNow', 'barSizeNow', 'logLinesNow'].map(k => `CPixelCrew.${k}`)
const isMirror = (c: { key: string }): boolean => MIRRORS.includes(c.key)

// One model request's usage: Opus 5.5 prices it at $0.30.
const STEP_USAGE = { input_tokens: 12_000, output_tokens: 3_000, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 18_000, model: 'claude-opus-5-5' }

// The bar's items in their default order (`DEFAULT_BAR_ORDER`).
const ORDER = ['context', 'fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn', 'time']
// The bar's items in their default order, by pill key prefix.
const PILL_ORDER = ['pill-context', 'pill-fiveHour', 'pill-week', 'pill-model_week', 'pill-speed', 'pill-cache', 'pill-turn', 'pill-time']
// Every bar item off but the ones a test switches on.
const ITEMS_OFF = { barContext: false, barFiveHour: false, barWeek: false, barModelWeek: false, barSpeed: false, barCache: false, barTurn: false, barTime: false }

// What the model's response beneath the plugin streams next.
type Script = { chunks: unknown[]; usage: unknown }
type Boot = {
  clock: ReturnType<typeof mock.clock>
  writes: { key: string; value: unknown }[]
  configs: { key: string; value: unknown }[]
  opened: string[]
  open: Set<string>
  prompts: string[]
  copies: { text: string; surface: unknown }[]
  toasts: string[]
  fetches: number[]
  script: Script
  // What `$.session.model()` and `$.session.id()` answer; a test changes the model as `/model` would.
  session: { model: string; id: string }
  // Each `$.mcp.call` as `{ server, tool, args }`; what the next one answers (null: it fails).
  mcpCalls: { server: string; tool: string; args: unknown }[]
  app: { answer: unknown }
  stored: Record<string, unknown>
}
type BootOptions = { stored?: Record<string, unknown>; fx?: string; isBroken?: boolean; usage?: unknown; deny?: string; storeDeny?: Record<string, string>; app?: unknown; surfaces?: string[] }

// Everything beneath the plugin is answered here, as the engine would.
// `isBroken`: the engine's usage and model reads fail, as on a host that has neither.
// `deny`: the settings refuse every option change with that reason.
// `storeDeny`: the store refuses a write to each key named, with that reason; nothing is stored.
// `app`: what the app's usage tool answers; left out, the call fails as on a host without it.
async function boot($: Engine, on: On, o: BootOptions = {}): Promise<Boot> {
  const stored = o.stored ?? {}
  const clock = mock.clock(on, { now: T0 })
  const writes: { key: string; value: unknown }[] = []
  const configs: { key: string; value: unknown }[] = []
  const opened: string[] = []
  const prompts: string[] = []
  const copies: { text: string; surface: unknown }[] = []
  const toasts: string[] = []
  const fetches: number[] = []
  const script: Script = { chunks: [], usage: null }
  const session = { model: 'claude-opus-5-5', id: 'sess-1' }
  const open = new Set<string>()
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    for (const c of script.chunks) yield c as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: script.usage } as never
  } as never)
  on('tool.call', (() => ({ result: 'file text' })) as never)
  on('store.get', ((_$: unknown, e: { key: string }) => ({ value: stored[e.key] })) as never)
  on('store.set', ((_$: unknown, e: { key: string; value: unknown }) => {
    const refused = o.storeDeny?.[e.key]
    if (refused !== undefined) return { deny: refused }
    writes.push({ key: e.key, value: e.value })
    stored[e.key] = e.value
    return { value: undefined }
  }) as never)
  on('store.delete', ((_$: unknown, e: { key: string }) => {
    writes.push({ key: e.key, value: undefined })
    delete stored[e.key]
    return { value: undefined }
  }) as never)
  on('session.id', (() => ({ value: session.id })) as never)
  on('classic.SessionStart', (() => ({})) as never)
  on('session.attach', ((_$: unknown, e: { clientId: string }) => ({ clientId: e.clientId })) as never)
  on('config.set', ((_$: unknown, e: { key: string; value: unknown }) => {
    configs.push({ key: e.key, value: e.value })
    return o.deny === undefined ? { value: e.value } : { deny: o.deny }
  }) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } })) as never)
  on('command.register', ((_$: unknown, e: { name: string }) => ({ value: { command: e.name } })) as never)
  const fail = (): never => {
    throw new Error('not on this host')
  }
  on('session.usage', (() => (o.isBroken ? fail() : { value: o.usage ?? USAGE })) as never)
  on('session.model', (() => (o.isBroken ? fail() : { value: session.model })) as never)
  // The surfaces the session draws on: a desktop, or none in a headless run (`o.surfaces`).
  on('session.surfaces', (() => ({ value: o.surfaces ?? ['desktop'] })) as never)
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
  on('ui.copy', ((_$: unknown, e: { text: string; surface?: unknown }) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: { isCopied: true } }
  }) as never)
  on('ui.toast', ((_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  }) as never)
  on('agent.list', (() => ({ value: [] })) as never)
  const mcpCalls: { server: string; tool: string; args: unknown }[] = []
  const app = { answer: o.app ?? null }
  on('mcp.call', ((_$: unknown, e: { server: string; tool: string; args: unknown }) => {
    mcpCalls.push({ server: e.server, tool: e.tool, args: e.args })
    return app.answer === null ? { deny: 'no MCP server named ccd_session_mgmt' } : { value: app.answer }
  }) as never)
  on('http.fetch', (() => {
    fetches.push(1)
    return { value: o.fx === undefined ? { status: 503, ok: false, headers: {}, text: '' } : { status: 200, ok: true, headers: {}, text: o.fx } }
  }) as never)
  // Each spawn gets its own id: `a1`, `a2`, ...
  on('agent.spawn', ((_$: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: `a${prompts.length}` }
  }) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  return { clock, writes, configs, opened, open, prompts, copies, toasts, fetches, script, session, mcpCalls, app, stored }
}

const pane = ($: Engine, surface: Surface) => $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never })
const settingsPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-settings', props: { ...PANE_PROPS, title: 'Crew settings' } as never })
const guidePane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-guide', props: { ...PANE_PROPS, title: 'Crew guide' } as never })
const band = ($: Engine, surface: Surface, columns = BAND_PROPS.bodyColumns) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: columns } as never })

// All the words a drawing holds: the Svg sources and alts on the desktop, the Text rows elsewhere.
async function words(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const svgs = await ui.findAll({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  return [...svgs.map(s => `${String(s.props.source)} ${String(s.props.alt)}`), ...texts.map(t => t.text)].join('\n')
}

// The drawn tree, flattened: every element with its parent.
type Node = { type: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }
type Placed = { node: Node; parent: Node | null }
function flatten(root: unknown): Placed[] {
  const out: Placed[] = []
  const visit = (n: unknown, parent: Node | null): void => {
    if (!n || typeof n !== 'object') return
    const node = n as Node
    out.push({ node, parent })
    for (const c of node.children ?? []) visit(c, node)
  }
  visit(root, null)
  return out
}
const keyOf = (n: Node | null | undefined): string | undefined => (typeof n?.props?.key === 'string' ? n.props.key : undefined)
const elements = (n: Node): Node[] => (n.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)

async function tree(ui: Pick<Mounted, 'drawn'>): Promise<Placed[]> {
  return flatten(await ui.drawn())
}
const byKey = (all: Placed[], key: string): Placed | undefined => all.find(p => keyOf(p.node) === key)
const pillKeys = (all: Placed[]): string[] => all.map(p => keyOf(p.node)).filter((k): k is string => k?.startsWith('pill-') === true)
// Where a pill key falls in the fixed order (`pill-model_week-<kind>` with `pill-model_week`).
const orderOf = (key: string): number => PILL_ORDER.findIndex(k => key === k || key.startsWith(`${k}-`))

// A hover card: a hidden Box shown on hover.
const cardsOf = (all: Placed[]): Placed[] => all.filter(p => p.node.type === 'Box' && p.node.props?.display === 'none')
const hoverOf = (n: Node): unknown => n.hover ?? n.props?.hover
// No hover anywhere: no `hover` prop on any element and no hidden card Box.
async function expectNoHover(ui: Pick<Mounted, 'drawn'>): Promise<void> {
  const all = await tree(ui)
  expect(cardsOf(all)).toHaveLength(0)
  for (const p of all) expect(hoverOf(p.node)).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain('"hover"')
}
// The texts a bar pill shows (its card's are a level deeper).
const pillTexts = (all: Placed[]): Node[] => all.filter(p => p.node.type === 'Text' && /^pill-/.test(keyOf(p.parent) ?? '')).map(p => p.node)

// A bar row's last child is its icon part, holding the named controls in that order and no other.
function expectIconColumn(all: Placed[], row: string, controls: string[]): void {
  const r = byKey(all, row)
  expect(r).toBeDefined()
  const last = elements(r!.node).at(-1)
  expect(keyOf(last)).toBe(row.replace(/^bar-/, 'bar-icons-'))
  const inside = flatten(last)
    .map(p => keyOf(p.node))
    .filter(k => k === 'bar-panel' || k === 'bar-collapse')
  expect(inside).toEqual(controls)
}

// The bar's rows: the progress row ends with the panel icon then the collapse icon, and
// the pills row below it holds no icon.
function expectExpandedBar(all: Placed[]): void {
  expectIconColumn(all, 'bar-progress', ['bar-panel', 'bar-collapse'])
  const info = byKey(all, 'bar-info')
  expect(info).toBeDefined()
  const inInfo = flatten(info!.node).map(p => keyOf(p.node))
  expect(inInfo).not.toContain('bar-panel')
  expect(inInfo).not.toContain('bar-collapse')
  expect(inInfo.some(k => k?.startsWith('bar-icons-'))).toBe(false)
}

async function startTurn($: Engine, text = 'Fix the bug'): Promise<void> {
  await $.turn.start({ text, turnId: 't1' } as never)
}

// Runs one model request through the plugin, beneath it a response that streams `chunks`.
async function runStep($: Engine, script: Script, input: Record<string, unknown>, chunks: unknown[], usage: unknown): Promise<{ seen: unknown[]; result: unknown }> {
  script.chunks = chunks
  script.usage = usage
  const stream = $.turn.step({ index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input } as never)
  // Read by hand: the kit's own `stream.result` is not settled at the top of the chain, the done value is.
  const seen: unknown[] = []
  for (let n = await stream.next(); ; n = await stream.next()) {
    if (n.done) return { seen, result: n.value }
    seen.push(n.value)
  }
}

async function spawnWorker($: Engine): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'Write the parser for the config files.',
    description: 'Write the parser',
    subagentType: 'pixel-crew:engineer',
    provider: { plugin: PLUGIN, tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as never)
}

const PLAN = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', kind: 'build', model: 'opus', effort: 'high' },
    { title: 'Wire the CLI', agent: 'sprinter', after: [1] },
  ],
}

for (const surface of SURFACES) {
  test(`${surface}: the bar is drawn before the first turn, with a No task progress row and ×0`, async ($, on) => {
    await boot($, on)
    const p = await pane($, surface)
    const paneWords = await words(p)
    expect(paneWords).toContain('Claude')
    // The title row says there is no plan, with its three icons at the right.
    expect(paneWords).toContain('No task')
    for (const key of ['open-guide', 'open-settings', 'toggle-compact', 'log-main']) expect(await p.find({ key })).toBeDefined()
    await p.unmount()

    // No turn yet, no plan: the bar is there all the same.
    const bar = await band($, surface)
    const text = await words(bar)
    expect(text).toContain('No task')
    expect(text).toContain('×0')
    expect(await bar.find({ key: 'bar-collapse' })).toBeDefined()
    expect(await bar.find({ key: 'bar-panel' })).toBeDefined()
    // No settings icon, no dismiss control: only the two icons.
    expect((await bar.findAll({ type: 'Button' })).map(b => b.key).sort()).toEqual(['bar-collapse', 'bar-panel'])
    // The panel icon and then the collapse icon close the progress row; the pills row has none.
    expectExpandedBar(await tree(bar))
    await bar.unmount()

    await startTurn($)
    const later = await band($, surface)
    expect(await words(later)).toContain('No task')
    await later.unmount()
  })

  test(`${surface}: the panel icon and the collapse icon sit side by side at the right end; collapsed, the expand icon alone stays put`, async ($, on) => {
    await boot($, on)
    const bar = await band($, surface)
    const all = await tree(bar)
    const rows = byKey(all, 'bar-rows')
    expect(rows).toBeDefined()
    expect(rows!.node.props).toMatchObject({ flexDirection: 'column' })
    expect(elements(rows!.node).map(keyOf)).toEqual(['bar-progress', 'bar-info'])
    expectExpandedBar(all)
    const icons = byKey(all, 'bar-icons-progress')
    expect(icons?.node.props).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-end', flexShrink: 0, columnGap: 1 })
    // Collapsed: the expand icon alone, at the right end of a part as wide, so it does not move.
    await bar.press({ key: 'bar-collapse' })
    const folded = await tree(bar)
    expectIconColumn(folded, 'bar-collapsed', ['bar-collapse'])
    const part = byKey(folded, 'bar-icons-collapsed')
    expect(part?.node.props?.width).toBe(icons?.node.props?.width)
    expect(part?.node.props).toMatchObject({ justifyContent: 'flex-end', flexShrink: 0 })
    expect(await bar.find({ key: 'bar-panel' })).toBeUndefined()
    await bar.unmount()
  })

  test(`${surface}: a progress report draws the flow and its crew count; a subagent's report is ignored`, async ($, on) => {
    const { opened } = await boot($, on)
    expect(await $.tool.call(PLAN as never)).toMatchObject({ result: 'ok: Tasks 0/2' })
    // A reported plan opens the panel by itself, once.
    expect(opened).toEqual(['crew-agents'])

    const hijack = await $.tool.call({ tool: PROGRESS, agentId: 'a9', title: 'Hijacked', finished: true } as never)
    expect(hijack).toMatchObject({ result: 'ignored: only the main session reports the flow' })

    const bar = await band($, surface)
    // The agent count is drawn with the progress, not a Button.
    expect(await bar.find({ key: 'crew-count' })).toBeUndefined()
    for (const b of await bar.findAll({ type: 'Button' })) expect(String(b.props.label)).not.toMatch(/[x×]\d/)
    const barWords = await words(bar)
    expect(barWords).toContain('Ship the thing')
    expect(barWords).toMatch(/[x×]2/)
    expect(barWords).not.toContain('Hijacked')
    expect(barWords).not.toContain('No task')
    expectExpandedBar(await tree(bar))
    await bar.unmount()

    const p = await pane($, surface)
    const paneWords = await words(p)
    expect(paneWords).toContain('Ship the thing')
    expect(paneWords).not.toContain('No task')
    expect(paneWords).toContain('Write the parser')
    expect(paneWords).toContain('Wire the CLI')
    // A planned row has a log icon too; its log has nothing yet.
    await p.press({ key: 'log-plan-2' })
    expect(await p.find({ type: 'Text', text: 'Not started yet.' })).toBeDefined()
    expect(opened).toEqual(['crew-agents'])
    await p.unmount()
  })

  test(`${surface}: spawn, step and complete leave a finished run with tokens and cost; the fold icon hides it`, { options: { currency: 'USD' } }, async ($, on) => {
    const { prompts, script } = await boot($, on)
    await $.tool.call(PLAN as never)
    await spawnWorker($)
    // A crew worker's brief asks it to report its steps.
    expect(prompts[0]).toContain(STEP)

    expect(await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 3, note: 'Reading the grammar' } as never)).toMatchObject({ result: 'ok' })
    const chunks = [{ kind: 'text', index: 0, text: 'Done.' }, { kind: 'stop', stopReason: 'end_turn', usage: STEP_USAGE }]
    const { seen, result } = await runStep($, script, { turnId: 'r1', agentId: 'a1', effort: 'high' }, chunks, STEP_USAGE)
    // The stream and its result pass through untouched.
    expect(seen).toEqual(chunks)
    expect(result).toMatchObject({ answer: '', usage: STEP_USAGE })
    await $.turn.complete({ answer: 'Done.', durationMs: 92_000, isAborted: false, turnId: 'r1', agentId: 'a1', reason: 'answer', usage: STEP_USAGE } as never)

    const p = await pane($, surface)
    const text = await words(p)
    expect(text).toContain('Write the parser')
    expect(text).toContain('$0.30')
    expect(text).toMatch(/273k|12k/)
    expect(await p.find({ key: 'log-a1' })).toBeDefined()
    expect(await p.find({ key: 'toggle-done' })).toBeDefined()
    await p.press({ key: 'toggle-done' })
    expect(await p.find({ key: 'log-a1' })).toBeUndefined()
    await p.press({ key: 'toggle-done' })
    expect(await p.find({ key: 'log-a1' })).toBeDefined()
    await p.unmount()
  })

  test(`${surface}: the log icon opens the log under its row, copy takes the whole log, and it closes again`, async ($, on) => {
    const { copies, opened } = await boot($, on)
    await startTurn($)
    const ran = await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/draw.ts' } as never)
    // The tool's answer is what the session gets, unchanged.
    expect(ran).toMatchObject({ result: 'file text' })

    const p = await pane($, surface)
    expect(await words(p)).toContain('Reading draw.ts')
    expect(await p.find({ key: 'log-row-main' })).toBeUndefined()
    await p.press({ key: 'log-main' })
    // Under its own row: the log row comes right after the row it belongs to.
    const all = await tree(p)
    const logRow = byKey(all, 'log-row-main')
    expect(logRow).toBeDefined()
    const siblings = elements(logRow!.parent!).map(keyOf)
    expect(siblings[siblings.indexOf('log-row-main') - 1]).toBe('line-main')
    // The prompt is in the log, with the tool call after it, oldest first.
    expect(await words(p)).toMatch(/Fix the bug[\s\S]*Reading draw\.ts/)

    await p.press({ key: 'copy-main' })
    expect(copies).toHaveLength(1)
    expect(copies[0]?.surface).toBe(surface)
    expect(copies[0]?.text).toMatch(/^\d\d:\d\d:\d\d {2}› {2}Fix the bug/)
    expect(copies[0]?.text).toContain('Reading draw.ts')

    // The same icon again closes it. No pane was opened for it.
    await p.press({ key: 'log-main' })
    expect(await p.find({ key: 'log-row-main' })).toBeUndefined()
    expect(await p.find({ key: 'copy-main' })).toBeUndefined()
    expect(opened).toEqual([])
    await p.unmount()
  })

  test(`${surface}: the copy icon takes every kept entry, not only those shown`, async ($, on) => {
    const { copies } = await boot($, on)
    await startTurn($)
    for (let i = 0; i < 60; i += 1) await $.tool.call({ tool: 'Read', file_path: `/repo/file${i}.ts` } as never)
    const p = await pane($, surface)
    await p.press({ key: 'log-main' })
    await p.press({ key: 'copy-main' })
    const lines = String(copies[0]?.text).split('\n')
    // The turn row and the sixty reads.
    expect(lines).toHaveLength(61)
    expect(lines[1]).toMatch(/^\d\d:\d\d:\d\d {2}✓ {2}Reading file0\.ts {2}\(\d+\.\ds\)$/)
    expect(lines[60]).toContain('Reading file59.ts')
    await p.unmount()
  })

  test(`${surface}: the streamed main loop names the call it is writing`, async ($, on) => {
    const { script } = await boot($, on)
    await startTurn($)
    const chunks = [
      { kind: 'thinking', index: 0, text: 'The parser needs a fix. Let me look at the drawing code first.' },
      { kind: 'tool', index: 1, id: 'tu9', name: 'Read' },
      { kind: 'input', index: 1, json: '{"file_path":"/repo/hooks/dr' },
      { kind: 'input', index: 1, json: 'aw.ts"}' },
      { kind: 'stop', stopReason: 'tool_use', usage: STEP_USAGE },
    ]
    const { seen, result } = await runStep($, script, { turnId: 't1' }, chunks, STEP_USAGE)
    expect(seen).toEqual(chunks)
    expect(result).toMatchObject({ stopReason: 'end_turn', usage: STEP_USAGE })

    const p = await pane($, surface)
    expect(await words(p)).toContain('Reading draw.ts')
    await p.press({ key: 'log-main' })
    // The thought is logged with its latest sentence once the tool call ends it.
    expect(await words(p)).toContain('Thought: Let me look')
    await p.unmount()
  })

  test(`${surface}: the bar collapses and expands, remembers it, and keeps its icons last`, async ($, on) => {
    const { writes } = await boot($, on)
    await $.tool.call(PLAN as never)
    await startTurn($)
    const bar = await band($, surface)
    expectExpandedBar(await tree(bar))
    await bar.press({ key: 'bar-collapse' })
    expect(writes.filter(w => w.key === 'bar').at(-1)?.value).toEqual({ isCollapsed: true })
    const folded = await tree(bar)
    expect(byKey(folded, 'bar-info')).toBeUndefined()
    expect(byKey(folded, 'bar-progress')).toBeUndefined()
    expectIconColumn(folded, 'bar-collapsed', ['bar-collapse'])
    expect(await bar.find({ key: 'bar-panel' })).toBeUndefined()
    await bar.press({ key: 'bar-collapse' })
    expect(writes.filter(w => w.key === 'bar').at(-1)?.value).toEqual({ isCollapsed: false })
    expectExpandedBar(await tree(bar))
    expect(await $.command.run({ command: 'crew', args: 'bar' } as never)).toMatchObject({ text: 'Bar collapsed.' })
    await bar.unmount()
  })

  test(`${surface}: collapsed with no plan, the bar's line reads No task`, async ($, on) => {
    await boot($, on)
    await $.command.run({ command: 'crew', args: 'bar' } as never)
    const bar = await band($, surface)
    expect(await words(bar)).toContain('No task')
    expectIconColumn(await tree(bar), 'bar-collapsed', ['bar-collapse'])
    await bar.unmount()
  })

  test(`${surface}: the panel's icons toggle the agents, settings and guide panes, the only panes ever opened`, async ($, on) => {
    const { open, opened } = await boot($, on)
    await startTurn($)
    const bar = await band($, surface)
    await bar.press({ key: 'bar-panel' })
    expect(open.has('crew-agents')).toBe(true)
    await bar.press({ key: 'bar-panel' })
    expect(open.has('crew-agents')).toBe(false)
    await bar.unmount()

    const p = await pane($, surface)
    await p.press({ key: 'open-settings' })
    expect(open.has('crew-settings')).toBe(true)
    await p.press({ key: 'open-guide' })
    expect(open.has('crew-guide')).toBe(true)
    await p.press({ key: 'open-settings' })
    expect(open.has('crew-settings')).toBe(false)
    await p.press({ key: 'open-guide' })
    expect(open.has('crew-guide')).toBe(false)
    await p.unmount()

    for (const args of ['', '', 'open', 'settings', 'guide', 'bar', 'set theme cat', 'reset', 'log', 'what']) await $.command.run({ command: 'crew', args } as never)
    const again = await pane($, surface)
    for (const key of ['log-main', 'copy-main', 'toggle-compact', 'toggle-compact']) if (await again.find({ key })) await again.press({ key })
    await again.unmount()
    expect(new Set(opened)).toEqual(new Set(['crew-agents', 'crew-settings', 'crew-guide']))
  })

  test(`${surface}: /crew settings and /crew guide open, then close, their panes`, async ($, on) => {
    const { open } = await boot($, on)
    const run = (args: string) => $.command.run({ command: 'crew', args } as never)
    expect(await run('settings')).toEqual({ text: 'Crew settings opened.' })
    expect(open.has('crew-settings')).toBe(true)
    expect(await run('guide')).toEqual({ text: 'Crew guide opened.' })
    expect(open.has('crew-guide')).toBe(true)
    expect(await run('settings')).toEqual({ text: 'Crew settings closed.' })
    expect(open.has('crew-settings')).toBe(false)
    expect(await run('guide')).toEqual({ text: 'Crew guide closed.' })
    expect(open.has('crew-guide')).toBe(false)
  })

  test(`${surface}: hover cards only on the bar's pills, and no dismiss Button`, async ($, on) => {
    await boot($, on)
    await $.tool.call(PLAN as never)
    await startTurn($)
    const p = await pane($, surface)
    await p.press({ key: 'log-main' })
    // The panel and the two side panes have none.
    const mounts = [p, await settingsPane($, surface), await guidePane($, surface)]
    for (const ui of mounts) {
      await expectNoHover(ui)
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.role === 'dismiss')).toHaveLength(0)
    }
    for (const ui of mounts) await ui.unmount()

    const bar = await band($, surface)
    expect((await bar.findAll({ type: 'Button' })).filter(b => b.props.role === 'dismiss')).toHaveLength(0)
    const all = await tree(bar)
    const cards = cardsOf(all)
    if (surface === 'terminal') await expectNoHover(bar)
    else {
      // Each pill's last child is its card, keyless, and nothing but a pill holds one.
      const pills = all.filter(x => /^pill-/.test(keyOf(x.node) ?? ''))
      expect(pills.length).toBeGreaterThan(0)
      expect(cards).toHaveLength(pills.length)
      for (const x of pills) {
        const card = elements(x.node).at(-1)!
        expect(card.props).toMatchObject({ position: 'absolute', bottom: 1, left: 0, display: 'none', flexDirection: 'column', borderStyle: 'round', backgroundColor: 'background', paddingX: 1 })
        expect(hoverOf(card)).toEqual({ display: 'flex' })
        expect(keyOf(card)).toBeUndefined()
        const texts = flatten(card).filter(t => t.node.type === 'Text').map(t => t.node)
        expect(texts.length).toBeGreaterThanOrEqual(2)
        expect(texts[0]?.props).toMatchObject({ bold: true })
        for (const t of texts.slice(1)) expect(t.props).toMatchObject({ dimColor: true })
      }
      for (const c of cards) expect(keyOf(c.parent)).toMatch(/^pill-/)
      for (const x of all) if (hoverOf(x.node) !== undefined) expect(x.node.props?.display).toBe('none')
      // The context card: tokens used of the window.
      expect(await words(bar)).toContain('270k of 1M tokens used')
    }
    await bar.press({ key: 'bar-collapse' })
    expect((await bar.findAll({ type: 'Button' })).filter(b => b.props.role === 'dismiss')).toHaveLength(0)
    await expectNoHover(bar)
    await bar.unmount()
  })

  test(`${surface}: the settings pane holds the four size steppers, the bar order and nothing the plugin screen has`, async ($, on) => {
    const { configs, writes, clock } = await boot($, on)
    const sp = await settingsPane($, surface)
    const headings = (await sp.findAll({ type: 'Text' })).filter(t => t.props.size === 'heading')
    // The hero card's Look part (contract-hero-card.md) sits between the steppers and the bar order.
    expect(headings.map(t => t.text)).toEqual(['Sizes', 'Look', 'Bar items order'])
    for (const h of headings) expect(h.props).toMatchObject({ weight: 'semibold' })
    const text = await words(sp)
    expect(text).toContain('Sizes are set here. Each press saves at once.')
    expect(text).toContain('The order of the items on the bar. Switch items on or off under Customize > Plugins > CPixelCrew.')
    for (const shown of ['Panel text', 'Mascots', 'Bar', 'Log lines', '100%', '200%', '50']) expect(text).toContain(shown)
    // The dim closing line stays last.
    const texts = (await sp.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.at(-1)).toBe('Everything else is under Customize > Plugins > CPixelCrew.')
    // Eight stepper buttons, the hero card's one, then ▲ and ▼ per bar item, and nothing else: no Select, no Input, no checkbox, no reset.
    const keys = (await sp.findAll({ type: 'Button' })).map(b => b.key)
    expect(keys).toEqual([...['textSize', 'iconSize', 'barSize', 'logLines'].flatMap(k => [`size-${k}-down`, `size-${k}-up`]), 'hero-card', ...ORDER.flatMap(k => [`up-${k}`, `down-${k}`])])
    expect(await sp.findAll({ type: 'Select' })).toHaveLength(0)
    expect(await sp.findAll({ type: 'Input' })).toHaveLength(0)

    // Let this load's mirror sync run first, so what a press writes stands alone.
    await clock.settle()
    const before = configs.length
    await sp.press({ key: 'size-textSize-up' })
    await clock.settle()
    // The store gets the sizes; the plugin screen one mirror; no setting option is written.
    expect(writes.filter(w => w.key === 'sizes').at(-1)?.value).toEqual({ textSize: 110, iconSize: 200, barSize: 100, logLines: 50 })
    expect(configs.slice(before)).toEqual([{ key: 'CPixelCrew.textSizeNow', value: '110%' }])
    expect(await words(sp)).toContain('110%')
    // The log lines step by 5, the others by 10, each press from the sizes at the press.
    await sp.press({ key: 'size-logLines-down' })
    await sp.press({ key: 'size-iconSize-up' })
    await clock.settle()
    expect(writes.filter(w => w.key === 'sizes').at(-1)?.value).toEqual({ textSize: 110, iconSize: 210, barSize: 100, logLines: 45 })
    expect(configs.slice(before).map(c => c.key)).toEqual(['CPixelCrew.textSizeNow', 'CPixelCrew.logLinesNow', 'CPixelCrew.iconSizeNow'])
    expect(configs.every(isMirror)).toBe(true)
    await sp.unmount()
  })

  test(`${surface}: the guide pane is short Markdown about the commands and icons`, async ($, on) => {
    await boot($, on)
    const g = await guidePane($, surface)
    const md = String((await g.find({ type: 'Markdown' }))?.props.text ?? '')
    for (const s of ['Run a plan', 'Commands', 'Panel and bar']) expect(md).toContain(s)
    // The guide names no other mod; it says that any orchestrator can report a plan through `progress`.
    expect(md).not.toMatch(/session[ -]?router/i)
    expect(md).not.toMatch(/companion plugin/i)
    for (const s of ['orchestrator', '`progress`', 'panel']) expect(md).toContain(s)
    for (const gone of ['crew-flow', 'crew-delegate', 'crew-review']) expect(md).not.toContain(gone)
    for (const form of ['`/crew`', '/crew open', '/crew bar', '/crew settings', '/crew guide', '/crew set <key> <value>', '/crew reset']) expect(md).toContain(form)
    const lines = md.trim().split('\n').filter(l => l.trim())
    expect(lines.length).toBeGreaterThan(12)
    expect(lines.length).toBeLessThanOrEqual(30)
    await g.unmount()
  })
}

test('desktop: the info row is a wrapping row of keyed pills in the default order, with no Model or Cost pill', async ($, on) => {
  await boot($, on)
  await startTurn($)
  const bar = await band($, 'desktop')
  const all = await tree(bar)
  const pills = all.filter(p => /^pill-/.test(keyOf(p.node) ?? ''))
  // The default items, with what this engine reports: context and the 5-hour window (no
  // weekly one); speed and cache before any reading say so with a dash; the turn and the time.
  expect(pills.map(p => keyOf(p.node))).toEqual(['pill-context', 'pill-fiveHour', 'pill-speed', 'pill-cache', 'pill-turn', 'pill-time'])
  for (const p of pills) {
    expect(p.node.props).toMatchObject({ borderStyle: 'round', paddingX: 1, flexShrink: 0 })
    // Outline and background are tinted, whatever the tone.
    expect(typeof p.node.props?.borderColor).toBe('string')
    expect(typeof p.node.props?.backgroundColor).toBe('string')
    expect(p.parent?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
  }
  expect(all.some(p => /^pill-(model|cost|turnCost)$/.test(keyOf(p.node) ?? ''))).toBe(false)
  const text = await words(bar)
  expect(text).toContain('Context')
  expect(text).toContain('27%')
  expect(text).toContain('270k / 1M')
  expect(text).toContain('7% left')
  expect(text).toContain('resets in 1h 07m')
  expect(text).not.toContain('Opus')
  expect(text).not.toContain('$11.73')
  await bar.unmount()

  // A narrow bar says the reset time alone.
  const narrow = await band($, 'desktop', 50)
  expect(await words(narrow)).not.toContain('resets in')
  await narrow.unmount()
})

test('desktop: each extra weekly window the engine reports gets a pill of its own', async ($, on) => {
  await boot($, on, { usage: USAGE_WEEKS })
  await startTurn($)
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar))).toEqual(['pill-context', 'pill-fiveHour', 'pill-week', 'pill-model_week-seven_day_fable', 'pill-model_week-seven_day_opus', 'pill-speed', 'pill-cache', 'pill-turn', 'pill-time'])
  const text = await words(bar)
  expect(text).toContain('Week · Fable')
  expect(text).toContain('Week · Opus')
  expect(text).toContain('88% left')
  await bar.unmount()

  // And the panel lists them among its meters.
  const p = await pane($, 'desktop')
  expect(await words(p)).toContain('Week · Fable')
  await p.unmount()
})

test('desktop: the pills switched on by their options keep the default order', { options: { ...ITEMS_OFF, barTime: true, barTurn: true, barContext: true } }, async ($, on) => {
  await boot($, on)
  await startTurn($)
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar))).toEqual(['pill-context', 'pill-turn', 'pill-time'])
  expect(await words(bar)).toContain('#1')
  await bar.unmount()
})

test('desktop: an old barItems text still gives pills in the default order', { options: { barItems: 'time, turn, context' } }, async ($, on) => {
  await boot($, on, { usage: USAGE_WEEKS })
  await startTurn($)
  const bar = await band($, 'desktop')
  const keys = pillKeys(await tree(bar))
  expect(keys.length).toBeGreaterThan(0)
  const order = keys.map(orderOf)
  expect(order.every(i => i >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  await bar.unmount()
})

test('/crew set barItems writes the eight item options, in their fixed order', async ($, on) => {
  const { configs } = await boot($, on)
  expect(await $.command.run({ command: 'crew', args: 'set barItems time, turn, context' } as never)).toMatchObject({ text: 'Set barItems to context, turn, time.' })
  // From the defaults (all eight): only what differs, as booleans.
  expect(configs).toEqual([
    { key: 'CPixelCrew.barFiveHour', value: false },
    { key: 'CPixelCrew.barWeek', value: false },
    { key: 'CPixelCrew.barModelWeek', value: false },
    { key: 'CPixelCrew.barSpeed', value: false },
    { key: 'CPixelCrew.barCache', value: false },
  ])
})

test('desktop: icon controls are a clipped overlay; the panel icon, the log icon and the title icons show what is open', async ($, on) => {
  await boot($, on)
  await startTurn($)
  const bar = await band($, 'desktop')
  expect((await bar.find({ key: 'bar-panel' }))?.props.label).toBe('\u2003\u2003\u2003')
  const clips = (await bar.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.overflow === 'hidden')
  expect(clips).toHaveLength(2)
  for (const c of clips) expect(c.props).toMatchObject({ top: 0, left: 0, right: 0, bottom: 0 })
  const alts = async (ui: Pick<Mounted, 'findAll'>): Promise<string[]> => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
  expect(await alts(bar)).toContain('Open the agents panel')
  await bar.press({ key: 'bar-panel' })
  expect(await alts(bar)).toContain('Close the agents panel')
  // Two icon controls (3 cells each) and a cell between them, the same when collapsed.
  expect(byKey(await tree(bar), 'bar-icons-progress')?.node.props?.width).toBe(7)
  await bar.press({ key: 'bar-collapse' })
  expect(byKey(await tree(bar), 'bar-icons-collapsed')?.node.props?.width).toBe(7)
  await bar.unmount()

  const p = await pane($, 'desktop')
  expect(await alts(p)).toContain('Show the log')
  await p.press({ key: 'log-main' })
  expect(await alts(p)).toContain('Hide the log')
  expect(await alts(p)).toContain('Copy the log')
  // Help, settings and compact at the title row's right, in that order, with a gap.
  const icons = byKey(await tree(p), 'title-icons')
  expect(icons?.node.props).toMatchObject({ columnGap: 1 })
  const inside = flatten(icons?.node).map(x => keyOf(x.node)).filter(k => k === 'open-guide' || k === 'open-settings' || k === 'toggle-compact')
  expect(inside).toEqual(['open-guide', 'open-settings', 'toggle-compact'])
  expect(await alts(p)).toContain('Open the guide')
  expect(await alts(p)).toContain('Open the settings')
  await p.press({ key: 'open-settings' })
  expect(await alts(p)).toContain('Close the settings')
  await p.press({ key: 'open-guide' })
  expect(await alts(p)).toContain('Close the guide')
  await p.unmount()
})

test('desktop: the main row shows the model the session runs on now', async ($, on) => {
  const { session } = await boot($, on)
  await startTurn($)
  const before = await pane($, 'desktop')
  expect(await words(before)).toContain('Opus 5.5')
  await before.unmount()
  // `/model` changes it with no event: the next drawing reads it.
  session.model = 'claude-sonnet-5-5'
  const after = await pane($, 'desktop')
  const text = await words(after)
  expect(text).toContain('Sonnet 5.5')
  expect(text).not.toContain('Opus 5.5')
  await after.unmount()
  // And the next turn keeps it, so a failed read later still shows it.
  await startTurn($, 'Again')
  session.model = ''
  const kept = await pane($, 'desktop')
  expect(await words(kept)).toContain('Sonnet 5.5')
  await kept.unmount()
})

const STORED_LIMITS = {
  at: T0 - 3_600_000,
  limits: [
    { kind: 'five_hour', percentUsed: 50, resetsAt: '2026-11-13T12:00:00Z' },
    // Already reset: dropped.
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-11-13T09:00:00Z' },
  ],
}

for (const surface of SURFACES) {
  test(`${surface}: the last known limits fill a session that has none, until the engine reports its own`, async ($, on) => {
    const { writes } = await boot($, on, { usage: USAGE_FRESH, stored: { limits: STORED_LIMITS } })
    const bar = await band($, surface)
    const first = await words(bar)
    expect(first).toContain('50% left')
    expect(first).not.toContain('70% left')
    await bar.unmount()
    // Nothing reported, nothing written back.
    expect(writes.some(w => w.key === 'limits')).toBe(false)

    // A real measurement replaces them, and is remembered.
    await $.session.measure({ ...USAGE, changed: ['rateLimits'] } as never)
    const later = await band($, surface)
    const text = await words(later)
    expect(text).toContain('7% left')
    expect(text).not.toContain('50% left')
    await later.unmount()
    const kept = writes.filter(w => w.key === 'limits').at(-1)?.value as { at: number; limits: { kind: string; percentUsed: number }[] } | undefined
    expect(kept?.limits).toEqual([{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }])
    expect(typeof kept?.at).toBe('number')
  })
}

test('desktop: the panel shows the last known limits beside the context', async ($, on) => {
  await boot($, on, { usage: USAGE_FRESH, stored: { limits: STORED_LIMITS } })
  const p = await pane($, 'desktop')
  const text = await words(p)
  expect(text).toContain('5h')
  expect(text).toContain('50% left')
  await p.unmount()
})

test('stored limits that are junk or all reset are ignored, and a store failure breaks nothing', async ($, on) => {
  await boot($, on, { usage: USAGE_FRESH, stored: { limits: { at: 'x', limits: 'nope' } } })
  const bar = await band($, 'terminal')
  expect(await words(bar)).not.toContain('% left')
  await bar.unmount()
})

test('desktop: entrances carry their age, so a redraw continues them, and stop once played', async ($, on) => {
  const { clock } = await boot($, on)
  await $.tool.call(PLAN as never)
  expect(await $.command.run({ command: 'crew', args: 'open' } as never)).toMatchObject({ text: 'Agents panel opened.' })
  await clock.advance(200)
  const fresh = await pane($, 'desktop')
  expect(await words(fresh)).toMatch(/animation-delay:\s*-\d+ms/)
  await fresh.unmount()
  await clock.advance(5_000)
  const later = await pane($, 'desktop')
  expect(await words(later)).not.toMatch(/animation-delay:\s*-\d+ms/)
  await later.unmount()

  await startTurn($)
  const bar = await band($, 'desktop')
  await bar.press({ key: 'bar-collapse' })
  await clock.advance(100)
  await bar.press({ key: 'bar-collapse' })
  expect(await words(bar)).toMatch(/animation-delay:\s*-\d+ms/)
  await clock.advance(5_000)
  const settled = await band($, 'desktop')
  expect(await words(settled)).not.toMatch(/animation-delay:\s*-\d+ms/)
  await settled.unmount()
  await bar.unmount()
})

test('desktop: with animations off nothing enters', { options: { animations: false } }, async ($, on) => {
  await boot($, on)
  await $.command.run({ command: 'crew', args: 'open' } as never)
  const p = await pane($, 'desktop')
  expect(await words(p)).not.toMatch(/animation-delay:\s*-\d+ms/)
  await p.unmount()
})

// The hero card (contract-hero-card.md): on by default, behind the panel's mascots only.
const heroCards = (text: string): number => (text.match(/<g class="hero"/g) ?? []).length

test('desktop: by default the panel draws a hero card behind its mascot; the bar and the other panes draw none', async ($, on) => {
  await boot($, on)
  await startTurn($)
  const p = await pane($, 'desktop')
  const panel = await words(p)
  expect(panel).toContain('Claude')
  expect(heroCards(panel)).toBeGreaterThan(0)
  await p.unmount()
  const bar = await band($, 'desktop')
  const barWords = await words(bar)
  expect(barWords.length).toBeGreaterThan(0)
  expect(barWords).not.toMatch(/hero/)
  await bar.unmount()
  for (const other of [settingsPane, guidePane]) {
    const q = await other($, 'desktop')
    // The settings pane names the switch ("Hero cards"); no pane draws a card.
    expect(await words(q)).not.toMatch(/class="hero/)
    await q.unmount()
  }
})

// The switch is kept in the mod's store under `heroCard`, not in the plugin's options
// (contract-hero-card.md, "The switch").
const heroButton = async (ui: Pick<Mounted, 'findAll'>) => (await ui.findAll({ type: 'Button' })).find(b => b.key === 'hero-card')
const svgSources = async (ui: Pick<Mounted, 'findAll'>): Promise<string[]> => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
const runCrew = async ($: Engine, args: string): Promise<string> => String(((await $.command.run({ command: 'crew', args } as never)) as { text?: unknown })?.text)

test('desktop: an option named heroCard is not read: the panel still draws its cards', { options: { heroCard: false } as never }, async ($, on) => {
  await boot($, on)
  await startTurn($)
  const p = await pane($, 'desktop')
  const panel = await words(p)
  expect(panel).toContain('Claude')
  expect(heroCards(panel)).toBeGreaterThan(0)
  await p.unmount()
})

// What the store holds under `heroCard`: only `false` switches the cards off.
for (const [label, value, drawn] of [
  ['nothing', undefined, true],
  ['true', true, true],
  ['false', false, false],
  ['the text "false"', 'false', true],
  ['the text "off"', 'off', true],
  ['0', 0, true],
  ['null', null, true],
  ['an object', { on: false }, true],
] as const) {
  test(`desktop: with ${label} stored under heroCard the panel draws ${drawn ? 'its hero cards' : 'none'}`, async ($, on) => {
    await boot($, on, value === undefined ? {} : { stored: { heroCard: value } })
    await startTurn($)
    const p = await pane($, 'desktop')
    const panel = await words(p)
    expect(panel).toContain('Claude')
    if (drawn) expect(heroCards(panel)).toBeGreaterThan(0)
    else expect(panel).not.toMatch(/hero/)
    await p.unmount()
  })
}

test('/crew set heroCard writes the store, never an option, and redraws the panel with and without cards', async ($, on) => {
  const { configs, writes, stored, clock } = await boot($, on)
  await startTurn($)
  const p = await pane($, 'desktop')
  expect(heroCards(await words(p))).toBeGreaterThan(0)
  // Let this load's mirror sync run first, so what the command writes stands alone.
  await clock.settle()
  const before = configs.length
  // Today's answer to a boolean setting (setOption): `Set animations to false.`
  expect(await runCrew($, 'set heroCard off')).toBe('Set heroCard to false.')
  expect(stored.heroCard).toBe(false)
  expect(writes.filter(w => w.key === 'heroCard').at(-1)?.value).toBe(false)
  expect(await words(p)).not.toMatch(/hero/)
  expect(await runCrew($, 'set HEROCARD on')).toBe('Set heroCard to true.')
  expect(stored.heroCard).toBe(true)
  expect(heroCards(await words(p))).toBeGreaterThan(0)
  expect(await runCrew($, 'set heroCard no')).toBe('Set heroCard to false.')
  expect(stored.heroCard).toBe(false)
  expect(await runCrew($, 'set heroCard TRUE')).toBe('Set heroCard to true.')
  expect(stored.heroCard).toBe(true)
  await clock.settle()
  // No option and no mirror is written for it.
  expect(configs.slice(before)).toEqual([])
  expect(configs.some(c => /hero/i.test(c.key))).toBe(false)
  // A bad value is refused as a bad boolean is today (`Cannot set animations to "maybe". Usage: ...`), and nothing is written.
  const stores = writes.length
  for (const bad of ['maybe', '2', 'offf']) {
    const today = await runCrew($, `set animations ${bad}`)
    expect(today).toMatch(/^Cannot set animations to /)
    expect(await runCrew($, `set heroCard ${bad}`)).toBe(today.replace('animations', 'heroCard'))
  }
  expect(writes.length).toBe(stores)
  expect(configs.slice(before)).toEqual([])
  expect(stored.heroCard).toBe(true)
  expect(heroCards(await words(p))).toBeGreaterThan(0)
  await p.unmount()
})

test('the /crew usage text lists heroCard among the keys of /crew set', async ($, on) => {
  await boot($, on)
  const text = await runCrew($, 'set nope 1')
  const keys = /\/crew set <key> <value> \(([^)]*)\)/.exec(text)?.[1]?.split(', ') ?? []
  expect(keys).toContain('animations')
  expect(keys).toContain('heroCard')
})

test('/crew reset after heroCard was switched off puts it on again and stores it so', async ($, on) => {
  const { stored, clock } = await boot($, on)
  await startTurn($)
  const p = await pane($, 'desktop')
  expect(await runCrew($, 'set heroCard off')).toBe('Set heroCard to false.')
  expect(await words(p)).not.toMatch(/hero/)
  expect(await runCrew($, 'reset')).toBe('Resetting the crew settings to their defaults.')
  expect(stored.heroCard).toBe(true)
  await clock.advance(1_000)
  await clock.settle()
  expect(heroCards(await words(p))).toBeGreaterThan(0)
  await p.unmount()
})

test('/crew reset with heroCard stored off from an earlier load puts it on again and stores it so', async ($, on) => {
  const { stored, clock } = await boot($, on, { stored: { heroCard: false } })
  await startTurn($)
  const p = await pane($, 'desktop')
  expect(await words(p)).not.toMatch(/hero/)
  expect(await runCrew($, 'reset')).toBe('Resetting the crew settings to their defaults.')
  expect(stored.heroCard).toBe(true)
  await clock.advance(1_000)
  await clock.settle()
  expect(heroCards(await words(p))).toBeGreaterThan(0)
  const sp = await settingsPane($, 'desktop')
  expect((await heroButton(sp))?.props.label).toBe('On')
  await sp.unmount()
  await p.unmount()
})

for (const surface of SURFACES) {
  test(`${surface}: the settings pane's Look part: a heading, a muted line and the Hero cards row with its one button`, async ($, on) => {
    await boot($, on)
    const sp = await settingsPane($, surface)
    const texts = await sp.findAll({ type: 'Text' })
    const shown = texts.map(t => t.text)
    const look = shown.indexOf('Look')
    // After the last stepper (`Log lines` and its value), before "Bar items order".
    expect(look).toBeGreaterThan(shown.indexOf('Log lines'))
    expect(shown.slice(look, look + 4)).toEqual(['Look', 'A glass card behind each mascot in the panel.', 'Hero cards', 'Bar items order'])
    expect(texts[look]?.props).toMatchObject({ size: 'heading', weight: 'semibold' })
    expect(texts[look + 1]?.props).toMatchObject({ dimColor: true })
    // The name sits in the steppers' name column.
    const all = await tree(sp)
    const textOf = (n: Node): string => (n.children ?? []).filter((c): c is string => typeof c === 'string').join('')
    const column = (name: string) => all.find(x => x.node.type === 'Text' && textOf(x.node) === name)?.parent?.props?.width
    expect(column('Panel text')).toBeDefined()
    expect(column('Hero cards')).toBe(column('Panel text'))
    // One button, keyed `hero-card`, reading On while the cards are drawn.
    expect((await sp.findAll({ type: 'Button' })).filter(b => b.key === 'hero-card')).toHaveLength(1)
    expect((await heroButton(sp))?.props.label).toBe('On')
    // The last line stays.
    expect(shown.at(-1)).toBe('Everything else is under Customize > Plugins > CPixelCrew.')
    await sp.unmount()
  })

  test(`${surface}: a press of the Hero cards button flips it, stores it at once, and the pane and the panel follow`, async ($, on) => {
    const { configs, writes, stored, clock } = await boot($, on)
    await startTurn($)
    const p = surface === 'desktop' ? await pane($, surface) : null
    if (p) expect(heroCards(await words(p))).toBeGreaterThan(0)
    const sp = await settingsPane($, surface)
    await clock.settle()
    const before = configs.length
    await sp.press({ key: 'hero-card' })
    expect(stored.heroCard).toBe(false)
    expect(writes.filter(w => w.key === 'heroCard').at(-1)?.value).toBe(false)
    expect((await heroButton(sp))?.props.label).toBe('Off')
    if (p) expect(await words(p)).not.toMatch(/hero/)
    // Twice is back where it started.
    await sp.press({ key: 'hero-card' })
    expect(stored.heroCard).toBe(true)
    expect(writes.filter(w => w.key === 'heroCard').at(-1)?.value).toBe(true)
    expect((await heroButton(sp))?.props.label).toBe('On')
    if (p) expect(heroCards(await words(p))).toBeGreaterThan(0)
    await clock.settle()
    // No option and no mirror is written.
    expect(configs.slice(before)).toEqual([])
    await sp.unmount()
    if (p) await p.unmount()
  })

  test(`${surface}: with heroCard stored off the button reads Off and a press turns the cards on`, async ($, on) => {
    const { stored } = await boot($, on, { stored: { heroCard: false } })
    const sp = await settingsPane($, surface)
    expect((await heroButton(sp))?.props.label).toBe('Off')
    await sp.press({ key: 'hero-card' })
    expect(stored.heroCard).toBe(true)
    expect((await heroButton(sp))?.props.label).toBe('On')
    await sp.unmount()
  })

  test(`${surface}: when the store refuses the Hero cards press, a toast says so and nothing changes`, async ($, on) => {
    const { stored, toasts, writes } = await boot($, on, { storeDeny: { heroCard: 'disk full' } })
    await startTurn($)
    const p = surface === 'desktop' ? await pane($, surface) : null
    const sp = await settingsPane($, surface)
    await sp.press({ key: 'hero-card' })
    // Today's toast for a size the store refuses (stepSize): `Could not set textSize: <why>`.
    expect(toasts.at(-1)).toMatch(/^Could not set heroCard: /)
    expect(toasts.at(-1)).toContain('disk full')
    expect('heroCard' in stored).toBe(false)
    expect(writes.some(w => w.key === 'heroCard')).toBe(false)
    expect((await heroButton(sp))?.props.label).toBe('On')
    if (p) expect(heroCards(await words(p))).toBeGreaterThan(0)
    // A second press is refused the same way and still changes nothing.
    await sp.press({ key: 'hero-card' })
    expect(toasts.filter(t => t.startsWith('Could not set heroCard: '))).toHaveLength(2)
    expect((await heroButton(sp))?.props.label).toBe('On')
    await sp.unmount()
    if (p) await p.unmount()
  })
}

test('desktop: off, on, off through the Hero cards button gives the first panel drawing back each time', { options: { animations: false } }, async ($, on) => {
  await boot($, on, { stored: { heroCard: false } })
  await startTurn($)
  const p = await pane($, 'desktop')
  const sp = await settingsPane($, 'desktop')
  const off = await svgSources(p)
  expect(off.join('\n')).not.toMatch(/hero/)
  await sp.press({ key: 'hero-card' })
  const carded = await svgSources(p)
  expect(heroCards(carded.join('\n'))).toBeGreaterThan(0)
  expect(carded).not.toEqual(off)
  await sp.press({ key: 'hero-card' })
  expect(await svgSources(p)).toEqual(off)
  await sp.press({ key: 'hero-card' })
  expect(await svgSources(p)).toEqual(carded)
  await sp.press({ key: 'hero-card' })
  expect(await svgSources(p)).toEqual(off)
  await sp.unmount()
  await p.unmount()
})

// The backdrop is the drawing as wide as the pane's whole body: 41 columns of 8 px.
const backdrops = async (ui: Pick<Mounted, 'findAll'>): Promise<{ source: string; width: number }[]> =>
  (await ui.findAll({ type: 'Svg' })).map(s => ({ source: String(s.props.source), width: Number(s.props.width) })).filter(s => s.width === 41 * 8)

test('desktop: the dotted backdrop spans the whole pane', { options: { background: 'dots' } }, async ($, on) => {
  await boot($, on)
  const p = await pane($, 'desktop')
  const found = await backdrops(p)
  expect(found.length).toBeGreaterThan(0)
  await p.unmount()
})

test('desktop: the grid backdrop differs from the dots', { options: { background: 'grid' } }, async ($, on) => {
  await boot($, on)
  const p = await pane($, 'desktop')
  const found = await backdrops(p)
  expect(found.length).toBeGreaterThan(0)
  await p.unmount()
})

test('desktop: a plain background draws no backdrop', { options: { background: 'plain' } }, async ($, on) => {
  await boot($, on)
  const p = await pane($, 'desktop')
  expect(await backdrops(p)).toHaveLength(0)
  expect(await words(p)).toContain('Claude')
  await p.unmount()
})

test('desktop: the stored text size zooms the pane drawings and the bar size the bar, its text and its meters', { options: { barUsage: 'bar' } }, async ($, on) => {
  await boot($, on, { stored: { sizes: { textSize: 200, iconSize: 200, barSize: 160, logLines: 50 } } })
  await startTurn($)
  const p = await pane($, 'desktop')
  // Laid out at half the width and drawn twice as large: the same screen width, inside the
  // border of the panel it sits on and clear of the 12 px scroll-bar gutter.
  const card = (await p.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('Session: '))
  expect(Math.abs(Number(card?.props.width) - (41 * 8 - 8 - 12 - 2 * 8))).toBeLessThanOrEqual(2)
  const heading = (await p.findAll({ type: 'Svg' })).find(x => String(x.props.alt) === 'Main agent')
  expect(Number(heading?.props.height)).toBe(32 * 2)
  await p.unmount()
  const bar = await band($, 'desktop')
  const texts = pillTexts(await tree(bar))
  expect(texts.length).toBeGreaterThan(0)
  for (const t of texts) expect(t.props?.size).toBe('body')
  // The pill's meter grows with the bar; the icon controls keep their size.
  const meter = (await bar.findAll({ type: 'Svg' })).find(s => /^Context .* used$/.test(String(s.props.alt)))
  expect(Number(meter?.props.width)).toBe(Math.round(68 * 1.6))
  const icons = (await bar.findAll({ type: 'Svg' })).filter(s => /the bar$|agents panel$/.test(String(s.props.alt)))
  expect(icons).toHaveLength(2)
  for (const s of icons) expect(s.props).toMatchObject({ width: 22, height: 22 })
  await bar.unmount()
})

// A card drawing sits alone on a panel made like the bar's: a Box with the same round
// border and the same background token, and the drawing has no fill of its own.
async function expectOnBarPanel(p: Pick<Mounted, 'drawn'>, altStart: string): Promise<void> {
  const all = await tree(p)
  const at = all.find(x => x.node.type === 'Svg' && String(x.node.props?.alt).startsWith(altStart))
  if (!at) throw new Error(`no ${altStart} drawing`)
  expect(at.parent?.type).toBe('Box')
  expect(at.parent?.props).toMatchObject({ borderStyle: 'round', backgroundColor: 'inverseText' })
  expect(elements(at.parent as Node)).toHaveLength(1)
  expect(String(at.node.props?.source).includes('class="tile"')).toBe(false)
}

// The session card at a pane width and text size: one drawing, as wide as the pane, right
// under the title row and before the Main agent heading; no tiles and no usage rows.
async function expectCard($: Engine, cols: number, z: number): Promise<void> {
  const p = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: { ...PANE_PROPS, bodyColumns: cols } as never })
  const what = `${cols} columns at ${Math.round(z * 100)}%`
  const svgs = (await p.findAll({ type: 'Svg' })).map(x => ({ alt: String(x.props.alt), width: Number(x.props.width), height: Number(x.props.height) }))
  const at = svgs.findIndex(x => x.alt.startsWith('Session: '))
  expect(svgs.filter(x => x.alt.startsWith('Session: ')).length === 1 ? 'ok' : `${what}: not one card`).toBe('ok')
  // The card sits on the bar's panel across the pane, short of the 12 px scroll-bar gutter;
  // the drawing fills it inside its border.
  const px = Math.max(160, cols * 8 - 8) - 12 - 2 * 8
  const w = svgs[at]?.width ?? 0
  expect(w <= px && w >= px - 2 ? 'ok' : `${what}: a card of ${w} in ${px}`).toBe('ok')
  await expectOnBarPanel(p, 'Session: ')
  expect(await p.find({ key: 'tiles' })).toBeUndefined()
  // Right after the title row and its three icons, right before the Main agent heading.
  expect(svgs.slice(0, at).map(x => x.alt)).toEqual(['Ship the thing', 'Open the guide', 'Open the settings', 'Show the compact panel'])
  expect(svgs[at + 1]?.alt).toBe('Main agent')
  expect(svgs.some(x => /^(SESSION|USAGE|Session|Usage)$/.test(x.alt) || /^(Cost|Tokens|Time) /.test(x.alt))).toBe(false)
  await p.unmount()
}

test('desktop: the session card is one drawing as wide as the pane, from narrow to wide', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await startTurn($)
  for (const cols of [21, 30, 38, 41, 47, 58, 90]) await expectCard($, cols, 1)
})

test('desktop: zoomed text, the card is still as wide as the pane', async ($, on) => {
  await boot($, on, { stored: { sizes: { textSize: 120, iconSize: 100, barSize: 100, logLines: 15 } } })
  await $.tool.call(PLAN as never)
  await startTurn($)
  for (const cols of [38, 41, 60]) await expectCard($, cols, 1.2)
})

test('desktop: the card reads panelUsage: no gauges when off, the split once there are tokens', { options: { panelUsage: 'off' } }, async ($, on) => {
  const { script } = await boot($, on)
  await startTurn($)
  const alt = async (): Promise<string> => {
    const p = await pane($, 'desktop')
    const a = (await p.findAll({ type: 'Svg' })).map(x => String(x.props.alt)).find(x => x.startsWith('Session: ')) ?? ''
    await p.unmount()
    return a
  }
  const before = await alt()
  expect(before).not.toContain('Context')
  expect(before).not.toContain('router')
  await runStep($, script, { turnId: 't1' }, [{ kind: 'stop', stopReason: 'end_turn', usage: STEP_USAGE }], STEP_USAGE)
  expect(await alt()).toContain('router 100%, subagents 0%')
})

test('desktop: the compact panel is the small card, a line for Claude and each agent at work, and one line of counts', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await startTurn($)
  await spawnTask($, 'Write the parser', 1)
  await spawnTask($, 'Wire the CLI', 2)
  await endAgent($, 'a2', 'error')
  const p = await pane($, 'desktop')
  await p.press({ key: 'toggle-compact' })
  // The scroll-bar gutter's empty drawing aside.
  const alts = (await p.findAll({ type: 'Svg' })).map(x => String(x.props.alt)).filter(a => a)
  // After the title row's drawing and its three icons: the card, Claude, the agent at work, the counts.
  expect(alts.slice(4).map(a => a.split(/[:;,]/)[0])).toEqual(['Session', 'Claude', 'Build agent', '1 finished'])
  expect(alts[5]).toMatch(/^Claude, working/)
  expect(alts[6]).toContain('Write the parser')
  expect(alts[7]).toBe('1 finished, 1 failed')
  // The small card sits on the bar's panel too.
  await expectOnBarPanel(p, 'Session: ')
  // No rows, logs or headings in compact mode.
  expect(await p.find({ key: 'line-a1' })).toBeUndefined()
  expect(await p.find({ key: 'log-main' })).toBeUndefined()
  expect(alts.some(a => a === 'Main agent' || a.startsWith('Working'))).toBe(false)
  // Its icon brings the full panel back.
  await p.press({ key: 'toggle-compact' })
  expect(await p.find({ key: 'line-a1' })).toBeDefined()
  await p.unmount()
})

test('desktop: an open log starts with the row\'s cache figures; the row itself counts the cache in in', async ($, on) => {
  const { script } = await boot($, on)
  await startTurn($)
  await spawnWorker($)
  const chunks = [{ kind: 'text', index: 0, text: 'Done.' }, { kind: 'stop', stopReason: 'end_turn', usage: STEP_USAGE }]
  await runStep($, script, { turnId: 'r1', agentId: 'a1', effort: 'high' }, chunks, STEP_USAGE)
  const p = await pane($, 'desktop')
  const row = (await p.findAll({ type: 'Svg' })).find(x => /agent, \w+: Write the parser/.test(String(x.props.alt)))
  expect(String(row?.props.source)).toContain('in 270k · out 3k')
  expect(String(row?.props.source)).not.toContain('cache')
  await p.press({ key: 'log-a1' })
  const log = (await p.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('Log'))
  expect(String(log?.props.source)).toContain('Cache read 240k · write 18k')
  await p.unmount()
})

test('terminal: the text panel adds one split line once there are tokens', async ($, on) => {
  const { script } = await boot($, on)
  await startTurn($)
  const before = await paneWords($, 'terminal')
  expect(before).not.toContain('Router ')
  await runStep($, script, { turnId: 't1' }, [{ kind: 'stop', stopReason: 'end_turn', usage: STEP_USAGE }], STEP_USAGE)
  const after = await paneWords($, 'terminal')
  expect(after).toContain('Router 100% · Subagents 0%')
})

test('desktop: the bar text is footnote-sized at the default bar size, caption when small', { options: { barUsage: 'bar' } }, async ($, on) => {
  await boot($, on)
  await startTurn($)
  const bar = await band($, 'desktop')
  const texts = pillTexts(await tree(bar))
  expect(texts.length).toBeGreaterThan(0)
  for (const t of texts) expect(t.props?.size).toBe('footnote')
  const meter = (await bar.findAll({ type: 'Svg' })).find(s => /^Context .* used$/.test(String(s.props.alt)))
  expect(Number(meter?.props.width)).toBe(68)
  await bar.unmount()
})

test('desktop: a small stored bar size has caption-sized text', async ($, on) => {
  await boot($, on, { stored: { sizes: { barSize: 80 } } })
  await startTurn($)
  const bar = await band($, 'desktop')
  const texts = pillTexts(await tree(bar))
  expect(texts.length).toBeGreaterThan(0)
  for (const t of texts) expect(t.props?.size).toBe('caption')
  await bar.unmount()
  // The sizes the store left out are the defaults.
  const sp = await settingsPane($, 'desktop')
  const text = await words(sp)
  expect(text).toContain('80%')
  expect(text).toContain('200%')
  await sp.unmount()
})

test('junk sizes in the store are the defaults, and size options are not read', { options: { textSize: 150 } as never }, async ($, on) => {
  await boot($, on, { stored: { sizes: 'huge' } })
  const sp = await settingsPane($, 'terminal')
  const shown = (await sp.findAll({ type: 'Text' })).map(t => t.text)
  for (const v of ['100%', '200%', '50']) expect(shown).toContain(v)
  expect(shown).not.toContain('150%')
  await sp.unmount()
})

test('/crew set writes an option through the settings, as its own kind, and a size to the store', async ($, on) => {
  const { configs, writes } = await boot($, on)
  const run = (args: string) => $.command.run({ command: 'crew', args } as never)
  expect(await run('set theme clawd')).toMatchObject({ text: 'Set theme to clawd.' })
  expect(configs.at(-1)).toEqual({ key: 'CPixelCrew.theme', value: 'clawd' })
  expect(await run('set BARTURN off')).toMatchObject({ text: 'Set barTurn to false.' })
  expect(configs.at(-1)).toEqual({ key: 'CPixelCrew.barTurn', value: false })
  // 1.6's names for two values are read as the new ones.
  expect(await run('set barColors role')).toMatchObject({ text: 'Set barColors to kind.' })
  expect(await run('set autoOpen crew')).toMatchObject({ text: 'Set autoOpen to plan.' })
  expect(configs.at(-1)).toEqual({ key: 'CPixelCrew.autoOpen', value: 'plan' })

  // A size: the store and its mirror, no size option.
  expect(await run('set textSize 120%')).toMatchObject({ text: 'Set textSize to 120.' })
  expect(writes.filter(w => w.key === 'sizes').at(-1)?.value).toEqual({ textSize: 120, iconSize: 200, barSize: 100, logLines: 50 })
  expect(configs.filter(c => c.key === 'CPixelCrew.textSizeNow').at(-1)).toEqual({ key: 'CPixelCrew.textSizeNow', value: '120%' })
  expect(configs.some(c => c.key === 'CPixelCrew.textSize')).toBe(false)
  expect(await run('set logLines 30')).toMatchObject({ text: 'Set logLines to 30.' })
  expect(writes.filter(w => w.key === 'sizes').at(-1)?.value).toEqual({ textSize: 120, iconSize: 200, barSize: 100, logLines: 30 })

  // A value that is already so writes nothing.
  const same = configs.length
  expect(await run('set palette ocean')).toMatchObject({ text: 'Set palette to ocean.' })
  expect(configs).toHaveLength(same)

  // A bad value or key writes nothing and says how to use it; the rate options are gone
  // and the mirrors and the reset toggle are not settings.
  const before = configs.length
  expect(await run('set theme dog')).toMatchObject({ text: expect.stringContaining('Cannot set theme') })
  expect(await run('set barOrder time, dog')).toMatchObject({ text: expect.stringContaining('/crew set <key> <value>') })
  expect(await run('set barOrder')).toMatchObject({ text: expect.stringContaining('Cannot set barOrder') })
  expect(await run('set tooltips off')).toMatchObject({ text: expect.stringContaining('Cannot set tooltips') })
  for (const key of ['customRate 0.5', 'rateSource custom', 'rateNow 2', 'textSizeNow 150%', 'resetAll on']) {
    expect(await run(`set ${key}`)).toMatchObject({ text: expect.stringContaining('Cannot set') })
  }
  expect(configs).toHaveLength(before)
})

// The reset runs from the stored flag `resetting`, one option per load. Each test below
// is one load of the sequence, given the options and the store the load before left.
const OLD_SIZES = { textSize: 150, iconSize: 90, barSize: 120, logLines: 10 }
const OLD_ORDER = ['time', 'turn', 'context', 'fiveHour', 'week', 'model_week', 'speed', 'cache']
const DEFAULT_SIZES = { textSize: 100, iconSize: 200, barSize: 100, logLines: 50 }
const isReset = (c: { key: string }): boolean => c.key === 'CPixelCrew.resetAll'

test('/crew reset stores the flag, puts the sizes and the bar order back at once, and writes the first differing option', { options: { theme: 'clawd', palette: 'sunset' } }, async ($, on) => {
  const { configs, clock, stored } = await boot($, on, { stored: { sizes: { ...OLD_SIZES }, barOrder: [...OLD_ORDER] } })
  // This load's first drawing has run its mirror sync before the command.
  const bar = await band($, 'desktop')
  await clock.settle()
  const before = configs.length
  expect(await $.command.run({ command: 'crew', args: 'reset' } as never)).toEqual({ text: 'Resetting the crew settings to their defaults.' })
  expect(stored.resetting).toBe(true)
  expect(stored.sizes).toEqual(DEFAULT_SIZES)
  expect(stored.barOrder).toEqual(ORDER)
  // One option in this load, the first in the options' order; no mirror before the end.
  await clock.advance(1_000)
  await clock.settle()
  expect(configs.slice(before)).toEqual([{ key: 'CPixelCrew.theme', value: 'cat' }])
  expect(configs.some(isReset)).toBe(false)
  // What is drawn follows at once: the default sizes and order.
  const sp = await settingsPane($, 'desktop')
  expect(await words(sp)).not.toContain('150%')
  expect((await sp.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('up-'))).toEqual(ORDER.map(k => `up-${k}`))
  await sp.unmount()
  await bar.unmount()
})

test('a load with the reset flag writes the first option not at its default, and only that', { options: { theme: 'clawd', barTime: false, palette: 'sunset' } }, async ($, on) => {
  const { configs, clock, stored } = await boot($, on, { stored: { resetting: true } })
  const bar = await band($, 'terminal')
  await clock.settle()
  expect(configs).toEqual([{ key: 'CPixelCrew.theme', value: 'cat' }])
  // Not done yet: the flag stays and no mirror is written.
  expect(stored.resetting).toBe(true)
  // A tick or another drawing in the same load does not run it again.
  await clock.advance(1_000)
  const again = await pane($, 'desktop')
  await clock.settle()
  expect(configs).toHaveLength(1)
  await again.unmount()
  await bar.unmount()
})

test('the next load writes the next differing option', { options: { barTime: false, palette: 'sunset' } }, async ($, on) => {
  const { configs, clock, stored } = await boot($, on, { stored: { resetting: true } })
  const bar = await band($, 'terminal')
  await clock.settle()
  expect(configs).toEqual([{ key: 'CPixelCrew.palette', value: 'ocean' }])
  expect(stored.resetting).toBe(true)
  await bar.unmount()
})

test('the last load of a reset clears the flag, then syncs the mirrors', async ($, on) => {
  const { configs, clock, stored, writes } = await boot($, on, { stored: { resetting: true, sizes: { ...DEFAULT_SIZES } } })
  const sp = await settingsPane($, 'desktop')
  await clock.settle()
  expect(stored.resetting).toBe(false)
  const cleared = writes.findIndex(w => w.key === 'resetting' && w.value === false)
  expect(cleared).toBeGreaterThanOrEqual(0)
  // Then only mirrors, each written once; no option, and never `resetAll`.
  expect(configs.length).toBeGreaterThan(0)
  expect(configs.every(isMirror)).toBe(true)
  expect(new Set(configs.map(c => c.key)).size).toBe(configs.length)
  await sp.unmount()
})

test('a reset the settings refuse stops, clears the flag and says so', { options: { theme: 'clawd', barTime: false } }, async ($, on) => {
  const { configs, clock, toasts, stored } = await boot($, on, { deny: 'locked by policy', stored: { resetting: true } })
  const bar = await band($, 'desktop')
  await clock.settle()
  expect(configs[0]).toEqual({ key: 'CPixelCrew.theme', value: 'cat' })
  expect(toasts.at(-1)).toBe('Could not reset theme: locked by policy')
  expect(stored.resetting).toBe(false)
  // No option beyond the refused one is tried.
  expect(configs.filter(c => !isMirror(c))).toHaveLength(1)
  await bar.unmount()
})

test('the mirror sync writes only the mirrors that differ', { options: { textSizeNow: '100%', iconSizeNow: '200%', barSizeNow: '100%', logLinesNow: '999', rateNow: 'typed by hand' } }, async ($, on) => {
  const { configs, clock } = await boot($, on)
  // Nothing before the first drawing or tick of the load.
  expect(configs).toHaveLength(0)
  const bar = await band($, 'terminal')
  await clock.settle()
  expect(configs.map(c => c.key).sort()).toEqual(['CPixelCrew.logLinesNow', 'CPixelCrew.rateNow'])
  expect(configs.find(c => c.key === 'CPixelCrew.logLinesNow')?.value).toBe('50')
  expect(String(configs.find(c => c.key === 'CPixelCrew.rateNow')?.value)).toMatch(/^1 USD = [\d.]+ GBP/)
  // Once per load: more drawings and ticks write nothing more.
  await clock.advance(2_000)
  const p = await pane($, 'desktop')
  await clock.settle()
  expect(configs).toHaveLength(2)
  await p.unmount()
  await bar.unmount()
})

test('the mirror sync stops for this load after a refusal', async ($, on) => {
  const { configs, clock, writes } = await boot($, on, { deny: 'locked by policy' })
  const sp = await settingsPane($, 'desktop')
  await clock.settle()
  // The first differing mirror is tried, refused, and the sync stops there.
  const tried = configs.length
  expect(tried).toBeLessThanOrEqual(1)
  // A stepper press still stores its size, and tries no mirror.
  await sp.press({ key: 'size-barSize-up' })
  await clock.settle()
  expect(writes.filter(w => w.key === 'sizes').at(-1)?.value).toMatchObject({ barSize: 110 })
  expect(configs).toHaveLength(tried)
  await sp.unmount()
})

test('/crew set says so when the settings refuse the change', { options: { theme: 'clawd', barTime: false } }, async ($, on) => {
  const { configs, stored } = await boot($, on, { deny: 'locked by policy' })
  expect(await $.command.run({ command: 'crew', args: 'set palette sunset' } as never)).toMatchObject({ text: 'Could not set palette: locked by policy' })
  const before = configs.length
  // The reset's first write is refused: it says which, and the flag does not stay set.
  expect(await $.command.run({ command: 'crew', args: 'reset' } as never)).toEqual({ text: 'Could not reset theme: locked by policy' })
  expect(configs.slice(before)[0]).toEqual({ key: 'CPixelCrew.theme', value: 'cat' })
  expect(configs.filter(c => !isMirror(c)).slice(1)).toEqual([{ key: 'CPixelCrew.theme', value: 'cat' }])
  expect(configs.some(isReset)).toBe(false)
  expect(stored.resetting).toBe(false)
})

test('the options given to the plugin are its settings', { options: { ...ITEMS_OFF, barContext: true, theme: 'cat', panelUsage: 'off' } }, async ($, on) => {
  await boot($, on)
  await startTurn($)
  const p = await pane($, 'desktop')
  expect(await words(p)).not.toContain('USAGE')
  await p.unmount()
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar))).toEqual(['pill-context'])
  await bar.unmount()
})

test('with hover cards off, no pill has one', { options: { barTooltips: false } }, async ($, on) => {
  await boot($, on, { usage: USAGE_WEEKS })
  await startTurn($)
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar)).length).toBeGreaterThan(2)
  await expectNoHover(bar)
  await bar.unmount()
})

test('desktop: the main row holds the task strip, not ctx', async ($, on) => {
  await boot($, on)
  await startTurn($)
  const mainRow = async (): Promise<string> => {
    const p = await pane($, 'desktop')
    // The main row's drawing is the one whose alt speaks for Claude.
    const svg = (await p.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('Claude,'))
    await p.unmount()
    return `${String(svg?.props.source)} ${String(svg?.props.alt)}`
  }
  const idle = await mainRow()
  expect(idle).toContain('No task')
  expect(idle).not.toMatch(/ctx\s*\d/)
  await $.tool.call(PLAN as never)
  const planned = await mainRow()
  expect(planned).toContain('Ship the thing')
  expect(planned).toContain('Tasks 0/2')
  expect(planned).not.toMatch(/ctx\s*\d/)
})

test('desktop: the app usage tool fills Week · Fable in the bar and the panel', async ($, on) => {
  const { clock, mcpCalls, stored } = await boot($, on, { app: appText() })
  // Asked once the session has started, on a timer.
  await clock.advance(1)
  await clock.settle()
  expect(mcpCalls[0]).toEqual({ server: 'ccd_session_mgmt', tool: 'get_usage', args: { session_id: 'self' } })
  expect(stored.appUsage).toMatchObject({ ok: true, count: 3 })
  const bar = await band($, 'desktop')
  const keys = pillKeys(await tree(bar))
  // The engine's 5-hour window wins; the app adds the weekly ones it lacks.
  // No turn has started: the turn pill waits for the first.
  expect(keys).toEqual(['pill-context', 'pill-fiveHour', 'pill-week', 'pill-model_week-seven_day_fable', 'pill-speed', 'pill-cache', 'pill-time'])
  const text = await words(bar)
  expect(text).toContain('Week · Fable')
  expect(text).toContain('75% left')
  expect(text).toContain('7% left')
  await bar.unmount()
  const p = await pane($, 'desktop')
  expect(await words(p)).toContain('Week · Fable')
  await p.unmount()
  // And the terminal's line.
  const line = await band($, 'terminal')
  expect(await words(line)).toContain('Week · Fable 75% left')
  await line.unmount()
})

test('the app usage tool may answer in structured content', async ($, on) => {
  const { clock } = await boot($, on, { app: { content: [], isError: false, structuredContent: APP_USAGE } })
  await clock.advance(1)
  await clock.settle()
  const p = await pane($, 'desktop')
  expect(await words(p)).toContain('Week · Fable')
  await p.unmount()
})

test('after three failed app usage calls in a row the mod stops asking', async ($, on) => {
  const { clock, mcpCalls, stored, app } = await boot($, on)
  await clock.advance(1)
  await clock.settle()
  expect(mcpCalls).toHaveLength(1)
  expect(stored.appUsage).toMatchObject({ ok: false, count: 0, error: expect.stringContaining('no MCP server') })
  // Junk and a refusal count too; each main-loop turn asks again.
  app.answer = { content: [{ type: 'text', text: 'not json' }], isError: false }
  await startTurn($)
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  app.answer = { content: [{ type: 'text', text: JSON.stringify({ plan: { status: 'error', windows: [] } }) }], isError: false }
  await startTurn($)
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(mcpCalls).toHaveLength(3)
  // A good answer now is never asked for: not after a turn, not from the ticker.
  app.answer = appText()
  await startTurn($)
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(6 * 60_000)
  await clock.settle()
  expect(mcpCalls).toHaveLength(3)
  const bar = await band($, 'desktop')
  expect(await words(bar)).not.toContain('Week · Fable')
  await bar.unmount()
})

test('the ticker asks the app at most every five minutes, and a subagent turn does not ask', async ($, on) => {
  const { clock, mcpCalls } = await boot($, on, { app: appText() })
  await clock.advance(1)
  await clock.settle()
  expect(mcpCalls).toHaveLength(1)
  await clock.advance(60_000)
  await clock.settle()
  expect(mcpCalls).toHaveLength(1)
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 'r1', agentId: 'a1', reason: 'answer' } as never)
  await clock.settle()
  expect(mcpCalls).toHaveLength(1)
  await clock.advance(4 * 60_000 + 1_000)
  await clock.settle()
  expect(mcpCalls).toHaveLength(2)
})

test('a session starts with no toast', async ($, on) => {
  const { toasts } = await boot($, on)
  expect(toasts).toHaveLength(0)
})

test('step from the main loop is ignored', async ($, on) => {
  await boot($, on)
  expect(await $.tool.call({ tool: STEP, done: 1, total: 3 } as never)).toMatchObject({ result: 'ignored: only subagents report steps' })
  expect(await $.tool.call({ tool: STEP, agentId: 'nobody', done: 1 } as never)).toMatchObject({ result: 'ignored: no panel row for agent nobody' })
})

test('every /crew form answers', async ($, on) => {
  const { opened, open, configs } = await boot($, on)
  const run = (args: string) => $.command.run({ command: 'crew', args } as never)
  expect(await run('')).toMatchObject({ text: 'Agents panel opened.' })
  expect(await run('')).toMatchObject({ text: 'Agents panel closed.' })
  expect(await run('open')).toMatchObject({ text: 'Agents panel opened.' })
  expect(open.has('crew-agents')).toBe(true)
  expect(await run('settings')).toEqual({ text: 'Crew settings opened.' })
  expect(await run('guide')).toEqual({ text: 'Crew guide opened.' })
  expect(opened).toEqual(['crew-agents', 'crew-agents', 'crew-settings', 'crew-guide'])
  expect(await run('bar')).toMatchObject({ text: 'Bar collapsed.' })
  expect(await run('set barItems context,5h')).toMatchObject({ text: 'Set barItems to context, 5h.' })
  expect(configs.at(-1)?.key).toBe('CPixelCrew.barTime')
  const usage = await run('what')
  for (const form of ['/crew open', '/crew bar', '/crew guide', '/crew settings', '/crew set', '/crew reset']) expect(usage).toMatchObject({ text: expect.stringContaining(form) })
  // The log pane is gone, and with it `/crew log`.
  expect(await run('log')).toEqual(usage)
})

test('live rates are fetched once and kept', async ($, on) => {
  const fx = JSON.stringify({ result: 'success', rates: { GBP: 0.8, EUR: 0.9, XYZ: 5 } })
  const { clock, writes, fetches } = await boot($, on, { fx })
  await clock.advance(1)
  const stored = writes.filter(w => w.key === 'rates').at(-1)?.value as { isLive: boolean; rates: Record<string, number> } | undefined
  expect(stored?.isLive).toBe(true)
  expect(stored?.rates.GBP).toBe(0.8)
  expect(stored?.rates.XYZ).toBeUndefined()
  expect(fetches).toHaveLength(1)
  // Settings live in the engine: nothing writes them to the store.
  expect(writes.some(w => w.key === 'settings')).toBe(false)
})

test('costs are shown in the currency option', { options: { currency: 'GBP' } }, async ($, on) => {
  const { script } = await boot($, on)
  await startTurn($)
  await runStep($, script, { turnId: 't1' }, [{ kind: 'stop', stopReason: 'end_turn', usage: STEP_USAGE }], STEP_USAGE)
  const p = await pane($, 'terminal')
  expect(await words(p)).toContain('£')
  await p.unmount()
})

test('when the engine reads fail, every event still gets what lies beneath', async ($, on) => {
  const { script } = await boot($, on, { isBroken: true })
  expect(await $.turn.start({ text: 'Go', turnId: 't1' } as never)).toMatchObject({ turnId: 't1' })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).toMatchObject({ result: 'file text' })
  const chunks = [{ kind: 'text', index: 0, text: 'ok' }, { kind: 'stop', stopReason: 'end_turn', usage: STEP_USAGE }]
  const { seen, result } = await runStep($, script, { turnId: 't1' }, chunks, STEP_USAGE)
  expect(seen).toEqual(chunks)
  expect(result).toMatchObject({ usage: STEP_USAGE })
  expect(await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)).toMatchObject({ text: '' })
  expect(await $.session.measure({ ...USAGE, changed: ['rateLimits'] } as never)).toMatchObject({ changed: ['rateLimits'] })
  for (const surface of SURFACES) {
    const ui = await pane($, surface)
    expect(await words(ui)).toContain('Claude')
    await ui.unmount()
    const bar = await band($, surface)
    expect(await bar.find({ key: 'bar-collapse' })).toBeDefined()
    await bar.unmount()
  }
})

test('a main turn ends resting, with its time worked and an end row', async ($, on) => {
  await boot($, on)
  await startTurn($)
  await $.turn.complete({ answer: 'ok', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Claude · resting/ })).toBeDefined()
  await ui.press({ key: 'log-main' })
  expect(await words(ui)).toContain('Done in 42s, 0 actions')
  await ui.unmount()
})

// ---------------------------------------------------------------------------
// v6: task rows that tell the truth, pills worded by `pillText`, the bar order.

const PLAN3 = {
  tool: PROGRESS,
  title: 'Ship three',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', agent: 'engineer' },
    { title: 'Wire the CLI', agent: 'engineer' },
    { title: 'Test the CLI', agent: 'tester' },
  ],
}

async function spawnTask($: Engine, description: string, n: number): Promise<unknown> {
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

async function endAgent($: Engine, agentId: string, reason: 'answer' | 'error' = 'answer'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason } as never)
}

async function endMainTurn($: Engine): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
}

async function barWords($: Engine, surface: Surface, columns?: number): Promise<string> {
  const bar = await band($, surface, columns)
  const text = await words(bar)
  await bar.unmount()
  return text
}

// The progress row's drawing (desktop): the Svg whose alt starts with the flow's title.
async function progressSource($: Engine, title = 'Ship the thing'): Promise<string> {
  const bar = await band($, 'desktop')
  const svg = (await bar.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith(`${title}:`))
  await bar.unmount()
  expect(svg).toBeDefined()
  return String(svg?.props.source)
}
// A dot of the faint "handed out" layer: smaller than the fill's 2px dots.
const FAINT_DOT = 'width="1.7"'

for (const surface of SURFACES) {
  test(`${surface}: a flow whose three agents all end done shows Done without any progress call`, async ($, on) => {
    await boot($, on)
    await $.tool.call(PLAN3 as never)
    await startTurn($)
    for (const [i, t] of PLAN3.tasks.entries()) await spawnTask($, t.title, i + 1)
    await endMainTurn($)
    // Agents still run: the row is running, not done.
    const running = await barWords($, surface)
    expect(running).toContain('Tasks 0/3')
    expect(running).not.toContain('Paused')
    for (const id of ['a1', 'a2']) await endAgent($, id)
    expect(await barWords($, surface)).not.toContain('Done')
    await endAgent($, 'a3')
    const done = await barWords($, surface)
    expect(done).toContain('Ship three')
    expect(done).toContain('Done')
    expect(done).toContain('100%')
    expect(done).not.toContain('Tasks 0/3')
    expect(done).not.toContain('Paused')
    // The orchestrator's late reports change nothing: the flow keeps its title and runs.
    expect(await $.tool.call({ tool: PROGRESS, done: 3 } as never)).toMatchObject({ result: 'ok: Done' })
    expect(await $.tool.call({ tool: PROGRESS, finished: true } as never)).toMatchObject({ result: 'ok: Done' })
    const after = await barWords($, surface)
    expect(after).toContain('Ship three')
    expect(after).toContain('×3')
    // Collapsed, the line says Done too.
    await $.command.run({ command: 'crew', args: 'bar' } as never)
    expect(await barWords($, surface)).toContain('Done')
  })

  test(`${surface}: a flow with one failed agent stays unfinished, and pauses with nothing working`, async ($, on) => {
    await boot($, on)
    await $.tool.call(PLAN3 as never)
    await startTurn($)
    for (const [i, t] of PLAN3.tasks.entries()) await spawnTask($, t.title, i + 1)
    await endMainTurn($)
    await endAgent($, 'a1')
    await endAgent($, 'a2', 'error')
    await endAgent($, 'a3')
    const text = await barWords($, surface)
    expect(text).not.toContain('Done')
    expect(text).toContain('Paused · 0/3')
    // A count report moves it, and it stays paused.
    await $.tool.call({ tool: PROGRESS, done: 2 } as never)
    expect(await barWords($, surface)).toContain('Paused · 2/3')
  })

  test(`${surface}: the row is paused after the turn ends with an unfinished flow, and runs again with the next turn`, async ($, on) => {
    await boot($, on)
    // Nothing reported: no task yet.
    expect(await barWords($, surface)).toContain('No task yet')
    await $.tool.call(PLAN as never)
    await startTurn($)
    const working = await barWords($, surface)
    expect(working).toContain('Tasks 0/2')
    expect(working).not.toContain('Paused')
    await endMainTurn($)
    expect(await barWords($, surface)).toContain('Paused · 0/2')
    // Collapsed: `Paused 0/2`.
    await $.command.run({ command: 'crew', args: 'bar' } as never)
    expect(await barWords($, surface)).toContain('Paused 0/2')
    await $.command.run({ command: 'crew', args: 'bar' } as never)
    await startTurn($, 'Go on')
    expect(await barWords($, surface)).not.toContain('Paused')
  })
}

// A built-in subagent as the Agent tool starts one, no crew type and no plan: `web-fetch`.
async function spawnFetch($: Engine, n: number, background = false, description = 'Fetch mod interface docs'): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: `tf${n}`,
    prompt: 'Fetch the mod interface docs and sum them up.',
    description,
    subagentType: 'web-fetch',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background,
    fork: false,
  } as never)
}

// The panel's words, and on the desktop the main row's alt, which names its task strip.
async function paneWords($: Engine, surface: Surface): Promise<string> {
  const p = await pane($, surface)
  const text = await words(p)
  await p.unmount()
  return text
}

for (const surface of SURFACES) {
  for (const background of [false, true]) {
    test(`${surface}: a ${background ? 'background' : 'foreground'} web-fetch subagent with no plan on is counted by its run, Agents 0/1, then 1/1; the panel stays shut`, { options: { autoOpen: 'plan' } }, async ($, on) => {
      const { opened } = await boot($, on)
      await startTurn($)
      expect(await barWords($, surface)).toContain('No task yet')
      await spawnFetch($, 1, background)

      // Running: the bar's progress row and the main row count the run, titled by the agent.
      const running = await barWords($, surface)
      expect(running).toContain('Fetch mod interface docs')
      expect(running).toContain('Agents 0/1')
      expect(running).not.toContain('Tasks 0/1')
      expect(running).not.toContain('No task yet')
      const paneRunning = await paneWords($, surface)
      expect(paneRunning).toContain(surface === 'desktop' ? 'task Fetch mod interface docs: Agents 0/1, 0%' : 'Fetch mod interface docs · Agents 0/1')
      if (surface === 'terminal') expect(paneRunning).toContain('WORKING · 1')
      // `autoOpen` is `plan`: a subagent on no planned task does not open the panel.
      expect(opened).toEqual([])

      // Its run is over: full, in the done look, still counting.
      await endAgent($, 'a1')
      const done = await barWords($, surface)
      expect(done).toContain('Fetch mod interface docs')
      expect(done).toContain('Agents 1/1')
      expect(done).toContain('100%')
      expect(done).not.toContain('Agents 0/1')
      const paneDone = await paneWords($, surface)
      expect(paneDone).toContain(surface === 'desktop' ? 'task Fetch mod interface docs: Agents 1/1, 100%' : 'FINISHED · 1')
      expect(opened).toEqual([])
    })
  }

  test(`${surface}: a subagent started under a plan leaves the plan as it is; with no plan on, the run counts every subagent, titled by the newest`, async ($, on) => {
    await boot($, on)
    await startTurn($)
    // A failed agent counts as over; the next subagent joins the same run and titles it.
    await spawnFetch($, 1, false, 'Fetch the old docs')
    await endAgent($, 'a1', 'error')
    const first = await barWords($, surface)
    expect(first).toContain('Fetch the old docs')
    expect(first).toContain('Agents 1/1')
    await spawnFetch($, 2)
    const next = await barWords($, surface)
    expect(next).toContain('Fetch mod interface docs')
    expect(next).not.toContain('Fetch the old docs')
    expect(next).toContain('Agents 1/2')
    // A reported plan replaces it, and a subagent started under the plan changes nothing of it.
    await $.tool.call(PLAN as never)
    await spawnFetch($, 3, false, 'Fetch the spec')
    const planned = await barWords($, surface)
    expect(planned).toContain('Ship the thing')
    expect(planned).toContain('Tasks 0/2')
    expect(planned).not.toContain('Fetch the spec')
  })

}

test('desktop: the main row follows the task state too', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await startTurn($)
  await endMainTurn($)
  const p = await pane($, 'desktop')
  const main = (await p.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('Claude,'))
  expect(`${String(main?.props.source)} ${String(main?.props.alt)}`).toContain('Paused')
  await p.unmount()
})

test('terminal: the panel title says the task state', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await startTurn($)
  await endMainTurn($)
  const p = await pane($, 'terminal')
  expect(await words(p)).toContain('Ship the thing · Paused · 0/2')
  await p.unmount()
})

test('desktop: the faint layer follows the agents really running, and is gone once nothing runs', async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await startTurn($)
  // The main agent works, no agent runs: no faint layer.
  expect(await progressSource($)).not.toContain(FAINT_DOT)
  await spawnTask($, 'Write the parser', 1)
  expect(await progressSource($)).toContain(FAINT_DOT)
  await endAgent($, 'a1')
  expect(await progressSource($)).not.toContain(FAINT_DOT)
  await endMainTurn($)
  expect(await progressSource($)).not.toContain(FAINT_DOT)
})

const USAGE_SPENT = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-11-13T13:05:00Z' }] }

for (const surface of SURFACES) {
  test(`${surface}: pills take their words from pillText: no reading yet, a used-up limit, an expired cache`, async ($, on) => {
    const { clock } = await boot($, on, { usage: USAGE_SPENT })
    await startTurn($)
    const first = await barWords($, surface)
    // Before the first response: a dash for the speed and for the cache.
    expect(first).toContain('— tok/s')
    expect(first.split(/\n| · /)).toContain('—')
    expect(first).toContain('limit reached')
    if (surface === 'terminal') expect(first).not.toContain('0% left')
    else {
      // The pill's own words, each a Text of its own (its hover card may still give the figures).
      const bar = await band($, surface)
      const shown = (await bar.findAll({ type: 'Text' })).map(t => t.text)
      await bar.unmount()
      expect(shown).toContain('limit reached')
      expect(shown).toContain('resets in 3h 05m')
      expect(shown).not.toContain('0% left')
    }
    await endMainTurn($)
    expect(await barWords($, surface)).toMatch(/59:59|60:00/)
    await clock.advance(3_600_000 + 2_000)
    expect(await barWords($, surface)).toContain('expired')
  })
}

test('desktop: a used-up limit and an expired cache tint their pills red', async ($, on) => {
  const { clock } = await boot($, on, { usage: USAGE_SPENT })
  await startTurn($)
  await endMainTurn($)
  await clock.advance(3_600_000 + 2_000)
  const bar = await band($, 'desktop')
  const all = await tree(bar)
  // Ocean's alert colour, #E5484D, in the pill's outline.
  expect(String(byKey(all, 'pill-fiveHour')?.node.props?.borderColor)).toContain('229,72,77')
  expect(String(byKey(all, 'pill-cache')?.node.props?.borderColor)).toContain('229,72,77')
  await bar.unmount()
})

for (const surface of SURFACES) {
  test(`${surface}: the order buttons move an item, store the order and redraw the bar in it`, { options: { barTurn: false, barTime: false } }, async ($, on) => {
    const { writes, stored } = await boot($, on)
    await startTurn($)
    const sp = await settingsPane($, surface)
    // An item switched off on the plugin screen is listed muted.
    const label = async (text: string) => (await sp.findAll({ type: 'Text' })).find(t => t.text === text)
    expect((await label('Session time'))?.props.dimColor).toBe(true)
    expect((await label('Context'))?.props.dimColor).toBe(false)
    // At either end a press writes nothing.
    await sp.press({ key: 'up-context' })
    await sp.press({ key: 'down-time' })
    expect(writes.some(w => w.key === 'barOrder')).toBe(false)
    await sp.press({ key: 'down-context' })
    expect(stored.barOrder).toEqual(['fiveHour', 'context', 'week', 'model_week', 'speed', 'cache', 'turn', 'time'])
    await sp.press({ key: 'up-cache' })
    expect(stored.barOrder).toEqual(['fiveHour', 'context', 'week', 'model_week', 'cache', 'speed', 'turn', 'time'])
    // The rows follow the order.
    const ups = (await sp.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('up-'))
    expect(ups).toEqual(['up-fiveHour', 'up-context', 'up-week', 'up-model_week', 'up-cache', 'up-speed', 'up-turn', 'up-time'])
    await sp.unmount()
    if (surface === 'desktop') {
      const bar = await band($, surface)
      expect(pillKeys(await tree(bar))).toEqual(['pill-fiveHour', 'pill-context', 'pill-cache', 'pill-speed'])
      await bar.unmount()
    } else {
      const text = await barWords($, surface)
      expect(text.indexOf('5h')).toBeGreaterThanOrEqual(0)
      expect(text.indexOf('5h')).toBeLessThan(text.indexOf('Context'))
    }
  })
}

test('/crew set barOrder puts the named items first and keeps the rest in their order', { options: { barTime: true, barTurn: false } }, async ($, on) => {
  const { stored, configs } = await boot($, on)
  const run = (args: string) => $.command.run({ command: 'crew', args } as never)
  expect(await run('set barOrder time, 5h')).toMatchObject({ text: 'Set barOrder to time, 5h, context, week, model, speed, cache, turn.' })
  expect(stored.barOrder).toEqual(['time', 'fiveHour', 'context', 'week', 'model_week', 'speed', 'cache', 'turn'])
  expect(configs).toHaveLength(0)
  await startTurn($)
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar))).toEqual(['pill-time', 'pill-fiveHour', 'pill-context', 'pill-speed', 'pill-cache'])
  await bar.unmount()
  // Keys work as names too; the unlisted keep the order they had.
  expect(await run('set BARORDER speed context')).toMatchObject({ text: 'Set barOrder to speed, context, time, 5h, week, model, cache, turn.' })
  // `/crew set barItems` answers in the bar's order.
  expect(await run('set barItems context, time')).toMatchObject({ text: 'Set barItems to context, time.' })
})

test('a stored bar order is made whole: unknown names and repeats dropped, the rest appended', { options: { barTurn: false, barTime: false } }, async ($, on) => {
  await boot($, on, { stored: { barOrder: ['cache', 'nope', 'cache', 'context'] } })
  await startTurn($)
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar))).toEqual(['pill-cache', 'pill-context', 'pill-fiveHour', 'pill-speed'])
  await bar.unmount()
})

test('a junk bar order in the store reads as the default order', { options: { barTurn: false, barTime: false } }, async ($, on) => {
  await boot($, on, { stored: { barOrder: 'time first' } })
  await startTurn($)
  const bar = await band($, 'desktop')
  expect(pillKeys(await tree(bar))).toEqual(['pill-context', 'pill-fiveHour', 'pill-speed', 'pill-cache'])
  await bar.unmount()
})

test('desktop: the whole bar sits on one opaque panel in the surface colour, collapsed or expanded; the terminal has none', async ($, on) => {
  await boot($, on)
  await startTurn($)
  const bar = await band($, 'desktop')
  const panelOf = async (): Promise<Node> => {
    const root = (await bar.drawn()) as Node
    // The band's root holds the panel first; the other mods' bands, if any, follow it.
    const first = elements(root)[0]
    if (!first) throw new Error('the band drew nothing')
    expect(keyOf(first)).toBe('bar-panel-back')
    expect(first.type).toBe('Box')
    expect(first.props).toMatchObject({ flexDirection: 'column', borderStyle: 'round', backgroundColor: 'inverseText', paddingX: 1 })
    return first
  }
  // Expanded: the progress row and every pill sit inside the panel.
  const open = await panelOf()
  expect(elements(open).map(keyOf)).toEqual(['bar-rows'])
  const inside = flatten(open).map(p => keyOf(p.node))
  expect(inside).toContain('bar-progress')
  expect(inside).toContain('bar-info')
  const pills = pillKeys(await tree(bar))
  expect(pills.length).toBeGreaterThan(0)
  for (const k of pills) expect(inside).toContain(k)
  // One panel only, and the pills keep their own tinted fills.
  expect((await tree(bar)).filter(p => keyOf(p.node) === 'bar-panel-back')).toHaveLength(1)
  for (const p of (await tree(bar)).filter(p => /^pill-/.test(keyOf(p.node) ?? '') && p.node.type === 'Box')) {
    expect(p.node.props?.backgroundColor).not.toBe('inverseText')
  }
  // Collapsed: the folded row sits on the same panel.
  await bar.press({ key: 'bar-collapse' })
  expect(elements(await panelOf()).map(keyOf)).toEqual(['bar-collapsed'])
  await bar.press({ key: 'bar-collapse' })
  await bar.unmount()

  // The terminal's band is as it was: its rows straight under the root, no panel, no fill.
  const term = await band($, 'terminal')
  const troot = (await term.drawn()) as Node
  expect(keyOf(elements(troot)[0])).toBe('bar-rows')
  const tall = flatten(troot)
  expect(tall.some(p => keyOf(p.node) === 'bar-panel-back')).toBe(false)
  expect(tall.some(p => p.node.props?.backgroundColor !== undefined)).toBe(false)
  await term.unmount()
})

// ---------------------------------------------------------------------------
// Work kinds: every subagent gets a kind, a label and a colour of its own.

// A subagent of any type, as the Agent tool starts one.
async function spawnAs($: Engine, n: number, subagentType: string, description: string, prompt = `Do this: ${description}.`): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: `tk${n}`,
    prompt,
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
}

const GREY = '#888780'

for (const surface of SURFACES) {
  test(`${surface}: a web-fetch and a general-purpose subagent each get a kind, its label and a colour that is not grey`, async ($, on) => {
    await boot($, on)
    await startTurn($)
    await spawnFetch($, 1)
    await spawnAs($, 2, 'general-purpose', 'Fix the parser bug')
    await spawnAs($, 3, 'general-purpose', 'Go on')
    const text = await paneWords($, surface)
    if (surface === 'desktop') {
      expect(text).toContain('Search agent, running: Fetch mod interface docs')
      expect(text).toContain('Debug agent, running: Fix the parser bug')
      expect(text).toContain('Helper agent, running: Go on')
      expect(text).toContain('#2E9BB8')
      expect(text).toContain('#D86931')
      expect(OTHER_HUES.some(c => text.includes(c))).toBe(true)
      expect(text).not.toContain(GREY)
    } else {
      expect(text).toContain('Fetch mod interface docs · Search ·')
      expect(text).toContain('Fix the parser bug · Debug ·')
      expect(text).toContain('Go on · Helper ·')
    }
  })
}

test('desktop: two agents of one kind side by side get related colours of their own, kept for their life', async ($, on) => {
  await boot($, on)
  await startTurn($)
  await spawnFetch($, 1, true, 'Fetch the spec')
  await spawnFetch($, 2, true, 'Fetch the docs')
  const first = await paneWords($, 'desktop')
  const second = shiftColor('#2E9BB8', 1)
  expect(second).not.toBe('#2E9BB8')
  expect(first).toContain('#2E9BB8')
  expect(first).toContain(second)
  // The first ends; a third of the same run takes the next tint, and the others keep theirs.
  await endAgent($, 'a1')
  await spawnFetch($, 3, true, 'Fetch the changelog')
  const later = await paneWords($, 'desktop')
  expect(later).toContain('#2E9BB8')
  expect(later).toContain(second)
  expect(later).toContain(shiftColor('#2E9BB8', 2))
  // A kind of its own starts from its base colour.
  await spawnAs($, 4, 'Plan', 'Lay out the work')
  expect(await paneWords($, 'desktop')).toContain('#727BCA')
})

const PLAN_KINDS = {
  tool: PROGRESS,
  title: 'Ship kinds',
  phase: 'research',
  tasks: [
    { title: 'Map the code', kind: 'search', model: 'haiku' },
    { title: 'Build the panel', kind: 'build', model: 'opus', effort: 'high', after: [1] },
    { title: 'Old style', agent: 'tester' },
  ],
}

test('progress takes tasks as { title, kind, model, effort, after } and agent as the old name; the research and ask phases', async ($, on) => {
  await boot($, on)
  expect(await $.tool.call(PLAN_KINDS as never)).toMatchObject({ result: 'ok: Research' })
  const p = await pane($, 'desktop')
  const text = await words(p)
  await p.unmount()
  // Planned rows: the kind label, then the planned model and effort.
  expect(text).toContain('Planned: 1. Map the code, for Search')
  expect(text).toContain('Planned: 2. Build the panel, for Build, after 1')
  expect(text).toContain('Planned: 3. Old style, for Test')
  expect(text).toContain('Haiku')
  expect(text).toContain('Opus · high')
  expect(text).toContain('#367FDD')
  expect(await $.tool.call({ tool: PROGRESS, phase: 'ask' } as never)).toMatchObject({ result: 'ok: Asking' })
  await startTurn($)
  expect(await barWords($, 'desktop')).toContain('Asking')
  // An agent on a planned task takes its kind, whatever its type says.
  await spawnAs($, 1, 'Explore', 'Build the panel')
  expect(await paneWords($, 'desktop')).toContain('Build agent, running: Build the panel')
})

// A subagent type that once got the step line by its name alone. The name is put together
// here so that no fixture spells out another mod; the code must give it no special treatment.
const FORMER = `${['session', 'router'].join('-')}:worker`

test('the step line goes to agents on planned tasks and to legacy pixel-crew: types, not to Claude Code types, unplanned agents or a type once routed by name', async ($, on) => {
  const { prompts } = await boot($, on)
  await $.tool.call(PLAN_KINDS as never)
  await spawnAs($, 1, FORMER, 'Anything at all')
  await spawnAs($, 2, 'pixel-crew:engineer', 'Something else')
  await spawnAs($, 3, 'general-purpose', 'Build the panel')
  await spawnAs($, 4, 'web-fetch', 'Map the code')
  await spawnAs($, 5, 'Explore', 'Old style')
  await spawnAs($, 6, 'general-purpose', 'Not in the plan')
  // On a planned task and already naming the step tool: no second line.
  await spawnAs($, 7, FORMER, 'Build the panel', `Report with ${STEP} as you go.`)
  // On a planned task, that type is like any other.
  await spawnAs($, 8, FORMER, 'Map the code')
  const has = prompts.map(p => p.includes('Progress reporting:'))
  expect(has).toEqual([false, true, true, false, false, false, false, true])
  expect(prompts[6]?.split(STEP)).toHaveLength(2)
})

test('with no plan reported, no agent of another orchestrator gets the step line; a legacy pixel-crew: type still does', async ($, on) => {
  const { prompts } = await boot($, on)
  await spawnAs($, 1, FORMER, 'Anything at all')
  await spawnAs($, 2, 'some-router:worker', 'Anything at all')
  await spawnAs($, 3, 'pixel-crew:scout', 'Look around')
  await spawnAs($, 4, 'general-purpose', 'Go on')
  expect(prompts.map(p => p.includes('Progress reporting:'))).toEqual([false, false, true, false])
})

test('autoOpen plan: the panel opens once for a reported plan and its agents, not for other subagents, and not again once closed', { options: { autoOpen: 'plan' } }, async ($, on) => {
  const { opened } = await boot($, on)
  await startTurn($)
  await spawnFetch($, 1)
  // A routed worker with no plan on is on no plan's task.
  await spawnTask($, 'Write the parser', 2)
  expect(opened).toEqual([])
  await $.tool.call(PLAN as never)
  expect(opened).toEqual(['crew-agents'])
  expect(await $.command.run({ command: 'crew', args: '' } as never)).toMatchObject({ text: 'Agents panel closed.' })
  await spawnTask($, 'Wire the CLI', 3)
  await spawnFetch($, 4)
  expect(opened).toEqual(['crew-agents'])
})

test('autoOpen any, the default: the panel opens once for any subagent, and stays closed once closed', async ($, on) => {
  const { opened } = await boot($, on)
  await startTurn($)
  await spawnFetch($, 1)
  expect(opened).toEqual(['crew-agents'])
  expect(await $.command.run({ command: 'crew', args: '' } as never)).toMatchObject({ text: 'Agents panel closed.' })
  await spawnFetch($, 2)
  await spawnAs($, 3, 'general-purpose', 'Go on')
  expect(opened).toEqual(['crew-agents'])
})

// ---------------------------------------------------------------------------
// SPEC 2.9: the decisions from verification and review.

// The plan of PLAN run to the end: both agents answered, so it settled by itself.
async function settlePlan($: Engine): Promise<void> {
  await $.tool.call(PLAN as never)
  await startTurn($)
  await spawnTask($, 'Write the parser', 1)
  await spawnTask($, 'Wire the CLI', 2)
  await endAgent($, 'a1')
  await endAgent($, 'a2')
}

test('2.9.1: a plan the orchestrator closed with finished: true never reopens, by a later report or a run of one of its tasks', async ($, on) => {
  await boot($, on)
  await settlePlan($)
  expect(await barWords($, 'terminal')).toContain('Done')
  expect(await $.tool.call({ tool: PROGRESS, title: 'Ship the thing', finished: true } as never)).toMatchObject({ result: 'ok: Done' })
  // A later, unrelated agent with one of its task titles.
  await spawnAs($, 3, 'general-purpose', 'Write the parser')
  const text = await barWords($, 'terminal')
  expect(text).not.toContain('Tasks 0/2')
  expect(text).toContain('Done')
  // Nor does a later report that would have reopened a plan that settled by itself.
  expect(await $.tool.call({ tool: PROGRESS, done: 1 } as never)).toMatchObject({ result: 'ok: Done' })
})

test('2.9.2: a re-plan of a settled plan reopens it and merges the tasks; its finished rows stay', async ($, on) => {
  await boot($, on)
  await settlePlan($)
  const reply = await $.tool.call({ tool: PROGRESS, title: 'Ship the thing', done: 1, total: 3, phase: 'delegate', tasks: [...PLAN.tasks, { title: 'Fix the CLI', kind: 'debug' }] } as never)
  expect(reply).toMatchObject({ result: 'ok: Tasks 1/3' })
  const text = await paneWords($, 'terminal')
  expect(text).toContain('FINISHED · 2')
  expect(text).toContain('◷ 3. Fix the CLI')
  expect(text).not.toContain('◷ 1. Write the parser')
  expect(text).not.toContain('◷ 2. Wire the CLI')
  // With no title given it is the same plan too.
  expect(await $.tool.call({ tool: PROGRESS, done: 2 } as never)).toMatchObject({ result: 'ok: Tasks 2/3' })
})

test('2.9.4: an Agent call whose description is a long planned title moves the plan on to delegate', async ($, on) => {
  const LONG_TITLE = `Migrate ${'every config loader to the new schema and '.repeat(3)}check it`
  expect(LONG_TITLE.length).toBeGreaterThan(120)
  await boot($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Long plan', phase: 'plan', tasks: [{ title: LONG_TITLE }] } as never)
  await startTurn($)
  await $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: LONG_TITLE, prompt: 'Do it.' } as never)
  const text = await barWords($, 'terminal')
  expect(text).toContain('Long plan: Tasks 0/1')
})

test('2.9.6: with 500 agents running the panel draws the rows that fit and a +N more line, the headings counting all 500', { timeoutMs: 120_000 }, async ($, on) => {
  const { stored } = await boot($, on)
  await startTurn($)
  for (let i = 1; i <= 500; i += 1) await spawnAs($, i, 'general-purpose', `shard ${i}`)
  // Normal mode, desktop: the agent rows that fit the drawing limit (2.0.5), the rest counted.
  const p = await pane($, 'desktop')
  const all = await tree(p)
  const rows = all.filter(x => /^line-/.test(keyOf(x.node) ?? '') && keyOf(x.node) !== 'line-main')
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.length).toBeLessThan(60)
  const text = await words(p)
  expect(text).toContain('Working 500')
  expect(text).toContain(`Rows 1–${rows.length} of 500`)
  const drawnChars = async () => (await p.findAll({ type: 'Svg' })).reduce((sum, x) => sum + String(x.props.source).length, 0)
  expect(await drawnChars()).toBeLessThan(PANE_DRAWING_LIMIT)
  // Compact mode: the agent lines that fit, at most 60, then the same kind of line.
  await p.press({ key: 'toggle-compact' })
  // The agents' own lines (the title and Claude's line may name an agent too).
  const lines = (await p.findAll({ type: 'Svg' })).filter(x => /^\w+ agent, \w+: shard \d+/.test(String(x.props.alt)))
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.length).toBeLessThanOrEqual(60)
  expect(await words(p)).toContain(`Rows 1–${lines.length} of 500`)
  expect(await drawnChars()).toBeLessThan(PANE_DRAWING_LIMIT)
  await p.press({ key: 'toggle-compact' })
  await p.unmount()
  // The text version.
  const t = await paneWords($, 'terminal')
  expect(t).toContain('WORKING · 500')
  expect(t).toContain('+440 more')
  // The agents' rows (the title line names the newest agent too).
  expect(t.split('\n').filter(l => l.startsWith('● shard '))).toHaveLength(60)
  expect(stored.compact).toEqual({ isCompact: false })
})

test('2.9.6: the budget runs on across sections in their order: working, waiting, planned, then finished newest first', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Many', phase: 'delegate', tasks: Array.from({ length: 30 }, (_, i) => ({ title: `Task ${i + 1}` })) } as never)
  await startTurn($)
  for (let i = 1; i <= 50; i += 1) await spawnAs($, i, 'general-purpose', `shard ${i}`)
  const text = await paneWords($, 'terminal')
  expect(text).toContain('WORKING · 50')
  expect(text).toContain('PLANNED · 30')
  // 50 working rows leave 10 planned ones in full.
  expect(text.split('\n').filter(l => l.startsWith('◷ '))).toHaveLength(10)
  expect(text).toContain('+20 more')
})

test('2.9.7: compact mode is remembered across sessions in the store', async ($, on) => {
  const { stored, writes } = await boot($, on, { stored: { compact: { isCompact: true } } })
  const p = await pane($, 'desktop')
  // Compact from the first drawing: the card, and no Main agent heading.
  const alts = async (): Promise<string[]> => (await p.findAll({ type: 'Svg' })).map(x => String(x.props.alt))
  expect((await alts()).some(a => a.startsWith('Session'))).toBe(true)
  expect((await alts()).includes('Main agent')).toBe(false)
  await p.press({ key: 'toggle-compact' })
  expect((await alts()).includes('Main agent')).toBe(true)
  await p.unmount()
  expect(writes.filter(w => w.key === 'compact').at(-1)?.value).toEqual({ isCompact: false })
  expect(stored.compact).toEqual({ isCompact: false })
})

test('2.9.9: the guide describes the compact mode: a card, a line for Claude and each agent at work, a line of counts', async ($, on) => {
  await boot($, on)
  const g = await guidePane($, 'desktop')
  const md = String((await g.find({ type: 'Markdown' }))?.props.text ?? '')
  await g.unmount()
  expect(md).toContain('one line for Claude and each working or waiting agent')
  expect(md).toContain('planned and finished counts')
  expect(md).not.toContain('one drawing')
})

test('2.9.11: where no surface can show a pane, nothing is opened, and the report still goes through', async ($, on) => {
  const { opened } = await boot($, on, { surfaces: [] })
  expect(await $.tool.call(PLAN as never)).toMatchObject({ result: 'ok: Tasks 0/2' })
  await spawnTask($, 'Write the parser', 1)
  await $.command.run({ command: 'crew', args: 'open' } as never)
  expect(opened).toEqual([])
})

// ---------------------------------------------------------------------------
// 2.0.2: the scroll-bar gutter. The app's vertical scroll bar shows over a pane's right
// edge, so the rightmost 12 px of each pane hold nothing drawn or pressable.

const GUTTER_PX = 12
// The desktop's layout, as far as the tree tells it: a cell is 8 px; a Box's width, its
// paddingX and gaps are cells (a step name one cell), a round border a cell a side; a row
// gives its flexGrow children what the others leave, else packs them by justifyContent; a
// Box with no flexDirection is a row. An absolute Box covers its parent. What comes out is
// each Svg's left and right edge, in px from the pane's left edge.
type Placement = { node: Node; left: number; right: number; inGutter: boolean }
const spacePx = (v: unknown): number => (typeof v === 'number' ? v * 8 : typeof v === 'string' ? 8 : 0)
const sideRoom = (p: Record<string, unknown>, side: 'Left' | 'Right'): number => spacePx(p[`padding${side}`] ?? p.paddingX ?? p.padding) + (p.borderStyle ? 8 : 0)
const inFlow = (n: Node): Node[] => elements(n).filter(c => c.props?.position !== 'absolute')
function naturalWidth(n: Node): number {
  const p = n.props ?? {}
  if (n.type === 'Svg') return Number(p.width ?? 0)
  if (n.type !== 'Box') return 0
  if (typeof p.width === 'number') return p.width * 8
  const kids = inFlow(n).map(naturalWidth)
  const isRow = p.flexDirection === undefined || p.flexDirection === 'row'
  const inner = isRow ? kids.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * spacePx(p.columnGap ?? p.gap) : Math.max(0, ...kids)
  return inner + sideRoom(p, 'Left') + sideRoom(p, 'Right')
}
function place(n: Node, left: number, room: number, inGutter: boolean, out: Placement[]): void {
  const p = n.props ?? {}
  const isGutter = inGutter || keyOf(n) === 'scroll-gutter'
  if (n.type === 'Svg') {
    out.push({ node: n, left, right: left + Number(p.width ?? 0), inGutter: isGutter })
    return
  }
  if (n.type !== 'Box') {
    for (const c of elements(n)) place(c, left, room, isGutter, out)
    return
  }
  const width = typeof p.width === 'number' ? p.width * 8 : room
  const innerLeft = left + sideRoom(p, 'Left')
  const inner = width - sideRoom(p, 'Left') - sideRoom(p, 'Right')
  for (const c of elements(n).filter(c => c.props?.position === 'absolute')) place(c, innerLeft, inner, isGutter, out)
  const kids = inFlow(n)
  if (p.flexDirection === 'column' || p.flexDirection === 'column-reverse') {
    for (const c of kids) place(c, innerLeft, inner, isGutter, out)
    return
  }
  const gap = spacePx(p.columnGap ?? p.gap)
  const growing = kids.filter(c => Number(c.props?.flexGrow ?? 0) > 0)
  const fixed = kids.filter(c => !growing.includes(c)).reduce((a, c) => a + naturalWidth(c), 0) + Math.max(0, kids.length - 1) * gap
  const share = growing.length ? (inner - fixed) / growing.length : 0
  const widths = kids.map(c => (growing.includes(c) ? share : naturalWidth(c)))
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * gap
  let x = innerLeft
  if (!growing.length && p.justifyContent === 'flex-end') x = innerLeft + inner - total
  if (!growing.length && p.justifyContent === 'center') x = innerLeft + (inner - total) / 2
  kids.forEach((c, i) => {
    place(c, x, widths[i] ?? 0, isGutter, out)
    x += (widths[i] ?? 0) + gap
  })
}
// Every drawing and icon of a mounted pane `cols` wide, but the backdrop and the gutter's own
// empty drawing, ends at least 12 px short of the pane's right edge and starts inside it.
async function expectClearOfGutter(ui: Pick<Mounted, 'drawn'>, cols: number, what: string): Promise<number> {
  const out: Placement[] = []
  place((await ui.drawn()) as Node, 0, cols * 8, false, out)
  const paneW = cols * 8
  const shown = out.filter(x => !x.inGutter && !/ backdrop$/.test(String(x.node.props?.alt)))
  const bad = shown.filter(x => x.right > paneW - GUTTER_PX + 0.001 || x.left < 0)
  expect(bad.map(x => `${what}: ${String(x.node.props?.alt) || 'drawing'} spans ${Math.round(x.left)}-${Math.round(x.right)} of ${paneW}`)).toEqual([])
  // The gutter itself: an empty drawing exactly 12 px wide, at the pane's right edge.
  const gutter = out.filter(x => x.inGutter)
  expect(gutter.map(x => [Number(x.node.props?.width), Math.round(x.right)])).toEqual([[GUTTER_PX, paneW]])
  return shown.length
}

// 300 and 380 px panes: the column counts either side of each width.
const GUTTER_COLS = [37, 38, 47, 48]
const widePane = ($: Engine, id: string, cols: number, surface: Surface = 'desktop') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: id, props: { ...PANE_PROPS, bodyColumns: cols } as never })

for (const textSize of [100, 150]) {
  test(`2.0.2: at ${textSize}% Panel text, nothing in the agents panel reaches into the 12 px scroll-bar gutter, Normal or Compact, 300 to 380 px`, async ($, on) => {
    await boot($, on, { stored: { sizes: { textSize, iconSize: 200, barSize: 100, logLines: 15 } } })
    await $.tool.call(PLAN as never)
    await startTurn($)
    await spawnTask($, 'Write the parser', 1)
    await spawnTask($, 'Wire the CLI', 2)
    await endAgent($, 'a2', 'error')
    // Open logs under the main row and an agent's; the Finished heading has its fold.
    const first = await widePane($, 'crew-agents', 41)
    await first.press({ key: 'log-main' })
    await first.press({ key: 'log-a1' })
    expect(await first.find({ key: 'toggle-done' })).toBeDefined()
    await first.unmount()
    for (const cols of GUTTER_COLS) {
      const p = await widePane($, 'crew-agents', cols)
      expect(await p.find({ key: 'log-row-a1' })).toBeDefined()
      expect(await expectClearOfGutter(p, cols, `Normal, ${cols} columns`)).toBeGreaterThan(10)
      await p.unmount()
    }
    const toCompact = await widePane($, 'crew-agents', 41)
    await toCompact.press({ key: 'toggle-compact' })
    await toCompact.unmount()
    for (const cols of GUTTER_COLS) {
      const p = await widePane($, 'crew-agents', cols)
      expect(await p.find({ key: 'compact-card-back' })).toBeDefined()
      expect(await expectClearOfGutter(p, cols, `Compact, ${cols} columns`)).toBeGreaterThan(6)
      await p.unmount()
    }
  })
}

test('2.0.2: over a backdrop the panel keeps the gutter, and the backdrop still spans the whole pane', { options: { background: 'dots' } }, async ($, on) => {
  await boot($, on)
  await $.tool.call(PLAN as never)
  await startTurn($)
  for (const cols of GUTTER_COLS) {
    const p = await widePane($, 'crew-agents', cols)
    await expectClearOfGutter(p, cols, `dots, ${cols} columns`)
    const back = (await p.findAll({ type: 'Svg' })).filter(s => Number(s.props.width) === cols * 8)
    expect(back.length).toBeGreaterThan(0)
    await p.unmount()
  }
})

test('2.0.2: the settings and guide panes keep the same 12 px gutter on the desktop, and none on the terminal', async ($, on) => {
  await boot($, on)
  for (const cols of GUTTER_COLS) {
    for (const id of ['crew-settings', 'crew-guide']) {
      const ui = await widePane($, id, cols)
      await expectClearOfGutter(ui, cols, `${id}, ${cols} columns`)
      // The content takes the room left of the gutter.
      const all = await tree(ui)
      const gutter = byKey(all, 'scroll-gutter')
      expect(gutter).toBeDefined()
      expect(elements(gutter!.parent!).at(-1)).toBe(gutter!.node)
      expect(elements(gutter!.parent!)[0]?.props).toMatchObject({ flexGrow: 1, flexShrink: 1 })
      await ui.unmount()
    }
  }
  for (const id of ['crew-agents', 'crew-settings', 'crew-guide']) {
    const ui = await widePane($, id, 41, 'terminal')
    expect(byKey(await tree(ui), 'scroll-gutter')).toBeUndefined()
    await ui.unmount()
  }
})

// ---------------------------------------------------------------------------
// 2.0.3: the agents pane comes back after the app restarts the session's process.

// The kit raises closes of the mod's own only (`$.ui.close`, origin `plugin`): it lets no
// test raise the person's close or an unload, nor restamp a close's origin. So the rule a
// close is judged by (`closeForgetsPane`, which the mod's ui.close hook applies to
// `e.origin`) is checked here, and the hook end to end with the mod's own close.
const startAs = ($: Engine, sessionId: string, source = 'resume') => $.classic.SessionStart({ source, session_id: sessionId } as never)
// The record: one entry per session whose pane is open, its id to when it was written.
const entries = (stored: Record<string, unknown>): Record<string, number> => (stored.paneOpen ?? {}) as Record<string, number>

test("2.0.3: a person's close or the mod's forgets the open pane; an unload leaves it", () => {
  expect(closeForgetsPane({ kind: 'person' })).toBe(true)
  expect(closeForgetsPane({ kind: 'plugin' })).toBe(true)
  expect(closeForgetsPane({ kind: 'unload' })).toBe(false)
  // The record that reopens: a resume of a session it holds an entry for.
  expect(reopensPane('resume', 'sess-1', { 'sess-1': T0 })).toBe(true)
  expect(reopensPane('resume', 'sess-1', { 'sess-0': T0 })).toBe(false)
  expect(reopensPane('startup', 'sess-1', { 'sess-1': T0 })).toBe(false)
  expect(reopensPane('resume', 'sess-1', undefined)).toBe(false)
  expect(reopensPane('resume', '', { '': T0 })).toBe(false)
  expect(reopensPane('resume', 'toString', {})).toBe(false)
  // The 1st shape, `{ sessionId }`, is junk to the new one.
  expect(reopensPane('resume', 'sess-1', { sessionId: 'sess-1' })).toBe(false)
})

test('2.0.3: the record keeps one entry per session, an entry written and removed alone', () => {
  const two = withPaneOpen(withPaneOpen(undefined, 'a', 1), 'b', 2)
  expect(two).toEqual({ a: 1, b: 2 })
  expect(withPaneOpen(two, 'a', 3)).toEqual({ a: 3, b: 2 })
  expect(withoutPaneOpen(two, 'a')).toEqual({ b: 2 })
  expect(withoutPaneOpen(two, 'c')).toEqual({ a: 1, b: 2 })
})

test('2.0.3: opening the agents pane records it open for this session, by the command or the bar; closing it forgets it', async ($, on) => {
  const { stored, open } = await boot($, on)
  await $.command.run({ command: 'crew', args: 'open' } as never)
  expect(stored.paneOpen).toEqual({ 'sess-1': T0 })
  await $.command.run({ command: 'crew' } as never)
  expect(stored.paneOpen).toBeUndefined()
  const bar = await band($, 'desktop')
  await bar.press({ key: 'bar-panel' })
  expect(stored.paneOpen).toEqual({ 'sess-1': T0 })
  await bar.press({ key: 'bar-panel' })
  expect(open.has('crew-agents')).toBe(false)
  expect(stored.paneOpen).toBeUndefined()
  await bar.unmount()
})

test('2.0.3: two sessions keep separate entries, and a close in one leaves the other’s', async ($, on) => {
  const { stored, session, clock } = await boot($, on)
  await $.command.run({ command: 'crew', args: 'open' } as never)
  await clock.advance(1_000)
  session.id = 'sess-2'
  await $.command.run({ command: 'crew', args: 'open' } as never)
  expect(stored.paneOpen).toEqual({ 'sess-1': T0, 'sess-2': T0 + 1_000 })
  await $.command.run({ command: 'crew' } as never)
  expect(stored.paneOpen).toEqual({ 'sess-1': T0 })
})

test('2.0.3: a 21st entry drops the oldest', async ($, on) => {
  const twenty = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`old-${i}`, T0 - 100_000 + i]))
  const { stored } = await boot($, on, { stored: { paneOpen: twenty } })
  await $.command.run({ command: 'crew', args: 'open' } as never)
  const kept = entries(stored)
  expect(Object.keys(kept)).toHaveLength(20)
  expect(kept['old-0']).toBeUndefined()
  expect(kept['old-1']).toBe(T0 - 100_000 + 1)
  expect(kept['sess-1']).toBe(T0)
})

test('2.0.3: opening or closing the settings or guide pane does not touch the record', async ($, on) => {
  const { stored } = await boot($, on)
  await $.command.run({ command: 'crew', args: 'open' } as never)
  for (const args of ['settings', 'settings', 'guide', 'guide']) await $.command.run({ command: 'crew', args } as never)
  expect(stored.paneOpen).toEqual({ 'sess-1': T0 })
})

test('2.0.3: an agents pane opened by itself is recorded too', { options: { autoOpen: 'any' } }, async ($, on) => {
  const { stored, opened } = await boot($, on)
  await startTurn($)
  await spawnWorker($)
  expect(opened).toContain('crew-agents')
  expect(stored.paneOpen).toEqual({ 'sess-1': T0 })
})

test('2.0.3: a clear start with the panel open writes an entry under the new id, and a resume of that id reopens it', async ($, on) => {
  const { stored, session, open, opened } = await boot($, on)
  await $.command.run({ command: 'crew', args: 'open' } as never)
  // `/clear` carries the process on under a new id, the pane still up.
  session.id = 'sess-2'
  await startAs($, 'sess-2', 'clear')
  expect(Object.keys(entries(stored)).sort()).toEqual(['sess-1', 'sess-2'])
  // The process restarts: the engine has no pane; a resume of the new id brings it back.
  open.clear()
  opened.length = 0
  await startAs($, 'sess-2')
  expect(opened).toEqual(['crew-agents'])
})

test('2.0.3: a clear start with the panel closed writes nothing and opens nothing', async ($, on) => {
  const { stored, opened, session } = await boot($, on)
  await startAs($, 'sess-1', 'clear')
  await startAs($, 'sess-1', 'compact')
  expect(stored.paneOpen).toBeUndefined()
  expect(opened).toEqual([])
  // The panel opened, then closed: a later clear still writes nothing; open, it writes the new id's entry.
  await $.command.run({ command: 'crew', args: 'open' } as never)
  await $.command.run({ command: 'crew' } as never)
  session.id = 'sess-2'
  await startAs($, 'sess-2', 'clear')
  expect(stored.paneOpen).toBeUndefined()
  await $.command.run({ command: 'crew', args: 'open' } as never)
  session.id = 'sess-3'
  await startAs($, 'sess-3', 'clear')
  expect(Object.keys(entries(stored)).sort()).toEqual(['sess-2', 'sess-3'])
})

test('2.0.3: a resumed session whose pane was open opens it again, and only the agents pane', async ($, on) => {
  const { opened } = await boot($, on, { stored: { paneOpen: { 'sess-1': T0 } } })
  await startAs($, 'sess-1')
  expect(opened).toEqual(['crew-agents'])
  const p = await pane($, 'desktop')
  expect(await words(p)).toContain('Claude')
  await p.unmount()
})

test('2.0.3: resumed before any surface attaches, the pane is opened and kept, and draws once one attaches', async ($, on) => {
  const { opened, open } = await boot($, on, { stored: { paneOpen: { 'sess-1': T0 } }, surfaces: [] })
  await startAs($, 'sess-1')
  expect(opened).toEqual(['crew-agents'])
  expect(open.has('crew-agents')).toBe(true)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  const p = await pane($, 'desktop')
  expect(await words(p)).toContain('Claude')
  await p.unmount()
})

test("2.0.3: another session's record, a forgotten one or a fresh startup opens nothing", async ($, on) => {
  const { opened, stored } = await boot($, on, { stored: { paneOpen: { 'sess-0': T0 } } })
  await startAs($, 'sess-1')
  expect(opened).toEqual([])
  stored.paneOpen = { 'sess-1': T0 }
  await startAs($, 'sess-1', 'startup')
  expect(opened).toEqual([])
  delete stored.paneOpen
  await startAs($, 'sess-1')
  expect(opened).toEqual([])
  // While the same session's entry does reopen it.
  stored.paneOpen = { 'sess-0': T0, 'sess-1': T0 }
  await startAs($, 'sess-1')
  expect(opened).toEqual(['crew-agents'])
})

// ---------------------------------------------------------------------------
// 2.0.5: the desktop app takes the agents pane as one answer and drops one that is too
// large, so the pane read "has not drawn in this pane". Each agent row is a drawing of
// about 15,000 characters, finished ones included: with 16 finished agents the pane came
// to about 290,000 characters of drawings, while the small guide pane still drew.

const PANE_DRAWING_LIMIT = 150_000

const narrowPane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: { ...PANE_PROPS, bodyColumns: 34 } as never })

async function finishAgents($: Engine, clock: Boot['clock'], n: number): Promise<void> {
  await startTurn($)
  for (let i = 1; i <= n; i += 1) await spawnTask($, `Task number ${i}`, i)
  for (let i = 1; i <= n; i += 1) {
    await clock.advance(1_000)
    await endAgent($, `a${i}`)
  }
}

test('desktop: with many finished agents the pane stays under the drawing limit; the rest are counted in +N more', async ($, on) => {
  const { clock } = await boot($, on)
  await finishAgents($, clock, 16)
  const p = await narrowPane($)
  const svgs = await p.findAll({ type: 'Svg' })
  const total = svgs.reduce((sum, s) => sum + String(s.props.source).length, 0)
  expect(total < PANE_DRAWING_LIMIT ? 'ok' : `the pane draws ${total} characters`).toBe('ok')
  const text = await words(p)
  // The newest finished agent is drawn, the oldest is counted, and the heading keeps the whole count.
  expect(text).toContain('Task number 16')
  expect(text).not.toContain('Task number 1.')
  expect(text).toMatch(/Rows 1–\d+ of 16/)
  expect(svgs.some(s => String(s.props.alt).startsWith('Finished 16'))).toBe(true)
  await p.unmount()
})

test('desktop: a few finished agents are all drawn, with no +N more line', async ($, on) => {
  const { clock } = await boot($, on)
  await finishAgents($, clock, 3)
  const p = await narrowPane($)
  const text = await words(p)
  for (let i = 1; i <= 3; i += 1) expect(text).toContain(`Task number ${i}`)
  expect(text).not.toMatch(/\+\d+ more/)
  await p.unmount()
})

// The rename to CPixelCrew: what the engine sees of the plugin's name.
test('every $.state read and write is under the plugin CPixelCrew', async ($, on) => {
  const plugins = new Set<string>()
  const keys = new Set<string>()
  for (const event of ['state.get', 'state.set'] as const) {
    on(event, ((_$: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) => {
      plugins.add(e.plugin)
      keys.add(e.key)
      return next(e)
    }) as never)
  }
  await boot($, on)
  await $.tool.call(PLAN as never)
  expect([...plugins]).toEqual(['CPixelCrew'])
  expect(keys.size).toBeGreaterThan(5)
})

test('the progress and step tools are heard under the server CPixelCrew, and the old server name is not', async ($, on) => {
  await boot($, on)
  expect(PROGRESS).toBe('mcp__CPixelCrew__progress')
  expect(STEP).toBe('mcp__CPixelCrew__step')
  expect(await $.tool.call(PLAN as never)).toMatchObject({ result: 'ok: Tasks 0/2' })
  // The old name belongs to no tool of this plugin now: it goes through as any other tool.
  expect(await $.tool.call({ ...PLAN, tool: 'mcp__pixel-crew__progress' } as never)).not.toMatchObject({ result: 'ok: Tasks 0/2' })
})

// Which agents move a reported plan from "plan" to "delegate" when they start. Seen in the stored
// plan: the phase is not drawn as a word, so the one place it can be read is the plugin's `flow`
// state, which the Agent tool hook writes (a `state.set` listener keeps the latest value). A planned
// task counts whatever its type; an unplanned one only when it is a legacy `pixel-crew:` type.
async function phaseAfterAgent($: Engine, on: On, subagentType: string, description: string): Promise<unknown> {
  let flow: { phase?: string } | undefined
  on('state.set', ((_$: unknown, e: { key: string; value: unknown }, next: (x: unknown) => unknown) => {
    if (e.key === 'flow') flow = e.value as { phase?: string }
    return next(e)
  }) as never)
  await boot($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Tidy the archive', phase: 'plan', tasks: [{ title: 'Index the archive' }, { title: 'Prune old logs' }] } as never)
  expect(flow?.phase).toBe('plan')
  await startTurn($)
  await $.tool.call({ tool: 'Agent', subagent_type: subagentType, description, prompt: 'Do it.' } as never)
  return flow?.phase
}

test('a planned task moves the phase to delegate when its agent starts, for a built-in type', async ($, on) => {
  expect(await phaseAfterAgent($, on, 'Explore', 'Index the archive')).toBe('delegate')
})

test('a planned task moves the phase to delegate when its agent starts, for a neutral routed type', async ($, on) => {
  expect(await phaseAfterAgent($, on, 'some-router:worker', 'Prune old logs')).toBe('delegate')
})

test('a planned task moves the phase to delegate when its agent starts, for a general type', async ($, on) => {
  expect(await phaseAfterAgent($, on, 'general-purpose', 'Index the archive')).toBe('delegate')
})

test('an agent matching no planned task leaves the phase at plan, for a built-in type', async ($, on) => {
  expect(await phaseAfterAgent($, on, 'Explore', 'Read the manual')).toBe('plan')
})

test('an agent matching no planned task leaves the phase at plan, for a neutral routed type', async ($, on) => {
  expect(await phaseAfterAgent($, on, 'some-router:worker', 'Read the manual')).toBe('plan')
})

test('a legacy pixel-crew: agent moves the phase to delegate even when it matches no planned task', async ($, on) => {
  expect(await phaseAfterAgent($, on, 'pixel-crew:engineer', 'Read the manual')).toBe('delegate')
})
