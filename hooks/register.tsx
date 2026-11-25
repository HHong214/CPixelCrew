// CPixelCrew: the wiring. Every call on `$` is in this file: the events the mod
// follows, the state they keep, the tools and command it adds, and the trees of
// the agents panel, the settings and guide panes and the bar above the prompt. What
// is drawn comes from draw.ts and what is reckoned from model.ts, so this file only
// moves values between the engine and those two. The choices and toggles are the
// plugin's own options (`userConfig`), which the engine hands to `register` and edits in
// its plugin settings screen. The four sizes and the bar items' order live in the mod's
// store and are set in the settings pane; the mod mirrors the sizes, and the exchange
// rate, as text options so the plugin screen shows them. `/crew reset` runs from a
// stored flag (`resetting`), one option per load.
//
// The mod watches a session and must never break one: every observer hook hands
// back exactly what `next` gave and keeps its own bookkeeping inside try/catch.

import { atom, read, update } from 'claude-code'
import type {
  Atom,
  Elements,
  EngineInterface,
  EventName,
  Hook,
  MatchedHook,
  McpToolResult,
  Register,
  RenderElement,
  Space,
  Timer,
  TurnStepChunk,
  TurnUsage,
  UiPressArgument,
} from 'claude-code'

import type { AgentRun, BarItem, Flow, Frame, FrameSnap, Limit, LogEntry, LogKind, LogOutcome, MainRun, Rates, Retired, Run, Settings, Sizes, Usage, View } from '../types'
import {
  BAR_ITEMS,
  CURRENCIES,
  DEFAULT_BAR_ORDER,
  DEFAULT_SETTINGS,
  DEFAULT_SIZES,
  FALLBACK_RATES,
  KINDS,
  KIND_KEYS,
  MIRROR_KEYS,
  SETTING_OPTION_KEYS,
  SIZE_KEYS,
  activityOf,
  appLimits,
  appPlan,
  addUse,
  agentColor,
  agentLabel,
  anchoredPage,
  barLimitGauges,
  barView,
  blankMain,
  blankRetired,
  capRows,
  blankUsage,
  blankView,
  changedOptions,
  clip,
  clipTitle,
  closeLog,
  closedRun,
  fitRows,
  isStuck,
  LIVE_LOG,
  drawnRows,
  contextGauge,
  costOf,
  creepSpan,
  elapsed,
  emptyUse,
  flowLabel,
  flowRatio,
  flowSettled,
  fmtClock,
  fmtSpan,
  fmtTime,
  fmtTokens,
  freshLimits,
  heldRun,
  joinRun,
  kindOf,
  runQuiet,
  limitGauges,
  mainWorkedMs,
  mergeFlow,
  mergeLimits,
  mirrorValues,
  moreLine,
  modelName,
  money,
  moveBarItem,
  norm,
  normalizeAgent,
  normalizeBarOrder,
  normalizeRetired,
  normalizeSizes,
  normalizeTasks,
  normalizeView,
  optionValue,
  paletteOf,
  partialArgsOf,
  plannedOf,
  printable,
  pushLog,
  renamedNote,
  reopenedFlow,
  retire,
  rowPages,
  setSetting,
  settingsFromOptions,
  sizesOf,
  sortAgents,
  stepSetting,
  taskColor,
  tallyMain,
  taskState,
  thoughtOf,
  tintFor,
  totals,
  useTotal,
  usageSplit,
  viewFill,
  windowOf,
  closeForgetsPane,
  reopensPane,
  withPaneOpen,
  withoutPaneOpen,
} from './model'
import type { Gauge, Planned, ProgressInput, RowPages, TaskState } from './model'
import {
  agentDrawing,
  backdropDrawing,
  cacheLine,
  collapsedDrawing,
  compactAgentDrawing,
  compactCardDrawing,
  compactFootDrawing,
  compactMainDrawing,
  iconDrawing,
  logDrawing,
  mainDrawing,
  meterDrawing,
  pillIconDrawing,
  pillText,
  pillTint,
  plannedDrawing,
  progressDrawing,
  sectionDrawing,
  sessionCardDrawing,
  splitShares,
  tipLines,
  titleDrawing,
} from './draw'
import type { Creep, Ctx, Drawing, IconName, PillIcon } from './draw'

// ---------------------------------------------------------------------------
// Constants.

// Room around a text control, in cells, so no button touches a drawing's edge.
const BTN_PAD_X = 1
const BTN_MARGIN_Y = 1
// Icon controls on the bar take no room beyond their own icon.
const ICON_PAD = 0
// Icon controls in the panel keep a little space above and below, clear of the drawings.
const PANEL_ICON: IconOpts = { padX: 0, marginY: 'xs' }
// `overlay` lays a plain Button over an icon drawing; `glyph` is a one-glyph Button.
// The orchestrator flips this after seeing the app.
const ICON_MODE: 'overlay' | 'glyph' = 'overlay'
const ICON = 22
// About 8 CSS px per reported column on the desktop.
const CELL = 8
// One icon control's width, in cells.
const RIGHT_COL = Math.ceil(ICON / CELL) + 2 * ICON_PAD
// Cells between the bar's panel icon and its collapse icon.
const BAR_ICON_GAP = 1
// The bar's right-hand part, in cells: the panel icon and the collapse icon side by side.
// Collapsed, the expand icon alone sits at the right end of a part this wide, so it
// does not move between the two states.
const BAR_RIGHT = 2 * RIGHT_COL + BAR_ICON_GAP
// The panel's right-hand column: one icon control and a cell of margin before it.
const PANEL_COL = RIGHT_COL + 1
// The page line's right-hand column: Previous and Next side by side, a cell apart, and a cell of margin.
const PAGE_COL = 2 * RIGHT_COL + 1 + 1
// Cells between the icon controls of the panel's title row (help, settings, compact).
const TITLE_ICON_GAP = 1
const TITLE_ICONS = 3
// The title row's right-hand column: its three icon controls, their gaps and a cell of margin.
const TITLE_COL = TITLE_ICONS * RIGHT_COL + (TITLE_ICONS - 1) * TITLE_ICON_GAP + 1
// The gap between the bar's progress row and its pills row, so their icons do not touch.
const BAR_ROW_GAP: Space = 'sm'
// The cells the bar's desktop panel takes across: its rounded border and one cell of
// padding on each side, kept out of the progress drawing's width so the drawing fits inside.
const BAR_PANEL_X = 4
// The cells the agents panel's card panel takes across: the bar panel's border alone, kept
// out of the card drawing's width; the drawing keeps its own inset inside it.
const CARD_PANEL_X = 2
// What the card panel's border adds to the pane's height above and below, for the backdrop.
const CARD_PANEL_H = 2 * CELL
// What a row holding an icon control adds to the panel's height, for sizing the backdrop.
const BTN_ROW_H = 34
// The strip kept clear at the right edge of the panes, in real pixels (not cells, and not
// zoomed with the panel text), where the app's vertical scroll bar shows over the pane.
const SCROLL_GUTTER = 12
const ICON_GAP_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 ${ICON} ${ICON}"></svg>`
const GUTTER_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" width="${SCROLL_GUTTER}" height="1" viewBox="0 0 ${SCROLL_GUTTER} 1"></svg>`
// Under this many columns the bar's limit pills say `3h 05m` instead of `resets in 3h 05m`.
const NARROW_COLUMNS = 60
// Rows whose log is open stay listed at most this many at once.
const MAX_OPEN_LOGS = 50

// The desktop app takes the agents pane as one answer and drops one that is too large, and
// the pane then reads "has not drawn in this pane". An agent row is about 15,000 characters
// of drawing, finished or not: 16 finished agents (about 290,000 in all) were dropped while
// the small guide pane drew. Rows past this many characters go to their section's `+N more`.
const PANE_BUDGET = 120_000
const PANE = 'crew-agents'
const PANE_TITLE = 'Agents'
const SETTINGS_PANE = 'crew-settings'
const SETTINGS_TITLE = 'Crew settings'
const GUIDE_PANE = 'crew-guide'
const GUIDE_TITLE = 'Crew guide'
// The last limits the engine reported, kept for the next session: `{ at, limits }`.
const LIMITS_KEY = 'limits'
// The four sizes the settings pane steps (`Sizes`).
const SIZES_KEY = 'sizes'
// The bar items' order, all eight (`BarItem[]`), set in the settings pane or by
// `/crew set barOrder`, which takes this same name.
const ORDER_KEY = 'barOrder'
// Whether the agents panel draws a glass card behind each mascot (a boolean), set in the
// settings pane or by `/crew set heroCard`. Kept in the store, never an option.
const HERO_KEY = 'heroCard'
// Whether the agents panel is in compact mode (`{ isCompact }`), kept across sessions.
const COMPACT_KEY = 'compact'
// The sessions whose agents pane the mod opened and nobody has closed since: `{ [sessionId]:
// writtenAt }`, at most MAX_PANE_OPEN, so a resume of one (a restarted process) opens it
// again. A session's entry goes once the mod or the person closes its pane.
const PANE_OPEN_KEY = 'paneOpen'
// True while `/crew reset` runs: each load writes one option until none differs.
const RESETTING_KEY = 'resetting'
// The app's usage windows and how the last call for them went: `{ at, ok, error?, count, limits }`.
const APP_USAGE_KEY = 'appUsage'
// The desktop app's own usage tool, which knows the model-specific weekly windows.
const APP_SERVER = 'ccd_session_mgmt'
const APP_TOOL = 'get_usage'
// The ticker asks the app at most this often; after this many failures in a row, not again this load.
const APP_EVERY_MS = 5 * 60_000
const APP_MAX_FAILS = 3
const MAX_ERROR = 200
const PROGRESS_TOOL = 'mcp__CPixelCrew__progress'
const STEP_TOOL = 'mcp__CPixelCrew__step'
// A `userConfig` field's row in the settings is `<plugin>.<field>`.
const CONFIG_PREFIX = 'CPixelCrew.'

// Added to the end of a worker's brief (`wantsSteps`). A system prompt that words step
// reporting as a condition gets skipped; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`

// Sends nothing about the person: a GET of the public USD table.
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const FX_TIMEOUT_MS = 8_000
const DAY_MS = 86_400_000
// Claude Code writes the prompt cache with a one-hour lifetime on a subscription.
const CACHE_TTL_MS = 3_600_000

const TICK_MS = 1_000
// The agent list is a backstop for missed ends, not the source: read it every 5th tick.
const SYNC_EVERY = 5
const MAX_DESCRIPTION = 120
const MAX_NOTE = 80

const MAX_THINKING = 2_000
const MAX_INPUT = 4_000

// Responses shorter than this are mostly tool-call stubs, and one that arrived in a
// single burst cannot be timed: such speed readings are noise.
const MIN_TOKENS = 20
const MIN_SECONDS = 0.5
const MAX_SPEED = 1_000

const APPROVAL = 'Waiting for your approval: '
// What the panel's title says while no plan is on; the task rows say `No task yet`.
const NO_TASK = 'No task yet'
const NO_TASK_YET = 'No task yet'
// The overlay Button's label. The kit gives a Button no size, and the app draws its hover
// box round the Button's own content, so the label must lay out wider than the 22px icon
// at any font size: three em spaces are three ems (about 39px at a 13px font, 24px even at
// 8px), plus the button's own padding, which also makes it taller than the icon. The layer
// over the icon centres it and clips it to the icon's square. Em spaces are not collapsed
// as plain spaces are.
const OVERLAY_LABEL = '\u2003\u2003\u2003'

// Icon controls as one plain glyph, when ICON_MODE is `glyph` or the surface has no Svg.
const GLYPHS: Record<IconName, string> = {
  collapse: '▾',
  expand: '▸',
  panel: '☰',
  panelOpen: '☰',
  log: '≡',
  logOpen: '≡',
  copy: '⧉',
  compact: '⊟',
  full: '⊞',
  fold: '▴',
  unfold: '▾',
  gear: '⚙',
  help: '?',
  prev: '‹',
  next: '›',
}
const LOG_MARKS: Record<LogKind, string> = { turn: '›', think: '∴', reply: '✎', step: '•', tool: '•', wait: '…', end: '✓', note: '•' }
const OUTCOME_MARKS: Record<LogOutcome, string> = { ok: '✓', error: '✗', denied: '⊘', open: '…' }
const STATUS_GLYPHS: Record<AgentRun['status'], string> = { running: '●', waiting: '⧗', done: '✓', failed: '✗' }

const USAGE_TEXT =
  'Usage: /crew (show or hide the agents panel), /crew open, /crew bar (collapse or expand the bar), /crew settings (show or hide the settings pane), ' +
  `/crew guide (show or hide the guide pane), /crew set <key> <value> (${[...SETTING_OPTION_KEYS, ...SIZE_KEYS].join(', ')}, barItems, barOrder, heroCard), /crew reset.`

// ---------------------------------------------------------------------------
// State. Rates, the bar's collapsed flag and the sizes are also kept in `$.store`;
// the other settings are the plugin's options and live in the engine's settings.

const flowState = atom({ plugin: 'CPixelCrew', key: 'flow' } as const, null)
// The subagents of the run under way, or of the last one: what the bar counts with no plan on.
const runState = atom({ plugin: 'CPixelCrew', key: 'run' } as const, null)
const agentsState = atom({ plugin: 'CPixelCrew', key: 'agents' } as const, [])
// What the rows no longer listed had spent, so the session's totals never go down.
const retiredState = atom({ plugin: 'CPixelCrew', key: 'retired' } as const, blankRetired())
const mainState = atom({ plugin: 'CPixelCrew', key: 'main' } as const, blankMain(0))
const usageState = atom({ plugin: 'CPixelCrew', key: 'usage' } as const, blankUsage(0))
const viewState = atom({ plugin: 'CPixelCrew', key: 'view' } as const, blankView())
const ratesState = atom({ plugin: 'CPixelCrew', key: 'rates' } as const, { at: 0, rates: { ...FALLBACK_RATES }, isLive: false })
const nowState = atom({ plugin: 'CPixelCrew', key: 'now' } as const, 0)
// What the pane and the bar draw from (2.5.0): composed from the values above, written at
// most once a second and only when changed. The render hooks read these and `view` alone.
const FRAME_SHAPE = 'frame-2.5a'
const paneFrameState = atom({ plugin: 'CPixelCrew', key: 'paneFrame' } as const, null, { shape: FRAME_SHAPE })
const barFrameState = atom({ plugin: 'CPixelCrew', key: 'barFrame' } as const, null, { shape: FRAME_SHAPE })

// The options `register` was handed. A changed option loads the module again and runs
// `register` with the new values, so a module variable always holds the current ones.
let optionsNow: unknown = {}
// The sizes and the bar order from the store, read once per module load (`loadSizes`);
// defaults until then.
let sizesNow: Sizes = { ...DEFAULT_SIZES }
let sizesLoaded = false
let sizesLoading: Promise<void> | null = null
let orderNow: BarItem[] = [...DEFAULT_BAR_ORDER]
let orderLoaded = false
let heroNow = true
let heroLoaded = false
const settingsNow = (): Settings => settingsFromOptions(optionsNow, sizesNow, orderNow, heroNow)

// Once per module load: the reset step or the mirror sync (`afterLoad`). The mirror sync
// stops for this load after a write the settings refuse; `mirrorsWritten` holds the texts
// this load already wrote, so a sync never writes the same text twice. `resettingNow` is
// this load's copy of the stored reset flag (read by `afterLoad`, set by `/crew reset`);
// `resetWritten` is set once this load wrote its one reset option.
let afterLoadStarted = false
let mirrorsStopped = false
let resettingNow = false
let resetWritten = false
const mirrorsWritten = new Map<string, string>()

// The desktop app's usage windows (`refreshAppLimits`), merged into every measurement.
let appLimitsNow: Limit[] = []
// The plan's name in the app's same answer (`appPlan`), kept with its windows.
let appPlanNow: string | undefined
let appFails = 0
let appAt = 0
let appBusy = false

// Counters nothing draws: a reload loses them, which only resets a count (or writes the
// remembered limits once more).
const live: { ticks: number; turnActions: number; ticker: Timer | null; limitsKept: string; calls: number } = { ticks: 0, turnActions: 0, ticker: null, limitsKept: '', calls: 0 }

// ---------------------------------------------------------------------------
// Types the hooks are written against.

type In<N extends EventName> = Parameters<Hook<N>>[1]
type NextOf<N extends EventName> = Parameters<Hook<N>>[2]

const PANE_MATCH = { component: 'Pane', requestId: PANE } as const
const SETTINGS_MATCH = { component: 'Pane', requestId: SETTINGS_PANE } as const
const GUIDE_MATCH = { component: 'Pane', requestId: GUIDE_PANE } as const
const BAR_MATCH = { component: 'AbovePrompt' } as const
const AGENT_TOOL_MATCH = { tool: 'Agent' } as const
type PaneHook = MatchedHook<'ui.render', typeof PANE_MATCH>
type SettingsHook = MatchedHook<'ui.render', typeof SETTINGS_MATCH>
type GuideHook = MatchedHook<'ui.render', typeof GUIDE_MATCH>
type AgentToolHook = MatchedHook<'tool.call', typeof AGENT_TOOL_MATCH>
type BarHook = MatchedHook<'ui.render', typeof BAR_MATCH>

type Kit = { Box: Elements['desktop']['Box']; Text: Elements['desktop']['Text']; Button: Elements['desktop']['Button']; Svg?: Elements['desktop']['Svg'] }
type SvgKit = Kit & { Svg: NonNullable<Kit['Svg']> }
type Press = (e: UiPressArgument) => unknown
type IconOpts = { active?: boolean; marginY?: Space; padX?: Space }

// `flow` is what the bar and the main row show: the reported plan while it applies, else
// the run as a flow (`Agents d/n`), else none; `plan` is that plan while it applies, for
// its planned rows. `running` is the real count of active agents (running or waiting) and
// `state` the task rows' state, both reckoned once per drawing; nothing drawn reads
// `flow.running`. `crew` is the bar's `×N`; `creep` its fill for this second, short of done.
// A frame's snap with the settings as they are now: what a drawing reads. `retired` is what
// the rows no longer listed had spent, in the session's totals.
type Snap = FrameSnap & { settings: Settings; creep: Creep | null; state: TaskState }

// What the main loop's stream has shown so far; one per model request.
type Follow = { phase: string; phaseAt: number; thinking: string; tool: string; input: string; shown: string; startedAt: number | null }

// ---------------------------------------------------------------------------
// Small pure helpers.

const fin = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// The mod's own legacy rule: a subagent type that starts `pixel-crew:` (the 1.6 crew roles).
const isLegacyCrewType = (type: string): boolean => /^pixel-crew:/i.test(type.trim())
// Claude Code's own subagent types, which never report steps.
const NO_STEP_TYPES: readonly string[] = ['web-fetch', 'explore', 'plan', 'claude-code-guide', 'statusline-setup']
// An agent on one of the tasks of a plan still on: its description is a planned title, matched as `plannedOf` matches.
const isPlanned = (f: Flow | null, description: string): boolean => {
  const key = norm(typeof description === 'string' ? description : '')
  return !!key && !!f && !f.isFinished && Array.isArray(f.tasks) && f.tasks.some(t => norm(String(t?.title ?? '')) === key)
}
// Whether a new agent's brief asks it to report steps, and whether it counts toward a plan's
// running agents: a legacy `pixel-crew:` type, or an agent on a planned task whatever its type
// (except Claude Code's own types).
const wantsSteps = (type: string, description: string, f: Flow | null): boolean =>
  isLegacyCrewType(type) || (isPlanned(f, description) && !NO_STEP_TYPES.includes(type.trim().toLowerCase()))
const isActive = (a: AgentRun): boolean => a.status === 'running' || a.status === 'waiting'
const unwait = (doing: string): string => (doing.startsWith(APPROVAL) ? doing.slice(APPROVAL.length) : doing)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const waitingFor = (n: number): string => `Waiting for ${plural(n, 'agent')}`
const tzOf = (at: number): number => -new Date(at).getTimezoneOffset()
// State a v1 module wrote may hold runs without a log.
const logOf = (x: { log?: unknown }): LogEntry[] => (Array.isArray(x.log) ? (x.log as LogEntry[]) : [])
// A live row's log, and the main agent's, keep their newest LIVE_LOG entries (A1).
const logPush = (log: LogEntry[], entry: LogEntry): LogEntry[] => pushLog(log, entry, LIVE_LOG)
// A finished row keeps the newest Log lines entries, the size in force (5 to 200).
const finishedLines = (): number => Math.min(LIVE_LOG, Math.max(1, Math.round(fin(settingsNow().logLines) ?? LIVE_LOG)))

