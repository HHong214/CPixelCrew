// pixel-crew: the state contract. Every value the mod keeps in `$.state` is
// declared here; hooks/*.ts import their value types from this file.

export type Phase = 'research' | 'ask' | 'plan' | 'design' | 'delegate' | 'review' | 'close'

/** The kind of work a subagent does: it picks the costume, the label and the base colour (see KINDS in hooks/model.ts). */
export type Kind = 'search' | 'analyze' | 'build' | 'refactor' | 'quick' | 'debug' | 'test' | 'review' | 'design' | 'write' | 'plan' | 'hard' | 'other'

export type PlannedTask = {
  title: string
  /** The kind of work planned for the task, '' when the plan named none. */
  kind: Kind | ''
  /** The model and effort planned for it as reported (`opus`, `high`), '' when not given. */
  model: string
  effort: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
  /** What the count counts, set only on the synthetic flow of a run with no plan (`Agents`): its label is `Agents d/n` in every state. */
  unit?: string
  /** When the orchestrator last reported this plan through the `progress` tool, or it finished by itself; a plan nobody reports for long stops being shown. */
  reportedAt?: number
  /** When this plan was first reported: it names the plan, so another plan of the same title and task count is told apart (the fill's mark). */
  startedAt?: number
  /** Set when the plan finished by itself (every task's latest run done) rather than by a report: the `done` and `phase` it had before, which a reopening brings back. */
  settled?: { done: number; phase: Phase }
}

/**
 * A run: the subagents started from the first one after the previous run ended, until a
 * person's prompt arrives while none of them is active. With no plan on, the bar counts it.
 */
export type Run = {
  startedAt: number
  /** The `AgentRun.id`s that joined it, in order. */
  ids: string[]
  /** The fill the bar has shown, 0 to 1: it never moves back while the agent count stays. */
  high: number
  /** What `high` was measured against (the view and its count); another key starts it afresh. */
  highKey?: string
  /** When the latest agent joined: a prompt that read the agent list before then leaves the run open. */
  joinedAt?: number
  /** The ids counted stuck at the last mark: one that works again starts the mark afresh. */
  quiet?: string[]
  /** Set once a person's prompt found none of its agents active; the run stays shown until the next one. */
  endedAt?: number
}

/** Tokens by kind, summed over an agent's model requests. */
export type TokenUse = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** The model families usage is counted by. */
export type ModelFamily = 'Fable' | 'Opus' | 'Sonnet' | 'Haiku' | 'other'

/** Tokens and list-price cost, summed. */
export type Spent = { use: TokenUse; costUsd: number }

/**
 * What the agent rows no longer in the list had spent: a row pruned by a new plan or
 * evicted by the row cap adds its tokens and cost here, so the session's totals never go
 * down. Older state has none: it reads as zero.
 */
export type Retired = Spent & {
  /** The same, by the family of each row's model. */
  byFamily: Partial<Record<ModelFamily, Spent>>
}

export type LogKind = 'turn' | 'tool' | 'think' | 'reply' | 'step' | 'wait' | 'end' | 'note'
/** `open`: still running; closed with the real outcome when it ends. */
export type LogOutcome = 'ok' | 'error' | 'denied' | 'open'

export type LogEntry = {
  at: number
  kind: LogKind
  text: string
  /** How long it took, once closed. */
  ms?: number
  outcome: LogOutcome
  /** The tool call an open entry belongs to, so that call closes it and no other. */
  callId?: string
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  /** The subagent type as spawned: `session-router:worker`, `Explore`. */
  type: string
  /** The kind of work, set when it starts and kept for its life (`kindOf` in hooks/model.ts). */
  kind: Kind
  /** Its place among the agents of the same kind in its run, in start order, from 0: shifts its colour (`agentColor`). */
  tint: number
  description: string
  model: string
  effort?: string
  status: RunStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  use: TokenUse
  costUsd: number
  /** Model requests seen. */
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** When the worker last reported a step; the fill creeps from here. */
  stepAt?: number
  /** When its last model request or tool call ended; with `doingSince`, `stepAt` and the log, how long it has been quiet. */
  activeAt?: number
  /** What it is doing now, one line. */
  doing: string
  doingSince: number
  log: LogEntry[]
}

export type MainStatus = 'working' | 'waiting' | 'resting'

