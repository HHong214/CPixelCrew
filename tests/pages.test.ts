// Tests for three faults found in the paged panel and one in the app's usage answer. They are
// written before the fixes: each new test fails now because the behaviour is not there yet.
//
// The contract:
//
//   anchoredPage<T>(pages: readonly (readonly T[])[], idOf: (row: T) => string,
//                   kept?: { n: number; first: string }): number          (hooks/model.ts, pure)
//     The page to show: the index of the page that holds the row whose id is `kept.first`
//     (the first page that holds it); when no page holds it, `kept.n` clamped into
//     0..last page (a fraction is floored, NaN or a negative reads as 0); 0 when nothing
//     is kept, for junk, and for an empty list. Never throws (an `idOf` that throws, a
//     `kept` that is not an object, `pages` that is not an array all read as 0).
//
//   Panel level, no new function (hooks/register.tsx):
//     - `toggleLog` keeps the row in view: opening a log (by the row's "Show the log" button)
//       leaves the row and its log on the page then shown (`line-<id>`, `log-row-<id>`).
//       The harness presses controls and reads which rows are shown, so this is pinned at the
//       panel, not through `view.rowPage`.
//     - Every page's answer stays under the 150,000 characters the existing size test uses
//       (the Svg sources of the whole answer, icons included), in Normal mode with 16
//       finished agents and in compact mode with 200 rows; each row is on exactly one page.
//       Pages are walked with the foot's Next button (`rows-next`, `compact-next`).
//     - An app answer that is `status: "ok"` with a plan name and no known window (an empty
//       `windows`, or only labels the mod does not know) is a good answer with no limits: the
//       plan's name is kept (`stored.appUsage.plan`), no failure is recorded
//       (`stored.appUsage` has no `error` and is not `ok: false`), and after three such
//       answers the app is still asked. An answer whose `windows` is missing is still a failure.
//       Reached through the harness, so no pure `appAnswerOk` is pinned.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import * as model from '../hooks/model'

// ---------------------------------------------------------------------------
// anchoredPage

const bag = model as unknown as Record<string, unknown>
const anchoredPage = (pages: unknown, idOf: unknown, kept?: unknown): number => {
  const f = bag.anchoredPage
  if (typeof f !== 'function') throw new Error('missing export: anchoredPage')
  return (f as (...a: unknown[]) => number)(pages, idOf, kept)
}
const id = (x: string): string => x

