// 2.5.0, slice A, the pure parts: the stored agent list is bounded (A2, A-d1), an empty
// task list is no report of tasks (A9, A-d5), and `clip` keeps emoji whole (A9). The wiring
// half of slice A is in frames.test.ts.
//
// `fitRows` and `AGENTS_LIMIT` are new in 2.5.0. They are read off the module at call time,
// so this file loads (and type-checks) before they exist, and each test that needs them
// fails on its own until they do:
//   export const AGENTS_LIMIT = 1_000_000
//   export function fitRows(list: AgentRun[], flow: Flow | null, limit = AGENTS_LIMIT): { kept: AgentRun[]; removed: AgentRun[] }

import { describe, expect, test } from 'claude-code/testing'
import type { AgentRun, Flow, LogEntry } from '../types'
import * as model from '../hooks/model'
import { blankMain, blankRetired, blankUsage, clip, mergeFlow, pushLog, retire, totals } from '../hooks/model'

type Fit = { kept: AgentRun[]; removed: AgentRun[] }
type Budget = {
  AGENTS_LIMIT: number
  fitRows: (list: AgentRun[], flow: Flow | null, limit?: number) => Fit
}
const budget = (): Budget => model as unknown as Budget

const T0 = Date.parse('2026-11-13T10:00:00Z')
const MAX = 1_000_000

// About 150 characters of JSON, as a tool row the mod logs.
const entry = (i: number, at: number): LogEntry => ({
  at,
  kind: 'tool',
  text: `Reading hooks/some/longer/path/to/a/file-number-${i}.ts`,
  outcome: 'ok',
  ms: 1_234,
  callId: `toolu_01ABCDEFGHIJKLMNOPQR${i}`,
})

// A log that took `n` entries through the mod's own reducer.
function logOf(n: number, at: number, cap?: number): LogEntry[] {
  let log: LogEntry[] = []
  for (let i = 0; i < n; i += 1) log = cap === undefined ? pushLog(log, entry(i, at + i)) : pushLog(log, entry(i, at + i), cap)
  return log
}

const row = (i: number, o: Partial<AgentRun> = {}): AgentRun => ({
  id: `r${i}`,
  agentId: `a${i}`,
  type: 'general-purpose',
  kind: 'other',
  tint: 0,
  description: `Shard number ${i}`,
  model: i % 2 ? 'claude-haiku-4-5' : 'claude-opus-5-5',
  status: 'running',
  startedAt: T0 + i * 1_000,
  contextTokens: 1_000,
  contextMax: 200_000,
  use: { input: 1_000 + i, output: 200 + i, cacheRead: 5_000, cacheWrite: 300 },
  costUsd: 0.01 * ((i % 7) + 1),
  steps: 3,
  round: 1,
  doing: 'Reading file.ts',
  doingSince: T0 + i * 1_000,
  log: [],
  ...o,
})
const finished = (i: number, o: Partial<AgentRun> = {}): AgentRun => row(i, { status: 'done', endedAt: T0 + i * 1_000 + 500, doing: 'Finished', ...o })

const size = (list: AgentRun[]): number => JSON.stringify(list).length

// The session's tokens and cost, as the pane's session card sums them: before the fit, and after
// it with the removed rows retired.
function expectSameTotals(list: AgentRun[], fit: Fit): void {
  const main = blankMain(T0)
  const usage = blankUsage(T0)
  const before = totals(main, list, usage, T0, blankRetired())
  const after = totals(main, fit.kept, usage, T0, retire(blankRetired(), fit.removed))
  expect(after.tokens).toBe(before.tokens)
  expect(after.use).toEqual(before.use)
  expect(Math.abs(after.costUsd - before.costUsd) < 1e-9 ? 'same cost' : `${after.costUsd} against ${before.costUsd}`).toBe('same cost')
}

// What the fit may change in a row: its log only. Every kept row is one of the list's, by id,
// with every other field as it was.
function expectSameRows(list: AgentRun[], fit: Fit): void {
  const byId = new Map(list.map(a => [a.id, a]))
  for (const a of [...fit.kept, ...fit.removed]) {
    const was = byId.get(a.id)
    expect(was).toBeDefined()
    expect({ ...a, log: [] }).toEqual({ ...was!, log: [] })
  }
  expect(fit.kept.length + fit.removed.length).toBe(list.length)
}

