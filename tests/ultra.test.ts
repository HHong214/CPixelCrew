// Tests for the three Ultra-plan changes. They are written before the code: each new test
// fails now because the function it pins is not exported yet, or behaves as today.
//
// The contract (all in hooks/model.ts, pure, never throwing):
//
//   appPlan(text: string): string | undefined
//     The plan's name from the app's usage answer: `plan.plan`, only when `plan.status` is
//     'ok' and the name is a non-empty string; control characters removed, trimmed, cut to
//     at most 24 characters (cut, not rejected). Undefined for anything else and for junk.
//
//   usageLeftGauge(gauges: Gauge[]): Gauge | undefined
//     The gauge the "Usage left" item shows: the five_hour gauge, else seven_day, else the
//     first model week (kind seven_day_<name>) in the order given, else undefined.
//
//   barLimitGauges(items: readonly string[], gauges: Gauge[]): { item: string; gauge: Gauge }[]
//     The bar's limit items in the person's order and the gauge each shows. Item keys as
//     today: 'fiveHour' (shows usageLeftGauge), 'week' (the seven_day gauge) and
//     'model_week' (one entry per model-week gauge, in the gauges' order, as the bar draws
//     it today). A gauge (by kind) is given once: the earlier item keeps it. An item with
//     nothing to show, and any other item key ('context', 'speed', ...), gives no entry.
//
//   cardGroups<T extends { gauge: Gauge }>(entries: T[], plan?: string): CardGroup<T>[]
//     CardGroup<T> = { key: 'session' | 'plan'; title: string; figures: string[]; entries: T[] }
//     `entries` is what usageGauges gives (the context gauge, then every limit; each with
//     its own detail), `plan` is appPlan's answer. Two groups in order:
//       session: title 'Session', figures ['Cost', 'Tokens', 'Time'], the Context entry
//                (kind 'context') when there is one.
//       plan:    title `Plan · <plan>` or 'Plan' when the name is unknown (undefined or
//                blank), figures [], the limit entries in the order five_hour, seven_day,
//                model weeks (given order among them). Left out when there is no limit entry.
//     An entry is passed through as it came (same object).
//
//   rowPages<T>(rows: readonly T[], costOf: (row: T) => number, budget: number,
//               page?: number, max?: number): RowPages<T>
//     RowPages<T> = { pages: T[][]; page: number; rows: T[]; before: number; after: number; count: number }
//     Splits one section's rows into pages, in order, greedily: a row joins the current page
//     while the page's cost stays at or below `budget` (as `rowsWithin` does: spent + cost
//     <= budget) and it holds fewer than `max` rows (default MAX_DRAWN_ROWS); else it starts
//     the next page. A row over the budget alone gets a page of its own. An empty list gives
//     one empty page. `page` (default 0) is clamped into range (NaN reads as 0); `rows` is
//     that page's rows, `before` / `after` the rows on earlier / later pages, `count` the
//     number of pages, `page` the clamped index.
//
//   BAR_ITEMS (existing): the fiveHour item's `label` reads 'Usage left'.
//     NOTE for the builder: tests/model.test.ts line ~872 pins the old label '5-hour limit'
//     in a list; that line must be updated to 'Usage left' with this change.
//
// A function that does not exist yet fails its tests with `missing export: <name>`.

import { describe, expect, test } from 'claude-code/testing'

import type { Gauge } from '../hooks/model'
import * as model from '../hooks/model'

type Entry = { gauge: Gauge; detail?: string }
type Group = { key: string; title: string; figures: string[]; entries: Entry[] }
type Pages = { pages: unknown[][]; page: number; rows: unknown[]; before: number; after: number; count: number }

// The new exports, looked up by name so a missing one fails its own test, not the file.
const bag = model as unknown as Record<string, unknown>
const need = <F,>(name: string): F => {
  const f = bag[name]
  if (typeof f !== 'function') throw new Error(`missing export: ${name}`)
  return f as F
}
const appPlan = (t: unknown): string | undefined => need<(t: unknown) => string | undefined>('appPlan')(t)
const usageLeftGauge = (g: unknown): Gauge | undefined => need<(g: unknown) => Gauge | undefined>('usageLeftGauge')(g)
const barLimitGauges = (items: unknown, g: unknown): { item: string; gauge: Gauge }[] =>
  need<(i: unknown, g: unknown) => { item: string; gauge: Gauge }[]>('barLimitGauges')(items, g)