// The stored rows as the mod can work on them: entries that are not records dropped, and a row
// without an id, a description, a usage tally or a log given safe ones (A10). The same array
// when nothing needed it, so a writer that changes nothing still writes nothing.
function cleanRows(raw: unknown): AgentRun[] {
  if (!Array.isArray(raw)) return []
  const isClean = (a: unknown): boolean =>
    isRecord(a) && typeof a.id === 'string' && typeof a.description === 'string' && isRecord(a.use) && Array.isArray(a.log) && typeof a.startedAt === 'number'
  if (raw.every(isClean)) return raw as AgentRun[]
  return raw.filter(isRecord).map((a, i) => {
    const id = typeof a.id === 'string' && a.id ? a.id : typeof a.id === 'number' ? String(a.id) : `row-${i}`
    return {
      ...a,
      id,
      description: typeof a.description === 'string' ? a.description : '',
      use: isRecord(a.use) ? a.use : emptyUse(),
      log: Array.isArray(a.log) ? a.log : [],
      startedAt: fin(a.startedAt) ?? 0,
      doingSince: fin(a.doingSince) ?? fin(a.startedAt) ?? 0,
      doing: typeof a.doing === 'string' ? a.doing : '',
      model: typeof a.model === 'string' ? a.model : '',
    } as unknown as AgentRun
  })
}

// The task rows' words where no drawing is (the terminal), as the drawings say them:
// `No task yet`, `Tasks 1/3`, `Paused · 1/3` (`Paused 1/3` with `sep` ' '), `Done`. A
// flow with no task count says how many agents really run, never `flow.running`.
function taskText(state: TaskState, f: Flow | null, running: number, sep = ' · '): string {
  if (state === 'none' || !f) return NO_TASK_YET
  // A run reads `Agents 2/3` in every state.
  if (f.unit) return flowLabel(f)
  if (state === 'done') return 'Done'
  if (state === 'paused') return f.total ? `Paused${sep}${f.done}/${f.total}` : 'Paused'
  return flowLabel({ ...f, isFinished: false, running })
}

// One line per entry, oldest first: `HH:MM:SS  ✓  Editing draw.ts  (2.1s)`.
function logText(log: readonly LogEntry[], tzOffsetMin: number): string {
  return log
    .map(x => {
      const mark = x.outcome === 'ok' && (x.kind === 'tool' || x.kind === 'end') ? OUTCOME_MARKS.ok : x.outcome === 'ok' ? LOG_MARKS[x.kind] ?? '•' : OUTCOME_MARKS[x.outcome] ?? '•'
      const took = typeof x.ms === 'number' && Number.isFinite(x.ms) ? `  (${(x.ms / 1000).toFixed(1)}s)` : ''
      return `${fmtClock(x.at, tzOffsetMin)}  ${mark}  ${printable(String(x.text ?? ''))}${took}`
    })
    .join('\n')
}

const contextOf = (u: TurnUsage): number =>
  (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)

function logEntry(at: number, kind: LogKind, text: string, outcome: LogOutcome = 'ok', ms?: number): LogEntry {
  const line = clip(printable(text), MAX_DESCRIPTION)
  return ms === undefined ? { at, kind, text: line, outcome } : { at, kind, text: line, outcome, ms: Math.max(0, ms) }
}

// A run that ends leaves nothing open behind it.
function closeAll(log: LogEntry[], at: number, outcome: LogOutcome): LogEntry[] {
  let out = log
  while (out.some(x => x.outcome === 'open')) out = closeLog(out, at, outcome)
  return out
}

function finishRun(a: AgentRun, at: number, status: 'done' | 'failed', text: string): AgentRun {
  const outcome: LogOutcome = status === 'done' ? 'ok' : 'error'
  const ms = Math.max(0, at - a.startedAt)
  return {
    ...a,
    status,
    endedAt: at,
    doing: status === 'done' ? 'Finished' : 'Failed',
    doingSince: at,
    // A finished row keeps the newest Log lines entries, its end among them (A1).
    log: logPush(closeAll(logOf(a), at, outcome), logEntry(at, 'end', text, outcome, ms)).slice(-finishedLines()),
  }
}

function endText(reason: string, ms: number, actions?: number): [string, LogOutcome] {
  if (reason === 'answer') return [actions === undefined ? `Finished in ${fmtTime(ms)}` : `Done in ${fmtSpan(ms)}, ${plural(actions, 'action')}`, 'ok']
  if (reason === 'aborted') return [`Interrupted after ${fmtSpan(ms)}`, 'denied']
  if (reason === 'refusal') return ['Declined the request', 'denied']
  return [`Stopped on an error after ${fmtSpan(ms)}`, 'error']
}

// What the store hands back may be from an older version or hand-edited.
function ratesOf(raw: unknown): Rates {
  const r = isRecord(raw) ? raw : {}
  const table = isRecord(r.rates) ? r.rates : {}
  const kept: Record<string, number> = { ...FALLBACK_RATES }
  for (const c of CURRENCIES) {
    const v = fin(table[c.code])
    if (v !== undefined && v > 0) kept[c.code] = v
  }
  kept.USD = 1
  return { at: fin(r.at) ?? 0, rates: kept, isLive: r.isLive === true }
}

function limitsOf(raw: unknown): Limit[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l): l is Record<string, unknown> => isRecord(l) && typeof l.kind === 'string')
    // A window with no figure yet is left out.
    .filter(l => fin(l.percentUsed) !== undefined)
    .map(l => ({ kind: String(l.kind), percentUsed: fin(l.percentUsed) ?? 0, resetsAt: typeof l.resetsAt === 'string' ? l.resetsAt : null }))
}

// The engine's measurement copied in: `session.measure` and `$.session.usage()` share the shape.
// The one place `usage.limits` is set: the engine's windows, plus the app's that the
// engine lacks (its model-specific weekly ones), also when the engine reports none.
function measured(prev: Usage, m: { context?: unknown; rateLimits?: unknown; cost?: unknown }, at: number): Usage {
  const ctx = isRecord(m.context) ? m.context : {}
  const cost = isRecord(m.cost) ? fin(m.cost.usd) : undefined
  return {
    ...prev,
    at,
    limits: mergeLimits(limitsOf(m.rateLimits), appLimitsNow, at),
    costUsd: cost ?? null,
    contextTokens: fin(ctx.tokens) ?? null,
    contextWindow: fin(ctx.window) || prev.contextWindow,
    contextPercent: fin(ctx.percent) ?? null,
  }
}

// The turn's cost is the session's total now less what it was when the turn began.
function withTurnCost(u: Usage, m: MainRun, list: AgentRun[], at: number, retired: Retired): Usage {
  if (m.turns === 0) return u
  return { ...u, turnCostUsd: Math.max(0, totals(m, list, u, at, retired).costUsd - u.costAtTurnStart) }
}

// A flow as a report leaves it: closed by that report, it no longer counts as settled by itself.
function closedByReport(f: Flow, isClosed: boolean): Flow {
  if (!isClosed || !f.settled) return f
  const out: Flow = { ...f }
  delete out.settled
  return out
}

// Rows leaving the list: their tokens and cost go to the retired tally, once.
async function retireRows($: EngineInterface, rows: AgentRun[]): Promise<void> {
  if (rows.length) await put($, retiredState, r => retire(normalizeRetired(r), rows))
}

// The fill's mark taken afresh: a plan that reopens starts from its honest fill.
async function resetMark($: EngineInterface): Promise<void> {
  await put($, runState, r => (r ? { ...r, high: 0, highKey: undefined } : r))
}

function stepRun(a: AgentRun, e: In<'turn.step'>, usage: TurnUsage | null): AgentRun {
  const base: AgentRun = {
    ...a,
    status: 'running',
    endedAt: undefined,
    effort: typeof e.effort === 'string' ? e.effort : a.effort,
    doing: unwait(a.doing),
  }
  if (!usage) return base
  const model = usage.model || e.model || a.model
  return {
    ...base,
    model,
    contextTokens: contextOf(usage),
    contextMax: windowOf(model),
    use: addUse(a.use, usage),
    costUsd: a.costUsd + costOf(model, usage, true),
    steps: a.steps + 1,
  }
}

// ---------------------------------------------------------------------------
// Small `$` helpers.

// Reads, applies `fn` and writes, as `update` does, but writes nothing when `fn` hands back
// the value it was given, the same object (A8). A write marks the frames out of date.
async function put<T>($: EngineInterface, a: Atom<T>, fn: (v: T) => T): Promise<T> {
  let same: { value: T } | null = null
  try {
    const out = (await updateOf($, a, v => {
      const next = fn(v)
      if (next === v) {
        same = { value: v }
        throw new Error('unchanged')
      }
      same = null
      return next
    })) as T
    writeGens.set(a.ref.key, (writeGens.get(a.ref.key) ?? 0) + 1)
    framesStale($)
    return out
  } catch (err) {
    const kept = same as { value: T } | null
    if (kept) return kept.value
    throw err
  }
}

// `update` on one of the mod's values, named as a const atom of this file (the engine's scan
// reads each update's source).
function updateOf<T>($: EngineInterface, a: Atom<T>, fn: (v: T) => T): Promise<unknown> {
  const f = fn as never
  if (a === (flowState as unknown)) return update($, flowState, f)
  if (a === (runState as unknown)) return update($, runState, f)
  if (a === (agentsState as unknown)) return update($, agentsState, f)
  if (a === (retiredState as unknown)) return update($, retiredState, f)
  if (a === (mainState as unknown)) return update($, mainState, f)
  if (a === (usageState as unknown)) return update($, usageState, f)
  if (a === (viewState as unknown)) return update($, viewState, f)
  if (a === (ratesState as unknown)) return update($, ratesState, f)
  if (a === (nowState as unknown)) return update($, nowState, f)
  return Promise.reject(new Error('not a value of the mod'))
}

// Every write of the agent list goes through here: the list as the mod can work on it
// (`cleanRows`), the change, then the fit under AGENTS_LIMIT (`fitRows`, A2); the rows the fit
// lets go are retired, so the session's totals stay.
async function putAgents($: EngineInterface, change: (list: AgentRun[]) => AgentRun[]): Promise<AgentRun[]> {
  // The plan in force, from the read cache while it was not written since.
  const flow = await cachedRead('flow', () => read($, flowState), null)
  let removed: AgentRun[] = []
  const out = await put($, agentsState, raw => {
    removed = []
    const list = cleanRows(raw)
    const next = change(list)
    if (next === list) return list === raw ? raw : next
    const fit = fitRows(next, isRecord(flow) ? (flow as unknown as Flow) : null)
    removed = fit.removed
    return fit.kept
  })
  await retireRows($, removed)
  return out
}

async function updateRun($: EngineInterface, agentId: string, change: (a: AgentRun) => AgentRun): Promise<boolean> {
  let isFound = false
  await putAgents($, list => {
    isFound = false
    let isChanged = false
    const next = list.map(a => {
      if (a.agentId !== agentId) return a
      isFound = true
      const changed = change(a)
      if (changed !== a) isChanged = true
      return changed
    })
    return isChanged ? next : list
  })
  return isFound
}

// ---------------------------------------------------------------------------
// Frames (A4, A5): the pane and the bar draw from `paneFrame` and `barFrame`. A write of any
// other value marks them out of date; they are then composed (from one read of the values)
// at once when no frame was written in the last FRAME_MS, else FRAME_MS after the last write,
// and each is written only when it differs from the one it last wrote. A press writes at once
// (`framesNow`). The two frames share this one hold; while anything works the tick composes
// them itself, so a busy second costs no timer.

const FRAME_MS = 1_000
const frames = {
  /** Out of date since they were last composed. */
  isStale: false,
  /** A composition is asked for, by a `clock.after`. */
  isQueued: false,
  /** No write before this time: FRAME_MS after the last. */
  heldUntil: -Infinity,
  /** Compositions run one after the other, so an older one never lands last. */
  chain: Promise.resolve(false) as Promise<boolean>,
  /** What this load last wrote of each (`snap` and `clock`, as JSON), and the bar's clock. */
  pane: '',
  bar: '',
  barClock: -1,
}

// The frames out of date: composed at once, or as the hold ends.
function framesStale($: EngineInterface): void {
  frames.isStale = true
  queueFrames($, 0)
}

// A timer, not this dispatch: the frames are composed once the event that changed the values
// is done with them, and never while a render hook draws (no write is allowed then).
function queueFrames($: EngineInterface, ms: number): void {
  if (frames.isQueued) return
  frames.isQueued = true
  try {
    $.clock.after(Math.max(0, ms), () => {
      frames.isQueued = false
      void flushFrames($)
    })
  } catch {
    frames.isQueued = false
  }
}

// Composes and writes the frames when out of date and not held; `at`, the clock when known.
async function flushFrames($: EngineInterface, at?: number): Promise<void> {
  if (!frames.isStale) return
  const now = at ?? (await $.clock.now().catch(() => Infinity))
  if (now < frames.heldUntil) return queueFrames($, frames.heldUntil - now)
  await writeFrames($)
  if (frames.isStale) queueFrames($, frames.heldUntil - now)
}

// A press: the frames composed and written at once, when changed; a write holds them anew.
async function framesNow($: EngineInterface): Promise<void> {
  await writeFrames($)
}

// Composes both frames from one read and writes each that differs from the last; true when
// either was written, which holds them for FRAME_MS. `madeAt`, when it was composed, is left
// out of the comparison.
function writeFrames($: EngineInterface): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    frames.isStale = false
    const c = await composeSnap($)
    const pane = paneFrameOf(c.snap, c.clock)
    const bar = barFrameOf(c.snap, c.clock, c.isBusy)
    const paneJson = JSON.stringify([pane.snap, pane.clock])
    const barJson = JSON.stringify([bar.snap, bar.clock])
    let isWritten = false
    if (paneJson !== frames.pane) {
      await $.state.set({ plugin: 'CPixelCrew', key: 'paneFrame' }, { shape: FRAME_SHAPE, value: pane })
      frames.pane = paneJson
      isWritten = true
    }
    if (barJson !== frames.bar) {
      await $.state.set({ plugin: 'CPixelCrew', key: 'barFrame' }, { shape: FRAME_SHAPE, value: bar })
      frames.bar = barJson
      frames.barClock = bar.clock
      isWritten = true
    }
    if (isWritten) frames.heldUntil = c.clock + FRAME_MS
    return isWritten
  }
  const out = frames.chain.then(run, run).catch(() => false)
  frames.chain = out
  return out
}

// The pane's frame: the rows with only their open logs, the main agent's log only when open.
// Its clock is the bookkeeping's (`at`): a render times its entrances on the clock as it draws.
function paneFrameOf(s: FrameSnap, clock: number): Frame {
  const open = new Set(s.view.openLogs)
  const list = s.list.map(a => (open.has(a.id) || !a.log.length ? a : { ...a, log: [] }))
  const main = open.has('main') || !s.main.log.length ? s.main : { ...s.main, log: [] }
  return { snap: { ...s, list, main }, clock: s.at, madeAt: clock }
}

// While nothing works, the bar's time steps once a minute; in the cache's last five minutes,
// and once it has expired, once a second (A7).
const CACHE_SECONDS_MS = 300_000
function barClockOf(clock: number, cacheExpiresAt: number | null): number {
  const second = Math.floor(clock / 1000) * 1000
  if (typeof cacheExpiresAt === 'number' && cacheExpiresAt - second <= CACHE_SECONDS_MS) return second
  return Math.floor(clock / 60_000) * 60_000
}

// The bar's frame: no rows, no logs, no plan rows; its time exact while anything works.
function barFrameOf(s: FrameSnap, clock: number, isBusy: boolean): Frame {
  return {
    snap: { ...s, list: [], plan: null, retired: blankRetired(), main: s.main.log.length ? { ...s.main, log: [] } : s.main },
    clock: isBusy ? clock : barClockOf(clock, s.usage.cacheExpiresAt),
    madeAt: clock,
  }
}