// A cut log keeps the newest entries, in order.
function expectNewest(was: LogEntry[], now: LogEntry[]): void {
  expect(now).toEqual(was.slice(was.length - now.length))
}

describe('the stored agent list is bounded (fitRows)', () => {
  test('A-d1: the limit is 1,000,000 characters of JSON', () => {
    expect(budget().AGENTS_LIMIT).toBe(MAX)
  })

  test('A-d1: 200 rows that each took 400 log entries fit in under 1,000,000 characters, with the session totals unchanged', () => {
    const list = Array.from({ length: 200 }, (_, i) => {
      const log = logOf(400, T0 + i * 1_000)
      return i % 2 ? finished(i, { log }) : row(i, { log })
    })
    expect(size(list)).toBeGreaterThan(MAX)
    const fit = budget().fitRows(list, null)
    expect(size(fit.kept)).toBeLessThan(MAX)
    expectSameTotals(list, fit)
    expectSameRows(list, fit)
    for (const a of fit.kept) expect(a.log.length).toBeLessThanOrEqual(200)
  })

  test('A2: 200 finished rows with full logs: each log is cut to its newest 10 entries at most, and no row goes', () => {
    const list = Array.from({ length: 200 }, (_, i) => finished(i, { log: logOf(400, T0 + i * 1_000, 400) }))
    const fit = budget().fitRows(list, null)
    expect(size(fit.kept)).toBeLessThanOrEqual(MAX)
    // Cutting to ten is enough here: nothing is emptied and nothing retired.
    expect(fit.removed).toEqual([])
    expect(fit.kept.map(a => a.id)).toEqual(list.map(a => a.id))
    fit.kept.forEach((a, i) => {
      expect(a.log.length).toBeGreaterThan(0)
      expect(a.log.length).toBeLessThanOrEqual(10)
      expectNewest(list[i]!.log, a.log)
    })
    expectSameTotals(list, fit)
  })

  test('A2: 200 live rows with 200 entries each (about 6 million characters): every row stays live, its log halved down', () => {
    const list = Array.from({ length: 200 }, (_, i) => row(i, { log: logOf(200, T0 + i * 1_000, 200) }))
    expect(size(list)).toBeGreaterThan(5_000_000)
    const fit = budget().fitRows(list, null)
    expect(size(fit.kept)).toBeLessThanOrEqual(MAX)
    expect(fit.removed).toEqual([])
    fit.kept.forEach((a, i) => {
      expect(a.status).toBe('running')
      expect(a.log.length).toBeGreaterThan(0)
      expect(a.log.length).toBeLessThan(200)
      expectNewest(list[i]!.log, a.log)
    })
    expectSameRows(list, fit)
  })

  test('A2: 1,000 live rows fit, and none goes', () => {
    const list = Array.from({ length: 1_000 }, (_, i) => row(i, { log: logOf(20, T0 + i * 1_000, 200) }))
    expect(size(list)).toBeGreaterThan(MAX)
    const fit = budget().fitRows(list, null)
    expect(size(fit.kept)).toBeLessThanOrEqual(MAX)
    expect(fit.removed).toEqual([])
    expectSameRows(list, fit)
    expectSameTotals(list, fit)
  })

  test('A2: finished rows off the plan are retired before a live log is cut; a finished row on a planned task stays', () => {
    const finishedRows = Array.from({ length: 100 }, (_, i) => finished(i, { log: logOf(400, T0 + i * 1_000, 400) }))
    const liveRows = Array.from({ length: 100 }, (_, i) => row(100 + i, { log: logOf(200, T0 + (100 + i) * 1_000, 200) }))
    const list = [...finishedRows, ...liveRows]
    const planned = finishedRows.filter((_, i) => i % 10 === 0)
    const flow = mergeFlow(null, { title: 'Shard it all', tasks: planned.map(a => ({ title: a.description })) } as never)
    const fit = budget().fitRows(list, flow)
    expect(size(fit.kept)).toBeLessThanOrEqual(MAX)
    const removed = new Set(fit.removed.map(a => a.id))
    for (const a of finishedRows) expect(removed.has(a.id)).toBe(!planned.includes(a))
    for (const a of liveRows) expect(removed.has(a.id)).toBe(false)
    expectSameRows(list, fit)
    expectSameTotals(list, fit)
  })

  test('A2: rows too big with no log at all: the oldest go, finished before live, until the list fits', () => {
    const doing = 'x'.repeat(5_000)
    const finishedRows = Array.from({ length: 150 }, (_, i) => finished(i, { doing }))
    const liveRows = Array.from({ length: 150 }, (_, i) => row(150 + i, { doing }))
    // Stored newest first, as the list is shown: the order must not decide which go.
    const list = [...finishedRows, ...liveRows].reverse()
    const fit = budget().fitRows(list, null)
    expect(size(fit.kept)).toBeLessThanOrEqual(MAX)
    expect(fit.removed.length).toBeGreaterThan(0)
    expect(fit.removed.every(a => a.status === 'done')).toBe(true)
    const newestGone = Math.max(...fit.removed.map(a => a.startedAt))
    const oldestKept = Math.min(...fit.kept.filter(a => a.status === 'done').map(a => a.startedAt))
    expect(newestGone).toBeLessThan(oldestKept)
    // The kept rows keep their order.
    const gone = new Set(fit.removed.map(a => a.id))
    expect(fit.kept.map(a => a.id)).toEqual(list.filter(a => !gone.has(a.id)).map(a => a.id))
    expectSameTotals(list, fit)

    const onlyLive = Array.from({ length: 300 }, (_, i) => row(i, { doing }))
    const live = budget().fitRows(onlyLive, null)
    expect(size(live.kept)).toBeLessThanOrEqual(MAX)
    expect(live.removed.length).toBeGreaterThan(0)
    expect(Math.max(...live.removed.map(a => a.startedAt))).toBeLessThan(Math.min(...live.kept.map(a => a.startedAt)))
    expectSameTotals(onlyLive, live)
  })

  test('A2: a list that fits comes back as the same object, with nothing removed; an empty one too', () => {
    const list = Array.from({ length: 30 }, (_, i) => (i % 3 ? row(i, { log: logOf(50, T0) }) : finished(i, { log: logOf(50, T0) })))
    const fit = budget().fitRows(list, null)
    expect(fit.kept).toBe(list)
    expect(fit.removed).toEqual([])
    const empty: AgentRun[] = []
    expect(budget().fitRows(empty, null).kept).toBe(empty)
  })

  test('A2: a smaller limit is honoured', () => {
    const list = Array.from({ length: 50 }, (_, i) => row(i, { log: logOf(100, T0, 200) }))
    const fit = budget().fitRows(list, null, 100_000)
    expect(size(fit.kept)).toBeLessThanOrEqual(100_000)
    expectSameTotals(list, fit)
  })
})

