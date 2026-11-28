// Pure tests for hooks/sprites.ts: no `$`, no hooks, just markup in and out.
import { expect, test } from 'claude-code/testing'
import type { ThemeName } from '../types'
import type { Pose } from '../hooks/sprites'
import { SPRITE_H, SPRITE_ROLES, SPRITE_W, sprite, spriteCss, spriteDoc } from '../hooks/sprites'
import { KINDS, KIND_KEYS } from '../hooks/model'

const THEMES: ThemeName[] = ['clawd', 'cat']
const POSES: Pose[] = ['work', 'rest', 'wait', 'done', 'planned', 'ride']
const BUDGET = 12_000

// The host drawings' own class names; a sprite must never reuse one.
const HOST_CLASSES = ['t', 's', 'm', 'k', 'ln', 'tile', 'live', 't0', 't1', 't2', 't3', 'tk', 'd']

// A tiny tag checker: '' when every tag is closed in order and no bracket is
// left over, else what went wrong.
const malformed = (src: string): string => {
  const stack: string[] = []
  let last = 0
  for (const m of src.matchAll(/<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g)) {
    if (/[<>]/.test(src.slice(last, m.index))) return `stray bracket before <${m[2]}>`
    last = m.index + m[0].length
    const name = m[2] ?? ''
    if (m[1]) {
      if (stack.pop() !== name) return `unexpected </${name}>`
    } else if (!m[4]) stack.push(name)
  }
  if (/[<>]/.test(src.slice(last))) return 'stray bracket at the end'
  return stack.length ? `unclosed <${stack.join('> <')}>` : ''
}

const each = (run: (theme: ThemeName, role: string, pose: Pose) => void): void => {
  for (const theme of THEMES) for (const role of SPRITE_ROLES) for (const pose of POSES) run(theme, role, pose)
}
const draw = (theme: ThemeName, role: string, pose: Pose = 'done'): string => sprite({ theme, role, pose, x: 0, y: 0 })

test('the grid and the role list match the spec', async () => {
  expect(SPRITE_W).toBe(30)
  expect(SPRITE_H).toBe(28)
  expect([...SPRITE_ROLES]).toEqual(['main', 'ace', 'detective', 'engineer', 'chef', 'sprinter', 'scout', 'designer', 'writer', 'tester', 'reviewer', 'analyst', 'planner', 'helper'])
})

test('every role, pose and theme yields well-formed markup under the size budget', async () => {
  let count = 0
  each((theme, role, pose) => {
    const g = draw(theme, role, pose)
    const where = `${theme}/${role}/${pose}`
    expect(`${where}: ${malformed(g)}`).toBe(`${where}: `)
    expect(g.startsWith('<g transform="translate(0,0) scale(1.1)"')).toBe(true)
    // No rendering hint: the desktop app runs no animation in a picture that sets one.
    expect(g).not.toContain('shape-rendering')
    expect(g).not.toMatch(/NaN|undefined|null|Infinity/)
    expect(g).not.toMatch(/fill="\s*"/)
    expect(g.length).toBeLessThan(BUDGET)
    expect(g.length).toBeGreaterThan(400)
    count += 1
  })
  expect(count).toBe(2 * 14 * 6)
})

test('every pixel stays inside the 30 x 28 box', async () => {
  each((theme, role, pose) => {
    const rects = [...draw(theme, role, pose).matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    expect(rects.length).toBeGreaterThan(5)
    for (const r of rects) {
      const [x, y, w, h] = [Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])]
      const isInside = Number.isInteger(x) && Number.isInteger(y) && w >= 1 && h >= 1 && x >= 0 && y >= 0 && x + w <= SPRITE_W && y + h <= SPRITE_H
      expect(`${theme}/${role}/${pose} ${x},${y} ${w}x${h} ${isInside}`).toBe(`${theme}/${role}/${pose} ${x},${y} ${w}x${h} true`)
    }
  })
})

test('class names carry the theme prefix and never a host class', async () => {
  each((theme, role, pose) => {
    const prefix = theme === 'cat' ? 'ct' : 'cw'
    const names = [...draw(theme, role, pose).matchAll(/class="([^"]*)"/g)].flatMap(m => (m[1] ?? '').split(' '))
    expect(names.length).toBeGreaterThan(2)
    for (const name of names) {
      expect(name === prefix || name.startsWith(`${prefix}-`)).toBe(true)
      expect(HOST_CLASSES.includes(name)).toBe(false)
    }
    expect(names).toContain(`${prefix}-r-${role}`)
    // The crab has no broom: it rides by working.
    expect(names).toContain(`${prefix}-${theme === 'clawd' && pose === 'ride' ? 'work' : pose}`)
  })
})

test('an unknown role draws the helper', async () => {
  for (const theme of THEMES) for (const pose of POSES) {
    expect(draw(theme, 'no-such-role', pose)).toBe(draw(theme, 'helper', pose))
    expect(draw(theme, '', pose)).toBe(draw(theme, 'helper', pose))
    expect(draw(theme, 'constructor', pose)).toBe(draw(theme, 'helper', pose))
  }
  expect(draw('cat', 'helper')).not.toBe(draw('cat', 'main'))
})

test('planned is drawn at 45% opacity, the other poses at full strength', async () => {
  each((theme, role, pose) => {
    const head = draw(theme, role, pose).slice(0, 120)
    if (pose === 'planned') expect(head).toContain('opacity="0.45"')
    else expect(head).not.toContain('opacity=')
  })
})

test('place, scale and mirror set the transform', async () => {
  for (const theme of THEMES) {
    const plain = sprite({ theme, role: 'chef', pose: 'work', x: 12, y: 7 })
    const big = sprite({ theme, role: 'chef', pose: 'work', x: 12, y: 7, scale: 2.4 })
    const mirrored = sprite({ theme, role: 'chef', pose: 'work', x: 12, y: 7, mirror: true })
    expect(plain).toContain('transform="translate(12,7) scale(1.1)"')
    expect(big).toContain('transform="translate(12,7) scale(2.4)"')
    // Flipped inside its own box: the origin moves to the box's right edge.
    expect(mirrored).toContain('transform="translate(45,7) scale(-1.1,1.1)"')
    expect(mirrored).not.toBe(plain)
    expect(mirrored.replace(/transform="[^"]*"/, '')).toBe(plain.replace(/transform="[^"]*"/, ''))
    expect(sprite({ theme, role: 'chef', pose: 'work', x: 12, y: 7, mirror: false })).toBe(plain)
    // A bad scale falls back to the default rather than writing NaN.
    expect(sprite({ theme, role: 'chef', pose: 'work', x: 12, y: 7, scale: Number.NaN })).toBe(plain)
    expect(sprite({ theme, role: 'chef', pose: 'work', x: 12, y: 7, scale: 0 })).toBe(plain)
  }
})