// The cache countdown in whole minutes until five are left, then `m:ss` (A7).
function countdownText(leftMs: number): string {
  if (leftMs > CACHE_SECONDS_MS) return `${Math.floor(leftMs / 60_000)}m`
  const sec = Math.ceil(leftMs / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

async function stamp($: EngineInterface): Promise<number> {
  const at = await $.clock.now()
  await put($, nowState, () => at)
  return at
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  const at = await $.clock.now()
  const m = await read($, mainState)
  const list = await read($, agentsState)
  const retired = normalizeRetired(await read($, retiredState).catch(() => null))
  const started = fin(u.startedAt)
  const next = await put($, usageState, prev => withTurnCost({ ...measured(prev, u, at), sessionStartedAt: started ?? prev.sessionStartedAt }, m, list, at, retired))
  await keepLimits($, next)
}

// After a measurement: a reported list of limits is remembered for later sessions, and
// an empty one (the engine reports none before the session's first response) is filled
// from the last remembered. Never throws.
async function keepLimits($: EngineInterface, u: Usage): Promise<void> {
  if (Array.isArray(u.limits) && u.limits.length) await rememberLimits($, u)
  else await adoptLimits($)
}

// Writes `{ at, limits }` to the store, only when the list changed since this module last wrote it.
async function rememberLimits($: EngineInterface, u: Usage): Promise<void> {
  try {
    const kept = JSON.stringify(u.limits)
    if (kept === live.limitsKept) return
    await $.store.set(LIMITS_KEY, { at: u.at, limits: u.limits })
    live.limitsKept = kept
  } catch {
    // Remembered next time.
  }
}

// The last remembered limits whose windows have not reset yet, while the engine reports none.
async function adoptLimits($: EngineInterface): Promise<void> {
  try {
    const stored = await $.store.get(LIMITS_KEY)
    const at = await $.clock.now()
    const limits = freshLimits(stored, at)
    if (limits.length) await put($, usageState, u => (u.limits.length ? u : { ...u, limits }))
  } catch {
    // The panel shows the context alone until the engine reports limits.
  }
}

// The main agent's state between turns follows its subagents.
async function settleMain($: EngineInterface): Promise<void> {
  const n = cleanRows(await read($, agentsState)).filter(isActive).length
  await put($, mainState, (m): MainRun => {
    if (m.turnStartedAt !== null) return m
    if (n > 0) return m.status === 'waiting' && m.doing === waitingFor(n) ? m : { ...m, status: 'waiting', doing: waitingFor(n) }
    return m.status === 'resting' ? m : { ...m, status: 'resting', doing: 'Resting' }
  })
  await stamp($)
}

// A flow whose planned tasks all ended `done` finishes by itself (`flowSettled`), without
// waiting for the orchestrator's last report; stored only when that changes it. Never throws.
async function settleFlow($: EngineInterface): Promise<void> {
  try {
    const flow = await read($, flowState)
    if (!flow || flow.isFinished) return
    const list = await read($, agentsState)
    const settled = flowSettled(flow, Array.isArray(list) ? list : [])
    if (!settled || JSON.stringify(settled) === JSON.stringify(flow)) return
    // Finishing by itself counts as a report: the plan stays shown for the run it finished in (`planApplies`).
    const at = await $.clock.now()
    // Written only over the flow it was reckoned from: a report that came in between wins.
    await put($, flowState, prev => (prev && !prev.isFinished && JSON.stringify(prev) === JSON.stringify(flow) ? { ...settled, reportedAt: at } : prev))
  } catch {
    // The orchestrator's own report finishes it.
  }
}

// The run's high-water mark, raised to the fill the bar shows at `at`: called before a
// change that may lower the honest fill (a re-plan, the next tick's write) and after
// one that moves it on, so the bar never moves back while the run's agent count stays.
// A view or count other than the one the mark was taken against starts it afresh. Never throws.
async function holdFill($: EngineInterface, at?: number, given?: AgentRun[]): Promise<void> {
  try {
    const now = at ?? (await $.clock.now())
    const run = await read($, runState)
    if (!run) return
    // The list the caller just read, else read here.
    const rows = given ?? cleanRows(await read($, agentsState))
    const view = barView(await read($, flowState), run, rows, now)
    if (!view.flow) return
    const fill = viewFill(view, run, rows, now)
    // In the run view a stuck agent counts as over; one that works again starts the mark afresh.
    const quiet = view.isPlan ? undefined : runQuiet(run, rows, now)
    // Written only over the run it was reckoned from: a run that started in between keeps its own mark.
    await put($, runState, prev => (prev && prev.startedAt === run.startedAt ? heldRun(prev, view.key, fill, quiet) : prev))
  } catch {
    // The bar may step back once; the next hold catches up.
  }
}

// Writes one option as the plugin settings screen would; the engine then loads the module
// again with it. Null once written, else why not.
async function writeOption($: EngineInterface, key: string, value: string | number | boolean): Promise<string | null> {
  try {
    const r = await $.config.set({ key: `${CONFIG_PREFIX}${key}`, value })
    return r.deny === undefined ? null : printable(String(r.deny)) || 'refused'
  } catch (err) {
    return printable(err instanceof Error ? err.message : String(err)) || 'failed'
  }
}

const WRITE_GUARD_KEY = 'writeGuard'
const WRITE_GUARD_MS = 120_000
const WRITE_GUARD_MAX = 3

// The writes the mod makes by itself (mirrors, the reset sequence) repeat on every load
// while the stored option differs from what was written. If the app ever stores a value
// differently from how it was given, that would reload the module forever: the same value
// written to the same option three times inside two minutes is refused here instead. The
// count lives in the store because a reload forgets module variables.
async function autoWrite($: EngineInterface, key: string, value: string | number | boolean): Promise<string | null> {
  try {
    const at = await $.clock.now()
    const stored = await $.store.get(WRITE_GUARD_KEY)
    const guard: Record<string, unknown> = isRecord(stored) ? { ...stored } : {}
    const prev = isRecord(guard[key]) ? guard[key] : {}
    const isSame = prev.value === value && typeof prev.at === 'number' && at - prev.at < WRITE_GUARD_MS
    const n = isSame ? (typeof prev.n === 'number' ? prev.n : 0) + 1 : 1
    if (n > WRITE_GUARD_MAX) return 'the value did not stay as written; not writing it again for now'
    guard[key] = { value, at, n }
    await $.store.set(WRITE_GUARD_KEY, guard)
  } catch {
    // No store: the write still goes through, unguarded.
  }
  return writeOption($, key, value)
}

type Applied = { written: number; refused: { key: string; why: string } | null }

// The one writer of options, for `/crew set`, `/crew reset` and every control of the
// settings pane: the options whose values differ between `before` and `after`, in order,
// stopping at the first the settings refuse. Nothing that is already so is written.
async function applySettings($: EngineInterface, before: Settings, after: Settings): Promise<Applied> {
  let written = 0
  for (const { key, value } of changedOptions(before, after)) {
    const why = await writeOption($, key, value)
    if (why) return { written, refused: { key, why } }
    written += 1
  }
  return { written, refused: null }
}

// What `/crew set` takes: every option that is a setting, the four sizes, `barItems` (a
// list that sets the eight `bar*` options), `barOrder` (the bar order, in the store) and
// `heroCard` (the cards behind the mascots, in the store).
const SET_KEYS: readonly string[] = [...SETTING_OPTION_KEYS, ...SIZE_KEYS, 'barItems', ORDER_KEY, HERO_KEY]
const isSizeKey = (key: string): key is keyof Sizes => (SIZE_KEYS as readonly string[]).includes(key)
const itemName = (k: BarItem): string => BAR_ITEMS.find(b => b.key === k)?.name ?? k

// `/crew set barOrder <list>`: the items named (as `barItems` takes them: `5h`, `model`,
// or the keys, any case, separated by commas or spaces) first, in the order given, then
// every other item in its present order. Null when a name is unknown or none is given.
function orderFromList(text: string, current: readonly BarItem[]): BarItem[] | null {
  const names = text.split(/[\s,]+/).filter(Boolean)
  const listed: BarItem[] = []
  for (const name of names) {
    const w = name.toLowerCase()
    const item = BAR_ITEMS.find(b => b.name === w || b.key.toLowerCase() === w)?.key
    if (!item) return null
    if (!listed.includes(item)) listed.push(item)
  }
  if (!listed.length) return null
  return [...listed, ...current.filter(k => !listed.includes(k))]
}

// A setting as `/crew set` reports it: `context, 5h` for the bar's items, `none` for nothing.
function shownSetting(s: Settings, key: string): string {
  if (key === 'barItems') {
    // In the bar's order, which `setSetting` does not know.
    const names = orderNow.filter(k => s.barItems.includes(k)).map(itemName)
    return names.length ? names.join(', ') : 'none'
  }
  if (isSizeKey(key)) return String(s[key])
  const v = optionValue(s, key)
  return v === undefined || v === '' ? 'none' : String(v)
}

// `/crew set <key> <value>`: checked by the model; a size goes to the store and the
// mirrors, anything else is written as its option's own kind.
async function setOption($: EngineInterface, key: string, value: string): Promise<string> {
  await loadSizes($)
  const field = SET_KEYS.find(k => k.toLowerCase() === key.toLowerCase())
  if (field === ORDER_KEY) {
    const order = orderFromList(value, orderNow)
    if (!order) return `Cannot set ${field} to "${printable(value)}". ${USAGE_TEXT}`
    const why = await saveOrder($, order)
    return why ? `Could not set ${field}: ${why}` : `Set ${field} to ${orderNow.map(itemName).join(', ')}.`
  }
  const before = settingsNow()
  const next = field === undefined ? null : setSetting(before, field, value)
  if (field === undefined || next === null) return `Cannot set ${printable(key) || '(no key)'} to "${printable(value)}". ${USAGE_TEXT}`
  if (isSizeKey(field)) {
    const why = await saveSizes($, sizesOf(next))
    return why ? `Could not set ${field}: ${why}` : `Set ${field} to ${shownSetting(next, field)}.`
  }
  if (field === HERO_KEY) {
    const why = await saveHero($, next.heroCard)
    return why ? `Could not set ${field}: ${why}` : `Set ${field} to ${next.heroCard}.`
  }
  const { refused } = await applySettings($, before, next)
  if (refused) return `Could not set ${refused.key}: ${refused.why}`
  return `Set ${field} to ${shownSetting(next, field)}.`
}

// ---------------------------------------------------------------------------
// Sizes, mirrors and the reset.

// Reads the sizes, the bar order and the hero card switch from the store, once per module load; anything
// unreadable is the defaults. A value stored by this load before the read finished stands.
async function loadSizes($: EngineInterface): Promise<void> {
  if (sizesLoaded && orderLoaded && heroLoaded) return
  const stored = async (key: string): Promise<unknown> => $.store.get(key).catch(() => undefined)
  sizesLoading ??= (async () => {
    const sizes = sizesLoaded ? undefined : await stored(SIZES_KEY)
    if (!sizesLoaded) sizesNow = normalizeSizes(sizes)
    sizesLoaded = true
    const order = orderLoaded ? undefined : await stored(ORDER_KEY)
    if (!orderLoaded) orderNow = normalizeBarOrder(order)
    orderLoaded = true
    const hero = heroLoaded ? undefined : await stored(HERO_KEY)
    if (!heroLoaded) heroNow = hero !== false
    heroLoaded = true
  })()
  await sizesLoading
}

// Writes the sizes to the store and this load's copy, then the mirrors, then asks for a
// redraw, which no option write may bring. Null once stored, else why not.
async function saveSizes($: EngineInterface, next: Sizes): Promise<string | null> {
  const why = await saveSizesOnly($, next)
  if (why) return why
  await syncMirrors($)
  $.ui.invalidate('ui.render')
  return null
}

// The store and this load's copy, and a redraw; the mirrors are left to the caller (a
// reset syncs them at its end). Null once stored, else why not.
async function saveSizesOnly($: EngineInterface, next: Sizes): Promise<string | null> {
  try {
    await $.store.set(SIZES_KEY, next)
  } catch (err) {
    return printable(err instanceof Error ? err.message : String(err)) || 'could not be stored'
  }
  sizesNow = { ...next }
  sizesLoaded = true
  $.ui.invalidate('ui.render')
  return null
}

// A stepper of the settings pane: the sizes as they are at the press, one step on.
async function stepSize($: EngineInterface, key: keyof Sizes, direction: 1 | -1): Promise<void> {
  await loadSizes($)
  const why = await saveSizes($, sizesOf(stepSetting(settingsNow(), key, direction)))
  if (why) $.ui.toast(`Could not set ${key}: ${why}`)
}

// Writes the bar order to the store and this load's copy, then asks for a redraw (no
// option write follows to bring one). Null once stored, else why not.
async function saveOrder($: EngineInterface, next: readonly BarItem[]): Promise<string | null> {
  const order = normalizeBarOrder(next)
  try {
    await $.store.set(ORDER_KEY, order)
  } catch (err) {
    return printable(err instanceof Error ? err.message : String(err)) || 'could not be stored'
  }
  orderNow = [...order]
  orderLoaded = true
  $.ui.invalidate('ui.render')
  return null
}

// Writes the hero card switch to the store and this load's copy, then asks for a redraw
// (no option write follows to bring one). Null once stored, else why not.
async function saveHero($: EngineInterface, next: boolean): Promise<string | null> {
  try {
    await $.store.set(HERO_KEY, next)
  } catch (err) {
    return printable(err instanceof Error ? err.message : String(err)) || 'could not be stored'
  }
  heroNow = next
  heroLoaded = true
  $.ui.invalidate('ui.render')
  return null
}

// The Hero cards button of the settings pane: flips the switch as it is at the press.
async function flipHero($: EngineInterface): Promise<void> {
  await loadSizes($)
  const why = await saveHero($, !heroNow)
  if (why) $.ui.toast(`Could not set ${HERO_KEY}: ${why}`)
}

// An order button of the settings pane: the stored order as it is at the press, the item
// one place up or down; nothing is written at an end.
async function moveItem($: EngineInterface, item: BarItem, direction: 1 | -1): Promise<void> {
  await loadSizes($)
  const stored = await $.store.get(ORDER_KEY).catch(() => undefined)
  const current = stored === undefined ? orderNow : normalizeBarOrder(stored)
  const next = moveBarItem(current, item, direction)
  if (next.join() === current.join() && current.join() === orderNow.join()) return
  const why = await saveOrder($, next)
  if (why) $.ui.toast(`Could not move ${item}: ${why}`)
}

// The option texts the plugin screen shows (the sizes, the rate in use): each one that
// differs from what the mod would write is written. A write reloads the module, which
// syncs again, so it converges; it stops for this load at the first refusal.
async function syncMirrors($: EngineInterface): Promise<void> {
  if (mirrorsStopped) return
  const rates = await read($, ratesState).catch(() => null)
  const want = mirrorValues(settingsNow(), rates ?? { at: 0, rates: { ...FALLBACK_RATES }, isLive: false })
  const shown = isRecord(optionsNow) ? optionsNow : {}
  for (const key of MIRROR_KEYS) {
    const text = want[key]
    if (typeof text !== 'string' || shown[key] === text || mirrorsWritten.get(key) === text) continue
    mirrorsWritten.set(key, text)
    const why = await autoWrite($, key, text)
    if (why === null) continue
    mirrorsWritten.delete(key)
    mirrorsStopped = true
    return
  }
}

// Stores the reset flag and this load's copy of it; a store that fails leaves the copy as asked.
async function setResetting($: EngineInterface, on: boolean): Promise<void> {
  resettingNow = on
  await $.store.set(RESETTING_KEY, on).catch(() => undefined)
}

// The stored reset flag; anything but `true` (or an unreadable store) is off.
async function readResetting($: EngineInterface): Promise<boolean> {
  return (await $.store.get(RESETTING_KEY).catch(() => undefined)) === true
}

// The reset's end: the flag cleared, then the mirrors synced to what is now so.
async function endReset($: EngineInterface): Promise<void> {
  await setResetting($, false)
  await syncMirrors($)
  $.ui.invalidate('ui.render')
}

// One step of the reset the stored flag asks for: the first option not at its default is
// written (its reload brings the next step). With none left, or once a write is refused,
// the flag is cleared and the mirrors synced. Null when the step went through or the
// reset is done, else what was refused.
async function resetStep($: EngineInterface): Promise<string | null> {
  // One option per load: the options this load holds are the ones before that write.
  if (resetWritten) return null
  const first = changedOptions(settingsNow(), DEFAULT_SETTINGS)[0]
  if (!first) {
    await endReset($)
    return null
  }
  const why = await autoWrite($, first.key, first.value)
  if (why === null) {
    resetWritten = true
    return null
  }
  await endReset($)
  return `${first.key}: ${why}`
}

// `/crew reset`: stores the flag, puts the sizes and the bar order back at once, then
// takes the first step; each load the option writes bring runs the next (`afterLoad`).
async function startReset($: EngineInterface): Promise<string> {
  await loadSizes($)
  await setResetting($, true)
  const sizesWhy = await saveSizesOnly($, { ...DEFAULT_SIZES })
  const orderWhy = await saveOrder($, DEFAULT_BAR_ORDER)
  const heroWhy = await saveHero($, true)
  const refused = await resetStep($)
  if (refused) return `Could not reset ${refused}`
  if (sizesWhy) return `Could not reset the sizes: ${sizesWhy}`
  if (orderWhy) return `Could not reset the bar order: ${orderWhy}`
  if (heroWhy) return `Could not reset the hero cards: ${heroWhy}`
  return 'Resetting the crew settings to their defaults.'
}

// Once per module load, from the first render or tick after `register` (a reload runs
// `register` again but not `session.start`): the next reset step while the stored flag
// is set, else the mirror sync. Never throws.
async function afterLoad($: EngineInterface): Promise<void> {
  try {
    await loadSizes($)
    await loadAppLimits($)
    resettingNow = await readResetting($)
    if (!resettingNow) {
      await syncMirrors($)
      return
    }
    const refused = await resetStep($)
    if (refused) $.ui.toast(`Could not reset ${refused}`)
  } catch {
    // The next load tries again.
  }
}

// Starts `afterLoad` once, on a timer so a render that calls this neither waits for it
// nor writes while it draws.
function kickAfterLoad($: EngineInterface): void {
  if (afterLoadStarted) return
  afterLoadStarted = true
  try {
    $.clock.after(0, () => void afterLoad($))
  } catch {
    void afterLoad($)
  }
}

// ---------------------------------------------------------------------------
// The desktop app's usage windows.

// The one call to the app's usage tool; on a host without the server it rejects.
async function callAppUsage($: EngineInterface): Promise<McpToolResult> {
  return $.mcp.call(APP_SERVER, APP_TOOL, { session_id: 'self' })
}

// What a failed call says about itself: its first content block's text.
function appErrorText(r: McpToolResult): string {
  const block = Array.isArray(r.content) ? r.content[0] : undefined
  return block && typeof block.text === 'string' ? block.text : ''
}

// Whether an answer's text is a good one: `plan.status` 'ok' with a list of windows,
// which may hold none the mod knows (a plan with no limits of its kind).
function isAppAnswer(text: string): boolean {
  try {
    const data: unknown = JSON.parse(text)
    const plan = isRecord(data) ? data.plan : undefined
    return isRecord(plan) && plan.status === 'ok' && Array.isArray(plan.windows)
  } catch {
    return false
  }
}

// The answer's windows and the plan's name, from the same text: the first content
// block's text, else the structured result; the first text with known windows wins, else
// the first good answer with none. `ok`: a good answer was found at all.
function appAnswerLimits(r: McpToolResult): { ok: boolean; limits: Limit[]; plan?: string } {
  const block = Array.isArray(r.content) ? r.content[0] : undefined
  const texts: string[] = []
  if (block && typeof block.text === 'string') texts.push(block.text)
  const sc = r.structuredContent
  if (typeof sc === 'string') texts.push(sc)
  else if (sc !== undefined && sc !== null) texts.push(JSON.stringify(sc))
  let bare: { ok: boolean; limits: Limit[]; plan?: string } | undefined
  for (const t of texts) {
    const found = appLimits(t)
    const plan = appPlan(t)
    if (found.length) return plan ? { ok: true, limits: found, plan } : { ok: true, limits: found }
    if (!bare && isAppAnswer(t)) bare = plan ? { ok: true, limits: [], plan } : { ok: true, limits: [] }
  }
  return bare ?? { ok: false, limits: [] }
}

// Asks the app for its usage windows; kept in this load and in the store with how the
// call went. A failure is only recorded; after three in a row, no more calls this load.
// True when new windows came.
async function refreshAppLimits($: EngineInterface): Promise<boolean> {
  if (appBusy || appFails >= APP_MAX_FAILS) return false
  appBusy = true
  try {
    const at = await $.clock.now().catch(() => appAt)
    appAt = at
    let diag: { at: number; ok: boolean; error?: string; count: number }
    try {
      const r = await callAppUsage($)
      if (!isRecord(r)) throw new Error('no answer')
      if (r.isError === true) throw new Error(appErrorText(r) || 'the usage tool reported an error')
      const found = appAnswerLimits(r)
      // A good answer may know no window the mod reads: no limits, and not a failure.
      if (!found.ok) throw new Error('no usage windows in the answer')
      appLimitsNow = found.limits
      appPlanNow = found.plan
      appFails = 0
      diag = { at, ok: true, count: found.limits.length }
    } catch (err) {
      appFails += 1
      const error = clip(printable(err instanceof Error ? err.message : String(err)) || 'failed', MAX_ERROR)
      diag = { at, ok: false, error, count: 0 }
    }
    await $.store.set(APP_USAGE_KEY, { ...diag, limits: appLimitsNow, ...(appPlanNow ? { plan: appPlanNow } : {}) }).catch(() => undefined)
    return diag.ok
  } finally {
    appBusy = false
  }
}

// The app's windows, then a measurement that merges them in. Never throws.
async function refreshAppUsage($: EngineInterface): Promise<void> {
  try {
    if (await refreshAppLimits($)) await refreshUsage($)
  } catch {
    // The engine's own windows stand.
  }
}

// The windows the app gave before this load, while their windows last.
async function loadAppLimits($: EngineInterface): Promise<void> {
  if (appLimitsNow.length) return
  try {
    const stored = await $.store.get(APP_USAGE_KEY)
    const at = await $.clock.now()
    const kept = freshLimits(stored, at)
    if (kept.length && !appLimitsNow.length) appLimitsNow = kept
    // The plan's name stored with them (or alone, for a plan with no window the mod reads),
    // read as the app's answer is read.
    const plan = isRecord(stored) && typeof stored.plan === 'string' ? appPlan(JSON.stringify({ plan: { status: 'ok', plan: stored.plan } })) : undefined
    if (plan && !appPlanNow) appPlanNow = plan
  } catch {
    // The next call brings them.
  }
}

async function toggleBar($: EngineInterface): Promise<boolean> {
  const at = await $.clock.now()
  const v = await put($, viewState, prev => {
    const p = normalizeView(prev)
    return { ...p, isBarCollapsed: !p.isBarCollapsed, barToggledAt: at }
  })
  try {
    await $.store.set('bar', { isCollapsed: v.isBarCollapsed })
  } catch {
    // Kept for this session only.
  }
  return v.isBarCollapsed
}

async function toggleView($: EngineInterface, key: 'isCompact' | 'isDoneCollapsed'): Promise<void> {
  const v = await put($, viewState, prev => {
    const p = normalizeView(prev)
    return { ...p, [key]: !p[key] }
  })
  // Compact mode is remembered across sessions, in the store beside the bar's collapsed state.
  if (key !== 'isCompact') return
  try {
    await $.store.set(COMPACT_KEY, { isCompact: v.isCompact })
  } catch {
    // Kept for this session only.
  }
}

async function isOpenPane($: EngineInterface, id: string): Promise<boolean> {
  return $.ui
    .panes()
    .then(list => list.some(p => p.id === id))
    .catch(() => false)
}

// Opens a pane see-through, so a wallpaper behind the app shows through it. A build
// that does not take `backgroundColor` on an open refuses it, and the pane opens as before.
// True when the open was made. `isKept`: open even with no surface attached, which the
// engine keeps and seats once one attaches (a reopen after a restart); its failures are
// swallowed, so a headless run logs nothing for it.
async function openClear($: EngineInterface, pane: { id: string; title: string }, isKept = false): Promise<boolean> {
  // Where no surface can show a pane (a headless run), nothing is opened, so nothing fails.
  const surfaces = await $.session.surfaces().catch(() => [])
  if (!surfaces.length && !isKept) return false
  try {
    try {
      await $.ui.open({ ...pane, backgroundColor: 'transparent' } as Parameters<EngineInterface['ui']['open']>[0])
    } catch {
      await $.ui.open(pane)
    }
  } catch (err) {
    if (!isKept) throw err
    return false
  }
  return true
}

// Opening stamps the time, so the pane's drawings play their entrance once; an open made is
// remembered for this session (PANE_OPEN_KEY).
async function openPane($: EngineInterface, isKept = false): Promise<void> {
  const at = await stamp($)
  if (!(await isOpenPane($, PANE))) await put($, viewState, v => ({ ...normalizeView(v), paneOpenedAt: at }))
  if (await openClear($, { id: PANE, title: PANE_TITLE }, isKept)) await rememberPaneOpen($)
  $.ui.invalidate('ui.render')
}

// Writes this session's entry (`id`, else `$.session.id()`); the other sessions' stay.
async function rememberPaneOpen($: EngineInterface, id?: string): Promise<void> {
  try {
    const sessionId = id || (await $.session.id())
    if (!sessionId) return
    const stored = await $.store.get(PANE_OPEN_KEY).catch(() => undefined)
    await $.store.set(PANE_OPEN_KEY, withPaneOpen(stored, sessionId, await $.clock.now()))
  } catch {
    // Not reopened after a restart; nothing else changes.
  }
}


// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  if (!(await isOpenPane($, PANE))) {
    await openPane($)
    return true
  }
  await $.ui.close({ id: PANE })
  // Forgotten here as well as in the ui.close hook: a close made from a press may not reach
  // the mod's own hooks.
  await forgetPaneOpen($)
  $.ui.invalidate('ui.render')
  return false
}