describe('reports and text (A9)', () => {
  const PLAN = { title: 'Ship the thing', tasks: [{ title: 'Write the parser' }, { title: 'Wire the CLI' }] }

  test('A-d5: a progress call with tasks: [] leaves the plan’s tasks and total as they were', () => {
    const prev = mergeFlow(null, PLAN as never)
    expect(prev.total).toBe(2)
    const next = mergeFlow(prev, { tasks: [] } as never)
    expect(next.tasks).toEqual(prev.tasks)
    expect(next.total).toBe(2)
    // The rest of the call still counts.
    const done = mergeFlow(prev, { tasks: [], done: 1 } as never)
    expect(done.tasks).toEqual(prev.tasks)
    expect(done.total).toBe(2)
    expect(done.done).toBe(1)
    // A given total still counts too.
    expect(mergeFlow(prev, { tasks: [], total: 3 } as never).total).toBe(3)
  })

  test('A9: clip never ends in half of a surrogate pair', () => {
    expect(clip('ab😀cd', 4)).toBe('ab…')
    expect(clip('ab😀cd', 5)).toBe('ab😀…')
    // Whatever the cut, no lone surrogate is left.
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    const s = '😀😀x😀😀y😀'
    for (let max = 1; max <= s.length; max += 1) expect(lone.test(clip(s, max))).toBe(false)
  })
})
