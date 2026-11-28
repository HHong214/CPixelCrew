// Draws the README's mascot gallery from the mod's own sprite code.
//
//   node tools/mascot-gallery.mjs          writes docs/mascots/ and the README's Mascots section
//   node tools/mascot-gallery.mjs --check  writes nothing; fails if either is out of date
//
// Nothing here is drawn by hand: every picture is `sprite()` and `spriteRules()` from
// hooks/sprites.ts, on the hero card whose paths and colours are read out of hooks/draw.ts,
// put together the way `heroed` and `mascotDoc` there do it. Needs Node 23.6 or newer (it
// loads the .ts files as they are).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = 'docs/mascots'
const SCALE = 3
const START = '<!-- mascots:start (made by tools/mascot-gallery.mjs; edit there, not here) -->'
const END = '<!-- mascots:end -->'
const isCheck = process.argv.includes('--check')

// The mod's files import each other without an extension.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (specifier.startsWith('.')) return next(`${specifier}.ts`, context)
      throw e
    }
  },
})
const load = f => import(pathToFileURL(join(root, f)).href)
const { SPRITE_W, SPRITE_H, SPRITE_ROLES, sprite, spriteRules } = await load('hooks/sprites.ts')
const { KINDS, KIND_KEYS, MAIN_LOOK, OTHER_HUES, THEMES } = await load('hooks/model.ts')

// The hero card, as draw.ts holds it.
const drawSrc = readFileSync(join(root, 'hooks/draw.ts'), 'utf8')
const constant = (name, quote) => {
  const m = drawSrc.match(new RegExp(`const ${name} = ${quote}([^${quote}]*)${quote}`))
  if (!m || m[1].includes('${')) throw new Error(`hooks/draw.ts: cannot read ${name}`)
  return m[1]
}
const HERO_GLASS = constant('HERO_GLASS', "'")
const HERO_FRAME = constant('HERO_FRAME', "'")
const HERO_RULES = constant('HERO_RULES', '`')

const W = (SPRITE_W + 4) * SCALE
const H = (SPRITE_H + 4) * SCALE
const picture = (theme, role, pose, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${HERO_RULES}${spriteRules(theme, role, pose)}</style>` +
  `<g class="hero" transform="translate(0,0) scale(${SCALE})"${pose === 'planned' ? ' opacity="0.45"' : ''}><path class="hero-f" d="${HERO_GLASS}"/><path class="hero-r" fill-rule="evenodd" d="${HERO_FRAME}"/></g>` +
  `${sprite({ theme, role, pose, x: 2 * SCALE, y: 2 * SCALE, scale: SCALE, ...(color ? { color } : {}) })}</svg>\n`

// What the README calls things. The costume words are those of its Work kinds table.
const THEME_TITLE = { cat: 'Cat', clawd: 'Clawd' }
const THEME_NOTE = { cat: '`theme cat`, the default', clawd: '`theme clawd`, the crab' }
const POSE_WORD = { work: 'Working', wait: 'Waiting', rest: 'Resting', done: 'Done', planned: 'Planned', ride: 'Riding its broom' }
const COSTUME = {
  scout: 'pirate hat and cutlass',
  analyst: 'visor and bar chart',
  chef: "chef's toque",
  engineer: 'hard hat and wrench',
  sprinter: 'racing helmet and flag',
  detective: 'deerstalker and magnifier',
  tester: 'safety goggles and flask',
  reviewer: "judge's wig and gavel",
  designer: 'beret and paintbrush',
  writer: 'round glasses and quill',
  planner: 'blueprint and pencil',
  ace: 'astronaut dome',
  helper: 'bandana',
}
// Kinds in the order of the README's Work kinds table.
const ORDER = ['search', 'analyze', 'build', 'refactor', 'quick', 'debug', 'test', 'review', 'design', 'write', 'plan', 'hard', 'other']
if (ORDER.length !== KIND_KEYS.length || !KIND_KEYS.every(k => ORDER.includes(k))) throw new Error('ORDER does not list every kind in hooks/model.ts')
for (const k of ORDER) if (!COSTUME[KINDS[k].sprite]) throw new Error(`no costume words for ${KINDS[k].sprite}`)
const costumes = ORDER.map(k => KINDS[k].sprite)
if ([MAIN_LOOK.sprite, ...costumes].slice().sort().join() !== [...SPRITE_ROLES].sort().join()) throw new Error('the kinds do not cover every costume in hooks/sprites.ts')

// The poses the mod shows (draw.ts): the main agent works, waits and rests, and in the bar's
// progress row the cat rides its broom while the crab is done; an agent works, waits and is
// done; a planned task is dimmed. The crab has no broom: its `ride` is its `work`.
const MAIN_POSES = { cat: ['work', 'wait', 'rest', 'ride'], clawd: ['work', 'wait', 'rest', 'done'] }
const AGENT_POSES = ['work', 'wait', 'done', 'planned']
// Drawn by sprites.ts, shown nowhere today.
const MAIN_UNUSED = { cat: ['done', 'planned'], clawd: ['planned'] }
const AGENT_UNUSED = { cat: ['rest', 'ride'], clawd: ['rest'] }

const files = new Map()
const img = (theme, role, pose, alt, n) => {
  const path = `${OUT}/${theme}/${role}-${pose}${n ? `-${n + 1}` : ''}.svg`
  files.set(path, picture(theme, role, pose, n === undefined ? undefined : OTHER_HUES[n]))
  return `<img src="${path}" width="${W}" height="${H}" alt="${alt}">`
}
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')

const section = theme => {
  const name = THEME_TITLE[theme]
  const mainRow = poses => poses.map(p => img(theme, MAIN_LOOK.sprite, p, `${name}: ${MAIN_LOOK.label}, ${POSE_WORD[p].toLowerCase()}`))
  const kindCell = k => `**${KINDS[k].label}**<br>${COSTUME[KINDS[k].sprite]}`
  const kindRows = poses => ORDER.map(k => [kindCell(k), ...poses.map(p => img(theme, KINDS[k].sprite, p, `${name}: ${KINDS[k].label}, ${POSE_WORD[p].toLowerCase()}`))])
  const where = theme === 'cat'
    ? 'Working, waiting and resting are the main row of the panel. Riding is the bar\'s progress row, while a plan or a run is running and once it is done.'
    : 'Working, waiting and resting are the main row of the panel. The crab has no broom: in the bar\'s progress row it works while a plan or a run is running and takes its done pose once it is done.'
  return [
    `### ${name} (${THEME_NOTE[theme]})`,
    `**${MAIN_LOOK.label}, the main agent.** ${where}`,
    table(MAIN_POSES[theme].map(p => POSE_WORD[p]), [mainRow(MAIN_POSES[theme])]),
    '**Agents, by kind of work.** Working, waiting and done are an agent\'s row; planned is a task no agent has started yet.',
    table(['Kind', ...AGENT_POSES.map(p => POSE_WORD[p])], kindRows(AGENT_POSES)),
    `**${KINDS.other.label}'s six colours.** A ${KINDS.other.label} takes one of them from its description.`,
    table(OTHER_HUES.map(c => `\`${c}\``), [OTHER_HUES.map((c, n) => img(theme, KINDS.other.sprite, 'work', `${name}: ${KINDS.other.label} in ${c}, working`, n))]),
    `<details>\n<summary>${name}: drawn by the sprite code, shown nowhere in the mod today</summary>`,
    theme === 'cat'
      ? `${MAIN_LOOK.label} is never drawn done or planned, and an agent never rests or rides, so these never appear.`
      : `${MAIN_LOOK.label} is never drawn planned, and an agent never rests, so these never appear.`,
    table(MAIN_UNUSED[theme].map(p => `${MAIN_LOOK.label}: ${POSE_WORD[p].toLowerCase()}`), [mainRow(MAIN_UNUSED[theme])]),
    table(['Kind', ...AGENT_UNUSED[theme].map(p => POSE_WORD[p])], kindRows(AGENT_UNUSED[theme])),
    '</details>',
  ].join('\n\n')
}

