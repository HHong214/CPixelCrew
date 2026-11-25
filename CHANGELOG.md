# Changelog

## 2.5.3 (2026-11-25)

### Fixed

- In the desktop app two invisible spacers were never drawn: like the characters in 2.5.2, they were handed to the app with an empty description (`alt`), and the app drops such a picture. So the 12 px kept free for the scroll bar at the right edge of the agents, settings and guide panes was not held, and a control at a row's right end could sit in that room. And where a control is left out (the Previous arrow on the first page of a long list), its place was not kept, so the control beside it could sit one icon to the side. Both spacers now carry the description `Spacer`.

## 2.5.2 (2026-11-25)

### Fixed

- In the desktop app the characters were gone from the panel: an empty space stood where the main agent's character belongs, no agent's row had its character, and the thin line under each row was missing too. Since 2.5.0 each character and each line is a picture of its own and was handed to the app with an empty description (`alt`), and the app drops a picture whose description is empty. Each now carries one: the character's own (for example `Claude (work)`), and `Row divider` for the line. The bar was not affected.

## 2.5.1 (2026-11-25)

### Fixed

- After `/clear` the panel kept the cleared conversation's rows and plan, and the session card mixed two conversations: Cost and Time started over while Tokens and Worked counted on. Now `/clear` starts the panel over as a new session: finished rows, the plan and the run go, and Cost, Tokens, Time and Worked count from the clear. An agent still working keeps its row, and so does a row the 15-minute rule closed, whose agent may yet come back. The sizes, compact mode, the folded Finished section, the collapsed bar and a panel you closed stay as they are.
- With two sessions open, changing one size in one of them put the other three back to what that session had read when it started, undoing the other session's changes. A change of one size now writes that size alone, on what is stored at that moment.
- With `autoOpen` at `any`, the panel opened itself again for a subagent outside a plan once 20 plans had been reported. It now opens for such a subagent once in a session.
- A row kept saying `Waiting for your approval: …` for as long as the approved tool ran. The words now come off when the call is allowed and starts to run.
- While a row waited for your approval, the bar counted its agent as finished after 15 quiet minutes and could read `Agents 1/1`, done, and a prompt sent then ended the run. A row that waits for your approval now keeps its run open for up to 12 hours.
- A finished agent that went on after a message, without being started again through the Agent tool, showed as working with the words `Finished` until its first tool call. Its row now reads `Getting started` with a `Resumed` line in its log, and the main agent waits for it.
- When a prompt had ended a run and one of its agents then worked again, the bar went on showing the ended run as done. The agent now joins the run under way, or starts a new one (`Agents 0/1`).

## 2.5.0 (2026-11-25)

### Fixed

- The app lagged and its memory grew during a long session. In 2.4.0 every moving row was sent to the app as a new picture every second, and the pane and the bar were redrawn on every change. Now pictures keep their bytes, and the pane and the bar are redrawn only when what they show changes.
- The list of agents could grow without limit, and past a point nothing more could be saved. Its stored size is now kept under one million characters: finished rows' logs are shortened first, then the oldest finished rows are retired into the session totals, which do not go down.
- A row whose end the app never reported stayed active for the rest of the session and kept the panel redrawing every second. An agent the app no longer lists is now closed as failed after 15 quiet minutes, with the log line `Stopped: no longer listed`.
- A row closed by that rule could read "Failed" while its agent worked again, because the app never lists a workflow's agents. When such an agent does anything again, its row comes back as it was: its status, its line and its whole log, without the `Stopped` line and with the entries that were open open again. The main agent waits for it again and the bar counts it again.
- A row that waits for your approval is now closed by that rule only after 12 hours, not 15 minutes.
- A new plan keeps a row that rule closed, as it keeps a working one, so its agent can still come back.
- After a reload of the mod in the middle of a turn, which every changed option causes, the copy loaded before could go on writing the pane and the bar with its old settings. A copy that is no longer the loaded one now stops writing them once the loaded copy has written its own.
- While one agent's tool call was open, a line another agent wrote could be missing from the pane until the agent list next changed. It now shows without waiting for that change.
- While idle with the cache pill on, the pane and the bar were redrawn every second for an hour after each reply. Idle now costs one redraw a minute at most.
- A `progress` call with an empty `tasks` list no longer wipes the plan, a plan title that holds `|` no longer reopens the panel at every planned agent, and a title cut at an emoji no longer leaves half of it.

