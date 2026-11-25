<h1 align="center"><img src="docs/wordmark.svg" alt="CPixelCrew" width="330"></h1>

CPixelCrew is a visual mod for Claude Code. It draws an agents panel, where every subagent appears as a pixel mascot dressed for the kind of work it does, and a bar above the prompt with progress and usage figures. It also adds a Crew settings pane, a short guide, the `/crew` command and two small tools the model uses to report progress. It has no skills and no agents of its own: it shows any subagent, whoever started it.

The panel and the bar work with no orchestrator installed. Any orchestrator can call the two tools, `progress` to report a plan and `step` to report a subagent's steps, and the plan then shows in the panel. One optional companion that does this is [CSessionRouter](https://github.com/HHong214/CSessionRouter), which plans work and splits it across subagents.

## Quick start

**Look at what the agents do.**

- `/crew`, or the panel icon on the bar, shows or hides the agents panel.
- The log icon at the right of any row in the panel opens that agent's log under the row.
- `/crew guide`, or the help icon at the top of the panel, shows or hides a short guide to the commands and icons.

**Change the look and the money.** Open Customize > Plugins > CPixelCrew in the desktop app, or type `/crew set <key> <value>`:

- Mascots: `/crew set theme cat` (black cat, the default) or `/crew set theme clawd` (crab).
- Currency: `/crew set currency EUR`. Every cost is then shown in euros.
- Sizes, hero cards and the bar's order: `/crew settings`, or the gear icon at the top of the panel, opens the Crew settings pane; `/crew reset` puts everything back.

## The agents panel

On the desktop the panel is a column of drawings over a backdrop of dots, a fine grid or nothing (setting `background`), which spans the pane's full width. Everything else, the icons included, stops 12 px short of the pane's right edge, so the app's scroll bar, when the panel is taller than the pane, never covers a button; the Crew settings and guide panes keep the same 12 px clear. From top to bottom:

**The title row.** The name the bar's progress row shows (the plan's, or the run's newest agent's) while it is unfinished, else a muted `No task yet`. At its right sit three icons: help (opens the guide pane), the gear (opens the Crew settings pane) and compact. Every icon in the panel and the bar is drawn on its own, with no outline round it. Each of these three is shaded while its pane is open, or while the panel is compact.

**The session card.** One card in three strips, with hairlines between the cells. In the desktop app it sits on the same panel as the bar above the prompt: the app's own background colour with a thin rounded border, across the pane up to the 12 px kept clear for the scroll bar. A `/clear` starts the card over.

1. **Session.** A small heading, `Session`, then the figures and the context:
   - Cost: the session cost (prefixed `≈` when it is an estimate) and `this turn +£0.32` once a turn cost is known, shortened to `+£0.32 turn` or `+£0.32` in a narrow cell.
   - Tokens: the total and `in 1.2M · out 96k`, where `in` counts input plus cache reads and writes (shortened to `1.2M in`).
   - Time: the session time and `worked 12m`, how long the main agent has worked. Times that count up step: every ten seconds under a minute (`0s`, `10s` to `50s`), then whole minutes (`1m` to `59m`), then hours and minutes (`1h 02m`). This holds for a row's elapsed time, the main agent's worked time and the session time.
   - Context, on a line of its own under the three figures: `52% used` with its meter and `517k / 1M`.
2. **Plan.** A second small heading, `Plan · Ultra` (the plan's name, read from the desktop app's usage answer; just `Plan` when it is not known), over one cell for each of the plan's usage windows, always as usage left: `5-hour` first when the plan has one (some plans, such as Ultra, have none), then `Week`, then one per model-specific weekly window (`Week · Fable`, shortened to `Wk · Fable`). The group is left out when no window is known. Each cell has the label, the figure (`60% left`), a meter and a dim detail (`resets in 3h 05m`, or the shorter `3h 05m` when the full one does not fit). Up to four cells share a row while each is at least 80 px wide; in a narrower pane they go two to a row, and further cells wrap onto more rows by the same rule. The setting `panelUsage` decides how they are drawn:

   | `panelUsage` | Meters |
   |---|---|
   | `bar` (default) | Each cell as above, with a thin bar |
   | `ring` | Each cell as a ring with the percent inside, the label above and the detail below |
   | `off` | No context line and no Plan group; the figures and the split stay |

   Colours follow one rule everywhere: amber at 30% left or less, red at 10% left or less; for context that is 70% and 90% used. A window whose reset time has passed before a fresh figure arrives reads `resetting…` in grey with an empty meter for up to ten minutes, and is then left out. A limit with no figure is left out.