// Opens pane `id`, or closes it when it is up; true when it ends up open. The redraw
// shows its icon in the agents panel as active or not.
async function toggleSidePane($: EngineInterface, id: string, title: string): Promise<boolean> {
  const isOpen = await isOpenPane($, id)
  if (isOpen) await $.ui.close({ id })
  else await openClear($, { id, title })
  $.ui.invalidate('ui.render')
  return !isOpen
}

async function toggleSettings($: EngineInterface): Promise<boolean> {
  return toggleSidePane($, SETTINGS_PANE, SETTINGS_TITLE)
}

async function toggleGuide($: EngineInterface): Promise<boolean> {
  return toggleSidePane($, GUIDE_PANE, GUIDE_TITLE)
}

// Opens or closes the log under row `id` (`main`, a run's id, `plan-<n>`). A row's cost
// takes its log in, so the row may change page: it becomes the view's anchor, and the
// page shown is the one that holds it (`anchoredPage`). The main row is on every page.
async function toggleLog($: EngineInterface, id: string): Promise<void> {
  await put($, viewState, prev => {
    const v = normalizeView(prev)
    const openLogs = v.openLogs.includes(id) ? v.openLogs.filter(x => x !== id) : [...v.openLogs, id].slice(-MAX_OPEN_LOGS)
    return id === 'main' ? { ...v, openLogs } : { ...v, openLogs, rowPage: { n: v.rowPage?.n ?? 0, first: id } }
  })
}

// The agents panel's page of rows, kept in the view beside its other state: the page and
// the id of the row it starts at, which the page follows. The first page is kept as no entry.
async function setRowPage($: EngineInterface, n: number, first: string): Promise<void> {
  await put($, viewState, prev => {
    const v = normalizeView(prev)
    if (n >= 1 && first) v.rowPage = { n: Math.floor(n), first }
    else delete v.rowPage
    return v
  })
}

// `plan` opens for a reported plan and the agents on its tasks, once per flow; `any` also
// for any other subagent, once; `never` leaves the panel to the person.
async function autoOpen($: EngineInterface, key: string, isOfPlan: boolean): Promise<void> {
  const s = settingsNow()
  if (s.autoOpen === 'never' || (!isOfPlan && s.autoOpen !== 'any')) return
  // Every key the panel has opened for is remembered, so closing it
  // stays the person's decision when planned and other subagents alternate.
  // Kept escaped (`%` and `|`), so a title that holds `|` is one entry (A9).
  const kept = key.replace(/%/g, '%25').replace(/\|/g, '%7C')
  const opened = normalizeView(await read($, viewState)).autoOpenedFor.split('|')
  if (opened.includes(kept)) return
  await put($, viewState, prev => {
    const v = normalizeView(prev)
    return { ...v, autoOpenedFor: [...v.autoOpenedFor.split('|').filter(Boolean), kept].slice(-20).join('|') }
  })
  await openPane($).catch(() => undefined)
}

async function restore($: EngineInterface): Promise<void> {
  const stored = async (key: string): Promise<unknown> => $.store.get(key).catch(() => undefined)
  const r = ratesOf(await stored('rates'))
  await put($, ratesState, () => r)
  const bar = await stored('bar')
  const compact = await stored(COMPACT_KEY)
  await put($, viewState, v => ({ ...normalizeView(v), isBarCollapsed: isRecord(bar) && bar.isCollapsed === true, isCompact: isRecord(compact) && compact.isCompact === true }))
}

async function seed($: EngineInterface): Promise<void> {
  const at = await stamp($)
  await put($, usageState, u => ({ ...u, at, sessionStartedAt: u.sessionStartedAt || at }))
  await put($, mainState, m => (m.turns === 0 ? { ...m, doingSince: at } : m))
  const model = await $.session.model().catch(() => '')
  if (model) await put($, mainState, m => ({ ...m, model, contextMax: windowOf(model) }))
  await refreshUsage($).catch(() => undefined)
}

// Live rates at most once a day; on any failure the stored or built-in table stands.
async function refreshRates($: EngineInterface): Promise<void> {
  try {
    const at = await $.clock.now()
    if (at - (await read($, ratesState)).at < DAY_MS) return
    let timer: Timer | null = null
    const timeout = new Promise<null>(resolve => {
      timer = $.clock.after(FX_TIMEOUT_MS, () => resolve(null))
    })
    const res = await Promise.race([$.http.fetch(FX_URL).catch(() => null), timeout])
    ;(timer as Timer | null)?.cancel()
    if (!res || !res.ok) return
    const json: unknown = JSON.parse(res.text)
    if (!isRecord(json) || json.result !== 'success' || !isRecord(json.rates)) return
    const next: Rates = { ...ratesOf({ rates: json.rates }), at, isLive: true }
    await put($, ratesState, () => next)
    await $.store.set('rates', next).catch(() => undefined)
    // The plugin screen shows the rate in use; a load that is resetting syncs at the reset's end.
    if (!resettingNow && !(await readResetting($))) await syncMirrors($)
  } catch {
    // Rates are a nicety; the built-in table covers for them.
  }
}

// Once a second: the clocks of whatever is running, and now and then the agent
// list, in case an end never reached a hook.
async function tick($: EngineInterface): Promise<void> {
  kickAfterLoad($)
  try {
    live.ticks += 1
    await loadSizes($)
    const at = await $.clock.now()
    // The app's usage windows, at most every 5 minutes; not awaited, the clocks go on.
    if (appFails < APP_MAX_FAILS && !appBusy && at - appAt >= APP_EVERY_MS) void refreshAppUsage($)
    const m = await read($, mainState)
    const list = cleanRows(await read($, agentsState))
    const isBusy = (isRecord(m) && typeof m.turnStartedAt === 'number') || list.some(isActive)
    if (isBusy) {
      // The clocks of whatever runs: the frames are composed again, with this second's time.
      await holdFill($, at, list)
      await streamDue($, at).catch(() => undefined)
      frames.isStale = true
      await flushFrames($, at)
    } else {
      // Idle (A7): the tick writes nothing and invalidates nothing. Only the bar's cache
      // countdown moves: its frame is composed again when the bar's time steps, once a
      // minute, once a second in the last five; the pane's frame stands.
      const u = await read($, usageState)
      const s = settingsNow()
      const expires = isRecord(u) && typeof u.cacheExpiresAt === 'number' ? u.cacheExpiresAt : null
      if (s.barItems.includes('cache') && expires !== null && at < expires + TICK_MS && barClockOf(at, expires) !== frames.barClock) framesStale($)
    }
    if (list.some(isActive) && live.ticks % SYNC_EVERY === 0) await syncAgents($)
  } catch {
    // The next tick tries again.
  }
}

async function syncAgents($: EngineInterface): Promise<void> {
  const listed = await $.agent.list()
  const status = new Map(listed.map(info => [info.id, info.status]))
  const at = await $.clock.now()
  let hasEnded = false
  await putAgents($, list => {
    hasEnded = false
    let isChanged = false
    const next = list.map(a => {
      if (!isActive(a)) return a
      const s = a.agentId === undefined ? undefined : status.get(a.agentId)
      if (s === undefined) {
        // A3: quiet for STUCK_MS and not listed (or never given an id): its end was missed.
        // It comes back to `running` at its next step.
        if (!isStuck(a, at)) return a
        hasEnded = true
        isChanged = true
        return finishRun(a, at, 'failed', 'Stopped: no longer listed')
      }
      if (s === 'completed' || s === 'failed' || s === 'killed') {
        hasEnded = true
        isChanged = true
        const ms = at - a.startedAt
        return s === 'completed' ? finishRun(a, at, 'done', `Finished in ${fmtTime(ms)}`) : finishRun(a, at, 'failed', `Stopped (${s}) after ${fmtTime(ms)}`)
      }
      if ((s === 'waiting' || s === 'idle' || s === 'pending') && a.status === 'running') {
        isChanged = true
        return { ...a, status: 'waiting' as const, doingSince: at }
      }
      return a
    })
    return isChanged ? next : list
  })
  if (hasEnded) {
    await settleMain($)
    await settleFlow($)
  }
  await holdFill($, at)
}

async function registerTools($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: 'progress',
    description:
      'Report the progress of a plan to the bar above the prompt and the agents panel. ' +
      'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
      'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. ' +
      'For the main session only: a call from a subagent is ignored (workers report with `step`).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name of the overall task, a few words.' },
        total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
        done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
        phase: { type: 'string', enum: ['research', 'ask', 'plan', 'design', 'delegate', 'review', 'close'] },
        finished: { type: 'boolean', description: 'True once the flow is closed.' },
        tasks: {
          type: 'array',
          description:
            'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
              kind: { type: 'string', enum: [...KIND_KEYS], description: 'The kind of work the task is; it sets the look of its row and its agent.' },
              model: { type: 'string', description: 'The model the task is planned for, such as opus or sonnet.' },
              effort: { type: 'string', description: 'The effort the task is planned at, such as medium or high.' },
              agent: { type: 'string', description: 'Older name for kind, still read.' },
              after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
            },
            required: ['title'],
          },
        },
      },
    },
  })
  await $.tool.register({
    name: 'step',
    description:
      'For subagents: report progress on your own task to the agents panel. ' +
      'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
      'call it again as each step finishes. Cheap and silent: it only draws a bar.',
    inputSchema: {
      type: 'object',
      properties: {
        done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
        total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
        note: { type: 'string', description: 'The step in progress, a few words.' },
      },
      required: ['done'],
    },
    // In every agent's tool list, not behind ToolSearch: workers do not go looking for it.
    isDeferred: false,
  })
  await $.command.register({
    name: 'crew',
    description:
      'Show or hide the agents panel; `open`, `bar` (collapse or expand the bar), `settings` (show or hide the settings pane), `guide` (show or hide the guide), `set <key> <value>`, `reset`',
    argumentHint: '[open | bar | settings | guide | set <key> <value> | reset]',
  })
}

// ---------------------------------------------------------------------------
// Events.

async function onSessionStart($: EngineInterface, e: In<'session.start'>, next: NextOf<'session.start'>) {
  const started = await next(e)
  try {
    await registerTools($)
  } catch {
    // Without its tools the mod still draws what the session does.
  }
  try {
    await restore($)
  } catch {
    // Defaults stand.
  }
  try {
    await seed($)
  } catch {
    // The first measurement fills it in.
  }
  // A fresh session has no limits until its first response: the last known ones stand in.
  await adoptLimits($)
  try {
    live.ticker?.cancel()
    live.ticker = $.clock.every(TICK_MS, () => void tick($))
    // A timer, not this dispatch: the first prompt does not wait for the network.
    $.clock.after(0, () => void refreshRates($))
    // The app's usage windows, which hold the model-specific weekly ones.
    $.clock.after(0, () => void refreshAppUsage($))
  } catch {
    // No ticking clock: the panel updates on events alone.
  }
  return started
}

// Removes this session's entry alone; with none left the record goes.
async function forgetPaneOpen($: EngineInterface): Promise<void> {
  try {
    const sessionId = await $.session.id()
    const stored = await $.store.get(PANE_OPEN_KEY).catch(() => undefined)
    const rest = withoutPaneOpen(stored, sessionId)
    if (Object.keys(rest).length) await $.store.set(PANE_OPEN_KEY, rest)
    else await $.store.delete(PANE_OPEN_KEY)
  } catch {
    // The entry stays; a resume of this session may reopen the pane.
  }
}

// A close by the mod or the person forgets the open pane; an unload (the process going, or the
// module reloading) leaves it, so the pane comes back with the session.
async function onPaneClose($: EngineInterface, e: In<'ui.close'>, next: NextOf<'ui.close'>) {
  const closed = await next(e)
  if (closeForgetsPane(e.origin)) await forgetPaneOpen($)
  return closed
}

// A resumed session whose agents pane was open when its process went (the app restarts it
// with `--resume`, for one at a usage limit) opens the pane again. The open is made even
// with no surface attached yet: the engine keeps the pane and seats it when one attaches.
async function onClassicSessionStart($: EngineInterface, e: In<'classic.SessionStart'>, next: NextOf<'classic.SessionStart'>) {
  const result = await next(e)
  try {
    const id = e.session_id || (await $.session.id())
    // Any start (a `/clear` carries on under a new id) with the pane up: this id's entry.
    if (await isOpenPane($, PANE)) await rememberPaneOpen($, id)
    // Only a resume reopens it.
    if (e.source === 'resume') {
      const stored = await $.store.get(PANE_OPEN_KEY).catch(() => undefined)
      if (reopensPane(e.source, id, stored)) await openPane($, true)
    }
  } catch {
    // Left closed; `/crew` opens it.
  }
  return result
}

async function onCommand($: EngineInterface, e: In<'command.run'>) {
  const [word = '', ...rest] = (e.args ?? '').trim().split(/\s+/)
  switch (word.toLowerCase()) {
    case '':
      return { text: (await togglePane($)) ? 'Agents panel opened.' : 'Agents panel closed.' }
    case 'open':
      await openPane($)
      return { text: 'Agents panel opened.' }
    case 'settings':
      return { text: (await toggleSettings($)) ? 'Crew settings opened.' : 'Crew settings closed.' }
    case 'guide':
      return { text: (await toggleGuide($)) ? 'Crew guide opened.' : 'Crew guide closed.' }
    case 'bar':
      return { text: (await toggleBar($)) ? 'Bar collapsed.' : 'Bar expanded.' }
    case 'reset':
      return { text: await startReset($) }
    case 'set': {
      const [key = '', ...words] = rest
      return { text: await setOption($, key, words.join(' ')) }
    }
    default:
      return { text: USAGE_TEXT }
  }
}

async function onProgress($: EngineInterface, e: In<'tool.call'>) {
  // The flow is the main session's: a worker that called this could rename,
  // finish or reset it, and wipe the finished runs from the panel.
  if (e.agentId) return { result: 'ignored: only the main session reports the flow' }
  try {
    const input = e as unknown as ProgressInput
    const at = await $.clock.now()
    const prev = await read($, flowState)
    // Clipped as the stored title is, so a long title given again is the same flow.
    const title = typeof input.title === 'string' ? clipTitle(input.title) : ''
    // A flow that settled by itself (every task done) before the orchestrator's last
    // reports keeps its title and its runs: a report that agrees with it (`done` equal to
    // `total`, `finished: true`) changes nothing but when it was last reported, which keeps
    // it shown (`planApplies`). One that contradicts it (`done` below `total`, a phase other
    // than `close`) reopens it. A new title or a new task list still starts a new flow.
    const isSameFlow = title === '' || title === prev?.title
    const hasTasks = Array.isArray(input.tasks) && input.tasks.length > 0
    if (prev?.isFinished && isSameFlow && !hasTasks) {
      const reopened = reopenedFlow(prev, input)
      if (reopened) {
        await put($, flowState, () => ({ ...reopened, reportedAt: at }))
        await resetMark($)
        await holdFill($, at)
        return { result: `ok: ${flowLabel(reopened)}` }
      }
      // A plan the orchestrator closes (`finished: true`) is closed for good: without the
      // settled marker, neither a later report nor a run of one of its tasks reopens it.
      await put($, flowState, p => (p ? closedByReport({ ...p, reportedAt: at }, input.finished === true) : p))
      return { result: `ok: ${flowLabel(prev)}` }
    }
    // A re-plan of a plan that settled by itself reopens it and takes the new tasks; its
    // finished rows stay.
    if (prev?.isFinished && prev.settled && isSameFlow && hasTasks) {
      const reopened = reopenedFlow(prev, null) ?? prev
      const f = await put($, flowState, () => {
        const m = mergeFlow(reopened, input)
        return { ...m, reportedAt: at, startedAt: m.startedAt ?? at }
      })
      await resetMark($)
      await holdFill($, at)
      const merged = f ?? mergeFlow(reopened, input)
      await autoOpen($, merged.title, true)
      return { result: `ok: ${flowLabel(merged)}${renamedNote(input, merged)}` }
    }
    const isNew = title !== '' && (prev === null || prev.isFinished || mergeFlow(prev, input).title !== prev.title)
    // A new flow starts with a clean list; the runs still going stay, and what the others
    // spent stays in the session's totals.
    if (isNew) {
      let gone: AgentRun[] = []
      await putAgents($, list => {
        gone = list.filter(a => !isActive(a))
        return gone.length ? list.filter(isActive) : list
      })
      await retireRows($, gone)
    }
    // A report makes the flow fresh; a new flow is named by when it was first reported.
    const f = await put($, flowState, p => {
      const m = mergeFlow(p, input)
      return { ...m, reportedAt: at, startedAt: m.startedAt ?? at }
    })
    const merged = f ?? mergeFlow(null, input)
    if (Array.isArray(input.tasks) && input.tasks.length) await autoOpen($, merged.title, true)
    return { result: `ok: ${flowLabel(merged)}${renamedNote(input, merged)}` }
  } catch {
    return { result: 'error: the report could not be recorded' }
  }
}

// A worker's own progress: the call runs in the worker's loop, so agentId names it.
async function onStep($: EngineInterface, e: In<'tool.call'>) {
  const agentId = e.agentId
  if (!agentId) return { result: 'ignored: only subagents report steps' }
  const input = e as unknown as { done?: unknown; total?: unknown; note?: unknown }
  const at = await $.clock.now()
  // A re-plan to more steps lowers the agent's own part: the mark taken first keeps the bar where it was.
  await holdFill($, at)
  const isFound = await updateRun($, agentId, a => {
    const total = Math.max(0, Math.round(fin(input.total) ?? a.stepTotal ?? 0))
    const counted = Math.max(0, Math.round(fin(input.done) ?? a.stepDone ?? 0))
    const done = total ? Math.min(total, counted) : counted
    const note = typeof input.note === 'string' ? clip(printable(input.note), MAX_NOTE) : ''
    const text = `${total ? `${done}/${total}` : done}${note ? ` · ${note}` : ''}`
    return { ...a, stepTotal: total, stepDone: done, stepNote: note || undefined, stepAt: at, log: logPush(logOf(a), logEntry(at, 'step', text)) }
  })
  await holdFill($, at)
  return { result: isFound ? 'ok' : `ignored: no panel row for agent ${agentId}` }
}

// Safety net for the phase: launching an agent on a planned task (or a legacy `pixel-crew:` one) moves
// a reported plan on even when the orchestrator forgets to report. Nothing draws the count
// it keeps (`flow.running`); with no plan, or a finished one, nothing is made or changed:
// the run counts the agents.
async function onAgentTool($: EngineInterface, e: Parameters<AgentToolHook>[1], next: Parameters<AgentToolHook>[2]) {
  let isCounted = false
  try {
    const type = String(e.subagent_type ?? '')
    // Clipped as onAgentSpawn and the stored titles are, so a long planned title still matches.
    const description = clip(printable(String((e as { description?: unknown }).description ?? '')), MAX_DESCRIPTION)
    const plan = await read($, flowState)
    if (plan && !plan.isFinished && (isLegacyCrewType(type) || isPlanned(plan, description))) {
      await put($, flowState, prev => {
        if (!prev || prev.isFinished) return prev
        return { ...prev, running: prev.running + 1, phase: prev.phase === 'plan' ? 'delegate' : prev.phase }
      })
      isCounted = true
    }
  } catch {
    // Uncounted: the bar shows one fewer running.
  }
  try {
    return await next(e)
  } finally {
    if (isCounted) await put($, flowState, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev)).catch(() => undefined)
  }
}

async function startTool($: EngineInterface, agentId: string | undefined, label: string, callId: string): Promise<void> {
  const at = await $.clock.now()
  const open: LogEntry = { ...logEntry(at, 'tool', label, 'open'), callId }
  if (agentId === undefined) {
    live.turnActions += 1
    const held = takeStream()
    await put($, mainState, m => ({ ...m, status: m.turnStartedAt !== null ? 'working' : m.status, doing: label, doingSince: at, log: logPush(withRows(logOf(m), held), open) }))
  } else {
    await updateRun($, agentId, a => ({ ...a, status: a.status === 'waiting' ? 'running' : a.status, doing: label, doingSince: at, log: logPush(logOf(a), open) }))
  }
}