### Changed

- Times count in minutes: every ten seconds under a minute (`0s`, `10s` to `50s`), then whole minutes (`1m` to `59m`), then hours and minutes (`1h 02m`). This covers a row's elapsed time, the main agent's worked time and the session card's Time and worked figures.
- The dot of a working row is steady; it no longer pulses.
- The cache pill counts in whole minutes (`52m`) until five are left, then in minutes and seconds.
- A finished row, the resting main mascot and the finished bar hold still a minute after they finish: from then on they carry no animation.
- The idle pane's times (`last turn 5m ago`, the session card) count on once a minute.
- Rows no longer animate in.
- A row is now two pictures, the mascot and its text, and both count against the pane's size budget, so a page may hold a row or two fewer.
- A finished row's log keeps the newest Log lines; a live row's, and the main agent's, keeps at most 200.
- The bar's progress row is rebuilt at most every ten seconds while a plan or a run is running, and its fill glides over those ten seconds. At most four groups of its dots twinkle.

## 2.4.0

### Changed

- The `cat` theme is redrawn as fan art of 罗小黑 (Luo Xiaohei), the cat of 罗小黑战记 (The Legend of Luo Xiaohei): a black cat with a big round head, two large round cream eyes with big black pupils, small upright ears with pale green insides, no nose, mouth or whiskers, no outline, a small body sitting upright and a tall tail that rises on its right. The eyes are wide when it works, is done, is planned or rides, narrow when it waits, and shut when it rests curled up asleep.
- Every pose, motion and all fourteen costumes are kept, with the same timings: the broom ride, the z's, the waiting dots and the sparkles are as before. The theme is still called `cat`, is still the default, and no option changed.
- The cat is drawn new for this mod, and the character belongs to its makers. The licence now says so and grants no rights in the character.

### Added

- Hero cards: in the agents panel, each mascot sits on a see-through glass card with a one-pixel pixel frame and notched corners, so a dark mascot shows on a dark page. They are on by default. The bar above the prompt has none.
- Switch them with the Hero cards button (On or Off) in the Crew settings pane, which saves at once, or with `/crew set heroCard on` or `off`. `/crew reset` turns them back on.
- Rows with a card are a little taller, and their text starts further right.

## 2.3.0

### Changed

- The mod now stands on its own: it no longer names or depends on any other mod. The panel and the bar work with no orchestrator installed, and any orchestrator can report a plan to the panel through the `progress` tool.
- The step line (the request to report steps with `step`) now goes to any subagent whose task is in a reported plan, whatever its type. It is no longer given to a subagent because of a type name that starts with another mod's name. Agents of the mod's own older `pixel-crew:` types still get it, and Claude Code's own types still do not.
- The guide says the same: any orchestrator can report a plan through the `progress` tool.
- Nothing else changes: every drawing and every other behaviour is as in 2.2.0.

## 2.2.0

### Changed

- The mod is now called **CPixelCrew** (it was Pixel Crew), is published on GitHub at `HHong214/CPixelCrew` and is by HHong214. It is installed from there: see Install in the README.
- The command `/crew` is unchanged, with all its sub-commands, and so are the Crew settings pane, the guide and the agents panel. Nothing is drawn differently.
- The two tools other mods and plugins call have new names: `mcp__CPixelCrew__progress` and `mcp__CPixelCrew__step` (they were `mcp__pixel-crew__progress` and `mcp__pixel-crew__step`). Anything that names the old tools must be changed to the new names.
- In the desktop app the mod's options are now under Customize > Plugins > CPixelCrew.