3. **Usage split.** Where the session's tokens went:
   - `Router 38% · ≈£1.20` at the left and `Subagents 62% · ≈£1.97` at the right. The router is the main session. The percentages are shares of all tokens (input, output, cache reads and cache writes); the costs are list-price estimates, marked `≈`, and are dropped when the line does not fit.
   - The split bar: the router's part in a neutral grey, then one sliver per subagent in that agent's own colour, in the order they started, 1 px apart; then one muted sliver for agents no longer listed in the panel (see Cost and privacy).
   - The model bar and a two-column legend: one entry per model family that used tokens (Fable, Opus, Sonnet, Haiku, Other), largest first, with its tokens and share. Fable takes the palette's accent, Opus its calm colour, Sonnet its done colour, Haiku a neutral grey and Other the muted ink.
   - The strip is left out until the session has used any tokens. With no subagents the router is 100%.

**Headings.** Each section starts with a heading in sentence case, its count muted after it (`Working 3`), and a hairline to the 12 px kept clear for the scroll bar. The sections are Main agent, then Working (earliest started first), Waiting (longest waiting first), Planned and Finished (most recently ended first). An icon at the right of the Finished heading folds the finished rows away and brings them back.

**Pages of rows.** The rows of Working, Waiting, Planned and Finished, in that order, come in pages. Each page holds at most 60 rows and keeps the drawings under 120,000 characters, the most the app accepts for one panel, so the panel never goes blank however many agents have run. A foot line under the rows reads, for example, `Rows 8–14 of 16`, with Previous and Next icons at its right; a page with nothing before or after it leaves that icon out. The headings still count every row. The page follows a row: opening a log keeps its row in view, and when agents start or finish the view stays with the row it was at. Both pictures of a row, the mascot and its text, count against that budget. A row too large for the budget even alone reads `This row is too large to draw here.` The terminal's text panel has no pages: it ends a long section with `+N more`.

**The main row.** A large mascot, `Claude` with a status chip (`working`, `waiting` or `resting`) and the number of agents running, the model and effort, what it is doing now, its tokens (`in · out`), its estimated cost and its worked time, and a task strip: the plan's name over a track drawn like the bar's progress row, in the same four states (see The bar), with its pill and percent. The model is the one the session runs on now, read each time the panel draws, so a `/model` change shows at once; the effort is the last one a turn reported. Waiting means asking for your approval, or a turn has ended while subagents still run (`Waiting for 2 agents`). Resting reads `Resting · last turn 3m ago`, counted in whole minutes (`just now` under a minute).

**Agent rows.** Each subagent's row shows:

- the mascot in its kind's costume (see Work kinds);
- the task description, over up to two lines, with a status mark at the right: a steady dot (running), an hourglass (waiting), a check (done) or a cross (failed);
- the kind label in the agent's own colour, then model and effort (`Opus 5.5 · high`), `round N` when the same task has run before, and `error` when it failed;
- what it is doing now, over up to three lines, preceded by `3/6 · note` when the agent reports steps;
- a stats line: `in 1.2M · out 96k`, with the cache counted in `in`, then its estimated cost and elapsed time;
- while it runs or waits, a thin bar of its reported steps, or of its context use in grey when it reports none.

A running agent's dot and bar follow the `barColors` setting; the kind label always keeps the agent's own colour. A row grows taller to fit its text and a larger mascot (the Mascots size). With hero cards on, it is a little taller still, and its text starts further right (see Hero cards).

**Hero cards.** With `heroCard` on (the default), each mascot in the agents panel sits on a see-through glass card with a one-pixel pixel frame and notched corners, so a dark mascot shows on a dark page. The card is 34 x 32 mascot pixels round the 30 x 28 mascot; rows with a card are a little taller and their text starts further right. The bar above the prompt has no cards. Switch them with the Hero cards button in the Crew settings pane or with `/crew set heroCard on|off`.

**Planned rows.** Tasks in the plan the bar shows that no agent has started yet: a dimmed mascot in the task's costume, the number and title (`5. Update README`), a clock mark, the kind label in the kind's colour, the planned model and effort (`Opus · high`) and `after 1, 2` when it waits for other tasks.

**Logs.** Every row, the main and planned ones included, has a log icon at its right. Pressing it opens the log under the row, and the icon is shaded while it is open; pressing it again closes it. The log starts with the row's cache figures (`Cache read 240k · write 18k`) when there are any; they moved here from the stats line. Then it shows one entry per line, newest last: clock time, a mark for the kind of entry, the text over up to two lines, and its duration. It shows as many of the last entries as the Log lines size. A live agent's log, and the main agent's, keeps its newest 200 entries; when an agent finishes, its log is cut to the newest entries up to the Log lines size. A copy icon at the log's right copies the whole log as text. A planned row's log says `Not started yet.`

**Compact mode.** The compact icon replaces everything below the title row with:

- a small card, on the same panel as the session card: the cost, the tokens and the session time on one line, this turn's cost at the right; and a second line with one small cell per gauge (`Ctx 52%` over a thin bar), in the same order as the session card: context first, then the plan's windows with the 5-hour one first when there is one. With no gauges, or `panelUsage` set to `off`, the card has the first line only;
- one line for the main agent: `Claude`, its status word and model, and the plan's count (`3/6`) at the right;
- one line per working or waiting agent: a small mascot, the title, the kind label and model family, its steps or its tokens at the right, and its status mark; a long list is paged the same way as the rows, with the same foot line;
- one last line with the Planned and Finished counts, and the number failed in red, when there are any.

The same icon brings the full panel back. The panel keeps the mode you left it in, the next session too.

The panel has no hover cards. With `animations` on, the panel's other drawings play a short entrance when the panel opens; rows do not animate in. A finished row's mascot and the resting main mascot hold still a minute after they finish or come to rest: from then on they carry no animation. While nothing runs, the panel's times (`last turn 3m ago`, the session card's Time and worked figures) count on once a minute. The mascots' own motion and the twinkle of the progress tracks do not depend on this setting. The panel opens itself according to `autoOpen`, and when the app restarts a session's process (`--resume`, for one that hit a usage limit) a panel that was open in that session comes back by itself; one you closed stays closed. A panel that only ever opened by itself may wait until you open it once, because the app places a pane it was not asked for only on a wide enough window. Its zoom is the Panel text size; the pane's width is whatever you drag it to.

**Usage limits.** Two sources feed the limits. Claude Code reports the 5-hour and weekly windows, but only after a session's first response. In the desktop app the mod also asks the app's own usage tool for the windows it reports, at session start, after each of the main agent's turns and at most every 5 minutes; this is where a model-specific weekly window such as `Week · Fable` comes from. Some plans, such as Ultra, have no 5-hour window; the mod then shows the windows the plan has. Where both report a window, Claude Code's figure is used, unless its reset time has passed and the app's window resets later: then the app's fresher figure is used. Outside the desktop app, or when that call fails, the app's windows are simply absent; after three failures in a row the mod stops asking until it next loads. An answer that holds no window the mod knows is not a failure, and the plan's name in it is still kept. The mod keeps the last limits in its store and shows them until fresh ones arrive.

## Work kinds

A subagent's look comes from the kind of work it is doing. Each kind has a label, a costume (the same in both themes) and a base colour.

| Kind | Label | Costume | Colour |
|---|---|---|---|
| main (Claude) | Claude | none | `#D97757` |
| `search` | Search | pirate hat and cutlass | `#2E9BB8` |
| `analyze` | Analyze | visor and bar chart | `#B6AC20` |
| `build` | Build | chef's toque | `#367FDD` |
| `refactor` | Refactor | hard hat and wrench | `#BB811B` |
| `quick` | Quick | racing helmet and flag | `#23A97F` |
| `debug` | Debug | deerstalker and magnifier | `#D86931` |
| `test` | Test | safety goggles and flask | `#5BA23B` |
| `review` | Review | judge's wig and gavel | `#C0453F` |
| `design` | Design | beret and paintbrush | `#D4537E` |
| `write` | Write | round glasses and quill | `#B56BC7` |
| `plan` | Plan | blueprint and pencil | `#727BCA` |
| `hard` | Hard | astronaut dome | `#9774DC` |
| `other` | Helper | bandana | one of `#AAC46E`, `#6EC47C`, `#C46EB3`, `#6EC4BE`, `#776EC4`, `#C47F6E` |

**How an agent's kind is found.** Once, when the agent starts; the first match wins:

1. Its description equals the title of a planned task (compared without case or punctuation) that gives a `kind`, or that gives an `agent` naming a kind or one of the eleven 1.6 worker roles.
2. Its subagent type. `Explore`, `web-fetch`, `claude-code-guide`, or a type containing `scout`, `research`, `explor` or `search` is Search. A type containing `plan` or `architect` is Plan; `review` is Review; `test` is Test; `debug` or `detective` is Debug; `design` is Design; `writer` or `doc` is Write; `analy` is Analyze. A 1.6 `pixel-crew:<role>` type maps to the role's kind.
3. Words in its description, in this order: review, audit (Review); test, tests, tdd (Test); fix, debug, bug, investigate, root cause (Debug); research, search, find, look up, fetch, read, map, explore, collect (Search); design, mock, ui, layout, style (Design); write, doc, readme, changelog, copy (Write); words starting with analy, measure, benchmark, data, log (Analyze); plan, spec (Plan); refactor, rename, restructure, clean (Refactor); build, implement, add, create, feature (Build); run, install, config, boilerplate (Quick). A word also matches with a common ending: `fixes`, `planned`, `writing`.
4. Otherwise, `other`.