async function endTool($: EngineInterface, agentId: string | undefined, outcome: LogOutcome, callId: string): Promise<void> {
  const at = await $.clock.now()
  if (agentId === undefined) {
    await put($, mainState, m => ({
      ...m,
      status: m.status === 'waiting' && m.turnStartedAt !== null ? 'working' : m.status,
      doing: unwait(m.doing),
      log: closeLog(logOf(m), at, outcome, callId),
    }))
  } else {
    await updateRun($, agentId, a => ({ ...a, status: a.status === 'waiting' ? 'running' : a.status, doing: unwait(a.doing), activeAt: at, log: closeLog(logOf(a), at, outcome, callId) }))
  }
}

// Every tool call, the main loop's and each subagent's: the doing line and the log.
async function onToolCall($: EngineInterface, e: In<'tool.call'>, next: NextOf<'tool.call'>) {
  // The mod's own reports are bookkeeping, not work worth a log row.
  if (e.tool === PROGRESS_TOOL || e.tool === STEP_TOOL) return next(e)
  const agentId = e.agentId
  // Calls that overlap each close their own entry: by the engine's id for the call, else one of this load's own.
  const own = (e as { tool_use_id?: unknown; toolUseId?: unknown }).tool_use_id ?? (e as { toolUseId?: unknown }).toolUseId
  live.calls += 1
  const callId = typeof own === 'string' && own ? own : `call-${live.calls}`
  try {
    await startTool($, agentId, activityOf(e.tool, e as unknown as Record<string, unknown>), callId)
  } catch {
    // The row keeps its last line.
  }
  let outcome: LogOutcome = 'error'
  try {
    const result = await next(e)
    outcome = result.deny !== undefined ? 'denied' : result.isError ? 'error' : 'ok'
    return result
  } finally {
    await endTool($, agentId, outcome, callId).catch(() => undefined)
  }
}

async function onPermissionRequest($: EngineInterface, e: In<'classic.PermissionRequest'>, next: NextOf<'classic.PermissionRequest'>) {
  try {
    const args = isRecord(e.tool_input) ? e.tool_input : {}
    const label = activityOf(String(e.tool_name ?? ''), args)
    const doing = `${APPROVAL}${label}`
    const at = await $.clock.now()
    const waitRow = logEntry(at, 'wait', doing)
    if (e.agent_id !== undefined) await updateRun($, e.agent_id, a => ({ ...a, status: 'waiting', doing, doingSince: at, log: logPush(logOf(a), waitRow) }))
    else {
      const held = takeStream()
      await put($, mainState, (m): MainRun => ({ ...m, status: 'waiting', doing, doingSince: at, log: logPush(withRows(logOf(m), held), waitRow) }))
    }
  } catch {
    // The row keeps saying what it was doing.
  }
  return next(e)
}

async function addRun($: EngineInterface, e: In<'agent.spawn'>, agentId: string | undefined, model: string): Promise<void> {
  const at = await $.clock.now()
  const id = agentId ?? e.tool_use_id
  const description = clip(printable(e.description), MAX_DESCRIPTION)
  // A new run on a task of a plan that settled by itself reopens it.
  const settled = await read($, flowState)
  const isRerun = !!settled && settled.isFinished && !!norm(description) && (settled.tasks ?? []).some(t => norm(String(t?.title ?? '')) === norm(description))
  const reopened = isRerun ? reopenedFlow(settled, null) : null
  if (reopened) {
    await put($, flowState, () => ({ ...reopened, reportedAt: at }))
    await resetMark($)
  }
  const flow = await read($, flowState)
  // Set once, as it starts: a planned task's kind, else its type's, else its description's.
  const kind = kindOf(e.subagentType, description, flow ? normalizeTasks(flow.tasks) : [])
  const label = KINDS[kind].label
  // The run as it stands before this agent joins it, for its place among those of its kind.
  const runBefore = await read($, runState).catch(() => null)
  let evicted: AgentRun[] = []
  await putAgents($, prev => {
    evicted = []
    const list = prev.map(normalizeAgent)
    const known = agentId === undefined ? undefined : list.find(a => a.agentId === agentId)
    if (known) {
      // A resumed agent keeps its row, its tokens and its log.
      return list.map(a =>
        a === known ? { ...a, status: 'running', endedAt: undefined, doing: 'Getting started', doingSince: at, log: logPush(logOf(a), logEntry(at, 'note', 'Resumed')) } : a,
      )
    }
    const round = 1 + (description ? list.filter(a => norm(a.description) === norm(description)).length : 0)
    const run: AgentRun = {
      id,
      agentId,
      type: e.subagentType,
      kind,
      tint: tintFor(kind, list, runBefore, id),
      description,
      model,
      status: 'running',
      startedAt: at,
      contextTokens: 0,
      contextMax: windowOf(model),
      use: emptyUse(),
      costUsd: 0,
      steps: 0,
      round,
      doing: 'Getting started',
      doingSince: at,
      log: [logEntry(at, 'note', model ? `Started as ${label} on ${modelName(model)}` : `Started as ${label}`)],
    }
    // Past the row cap, finished rows go first and an active one never (`capRows`).
    const { kept, removed } = capRows([...list.filter(a => a.id !== id), run])
    evicted = removed
    return kept
  })
  await retireRows($, evicted)
  // Every subagent, of any type, joins the run under way or starts the next one. The join
  // is timed after its row is in the list, so a prompt that read the list before it leaves the run open.
  const joinAt = await $.clock.now()
  await put($, runState, r => joinRun(r, id, joinAt))
  await holdFill($, at)
  await stamp($)
  const plan = await read($, flowState)
  if (plan && isPlanned(plan, description)) await autoOpen($, plan.title, true)
  else await autoOpen($, 'any-agent', false)
}

// What a person sent: typed at the prompt, through Remote Control or by the SDK host, and
// seen as typed; `/crew` only works the panel and is no new request.
function isPersonsPrompt(e: In<'prompt.submit'>): boolean {
  const kind = (e.origin as { kind?: unknown } | undefined)?.kind
  if (kind !== 'composer' && kind !== 'bridge' && kind !== 'sdk') return false
  if (e.isMeta === true) return false
  const command = typeof e.command?.name === 'string' ? e.command.name : ''
  return !/^(?:pixel-crew:)?crew$/i.test(command) && !/^\/(?:pixel-crew:)?crew(?:\s|$)/i.test(String(e.text ?? '').trim())
}

// A person's prompt ends the run when none of its agents is active (stuck ones aside), so
// the next subagent starts a new one; a background run still going spans the turn. The
// ended run stays shown until then. The prompt goes on first, untouched, so nothing here
// holds it up; the bookkeeping follows. An agent that joins after the list was read keeps
// the run open (`closedRun`).
async function onPromptSubmit($: EngineInterface, e: In<'prompt.submit'>, next: NextOf<'prompt.submit'>) {
  const out = await next(e)
  try {
    if (isPersonsPrompt(e)) {
      const at = await $.clock.now()
      const list = await read($, agentsState)
      const rows = Array.isArray(list) ? list : []
      await put($, runState, prev => closedRun(prev, rows, at, at))
      await holdFill($, at)
    }
  } catch {
    // The run goes on; the next subagent joins it.
  }
  return out
}

async function onAgentSpawn($: EngineInterface, e: In<'agent.spawn'>, next: NextOf<'agent.spawn'>) {
  let input = e
  try {
    const plan = await read($, flowState)
    if (wantsSteps(e.subagentType, clip(printable(e.description), MAX_DESCRIPTION), plan) && !e.prompt.includes(STEP_TOOL)) input = { ...e, prompt: e.prompt + STEP_BRIEF }
  } catch {
    input = e
  }
  const started = await next(input)
  try {
    if (started.deny === undefined) await addRun($, e, started.agentId, started.model || e.model || '')
  } catch {
    // The run shows once its own events arrive, or not at all.
  }
  return started
}

async function onTurnStart($: EngineInterface, e: In<'turn.start'>, next: NextOf<'turn.start'>) {
  try {
    const at = await $.clock.now()
    if (e.agentId !== undefined) {
      await updateRun($, e.agentId, a => (a.status === 'running' ? a : { ...a, status: 'running', endedAt: undefined, doing: unwait(a.doing), doingSince: at }))
    } else {
      live.turnActions = 0
      const prompt = clip(printable(e.text), 60)
      const held = takeStream()
      await put($, mainState, (m): MainRun => ({
        ...m,
        status: 'working',
        turns: m.turns + 1,
        turnStartedAt: at,
        doing: 'Reading your prompt',
        doingSince: at,
        log: logPush(withRows(logOf(m), held), logEntry(at, 'turn', prompt || 'Continued')),
      }))
      const m = await read($, mainState)
      const list = cleanRows(await read($, agentsState))
      const retired = normalizeRetired(await read($, retiredState).catch(() => null))
      await put($, usageState, u => ({ ...u, costAtTurnStart: totals(m, list, u, at, retired).costUsd, turnCostUsd: 0 }))
      await put($, nowState, () => at)
      // The model the session runs on now: `/model` may have changed it between turns.
      const model = await $.session.model().catch(() => '')
      if (model) await put($, mainState, (x): MainRun => (x.model === model ? x : { ...x, model, contextMax: windowOf(model) }))
    }
  } catch {
    // The panel catches up at the turn's first step.
  }
  return next(e)
}

// A think or reply phase is logged once it ends, with how long it took.
function phaseRow(f: Follow, at: number): LogEntry | null {
  if (f.phase === 'think') {
    const thought = thoughtOf(f.thinking)
    return logEntry(f.phaseAt, 'think', thought ? `Thought: ${thought}` : 'Thought', 'ok', at - f.phaseAt)
  }
  if (f.phase === 'reply') return logEntry(f.phaseAt, 'reply', 'Wrote the reply', 'ok', at - f.phaseAt)
  return null
}

// What the stream has for the main row and not written yet (A6): its line, the phases that
// ended (their log rows) and when the newest phase began. Written at once, then at most once
// a second: a write holds the stream for STREAM_MS, and what came meanwhile is written as the
// hold ends. Module state: one main loop per session.
const STREAM_MS = 1_000
// `until`: when the hold ends; `gen` names the hold, so the timer of one the tick ended early does nothing.
const streamHeld: { isHeld: boolean; until: number; gen: number; doing: string; rows: LogEntry[]; since: number | null } = { isHeld: false, until: 0, gen: 0, doing: '', rows: [], since: null }

type Held = { doing: string; rows: LogEntry[]; since: number | null }

// What the stream holds, taken: a writer of the main row that comes after it logs its rows
// and puts its own line in place of the stream's.
function takeStream(): Held {
  const held: Held = { doing: streamHeld.doing, rows: streamHeld.rows, since: streamHeld.since }
  streamHeld.doing = ''
  streamHeld.rows = []
  streamHeld.since = null
  return held
}

const withRows = (log: LogEntry[], held: Held): LogEntry[] => held.rows.reduce((out, x) => logPush(out, x), log)

// Writes what the stream holds.
async function writeStream($: EngineInterface): Promise<void> {
  const held = takeStream()
  if (!held.doing && !held.rows.length) return
  streamHeld.isHeld = true
  const gen = (streamHeld.gen += 1)
  // The clock read for this write: the hold's end, which the tick also keeps (`streamDue`).
  streamHeld.until = (await $.clock.now().catch(() => 0)) + STREAM_MS
  try {
    $.clock.after(STREAM_MS, () => {
      if (gen !== streamHeld.gen) return
      streamHeld.isHeld = false
      if (streamHeld.doing || streamHeld.rows.length) void writeStream($).catch(() => undefined)
    })
  } catch {
    streamHeld.isHeld = false
  }
  // A response streaming in a turn means any approval it waited on was answered.
  await put($, mainState, (m): MainRun => ({
    ...m,
    status: m.turnStartedAt !== null ? 'working' : m.status,
    doing: held.doing || m.doing,
    doingSince: held.since ?? m.doingSince,
    log: withRows(logOf(m), held),
  }))
}

// The tick's part: a held line whose hold has ended is written before the frames are composed,
// so a frame of that second has it whichever timer of that moment runs first.
async function streamDue($: EngineInterface, at: number): Promise<void> {
  if (!streamHeld.isHeld || at < streamHeld.until || (!streamHeld.doing && !streamHeld.rows.length)) return
  streamHeld.isHeld = false
  await writeStream($)
}

// Puts what the stream says on the main row, at most once a second. A new phase is timed
// (one clock read per phase, never per chunk) and the phase it ends is logged.
async function show($: EngineInterface, f: Follow, phase: string, doing: string): Promise<void> {
  const isNewPhase = phase !== f.phase
  if (isNewPhase) {
    const at = await $.clock.now()
    f.startedAt ??= at
    const ended = phaseRow(f, at)
    if (ended) streamHeld.rows.push(ended)
    f.phase = phase
    f.phaseAt = at
    streamHeld.since = at
  } else if (doing === f.shown) return
  f.shown = doing
  streamHeld.doing = doing
  if (!streamHeld.isHeld) await writeStream($)
}

async function timeSpeed($: EngineInterface, f: Follow, usage: TurnUsage | null, at: number): Promise<void> {
  // Timed from the response's first item, so thinking that streams hidden is still counted.
  if (usage === null || f.startedAt === null) return
  const tokens = usage.output_tokens
  const seconds = (at - f.startedAt) / 1000
  const speed = tokens / seconds
  if (tokens >= MIN_TOKENS && seconds >= MIN_SECONDS && speed <= MAX_SPEED) await put($, usageState, u => ({ ...u, speed: Math.round(speed) }))
}

// No clock read here: a chunk only reads it when it starts a phase (`show`) or stops (A6).
async function follow($: EngineInterface, f: Follow, chunk: TurnStepChunk): Promise<void> {
  switch (chunk.kind) {
    case 'thinking': {
      // A new thought starts its own buffer; the one before was logged when it ended.
      if (f.phase !== 'think') f.thinking = ''
      f.thinking = (f.thinking + chunk.text).slice(-MAX_THINKING)
      const thought = thoughtOf(f.thinking)
      return show($, f, 'think', thought ? `Thinking: ${thought}` : 'Thinking')
    }
    case 'text':
      return show($, f, 'reply', 'Writing the reply')
    case 'tool':
      f.tool = chunk.name
      f.input = ''
      return show($, f, `tool:${chunk.index}`, activityOf(chunk.name, {}))
    case 'input':
      if (f.input.length < MAX_INPUT) f.input = (f.input + chunk.json).slice(0, MAX_INPUT)
      return show($, f, f.phase, activityOf(f.tool, partialArgsOf(f.input)))
    case 'stop': {
      const at = await $.clock.now()
      f.startedAt ??= at
      return timeSpeed($, f, chunk.usage, at)
    }
    default:
      return
  }
}

// The stream's end: the phase that was still open is logged, with what the hold kept back,
// at once or as the hold ends.
async function flush($: EngineInterface, f: Follow): Promise<void> {
  if (f.phase === 'think' || f.phase === 'reply') {
    const ended = phaseRow(f, await $.clock.now())
    if (ended) streamHeld.rows.push(ended)
    f.phase = ''
  }
  if (!streamHeld.isHeld) await writeStream($)
}

async function addMainStep($: EngineInterface, e: In<'turn.step'>, usage: TurnUsage | null): Promise<void> {
  await put($, mainState, m => {
    const effort = typeof e.effort === 'string' ? e.effort : m.effort
    if (!usage) return effort === m.effort ? m : { ...m, effort }
    const model = usage.model || e.model || m.model
    const spent = costOf(model, usage, true)
    return {
      ...m,
      model,
      effort,
      use: addUse(m.use, usage),
      costUsd: m.costUsd + spent,
      byFamily: tallyMain(m, model, usage, spent),
      contextTokens: contextOf(usage),
      contextMax: windowOf(model),
    }
  })
}

async function* onTurnStep($: EngineInterface, e: In<'turn.step'>, next: NextOf<'turn.step'>) {
  if (e.agentId !== undefined) {
    const result = yield* next(e)
    try {
      const agentId = e.agentId
      const at = await $.clock.now()
      await updateRun($, agentId, a => ({ ...stepRun(a, e, result.usage), activeAt: at }))
    } catch {
      // That step's tokens go uncounted on the row.
    }
    return result
  }

  const f: Follow = { phase: '', phaseAt: 0, thinking: '', tool: '', input: '', shown: '', startedAt: null }
  const stream = next(e)
  for await (const chunk of stream) {
    try {
      await follow($, f, chunk)
    } catch {
      // The chunk goes on untouched whatever the panel made of it.
    }
    yield chunk
  }
  const result = await stream.result
  try {
    await flush($, f)
  } catch {
    // The next event redraws the row.
  }
  try {
    await addMainStep($, e, result.usage)
  } catch {
    // Uncounted step.
  }
  try {
    await refreshUsage($)
  } catch {
    // The next measurement brings it.
  }
  return result
}

async function endRun($: EngineInterface, e: In<'turn.complete'>, agentId: string): Promise<void> {
  const at = await $.clock.now()
  await updateRun($, agentId, a => {
    const ms = Math.max(0, at - a.startedAt)
    const status = e.reason === 'answer' ? 'done' : 'failed'
    const [text] = endText(e.reason, ms)
    const ended = finishRun(a, at, status, text)
    // A run whose steps went unseen still gets the turn's own sum.
    if (a.steps > 0 || !e.usage) return ended
    const model = e.usage.model || a.model
    return { ...ended, model, use: addUse(emptyUse(), e.usage), costUsd: costOf(model, e.usage, false) }
  })
  await settleMain($)
  await holdFill($, at)
}

async function endMainTurn($: EngineInterface, e: In<'turn.complete'>): Promise<void> {
  const at = await $.clock.now()
  const n = cleanRows(await read($, agentsState)).filter(isActive).length
  const actions = live.turnActions
  const held = takeStream()
  await put($, mainState, (m): MainRun => {
    const worked = m.turnStartedAt === null ? 0 : Math.max(0, at - m.turnStartedAt)
    const ms = fin(e.durationMs) ?? worked
    const [text, outcome] = endText(e.reason, ms, actions)
    return {
      ...m,
      workedMs: m.workedMs + worked,
      turnStartedAt: null,
      status: n > 0 ? 'waiting' : 'resting',
      doing: n > 0 ? waitingFor(n) : 'Resting',
      doingSince: at,
      log: logPush(closeAll(withRows(logOf(m), held), at, outcome), logEntry(at, 'end', text, outcome, ms)),
    }
  })
  await put($, usageState, u => ({ ...u, cacheExpiresAt: at + CACHE_TTL_MS }))
  await put($, nowState, () => at)
}

async function onTurnComplete($: EngineInterface, e: In<'turn.complete'>, next: NextOf<'turn.complete'>) {
  const result = await next(e)
  try {
    if (e.agentId !== undefined) await endRun($, e, e.agentId)
    else await endMainTurn($, e)
  } catch {
    // The agent list sync closes a run whose end was missed.
  }
  // A main-loop turn or a subagent that ends may leave every planned task done.
  await settleFlow($)
  try {
    await refreshUsage($)
  } catch {
    // The next measurement brings it.
  }
  // After a main-loop turn, the app's windows too; not awaited, so the turn's end is not held up.
  if (e.agentId === undefined) void refreshAppUsage($)
  return result
}

async function onMeasure($: EngineInterface, e: In<'session.measure'>, next: NextOf<'session.measure'>) {
  try {
    const at = await $.clock.now()
    const m = await read($, mainState)
    const list = cleanRows(await read($, agentsState))
    const retired = normalizeRetired(await read($, retiredState).catch(() => null))
    const u = await put($, usageState, prev => withTurnCost(measured(prev, e, at), m, list, at, retired))
    await keepLimits($, u)
  } catch {
    // The figures stay at the last reading.
  }
  return next(e)
}

// ---------------------------------------------------------------------------
// What a frame is composed from. Never in a render hook: a render reads the frames.

// The values as read, any of them junk an older version stored.
type Raw = { flow?: unknown; run?: unknown; agents?: unknown; retired?: unknown; main?: unknown; usage?: unknown; view?: unknown; rates?: unknown; now?: unknown }

// Reads the bookkeeping values and composes the snap both frames are cut from, at the clock now.
// `isBusy`: the main loop works or an agent is active, so the bar's time runs to the ms.
// What composing read of each value, by the count of this load's writes to it when read: a
// frame composed while nothing was written reads no value again (`put` counts the writes).
const readCache = new Map<string, { gen: number; value: unknown }>()
const writeGens = new Map<string, number>()

async function cachedRead(key: string, get: () => Promise<unknown>, fallback: unknown): Promise<unknown> {
  const gen = writeGens.get(key) ?? 0
  const hit = readCache.get(key)
  if (hit && hit.gen === gen) return hit.value
  try {
    const value = await get()
    if ((writeGens.get(key) ?? 0) === gen) readCache.set(key, { gen, value })
    return value
  } catch {
    return fallback
  }
}