const cardGroups = (e: unknown, plan?: unknown): Group[] => need<(e: unknown, p?: unknown) => Group[]>('cardGroups')(e, plan)
const rowPages = <T,>(rows: unknown, costOf: (r: T) => number, budget: unknown, page?: unknown, max?: unknown): Pages =>
  need<(...a: unknown[]) => Pages>('rowPages')(rows, costOf, budget, page, max)

const MAX = model.MAX_DRAWN_ROWS
const NOW = Date.parse('2026-11-23T12:00:00Z')

// The answer the app gave on the Ultra plan (the owner's, as text).
const ULTRA = JSON.stringify({
  plan: {
    status: 'ok',
    plan: 'Ultra',
    windows: [
      { label: 'Weekly · all models', percentUsed: 70, resetsAt: '2026-11-24T16:00:00.024Z', resetsIn: '1d 2h' },
      { label: 'Weekly · Fable', percentUsed: 78, resetsAt: '2026-11-24T16:00:00.024Z', resetsIn: '1d 2h' },
    ],
    extraUsage: { enabled: false, currency: 'USD' },
  },
})
const answer = (plan: unknown, status: unknown = 'ok'): string => JSON.stringify({ plan: { status, plan, windows: [] } })

const gauge = (kind: string, used: number): Gauge => {
  const label = kind === 'five_hour' ? '5h' : kind === 'seven_day' ? 'Week' : kind === 'context' ? 'Context' : kind
  return { kind, label, used, left: 100 - used, resetIn: kind === 'context' ? null : 3 * 3_600_000, tone: 'calm' }
}
const FIVE = gauge('five_hour', 40)
const WEEK = gauge('seven_day', 70)
const FABLE = gauge('seven_day_fable', 78)
const OPUS = gauge('seven_day_opus', 10)
const CTX = gauge('context', 52)
const kinds = (list: { gauge: Gauge }[] | Gauge[] | undefined): string[] => (list ?? []).map(x => ('gauge' in x ? x.gauge.kind : x.kind))

describe('the Ultra answer (appLimits, appPlan)', () => {
  test('appLimits reads the Ultra answer: the week and the Fable week, no 5-hour limit', async () => {
    expect(model.appLimits(ULTRA)).toEqual([
      { kind: 'seven_day', percentUsed: 70, resetsAt: '2026-11-24T16:00:00.024Z' },
      { kind: 'seven_day_fable', percentUsed: 78, resetsAt: '2026-11-24T16:00:00.024Z' },
    ])
    // The unknown fields (plan, resetsIn, extraUsage) change nothing.
    const bare = JSON.parse(ULTRA) as { plan: Record<string, unknown> & { windows: Record<string, unknown>[] } }
    delete bare.plan.plan
    delete bare.plan.extraUsage
    for (const w of bare.plan.windows) delete w.resetsIn
    expect(model.appLimits(JSON.stringify(bare))).toEqual(model.appLimits(ULTRA))
    // And the gauges they make: Week, then the Fable week.
    const gauges = model.limitGauges({ ...model.blankUsage(NOW), limits: model.appLimits(ULTRA) }, NOW)
    expect(gauges.map(g => g.kind)).toEqual(['seven_day', 'seven_day_fable'])
    expect(gauges.some(g => g.kind === 'five_hour')).toBe(false)
  })

  test('appPlan: the plan name from an ok answer', async () => {
    expect(appPlan(ULTRA)).toBe('Ultra')
    expect(appPlan(answer('Pro'))).toBe('Pro')
    expect(appPlan(answer('Max 5x'))).toBe('Max 5x')
  })

  test('appPlan: trimmed, control characters removed, at most 24 characters', async () => {
    expect(appPlan(answer('  Ultra \n'))).toBe('Ultra')
    expect(appPlan(answer('Ul\u0000tra\u0007'))).toBe('Ultra')
    expect(appPlan(answer('Ul\u001b[31mtra'))).not.toMatch(/[\u0000-\u001f\u007f]/)
    const long = appPlan(answer('P'.repeat(80)))
    expect(long).toBeDefined()
    expect((long as string).length).toBeLessThanOrEqual(24)
    expect((long as string).length).toBeGreaterThan(0)
    expect(appPlan(answer('x'.repeat(24)))).toBe('x'.repeat(24))
  })

  test('appPlan: undefined for a status other than ok, a missing or blank name, a non-string name and junk', async () => {
    expect(appPlan(answer('Ultra', 'error'))).toBeUndefined()
    expect(appPlan(answer('Ultra', 'OK '))).toBeUndefined()
    expect(appPlan(answer('Ultra', null))).toBeUndefined()
    for (const name of ['', '   ', '\u0000\u0007', '\n', 7, null, true, {}, ['Ultra']]) expect(appPlan(answer(name)), JSON.stringify(name)).toBeUndefined()
    expect(appPlan(JSON.stringify({ plan: { status: 'ok', windows: [] } }))).toBeUndefined()
    expect(appPlan(JSON.stringify({ plan: 'Ultra' }))).toBeUndefined()
    expect(appPlan(JSON.stringify({ status: 'ok', plan: 'Ultra' }))).toBeUndefined()
    for (const junk of ['', 'not json', '{"plan":', 'null', '42', '[]', '{}', undefined, null, 42, {}, ['x']]) expect(appPlan(junk), String(junk)).toBeUndefined()
  })
})

