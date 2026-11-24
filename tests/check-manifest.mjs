// Checks that plugin.json's `userConfig` declares exactly the options hooks/model.ts
// reads: the same keys in the same order, the same kinds, defaults, pickers and ranges.
// It also holds the plugin's name to CPixelCrew (by HHong214) in the manifests, in the
// marketplace, and in every identifier the engine sees that hooks/ and types/ spell out:
// the tool server name, the prefix of the option keys, the `$.state` plugin key, the name
// the settings texts show. A test cannot read plugin.json, so this runs on its own:
//
//   node tests/check-manifest.mjs        (from the plugin folder; exits 1 on any mismatch)
//
// model.ts is imported directly (Node 22.18+ strips its types); if that fails it is
// bundled with esbuild into a temporary file first.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = join(root, '.claude-plugin', 'plugin.json')
const modelPath = join(root, 'hooks', 'model.ts')

async function loadModel() {
  try {
    return await import(pathToFileURL(modelPath).href)
  } catch (direct) {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-crew-manifest-'))
    try {
      const out = join(dir, 'model.mjs')
      execFileSync('npx', ['-y', 'esbuild', modelPath, '--bundle', '--format=esm', '--platform=neutral', `--outfile=${out}`, '--log-level=warning'], {
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: process.platform === 'win32',
      })
      return await import(pathToFileURL(out).href)
    } catch (bundled) {
      throw new Error(`could not load hooks/model.ts: ${direct?.message ?? direct}; bundling failed too: ${bundled?.message ?? bundled}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const show = v => JSON.stringify(v)

// v6: 23 options; after `barUsage`, one boolean per bar item in the fixed item order, then
// `barTooltips`; five text mirrors the mod writes (the rate and the four stored sizes).
// No number options (the sizes live in the mod's store) and no reset toggle (v6 removed
// `resetAll`; `/crew reset` stays). Every picker lists its default first.
const OPTION_COUNT = 23
const TITLES = {
  theme: 'Look: mascot',
  palette: 'Look: colours',
  barColors: 'Look: working bars',
  background: 'Look: panel background',
  animations: 'Look: animations',
  currency: 'Money: currency',
  rateNow: 'Money: exchange rate (shown only)',
  panelUsage: 'Panel: usage meters',
  autoOpen: 'Panel: opens by itself',
  barUsage: 'Bar: meter style',
  barContext: 'Bar: show context',
  barFiveHour: 'Bar: show usage left',
  barWeek: 'Bar: show weekly limit',
  barModelWeek: 'Bar: show model weekly limit',
  barSpeed: 'Bar: show speed',
  barCache: 'Bar: show cache countdown',
  barTurn: 'Bar: show turn number',
  barTime: 'Bar: show session time',
  barTooltips: 'Bar: hover cards',
  textSizeNow: 'Size: panel text (shown only)',
  iconSizeNow: 'Size: mascots (shown only)',
  barSizeNow: 'Size: bar (shown only)',
  logLinesNow: 'Panel: log lines (shown only)',
}
const GONE = ['guide', 'tooltips', 'barItems', 'rateSource', 'customRate', 'textSize', 'iconSize', 'barSize', 'logLines', 'resetAll']
// What each picker lists, default first, as SPEC section 2.4 states it.
const PICKERS = {
  theme: ['cat', 'clawd'],
  palette: ['ocean', 'sunset', 'classic'],
  barColors: ['kind', 'palette'],
  background: ['plain', 'dots', 'grid'],
  panelUsage: ['bar', 'ring', 'off'],
  autoOpen: ['any', 'plan', 'never'],
  barUsage: ['ring', 'bar'],
}
// The defaults SPEC section 2.4 sets: every bar item on.
const DEFAULTS = {
  theme: 'cat',
  palette: 'ocean',
  barColors: 'kind',
  background: 'plain',
  animations: true,
  currency: 'GBP',
  panelUsage: 'bar',
  autoOpen: 'any',
  barUsage: 'ring',
  barContext: true,
  barFiveHour: true,
  barWeek: true,
  barModelWeek: true,
  barSpeed: true,
  barCache: true,
  barTurn: true,
  barTime: true,
  barTooltips: true,
}
// The size mirrors and the size each one shows.
const SIZE_MIRRORS = { textSizeNow: 'textSize', iconSizeNow: 'iconSize', barSizeNow: 'barSize', logLinesNow: 'logLines' }

function check(manifest, model) {
  const { OPTION_KEYS, OPTION_DEFAULTS, OPTION_CHOICES, DEFAULT_SETTINGS, DEFAULT_SIZES, DEFAULT_BAR_ORDER, BAR_ITEMS, CURRENCIES, MIRROR_KEYS, SETTING_OPTION_KEYS, FALLBACK_RATES, settingsFromOptions, mirrorValues } = model
  const errors = []
  const fail = (key, message) => errors.push(key ? `userConfig.${key}: ${message}` : message)

  const config = manifest?.userConfig
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    fail('', 'plugin.json has no userConfig object')
    return errors
  }

  const keys = Object.keys(config)
  if (!isDeepStrictEqual(keys, [...OPTION_KEYS])) {
    const missing = OPTION_KEYS.filter(k => !keys.includes(k))
    const extra = keys.filter(k => !OPTION_KEYS.includes(k))
    fail('', `userConfig keys differ from OPTION_KEYS`)
    if (missing.length) fail('', `  missing: ${missing.join(', ')}`)
    if (extra.length) fail('', `  not read by model.ts: ${extra.join(', ')}`)
    if (!missing.length && !extra.length) fail('', `  order is ${keys.join(', ')}; expected ${OPTION_KEYS.join(', ')}`)
  }

  if (keys.length !== OPTION_COUNT) fail('', `userConfig has ${keys.length} options; v6 has ${OPTION_COUNT}`)
  if (OPTION_KEYS.length !== OPTION_COUNT) fail('', `OPTION_KEYS has ${OPTION_KEYS.length} keys; v6 has ${OPTION_COUNT}`)
  if (!isDeepStrictEqual(Object.keys(TITLES), [...OPTION_KEYS])) fail('', `OPTION_KEYS are not the v6 options in order: ${OPTION_KEYS.join(', ')}`)
  for (const k of GONE) if (keys.includes(k)) fail(k, 'was removed (v4, v5 or v6)')
  for (const k of GONE) if (OPTION_KEYS.includes(k)) fail(k, 'was removed but OPTION_KEYS still lists it')
  const barKeys = BAR_ITEMS.map(b => b.option)
  if (!isDeepStrictEqual(keys.slice(keys.indexOf('barUsage') + 1, keys.indexOf('barUsage') + 1 + barKeys.length), barKeys)) fail('', `the options after barUsage are not ${barKeys.join(', ')}`)
  for (const k of keys) if (Object.hasOwn(TITLES, k) && config[k]?.title !== TITLES[k]) fail(k, `title is ${show(config[k]?.title)}; expected ${show(TITLES[k])}`)
  for (const k of [...barKeys, 'animations', 'barTooltips']) if (config[k]?.type !== 'boolean') fail(k, 'must be a boolean')

  // The mirrors: free text the mod writes; the real settings are every other option.
  for (const k of MIRROR_KEYS) {
    const field = config[k]
    if (field?.type !== 'string') fail(k, 'a mirror must be a string')
    if (field && 'options' in field) fail(k, 'a mirror must have no options')
  }
  if (!isDeepStrictEqual([...SETTING_OPTION_KEYS], OPTION_KEYS.filter(k => !MIRROR_KEYS.includes(k)))) fail('', 'SETTING_OPTION_KEYS are not every option but the mirrors')
  const builtIn = mirrorValues(DEFAULT_SETTINGS, { at: 0, rates: FALLBACK_RATES, isLive: false })
  for (const [k, size] of Object.entries(SIZE_MIRRORS)) {
    if (config[k]?.default !== builtIn[k]) fail(k, `default is ${show(config[k]?.default)}; mirrorValues(DEFAULT_SETTINGS) gives ${show(builtIn[k])}`)
    if (builtIn[k] !== `${DEFAULT_SIZES[size]}${size === 'logLines' ? '' : '%'}`) fail(k, `mirrors ${show(builtIn[k])}, not DEFAULT_SIZES.${size}`)
  }
  if (config.rateNow?.default !== '') fail('rateNow', `default is ${show(config.rateNow?.default)}; expected an empty string`)

  for (const key of keys) {
    const field = config[key]
    if (typeof field !== 'object' || field === null || Array.isArray(field)) {
      fail(key, 'is not an object')
      continue
    }
    if (!/^[A-Za-z0-9_]+$/.test(key)) fail(key, 'key may hold only letters, digits and underscores')
    for (const prop of ['title', 'description']) {
      if (typeof field[prop] !== 'string' || !field[prop].trim()) fail(key, `has no ${prop}`)
    }
    if (!['string', 'number', 'boolean', 'directory', 'file'].includes(field.type)) fail(key, `type ${show(field.type)} is not one the engine knows`)
    if ('options' in field && field.type !== 'string') fail(key, '`options` is allowed only on a string')
    if (('min' in field || 'max' in field) && field.type !== 'number') fail(key, '`min`/`max` are allowed only on a number')

    if (!OPTION_KEYS.includes(key)) continue
    const expected = OPTION_DEFAULTS[key]
    if (field.type !== typeof expected) fail(key, `type is ${show(field.type)}; model.ts reads a ${typeof expected}`)
    if (!isDeepStrictEqual(field.default, expected)) fail(key, `default is ${show(field.default)}; OPTION_DEFAULTS has ${show(expected)}`)

    const choices = OPTION_CHOICES[key]
    if (choices) {
      if (!isDeepStrictEqual(field.options, [...choices])) fail(key, `options are ${show(field.options)}; model.ts allows ${show([...choices])}`)
    } else if ('options' in field) {
      fail(key, `has options ${show(field.options)} but model.ts reads it as free ${typeof expected === 'string' ? 'text' : typeof expected}`)
    }
    if (Array.isArray(field.options)) {
      // The plugin screen lists the options as given: the default must come first.
      if (field.options[0] !== field.default) fail(key, `options start with ${show(field.options[0])}; the default ${show(field.default)} must come first`)
      for (const o of field.options) if (typeof o !== 'string' || o.length < 1 || o.length > 64) fail(key, `option ${show(o)} must be a string of 1-64 characters`)
    }

    if (field.type === 'number') fail(key, 'v6 has no number options: the sizes live in the store')
  }

  for (const [k, want] of Object.entries(DEFAULTS)) if (config[k]?.default !== want) fail(k, `default is ${show(config[k]?.default)}; the spec sets ${show(want)}`)

  // Each picker as the spec lists it; currency: GBP, then the rest in the table's order.
  const pickers = { ...PICKERS, currency: ['GBP', ...CURRENCIES.map(c => c.code).filter(c => c !== 'GBP')] }
  for (const [k, want] of Object.entries(pickers)) {
    if (!isDeepStrictEqual(config[k]?.options, want)) fail(k, `options are ${show(config[k]?.options)}; v6 lists ${show(want)}`)
  }
  for (const k of keys) if (Array.isArray(config[k]?.options) && !Object.hasOwn(pickers, k)) fail(k, 'a picker v6 does not list')

  // What the engine hands register() with nothing set and no sizes stored must read as the model's defaults.
  const fromManifest = Object.fromEntries(keys.map(k => [k, config[k]?.default]))
  if (!isDeepStrictEqual(settingsFromOptions(fromManifest, DEFAULT_SIZES), DEFAULT_SETTINGS)) {
    fail('', `the manifest's defaults read as ${show(settingsFromOptions(fromManifest, DEFAULT_SIZES))}, not DEFAULT_SETTINGS`)
  }
  if (!isDeepStrictEqual(settingsFromOptions(fromManifest), DEFAULT_SETTINGS)) fail('', 'with no sizes stored, the manifest defaults do not read as DEFAULT_SETTINGS')
  if (!isDeepStrictEqual(settingsFromOptions(fromManifest, DEFAULT_SIZES, DEFAULT_BAR_ORDER), DEFAULT_SETTINGS)) fail('', 'with the default sizes and bar order, the manifest defaults do not read as DEFAULT_SETTINGS')
  return errors
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (e) {
  console.error(`check-manifest: cannot read ${manifestPath}: ${e.message}`)
  process.exit(1)
}

let model
try {
  model = await loadModel()
} catch (e) {
  console.error(`check-manifest: ${e.message}`)
  process.exit(1)
}

// The name the mod has been renamed to, and everything that must carry it.
const NAME = 'CPixelCrew'
const AUTHOR = 'HHong214'
const MARKETPLACE = 'cpixelcrew'

function checkIdentity(manifest, model) {
  const errors = []
  const fail = message => errors.push(`identity: ${message}`)
  const read = path => readFileSync(join(root, path), 'utf8')
  const same = (what, got, want) => {
    if (got !== want) fail(`${what} is ${show(got)}, want ${show(want)}`)
  }

  same('plugin.json name', manifest.name, NAME)
  same('plugin.json author.name', manifest.author?.name, AUTHOR)
  let market
  try {
    market = JSON.parse(read('.claude-plugin/marketplace.json'))
  } catch (e) {
    fail(`cannot read marketplace.json: ${e.message}`)
  }
  if (market) {
    same('marketplace.json name', market.name, MARKETPLACE)
    same('marketplace.json owner.name', market.owner?.name, AUTHOR)
    same('marketplace.json plugin count', market.plugins?.length, 1)
    same('marketplace.json plugin name', market.plugins?.[0]?.name, NAME)
    same('marketplace.json plugin source', market.plugins?.[0]?.source, './')
  }
  same('model.ts PLUGIN', model.PLUGIN, NAME)

  // What hooks/ and types/ spell out. Each old form must be gone; each new one must be there.
  const files = ['hooks/register.tsx', 'hooks/model.ts', 'hooks/draw.ts', 'types/index.d.ts']
  const text = Object.fromEntries(files.map(f => [f, read(f)]))
  const old = [
    [/mcp__pixel-crew__/, 'the tool server name pixel-crew (mcp__pixel-crew__...)'],
    [/pixel-crew.[a-zA-Z$]/, 'the option key prefix pixel-crew.'],
    [/plugin: 'pixel-crew'/, "the state plugin key 'pixel-crew'"],
    [/'pixel-crew': {/, "the PluginState key 'pixel-crew'"],
    [/Plugins > pixel-crew/, 'the plugin name in the settings texts (Plugins > pixel-crew)'],
    [/crew-local/, 'the marketplace name crew-local'],
  ]
  for (const f of files) for (const [re, what] of old) if (re.test(text[f])) fail(`${f} still has ${what}`)
  const want = [
    ['hooks/register.tsx', "'mcp__CPixelCrew__progress'"],
    ['hooks/register.tsx', "'mcp__CPixelCrew__step'"],
    ['hooks/register.tsx', "'CPixelCrew.'"],
    ['hooks/register.tsx', "{ plugin: 'CPixelCrew', key: 'flow' }"],
    ['hooks/register.tsx', 'Plugins > CPixelCrew'],
    ['hooks/model.ts', "PLUGIN = 'CPixelCrew'"],
    ['types/index.d.ts', "'CPixelCrew': {"],
  ]
  for (const [f, what] of want) if (!text[f].includes(what)) fail(`${f} does not have ${what}`)
  return errors
}

const errors = [...check(manifest, model), ...checkIdentity(manifest, model)]
if (errors.length) {
  console.error(`check-manifest: the manifest, the marketplace or the code disagrees with hooks/model.ts or the CPixelCrew name (${errors.length}):`)
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
console.log(`check-manifest: ok, ${Object.keys(manifest.userConfig).length} options match hooks/model.ts, and the name is ${NAME}`)