const order = [...THEMES].sort((a, b) => (a === 'cat' ? -1 : b === 'cat' ? 1 : 0))
const body = [
  START,
  `Every mascot the mod draws, in both themes. The pictures are in \`${OUT}/\`, made from the mod's own sprite code by \`node tools/mascot-gallery.mjs\`, and they move as they do in the app (not when your system asks for reduced motion). Each sits on the hero card the agents panel draws by default; the bar draws its mascot without a card. A costume is shown in its kind's base colour (see Work kinds).`,
  ...order.map(section),
  END,
].join('\n\n')

// The README: the block between the two marks, in the file's own line endings.
const readmePath = join(root, 'README.md')
const readme = readFileSync(readmePath, 'utf8')
const eol = readme.includes('\r\n') ? '\r\n' : '\n'
const a = readme.indexOf(START)
const b = readme.indexOf(END)
if (a < 0 || b < a) throw new Error(`README.md: put the two marks under the Mascots heading:\n${START}\n${END}`)
const next = readme.slice(0, a) + body.split('\n').join(eol) + readme.slice(b + END.length)

const stale = []
const onDisk = existsSync(join(root, OUT))
  ? readdirSync(join(root, OUT), { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name))
  : []
const wanted = new Set([...files.keys()].map(f => join(root, f)))
for (const f of onDisk) if (!wanted.has(f)) stale.push(`${f} is not in the gallery`)
for (const [f, svg] of files) if (!existsSync(join(root, f)) || readFileSync(join(root, f), 'utf8') !== svg) stale.push(`${f} is out of date`)
if (next !== readme) stale.push('README.md: the Mascots section is out of date')

if (isCheck) {
  if (stale.length) {
    console.error(stale.join('\n'))
    process.exit(1)
  }
  console.log(`mascot gallery: ${files.size} pictures and the README are up to date`)
} else {
  for (const f of onDisk) if (!wanted.has(f)) rmSync(f)
  for (const [f, svg] of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), svg)
  }
  if (next !== readme) writeFileSync(readmePath, next)
  console.log(`mascot gallery: wrote ${files.size} pictures to ${OUT}/ and the README's Mascots section`)
}