test('rest and wait carry their marks, the other poses none', async () => {
  for (const theme of THEMES) {
    const p = theme === 'cat' ? 'ct' : 'cw'
    for (const role of SPRITE_ROLES) {
      expect(draw(theme, role, 'rest')).toContain(`class="${p}-z1"`)
      expect(draw(theme, role, 'rest')).toContain(`class="${p}-z2"`)
      // The crab blinks behind lids; the curled cat sleeps with its eyes shut.
      if (theme === 'clawd') expect(draw(theme, role, 'rest')).toContain('class="cw-lid"')
      expect(draw(theme, role, 'wait')).toContain(`class="${p}-w1"`)
      expect(draw(theme, role, 'wait')).toContain(`class="${p}-w3"`)
      for (const pose of ['work', 'done', 'planned', 'ride'] as const) {
        expect(draw(theme, role, pose)).not.toContain(`${p}-mk`)
        expect(draw(theme, role, pose)).not.toContain(`${p}-lid`)
      }
    }
    // The z's are pre-mirrored on a mirrored sprite so they still read as z's.
    const z = (g: string): string => g.slice(g.indexOf(`class="${p}-mk"`))
    expect(z(sprite({ theme, role: 'main', pose: 'rest', x: 0, y: 0, mirror: true }))).not.toBe(z(draw(theme, 'main', 'rest')))
    expect(z(sprite({ theme, role: 'main', pose: 'wait', x: 0, y: 0, mirror: true }))).toBe(z(draw(theme, 'main', 'wait')))
  }
})

test('spriteCss is one style block per theme with a reduced-motion rule', async () => {
  const crab = spriteCss('clawd')
  const cat = spriteCss('cat')
  expect(crab).not.toBe(cat)
  for (const [css, p] of [[crab, 'cw'], [cat, 'ct']] as const) {
    expect(css.startsWith('<style>')).toBe(true)
    expect(css.endsWith('</style>')).toBe(true)
    expect(css.match(/<style>/g)?.length).toBe(1)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^}]*animation:none!important/)
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).not.toMatch(/NaN|undefined|null/)
    // Every class and every keyframe name is the theme's own.
    for (const m of css.matchAll(/\.([A-Za-z][\w-]*)/g)) expect(m[1] === p || (m[1] ?? '').startsWith(`${p}-`)).toBe(true)
    const frames = [...css.matchAll(/@keyframes ([\w-]+)/g)].map(m => m[1] ?? '')
    expect(frames.length).toBeGreaterThan(10)
    for (const name of frames) expect(name.startsWith(`${p}-`)).toBe(true)
    for (const m of css.matchAll(/animation:([\w-]+)/g)) if (m[1] !== 'none') expect(frames).toContain(m[1])
    let depth = 0
    for (const ch of css) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0
    expect(depth).toBe(0)
  }
  // The work loops of both themes: the crab's legs, the cat's tail frames.
  expect(crab).toContain('.cw-work .cw-la{animation:cw-st .5s steps(1) infinite}')
  expect(cat).toContain('.ct-t0{animation:ct-f0 1s steps(1) infinite}')
})

test('the six ported crab costumes keep their signature colours', async () => {
  const signature: Record<string, string[]> = {
    ace: ['#9774DC', '#E6E8EE', 'rgba(169,214,245,.32)', '#F5C542'],
    detective: ['#D86931', '#7A4A26', '#A0703F', '#5A3519', '#3A3A3C', 'rgba(169,214,245,.7)'],
    engineer: ['#BB811B', '#F5C542', '#FBE08A', '#C99A1E', '#8E929A'],
    chef: ['#367FDD', '#F4F3EE', '#D2D1C8', '#B45F43', '#4A4A48', '#F5B731'],
    sprinter: ['#23A97F', '#F8F6F1', '#1F1E1D', '#8E929A'],
    scout: ['#55514C', '#F8F6F1', '#F5C542', '#C9CCD2', '#7A4A26'],
  }
  for (const [role, colours] of Object.entries(signature)) {
    const g = draw('clawd', role)
    for (const c of colours) expect(g).toContain(c)
    expect(g).toContain('#D97757')
  }
  expect(draw('clawd', 'main')).not.toContain('cw-it')
})

// The ported costumes, pixel for pixel. The reference below is savvy-progress's
// own drawing (crabBody, stamp, COSTUMES) transcribed in its paint order: body
// and costume first, then each prop group, then the legs. Both sides are rasterised to a
// 30 x 28 grid of "what colour ends up in this pixel" and compared.
type Paint = [x: number, y: number, w: number, h: number, c: string]
const CLAY = '#D97757'
const INK = '#1F1E1D'
const refStamp = (out: Paint[], x: number, y: number, rows: string[], map: Record<string, string>): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => { const c = map[ch]; if (c) out.push([x + dx, y + dy, 1, 1, c]) }))
const refBody = (out: Paint[]): void => {
  out.push([7, 10, 16, 12, CLAY], [3, 14, 4, 4, CLAY], [9, 12, 2, 2, INK], [19, 12, 2, 2, INK])
}
const refLegs = (out: Paint[]): Paint[] => {
  out.push([7, 22, 2, 4, CLAY], [17, 22, 2, 4, CLAY], [11, 22, 2, 4, CLAY], [21, 22, 2, 4, CLAY])
  return out
}
const REFERENCE: Record<string, () => Paint[]> = {
  main: () => { const o: Paint[] = []; refBody(o); o.push([23, 14, 4, 4, CLAY]); return refLegs(o) },
  ace: () => {
    const o: Paint[] = []
    refBody(o); o.push([23, 14, 4, 4, CLAY])
    o.push([6, 7, 18, 1, '#E6E8EE'], [5, 8, 1, 14, '#E6E8EE'], [24, 8, 1, 14, '#E6E8EE'], [6, 22, 18, 1, '#C9CCD2'])
    o.push([6, 8, 18, 14, 'rgba(169,214,245,.32)'], [8, 9, 2, 1, '#fff'], [8, 10, 1, 2, '#fff'])
    o.push([14, 4, 2, 3, '#C9CCD2'], [13, 18, 4, 2, '#9774DC'], [14, 2, 2, 2, '#9774DC'])
    o.push([27, 3, 1, 3, '#F5C542'], [26, 4, 3, 1, '#F5C542'])
    return refLegs(o)
  },
  detective: () => {
    const o: Paint[] = []
    refBody(o)
    refStamp(o, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    o.push([6, 9, 18, 1, '#D86931'], [23, 10, 4, 4, CLAY])
    refStamp(o, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' })
    o.push([24, 2, 3, 3, 'rgba(169,214,245,.7)'], [25, 6, 1, 4, '#7A4A26'], [24, 2, 1, 1, '#fff'])
    return refLegs(o)
  },
  engineer: () => {
    const o: Paint[] = []
    refBody(o); o.push([23, 14, 4, 4, CLAY])
    refStamp(o, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    o.push([13, 5, 4, 2, '#BB811B'])
    refStamp(o, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' })
    return refLegs(o)
  },
  chef: () => {
    const o: Paint[] = []
    refBody(o)
    refStamp(o, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: '#367FDD', d: '#B45F43' })
    o.push([23, 10, 4, 4, CLAY], [22, 8, 7, 2, '#4A4A48'], [26, 10, 1, 1, '#4A4A48'], [24, 7, 3, 1, '#F5B731'])
    return refLegs(o)
  },
  sprinter: () => {
    const o: Paint[] = []
    refBody(o); o.push([23, 10, 4, 4, CLAY])
    refStamp(o, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: '#23A97F', w: '#F8F6F1', k: INK })
    o.push([25, 1, 1, 9, '#8E929A'])
    refStamp(o, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK })
    return refLegs(o)
  },
  scout: () => {
    const o: Paint[] = []
    refBody(o); o.push([23, 14, 4, 4, CLAY])
    refStamp(o, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    o.push([7, 11, 11, 1, INK], [18, 11, 4, 3, INK], [27, 6, 1, 9, '#C9CCD2'], [26, 15, 3, 1, '#7A4A26'])
    return refLegs(o)
  },
}

const raster = (paints: Paint[]): string[] => {
  const grid: string[] = Array.from({ length: SPRITE_W * SPRITE_H }, () => '')
  for (const [x, y, w, h, c] of paints) {
    for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) {
      const i = (y + dy) * SPRITE_W + x + dx
      // A see-through colour tints what is under it; a solid one replaces it.
      grid[i] = c.startsWith('rgba') ? `${grid[i] ?? ''}+${c}` : c
    }
  }
  return grid
}

// Reads a sprite's rects back in document order, a <g fill> lending its colour.
const paintsOf = (g: string): Paint[] => {
  const out: Paint[] = []
  const fills: string[] = []
  for (const m of g.matchAll(/<(\/?)(g|rect)([^>]*?)(\/?)>/g)) {
    const attrs = m[3] ?? ''
    const fill = /\sfill="([^"]*)"/.exec(attrs)?.[1]
    if (m[2] === 'g') {
      if (m[1]) fills.pop()
      else fills.push(fill ?? fills.at(-1) ?? '')
      continue
    }
    const n = (name: string): number => Number(new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1])
    out.push([n('x'), n('y'), n('width'), n('height'), fill ?? fills.at(-1) ?? ''])
  }
  return out
}