/** The main Claude Code agent of the session. */
export type MainRun = {
  status: MainStatus
  doing: string
  doingSince: number
  model: string
  effort?: string
  turns: number
  turnStartedAt: number | null
  /** Time spent inside turns, closed turns only; add the open turn's age when drawing. */
  workedMs: number
  use: TokenUse
  costUsd: number
  /** Its usage by the family of the model each request ran on; older state has none, and what it lacks counts under the current model. */
  byFamily?: Partial<Record<ModelFamily, Spent>>
  contextTokens: number
  contextMax: number
  log: LogEntry[]
}

export type Limit = {
  /** `five_hour`, `seven_day` or `spend_limit`. */
  kind: string
  percentUsed: number
  resetsAt: string | null
}

/** What the engine measured for the session, plus what the bar derives per turn. */
export type Usage = {
  at: number
  sessionStartedAt: number
  limits: Limit[]
  /** The engine's own session cost; null when it reports none. */
  costUsd: number | null
  costAtTurnStart: number
  turnCostUsd: number | null
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  /** Output tokens per second of the last timed main-loop response. */
  speed: number | null
  cacheExpiresAt: number | null
}

export type View = {
  isCompact: boolean
  isDoneCollapsed: boolean
  /** Ids of the rows whose log is open under them; `main` is the main agent's. */
  openLogs: string[]
  isBarCollapsed: boolean
  autoOpenedFor: string
  /** When the agents pane was last opened and when the bar was last collapsed or expanded: entrance animations key off these. */
  paneOpenedAt: number
  barToggledAt: number
  /** The page of rows the agents panel shows (`rowPages`) and the id of the first row it showed there; absent, the first page. */
  rowPage?: { n: number; first: string }
}

export type ThemeName = 'clawd' | 'cat'
export type PaletteName = 'classic' | 'ocean' | 'sunset'
export type ChartKind = 'ring' | 'bar'
/** `model_week` stands for every model-specific weekly window the engine reports. */
export type BarItem = 'context' | 'fiveHour' | 'week' | 'model_week' | 'speed' | 'cache' | 'turn' | 'time'

/** The mod's settings, read from the plugin's `userConfig` options (see plugin.json). */
export type Settings = {
  theme: ThemeName
  /** Colours of the meters, the progress bar and, with `barColors: 'palette'`, working agents' bars. */
  palette: PaletteName
  /** A working agent's bar and dot: the agent's own colour (from its kind), or the palette's accent. */
  barColors: 'kind' | 'palette'
  /** What is drawn behind the agents panel. */
  background: 'dots' | 'grid' | 'plain'
  /** ISO 4217 code every cost is shown in, converted at the online rate. */
  currency: string
  /** Percent, 70 to 200: zoom of the panel's drawings. Kept in the mod's store, set in the Crew settings pane. */
  textSize: number
  /** Percent, 50 to 250: mascot size in the panel, on top of textSize. Kept in the store. */
  iconSize: number
  /** Percent, 80 to 160: size of the bar above the prompt. Kept in the store. */
  barSize: number
  panelUsage: 'off' | ChartKind
  barUsage: ChartKind
  /** The bar's items that are switched on, in their fixed order (derived from the eight `bar*` options). */
  barItems: BarItem[]
  /** `any` opens the panel for any subagent; `plan` for a reported plan or its agents; `never` leaves it to the person. */
  autoOpen: 'any' | 'plan' | 'never'
  /** Entries shown in a log opened under a row, 5 to 200. Kept in the store. */
  logLines: number
  animations: boolean
  /** Hover cards on the bar's pills. */
  barTooltips: boolean
}

/** The four numbers the Crew settings pane steps; the plugin screen only mirrors them as text. */
export type Sizes = Pick<Settings, 'textSize' | 'iconSize' | 'barSize' | 'logLines'>

export type Rates = {
  at: number
  /** Units of each currency per 1 USD. */
  rates: Record<string, number>
  /** False while the built-in table stands in for fetched rates. */
  isLive: boolean
}

// Inside the block below, `Settings` would name the engine's own type: alias ours first.
export type CrewSettings = Settings

declare module 'claude-code' {
  interface PluginState {
    'pixel-crew': {
      flow: Flow | null
      run: Run | null
      agents: AgentRun[]
      retired: Retired
      main: MainRun
      usage: Usage
      view: View
      settings: CrewSettings
      rates: Rates
      now: number
    }
  }
}