describe('anchoredPage', () => {
  test('the page follows the row: it moved from page 1 to page 2 because rows were added before it', async () => {
    const before = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    expect(anchoredPage(before, id, { n: 1, first: 'c' })).toBe(1)
    const after = [['x', 'y'], ['a', 'b'], ['c', 'd'], ['e', 'f']]
    expect(anchoredPage(after, id, { n: 1, first: 'c' })).toBe(2)
    // Rows taken away before it move it the other way.
    expect(anchoredPage([['c', 'd'], ['e', 'f']], id, { n: 1, first: 'c' })).toBe(0)
  })

  test('the row wins over the number, even when the number is a page that exists', async () => {
    const pages = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    expect(anchoredPage(pages, id, { n: 2, first: 'a' })).toBe(0)
    expect(anchoredPage(pages, id, { n: 0, first: 'e' })).toBe(2)
    // Any row of a page names it, not only its first.
    expect(anchoredPage(pages, id, { n: 2, first: 'b' })).toBe(0)
    expect(anchoredPage(pages, id, { n: 0, first: 'd' })).toBe(1)
  })

  test('the row is gone and the list shrank so the kept page no longer exists: the last page, not the first', async () => {
    expect(anchoredPage([['a', 'b'], ['c']], id, { n: 5, first: 'gone' })).toBe(1)
    expect(anchoredPage([['a', 'b'], ['c'], ['d']], id, { n: 3, first: 'gone' })).toBe(2)
    expect(anchoredPage([['a']], id, { n: 4, first: 'gone' })).toBe(0)
  })

  test('the row is gone but the kept index still exists: that index', async () => {
    const pages = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    expect(anchoredPage(pages, id, { n: 1, first: 'gone' })).toBe(1)
    expect(anchoredPage(pages, id, { n: 2, first: 'gone' })).toBe(2)
    expect(anchoredPage(pages, id, { n: 0, first: 'gone' })).toBe(0)
  })

  test('nothing kept, an empty list or junk reads as the first page, and nothing throws', async () => {
    const pages = [['a', 'b'], ['c', 'd']]
    expect(anchoredPage(pages, id, undefined)).toBe(0)
    expect(anchoredPage(pages, id)).toBe(0)
    expect(anchoredPage([], id, { n: 3, first: 'a' })).toBe(0)
    expect(anchoredPage([[]], id, { n: 3, first: 'a' })).toBe(0)
    for (const kept of [null, 'x', 7, [], {}, { n: 1 }, { first: 'c' }, { n: 'a', first: 'zz' }, { n: NaN, first: 'zz' }, { n: -4, first: 'zz' }, { n: Infinity, first: 'zz' }]) {
      const at = anchoredPage(pages, id, kept)
      expect(Number.isInteger(at) && at >= 0 && at <= 1, JSON.stringify(kept)).toBe(true)
    }
    // A number that is not usable reads as the first page; one past the end as the last.
    expect(anchoredPage(pages, id, { n: NaN, first: 'zz' })).toBe(0)
    expect(anchoredPage(pages, id, { n: -4, first: 'zz' })).toBe(0)
    expect(anchoredPage(pages, id, { n: 1.9, first: 'zz' })).toBe(1)
    expect(anchoredPage(pages, id, { n: 99, first: 'zz' })).toBe(1)
    for (const junk of [undefined, null, 'abc', 5, {}]) expect(anchoredPage(junk, id, { n: 1, first: 'a' }), String(junk)).toBe(0)
    expect(anchoredPage(pages, undefined, { n: 1, first: 'a' })).toBe(0)
    expect(anchoredPage(pages, () => { throw new Error('x') }, { n: 1, first: 'a' })).toBe(0)
    expect(anchoredPage([null, 3, ['a']], id, { n: 0, first: 'a' })).toBeGreaterThanOrEqual(0)
  })

  test('rows can be objects, found by their id; the first page that holds the id wins', async () => {
    const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'b' }]]
    expect(anchoredPage(pages, (r: { id: string }) => r.id, { n: 0, first: 'b' })).toBe(0)
    expect(anchoredPage(pages, (r: { id: string }) => r.id, { n: 0, first: 'c' })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The panel: a harness of its own, as register.test.ts has (the engine answered by hooks).

const PLUGIN = 'CPixelCrew'
const T0 = Date.parse('2026-11-13T10:00:00Z')
const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 41, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const PANE_DRAWING_LIMIT = 150_000
const USAGE = {
  startedAt: T0 - 60_000,
  context: { tokens: 270_000, window: 1_000_000, percent: 27 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-11-13T11:07:00Z' }],
  cost: { usd: 11.73 },
}

type Boot = {
  clock: ReturnType<typeof mock.clock>
  mcpCalls: { server: string; tool: string; args: unknown }[]
  app: { answer: unknown }
  stored: Record<string, unknown>
}

async function boot($: Engine, on: On, o: { stored?: Record<string, unknown>; app?: unknown } = {}): Promise<Boot> {
  const stored = o.stored ?? {}
  const clock = mock.clock(on, { now: T0 })
  clocks.set($, clock)
  const open = new Set<string>()
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  } as never)
  on('tool.call', (() => ({ result: 'file text' })) as never)
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
  on('classic.SessionStart', (() => ({})) as never)
  on('session.attach', ((_$: unknown, e: { clientId: string }) => ({ clientId: e.clientId })) as never)
  on('config.set', ((_$: unknown, e: { value: unknown }) => ({ value: e.value })) as never)
  on('tool.register', ((_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } })) as never)
  on('command.register', ((_$: unknown, e: { name: string }) => ({ value: { command: e.name } })) as never)
  on('session.usage', (() => ({ value: USAGE })) as never)
  on('session.model', (() => ({ value: 'claude-opus-5-5' })) as never)
  on('session.surfaces', (() => ({ value: ['desktop'] })) as never)
  on('ui.open', (() => {
    return { value: { isPlaced: true } }
  }) as never)
  on('ui.close', (() => ({ value: undefined })) as never)
  on('ui.panes', (() => ({ value: [...open].map(i => ({ id: i, title: i, isShown: true, isFocused: false, isPlaced: true })) })) as never)
  on('ui.copy', (() => ({ value: { isCopied: true } })) as never)
  on('ui.toast', (() => ({ value: undefined })) as never)
  on('agent.list', (() => ({ value: [] })) as never)
  const mcpCalls: { server: string; tool: string; args: unknown }[] = []
  const app = { answer: o.app ?? null }
  on('mcp.call', ((_$: unknown, e: { server: string; tool: string; args: unknown }) => {
    mcpCalls.push({ server: e.server, tool: e.tool, args: e.args })
    return app.answer === null ? { deny: 'no MCP server named ccd_session_mgmt' } : { value: app.answer }
  }) as never)
  on('http.fetch', (() => ({ value: { status: 503, ok: false, headers: {}, text: '' } })) as never)
  let spawns = 0
  on('agent.spawn', (() => {
    spawns += 1
    return { model: 'claude-opus-5-5', agentId: `a${spawns}` }
  }) as never)
  on('turn.start', ((_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId })) as never)
  on('turn.complete', (() => ({ text: '' })) as never)
  on('session.measure', ((_$: unknown, e: { changed: string[] }) => ({ changed: e.changed })) as never)
  on('session.start', ((_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  return { clock, mcpCalls, app, stored }
}

// 2.5.0 (A5): the pane and the bar draw from frames, written at most once a second, the
// trailing one 1,000 ms after the write before. A drawing is read after the clock moved one
// second, so the frame for every event before it has landed.
const clocks = new WeakMap<Engine, ReturnType<typeof mock.clock>>()
async function framed<T>($: Engine, mount: () => Promise<T>): Promise<T> {
  await clocks.get($)?.advance(1_000)
  const ui = await mount()
  await clocks.get($)?.settle()
  return ui
}

const pane = ($: Engine) => framed($, () => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: PANE_PROPS as never }))
const narrowPane = ($: Engine) =>
  framed($, () => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: { ...PANE_PROPS, bodyColumns: 34 } as never }))

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
function flatten(root: unknown): Node[] {
  const out: Node[] = []
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as Node
    out.push(node)
    for (const c of node.children ?? []) visit(c)
  }
  visit(root)
  return out
}
// The keys of the elements drawn, in order.
async function keys(ui: Pick<Mounted, 'drawn'>): Promise<string[]> {
  return flatten(await ui.drawn())
    .map(n => n.props?.key)
    .filter((k): k is string => typeof k === 'string')
}
// What the whole answer draws: every Svg source, icons included (as the existing size test measures it).
async function drawnChars(ui: Pick<Mounted, 'findAll'>): Promise<number> {
  return (await ui.findAll({ type: 'Svg' })).reduce((sum, x) => sum + String(x.props.source).length, 0)
}