async function composeSnap($: EngineInterface): Promise<{ snap: FrameSnap; clock: number; isBusy: boolean }> {
  const [flow, run, agents, retired, main, usage, view, rates, now, model, clock] = await Promise.all([
    cachedRead('flow', () => read($, flowState), null),
    cachedRead('run', () => read($, runState), null),
    cachedRead('agents', () => read($, agentsState), []),
    // State from an older version has no tally: zero.
    cachedRead('retired', () => read($, retiredState), null),
    cachedRead('main', () => read($, mainState), null),
    cachedRead('usage', () => read($, usageState), null),
    cachedRead('view', () => read($, viewState), null),
    cachedRead('rates', () => read($, ratesState), null),
    cachedRead('now', () => read($, nowState), 0),
    // The model the session runs on now, which `/model` changes without an event.
    $.session.model().catch(() => ''),
    $.clock.now().catch(() => 0),
  ])
  const snap = snapOf({ flow, run, agents, retired, main, usage, view, rates, now }, typeof model === 'string' ? model : '', clock)
  const isBusy = snap.main.turnStartedAt !== null || snap.running > 0
  // While anything works the tick writes no `now`: the frame's own time stands in for it.
  return { snap: isBusy && clock > snap.at ? { ...snap, at: clock } : snap, clock, isBusy }
}

// The snap, pure: every value read as junk may have it (A10). Records only, a row lacking an
// id, a description or a usage tally given safe ones, a main agent or a usage that is not a
// record read as blank.
function snapOf(raw: Raw, model: string, clock: number): FrameSnap {
  // A hot reload hands this code what v1 wrote: runs and the main agent may lack a log.
  // Runs and planned tasks 1.6 wrote (a role, no kind) read as 2.0 keeps them.
  const list = cleanRows(raw.agents).map(normalizeAgent)
  const rawFlow = isRecord(raw.flow) ? (raw.flow as Flow) : null
  const flow = rawFlow ? { ...rawFlow, tasks: normalizeTasks(rawFlow.tasks) } : null
  const run = isRecord(raw.run) ? (raw.run as Run) : null
  const rawMain = isRecord(raw.main) ? (raw.main as Partial<MainRun>) : {}
  const logged: MainRun = { ...blankMain(0), ...rawMain, log: logOf(rawMain) }
  if (typeof logged.turnStartedAt !== 'number') logged.turnStartedAt = null
  const main = model ? { ...logged, model } : logged
  const usage: Usage = isRecord(raw.usage) ? { ...blankUsage(0), ...(raw.usage as Partial<Usage>) } : blankUsage(0)
  const now = fin(raw.now) ?? 0
  const at = list.reduce((x, a) => Math.max(x, fin(a.startedAt) ?? 0), Math.max(now, main.turnStartedAt ?? 0, 0))
  // A session whose start was missed counts from now rather than from 1970.
  const u = usage.sessionStartedAt > 0 ? usage : { ...usage, sessionStartedAt: at }
  // Active means running or waiting: an agent waiting for approval is still at work.
  const running = list.filter(isActive).length
  const shown = barView(flow, run, list, Math.max(clock, at))
  const state = taskState(shown.flow, main.status === 'working', running)
  // The fill moves from what the last tick (`at`) showed, never under the high-water mark,
  // to where it will be at the next, as far into that second as the clock is.
  let creep: Creep | null = null
  if (shown.flow && state !== 'done' && state !== 'none') {
    // An agent counted stuck at the last mark that works again was counted over: the mark is void.
    const quiet = run && !shown.isPlan && Array.isArray(run.quiet) ? run.quiet : []
    const isRevived = !!run && quiet.length > 0 && runQuiet(run, list, at).live.some(id => quiet.includes(id))
    const high = run && run.highKey === shown.key && !isRevived ? run.high : 0
    creep = creepSpan(high, viewFill(shown, run, list, at), viewFill(shown, run, list, at + TICK_MS), Math.max(clock, at) - at)
  }
  return {
    flow: shown.flow,
    // The planned rows follow the bar: a plan it no longer shows has none.
    plan: shown.isPlan ? flow : null,
    crew: shown.crew,
    creep,
    list,
    retired: normalizeRetired(raw.retired),
    main,
    usage: u,
    view: normalizeView(raw.view),
    rates: ratesOf(raw.rates),
    at,
    running,
    state,
  }
}

// What a render draws: its frame with the settings as they are. Before the first frame (a
// fresh load), the idle state from blank values and the view as it stands, and a frame asked
// for, to be written by a timer once the render is done (A5).
async function drawnSnap($: EngineInterface, site: 'pane' | 'bar'): Promise<{ s: Snap; frameClock: number }> {
  const frame = await (site === 'pane' ? read($, paneFrameState) : read($, barFrameState)).catch(() => null)
  const clock = await $.clock.now().catch(() => 0)
  if (isRecord(frame) && isRecord(frame.snap)) {
    const f = frame as Frame
    // A site drawn long after its frame was composed (a mount after an idle spell) asks for a
    // fresh one; it is written only if it differs, so a redraw for a new frame asks for none.
    if (!(clock - (fin(f.madeAt) ?? 0) < FRAME_MS)) framesStale($)
    return { s: { ...f.snap, settings: settingsNow() }, frameClock: fin(f.clock) ?? 0 }
  }
  const view = await read($, viewState).catch(() => null)
  framesStale($)
  return { s: { ...snapOf({ view }, '', clock), settings: settingsNow() }, frameClock: clock }
}

// The clock as a render runs: entrances are timed by it, since `now` stands still while nothing runs.
async function clockOf($: EngineInterface, s: Snap): Promise<number> {
  return $.clock.now().catch(() => s.at)
}

// A reload (every changed option makes one) drops the timers of the environment before
// it and `session.start` does not run again, so whatever draws next restarts the clock.
function ensureTicker($: EngineInterface): void {
  if (live.ticker !== null) return
  try {
    live.ticker = $.clock.every(TICK_MS, () => void tick($))
  } catch {
    // The panel updates on events alone.
  }
}

// A press handler whose failure is the press's alone.
// A press writes the frames at once (A5): what it changed shows without waiting for the second.
const act =
  ($: EngineInterface, work: () => Promise<unknown>) =>
  async (): Promise<unknown> => {
    const out = await work().catch(() => undefined)
    await framesNow($).catch(() => undefined)
    return out
  }

// How long ago an entrance began: a drawing given it continues the motion on a redraw
// instead of playing it again. Undefined when none began, or with animations off.
function entranceAge(s: Settings, since: number, clock: number): number | undefined {
  return s.animations && since > 0 && clock >= since ? clock - since : undefined
}

// The most recent of several entrances.
function youngest(...ages: (number | undefined)[]): number | undefined {
  const known = ages.filter((x): x is number => x !== undefined)
  return known.length ? Math.min(...known) : undefined
}

function button(ui: Kit, key: string, label: string, onPress: Press, padX: Space = BTN_PAD_X, marginY: Space = BTN_MARGIN_Y): RenderElement {
  const { Box, Button } = ui
  return (
    <Box key={`${key}-box`} paddingX={padX} marginY={marginY}>
      <Button key={key} label={label} plain onPress={onPress} />
    </Box>
  )
}

// Every icon control goes through here, so ICON_MODE switches them all at once. The kit
// gives a Button no size, so the icon's square sets it: the square is a Box that shrinks to
// the icon drawing alone (no stretch, no grow), and the Button over it sits in a layer
// exactly that square, centred on both axes and clipped to it. Its hover box is then the
// icon's square, centred on the icon, in every row and in the title and the bar alike.
function iconButton(ui: Kit, key: string, icon: IconName, label: string, onPress: Press, opts: IconOpts = {}): RenderElement {
  const { Box, Button, Svg } = ui
  const padX = opts.padX ?? ICON_PAD
  const marginY = opts.marginY ?? 0
  if (ICON_MODE === 'overlay' && Svg) {
    const d = iconDrawing(icon, ICON, opts.active === true)
    return (
      <Box key={`${key}-box`} flexDirection="row" alignItems="flex-start" flexShrink={0} paddingX={padX} marginY={marginY}>
        <Box position="relative" flexDirection="column" alignSelf="flex-start" flexGrow={0} flexShrink={0} overflow="hidden">
          <Svg source={d.source} alt={printable(label)} width={ICON} height={ICON} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden" flexDirection="row" alignItems="center" justifyContent="center">
            <Button key={key} label={OVERLAY_LABEL} plain onPress={onPress} />
          </Box>
        </Box>
      </Box>
    )
  }
  return button(ui, key, GLYPHS[icon] ?? '•', onPress, padX, marginY)
}

// The empty place of an icon control that is not drawn: the same box, padding and margin
// as `iconButton`'s and an empty drawing exactly the icon's size, so the controls beside
// it stay put. Where the icons are glyphs, an empty box.
function iconGap(ui: Kit, key: string, opts: IconOpts = {}): RenderElement {
  const { Box, Svg } = ui
  if (ICON_MODE !== 'overlay' || !Svg) return <Box key={key} />
  return (
    <Box key={key} flexDirection="row" alignItems="flex-start" flexShrink={0} paddingX={opts.padX ?? ICON_PAD} marginY={opts.marginY ?? 0}>
      <Svg source={ICON_GAP_SOURCE} alt="" width={ICON} height={ICON} />
    </Box>
  )
}

// The column at a row's right end that holds its icon controls. Fixed in width where the
// icons are drawn, so a control sits at the same x in every row and every state.
function rightCol(ui: Kit, key: string, cells: number, controls: RenderElement[], gap = 0): RenderElement {
  const { Box } = ui
  const width = ICON_MODE === 'overlay' && ui.Svg ? { width: cells } : {}
  return (
    <Box key={key} flexDirection="row" justifyContent="flex-end" alignItems="flex-start" columnGap={gap} flexShrink={0} {...width}>
      {controls}
    </Box>
  )
}

// A row of the bar or the panel: what it shows, taking the room there is, then its icon column.
function sideRow(ui: Kit, key: string, left: RenderElement | null, right: RenderElement, align: 'flex-start' | 'center' = 'flex-start'): RenderElement {
  const { Box } = ui
  return (
    <Box key={key} flexDirection="row" alignItems={align}>
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        {left}
      </Box>
      {right}
    </Box>
  )
}

// A pane's content beside the scroll-bar gutter: the content takes the room there is, then
// an empty drawing exactly SCROLL_GUTTER px wide keeps the pane's right edge clear. Where
// there is no Svg (the text panel), the content alone, as before.
function withGutter(ui: Kit, key: string, content: RenderElement | RenderElement[]): RenderElement {
  const { Box, Svg } = ui
  if (!Svg) return Array.isArray(content) ? <Box flexDirection="column">{content}</Box> : content
  return (
    <Box key={key} flexDirection="row">
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        {content}
      </Box>
      <Box key="scroll-gutter" flexShrink={0}>
        <Svg source={GUTTER_SOURCE} alt="" width={SCROLL_GUTTER} height={1} />
      </Box>
    </Box>
  )
}

// A pill's hover card: hidden until the pointer is over the pill, drawn above the bar.
// No key: the keyed pill is the hover scope, and a keyed hidden Box would never be hovered.
function tipCard(ui: Kit, tip: { title: string; lines: string[] }): RenderElement {
  const { Box, Text } = ui
  return (
    <Box
      position="absolute"
      bottom={1}
      left={0}
      display="none"
      hover={{ display: 'flex' }}
      flexDirection="column"
      borderStyle="round"
      backgroundColor="background"
      paddingX={1}
    >
      <Text key="tip-title" bold>
        {printable(tip.title)}
      </Text>
      {tip.lines.map((line, i) => (
        <Text key={`tip-${i}`} dimColor>
          {printable(line)}
        </Text>
      ))}
    </Box>
  )
}