test('the ported crab costumes are pixel for pixel the savvy-progress art', async () => {
  for (const [role, reference] of Object.entries(REFERENCE)) {
    const want = raster(reference())
    for (const pose of ['work', 'done', 'planned'] as const) {
      const got = raster(paintsOf(draw('clawd', role, pose)))
      const diff = got.flatMap((c, i) => (c === want[i] ? [] : [`${i % SPRITE_W},${Math.floor(i / SPRITE_W)} ${c || 'empty'} != ${want[i] || 'empty'}`]))
      expect(`${role}/${pose}: ${diff.slice(0, 5).join('; ')}`).toBe(`${role}/${pose}: `)
    }
  }
  // The ported prop groups keep their own <g>, so the ported motions still find them.
  expect(draw('clawd', 'ace')).toContain('<g class="cw-ant">')
  expect(draw('clawd', 'ace')).toContain('<g class="cw-star">')
  expect(draw('clawd', 'detective')).toContain('<g class="cw-gl">')
  expect(draw('clawd', 'chef')).toContain('<g class="cw-pan">')
  expect(draw('clawd', 'chef')).toContain('<g class="cw-egg">')
  expect(draw('clawd', 'sprinter')).toContain('<g class="cw-flag">')
  for (const role of ['detective', 'engineer', 'scout']) expect(draw('clawd', role)).toContain('<g class="cw-it">')
  for (const role of Object.keys(REFERENCE)) for (const cls of ['cw-bd', 'cw-la', 'cw-lb']) expect(draw('clawd', role)).toContain(`<g class="${cls}">`)
})

test('every costume shows its kind accent, in both themes', async () => {
  const accent: Record<string, string> = {
    ace: '#9774DC', detective: '#D86931', engineer: '#BB811B', chef: '#367FDD', sprinter: '#23A97F',
    designer: '#D4537E', writer: '#B56BC7', tester: '#5BA23B', reviewer: '#C0453F', analyst: '#B6AC20', planner: '#727BCA', helper: '#AAC46E',
  }
  // Each costume's accent is its kind's base colour in the one table, and never grey.
  for (const k of KIND_KEYS) expect(accent[KINDS[k].sprite] ?? (KINDS[k].sprite === 'scout' ? '#2E9BB8' : undefined), k).toBe(KINDS[k].color)
  for (const theme of THEMES) for (const [role, colour] of Object.entries(accent)) expect(draw(theme, role)).toContain(colour)
  // The cat wears its accent in every pose, the scout's included: on the hat, so it stays when curled up or riding.
  for (const [role, colour] of Object.entries({ ...accent, scout: '#2E9BB8' })) {
    for (const pose of POSES) expect(`${role}/${pose} ${draw('cat', role, pose).includes(colour)}`).toBe(`${role}/${pose} true`)
  }
  for (const theme of THEMES) expect(draw(theme, 'helper')).not.toContain('#888780')
})

test('a costume wears the colour it is given (an agent colour) in place of its kind colour', async () => {
  for (const theme of THEMES) {
    const own = sprite({ theme, role: 'chef', pose: 'work', x: 0, y: 0, color: '#4A9BE8' })
    expect(own).toContain('#4A9BE8')
    expect(own).not.toContain('#367FDD')
    // A colour that is not six hex digits is ignored: the kind's own stands.
    for (const junk of ['red', '#abc', '', 'url(#x)']) expect(sprite({ theme, role: 'chef', pose: 'work', x: 0, y: 0, color: junk })).toBe(draw(theme, 'chef', 'work'))
  }
})

// Reads a sprite's rects back with the colour each ends up with: its own fill or
// class, else its nearest <g>'s. A class colour comes back as '.name'.
const tintsOf = (g: string): Paint[] => {
  const out: Paint[] = []
  const tints: string[] = []
  for (const m of g.matchAll(/<(\/?)(g|rect)([^>]*?)(\/?)>/g)) {
    const attrs = m[3] ?? ''
    const fill = /\sfill="([^"]*)"/.exec(attrs)?.[1]
    const cls = /\sclass="([^"]*)"/.exec(attrs)?.[1]
    const own = fill ?? (cls && /^ct-(k|l|cl)$/.test(cls) ? `.${cls}` : undefined)
    if (m[2] === 'g') {
      if (m[1]) tints.pop()
      else tints.push(own ?? tints.at(-1) ?? '')
      continue
    }
    const n = (name: string): number => Number(new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1])
    out.push([n('x'), n('y'), n('width'), n('height'), own ?? tints.at(-1) ?? ''])
  }
  return out
}
// The rects inside any <g> whose class is `cls`, however deeply nested.
const rectsIn = (g: string, cls: string): Paint[] => {
  const out: Paint[] = []
  const open: boolean[] = []
  for (const m of g.matchAll(/<(\/?)(g|rect)([^>]*?)(\/?)>/g)) {
    const attrs = m[3] ?? ''
    if (m[2] === 'g') {
      if (m[1]) open.pop()
      else open.push(new RegExp(`\\sclass="${cls}"`).test(attrs))
      continue
    }
    if (!open.includes(true)) continue
    const n = (name: string): number => Number(new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1])
    out.push([n('x'), n('y'), n('width'), n('height'), ''])
  }
  return out
}
const boxOf = (paints: Paint[]): [x0: number, y0: number, x1: number, y1: number] => [
  Math.min(...paints.map(p => p[0])), Math.min(...paints.map(p => p[1])),
  Math.max(...paints.map(p => p[0] + p[2])), Math.max(...paints.map(p => p[1] + p[3])),
]
// The bounding box of the cat's coat (both fur classes): [width, height].
const coatBox = (g: string): [number, number] => {
  const [x0, y0, x1, y1] = boxOf(tintsOf(g).filter(p => p[4] === '.ct-k' || p[4] === '.ct-l'))
  return [x1 - x0, y1 - y0]
}
// The colour each pixel of a drawing ends up with, class colours as '.name'.
const pixelsOf = (g: string): string[] => raster(tintsOf(g).map(p => [p[0], p[1], p[2], p[3], p[4] || 'mark']))
const at = (grid: string[], x: number, y: number): string => grid[y * SPRITE_W + x] ?? ''
// The head and body of a drawing, without its tail or what it holds.
const headAndBody = (g: string): string => g.slice(g.indexOf('<g class="ct-bd">'), g.indexOf('<g class="ct-fr">'))
const SITTING = ['work', 'wait', 'done', 'planned'] as const
const ARMED = ['detective', 'engineer', 'chef', 'sprinter', 'scout', 'designer', 'writer', 'tester', 'reviewer', 'planner']
// The drawing without the <g>s whose class list holds one of `classes`, and
// everything inside them: a hidden frame, the marks, the sparkles.
const without = (g: string, classes: readonly string[]): string => {
  const drop: boolean[] = []
  let out = ''
  for (const m of g.matchAll(/<(\/?)(g|rect)([^>]*?)(\/?)>/g)) {
    if (m[2] === 'g' && m[1]) {
      if (!drop.includes(true)) out += m[0]
      drop.pop()
      continue
    }
    if (m[2] === 'g') drop.push((/\sclass="([^"]*)"/.exec(m[3] ?? '')?.[1] ?? '').split(' ').some(c => classes.includes(c)))
    if (!drop.includes(true)) out += m[0]
  }
  return out
}
// Every grid cell a set of rects covers, as [x, y].
const cellsOf = (paints: Paint[]): [number, number][] => paints.flatMap(([x, y, w, h]) =>
  Array.from({ length: w * h }, (_, i): [number, number] => [x + (i % w), y + Math.floor(i / w)]))