The 1.6 role names map to kinds as: scout Search, analyst Analyze, chef Build, engineer Refactor, sprinter Quick, detective Debug, tester Test, reviewer Review, designer Design, writer Write, planner Plan, ace Hard.

**Each agent gets its own shade.** Agents of the same kind in one run are numbered in the order they start, from 0. The first takes the kind's base colour; the next ones shift its hue by +6, −6, +3, −3 and 0 degrees and its lightness by +10, −7, +16, +5 and −4 points, kept between 38% and 72%, and the pattern repeats every six. Same-kind agents therefore look related but different, and never drift into another kind's colour. The shade is set when the agent starts and stays for its life.

**Helper.** An agent no rule above places is a Helper, with the bandana. Instead of one base colour it takes one of six fixed colours, picked from its description, so the same description always gets the same colour; it is never grey. Planned rows use the kind's base colour, with no shade.

## The bar

The bar sits above the prompt and is there from the start of a session (it gives way only while Claude Code shows a survey in that place). Expanded, it has two rows with a small gap between them. In the desktop app the whole bar, collapsed or expanded, sits on one opaque rounded panel in the app's own background colour, so a busy backdrop behind the conversation does not show through it; the pills keep their own tinted fills on top. The terminal bar has no panel.

**Progress row.** A title, savvy-progress's dithered track with its pill, the percentage, a mascot and a count (`×6`). At the row's right end sit the panel icon, which shows or hides the agents panel and is shaded while it is open, and the collapse icon, rightmost. The row, and the main agent's task strip in the panel, show one of two things:

- **The plan** the main session reports with the `progress` tool, titled by the plan, counting `Tasks 3/6` and `×` its agents plus planned tasks. It is shown while it is unfinished and either was reported within the last 30 minutes or has an agent on one of its tasks still running or waiting, or once it is finished if it was reported, or finished by itself, during the current run.
- **Otherwise, the run:** every subagent of any type from the first one after the previous run ended, until a prompt you send finds none of them active. The pill reads `Agents 2/7` (seven started, two finished; a failed agent counts as finished) and the count `×7`; the total grows as agents join, and a background run that goes on while you type stays one run. The title is the description of the newest agent still running or waiting, else of the newest. An agent with no activity for 15 minutes (12 hours when it waits for your approval) counts as finished for the run, though the panel still lists it. When an agent of a run that is over works again, it joins the run under way, or starts a new one (`Agents 0/1`); the ended run is not reopened. An agent the app no longer lists, quiet for the same time, is closed as failed with the log line `Stopped: no longer listed`; if that agent does anything again, its row comes back as it was and counts again, and a new plan keeps such a row. Once a run is over it stays shown, full and green, until the next run starts or a fresh plan arrives.

It is always in one of four states:

| State | What it looks like | When |
|---|---|---|
| No task yet | Grey dot, muted `No task yet`, an empty track, no pill or percent, the resting mascot, `×0` | No plan applies and no subagent has started |
| Running | Purple, twinkling; the pill shows the phase or count (`Research`, `Asking`, `Plan`, `Design`, `Tasks 3/6`, `Review 4/5`, `Agents 2/7`) and the percent | An unfinished plan or run while the main agent works or any agent is running or waiting |
| Paused | The same row in grey, still; the pill reads `Paused · 3/6` | An unfinished plan with nothing working |
| Done | Green with a slow twinkle for a minute, then still, `Done` (a run keeps its count: `Agents 7/7`), `100%` | The plan is reported finished, or every planned task's agent has finished successfully and nothing is still running or waiting; or every agent of the run is over |

A plan that finished by itself opens again when a later report brings `done` below `total` or a phase other than `close`, when a report sends it new tasks (they are merged, and its finished rows stay), or when an agent starts again on one of its tasks; a report that agrees with it changes nothing. A plan closed with `finished: true` stays closed.

**The fill creeps.** The fill does not wait for an agent to finish. Each working agent adds its own part: the steps it has reported done, plus a creep toward its next step that covers most of the gap in the first minute and never reaches it; an agent that reports no steps creeps to half its share at most. A plan's fill adds the parts of the agents working on its planned tasks to the tasks done. The bar's progress row is rebuilt only when what it shows changes and, while a plan or a run is running, at most once every ten seconds; at each rebuild the fill glides over the next ten seconds to where it will then be, and the percent follows. While the count of agents stays the same the fill never moves back (an agent that re-plans to more steps does not pull it back); when an agent joins, it may drop once to its new honest value. A new plan starts empty, even with the same title and task count as the last one.

While running, a faint "handed out" layer reaches past the filled part by the number of agents actually running or waiting; it is not drawn in any other state. The track keeps savvy-progress's own colours whatever the palette. The crab works while the plan runs and takes its done pose when it is done; the cat rides a broom in both; otherwise both rest. Between rebuilds the progress row's picture does not change.