// One rounded pill of the bar's info row, its outline and background tinted by its kind
// and tone; its hover card, when it has one, is its last child.
function pill(ui: Kit, key: string, tint: { border: string; back: string }, parts: RenderElement[]): RenderElement {
  const { Box } = ui
  return (
    <Box
      key={key}
      flexDirection="row"
      alignItems="center"
      columnGap={1}
      flexShrink={0}
      paddingX={1}
      paddingY={0}
      borderStyle="round"
      borderColor={tint.border}
      backgroundColor={tint.back}
    >
      {parts}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The bar's pills, as data: each item's drawings and texts, its kind and its tone. What a
// pill says (label, value, detail, tone) is `pillText`'s alone; a null answer leaves the
// pill out. The wiring adds the layout, the meter and icon drawings and the hover card.

type PillKind = 'context' | 'limit' | 'speed' | 'cache' | 'turn' | 'time'
type PillWords = NonNullable<ReturnType<typeof pillText>>
type PillTone = PillWords['tone']
type PillPart = { svg: Drawing } | { text: string; look: 'label' | 'value' | 'detail'; color?: string; isMuted?: boolean }
// What a pill's hover card says: the `tipLines` target and what it reads.
type TipTarget = Parameters<typeof tipLines>[0]
type TipData = Parameters<typeof tipLines>[1]
type PillTip = { target: TipTarget; data: TipData }
type PillSpec = { key: string; kind: PillKind; tone: PillTone; parts: PillPart[]; tip: PillTip }
type PillCtx = { s: Snap; at: number; isNarrow: boolean; isWorking: boolean; scale: number; tzOffsetMin: number }
type TextSize = 'caption' | 'footnote' | 'body'

// The grey of a muted pill's icon (a limit `resetting…`), the paused task row's grey.
const MUTED_ICON = '#9a9a96'
// A tone as the palette and the tints know it: muted has no palette colour of its own.
const gaugeTone = (tone: PillTone): Gauge['tone'] | undefined => (tone === 'calm' || tone === 'warn' || tone === 'alert' ? tone : undefined)
// An icon in a pill that is not a meter: the palette's accent while all is well, else the tone's colour.
const iconColor = (s: Settings, tone: PillTone): string => {
  const t = gaugeTone(tone)
  if (!t) return MUTED_ICON
  const p = paletteOf(s)
  return t === 'calm' ? p.accent : p[t]
}
// A limit's icon: its tone's colour, calm included.
const limitColor = (s: Settings, tone: PillTone): string => {
  const t = gaugeTone(tone)
  return t ? paletteOf(s)[t] : MUTED_ICON
}
const barTextSize = (barSize: number): TextSize => (barSize < 95 ? 'caption' : barSize <= 115 ? 'footnote' : 'body')
// A key built from what the engine names a limit: letters, digits, `_` and `-` only.
const keyPart = (s: string): string => s.replace(/[^\w-]/g, '_')

// One pill before it is drawn: what `pillText` says for it, the gauge its meter shows
// (context and limits), its icon and its hover card's target.
// `isUsageLeft`: the Usage left item, whose hover card says so.
type PillEntry = { key: string; kind: PillKind; words: PillWords; gauge?: Gauge; icon?: PillIcon; tip: TipTarget; isUsageLeft?: boolean }

// `pillText`'s answer for one pill; null (no pill) when it has nothing to say or fails.
function wordsOf(p: PillCtx, kind: PillKind, gauge?: Gauge): PillWords | null {
  try {
    const data = { usage: p.s.usage, main: p.s.main, isWorking: p.isWorking, now: p.at, isNarrow: p.isNarrow }
    const w = pillText(kind, gauge ? { ...data, gauge } : data)
    if (!w || typeof w.value !== 'string') return null
    // The cache countdown in whole minutes until five are left, then `m:ss` (A7); the tone stays.
    const expires = p.s.usage.cacheExpiresAt
    if (kind === 'cache' && typeof expires === 'number' && /^\d+:\d\d$/.test(w.value) && expires > p.at) return { ...w, value: countdownText(expires - p.at) }
    return w
  } catch {
    return null
  }
}

// The pills in `settings.barItems` order (the person's order); an item `pillText` has
// nothing for has none. The limit pills are `barLimitGauges`'s: Usage left holds the
// 5-hour window, else the week, else a model's week, and each window is shown once; one
// whose reset just passed is among them, and `pillText` says `resetting…` or leaves it out.
function pillItems(p: PillCtx): PillEntry[] {
  const items = p.s.settings.barItems
  const limits = barLimitGauges(items, limitGauges(p.s.usage, p.at))
  const out: PillEntry[] = []
  const add = (key: string, kind: PillKind, tip: TipTarget, gauge?: Gauge, icon?: PillIcon, isUsageLeft = false): void => {
    const words = wordsOf(p, kind, gauge)
    if (!words) return
    const x: PillEntry = { key, kind, words, tip }
    if (gauge) x.gauge = gauge
    if (icon) x.icon = icon
    if (isUsageLeft) x.isUsageLeft = true
    out.push(x)
  }
  // A limit pill wears its own window's short name and icon: the week's when Usage left fell back to it.
  const limitIcon = (g: Gauge): PillIcon => (g.kind === 'five_hour' ? 'fiveHour' : 'week')
  for (const item of items) {
    if (item === 'context') add('pill-context', 'context', 'context', contextGauge(p.s.usage))
    else if (item === 'fiveHour') {
      const g = limits.find(x => x.item === 'fiveHour')?.gauge
      if (g) add('pill-fiveHour', 'limit', 'limit', g, limitIcon(g), true)
    } else if (item === 'week') {
      const g = limits.find(x => x.item === 'week')?.gauge
      if (g) add('pill-week', 'limit', 'limit', g, limitIcon(g))
    } else if (item === 'model_week') {
      // One pill per model's weekly window not shown already, and none when there is none.
      for (const { gauge: g } of limits.filter(x => x.item === 'model_week')) add(`pill-model_week-${keyPart(g.kind)}`, 'limit', 'limit', g, limitIcon(g))
    } else if (item === 'speed') add('pill-speed', 'speed', 'speed', undefined, 'speed')
    else if (item === 'cache') add('pill-cache', 'cache', 'cache', undefined, 'cache')
    else if (item === 'turn') add('pill-turn', 'turn', 'turn')
    else if (item === 'time') add('pill-time', 'time', 'clock', undefined, 'time')
  }
  return out
}

// A pill's hover card: `target` read against what the bar shows, and the pill's gauge.
function tipOf(p: PillCtx, target: TipTarget, gauge?: Gauge, isUsageLeft = false): PillTip {
  const { s } = p
  const data: TipData = { usage: s.usage, main: s.main, settings: s.settings, rates: s.rates, now: p.at, tzOffsetMin: p.tzOffsetMin, ...(isUsageLeft ? { isUsageLeft } : {}) }
  return { target, data: gauge ? { ...data, gauge } : data }
}

// The drawn pill: [icon] [label] [meter] value [detail]. A muted value is dim (a muted
// limit, `resetting…`, gets its empty meter from `meterDrawing`); the cache's value takes
// its tone's colour, as in v5.
function pillSpec(p: PillCtx, x: PillEntry): PillSpec {
  const { s } = p
  const w = x.words
  const parts: PillPart[] = []
  if (x.icon) parts.push({ svg: pillIconDrawing(x.icon, x.kind === 'limit' ? limitColor(s.settings, w.tone) : iconColor(s.settings, w.tone), p.scale) })
  if (w.label) parts.push({ text: w.label, look: 'label' })
  if (x.gauge && (x.kind === 'context' || x.kind === 'limit')) parts.push({ svg: meterDrawing(x.gauge, s.settings, s.settings.barUsage, p.scale) })
  const tone = gaugeTone(w.tone)
  const color = x.kind === 'cache' && tone && tone !== 'calm' ? iconColor(s.settings, tone) : undefined
  parts.push(color ? { text: w.value, look: 'value', color } : { text: w.value, look: 'value', isMuted: w.tone === 'muted' })
  if (w.detail) parts.push({ text: w.detail, look: 'detail' })
  return { key: x.key, kind: x.kind, tone: w.tone, parts, tip: tipOf(p, x.tip, x.gauge, x.isUsageLeft === true) }
}

function pillsOf(p: PillCtx): PillSpec[] {
  return pillItems(p).map(x => pillSpec(p, x))
}

function pillParts(ui: SvgKit, spec: PillSpec, size: TextSize): RenderElement[] {
  const { Svg, Text } = ui
  return spec.parts.map((part, i) =>
    'svg' in part ? (
      <Svg key={`${spec.key}-svg-${i}`} source={part.svg.source} alt={printable(part.svg.alt) || 'meter'} width={Math.round(part.svg.width)} height={Math.round(part.svg.height)} />
    ) : (
      <Text size={size} dimColor={part.look !== 'value' || part.isMuted === true} bold={part.look === 'value'} {...(part.color ? { color: part.color } : {})}>
        {printable(part.text)}
      </Text>
    ),
  )
}

// ---------------------------------------------------------------------------
// The bar.

type BarParts = {
  s: Snap
  at: number
  clock: number
  columns: number
  crew: number
  running: number
  isWorking: boolean
  isTips: boolean
  collapse: RenderElement
  panel: RenderElement
}

// The progress row's right part: the panel icon, then the collapse icon at the right end.
function barIcons(ui: Kit, b: BarParts): RenderElement {
  return rightCol(ui, 'bar-icons-progress', BAR_RIGHT, [b.panel, b.collapse], BAR_ICON_GAP)
}

// Collapsed: the expand icon alone, at the right end of a part as wide, so it stays put.
function barIconsCollapsed(ui: Kit, b: BarParts): RenderElement {
  return rightCol(ui, 'bar-icons-collapsed', BAR_RIGHT, [b.collapse], BAR_ICON_GAP)
}

// The pills row, over the bar's full width.
function infoRow(ui: Kit, content: RenderElement): RenderElement {
  const { Box } = ui
  return (
    <Box key="bar-info" flexDirection="column">
      {content}
    </Box>
  )
}

// Expanded, the bar is two rows with a gap between them: the progress row with the two
// icons at its right end, then the pills row.
function barRows(ui: Kit, progress: RenderElement, info: RenderElement): RenderElement {
  const { Box } = ui
  return (
    <Box key="bar-rows" flexDirection="column" rowGap={BAR_ROW_GAP}>
      {progress}
      {info}
    </Box>
  )
}

function barDesktop(ui: SvgKit, b: BarParts): RenderElement {
  const { Box, Svg } = ui
  const { s } = b
  const f = s.flow
  // The bar's own zoom; the icon controls keep their size.
  const zb = s.settings.barSize / 100
  const enterAgeMs = entranceAge(s.settings, s.view.barToggledAt, b.clock)
  const px = Math.max(180, Math.min(1600, ((b.columns || 100) - BAR_PANEL_X) * CELL - CELL))
  const leftW = Math.max(60, Math.floor((px - BAR_RIGHT * CELL) / zb))
  const picture = (key: string, d: Drawing): RenderElement => (
    <Svg key={key} source={d.source} alt={printable(d.alt) || 'bar'} width={Math.round(d.width * zb)} height={Math.round(d.height * zb)} />
  )
  if (s.view.isBarCollapsed) {
    const d = collapsedDrawing({ W: leftW, now: b.at, flow: f, usage: s.usage, main: s.main, settings: s.settings, agentsRunning: b.running, state: s.state, enterAgeMs })
    return sideRow(ui, 'bar-collapsed', picture('collapsed', d), barIconsCollapsed(ui, b))
  }
  // The row tells the task's state (`No task yet`, running, paused, done); its faint
  // layer follows the real running agents, never `flow.running`.
  const d = progressDrawing(f, leftW, s.settings, s.state, b.crew, b.running, enterAgeMs, s.creep ?? undefined, b.clock)
  const progress = sideRow(ui, 'bar-progress', picture('progress', d), barIcons(ui, b))
  const p = pillCtx(b, zb)
  const size = barTextSize(s.settings.barSize)
  const pills = pillsOf(p).map(x => {
    const parts = pillParts(ui, x, size)
    // The hover card comes last, so the pill (its keyed parent) is its hover scope.
    if (b.isTips) parts.push(tipCard(ui, tipLines(x.tip.target, x.tip.data)))
    return pill(ui, x.key, pillTint(x.kind, x.tone, s.settings), parts)
  })
  const band = (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={1}>
      {pills}
    </Box>
  )
  return barRows(ui, progress, infoRow(ui, band))
}

// On the desktop the whole bar, collapsed or expanded, sits on one opaque panel in the
// theme's own dark-on-dark (light-on-light) colour, a real theme key, so a busy backdrop does not show
// through its rows; the pills keep their own tinted fills on top of it.
function barPanel(ui: Kit, content: RenderElement): RenderElement {
  return surfacePanel(ui, 'bar-panel-back', content, 1)
}

// The bar's panel, for anything that sits on it: the rounded border and the theme's
// surface colour. The agents panel's cards use it with no padding, since their drawings
// keep their own inset from the edge.
function surfacePanel(ui: Kit, key: string, content: RenderElement, padX: Space): RenderElement {
  const { Box } = ui
  return (
    <Box key={key} flexDirection="column" borderStyle="round" backgroundColor="inverseText" paddingX={padX}>
      {content}
    </Box>
  )
}

// What the pills read: the bar's clock, its width and whether anything works.
function pillCtx(b: BarParts, scale: number): PillCtx {
  return { s: b.s, at: b.at, isNarrow: b.columns > 0 && b.columns < NARROW_COLUMNS, isWorking: b.isWorking, scale, tzOffsetMin: tzOf(b.clock) }
}

// One pill as text: `5h 7% left`, `#3`.
const pillLine = (w: PillWords): string => [w.label, w.value].filter(t => typeof t === 'string' && t !== '').join(' ')

// The bar's figures as one line, for surfaces without Svg: the pills' own words.
function barText(b: BarParts, isCollapsed: boolean): string {
  const { s } = b
  const items = pillItems(pillCtx(b, 1))
  if (isCollapsed) {
    const n = b.running
    const shown = items.filter(x => x.key === 'pill-context' || x.key === 'pill-fiveHour').map(x => pillLine(x.words))
    return [taskText(s.state, s.flow, s.running, ' '), n ? plural(n, 'agent') : '', ...shown].filter(Boolean).join(' · ')
  }
  return items
    .map(x => pillLine(x.words))
    .filter(Boolean)
    .join(' · ')
}

function barTextRows(ui: Kit, b: BarParts): RenderElement {
  const { Text } = ui
  const { s } = b
  const f = s.flow
  const line = (text: string, isDim = false): RenderElement => (
    <Text dimColor={isDim} wrap="truncate-end">
      {printable(text)}
    </Text>
  )
  if (s.view.isBarCollapsed) return sideRow(ui, 'bar-collapsed', line(barText(b, true)), barIconsCollapsed(ui, b))
  const percent = s.state === 'done' ? 100 : Math.round((s.creep?.start ?? (f ? flowRatio(f) : 0)) * 100)
  const progress =
    f && s.state !== 'none'
      ? line(`${f.title}: ${taskText(s.state, f, s.running)} ${percent}% · ×${b.crew}`, s.state === 'paused')
      : line(`${NO_TASK_YET} · ×0`, true)
  return barRows(ui, sideRow(ui, 'bar-progress', progress, barIcons(ui, b)), infoRow(ui, line(barText(b, false))))
}

// ---------------------------------------------------------------------------
// The agents panel.

// A row's log: the entries, or null for a planned task, which has none yet; `head`, the
// line it opens with (the row's cache figures), when there is one.
type RowLog = { log: LogEntry[] | null; color: string; head?: string }

// Which of the mod's other panes are open, for their icons in the panel's title row.
type PaneFlags = { isSettingsOpen: boolean; isGuideOpen: boolean }

// The title row's icon controls: the guide, the settings, then the compact view; each is
// drawn active while what it opens is open (compact: while the panel is compact).
function titleControls($: EngineInterface, ui: Kit, s: Snap, panes: PaneFlags, opts: IconOpts): RenderElement[] {
  return [
    iconButton(ui, 'open-guide', 'help', panes.isGuideOpen ? 'Close the guide' : 'Open the guide', act($, () => toggleGuide($)), { ...opts, active: panes.isGuideOpen }),
    iconButton(ui, 'open-settings', 'gear', panes.isSettingsOpen ? 'Close the settings' : 'Open the settings', act($, () => toggleSettings($)), {
      ...opts,
      active: panes.isSettingsOpen,
    }),
    iconButton(
      ui,
      'toggle-compact',
      s.view.isCompact ? 'full' : 'compact',
      s.view.isCompact ? 'Show the full panel' : 'Show the compact panel',
      act($, () => toggleView($, 'isCompact')),
      { ...opts, active: s.view.isCompact },
    ),
  ]
}

function agentsDesktop($: EngineInterface, ui: SvgKit, s: Snap, columns: number, clock: number, panes: PaneFlags): RenderElement {
  const { Box, Text, Svg } = ui
  const z = s.settings.textSize / 100
  const cols = columns || 41
  // The drawings' room: the pane less a cell of slack and the scroll-bar gutter at its right.
  const px = Math.max(160, cols * CELL - CELL) - SCROLL_GUTTER
  const at = Math.max(s.at, clock)
  const tz = tzOf(clock)
  const paneAge = entranceAge(s.settings, s.view.paneOpenedAt, clock)
  // Its times run on the real clock while nothing works, when the stored one stands still.
  const ctx: Ctx = { W: Math.floor(px / z), now: at, settings: s.settings, rates: s.rates, tzOffsetMin: tz, enterAgeMs: paneAge }
  // Rows leave room at their right for the icon column; the title for its three icons.
  const rowCtx: Ctx = { ...ctx, W: Math.max(120, Math.floor((px - PANEL_COL * CELL) / z)) }
  const titleCtx: Ctx = { ...ctx, W: Math.max(80, Math.floor((px - TITLE_COL * CELL) / z)) }
  // The card, Normal or compact, sits on the bar's panel across the pane, inside its border.
  const cardCtx: Ctx = { ...ctx, W: Math.max(120, Math.floor((px - CARD_PANEL_X * CELL) / z)) }
  // What the pane's drawings come to so far, against PANE_BUDGET.
  let spent = 0
  const picture = (key: string, d: Drawing): RenderElement => {
    spent += d.source.length
    return <Svg key={key} source={d.source} alt={printable(d.alt) || 'drawing'} width={Math.round(d.width * z)} height={Math.round(d.height * z)} />
  }
  const fits = (cost: number): boolean => spent + cost <= PANE_BUDGET
  // Tiles, meters and rows are plain drawings: no hover cards.
  const item = (key: string, d: Drawing): RenderElement => picture(key, d)
  const sorted = sortAgents(s.list)
  const planned = plannedOf(s.plan, s.list)
  const t = totals(s.main, s.list, s.usage, at, s.retired)
  const flowTitle = s.flow && !s.flow.isFinished ? s.flow.title : ''
  // With no plan on, the title drawing says `No task yet`, muted.
  const titleD = titleDrawing(titleCtx, flowTitle)
  const icons = rightCol(ui, 'title-icons', TITLE_COL, titleControls($, ui, s, panes, PANEL_ICON), TITLE_ICON_GAP)
  const top = sideRow(ui, 'title-row', picture('title', titleD), icons)

  // An agent's entrance: the pane's, or its own start when that is later.
  const enterOf = (a: AgentRun): number | undefined => youngest(paneAge, entranceAge(s.settings, a.startedAt, clock))

  // The backdrop, drawn under everything when it is not plain: its tiles count against the
  // budget too, one per 4096 px of height, so each row is costed with its share of them.
  const isPlain = s.settings.background === 'plain'
  const backKind = s.settings.background === 'grid' ? 'grid' : 'dots'
  const backW = Math.ceil((cols * CELL) / z)
  const maxTile = Math.floor(4096 / Math.max(1, z))
  const tileCost = isPlain || s.view.isCompact ? 0 : backdropDrawing(backKind, backW, maxTile).source.length
  const backShare = (h: number): number => (tileCost ? Math.ceil((Math.max(0, h) * tileCost) / maxTile) : 0)

  // One row of the panel's ordered rows: its id and section, what it costs (its drawings
  // and their share of the backdrop, drawn once and kept) and how it is put on the page.
  type Unit = { id: string; section: string; cost: () => number; put: () => void }
  type Paged = { rows: Unit[]; page: number; before: number; after: number; prevFirst: string; nextFirst: string }
  // The page of `units` the view names (`rowPages`, within what PANE_BUDGET leaves after
  // the drawings so far and `reserve`): the page that holds the row the view follows, else
  // its page number clamped to the pages there are (`anchoredPage`). Rows are costed
  // lazily: only the shortest run of them that holds the page whole.
  const paged = (units: Unit[], reserve: number): Paged => {
    const budget = PANE_BUDGET - spent - reserve
    const costOf = (u: Unit): number => u.cost()
    const pageAt = (p: number): RowPages<Unit> => {
      for (let n = Math.min(units.length, 16); ; n = Math.min(units.length, n * 2)) {
        const r = rowPages(units.slice(0, n), costOf, budget, p)
        if ((r.page === p && r.page < r.count - 1) || n >= units.length) return r
      }
    }
    const kept = s.view.rowPage
    const at = kept ? units.findIndex(u => u.id === kept.first) : -1
    // The pages up to the row followed (its page is the last of them), else up to the kept number.
    const head = at >= 0 ? rowPages(units.slice(0, at + 1), costOf, budget).pages : kept ? pageAt(kept.n).pages : []
    const r = pageAt(anchoredPage(head, (u: Unit) => u.id, kept))
    const after = units.length - r.before - r.rows.length
    return { rows: r.rows, page: r.page, before: r.before, after, prevFirst: r.pages[r.page - 1]?.[0]?.id ?? '', nextFirst: units[r.before + r.rows.length]?.id ?? '' }
  }
  // A row the budget cannot take even alone: a short line in its place.
  const tooLarge = (id: string): RenderElement => (
    <Box key={`too-large-${id}`} paddingX={1}>
      <Text dimColor>This row is too large to draw here.</Text>
    </Box>
  )
  // The line at the foot of the rows: which show and of how many, then Previous and Next.
  // A control with nothing to go to leaves its place empty, so the other stays put.
  const pageFoot = (key: string, pg: Paged, total: number): RenderElement => {
    const gap = (side: string): RenderElement => iconGap(ui, `${key}-${side}-gap`, PANEL_ICON)
    const prev = pg.before > 0 ? iconButton(ui, `${key}-prev`, 'prev', 'Show the earlier rows', act($, () => setRowPage($, pg.page - 1, pg.prevFirst)), PANEL_ICON) : gap('prev')
    const next = pg.after > 0 ? iconButton(ui, `${key}-next`, 'next', 'Show the later rows', act($, () => setRowPage($, pg.page + 1, pg.nextFirst)), PANEL_ICON) : gap('next')
    const words = `Rows ${pg.before + 1}–${pg.before + pg.rows.length} of ${total}`
    return sideRow(
      ui,
      `${key}-pages`,
      <Box paddingX={1}>
        <Text dimColor>{words}</Text>
      </Box>,
      rightCol(ui, `${key}-page-icons`, PAGE_COL, [prev, next], 1),
      'center',
    )
  }

  if (s.view.isCompact) {
    // The small card, one line for the main agent and each agent at work, a page at a
    // time within the drawing budget, then the counts.
    const failed = sorted.finished.filter(a => a.status === 'failed').length
    const head = [
      top,
      surfacePanel(ui, 'compact-card-back', picture('compact-card', compactCardDrawing(cardCtx, t, s.usage)), 0),
      picture('compact-main', compactMainDrawing({ ...ctx, clock }, s.main, s.flow, s.running)),
    ]
    const foot = planned.length || sorted.finished.length ? [picture('compact-foot', compactFootDrawing(ctx, planned.length, sorted.finished.length, failed))] : []
    const lines: RenderElement[] = []
    const units: Unit[] = [...sorted.working, ...sorted.waiting].map(a => {
      let d: Drawing | null = null
      const make = (): Drawing => (d ??= compactAgentDrawing({ ...ctx, enterAgeMs: enterOf(a), clock }, a))
      return {
        id: a.id,
        section: 'work',
        cost: () => make().source.length,
        put: () => {
          const m = make()
          lines.push(fits(m.source.length) ? picture(`compact-${a.id}`, m) : tooLarge(a.id))
        },
      }
    })
    const pg = paged(units, 0)
    for (const u of pg.rows) u.put()
    const pages = pg.before || pg.after ? [pageFoot('compact', pg, units.length)] : []
    return withGutter(ui, 'agents-gutter', [...head, ...lines, ...pages, ...foot])
  }

  // Everything is laid over the backdrop, which is as tall as what it holds.
  let height = Math.max(titleD.height, BTN_ROW_H / z)
  const parts: RenderElement[] = [top]
  const heading = (key: string, d: Drawing): void => {
    height += d.height
    parts.push(picture(`h-${key}`, d))
  }
  // A row: its drawing and its log icon; with the log open, the log under it and a copy
  // icon. Its drawings are made once, for its cost and for its place on the page.
  const rowUnit = (id: string, section: string, draw: () => Drawing, rowLog: RowLog): Unit => {
    const isOpen = s.view.openLogs.includes(id)
    const entries = rowLog.log ?? []
    const hasLog = isOpen && (entries.length > 0 || !!rowLog.head)
    let made: { d: Drawing; ld: Drawing | null } | null = null
    const make = (): { d: Drawing; ld: Drawing | null } => (made ??= { d: draw(), ld: hasLog ? logDrawing(rowCtx, entries, rowLog.color, rowLog.head) : null })
    const cost = (): number => {
      const m = make()
      const h = Math.max(m.d.height, BTN_ROW_H / z) + (m.ld ? Math.max(m.ld.height, BTN_ROW_H / z) : isOpen ? BTN_ROW_H / z : 0)
      return m.d.source.length + (m.ld?.source.length ?? 0) + backShare(h)
    }
    const put = (): void => {
      const { d, ld } = make()
      if (!fits(d.source.length + (ld?.source.length ?? 0))) {
        height += BTN_ROW_H / z
        parts.push(tooLarge(id))
        return
      }
      const icon = iconButton(ui, `log-${id}`, isOpen ? 'logOpen' : 'log', isOpen ? 'Hide the log' : 'Show the log', act($, () => toggleLog($, id)), { ...PANEL_ICON, active: isOpen })
      height += Math.max(d.height, BTN_ROW_H / z)
      parts.push(sideRow(ui, `line-${id}`, item(`row-${id}`, d), rightCol(ui, `icons-${id}`, PANEL_COL, [icon])))
      if (!isOpen) return
      if (!ld) {
        height += BTN_ROW_H / z
        parts.push(
          <Box key={`log-row-${id}`} paddingX={1}>
            <Text dimColor>{rowLog.log === null ? 'Not started yet.' : 'No activity yet.'}</Text>
          </Box>,
        )
        return
      }
      const copy = entries.length ? [iconButton(ui, `copy-${id}`, 'copy', 'Copy the log', press => copyLog($, logText(entries, tz), press).catch(() => undefined), PANEL_ICON)] : []
      height += Math.max(ld.height, BTN_ROW_H / z)
      parts.push(sideRow(ui, `log-row-${id}`, picture(`log-svg-${id}`, ld), rightCol(ui, `log-icons-${id}`, PANEL_COL, copy)))
    }
    return { id, section, cost, put }
  }
  // The clock sets a row's loops; the drawing uses it only while the row works or waits.
  const agentUnit =
    (section: string) =>
    (a: AgentRun): Unit =>
      rowUnit(a.id, section, () => agentDrawing({ ...rowCtx, enterAgeMs: enterOf(a), clock }, a), { log: a.log, color: agentColor(a), head: cacheLine(a.use) })

  // The session card: the Session and Plan groups and the usage split, one drawing on the bar's panel across the pane.
  const card = sessionCardDrawing(cardCtx, { main: s.main, agents: s.list, retired: s.retired, usage: s.usage, totals: t, workedMs: mainWorkedMs(s.main, s.at), ...(appPlanNow ? { plan: appPlanNow } : {}) })
  height += card.height + CARD_PANEL_H / z
  parts.push(surfacePanel(ui, 'session-card-back', item('session-card', card), 0))

  heading('main', sectionDrawing(ctx, 'Main agent'))
  // The main row's strip shows the plan and how far it got.
  rowUnit('main', 'main', () => mainDrawing({ ...rowCtx, clock }, s.main, s.running, s.usage, s.flow, s.creep?.start, sorted.waiting.length), {
    log: s.main.log,
    color: paletteOf(s.settings).accent,
    head: cacheLine(s.main.use),
  }).put()

  // The panel's ordered rows, a page at a time; a folded Finished takes none. Each
  // section's heading counts every agent in it and shows with its rows on the page.
  const isFolded = s.view.isDoneCollapsed
  const sections = [
    { key: 'working', text: 'Working', count: sorted.working.length, units: sorted.working.map(agentUnit('working')) },
    { key: 'waiting', text: 'Waiting', count: sorted.waiting.length, units: sorted.waiting.map(agentUnit('waiting')) },
    {
      key: 'planned',
      text: 'Planned',
      count: planned.length,
      units: planned.map(p => rowUnit(`plan-${p.n}`, 'planned', () => plannedDrawing(rowCtx, p), { log: null, color: taskColor(p) })),
    },
    { key: 'finished', text: 'Finished', count: sorted.finished.length, units: isFolded ? [] : sorted.finished.map(agentUnit('finished')) },
  ]
  const heads = new Map(sections.filter(x => x.count).map(x => [x.key, sectionDrawing(x.key === 'finished' ? rowCtx : ctx, x.text, x.count)] as const))
  // Kept back from the rows: every heading, and the backdrop's tiles for what is above them and one more.
  const reserve = [...heads.values()].reduce((n, d) => n + d.source.length, 0) + backShare(height) + 2 * tileCost
  const units = sections.flatMap(x => x.units)
  const pg = paged(units, reserve)
  for (const x of sections) {
    const rows = pg.rows.filter(u => u.section === x.key)
    const d = heads.get(x.key)
    if (!d) continue
    if (x.key === 'finished') {
      // Its heading holds the fold: shown with its rows, and while folded.
      if (!rows.length && !isFolded) continue
      const fold = iconButton(
        ui,
        'toggle-done',
        isFolded ? 'unfold' : 'fold',
        isFolded ? 'Show the finished agents' : 'Hide the finished agents',
        act($, () => toggleView($, 'isDoneCollapsed')),
        PANEL_ICON,
      )
      height += Math.max(d.height, BTN_ROW_H / z)
      parts.push(sideRow(ui, 'finished-heading', picture('h-finished', d), rightCol(ui, 'finished-icons', PANEL_COL, [fold]), 'center'))
    } else {
      if (!rows.length) continue
      heading(x.key, d)
    }
    for (const u of rows) u.put()
  }
  if (pg.before || pg.after) {
    height += BTN_ROW_H / z
    parts.push(pageFoot('rows', pg, units.length))
  }

  if (isPlain) return withGutter(ui, 'agents-gutter', parts)
  // The backdrop spans the pane's whole body, edge to edge; an Svg is at most 4096 px
  // tall on screen, so it is stacked in tiles.
  const strips: number[] = []
  for (let left = Math.ceil(height + BTN_ROW_H / z); left > 0; left -= maxTile) strips.push(Math.min(maxTile, left))
  return (
    <Box flexDirection="column">
      {strips.map((h, i) => picture(`back-${i}`, backdropDrawing(backKind, backW, h)))}
      <Box flexDirection="column" position="absolute" top={0} left={0} right={0}>
        {withGutter(ui, 'agents-gutter', parts)}
      </Box>
    </Box>
  )
}

// Surfaces without Svg: the same figures as short text rows.
function agentsText($: EngineInterface, ui: Kit, s: Snap, clock: number, panes: PaneFlags): RenderElement {
  const { Box, Text } = ui
  const tz = tzOf(clock)
  const t = totals(s.main, s.list, s.usage, Math.max(s.at, clock), s.retired)
  const title = s.flow && !s.flow.isFinished ? `${s.flow.title} · ${taskText(s.state, s.flow, s.running)}` : ''
  const sorted = sortAgents(s.list)
  const planned: Planned[] = plannedOf(s.plan, s.list)
  const summary = `${moneyText(t.costUsd, s, t.isEstimate)} · ${fmtTokens(t.tokens)} tokens · ${fmtTime(t.timeMs)}`
  // Where the tokens went, once there are any: `Router 38% · Subagents 62%`.
  const shares = splitShares(usageSplit(s.main, s.list, s.retired))
  const icon = { padX: 0, marginY: 0 }
  const titleText = title ? (
    <Text bold wrap="wrap">
      {printable(title)}
    </Text>
  ) : (
    <Text dimColor wrap="wrap">
      {NO_TASK}
    </Text>
  )
  const top = sideRow(ui, 'title-row', titleText, rightCol(ui, 'title-icons', TITLE_COL, titleControls($, ui, s, panes, icon), TITLE_ICON_GAP))
  const heading = (text: string, count?: number): RenderElement => (
    <Text bold wrap="truncate-end">{`${text.toUpperCase()}${count === undefined ? '' : ` · ${count}`}`}</Text>
  )
  // A row and its log icon; with the log open, its last entries under it and a copy icon.
  const line = (id: string, text: string, rowLog: LogEntry[] | null, isDim = false): RenderElement => {
    const isOpen = s.view.openLogs.includes(id)
    const logIcon = iconButton(ui, `log-${id}`, isOpen ? 'logOpen' : 'log', isOpen ? 'Hide the log' : 'Show the log', act($, () => toggleLog($, id)), { ...icon, active: isOpen })
    const head = sideRow(
      ui,
      `line-${id}`,
      <Text dimColor={isDim} wrap="wrap">
        {printable(text)}
      </Text>,
      rightCol(ui, `icons-${id}`, PANEL_COL, [logIcon]),
    )
    if (!isOpen) return head
    const entries = rowLog ?? []
    const shown = entries.slice(-s.settings.logLines)
    const body = shown.length
      ? shown.map(x => (
          <Text dimColor wrap="wrap">
            {logText([x], tz)}
          </Text>
        ))
      : [<Text dimColor>{rowLog === null ? 'Not started yet.' : 'No activity yet.'}</Text>]
    const copy = entries.length ? [iconButton(ui, `copy-${id}`, 'copy', 'Copy the log', press => copyLog($, logText(entries, tz), press).catch(() => undefined), icon)] : []
    return (
      <Box key={`entry-${id}`} flexDirection="column">
        {head}
        {sideRow(
          ui,
          `log-row-${id}`,
          <Box flexDirection="column" paddingLeft={2}>
            {body}
          </Box>,
          rightCol(ui, `log-icons-${id}`, PANEL_COL, copy),
        )}
      </Box>
    )
  }
  const m = s.main
  const mainLine = `Claude · ${m.status} · ${printable(m.doing) || (m.status === 'resting' ? 'Resting' : 'Working')}`
  const runLine = (a: AgentRun): string =>
    `${STATUS_GLYPHS[a.status]} ${a.description || a.type} · ${agentLabel(a)} · ${a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal} · ` : ''}${a.doing}` +
    ` · ${fmtTokens(useTotal(a.use))} tokens · ≈${money(a.costUsd, s.settings, s.rates)} · ${fmtTime(elapsed(a, s.at))}`
  // The same drawing budget as the desktop panel: a cut section ends with `+N more`.
  const [workingRows, waitingRows, plannedRows, finishedRows] = drawnRows<AgentRun | Planned>([
    sorted.working,
    sorted.waiting,
    planned,
    s.view.isDoneCollapsed ? [] : sorted.finished,
  ])
  const moreText = (key: string, n: number | undefined): RenderElement | null =>
    n ? (
      <Text key={`more-${key}`} dimColor>
        {moreLine(n)}
      </Text>
    ) : null
  const runs = (text: string, list: AgentRun[], drawn: { shown: (AgentRun | Planned)[]; more: number } | undefined): RenderElement | null =>
    list.length ? (
      <Box key={`sec-${text}`} flexDirection="column">
        {heading(text, list.length)}
        {((drawn?.shown ?? []) as AgentRun[]).map(a => line(a.id, runLine(a), a.log))}
        {moreText(text.toLowerCase(), drawn?.more)}
      </Box>
    ) : null
  const fold = iconButton(
    ui,
    'toggle-done',
    s.view.isDoneCollapsed ? 'unfold' : 'fold',
    s.view.isDoneCollapsed ? 'Show the finished agents' : 'Hide the finished agents',
    act($, () => toggleView($, 'isDoneCollapsed')),
    icon,
  )
  return (
    <Box flexDirection="column">
      {top}
      <Text dimColor wrap="wrap">
        {summary}
      </Text>
      {shares ? (
        <Text dimColor wrap="wrap">
          {`Router ${shares.router}% · Subagents ${shares.agents}%`}
        </Text>
      ) : null}
      {s.view.isCompact ? (
        <Text wrap="wrap">{`${mainLine} · ${plural(s.list.filter(isActive).length, 'agent')} running`}</Text>
      ) : (
        <Box flexDirection="column">
          {heading('Main agent')}
          {line('main', mainLine, m.log)}
          {runs('Working', sorted.working, workingRows)}
          {runs('Waiting', sorted.waiting, waitingRows)}
          {planned.length ? (
            <Box key="sec-planned" flexDirection="column">
              {heading('Planned', planned.length)}
              {((plannedRows?.shown ?? []) as Planned[]).map(p => line(`plan-${p.n}`, `◷ ${p.n}. ${p.title}`, null, true))}
              {moreText('planned', plannedRows?.more)}
            </Box>
          ) : null}
          {sorted.finished.length ? (
            <Box key="sec-finished" flexDirection="column">
              {sideRow(ui, 'finished-heading', heading('Finished', sorted.finished.length), rightCol(ui, 'finished-icons', PANEL_COL, [fold]))}
              {s.view.isDoneCollapsed ? null : ((finishedRows?.shown ?? []) as AgentRun[]).map(a => line(a.id, runLine(a), a.log))}
              {s.view.isDoneCollapsed ? null : moreText('finished', finishedRows?.more)}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function moneyText(usd: number, s: Snap, isEstimate: boolean): string {
  return `${isEstimate ? '≈' : ''}${money(usd, s.settings, s.rates)}`
}

async function copyLog($: EngineInterface, text: string, press: UiPressArgument): Promise<void> {
  await $.ui.copy({ text, surface: press.surface })
}

// ---------------------------------------------------------------------------
// The settings pane: the four sizes, each with `−` / `+` steppers that save at once, then
// the bar items' order with `▲` / `▼` per item. Everything else is on the desktop app's
// plugin screen and is not repeated here.

type Stepper = { key: keyof Sizes; name: string; shown: (s: Sizes) => string }

const STEPPERS: readonly Stepper[] = [
  { key: 'textSize', name: 'Panel text', shown: s => `${s.textSize}%` },
  { key: 'iconSize', name: 'Mascots', shown: s => `${s.iconSize}%` },
  { key: 'barSize', name: 'Bar', shown: s => `${s.barSize}%` },
  { key: 'logLines', name: 'Log lines', shown: s => String(s.logLines) },
]
// The width of a stepper's name and of its value, in cells, so the steppers line up.
const STEPPER_NAME = 12
const STEPPER_VALUE = 6
// The width of a bar item's name in the order rows (`Model weekly limit` and a cell).
const ORDER_NAME = 20

function settingsPane($: EngineInterface, ui: Kit, s: Settings, order: readonly BarItem[]): RenderElement {
  const { Box, Text } = ui
  const sizes = sizesOf(s)
  // `Context   [ ▲ ]  [ ▼ ]`: muted when the item is switched off on the plugin screen.
  const orderRow = (item: BarItem): RenderElement => (
    <Box key={`order-${item}`} flexDirection="row" alignItems="center">
      <Box width={ORDER_NAME} flexShrink={0}>
        <Text dimColor={!s.barItems.includes(item)}>{BAR_ITEMS.find(b => b.key === item)?.label ?? item}</Text>
      </Box>
      {button(ui, `up-${item}`, '▲', act($, () => moveItem($, item, -1)))}
      {button(ui, `down-${item}`, '▼', act($, () => moveItem($, item, 1)))}
    </Box>
  )
  // `Panel text   [ − ]  100%  [ + ]`: each press steps the sizes as they are at the press.
  const stepper = (x: Stepper): RenderElement => (
    <Box key={`step-${x.key}`} flexDirection="row" alignItems="center">
      <Box width={STEPPER_NAME} flexShrink={0}>
        <Text>{x.name}</Text>
      </Box>
      {button(ui, `size-${x.key}-down`, '−', act($, () => stepSize($, x.key, -1)))}
      <Box width={STEPPER_VALUE} flexShrink={0} justifyContent="center">
        <Text tabular>{x.shown(sizes)}</Text>
      </Box>
      {button(ui, `size-${x.key}-up`, '+', act($, () => stepSize($, x.key, 1)))}
    </Box>
  )
  return withGutter(
    ui,
    'settings-gutter',
    <Box flexDirection="column" paddingX={1}>
      <Text size="heading" weight="semibold">
        Sizes
      </Text>
      <Text dimColor wrap="wrap">
        Sizes are set here. Each press saves at once.
      </Text>
      {STEPPERS.map(stepper)}
      <Text size="heading" weight="semibold">
        Look
      </Text>
      <Text dimColor wrap="wrap">
        A glass card behind each mascot in the panel.
      </Text>
      <Box key="hero-row" flexDirection="row" alignItems="center">
        <Box width={STEPPER_NAME} flexShrink={0}>
          <Text>Hero cards</Text>
        </Box>
        {button(ui, 'hero-card', s.heroCard ? 'On' : 'Off', act($, () => flipHero($)))}
      </Box>
      <Text size="heading" weight="semibold">
        Bar items order
      </Text>
      <Text dimColor wrap="wrap">
        {'The order of the items on the bar. Switch items on or off under Customize > Plugins > CPixelCrew.'}
      </Text>
      {order.map(orderRow)}
      <Text dimColor wrap="wrap">
        {'Everything else is under Customize > Plugins > CPixelCrew.'}
      </Text>
    </Box>,
  )
}

// ---------------------------------------------------------------------------
// Render hooks.

// Which of the mod's other panes are open, read once.
async function paneFlags($: EngineInterface): Promise<PaneFlags> {
  const ids = await $.ui
    .panes()
    .then(list => new Set(list.map(p => p.id)))
    .catch(() => new Set<string>())
  return { isSettingsOpen: ids.has(SETTINGS_PANE), isGuideOpen: ids.has(GUIDE_PANE) }
}

// What every render does first: the clock, this load's sizes, and its one `afterLoad`.
async function beforeRender($: EngineInterface): Promise<void> {
  ensureTicker($)
  kickAfterLoad($)
  await loadSizes($)
}

async function renderAgents($: EngineInterface, e: Parameters<PaneHook>[1]) {
  await beforeRender($)
  const ui = $.ui.resolve(e)
  // The pane's frame alone (A4); entrances and loops run on the clock as it draws.
  const { s } = await drawnSnap($, 'pane')
  const clock = await clockOf($, s)
  const panes = await paneFlags($)
  const { Box, Text, Button } = ui
  if (e.surface === 'desktop' && 'Svg' in ui) return agentsDesktop($, { Box, Text, Button, Svg: ui.Svg }, s, e.props.bodyColumns, clock, panes)
  return agentsText($, { Box, Text, Button }, s, clock, panes)
}

async function renderSettings($: EngineInterface, e: Parameters<SettingsHook>[1]) {
  await beforeRender($)
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  // The desktop keeps the scroll-bar gutter at the pane's right edge, as the agents panel does.
  const kit: Kit = e.surface === 'desktop' && 'Svg' in ui ? { Box, Text, Button, Svg: ui.Svg } : { Box, Text, Button }
  return settingsPane($, kit, settingsNow(), orderNow)
}

async function renderGuide($: EngineInterface, e: Parameters<GuideHook>[1]) {
  await beforeRender($)
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Markdown } = ui
  const body = (
    <Box flexDirection="column" paddingX={1}>
      <Markdown key="guide" text={GUIDE_MD} />
    </Box>
  )
  // The desktop keeps the scroll-bar gutter at the pane's right edge, as the agents panel does.
  return e.surface === 'desktop' && 'Svg' in ui ? withGutter({ Box, Text, Button, Svg: ui.Svg }, 'guide-gutter', body) : body
}

async function renderBar($: EngineInterface, e: Parameters<BarHook>[1], next: Parameters<BarHook>[2]) {
  if (e.props.hasSurvey) return next(e)
  await beforeRender($)
  // The bar's frame alone (A4): its times are the frame's, so they step together (A7).
  const { s, frameClock } = await drawnSnap($, 'bar')
  // This row is drawn with the other mods' bands beneath it. Claude Code's own
  // placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
  const drawn = await Promise.resolve(next(e)).catch(() => null)
  const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const isDesktop = e.surface === 'desktop' && 'Svg' in ui
  const kit: Kit = isDesktop ? { Box, Text, Button, Svg: ui.Svg } : { Box, Text, Button }
  // Entrances and loops run on the clock as it draws.
  const clock = await clockOf($, s)
  const running = s.running
  const isCollapsed = s.view.isBarCollapsed
  const isPaneOpen = await isOpenPane($, PANE)
  const iconOpts: IconOpts = { padX: ICON_PAD, marginY: 0 }
  const b: BarParts = {
    s,
    at: Math.max(s.at, frameClock),
    clock,
    columns: e.props.bodyColumns,
    // A plan counts its agents and planned tasks, a run its agents, the idle row none: `×0`.
    crew: s.crew,
    running,
    isWorking: s.main.status === 'working' || running > 0,
    // Hover cards on the pills: the desktop only, and only with the option on.
    isTips: isDesktop && s.settings.barTooltips,
    collapse: iconButton(kit, 'bar-collapse', isCollapsed ? 'expand' : 'collapse', isCollapsed ? 'Expand the bar' : 'Collapse the bar', act($, () => toggleBar($)), iconOpts),
    panel: iconButton(kit, 'bar-panel', isPaneOpen ? 'panelOpen' : 'panel', isPaneOpen ? 'Close the agents panel' : 'Open the agents panel', act($, () => togglePane($)), {
      ...iconOpts,
      active: isPaneOpen,
    }),
  }
  // The terminal has nothing behind its band, so its rows stay as they are, with no panel.
  const bar = isDesktop && kit.Svg ? barPanel(kit, barDesktop({ ...kit, Svg: kit.Svg }, b)) : barTextRows(kit, b)
  return (
    <Box flexDirection="column">
      {bar}
      {below}
    </Box>
  )
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  optionsNow = options
  // A load starts with nothing read or written yet: its sizes and bar order, its one
  // `afterLoad`, its copy of the reset flag, and the app's windows are this load's own.
  sizesNow = { ...DEFAULT_SIZES }
  sizesLoaded = false
  sizesLoading = null
  orderNow = [...DEFAULT_BAR_ORDER]
  orderLoaded = false
  heroNow = true
  heroLoaded = false
  afterLoadStarted = false
  mirrorsStopped = false
  resettingNow = false
  resetWritten = false
  mirrorsWritten.clear()
  appLimitsNow = []
  appPlanNow = undefined
  appFails = 0
  appAt = 0
  appBusy = false
  on('session.start', onSessionStart)
  on('classic.SessionStart', onClassicSessionStart)
  on('ui.close', { id: PANE }, onPaneClose)
  on('command.run', { command: 'crew' }, onCommand)
  on('tool.call', { tool: 'mcp__CPixelCrew__progress' }, onProgress)
  on('tool.call', { tool: 'mcp__CPixelCrew__step' }, onStep)
  on('tool.call', AGENT_TOOL_MATCH, onAgentTool)
  on('tool.call', onToolCall)
  on('classic.PermissionRequest', onPermissionRequest)
  on('agent.spawn', onAgentSpawn)
  on('prompt.submit', onPromptSubmit)
  on('turn.start', onTurnStart)
  on('turn.step', onTurnStep)
  on('turn.complete', onTurnComplete)
  on('session.measure', onMeasure)
  on('ui.render', PANE_MATCH, renderAgents)
  on('ui.render', SETTINGS_MATCH, renderSettings)
  on('ui.render', GUIDE_MATCH, renderGuide)
  on('ui.render', BAR_MATCH, renderBar)
}

// ---------------------------------------------------------------------------
// The guide pane's text: short, what the commands and the icons do.

const GUIDE_MD = `## Run a plan

- Any orchestrator can report a plan through the \`progress\` tool, and the plan then shows in the panel. The panel and the bar work with no orchestrator installed.

## Commands

- \`/crew\` shows or hides the agents panel; \`/crew open\` opens it.
- \`/crew bar\` collapses or expands the bar above the prompt.
- \`/crew settings\` shows or hides the settings pane, where the sizes and the bar's order are set.
- \`/crew guide\` shows or hides this guide.
- \`/crew set <key> <value>\` changes one setting, for example \`/crew set theme cat\`.
- \`/crew reset\` puts every setting, size and the bar's order back to its default.

## Panel and bar

- Help, at the top right of the panel, opens this guide; settings (the gear) opens the settings pane.
- Compact shrinks the panel to a card with the session's figures, one line for Claude and each working or waiting agent, and a line with the planned and finished counts; press it again for the full panel. The panel keeps the mode you left it in, the next session too.
- Log, at the right of an agent's row, opens that agent's log under the row; copy, beside an open log, copies the whole log.
- Fold, at the Finished heading, hides the finished agents and shows them again.
- When the rows do not all fit, the line under them says which show and of how many; Previous and Next, at its right, move through them.
- The session card has two groups: Session (cost, tokens, time and context) and Plan, with your plan's name and what is left of each of its usage windows.
- Usage left, on the bar, shows the 5-hour window when your plan has one, else the weekly window.
- Panel, at the right of the bar's progress row, shows or hides the agents panel.
- Collapse, at the far right beside it, folds the bar to one line and back.

## Settings

- The choices and toggles are in the desktop app under Customize > Plugins > CPixelCrew.
- The sizes (panel text, mascots, bar, log lines) and the order of the bar's items are set in the Crew settings pane; that screen only shows the sizes.
- To start over, type \`/crew reset\`.
`