// The frames that are hidden in the still picture (nothing animating).
const HIDDEN = ['ct-t0', 'ct-t1', 'ct-t2', 'ct-t4', 'ct-t5', 'ct-k1', 'ct-k2', 'ct-bl', 'ct-a0', 'ct-a2']
const TAIL_FRAMES = ['ct-t0', 'ct-t1', 'ct-t2', 'ct-t3', 'ct-t4', 'ct-t5', 'ct-k0', 'ct-k1', 'ct-k2']
const SPARKLES = ['ct-s1', 'ct-s2', 'ct-s3', 'ct-s4']

// The contract's colours: coat, leg lines, ear inside, eye. Gone: the lilac
// ears and shut-eye lines, the pale-yellow eye, the nose.
const EAR = '#A9CF9A'
const EYE = '#EEEBD6'
const GONE = ['#8E7CC3', '#6F5FA8', '#F3EFA0', '#C7A2E0']

// The sitting cat of the contract, pixel for pixel: head, eyes and body of
// `main` in work, done and planned (no tail). `.` empty, `k` coat, `l` leg line,
// `g` ear inside, `c` eye. Rows 0-27, columns 0-29.
const SIT_ROWS = [
  '..............................',
  '..............................',
  '.....kk...............kk......',
  '.....gkk.............kkg......',
  '.....ggkk...........kkgg......',
  '.....gggkk..kkkkk..kkggg......',
  '.....ggkkkkkkkkkkkkkkkgg......',
  '.....gkkkkkkkkkkkkkkkkkg......',
  '.....kkkkkkkkkkkkkkkkkkk......',
  '.....kkkcccckkkkkcccckkk......',
  '.....kkcccccckkkcccccckk......',
  '.....kccckkccckccckkccck......',
  '.....kcckkkkcckcckkkkcck......',
  '.....kcckkkkcckcckkkkcck......',
  '.....kcckkkkcckcckkkkcck......',
  '.....kcckkkkcckcckkkkcck......',
  '.....kccckkccckccckkccck......',
  '.....kkcccccckkkcccccckk......',
  '......kkcccckkkkkcccckk.......',
  '.......kkkkkkkkkkkkkkk........',
  '.........kkkkkkkkkkk..........',
  '...........kkkkkkk............',
  '..........kkkkkkkkk...........',
  '..........kkkkkkkkk...........',
  '.........kkkkklkkkkk..........',
  '........kkklkklkklkkk.........',
  '........kkklkklkklkkk.........',
  '.........kklkklkklkk..........',
]
// Waiting, the eyes narrow: rows 9 to 16 become these, the rest as above.
const WAIT_EYES = [
  '.....kkkkkkkkkkkkkkkkkkk......',
  '.....kkkkkkkkkkkkkkkkkkk......',
  '.....kkkkkkkkkkkkkkkkkkk......',
  '.....kcckkkkkkkkkkkkkcck......',
  '.....kcccckkkkkkkkkcccck......',
  '.....kccckkckkkkkckkccck......',
  '.....kcckkkkcckcckkkkcck......',
  '.....kcckkkkcckcckkkkcck......',
]
const WAIT_ROWS = [...SIT_ROWS.slice(0, 9), ...WAIT_EYES, ...SIT_ROWS.slice(17)]
const LETTER: Record<string, string> = { '': '.', '.ct-k': 'k', '.ct-l': 'l', [EAR]: 'g', [EYE]: 'c' }
const rowsOf = (grid: string[]): string[] => Array.from({ length: SPRITE_H }, (_, y) =>
  Array.from({ length: SPRITE_W }, (_, x) => LETTER[at(grid, x, y)] ?? '?').join(''))

// The still tail (planned, and the wave's middle frame), as `rows: columns`.
const STILL_TAIL = ['8: 27-28', '9-11: 26-29', '12-19: 27-29', '20: 26-29', '21: 26-28', '22: 25-28', '23: 24-27', '24: 22-26', '25: 20-25', '26: 20-23']
const tailRows = (cells: [number, number][]): string[] => {
  const byRow = new Map<number, Set<number>>()
  for (const [x, y] of cells) byRow.set(y, (byRow.get(y) ?? new Set<number>()).add(x))
  return [...byRow.keys()].sort((a, b) => a - b).map(y => {
    const xs = [...(byRow.get(y) ?? [])].sort((a, b) => a - b)
    return `${y}: ${xs[0]}-${xs.at(-1)}${xs.length === (xs.at(-1) ?? 0) - (xs[0] ?? 0) + 1 ? '' : ' with gaps'}`
  })
}
const expand = (spec: readonly string[]): string[] => spec.flatMap(s => {
  const [rows = '', cols = ''] = s.split(': ')
  const [r0 = 0, r1 = r0] = rows.split('-').map(Number)
  return Array.from({ length: r1 - r0 + 1 }, (_, i) => `${r0 + i}: ${cols}`)
})

test('the contract grids are 30 wide, 28 tall and mirror about column 14', async () => {
  for (const rows of [SIT_ROWS, WAIT_ROWS]) {
    expect(rows.length).toBe(SPRITE_H)
    for (const row of rows) {
      expect(row.length).toBe(SPRITE_W)
      expect(row.slice(0, 29)).toBe([...row.slice(0, 29)].reverse().join(''))
      expect(row[29]).toBe('.')
    }
  }
})