async function startTurn($: Engine): Promise<void> {
  await $.turn.start({ text: 'Fix the bug', turnId: 't1' } as never)
}
async function spawnAs($: Engine, n: number, description: string): Promise<unknown> {
  return $.agent.spawn({
    tool_use_id: `tk${n}`,
    prompt: `Do this: ${description}.`,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
}
async function endAgent($: Engine, agentId: string): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: `r-${agentId}`, agentId, reason: 'answer' } as never)
}

// The rows drawn on the page now: the agents' own lines (not the main row).
const normalRows = async (p: Mounted): Promise<string[]> =>
  (await keys(p)).filter(k => /^line-/.test(k) && k !== 'line-main').map(k => k.slice('line-'.length))
// Compact rows are one drawing each, named by the agent's description (`shard 12`).
const compactRows = async (p: Mounted): Promise<string[]> =>
  (await p.findAll({ type: 'Svg' })).flatMap(x => {
    const m = /^\w+ agent, \w+: (shard \d+)/.exec(String(x.props.alt))
    return m ? [m[1] as string] : []
  })

// Walks the pages with the foot's Next control from wherever the pane is, to the last one:
// each page's rows and drawn size.
async function walk(p: Mounted, next: string, rowsOf: (p: Mounted) => Promise<string[]>): Promise<{ rows: string[]; chars: number }[]> {
  const pages: { rows: string[]; chars: number }[] = []
  for (let i = 0; i < 40; i += 1) {
    pages.push({ rows: await rowsOf(p), chars: await drawnChars(p) })
    if (!(await p.find({ key: next }))) return pages
    await p.press({ key: next })
  }
  throw new Error('the pages did not end after 40 presses')
}