## 2.1.0

### Added

- Plans without a 5-hour limit, such as Ultra, are now supported. The bar's `5h` item is now **Usage left** (in Settings, "Bar: show usage left"). It keeps its switch (`barFiveHour`), its name `5h` in `/crew set barItems` and its place in a saved order. It shows the 5-hour window when your plan has one, else the weekly window, else the first model-specific weekly window. A window never shows twice in the bar: the weekly and model pills keep what Usage left did not take. The pill names the window it really holds.
- The agents panel's session card is in two groups under small headings. **Session** holds Cost, Tokens and Time, then Context on a line of its own. **Plan · <name>** holds the plan's windows as usage left, the 5-hour one first when there is one, then the week and the model weeks. The plan's name is read from the desktop app's usage answer; the heading reads `Plan` when it is not known. Compact mode and the bar's folded line follow the same order.
- Every agent row in the desktop panel can now be reached. The rows come in pages, with a foot line such as `Rows 8–14 of 16` and Previous and Next icons. Every page keeps to the same 120,000-character size budget and to at most 60 rows. The page follows a row: opening a log keeps its row in view, and when agents start or finish the view stays with its row. A row too large for the budget even alone is replaced by `This row is too large to draw here.` Compact mode pages its lines the same way. The terminal's text panel still ends a long section with `+N more`.

### Changed

- The icon buttons (help, settings, compact, log, copy, fold and the page arrows) now take their press from the icon's own 22 px square, centred on the icon, so that the app's hover box sits on the icon. This has not yet been looked at in the desktop app.

### Fixed

- On a plan with no 5-hour limit, the pill that was switched on simply vanished from the bar. It now shows the next window that exists (see Usage left above).
- In 2.0.5, agent rows past the panel's size budget could not be reached: they were only counted in a `+N more` line. They are now on later pages.
- An answer from the app's usage tool that holds no window the mod knows is no longer counted as a failure, so it no longer brings the mod closer to giving up asking after three failures in a row. The plan's name in such an answer is still kept.

## 2.0.5

### Fixed

- In the desktop app, the agents panel no longer goes blank ("Nothing to show yet: pixel-crew has not drawn in this pane") once a session has run many agents. The app takes the whole panel as one answer and drops one that is too large. Each agent row is a drawing of about 15,000 characters, finished ones included, so 16 finished agents came to about 290,000 characters and the panel was dropped, while the small guide pane still drew. The panel now keeps its drawings under 120,000 characters: rows are drawn in their usual order (working, waiting, planned, then finished newest first) while they fit, and the rest are counted in each section's `+N more` line. The section headings still count every agent. Compact mode keeps to the same budget. The terminal's text panel is unchanged.
- The percent in the bar keeps its 8 px from the end of the progress track. Its column was sized for `100%` as plain text, where `1` counts as narrow, but it is drawn in tabular figures, so it reached 5 px into the gap.

## 2.0.4

### Fixed

- The agent count after the mascot in the bar is no longer cut at the row's right edge. The count is drawn with tabular numerals, where a `1` is as wide as any other digit, but its room was sized as plain text, where a `1` counts as narrow. A count with a `1` in it (`×10`, `×11`, `×16`, `×100`) lost part of its last digit. The count column is now sized for tabular figures: it is 2 px wider for a single digit and up to 5 px wider for `×16`, and the progress track is that much shorter. The percent and the mascot keep their places relative to the track.

## 2.0.3

### Fixed

- After the app restarts a session's process (`--resume`, as when the session hit a usage limit), the agents panel comes back by itself if it was open, instead of reading "Nothing to show yet". The mod remembers in its store, for each session (up to 20), that its panel is open, also across a `/clear`, which goes on under a new session id; closing the panel, by you or by the mod, forgets it for that session alone, and a fresh session or another session's resume opens nothing. The settings and guide panes are not reopened.