test('the cat is black with pale green ears and cream eyes, and no lilac, yellow or nose colour', async () => {
  const css = spriteCss('cat')
  for (const old of GONE) expect(`css ${old} ${css.includes(old)}`).toBe(`css ${old} false`)
  for (const role of SPRITE_ROLES) for (const pose of POSES) {
    const g = draw('cat', role, pose)
    for (const part of ['class="ct-k"', 'class="ct-l"', EAR, '<g class="ct-tail">']) {
      expect(`${role}/${pose} ${part} ${g.includes(part)}`).toBe(`${role}/${pose} ${part} true`)
    }
    for (const old of GONE) expect(`${role}/${pose} ${old} ${g.includes(old)}`).toBe(`${role}/${pose} ${old} false`)
    // Cream eyes in every pose but rest, where they are shut.
    expect(`${role}/${pose} eyes ${g.includes(EYE)}`).toBe(`${role}/${pose} eyes ${pose !== 'rest'}`)
    for (const old of ['#F4E97A', '#C9CF5A', '#17161B', '#3B3A46', 'ct-wk']) expect(g).not.toContain(old)
    expect(g).not.toContain('#D97757')
  }
  // No white glint in the eye: no white in the plain cat's head and body.
  // The ride's sparkles keep their white centres.
  for (const pose of POSES) expect(`${pose} ${without(draw('cat', 'main', pose), SPARKLES).includes('#FFFFFF')}`).toBe(`${pose} false`)
})

test('the plain sitting cat is the contract grid pixel for pixel, eyes wide or narrowed', async () => {
  for (const pose of ['work', 'done', 'planned', 'wait'] as const) {
    // The blink's lids are hidden in the still picture.
    const got = rowsOf(pixelsOf(headAndBody(without(draw('cat', 'main', pose), ['ct-bl']))))
    const want = pose === 'wait' ? WAIT_ROWS : SIT_ROWS
    for (let y = 0; y < SPRITE_H; y += 1) expect(`${pose} ${y} ${got[y]}`).toBe(`${pose} ${y} ${want[y]}`)
  }
})

test('a costume covers the sitting cat but never moves its head, eyes or body', async () => {
  for (const role of SPRITE_ROLES) for (const pose of SITTING) {
    const got = pixelsOf(headAndBody(without(draw('cat', role, pose), ['ct-bl'])))
    const want = (pose === 'wait' ? WAIT_ROWS : SIT_ROWS).join('')
    got.forEach((c, i) => {
      const letter = LETTER[c]
      const [x, y] = [i % SPRITE_W, Math.floor(i / SPRITE_W)]
      // A cat colour only where the contract has that colour; and never a hole where it has the cat.
      if (letter && letter !== '.') expect(`${role}/${pose} ${x},${y} ${letter}`).toBe(`${role}/${pose} ${x},${y} ${want[i]}`)
      if (want[i] !== '.') expect(`${role}/${pose} ${x},${y} ${c === '' ? 'hole' : 'painted'}`).toBe(`${role}/${pose} ${x},${y} painted`)
    })
  }
})