describe('usage left (usageLeftGauge, barLimitGauges)', () => {
  test('usageLeftGauge: the 5-hour gauge, else the week, else the first model week, else nothing', async () => {
    expect(usageLeftGauge([FIVE, WEEK, FABLE])).toBe(FIVE)
    expect(usageLeftGauge([WEEK, FIVE])).toBe(FIVE)
    expect(usageLeftGauge([WEEK, FABLE])).toBe(WEEK)
    expect(usageLeftGauge([FABLE, WEEK])).toBe(WEEK)
    expect(usageLeftGauge([FABLE, OPUS])).toBe(FABLE)
    expect(usageLeftGauge([OPUS, FABLE])).toBe(OPUS)
    expect(usageLeftGauge([])).toBeUndefined()
    // Context and other kinds are not usage left.
    expect(usageLeftGauge([CTX, gauge('spend_limit', 5)])).toBeUndefined()
    expect(usageLeftGauge([CTX, FABLE])).toBe(FABLE)
  })

  test('usageLeftGauge never throws on junk', async () => {
    for (const junk of [undefined, null, 'x', 42, {}, [null], [3, 'x', { kind: 7 }]]) expect(usageLeftGauge(junk), String(junk)).toBeUndefined()
  })

  test('barLimitGauges on Ultra: the 5-hour item shows the week, the week item gives way, the model item keeps the Fable week', async () => {
    const ultra = [WEEK, FABLE]
    expect(barLimitGauges(['fiveHour', 'week', 'model_week'], ultra).map(x => [x.item, x.gauge.kind])).toEqual([
      ['fiveHour', 'seven_day'],
      ['model_week', 'seven_day_fable'],
    ])
    // The gauges themselves are handed back, not copies.
    expect(barLimitGauges(['fiveHour'], ultra)[0]?.gauge).toBe(WEEK)
  })

  test('barLimitGauges: the earlier item keeps a gauge, whatever the order', async () => {
    const ultra = [WEEK, FABLE]
    // The week item first: it keeps the week, so the 5-hour item has nothing left to show.
    expect(barLimitGauges(['week', 'fiveHour', 'model_week'], ultra).map(x => [x.item, x.gauge.kind])).toEqual([
      ['week', 'seven_day'],
      ['model_week', 'seven_day_fable'],
    ])
    expect(barLimitGauges(['model_week', 'fiveHour', 'week'], ultra).map(x => [x.item, x.gauge.kind])).toEqual([
      ['model_week', 'seven_day_fable'],
      ['fiveHour', 'seven_day'],
    ])
    // With only a model week, the 5-hour item shows it and the model item has nothing more.
    expect(barLimitGauges(['fiveHour', 'model_week'], [FABLE]).map(x => [x.item, x.gauge.kind])).toEqual([['fiveHour', 'seven_day_fable']])
    expect(barLimitGauges(['model_week', 'fiveHour'], [FABLE]).map(x => [x.item, x.gauge.kind])).toEqual([['model_week', 'seven_day_fable']])
  })

  test('barLimitGauges with a 5-hour gauge: each item shows its own, as the bar does today', async () => {
    const all = [FIVE, WEEK, FABLE, OPUS]
    expect(barLimitGauges(['fiveHour', 'week', 'model_week'], all).map(x => [x.item, x.gauge.kind])).toEqual([
      ['fiveHour', 'five_hour'],
      ['week', 'seven_day'],
      ['model_week', 'seven_day_fable'],
      ['model_week', 'seven_day_opus'],
    ])
    // The person's order is kept.
    expect(barLimitGauges(['model_week', 'week', 'fiveHour'], all).map(x => [x.item, x.gauge.kind])).toEqual([
      ['model_week', 'seven_day_fable'],
      ['model_week', 'seven_day_opus'],
      ['week', 'seven_day'],
      ['fiveHour', 'five_hour'],
    ])
    // One item alone.
    expect(barLimitGauges(['week'], all).map(x => x.gauge.kind)).toEqual(['seven_day'])
  })

  test('barLimitGauges: an item with nothing to show is left out; other items and repeats give no entry', async () => {
    expect(barLimitGauges(['fiveHour', 'week', 'model_week'], [])).toEqual([])
    expect(barLimitGauges(['week', 'model_week'], [FIVE])).toEqual([])
    expect(barLimitGauges(['model_week'], [FIVE, WEEK])).toEqual([])
    expect(barLimitGauges(['context', 'speed', 'cache', 'turn', 'time', 'bogus', 'fiveHour'], [CTX, FIVE]).map(x => x.item)).toEqual(['fiveHour'])
    // The same item twice shows its gauge once.
    expect(barLimitGauges(['week', 'week'], [WEEK]).length).toBe(1)
    expect(barLimitGauges([], [FIVE, WEEK])).toEqual([])
  })

  test('barLimitGauges never throws on junk and leaves its inputs as they were', async () => {
    expect(barLimitGauges(undefined, [FIVE])).toEqual([])
    expect(barLimitGauges('fiveHour', [FIVE])).toEqual([])
    expect(barLimitGauges(['fiveHour'], undefined)).toEqual([])
    expect(barLimitGauges(['fiveHour', 3, null], 'x')).toEqual([])
    expect(barLimitGauges(['week'], [null, 3, { kind: 7 }, WEEK]).map(x => x.gauge.kind)).toEqual(['seven_day'])
    const items = ['fiveHour', 'week']
    const gauges = [WEEK, FABLE]
    barLimitGauges(items, gauges)
    expect(items).toEqual(['fiveHour', 'week'])
    expect(gauges).toEqual([WEEK, FABLE])
  })

  test('the bar item that shows usage left is named "Usage left" in the settings list, and keeps its key', async () => {
    const item = model.BAR_ITEMS.find(b => b.key === 'fiveHour')
    expect(item?.label).toBe('Usage left')
    // The stored keys stay as they are.
    expect(item).toMatchObject({ key: 'fiveHour', name: '5h', option: 'barFiveHour' })
    expect(model.BAR_ITEMS.map(b => b.key)).toEqual(['context', 'fiveHour', 'week', 'model_week', 'speed', 'cache', 'turn', 'time'])
  })
})