## 2.0.2

### Fixed

- The app's vertical scroll bar no longer covers the agents panel's buttons. In Normal and compact mode the panel keeps the rightmost 12 px of the pane clear (12 real pixels at any Panel text size): the title row's icons, the log, copy and fold icons sit left of it, and the cards, headings, rows, logs and the counts line end there, drawn that much narrower. The backdrop still spans the whole pane. The Crew settings and guide panes keep the same 12 px clear. The text panel and the bar are unchanged.

## 2.0.1

### Changed

- The session card, in Normal and compact mode, sits on the same panel as the bar above the prompt (the app's own background colour with a thin rounded border) instead of a grey tile of its own. What the card shows is unchanged.
- Icon buttons (the panel's title row, the bar, the rows, the logs, the Finished fold) are drawn without the rounded-square outline: the icon alone. An active one keeps its soft shaded background.

## 2.0.0

Pixel Crew is now a visual mod only: the agents panel, the bar above the prompt, the Crew settings pane, the guide, `/crew` and the `progress` and `step` tools. Planning and delegating moved to the separate plugin Session Router.

### Removed

- The skills `crew-flow`, `crew-delegate` and `crew-review`.
- The eleven worker agents (`scout`, `sprinter`, `chef`, `engineer`, `detective`, `ace`, `designer`, `writer`, `tester`, `reviewer`, `analyst`).
- Everything that only served them: crew roles and their default models, and the guide text naming the skills. The guide now points to `/session-router:route`.

### Added

- Work kinds: a subagent is drawn by the kind of work it does (Search, Analyze, Build, Refactor, Quick, Debug, Test, Review, Design, Write, Plan, Hard, or Helper), found from its planned task, its subagent type or its description.
- Each agent gets its own shade of its kind's colour. Helpers take one of six fixed colours, never grey.
- The session card at the top of the panel: figures, gauges (bars, rings or none, wrapping four or two to a row) and a usage split of router against subagents, one sliver per subagent, and tokens per model family.
- A new compact mode: a small card, one line for the main agent and each working agent, and the Planned and Finished counts.
- `progress` tasks take `kind`, `model` and `effort`; the phases `research` (`Research`) and `ask` (`Asking`); repeated task titles are numbered and the reply lists the titles to use.
- The `step` line is added to the brief of `session-router:` agents and of agents on planned tasks.
- New defaults: `theme` cat, `palette` ocean, `barColors` kind, `autoOpen` any, `barUsage` ring, `barTurn` and `barTime` on. `autoOpen` takes `plan` in place of `crew`, `barColors` takes `kind` in place of `role`; the old values are still read.
- Agent rows count the cache in `in`; the cache read and write figures moved to the top of the row's log.
- The panel draws at most 60 rows in full; a section cut short ends with a `+N more` line, and its heading still counts every row.
- Compact mode is remembered across sessions.
- The usage split's costs are marked `≈`, as the list-price estimates they are.

### Fixed

1. A plan that finished by itself could not be reopened, so a rejected task's re-run showed as Done.
2. Fable 5.2 and Mythos 5.2 were priced as Fable 5, and bare model aliases as the oldest model in their family.
3. The session's tokens and estimated cost went down when a new plan started, and again once the session passed 200 agents.
4. A stale Claude Code usage window hid the desktop app's fresh one.
5. While nothing worked, the panel's clock stood still (`Resting · last turn 0s ago`, a frozen Time figure).
6. When tool calls overlapped, each one closed the newest open log entry instead of its own.
7. A new plan with the same title and task count as the last one started at 100%.
8. Two planned tasks with the same title needed only one run between them.
9. A Claude Code limit with no percent was drawn as "100% left".
10. The 200-row cap evicted the oldest rows even while they were still running.
11. With a title over 120 characters, the closing report of a self-settled plan wiped its finished agents.