test('the cat is one black in light and dark mode: no colour-scheme rule touches its coat', async () => {
  const css = spriteCss('cat')
  expect(css).toContain('.ct-k{fill:#0B0B0D}')
  expect(css).toContain('.ct-l{fill:#18181C}')
  const dark = [...css.matchAll(/@media \(prefers-color-scheme: dark\)\{((?:[^{}]*\{[^{}]*\})*)\}/g)].map(m => m[1] ?? '')
  // The only dark-mode rule left is the marks' (the z's and the waiting dots).
  expect(dark.length).toBe(1)
  for (const block of dark) expect(block).not.toMatch(/\.ct-(k|l|cl|wk)\{/)
  expect(css.match(/\.ct-k\{/g)?.length).toBe(1)
})

test('the cat has no outline: no outline group, rule or stroke, and nothing but coat around its coat', async () => {
  const css = spriteCss('cat')
  expect(css).not.toContain('ct-ol')
  expect(css).not.toMatch(/stroke|outline/)
  for (const role of SPRITE_ROLES) for (const pose of POSES) {
    const g = draw('cat', role, pose)
    expect(g).not.toContain('ct-ol')
    expect(g).not.toContain('stroke')
    // The plain cat's every painted pixel is coat, ear, eye, broom, sparkle or mark: no ring of another dark.
    if (role === 'main') {
      const allowed = new Set(['.ct-k', '.ct-l', '.ct-cl', '', EAR, EYE, '#E9C46A', '#C9963A', '#B07A45', '#7A4A26', '#F5C542', '#8E929A'])
      // The sparkles are left out: their white centres are not the eye's.
      for (const p of tintsOf(without(g, SPARKLES))) expect(`${pose} ${p[4]} ${allowed.has(p[4])}`).toBe(`${pose} ${p[4]} true`)
    }
  }
})

test('the cat faces forward: head, eyes and body mirror about the centre line', async () => {
  for (const pose of ['work', 'wait', 'done', 'planned', 'ride'] as const) {
    const grid = pixelsOf(headAndBody(draw('cat', 'main', pose)))
    // Riding, the broom below row 20 runs one way.
    for (let y = 0; y < (pose === 'ride' ? 20 : SPRITE_H); y += 1) for (let x = 0; x < 14; x += 1) {
      const [a, b] = [at(grid, x, y), at(grid, 28 - x, y)]
      expect(`${pose} ${x},${y} ${a} | ${b}`).toBe(`${pose} ${x},${y} ${a} | ${a}`)
    }
  }
})

test('the cat has no nose, mouth or whiskers in any pose', async () => {
  for (const theme of THEMES) for (const role of SPRITE_ROLES) for (const pose of POSES) {
    expect(sprite({ theme, role, pose, x: 3, y: 4, smile: true })).toBe(sprite({ theme, role, pose, x: 3, y: 4 }))
  }
  expect(spriteCss('cat')).not.toMatch(/ct-sm|ct-mo/)
  // Done draws the same head as work: no smile added.
  const head = (role: string, pose: Pose): string => { const g = draw('cat', role, pose); return g.slice(g.indexOf('<g class="ct-hd">'), g.indexOf('<g class="ct-fr">')) }
  for (const role of SPRITE_ROLES) expect(`${role} ${head(role, 'done') === head(role, 'work')}`).toBe(`${role} true`)
  // No nose colour anywhere (the colour test), and the old whisker tips beside the head are empty.
  for (const pose of SITTING) {
    const grid = pixelsOf(draw('cat', 'main', pose))
    for (const [x, y] of [[4, 11], [24, 11], [4, 15], [24, 15]] as const) {
      expect(`${pose} whisker ${x},${y} ${at(grid, x, y) || 'empty'}`).toBe(`${pose} whisker ${x},${y} empty`)
    }
  }
})

test('the cat sits upright, curls up wider than tall to rest, and sits on a broom to ride', async () => {
  for (const role of SPRITE_ROLES) {
    for (const pose of SITTING) {
      const [w, h] = coatBox(headAndBody(draw('cat', role, pose)))
      expect(`${role}/${pose} upright ${h >= w}`).toBe(`${role}/${pose} upright true`)
    }
    const rest = draw('cat', role, 'rest')
    const [w, h] = coatBox(rest)
    expect(`${role}/rest curled ${w >= h + 4}`).toBe(`${role}/rest curled true`)
    // Breathing moves the back and the head; the curled cat's eyes are shut lines.
    expect(rest).toContain('<g class="ct-br">')
    expect(rest).toContain('class="ct-cl"')
    expect(rest).not.toContain(EYE)
    // Nothing but the z's in the top-left corner.
    const corner = cellsOf(tintsOf(without(rest, ['ct-mk']))).filter(([x, y]) => x <= 4 && y <= 8)
    expect(`${role}/rest corner ${corner.map(c => c.join(',')).join(' ')}`).toBe(`${role}/rest corner `)
    // Nothing but the waiting dots in the top-left rows.
    const top = cellsOf(tintsOf(without(draw('cat', role, 'wait'), ['ct-mk']))).filter(([x, y]) => x <= 7 && y <= 1)
    expect(`${role}/wait corner ${top.map(c => c.join(',')).join(' ')}`).toBe(`${role}/wait corner `)
    const ride = draw('cat', role, 'ride')
    for (const part of ['<g class="ct-rd">', '#E9C46A', '#B07A45', '<g class="ct-s1">', '<g class="ct-s2">', '<g class="ct-s3">']) expect(`${role} ${part} ${ride.includes(part)}`).toBe(`${role} ${part} true`)
    // The broom lies across the box, straw on the left, handle reaching the right edge.
    const straw = tintsOf(ride).filter(p => p[4] === '#E9C46A')
    const handle = tintsOf(ride).filter(p => p[4] === '#B07A45')
    expect(Math.max(...straw.map(p => p[0] + p[2]))).toBeLessThan(Math.min(...handle.map(p => p[0])) + 1)
    expect(Math.max(...handle.map(p => p[0] + p[2]))).toBe(SPRITE_W)
  }
})

test('the still tail rises up the right side and curls along the floor, cell for cell', async () => {
  const want = expand(STILL_TAIL)
  // Planned draws only the still tail; working, it is the wave's middle frame with the others hidden.
  const planned = tailRows(cellsOf(rectsIn(draw('cat', 'main', 'planned'), 'ct-tail')))
  const work = tailRows(cellsOf(rectsIn(without(draw('cat', 'main', 'work'), HIDDEN), 'ct-tail')))
  expect(planned).toEqual(want)
  expect(work).toEqual(want)
})

test('the tail keeps clear of the head: right of column 24 beside it, right of column 19 below it', async () => {
  for (const role of SPRITE_ROLES) for (const pose of [...SITTING, 'ride'] as const) {
    const g = draw('cat', role, pose)
    // Every wave frame, every flicking tip and whatever of the tail is still.
    const parts = [...TAIL_FRAMES.map(cls => [cls, rectsIn(g, cls)] as const), ['ct-tail', rectsIn(g, 'ct-tail')] as const]
    expect(`${role}/${pose} tail ${rectsIn(g, 'ct-tail').length > 0}`).toBe(`${role}/${pose} tail true`)
    for (const [cls, rects] of parts) {
      const out = cellsOf(rects).filter(([x, y]) => (pose === 'ride' ? x < 20 : y >= 2 && y <= 20 ? x < 25 : y > 20 && x < 20) || x > 29)
      expect(`${role}/${pose} ${cls} ${out.map(c => c.join(',')).join(' ')}`).toBe(`${role}/${pose} ${cls} `)
    }
  }
})

test('the cat keeps its hat but drops its prop when curled up or riding', async () => {
  const props = ['detective', 'engineer', 'chef', 'sprinter', 'scout', 'designer', 'writer', 'tester', 'reviewer', 'analyst', 'planner']
  for (const role of props) {
    for (const pose of SITTING) expect(`${role}/${pose} ${draw('cat', role, pose).includes('<g class="ct-fr"></g>')}`).toBe(`${role}/${pose} false`)
    expect(draw('cat', role, 'rest')).not.toContain('ct-fr')
    expect(draw('cat', role, 'ride')).toContain('<g class="ct-fr"></g>')
    for (const cls of ['ct-it', 'ct-pan', 'ct-flag', 'ct-gl', 'ct-bub', 'ct-b1', 'ct-a0', 'ct-a1']) {
      expect(draw('cat', role, 'rest')).not.toContain(cls)
      expect(draw('cat', role, 'ride')).not.toContain(cls)
    }
  }
})

test('a raised paw swings its prop in an arc of three frames drawn from the shoulder', async () => {
  const css = spriteCss('cat')
  for (const role of ARMED) {
    const g = draw('cat', role, 'work')
    const arm = [0, 1, 2].map(n => rectsIn(g, `ct-a${n}`))
    for (const [n, rects] of arm.entries()) {
      expect(`${role} a${n} ${rects.length > 3}`).toBe(`${role} a${n} true`)
      // The arm starts at the shoulder cell (10, 22), two pixels thick.
      const cells = new Set(cellsOf(rects).map(c => c.join(',')))
      expect(`${role} a${n} shoulder ${['10,22', '11,22', '10,23', '11,23'].every(c => cells.has(c))}`).toBe(`${role} a${n} shoulder true`)
    }
    // The frames differ, and not only up and down: the paw's column moves too.
    const boxes = arm.map(rects => boxOf(rects))
    expect(`${role} ${new Set(boxes.map(b => b[0])).size > 1 || new Set(boxes.map(b => b[2])).size > 1}`).toBe(`${role} true`)
    expect(new Set(arm.map(rects => JSON.stringify(rects))).size).toBe(3)
    // Still poses hold the middle frame, ungrouped; the prop no longer bobs on its own.
    for (const pose of ['wait', 'done', 'planned'] as const) expect(draw('cat', role, pose)).not.toMatch(/ct-a\d|ct-it/)
    expect(g).not.toContain('ct-it')
  }
  for (const role of ['main', 'ace', 'analyst', 'helper']) expect(draw('cat', role, 'work')).not.toMatch(/ct-a\d/)
  // Out, across and back, the ends held longest; frame 1 is the still one.
  for (const n of [0, 1, 2]) {
    expect(css).toContain(`.ct-work .ct-a${n}{animation:ct-a${n} 1s steps(1) infinite}`)
    expect(css).toContain(`@keyframes ct-a${n}{`)
  }
  expect(css).toContain('.ct-a0,.ct-a2{opacity:0}')
  expect(css).not.toMatch(/\.ct-a1[,{][^}]*opacity:0/)
  expect(css).not.toMatch(/ct-it|ct-dab|ct-tap|ct-scrib|ct-sway|ct-fence|ct-twist|ct-scan/)
})

test('the cat tail waves in at least six frames, flicks its tip while waiting and is still when planned', async () => {
  const css = spriteCss('cat')
  const frames = [0, 1, 2, 3, 4, 5]
  for (const role of SPRITE_ROLES) {
    for (const pose of ['work', 'done', 'rest', 'ride'] as const) {
      const g = draw('cat', role, pose)
      for (const n of frames) expect(`${role}/${pose} t${n} ${g.includes(`<g class="ct-t${n}">`)}`).toBe(`${role}/${pose} t${n} true`)
    }
    const wait = draw('cat', role, 'wait')
    for (const n of [0, 1, 2]) expect(wait).toContain(`<g class="ct-k${n}">`)
    expect(wait).not.toContain('ct-t0')
    expect(draw('cat', role, 'planned')).not.toMatch(/ct-t\d|ct-k\d|ct-a\d/)
  }
  // Each frame shows for its sixth of the cycle by a stepped keyframe of its own.
  for (const n of frames) {
    expect(css).toContain(`.ct-t${n}{animation:ct-f${n} 1s steps(1) infinite}`)
    expect(css).toContain(`@keyframes ct-f${n}{`)
  }
  // Slower when resting or done; the middle frame is the one shown with no animation at all.
  expect(css).toMatch(/\.ct-rest \.ct-t0,[^{]*\.ct-done \.ct-t5\{animation-duration:3s\}/)
  expect(css).toContain('.ct-t0,.ct-t1,.ct-t2,.ct-t4,.ct-t5,')
  expect(css).not.toMatch(/\.ct-t3[,{][^}]*opacity:0/)
  expect(css).toMatch(/\.ct-wait \.ct-k1\{animation:ct-k1 [\d.]+s steps\(1\) infinite\}/)
  expect(css).not.toContain('ct-planned')
  // Riding bobs the cat and its broom by a pixel and twinkles the sparkles.
  expect(css).toContain('.ct-ride .ct-rd{animation:ct-bob 1s steps(1) infinite}')
  expect(css).toMatch(/\.ct-s1,\.ct-s2,\.ct-s3[^{]*\{animation:ct-twinkle /)
  expect(css).toContain('.ct-rest .ct-br{animation:ct-breathe 3s steps(1) infinite}')
})

// Every animated selector of the cat's CSS with each of its animation
// declarations, one entry per selector, sorted; keyframe contents left out.
const motionOf = (css: string): string[] => {
  const out: string[] = []
  const flat = css.replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = (m[2] ?? '').split(';').map(d => d.trim()).filter(d => d.startsWith('animation'))
    for (const sel of (m[1] ?? '').split(',')) for (const d of decls) out.push(`${sel.trim()} ${d}`)
  }
  return out.sort()
}

test('the cat keeps every animation it had: the same selectors, names, durations, timings and delays', async () => {
  // Read from spriteCss('cat') at commit 724fcce, the cat before its redraw.
  expect(motionOf(spriteCss('cat'))).toEqual([
    '.ct * animation:none!important',
    '.ct animation:none!important',
    '.ct-done .ct-bl animation:ct-blink 5s steps(1) infinite -1s',
    '.ct-done .ct-t0 animation-duration:3s',
    '.ct-done .ct-t1 animation-duration:3s',
    '.ct-done .ct-t2 animation-duration:3s',
    '.ct-done .ct-t3 animation-duration:3s',
    '.ct-done .ct-t4 animation-duration:3s',
    '.ct-done .ct-t5 animation-duration:3s',
    '.ct-r-ace.ct-work .ct-ant animation:ct-flash 1s steps(1) infinite',
    '.ct-r-ace.ct-work .ct-star animation:ct-flash .5s steps(1) infinite -.25s',
    '.ct-r-ace.ct-work animation:ct-float 1s ease-in-out infinite',
    '.ct-r-analyst.ct-work .ct-b1 animation:ct-rise 1s steps(3) infinite',
    '.ct-r-analyst.ct-work .ct-b2 animation:ct-rise 1s steps(5) infinite',
    '.ct-r-analyst.ct-work .ct-b3 animation:ct-rise 1s steps(7) infinite',
    '.ct-r-chef.ct-work .ct-egg animation:ct-flip 1s ease-in-out infinite',
    '.ct-r-detective.ct-work .ct-gl animation:ct-flash 1s steps(1) infinite -.5s',
    '.ct-r-helper.ct-work .ct-tie animation:ct-flut .5s steps(1) infinite',
    '.ct-r-reviewer.ct-work .ct-a0 animation-duration:.5s',
    '.ct-r-reviewer.ct-work .ct-a1 animation-duration:.5s',
    '.ct-r-reviewer.ct-work .ct-a2 animation-duration:.5s',
    '.ct-r-sprinter.ct-work .ct-flag animation:ct-wave .25s steps(1) infinite',
    '.ct-r-tester.ct-work .ct-bu2 animation:ct-bub 1s linear infinite -.5s',
    '.ct-r-tester.ct-work .ct-bub animation:ct-bub 1s linear infinite',
    '.ct-r-writer.ct-work .ct-a0 animation-duration:.5s',
    '.ct-r-writer.ct-work .ct-a1 animation-duration:.5s',
    '.ct-r-writer.ct-work .ct-a2 animation-duration:.5s',
    '.ct-rest .ct-br animation:ct-breathe 3s steps(1) infinite',
    '.ct-rest .ct-t0 animation-duration:3s',
    '.ct-rest .ct-t1 animation-duration:3s',
    '.ct-rest .ct-t2 animation-duration:3s',
    '.ct-rest .ct-t3 animation-duration:3s',
    '.ct-rest .ct-t4 animation-duration:3s',
    '.ct-rest .ct-t5 animation-duration:3s',
    '.ct-rest .ct-z1 animation:ct-zz 3s linear infinite',
    '.ct-rest .ct-z2 animation:ct-zz 3s linear infinite -1.5s',
    '.ct-ride .ct-rd animation:ct-bob 1s steps(1) infinite',
    '.ct-s1 animation:ct-twinkle 1s steps(1) infinite',
    '.ct-s2 animation-delay:-.75s',
    '.ct-s2 animation:ct-twinkle 1s steps(1) infinite',
    '.ct-s3 animation-delay:-.5s',
    '.ct-s3 animation:ct-twinkle 1s steps(1) infinite',
    '.ct-s4 animation-delay:-.25s',
    '.ct-s4 animation:ct-twinkle 1s steps(1) infinite',
    '.ct-t0 animation:ct-f0 1s steps(1) infinite',
    '.ct-t1 animation:ct-f1 1s steps(1) infinite',
    '.ct-t2 animation:ct-f2 1s steps(1) infinite',
    '.ct-t3 animation:ct-f3 1s steps(1) infinite',
    '.ct-t4 animation:ct-f4 1s steps(1) infinite',
    '.ct-t5 animation:ct-f5 1s steps(1) infinite',
    '.ct-wait .ct-k0 animation:ct-k0 2.4s steps(1) infinite',
    '.ct-wait .ct-k1 animation:ct-k1 2.4s steps(1) infinite',
    '.ct-wait .ct-k2 animation:ct-k2 2.4s steps(1) infinite',
    '.ct-wait .ct-w1 animation:ct-dot 1.5s steps(1) infinite',
    '.ct-wait .ct-w2 animation:ct-dot 1.5s steps(1) infinite -1s',
    '.ct-wait .ct-w3 animation:ct-dot 1.5s steps(1) infinite -.5s',
    '.ct-work .ct-a0 animation:ct-a0 1s steps(1) infinite',
    '.ct-work .ct-a1 animation:ct-a1 1s steps(1) infinite',
    '.ct-work .ct-a2 animation:ct-a2 1s steps(1) infinite',
    '.ct-work .ct-bl animation:ct-blink 4s steps(1) infinite',
  ])
})

test('with every animation removed the still picture is whole: the middle frames show, the others and the lids hide', async () => {
  const css = spriteCss('cat').replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const hidden = [...css.matchAll(/([^{}]+)\{opacity:0\}/g)].flatMap(m => (m[1] ?? '').split(',').map(s => s.trim()))
  for (const cls of HIDDEN) expect(`${cls} ${hidden.includes(`.${cls}`)}`).toBe(`${cls} true`)
  for (const cls of ['ct-t3', 'ct-k0', 'ct-a1', 'ct-tail', 'ct-bd', 'ct-hd', 'ct-fr', 'ct-br', 'ct-rd']) {
    expect(`${cls} ${hidden.some(s => s.split(/\s+/).includes(`.${cls}`))}`).toBe(`${cls} false`)
  }
  // The frames the still picture relies on are drawn.
  for (const role of SPRITE_ROLES) {
    expect(draw('cat', role, 'work')).toContain('<g class="ct-t3">')
    expect(draw('cat', role, 'wait')).toContain('<g class="ct-k0">')
    if (ARMED.includes(role)) expect(draw('cat', role, 'work')).toContain('<g class="ct-a1">')
  }
})

test('the cat markup stays small: its mean length is at most 15% above the old cat', async () => {
  let total = 0
  for (const role of SPRITE_ROLES) for (const pose of POSES) total += draw('cat', role, pose).length
  // The old cat (commit 724fcce) averaged 6730.57 characters over 14 roles x 6 poses; 6730.57 x 1.15 = 7740.16.
  expect(total / (SPRITE_ROLES.length * POSES.length)).toBeLessThanOrEqual(7740)
})

test('the crab draws ride exactly as it draws work', async () => {
  for (const role of [...SPRITE_ROLES, 'nope']) for (const mirror of [false, true]) {
    expect(sprite({ theme: 'clawd', role, pose: 'ride', x: 5, y: 6, scale: 2.4, mirror })).toBe(sprite({ theme: 'clawd', role, pose: 'work', x: 5, y: 6, scale: 2.4, mirror }))
  }
  expect(spriteCss('clawd')).not.toContain('ride')
})

test('spriteDoc wraps one sprite and its CSS in a whole svg', async () => {
  each((theme, role, pose) => {
    const doc = spriteDoc({ theme, role, pose })
    expect(malformed(doc)).toBe('')
    expect(doc.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="33" height="30.8" viewBox="0 0 33 30.8">')).toBe(true)
    expect(doc).toContain(spriteCss(theme))
    expect(doc).toContain(draw(theme, role, pose))
    expect(doc.match(/<style>/g)?.length).toBe(1)
  })
  expect(spriteDoc({ theme: 'cat', role: 'main', pose: 'done', scale: 3 })).toContain('width="90" height="84"')
})

test('the blink: the lids are drawn in work and done only, and cover both open eyes', async () => {
  const eyeCells: string[] = []
  SIT_ROWS.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'c') eyeCells.push(`${x},${y}`) }))
  // The two 8 x 10 eyes, columns 6-13 and 15-22, rows 9-18, as the contract grid has them.
  expect(`eye cells ${eyeCells.length}`).toBe('eye cells 96')
  for (const role of SPRITE_ROLES) for (const pose of POSES) {
    const g = draw('cat', role, pose)
    const has = pose === 'work' || pose === 'done'
    expect(`${role}/${pose} lids ${g.includes('<g class="ct-bl">')}`).toBe(`${role}/${pose} lids ${has}`)
  }
  for (const role of SPRITE_ROLES) {
    const lid = new Set(cellsOf(rectsIn(draw('cat', role, 'work'), 'ct-bl')).map(c => c.join(',')))
    const bare = eyeCells.filter(c => !lid.has(c))
    expect(`${role} eye cells without a lid ${bare.join(' ')}`).toBe(`${role} eye cells without a lid `)
    // Nothing of the lid strays outside the two eyes' boxes.
    const out = [...lid].filter(c => { const [x = 0, y = 0] = c.split(',').map(Number); return y < 9 || y > 18 || x < 6 || x > 22 || x === 14 })
    expect(`${role} lid outside the eyes ${out.join(' ')}`).toBe(`${role} lid outside the eyes `)
  }
})

test('asleep, the writer, tester and scout wear their eyewear flat over the shut eyes, not round open ones', async () => {
  // The colour each costume's eyewear is painted in: the kind's accent for the
  // rings and the goggle rim, the patch's own dark grey for the scout.
  const colour: Record<string, string> = { writer: '#B56BC7', tester: '#5BA23B', scout: '#2E2C2A' }
  const wear = (role: string, pose: 'rest' | 'done'): { cells: number; w: number; h: number } => {
    // The scout's hat sits above the patch (rows 3-7; 9-13 asleep): only the patch and its strap count.
    const from = role === 'scout' ? (pose === 'rest' ? 14 : 8) : 0
    const cells = cellsOf(tintsOf(headAndBody(without(draw('cat', role, pose), ['ct-bl']))).filter(p => p[4] === colour[role])).filter(([, y]) => y >= from)
    const [x0, y0, x1, y1] = [Math.min(...cells.map(c => c[0])), Math.min(...cells.map(c => c[1])), Math.max(...cells.map(c => c[0])) + 1, Math.max(...cells.map(c => c[1])) + 1]
    return { cells: cells.length, w: x1 - x0, h: y1 - y0 }
  }
  for (const role of ['writer', 'tester']) {
    const [asleep, sitting] = [wear(role, 'rest'), wear(role, 'done')]
    // Rings and goggles: 6 rows tall asleep, 12 sitting; the sitting ones are at least twice as tall less 1.
    expect(`${role} flat asleep ${asleep.h <= 8}`).toBe(`${role} flat asleep true`)
    expect(`${role} round awake ${sitting.h >= 10}`).toBe(`${role} round awake true`)
    expect(`${role} flatter by 4 rows ${sitting.h - asleep.h >= 4}`).toBe(`${role} flatter by 4 rows true`)
    // Both lenses, side by side, in either pose.
    expect(`${role} width ${asleep.w >= 16 && sitting.w >= 16}`).toBe(`${role} width true`)
  }
  // The patch: one tall eye patch awake (taller than wide), asleep a flat one with
  // its strap, wider than tall and with under half the cells.
  const [asleep, sitting] = [wear('scout', 'rest'), wear('scout', 'done')]
  expect(`scout awake taller than wide ${sitting.h > sitting.w}`).toBe('scout awake taller than wide true')
  expect(`scout asleep wider than tall ${asleep.w > asleep.h}`).toBe('scout asleep wider than tall true')
  expect(`scout asleep under half the cells ${asleep.cells * 2 < sitting.cells}`).toBe('scout asleep under half the cells true')
})

test("the scout cat's eye patch is not the hat's grey, which reads as a hole in the dark hero card", async () => {
  // The hat's grey, #55514C, is nearly the dark card's glass (#F4F1E8 at 30% over a dark
  // page), so a patch in it looked see-through. Below the hat (rows 3-7; 9-13 asleep)
  // nothing is painted in that grey, and the patch and its strap are a darker one.
  for (const pose of ['done', 'rest'] as const) {
    const tints = tintsOf(headAndBody(without(draw('cat', 'scout', pose), ['ct-bl'])))
    const below = pose === 'rest' ? 14 : 8
    const hatGrey = cellsOf(tints.filter(p => p[4] === '#55514C')).filter(([, y]) => y >= below).length
    const patch = cellsOf(tints.filter(p => p[4] === '#2E2C2A')).filter(([, y]) => y >= below).length
    expect(`${pose}: cells in the hat's grey below the hat ${hatGrey}`).toBe(`${pose}: cells in the hat's grey below the hat 0`)
    expect(`${pose}: has a patch ${patch > 0}`).toBe(`${pose}: has a patch true`)
  }
})