**Info row:** rounded pills over the bar's full width, wrapping onto further lines when the bar is narrow. They come in the bar order (see Settings) and each has its own on/off option:

- `context` (`barContext`): `Context`, a small meter, the percent used and a dim `517k / 1M`.
- `5h` (`barFiveHour`), shown as **Usage left**: an icon, the label of the window it holds, a meter of what is left, `40% left` and a dim `resets in 3h 05m` (just `3h 05m` when the bar is under 60 columns wide). It holds the 5-hour window when the plan has one, else the weekly window, else the first model-specific weekly window, and the pill names that window.
- `week` (`barWeek`): the same pill for the weekly window. A window is never shown twice in the bar: when Usage left holds the weekly window, the `week` pill is left out, and the same goes for a model week.
- `model` (`barModelWeek`): one such pill for each model-specific weekly window (`Week · Fable`) not already shown, and none when no source reports one.
- `speed` (`barSpeed`): output speed of the last reply (`84 tok/s`).
- `cache` (`barCache`): the prompt cache countdown, in whole minutes (`52m`) until five are left, then `4:59` down to zero.
- `turn` (`barTurn`): the turn number (`#12`).
- `time` (`barTime`): the session time.

At their edges the pills read:

| Pill | Edge texts and colours |
|---|---|
| context | Amber at 70% used or more, red at 90% |
| 5h (usage left), week, model | Amber at 30% left or less, red at 10%; `limit reached` in red when none is left; `resetting…` in grey with an empty meter for up to ten minutes after the reset time, until a fresh figure arrives |
| speed | `— tok/s` in grey until a reply has been measured |
| cache | `—` in grey before the session's first response; `…` while Claude or an agent is working; amber at 18 minutes or less, red at 6; `expired` in red at zero, until the next response |
| turn | Not shown until the first turn |
| time | Always shown |

A limit with no figure yet is left out. Each pill's outline and fill are tinted from the colour palette: a meter pill by its meter's colour, the cache pill by the time left, the speed, turn and time pills by the palette's accent, and a grey pill (a dash or `resetting…`) in neutral grey. With `barUsage` set to `ring`, the ring in a pill is 13 px across with 2 px of clear space above and below, so it never touches the pill's border.

**Hover cards.** In the desktop app, with `barTooltips` on, resting the pointer on a pill shows a small card with real figures: for a limit, what is left and used, the reset day and time with the time remaining, and the pace (points used ahead of or behind the time gone); for context, the tokens used of the window and what is left; for the cache, when it expires and what a cold and a warm cache cost; for speed, turn and time, one line each.

Collapsed, the bar is one line: the mascot's head, a short summary (`No task yet`, `Tasks 1/3`, `Agents 2/7`, `Paused 1/3` or `Done`, then agents running or waiting, context and the usage left) and the expand icon alone, at the same place as the collapse icon. The bar cannot be closed, only collapsed. `/crew bar` does the same as the icon, and the collapsed state is remembered. The Bar size zooms the bar's drawings and text; the icons keep their size. With `animations` on, the bar's drawings play a short entrance when it is collapsed or expanded.

## Themes

Two themes draw the same layout: `cat` (the default), a black cat with a big round head, two large round cream eyes with big black pupils, small upright ears with pale green insides, no nose, mouth or whiskers, a small body sitting upright and a tall tail that rises on its right; and `clawd`, the pixel crab. The cat is fan art of 罗小黑 (Luo Xiaohei) from 罗小黑战记 (The Legend of Luo Xiaohei), drawn new for this mod; the character belongs to its makers (see [LICENSE](LICENSE)). The cat is one black in light and dark mode alike, with no outline and nothing behind it, so on a dark panel it reads mainly through its eyes, ears and costume, and the hero cards help (see Hero cards). Working, it keeps its eyes wide, blinks now and then and moves its kind's prop with its paw in a small arc; waiting, its eyes narrow and it flicks the tip of its tail; resting, it lies curled up asleep with its eyes shut, breathing, with z's drifting up; in the bar's progress row it rides a broom, bobbing, with sparkles off the bristles. Each kind wears the same costume in both themes (see Work kinds).

Three palettes colour the usage meters, the bar's pills and the model series of the usage split: `ocean` (teal and blue, the default), `sunset` (orange and pink) and `classic` (green, amber, red). The progress tracks keep their own purple and green under every palette.

## Settings

Settings live in two places, and nothing is in both:

- **The plugin screen:** Customize > Plugins > CPixelCrew in the desktop app holds every choice and toggle, each choice listing its default first. A change takes effect at once: the mod reloads with the new value and everything redraws. It also has five shown-only fields, the four sizes and the exchange rate in use, written there by the mod; typing in them changes nothing, and the mod overwrites what was typed the next time it updates them.
- **The Crew settings pane:** `/crew settings`, or the gear icon at the top of the agents panel, shows or hides it. It holds the four sizes, each with `−` / `+` buttons, then Look (the Hero cards button, which reads On or Off and flips with each press), then `Bar items order`, and a line pointing to the plugin screen for everything else. All three are kept in the mod's own store, not in the plugin's options; each press saves at once and redraws. A press writes that one size and leaves the others as the store holds them, so two open sessions do not undo each other's sizes.

| On the screen | Key | What it does | Values (default first) |
|---|---|---|---|
| Look: mascot | `theme` | The mascot drawn for Claude and each agent | `cat`, `clawd` |
| Look: colours | `palette` | Colours of the meters, the bar's pills, the usage split's model series and, with `barColors palette`, working agents | `ocean`, `sunset`, `classic` |
| Look: working bars | `barColors` | Colour of a working agent's bar and dot | `kind` (the agent's own colour), `palette` (the palette's accent) |
| Look: panel background | `background` | What is drawn behind the agents panel | `plain`, `dots`, `grid` |
| Look: animations | `animations` | Entrance motions of the panel and the bar | on (default), off |
| Money: currency | `currency` | The currency every cost is shown in | `GBP`, `USD`, `EUR`, `CNY`, `JPY`, `KRW`, `INR`, `CAD`, `AUD`, `NZD`, `SGD`, `MYR`, `HKD`, `TWD`, `THB`, `IDR`, `VND`, `PHP`, `CHF`, `SEK`, `NOK`, `DKK`, `PLN`, `BRL`, `MXN`, `AED`, `SAR`, `ZAR`, `TRY`, `ILS` |
| Money: exchange rate (shown only) | `rateNow` | Shows the rate in use, such as `1 USD = 0.7551 GBP · online, 2026-11-14` | written by the mod |
| Panel: usage meters | `panelUsage` | How the session card shows context and limits | `bar`, `ring`, `off` |
| Panel: opens by itself | `autoOpen` | When the panel opens without being asked | `any` (once in a session for any subagent, and once for each plan reported with tasks), `plan` (once for each plan reported with tasks, or an agent on one of its tasks), `never` |
| Bar: meter style | `barUsage` | The small meter in the context and limit pills | `ring`, `bar` |
| Bar: show context | `barContext` | The context pill | on (default), off |
| Bar: show usage left | `barFiveHour` | The usage left pill: the 5-hour window, else the weekly one | on (default), off |
| Bar: show weekly limit | `barWeek` | The weekly limit pill | on (default), off |
| Bar: show model weekly limit | `barModelWeek` | The pills for model-specific weekly windows | on (default), off |
| Bar: show speed | `barSpeed` | The output speed pill | on (default), off |
| Bar: show cache countdown | `barCache` | The prompt cache countdown pill | on (default), off |
| Bar: show turn number | `barTurn` | The turn number pill | on (default), off |
| Bar: show session time | `barTime` | The session time pill | on (default), off |
| Bar: hover cards | `barTooltips` | The cards over the bar's pills, in the desktop app | on (default), off |
| Size: panel text (shown only) | `textSizeNow` | Shows the Panel text size | written by the mod (`100%`) |
| Size: mascots (shown only) | `iconSizeNow` | Shows the Mascots size | written by the mod (`200%`) |
| Size: bar (shown only) | `barSizeNow` | Shows the Bar size | written by the mod (`100%`) |
| Panel: log lines (shown only) | `logLinesNow` | Shows the Log lines size | written by the mod (`50`) |

The 1.6 values still work when typed: `/crew set barColors role` sets `kind`, and `/crew set autoOpen crew` sets `plan`.

**The sizes.** Set in the Crew settings pane, or with `/crew set`:

| In the pane | Key | What it sets | Range | Step | Default |
|---|---|---|---|---|---|
| Panel text | `textSize` | Zoom of the agents panel (%) | 70 to 200 | 10 | 100 |
| Mascots | `iconSize` | Size of the panel's mascots, on top of the panel zoom (%) | 50 to 250 | 10 | 200 |
| Bar | `barSize` | Size of the bar's drawings and text (%) | 80 to 160 | 10 | 100 |
| Log lines | `logLines` | How many entries an open log shows | 5 to 200 | 5 | 50 |

Each press stops at the ends of the range. A value off the step grid, typed with `/crew set`, first moves to the grid in the direction pressed: 105 goes up to 110 or down to 100.

**Hero cards.** `heroCard` is a switch, on by default, kept in the mod's own store like the sizes and not a plugin option, so it is not in the table above. The Hero cards button in the Crew settings pane flips it and saves at once; `/crew set heroCard on|off` does the same. See Hero cards under The agents panel.

**The bar order.** `Bar items order` lists the eight items in their current order, each with `▲` and `▼` buttons that move it one place; an item switched off on the plugin screen is listed muted. The default order is `context`, `5h`, `week`, `model`, `speed`, `cache`, `turn`, `time`. Which items show is still set by the plugin screen's toggles.

**The exchange rate.** Costs are reckoned in US dollars and drawn in `currency` only. With `USD` there is no conversion. Otherwise the rate comes from the online table, which the mod fetches when a session starts if the stored table is more than a day old. Until a fetch succeeds, or when it fails, the last stored table is used, or a built-in table of rough rates when there is none or it lacks the currency. There is no rate of your own to enter. The shown-only exchange rate field says which is in use: `1 USD = 0.7551 GBP · online, 2026-11-14`, `… · built-in estimate`, or `US dollars, no conversion`.

**From the chat.** `/crew set <key> <value>` takes every key in the settings table that is not shown-only, the four size keys, `barItems`, `barOrder` and `heroCard`. A setting key writes the plugin option, as the plugin screen would; a size key writes the mod's store and updates the shown-only field; `heroCard` writes the store and redraws. Examples: `/crew set palette sunset`, `/crew set barTurn off`, `/crew set textSize 120%`. Keys and values are not case-sensitive; on and off also take `true`/`false` and `yes`/`no`; a size outside its range is clamped. `/crew set barItems <list>` sets the eight toggles at once: `all`, `none`, or the names of the pills to show (`context`, `5h`, `week`, `model`, `speed`, `cache`, `turn`, `time`), separated by commas or spaces; the order typed does not count. `/crew set barOrder <list>` puts the items named first, in the order given, and the rest after them in their present order. A list with an unknown name, an unknown key or a bad value changes nothing and prints the usage text.

**Reset.** `/crew reset` puts every option back to its default and, at once, the four sizes, the bar order and the hero cards (on). The options go back one per reload, writing only those that differ; a flag in the mod's store carries the reset across the reloads, and it is cleared, and the shown-only fields updated, when no option differs any more.

## Commands

- `/crew` shows the agents panel, or hides it when it is open.
- `/crew open` opens the agents panel.
- `/crew bar` collapses or expands the bar.
- `/crew settings` shows or hides the Crew settings pane.
- `/crew guide` shows or hides the guide pane.
- `/crew set <key> <value>` changes one setting or size, the bar's items (`barItems`) or their order (`barOrder`), or the hero cards (`heroCard`).
- `/crew reset` puts every option, the sizes, the bar order and the hero cards back to their defaults.
- Any other word prints the usage text.

## Tools it adds for the model

**`mcp__CPixelCrew__progress`.** The main session reports a plan. A call from a subagent is ignored. Fields left out keep their previous value.

| Field | What it is |
|---|---|
| `title` | Short name of the plan. A new title starts a new plan. |
| `total` | Number of planned tasks |
| `done` | Number of tasks accepted after review |
| `phase` | `research`, `ask`, `plan`, `design`, `delegate`, `review` or `close`; the pill reads `Research`, `Asking`, `Plan`, `Design`, `Tasks 3/6` or `Review 4/5` |
| `finished` | `true` once, when the plan is closed |
| `tasks` | The planned tasks in order, numbered from 1: `{ title, kind, model, effort, after }` |

Each task's `title` must equal the Agent `description` the task is started with, so the panel can match runs to tasks. `kind` is one of the work kinds and sets the task's costume and colour (`agent` is still read as an older name for it, and may name a 1.6 role). `model` and `effort` are what the planned row shows. `after` lists the numbers of the tasks it waits for. When two tasks in one report have the same title (ignoring case and punctuation), the later ones get ` (2)`, ` (3)` added, and the tool's reply lists the titles to use as Agent descriptions. A re-run of a task reuses its title and counts for that task.

**`mcp__CPixelCrew__step`.** A subagent reports its own steps (`done`, `total`, `note`); it fills that agent's row bar and adds a line to its log. A call from the main session is ignored. The tool is in every agent's tool list, not behind a search.

When a subagent starts, the mod adds a line to the end of its brief asking it to report steps with `step`, unless the brief already names the tool. It does this for an agent whose description matches a planned task, whatever its type, and for a 1.6 `pixel-crew:` one, unless it is one of Claude Code's own types (`web-fetch`, `Explore`, `Plan`, `claude-code-guide`, `statusline-setup`).

## Cost and privacy

- **Cost.** The session cost is Claude Code's own figure when it reports one. Otherwise, and always for the main and agent rows and the usage split, it is an estimate from a built-in price table per model; the session cost, the rows and the usage split mark it `≈`. Every cost is shown in the chosen currency only; there is no second figure in US dollars.
- **The price table**, in US dollars per million tokens. The first row that matches the model wins. Cache writes are priced at twice the input price (the one-hour rate).

  | Model | Input | Output | Cache read |
  |---|---|---|---|
  | Fable 5.2, Mythos 5.2 | 8 | 40 | 0.20 |
  | Fable 5.1, Mythos 5.1 | 10 | 50 | 0.25 |
  | Other Fable and Mythos | 10 | 50 | 1.00 |
  | Opus 5.5 | 4 | 20 | 0.20 |
  | Other Opus | 5 | 25 | 0.50 |
  | Sonnet 5.5 | 2 | 10 | 0.10 |
  | Sonnet 5 | 2 | 10 | 0.20 |
  | Other Sonnet | 3 | 15 | 0.30 |
  | Haiku 5.5 | 0.10 | 0.50 | 0.01 |
  | Other Haiku | 1 | 5 | 0.10 |
  | Any other model | 4 | 20 | 0.20 |

  A single Haiku 5.5 request whose prompt (input plus cache reads and writes) is over 100,000 tokens is priced at 0.50 / 2.50 / 0.05 instead. A bare alias, with or without `[1m]`, means the current model of its family: `fable` is Fable 5.2, `opus` is Opus 5.5, `sonnet` is Sonnet 5.5 and `haiku` is Haiku 5.5.
- **Totals never go down.** When rows leave the panel (a new plan clears the finished ones, and past 200 rows the longest-finished go first, never an active one; and the same when the stored rows would pass one million characters, after their logs are shortened), what they spent is kept in a retired tally, by model family. The session's tokens and cost and the usage split include it, so the totals do not drop. A `/clear` is the exception: it starts the session over, so cost, tokens, time and worked count from the clear and the finished rows, the plan and the run go (an agent still working keeps its row). The main agent's usage is also kept per model family, so a session that changes model part-way keeps its earlier tokens under the model that spent them.
- **Currency rates.** At most once a day, when a session starts (see The exchange rate above), the mod makes one GET request to `https://open.er-api.com/v6/latest/USD`. No user data is sent. If the request fails, the last stored rates or a built-in table are used.
- **Usage limits** and context come from Claude Code's own session measurements and, in the desktop app, from the app's usage tool: the mod calls `get_usage` on the app's `ccd_session_mgmt` server through the mod API (`$.mcp.call`). That call stays inside the desktop app, uses no credentials of the mod's own and sends nothing anywhere else. The last limits are kept in the mod's local store so the next session can show them. The mod reads no credentials and makes no other network requests.

## Changed from 1.6

- The three skills (`crew-flow`, `crew-delegate`, `crew-review`) and the eleven worker agents are gone. Planning and delegating are left to whatever orchestrator you use.
- Subagents are drawn by their kind of work, not by a crew role, and each gets its own shade of its kind's colour. Any other agent is a Helper in one of six colours, never grey.
- The top of the panel is one card: figures, gauges and a new usage split (router against subagents, and tokens per model). Headings are in sentence case.
- Agent rows show `in · out` with the cache counted in `in`; the cache read and write figures are at the top of the row's log.
- Compact mode shows a small card and one line per working agent.
- The `progress` tool takes `kind`, `model` and `effort` per task, the phases `research` and `ask`, and numbers repeated titles.
- New defaults: `theme` cat, `palette` ocean, `barColors` kind, `autoOpen` any, `barUsage` ring, and the turn and time pills on. `autoOpen crew` became `plan`; `barColors role` became `kind`.
- Prices for Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5, with bare aliases read as the newest model.
- Eleven bugs fixed; see `CHANGELOG.md`.

## Install

CPixelCrew is installed from this repository, which is also its marketplace (`cpixelcrew`). Add the marketplace, install the plugin, then reload:

```
claude plugin marketplace add https://github.com/HHong214/CPixelCrew.git
claude plugin install CPixelCrew@cpixelcrew
```

Then run `/reload-plugins` (or start a new session) so Claude Code loads it.

## Update

The plugin's version is pinned, so an update is seen only when the version in `.claude-plugin/plugin.json` is raised. To fetch it:

```
/plugin marketplace update cpixelcrew
```

Then run `/reload-plugins`.

## Licence

MIT: see [LICENSE](LICENSE). It does not cover the crab mascot of the `clawd` theme, which is Claude Code's and belongs to Anthropic, nor the character drawn by the `cat` theme, fan art of 罗小黑 (Luo Xiaohei), which belongs to its makers; and the ported code keeps its own authors' notices, which `LICENSE` repeats.

CPixelCrew is not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic.

## Credits

The progress bar, the crab mascot art and parts of the panel are ported from the savvy-progress and session-band plugins in claude-kit by johnnyvizz (MIT licence). The activity line (what an agent is doing, in a few words) follows whats-agent-doing by Tzafrir Rehan (MIT licence). See `LICENSE` for the notices.