describe('the card in groups (cardGroups)', () => {
  const detail = (g: Gauge): Entry => ({ gauge: g, detail: `detail of ${g.kind}` })
  const ULTRA_ENTRIES = [detail(CTX), detail(WEEK), detail(FABLE)]
  const ALL_ENTRIES = [detail(CTX), detail(FIVE), detail(WEEK), detail(FABLE), detail(OPUS)]

  test('two groups in order: Session with the figures and Context, Plan · name with the windows', async () => {
    const [session, plan, ...rest] = cardGroups(ULTRA_ENTRIES, 'Ultra')
    expect(rest).toEqual([])
    expect(session).toMatchObject({ key: 'session', title: 'Session', figures: ['Cost', 'Tokens', 'Time'] })
    expect(kinds(session?.entries)).toEqual(['context'])
    expect(plan).toMatchObject({ key: 'plan', title: 'Plan · Ultra', figures: [] })
    // No 5-hour entry when the account has none.
    expect(kinds(plan?.entries)).toEqual(['seven_day', 'seven_day_fable'])
  })

  test('with a 5-hour window: 5-hour, week, then the model weeks', async () => {
    const [, plan] = cardGroups(ALL_ENTRIES, 'Max')
    expect(plan?.title).toBe('Plan · Max')
    expect(kinds(plan?.entries)).toEqual(['five_hour', 'seven_day', 'seven_day_fable', 'seven_day_opus'])
    // The order follows the windows, not the order the entries came in.
    const [, shuffled] = cardGroups([detail(OPUS), detail(FABLE), detail(WEEK), detail(CTX), detail(FIVE)], 'Max')
    // (the model weeks keep the order they came in.)
    expect(kinds(shuffled?.entries)).toEqual(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_fable'])
  })

  test('entries are passed through as they came, with their own detail', async () => {
    const entries = [detail(CTX), detail(FIVE), detail(WEEK)]
    const [session, plan] = cardGroups(entries, 'Pro')
    expect(session?.entries[0]).toBe(entries[0])
    expect(plan?.entries[0]).toBe(entries[1])
    expect(plan?.entries[1]).toBe(entries[2])
    expect(plan?.entries[0]?.detail).toBe('detail of five_hour')
  })

  test('the plan group says just "Plan" when the name is not known', async () => {
    for (const name of [undefined, '', '   ', null, 7]) {
      const groups = cardGroups(ULTRA_ENTRIES, name)
      expect(groups.map(g => g.key), String(name)).toEqual(['session', 'plan'])
      expect(groups[1]?.title, String(name)).toBe('Plan')
    }
  })

  test('the plan group is left out when no plan window is known; Session stays', async () => {
    const only = cardGroups([detail(CTX)], 'Ultra')
    expect(only.map(g => g.key)).toEqual(['session'])
    expect(kinds(only[0]?.entries)).toEqual(['context'])
    expect(cardGroups([], 'Ultra').map(g => [g.key, g.title, g.entries.length])).toEqual([['session', 'Session', 0]])
    expect(cardGroups([], undefined).map(g => g.key)).toEqual(['session'])
  })

  test('Context goes to Session, never to Plan, and the figures only to Session', async () => {
    const [session, plan] = cardGroups(ALL_ENTRIES, 'Ultra')
    expect(kinds(plan?.entries)).not.toContain('context')
    expect(kinds(session?.entries)).toEqual(['context'])
    expect(plan?.figures).toEqual([])
  })

  test('never throws on junk', async () => {
    for (const junk of [undefined, null, 'x', 42, {}, [null], [3, 'x', { gauge: null }]]) {
      const groups = cardGroups(junk, 'Ultra')
      expect(groups.map(g => g.key)[0], String(junk)).toBe('session')
      expect(groups.length).toBeLessThanOrEqual(2)
    }
  })
})

describe('pages of rows (rowPages)', () => {
  const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i)
  const cost = (n: number): number => n
  // Costs as the rows: the row `7` costs 7.
  const split = (costs: number[], budget: number, max?: number): number[][] => rowPages(costs, cost, budget, 0, max).pages as number[][]

  test('rows are split in order, a page filling to the budget (equal to it fits)', async () => {
    expect(split([5, 5, 5, 5], 10)).toEqual([[5, 5], [5, 5]])
    expect(split([4, 4, 4, 4, 4], 10)).toEqual([[4, 4], [4, 4], [4]])
    expect(split([3, 3, 3], 10)).toEqual([[3, 3, 3]])
    expect(split([6, 5], 10)).toEqual([[6], [5]])
    expect(split([6, 4, 1], 10)).toEqual([[6, 4], [1]])
  })

  test('a single row over the budget gets a page of its own', async () => {
    expect(split([3, 20, 3], 10)).toEqual([[3], [20], [3]])
    expect(split([20], 10)).toEqual([[20]])
    expect(split([20, 30], 10)).toEqual([[20], [30]])
    expect(split([2, 2, 50, 2, 2], 10)).toEqual([[2, 2], [50], [2, 2]])
  })

  test('no page holds more than MAX_DRAWN_ROWS (default), or the max given', async () => {
    const pages = rowPages(ids(130), () => 1, 1_000_000).pages
    expect(pages.map(p => p.length)).toEqual([MAX, MAX, 10])
    expect(pages.flat()).toEqual(ids(130))
    expect(split([1, 1, 1, 1, 1], 100, 2)).toEqual([[1, 1], [1, 1], [1]])
    // Zero-cost rows still count as rows.
    expect(rowPages(ids(61), () => 0, 10).pages.map(p => p.length)).toEqual([MAX, 1])
  })

  test('an empty list gives one empty page', async () => {
    const r = rowPages([], cost, 10)
    expect(r.pages).toEqual([[]])
    expect(r).toMatchObject({ page: 0, rows: [], before: 0, after: 0, count: 1 })
  })

  test('a page index gives that page, the rows before and after it, and the page count', async () => {
    const costs = [4, 4, 4, 4, 4, 4, 4]
    const mid = rowPages(costs, cost, 10, 1)
    expect(mid.pages).toEqual([[4, 4], [4, 4], [4, 4], [4]])
    expect(mid).toMatchObject({ page: 1, rows: [4, 4], before: 2, after: 3, count: 4 })
    expect(rowPages(costs, cost, 10, 0)).toMatchObject({ page: 0, rows: [4, 4], before: 0, after: 5, count: 4 })
    expect(rowPages(costs, cost, 10)).toMatchObject({ page: 0, before: 0, after: 5, count: 4 })
    expect(rowPages(costs, cost, 10, 3)).toMatchObject({ page: 3, rows: [4], before: 6, after: 0, count: 4 })
    // An over-budget row in the middle.
    expect(rowPages([2, 30, 2], cost, 10, 1)).toMatchObject({ page: 1, rows: [30], before: 1, after: 1, count: 3 })
  })

  test('an index out of range is clamped', async () => {
    const costs = [4, 4, 4, 4, 4, 4, 4]
    expect(rowPages(costs, cost, 10, 99)).toMatchObject({ page: 3, rows: [4], before: 6, after: 0, count: 4 })
    expect(rowPages(costs, cost, 10, -5)).toMatchObject({ page: 0, rows: [4, 4], before: 0, after: 5, count: 4 })
    expect(rowPages(costs, cost, 10, NaN)).toMatchObject({ page: 0, before: 0 })
    expect(rowPages(costs, cost, 10, 1.7).page).toBeGreaterThanOrEqual(0)
    expect(rowPages([], cost, 10, 7)).toMatchObject({ page: 0, rows: [], count: 1 })
  })

  test('the rows come back as they went in (same objects), costed by the function', async () => {
    const rows = [{ id: 'a', n: 6 }, { id: 'b', n: 6 }, { id: 'c', n: 6 }]
    const r = rowPages(rows, x => x.n, 12, 1)
    expect(r.pages.map(p => (p as typeof rows).map(x => x.id))).toEqual([['a', 'b'], ['c']])
    expect(r.rows[0]).toBe(rows[2])
    expect(rows.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  test('never throws on junk', async () => {
    expect(rowPages(undefined, cost, 10)).toMatchObject({ pages: [[]], count: 1, rows: [] })
    expect(rowPages('abc', cost, 10)).toMatchObject({ pages: [[]], count: 1 })
    // A cost that is not a number does not lose the row.
    const odd = rowPages([1, 2, 3], () => NaN, 10)
    expect(odd.pages.flat()).toEqual([1, 2, 3])
    expect(() => rowPages([1, 2], () => { throw new Error('x') }, 10)).not.toThrow()
    expect(rowPages([1, 2, 3], cost, NaN).pages.flat()).toEqual([1, 2, 3])
    expect(rowPages([1, 2, 3], cost, -5).pages.flat()).toEqual([1, 2, 3])
  })

  test('property: every row is on exactly one page, in order, and no page costs over the budget (an alone row apart)', async () => {
    // A small seeded generator, so a failure repeats.
    let seed = 20261123
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let run = 0; run < 300; run++) {
      const n = Math.floor(next() * 150)
      const costs = Array.from({ length: n }, () => Math.floor(next() * 40))
      const budget = Math.floor(next() * 100)
      const max = next() < 0.5 ? undefined : 1 + Math.floor(next() * 20)
      const rows = costs.map((c, i) => ({ i, c }))
      const r = rowPages(rows, x => x.c, budget, 0, max)
      const label = `run ${run}: n=${n} budget=${budget} max=${max}`
      // Every row exactly once, in order.
      expect(r.pages.flat().map(x => (x as { i: number }).i), label).toEqual(rows.map(x => x.i))
      for (const page of r.pages as { i: number; c: number }[][]) {
        if (n > 0) expect(page.length, label).toBeGreaterThan(0)
        const spent = page.reduce((a, x) => a + x.c, 0)
        if (page.length > 1) expect(spent, label).toBeLessThanOrEqual(budget)
        expect(page.length, label).toBeLessThanOrEqual(max ?? MAX)
      }
      expect(r.count, label).toBe(r.pages.length)
      // The pieces of the answer add up for every index.
      for (let p = 0; p < r.count; p++) {
        const at = rowPages(rows, x => x.c, budget, p, max)
        expect(at.before + at.rows.length + at.after, label).toBe(n)
        expect(at.page, label).toBe(p)
      }
    }
  })
})