describe('the panel pages', () => {
  test('opening a log on the last row of a page keeps the row and its log on the page then shown', { timeoutMs: 120_000 }, async ($, on) => {
    await boot($, on)
    await startTurn($)
    for (let i = 1; i <= 24; i += 1) await spawnAs($, i, `shard ${i}`)
    // The first page, and the row it ends with.
    const first = await pane($)
    const shown = await normalRows(first)
    expect(await first.find({ key: 'rows-next' }), 'the 24 rows fill more than one page').toBeDefined()
    expect(shown.length).toBeGreaterThan(1)
    const last = shown[shown.length - 1] as string
    await first.unmount()
    // That row's log is long: with it open the row cannot stay on the page it ended.
    for (let i = 0; i < 50; i += 1) await $.tool.call({ tool: 'Read', agentId: last, file_path: `/repo/file${i}.ts` } as never)

    const p = await pane($)
    expect((await normalRows(p)).at(-1)).toBe(last)
    expect(await p.find({ key: `log-${last}` })).toBeDefined()
    await p.press({ key: `log-${last}` })
    const after = await keys(p)
    // The row and its log are on the page shown now, and the log is open.
    expect(after, `line-${last} on the page shown`).toContain(`line-${last}`)
    expect(after, `log-row-${last} on the page shown`).toContain(`log-row-${last}`)
    const log = (await p.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('Log'))
    expect(log).toBeDefined()
    await p.unmount()
  })

  test('Normal mode, 16 finished agents: every page is under the size limit and every row is on exactly one page', { timeoutMs: 120_000 }, async ($, on) => {
    const { clock } = await boot($, on)
    await startTurn($)
    for (let i = 1; i <= 16; i += 1) await spawnAs($, i, `Task number ${i}`)
    for (let i = 1; i <= 16; i += 1) {
      await clock.advance(1_000)
      await endAgent($, `a${i}`)
    }
    const p = await narrowPane($)
    const pages = await walk(p, 'rows-next', normalRows)
    expect(pages.length, 'more than one page').toBeGreaterThan(1)
    for (const [n, page] of pages.entries()) {
      expect(page.rows.length, `page ${n + 1} has rows`).toBeGreaterThan(0)
      expect(page.chars < PANE_DRAWING_LIMIT ? 'ok' : `page ${n + 1} draws ${page.chars} characters`).toBe('ok')
    }
    const all = pages.flatMap(x => x.rows)
    expect(new Set(all).size, 'no row on two pages').toBe(all.length)
    expect([...all].sort(), 'every row on a page').toEqual(Array.from({ length: 16 }, (_, i) => `a${i + 1}`).sort())
    await p.unmount()
  })

  test('compact mode, 200 rows: every page is under the size limit and every row is on exactly one page', { timeoutMs: 300_000 }, async ($, on) => {
    await boot($, on, { stored: { compact: { isCompact: true } } })
    await startTurn($)
    for (let i = 1; i <= 200; i += 1) await spawnAs($, i, `shard ${i}`)
    const p = await pane($)
    const pages = await walk(p, 'compact-next', compactRows)
    expect(pages.length, 'more than one page').toBeGreaterThan(1)
    for (const [n, page] of pages.entries()) {
      expect(page.rows.length, `page ${n + 1} has rows`).toBeGreaterThan(0)
      expect(page.chars < PANE_DRAWING_LIMIT ? 'ok' : `page ${n + 1} draws ${page.chars} characters`).toBe('ok')
    }
    const all = pages.flatMap(x => x.rows)
    expect(new Set(all).size, 'no row on two pages').toBe(all.length)
    expect([...all].sort(), 'every row on a page').toEqual(Array.from({ length: 200 }, (_, i) => `shard ${i + 1}`).sort())
    await p.unmount()
  })
})

// ---------------------------------------------------------------------------
// An answer with a plan name and no window the mod knows is a good answer.

const answerOf = (plan: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify({ plan }) }], isError: false })
const askAgain = async ($: Engine, clock: Boot['clock']): Promise<void> => {
  await startTurn($)
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
}

describe('an app answer with no known window', () => {
  test('ok with a plan name and an empty window list: the name is kept, no failure, and the app is still asked after three', async ($, on) => {
    const { clock, mcpCalls, stored } = await boot($, on, { app: answerOf({ status: 'ok', plan: 'Ultra', windows: [] }) })
    await clock.advance(1)
    await clock.settle()
    expect(mcpCalls).toHaveLength(1)
    expect(stored.appUsage).toMatchObject({ plan: 'Ultra', count: 0 })
    expect((stored.appUsage as Record<string, unknown>).ok).not.toBe(false)
    expect(stored.appUsage).not.toHaveProperty('error')
    await askAgain($, clock)
    await askAgain($, clock)
    expect(mcpCalls).toHaveLength(3)
    // Three such answers are not three failures: the fourth question still goes out.
    await askAgain($, clock)
    expect(mcpCalls).toHaveLength(4)
    expect(stored.appUsage).toMatchObject({ plan: 'Ultra' })
    expect(stored.appUsage).not.toHaveProperty('error')
  })

  test('ok with only labels the mod does not know counts the same', async ($, on) => {
    const answer = answerOf({ status: 'ok', plan: 'Ultra', windows: [{ label: 'Monthly spend', percentUsed: 5, resetsAt: null }, { label: 'Extra usage', percentUsed: 1 }] })
    const { clock, mcpCalls, stored } = await boot($, on, { app: answer })
    await clock.advance(1)
    await clock.settle()
    expect(stored.appUsage).toMatchObject({ plan: 'Ultra', count: 0 })
    expect(stored.appUsage).not.toHaveProperty('error')
    await askAgain($, clock)
    await askAgain($, clock)
    await askAgain($, clock)
    expect(mcpCalls).toHaveLength(4)
  })

  test('an answer with no window list at all, or a status other than ok, is still a failure', async ($, on) => {
    const { clock, mcpCalls, stored, app } = await boot($, on, { app: answerOf({ status: 'ok', plan: 'Ultra' }) })
    await clock.advance(1)
    await clock.settle()
    expect(stored.appUsage).toMatchObject({ ok: false, count: 0 })
    app.answer = answerOf({ status: 'error', plan: 'Ultra', windows: [] })
    await askAgain($, clock)
    app.answer = answerOf({ status: 'ok', plan: 'Ultra', windows: 'none' })
    await askAgain($, clock)
    expect(mcpCalls).toHaveLength(3)
    // Three failures in a row: no more questions this load.
    await askAgain($, clock)
    expect(mcpCalls).toHaveLength(3)
  })
})
