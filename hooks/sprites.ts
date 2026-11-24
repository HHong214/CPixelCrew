// Pixel mascots for the crew, in two themes drawn on the same 30 x 28 grid.
// Pure: strings in, SVG markup out. No `$`, no JSX, no DOM, no Node APIs.
//
// `clawd` is the pixel Clawd crab ported from savvy-progress (a 24 x 18 crab,
// one costume per kind of work); `cat` is a black cat in the same kinds of costume
// that sits facing forward, curls up to sleep and rides a broom. A sprite is a
// pile of grid-aligned <rect>s grouped into classed
// <g>s; every motion is CSS in the block `spriteCss(theme)` returns. Class and
// keyframe names carry a theme prefix (`cw-` crab, `ct-` cat) so the themes
// and the host drawing's own classes never meet.
import type { ThemeName } from '../types'
import { spriteColor } from './model'

export const SPRITE_W = 30
export const SPRITE_H = 28
// `ride` is the bar's progress row: the cat on its broom; the crab draws it as `work`.
export type Pose = 'work' | 'rest' | 'wait' | 'done' | 'planned' | 'ride'
// The costumes by sprite key: the main agent's, then one per kind of work (KINDS in
// model.ts names each kind's key and holds its colour).
export const SPRITE_ROLES: readonly string[] = [
  'main', 'ace', 'detective', 'engineer', 'chef', 'sprinter', 'scout',
  'designer', 'writer', 'tester', 'reviewer', 'analyst', 'planner', 'helper',
]

const CLAY = '#D97757'
const INK = '#1F1E1D'
const CAT_EAR = '#8E7CC3'
const CAT_EAR_SH = '#6F5FA8'
const GLASS = 'rgba(169,214,245,.32)'
const STEEL = '#8E929A'
const WOOD = '#7A4A26'
const POSES: readonly string[] = ['work', 'rest', 'wait', 'done', 'planned', 'ride']

// `cls` puts a pixel in a named group that CSS can move; no `cls` is the part's
// own still pixels.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void
type Box = [x: number, y: number, w: number, h: number, c: string]

// Row strings to rectangles: runs of one colour merge along a row, and equal
// runs on consecutive rows merge downwards, so a stamp costs few <rect>s.
const boxesOf = (x: number, y: number, rows: readonly string[], map: Record<string, string>): Box[] => {
  const out: Box[] = []
  let open = new Map<string, Box>()
  rows.forEach((row, dy) => {
    const cells = [...row].map(ch => map[ch] ?? '')
    const next = new Map<string, Box>()
    let dx = 0
    while (dx < cells.length) {
      const c = cells[dx] ?? ''
      if (!c) { dx += 1; continue }
      let w = 1
      while (cells[dx + w] === c) w += 1
      const key = `${dx}:${w}:${c}`
      const prev = open.get(key)
      if (prev) { prev[3] += 1; next.set(key, prev) } else {
        const box: Box = [x + dx, y + dy, w, 1, c]
        out.push(box)
        next.set(key, box)
      }
      dx += w
    }
    open = next
  })
  return out
}

const stamp = (f: Fill, x: number, y: number, rows: readonly string[], map: Record<string, string>, cls?: string): void =>
  boxesOf(x, y, rows, map).forEach(b => f(b[0], b[1], b[2], b[3], b[4], cls))

// A pixel painted with NONE carries no fill of its own: it takes its colour
// from its group's class (the marks). A colour written as '.name' is a class
// instead of a fill, so CSS can change it with the colour scheme (the cat's coat).
const NONE = ' '
const look = (c: string): string => (c.startsWith('.') ? ` class="${c.slice(1)}"` : ` fill="${c}"`)

// Rectangles to markup, in paint order. Three or more in a row of one colour
// share a <g fill> (or <g class>) so the colour is written once.
const paint = (boxes: readonly Box[]): string => {
  let out = ''
  let i = 0
  while (i < boxes.length) {
    const c = boxes[i]?.[4] ?? NONE
    let n = 1
    while (boxes[i + n]?.[4] === c) n += 1
    const run = boxes.slice(i, i + n)
    const isShared = c === NONE || n >= 3
    const rects = run.map(b => `<rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}"${isShared ? '' : look(c)}/>`).join('')
    out += isShared && c !== NONE ? `<g${look(c)}>${rects}</g>` : rects
    i += n
  }
  return out
}

// One part of a sprite: still pixels in paint order, plus named groups. A group
// paints after the still pixels (a prop sits in front of the costume) unless it
// is one of UNDER, which keeps its place in the paint order (eyes and eyelids
// stay beneath a costume drawn later). `lead` is markup a group opens with.
type Layer = { items: (Box | string)[]; groups: Map<string, Box[]>; lead: Map<string, string> }
const UNDER: ReadonlySet<string> = new Set(['eye', 'lid', 'bl'])
const newLayer = (): Layer => ({ items: [], groups: new Map(), lead: new Map() })
const fillOf = (l: Layer): Fill => (x, y, w, h, c, cls) => {
  if (!cls) { l.items.push([x, y, w, h, c]); return }
  let g = l.groups.get(cls)
  if (!g) {
    g = []
    l.groups.set(cls, g)
    if (UNDER.has(cls)) l.items.push(cls)
  }
  g.push([x, y, w, h, c])
}
const emit = (l: Layer, prefix: string): string => {
  const group = (cls: string): string => `<g class="${prefix}${cls}">${l.lead.get(cls) ?? ''}${paint(l.groups.get(cls) ?? [])}</g>`
  let out = ''
  let still: Box[] = []
  for (const item of l.items) {
    if (typeof item !== 'string') { still.push(item); continue }
    out += paint(still) + group(item)
    still = []
  }
  return out + paint(still) + [...l.groups.keys()].filter(k => !UNDER.has(k)).map(group).join('')
}

// ---------------------------------------------------------------- marks

// Drawn in the free top-left corner of the box (every costume keeps columns
// 0-4 above row 9 and the strip 0-7 x 0-1 clear). `flip` pre-mirrors the z's
// so they still read as z's on a mirrored sprite.
const Z_BIG = ['zzzz', '..z.', '.z..', 'zzzz']
const Z_SMALL = ['zz.', '.z.', '.zz']
const marks = (prefix: string, pose: string, flip: boolean): string => {
  const l = newLayer()
  const f = fillOf(l)
  const rows = (r: string[]): string[] => (flip ? r.map(s => [...s].reverse().join('')) : r)
  if (pose === 'rest') {
    stamp(f, 2, 6, rows(Z_SMALL), { z: NONE }, 'z1')
    stamp(f, 0, 1, rows(Z_BIG), { z: NONE }, 'z2')
  }
  if (pose === 'wait') {
    f(0, 0, 2, 2, NONE, 'w1'); f(3, 0, 2, 2, NONE, 'w2'); f(6, 0, 2, 2, NONE, 'w3')
  }
  return l.groups.size ? `<g class="${prefix}mk" fill="${STEEL}">${emit(l, prefix)}</g>` : ''
}

// ---------------------------------------------------------------- props
// The new props, shared by both themes: drawn above a raised claw or paw whose
// top is row `y + 10`, centred on column 25. Each sits in the group `it`.

const brush = (f: Fill, y: number, t: string): void => {
  stamp(f, 24, y + 2, ['.a.', 'aaa', 'aaa', '.f.', '.h.', '.h.', '.h.', '.h.'], { a: t, f: '#C9CCD2', h: WOOD }, 'it')
}
const quill = (f: Fill, y: number, t: string): void => {
  stamp(f, 23, y + 1, ['....qq', '...qql', '..qqlq', '..qlqq', '.qlqq.', '.lqq..', '.lq...', '.n....', '.k....'], { q: t, l: '#D9CFF5', n: '#F4F3EE', k: INK }, 'it')
}
const flask = (f: Fill, y: number, t: string): void => {
  stamp(f, 23, y + 2, ['.g.g.', '.g.g.', '.gag.', '.gag.', 'gaaag', 'gabag', 'gaaag', 'ggggg'], { g: STEEL, a: t, b: '#CDEBB8' })
  f(25, y + 1, 1, 1, '#A9D58C', 'bub'); f(26, y, 1, 1, '#A9D58C', 'bu2')
}
const gavel = (f: Fill, y: number, t: string): void => {
  stamp(f, 23, y + 2, ['abbba', 'abbba', 'abbba', '..h..', '..h..', '..h..', '..h..', '..h..'], { a: t, b: WOOD, h: '#A0703F' }, 'it')
}
const chart = (f: Fill, y: number, t: string): void => {
  f(23, y + 9, 7, 1, STEEL)
  f(23, y + 6, 2, 3, t, 'b1'); f(25, y + 4, 2, 5, '#E9B955', 'b2'); f(27, y + 2, 2, 7, t, 'b3')
}
const blueprint = (f: Fill, y: number, t: string): void => {
  stamp(f, 22, y + 1, ['dlllllld', 'dbbbbbbd', '.bbbbbb.', '.bwbbwb.', '.wwwwww.', '.bwbbwb.', '.bwbbwb.', '.wwwwww.', '.bwbbwb.'], { b: t, l: '#A9C0E0', d: '#48689A', w: '#DCE6F5' }, 'it')
}
const pencil = (f: Fill, x: number, y: number): void => {
  stamp(f, x, y, ['k.....', '.wy...', '..yy..', '...yy.', '....yy', '.....e'], { k: '#4A4A48', w: '#F0D2A0', y: '#F5C542', e: '#E58FA6' })
}

// ---------------------------------------------------------------- clawd

// `armFront` raises the right claw; `armCls` lets it travel with the prop it
// holds. A resting crab gets eyelids, which CSS shows for a blink.
const crabBody = (f: Fill, armFront = 0, armCls?: string, pose = 'done'): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  if (pose === 'rest') { f(9, 12, 2, 1, CLAY, 'lid'); f(19, 12, 2, 1, CLAY, 'lid') }
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

type CrabCostume = (f: Fill, t: string, pose: string) => void
const CRAB: Record<string, CrabCostume> = {
  main: (f, _t, p) => crabBody(f, 0, undefined, p),
  // Astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  ace: (f, t, p) => {
    crabBody(f, 0, undefined, p)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, GLASS); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Detective with a deerstalker; the magnifier sweeps and glints.
  detective: (f, t, p) => {
    crabBody(f, -4, 'it', p)
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: WOOD, c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, WOOD, 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Engineer in a hard hat; the wrench turns a bolt.
  engineer: (f, t, p) => {
    crabBody(f, 0, undefined, p)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: STEEL }, 'it')
  },
  // Chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  chef: (f, t, p) => {
    crabBody(f, -4, 'pan', p)
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Racer in a helmet; runs at double pace, the checkered flag flutters.
  sprinter: (f, t, p) => {
    crabBody(f, -4, undefined, p)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, STEEL)
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Pirate scouting the code; the cutlass fences.
  scout: (f, _t, p) => {
    crabBody(f, 0, undefined, p)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, WOOD, 'it')
  },
  // Painter in a beret; the brush dabs.
  designer: (f, t, p) => {
    crabBody(f, -4, 'it', p)
    stamp(f, 6, 3, ['.........s........', '.....ppppppppp....', '..ppppppppppppppp.', 'pphpppppppppppppp.', 'phpppppppppppppp..', '.ppppppppppppppp..', '...dddddddddddddd.'], { p: t, h: '#EC8FAF', s: '#9C3458', d: '#9C3458' })
    brush(f, 0, t)
  },
  // Writer in round glasses; the quill scribbles.
  writer: (f, t, p) => {
    crabBody(f, -4, undefined, p)
    const ring = ['.aaaa.', 'allmla', 'al..la', 'al..la', 'alllla', '.aaaa.']
    const lens = { a: t, l: 'rgba(255,255,255,.3)', m: 'rgba(255,255,255,.75)' }
    stamp(f, 7, 10, ring, lens); stamp(f, 17, 10, ring, lens)
    f(13, 12, 4, 1, t)
    quill(f, 0, t)
  },
  // Tester in safety goggles; the flask bubbles.
  tester: (f, t, p) => {
    crabBody(f, -4, undefined, p)
    f(13, 12, 4, 2, '#3A3A3C')
    for (const x of [7, 17]) {
      f(x, 11, 6, 1, t); f(x, 14, 6, 1, t); f(x, 12, 1, 2, t); f(x + 5, 12, 1, 2, t)
      f(x + 1, 12, 4, 2, 'rgba(169,214,245,.55)')
    }
    flask(f, 0, t)
  },
  // Judge in a wig; the gavel taps.
  reviewer: (f, t, p) => {
    crabBody(f, -4, undefined, p)
    stamp(f, 5, 4, [
      '......wwwwwwww......', '....wwwgwwwwgwww....', '...wwwwwwwwwwwwww...', '..wwgwwwwwwwwwwgww..',
      '..wwwwwwwwwwwwwwww..', '.wgwwwwwwwwwwwwwwgw.', '.www............www.', '.wgw............wgw.',
      '.www............www.', '.wgw............wgw.', '.ww..............ww.',
    ], { w: '#ECEAE2', g: '#BDBBB0' })
    gavel(f, 0, t)
  },
  // Analyst in a visor; the bars of the chart rise.
  analyst: (f, t, p) => {
    crabBody(f, -4, undefined, p)
    f(8, 7, 14, 1, '#8F6210'); f(7, 8, 16, 1, '#8F6210'); f(6, 9, 17, 1, t); f(8, 10, 14, 1, '#E9B955')
    chart(f, 0, t)
  },
  // Planner with a pencil tucked behind the eye; the blueprint sways.
  planner: (f, t, p) => {
    crabBody(f, -4, undefined, p)
    pencil(f, 6, 6)
    blueprint(f, 0, t)
  },
  // Helper in a bandana; the knot's tails flutter.
  helper: (f, t, p) => {
    crabBody(f, 0, undefined, p)
    stamp(f, 6, 7, ['...gggggggggggg...', '.gggglgggggglgggg.', 'gglggggglggggggglg', '.dddddddddddddddd.'], { g: t, l: '#B9B7AE', d: '#5F5E5A' })
    f(23, 9, 2, 2, '#5F5E5A')
    stamp(f, 24, 11, ['gg.', '.gg', '.gd'], { g: t, d: '#5F5E5A' }, 'tie')
  },
}

const crabMarkup = (role: string, pose: string, accent: string): string => {
  const bd = newLayer()
  const la = newLayer()
  const lb = newLayer()
  const fb = fillOf(bd)
  const fa = fillOf(la)
  const fl = fillOf(lb)
  const f: Fill = (x, y, w, h, c, cls) => {
    if (cls === 'la') fa(x, y, w, h, c)
    else if (cls === 'lb') fl(x, y, w, h, c)
    else fb(x, y, w, h, c, cls)
  }
  const draw = CRAB[role] ?? CRAB.helper
  draw?.(f, accent, pose)
  return `<g class="cw-bd">${emit(bd, 'cw-')}</g><g class="cw-la">${emit(la, 'cw-')}</g><g class="cw-lb">${emit(lb, 'cw-')}</g>`
}

// Pure CSS, run by the compositor: no redraws. Work-loop periods divide one
// second, so the once-a-second redraw of a running row restarts them in phase.
const MARK_CSS = (p: string): string => `
.${p}mk{fill:#85857f}
@media (prefers-color-scheme: dark){.${p}mk{fill:#b4b3ad}}
.${p}rest .${p}z1{animation:${p}zz 3s linear infinite}.${p}rest .${p}z2{animation:${p}zz 3s linear infinite -1.5s}
@keyframes ${p}zz{0%{opacity:0;transform:translate(1px,1px)}30%,65%{opacity:1}100%{opacity:0;transform:translate(0,-1px)}}
.${p}wait .${p}w1{animation:${p}dot 1.5s steps(1) infinite}.${p}wait .${p}w2{animation:${p}dot 1.5s steps(1) infinite -1s}.${p}wait .${p}w3{animation:${p}dot 1.5s steps(1) infinite -.5s}
@keyframes ${p}dot{0%{opacity:1}34%{opacity:.25}}`

// The motions of the props both themes share.
const PROP_CSS = (p: string): string => `
.${p}r-designer.${p}work .${p}it{animation:${p}dab .5s ease-in-out infinite}
@keyframes ${p}dab{50%{transform:translateY(-2px)}}
.${p}r-writer.${p}work .${p}it{animation:${p}scrib .5s steps(1) infinite}
@keyframes ${p}scrib{25%{transform:translate(-1px,0)}50%{transform:translate(-1px,1px)}75%{transform:translate(0,1px)}}
.${p}r-tester.${p}work .${p}bub{animation:${p}bub 1s linear infinite}.${p}r-tester.${p}work .${p}bu2{animation:${p}bub 1s linear infinite -.5s}
@keyframes ${p}bub{0%{opacity:0;transform:translateY(2px)}40%{opacity:1}100%{opacity:0;transform:translateY(0)}}
.${p}r-reviewer.${p}work .${p}it{transform-origin:50% 100%;animation:${p}tap .5s ease-in infinite}
@keyframes ${p}tap{0%,45%{transform:rotate(0)}75%{transform:rotate(14deg)}}
.${p}b1,.${p}b2,.${p}b3{transform-origin:50% 100%}
.${p}r-analyst.${p}work .${p}b1{animation:${p}rise 1s steps(3) infinite}.${p}r-analyst.${p}work .${p}b2{animation:${p}rise 1s steps(5) infinite}.${p}r-analyst.${p}work .${p}b3{animation:${p}rise 1s steps(7) infinite}
@keyframes ${p}rise{0%{transform:scaleY(.15)}70%,100%{transform:scaleY(1)}}
.${p}r-planner.${p}work .${p}it{transform-origin:50% 100%;animation:${p}sway 1s ease-in-out infinite}
@keyframes ${p}sway{25%{transform:rotate(-6deg)}75%{transform:rotate(6deg)}}
.${p}r-helper.${p}work .${p}tie{transform-origin:0 0;animation:${p}flut .5s steps(1) infinite}
@keyframes ${p}flut{50%{transform:rotate(-16deg)}}`

const CRAB_CSS = `<style>
.cw g{transform-box:fill-box}
.cw-lid{opacity:0}
.cw-work .cw-la{animation:cw-st .5s steps(1) infinite}.cw-work .cw-lb{animation:cw-st .5s steps(1) infinite -.25s}
.cw-work .cw-bd{animation:cw-bob .5s steps(1) infinite -.125s}
@keyframes cw-st{50%{transform:translateY(-1px)}}@keyframes cw-bob{50%{transform:translateY(1px)}}
.cw-r-ace.cw-work{animation:cw-float 1s ease-in-out infinite}
.cw-r-ace.cw-work .cw-la,.cw-r-ace.cw-work .cw-lb,.cw-r-ace.cw-work .cw-bd{animation:none}
.cw-r-ace.cw-work .cw-ant{animation:cw-blink 1s steps(1) infinite}
.cw-r-ace.cw-work .cw-star{animation:cw-blink .5s steps(1) infinite -.25s}
@keyframes cw-float{50%{transform:translateY(-2px)}}@keyframes cw-blink{50%{opacity:.15}}
.cw-r-detective.cw-work .cw-it{animation:cw-scan 1s steps(1) infinite}
.cw-r-detective.cw-work .cw-gl{animation:cw-blink 1s steps(1) infinite -.5s}
@keyframes cw-scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.cw-r-engineer.cw-work .cw-it{transform-origin:100% 100%;animation:cw-twist .5s ease-in-out infinite}
@keyframes cw-twist{50%{transform:rotate(-35deg)}}
.cw-r-chef.cw-work .cw-pan{transform-origin:0 50%;animation:cw-tilt 1s ease-in-out infinite}
.cw-r-chef.cw-work .cw-egg{animation:cw-flip 1s ease-in-out infinite}
@keyframes cw-tilt{20%,40%{transform:rotate(-12deg)}}@keyframes cw-flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.cw-r-sprinter.cw-work .cw-la{animation-duration:.25s}.cw-r-sprinter.cw-work .cw-lb{animation-duration:.25s;animation-delay:-.125s}
.cw-r-sprinter.cw-work .cw-flag{transform-origin:0 50%;animation:cw-wave .25s steps(1) infinite}
@keyframes cw-wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.cw-r-scout.cw-work .cw-it{transform-origin:50% 100%;animation:cw-fence .5s ease-in-out infinite}
@keyframes cw-fence{50%{transform:rotate(25deg)}}${PROP_CSS('cw-')}
.cw-rest .cw-bd{animation:cw-bob 3s steps(1) infinite}
.cw-rest .cw-lid{animation:cw-shut 4s steps(1) infinite}
@keyframes cw-shut{0%{opacity:0}93%{opacity:1}97%{opacity:0}}${MARK_CSS('cw-')}
@media (prefers-reduced-motion: reduce){.cw,.cw *{animation:none!important}}
</style>`

// ---------------------------------------------------------------- cat

// A black cat drawn without an outline, facing forward and symmetrical about
// column 14: a round head with large soft-tipped ears (lilac inside), big
// pale-yellow eyes with tall pupils and no rim, a tiny nose and no mouth, black
// whiskers, a pear-shaped body sitting upright with its front paws together, and
// a tail that rises on its right and curls at the tip. One black for body, tail
// and whiskers in light and dark alike (`ct-k`); one step lighter (`ct-l`) only
// for the chest line and the paws; lilac lines for shut eyes (`ct-cl`). Three
// bodies share one head: sitting (work, wait, done, planned), curled up asleep
// (rest) and riding a broom (ride). The head and everything worn on it are drawn
// in the sitting head's coordinates and moved into place for the curled cat.
const FUR = '.ct-k'
const FUR_LIT = '.ct-l'
const SHUT = '.ct-cl'
const EYE = '#F3EFA0'
const NOSE = '#C7A2E0'
const STRAW = '#E9C46A'
const STRAW_SH = '#C9963A'
const HANDLE = '#B07A45'
const SPARK = '#F5C542'
const CAT_MAP = { k: FUR, l: FUR_LIT, i: CAT_EAR, j: CAT_EAR_SH }

// Rows given as their left half (columns 0-14, the centre column last) and
// mirrored into whole rows, so the cat stays symmetrical.
const sym = (rows: readonly string[]): string[] => rows.map(r => {
  const half = r.padEnd(15, '.')
  return half + [...half.slice(0, 14)].reverse().join('')
})
const shift = (f: Fill, dx: number): Fill => (x, y, w, h, c, cls) => f(x + dx, y, w, h, c, cls)

// Every drawing below is written from column 0 so it reads as it sits on the grid.
// The sitting head, ears from row 1 (a 2px tip) and the chin on row 16.
const CAT_HEAD = sym([
  '........kk',
  '........kkk',
  '.......kkikk',
  '.......kkiikk',
  '.......kkiiikkk',
  '.......kkjiikkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '.......kkkkkkkk',
  '........kkkkkkk',
  '..........kkkkk',
])
// An eye is 4 x 5, rows 9-13: a flat pale-yellow oval, a tall pupil one pixel
// inward of centre, one white glint on the outer side.
const EYE_LEFT = ['.YY.', 'YwPY', 'YYPY', 'YYPY', '.YY.']
const EYE_RIGHT = ['.YY.', 'YPwY', 'YPYY', 'YPYY', '.YY.']
// Shut: fur over the eye and a thin curved line.
const EYE_SHUT = ['kkkk', 'kkkk', 'ckkc', 'kcck', 'kkkk']
const LOOK = { Y: EYE, P: FUR, w: '#FFFFFF', k: FUR, c: SHUT }
const EYE_X = [8, 17]

// Sitting, rows 17-27: a short neck, the chest line down the middle, the haunches
// widening at the floor, the hind feet at the sides and the front paws together
// in the middle (their pixels are stamped separately so a raised paw can leave).
const CAT_SIT = sym([
  '...........kkkk',
  '...........kkkl',
  '..........kkkkl',
  '..........kkkkl',
  '..........kkkkk',
  '.........kkkkkk',
  '.........kkkkkk',
  '........kkkkkkk',
  '........kkkkkkk',
  '........kkk.kkk',
  '.........kk.kkk',
])
const PAW_L = 12
const PAW_R = 15

// The tail's still root along the floor (rows 23-26), and its moving part
// (rows 5-22) in six frames of one travelling wave: the base leads, the tip
// follows, curling in and opening out. Frame 3 is the rest position. Drawn from
// column 20, clear of the whiskers.
const TAIL_X = 20
const TAIL_Y = 5
const TAIL_ROOT = ['.....kk', '....kk', '..kkk', 'kkk']
const TAIL: readonly (readonly string[])[] = [
  ['...kk', '....kk', '.....kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '.....kk', '.....kk'],
  ['...kk', '....kk', '.....kk', '......kk', '......kk', '......kk', '......kk', '......kk', '......kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '......kk', '......kk'],
  ['', '....kkk', '...kk.kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '........kk', '........kk', '........kk', '........kk', '........kk', '.......kk', '.......kk', '......kk', '......kk'],
  ['', '.....kkk', '....kk.kk', '....k...kk', '........kk', '........kk', '........kk', '........kk', '........kk', '........kk', '........kk', '........kk', '........kk', '........kk', '.......kk', '......kk', '.....kk', '.....kk'],
  ['', '.....kkk', '....kk.kk', '....k...kk', '........kk', '........kk', '........kk', '........kk', '........kk', '........kk', '.......kk', '.......kk', '.......kk', '.......kk', '......kk', '.....kk', '.....kk', '.....kk'],
  ['', '....kkk', '...kk.kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '.......kk', '......kk', '......kk', '......kk', '......kk', '.....kk', '.....kk', '.....kk', '.....kk'],
]
const MID = 3
// Waiting: the rest frame without its top, and the curled tip in three places for a flick.
const FLICK_ROWS = 4
const TIP_FLICK = [['', '.....kkk', '....kk.kk', '....k...kk'], ['', '.....kkk', '....kk.kk', '........kk'], ['.....kk', '......kk', '.......kk', '........kk']]

// Curled up asleep (rest): a round loaf of a body with the head tucked in on
// the right, the haunch and a hind paw on the left, the front paws under the
// chin, and the tail wrapped along the front with its tip curling past the paws.
const REST_DX = 4
const REST_DY = 8
const CAT_CURL = [
  '.......kkkkk',
  '.....kkkkkkkk',
  '....kkkkkkkkkk',
  '...kkkkkkkkkkk',
  '..kkkkkkkkkkkk',
  '..kkkkkkkkkkk',
  '.kkkkkkkkkkkk',
  '.kkkkkkkkkkkk',
  '.kkkkkkkkkkkk',
  '.kkkkkkkkkkkk',
  '.kkkkkkkkkkkk',
  '..kkkkkkkkkkkk',
  '..kkkkkkkkkkkkkkkkkkkkk',
  '...kkkkkkkkkkkkkkkkkkkkk',
  '.....kkkkkkkkkkkkkkkkkkk',
]
// The front paws under the chin, one step lighter.
const CURL_PAWS = ['.............ll.ll']
const CURL_TIP: readonly (readonly string[])[] = [
  ['', '', 'kkkk'],
  ['', '...k', 'kkk'],
  ['...k', '..k', 'kk'],
  ['..k', '..k', 'kk'],
  ['..kk', '.k', 'kk'],
  ['', '..kk', 'kk'],
]

// Riding (ride): the same head, a shorter body seated on the handle, legs
// hanging over it, the tail rising on the right from the seat (RIDE_DY rows
// higher), the straw on the left.
const RIDE_DY = -4
const CAT_RIDE = sym([
  '...........kkkk',
  '..........kkkkl',
  '.........kkkkkl',
  '.........kkkkkk',
  '.........kkkkkk',
])
const RIDE_LEGS = sym(['.........kk.kk', '.........kk.kk', '.........ll.ll'])
const RIDE_ROOT = ['....kk', '..kkk', 'kkk']
const BRISTLES = ['...SSSS', '.ssssssbb', 'SSSSSSSbb', 'sssssssbb', '.SSSSSSbb', '...ssss']

// The raised paw: an arm two pixels thick from the shoulder to a 2 x 2 paw whose
// top-left pixel is (x, y), drawn as rows from the paw's row down to the
// shoulder's. A frame of the arm is [x, y, lean]: `lean` tips what the paw
// holds, its top moving that many pixels right per row above the grip.
type Paw = readonly [x: number, y: number, lean?: number]
const SHOULDER = [10, 18] as const
const armRows = (px: number, py: number): string[] => {
  const [sx, sy] = SHOULDER
  const on = new Set<string>()
  const n = Math.max(Math.abs(sx - px), Math.abs(sy - py), 1)
  for (let i = 0; i <= n; i += 1) {
    const x = Math.round(sx + ((px - sx) * i) / n)
    const y = Math.round(sy + ((py - sy) * i) / n)
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) on.add(`${x + a},${y + b}`)
  }
  const rows: string[] = []
  for (let y = py; y <= sy + 1; y += 1) {
    let row = ''
    for (let x = 0; x <= sx + 1; x += 1) row += x - px >= 0 && x - px < 2 && y - py < 2 ? 'l' : on.has(`${x},${y}`) ? 'k' : '.'
    rows.push(row)
  }
  return rows
}

// What a costume draws with. `hat` paints over the head in the sitting head's
// coordinates and goes wherever the head goes; `chest` paints over the chest
// when sitting or riding. `hold` raises the left paw (the cat's right) and puts
// the prop in it, only when sitting: `draw` paints the prop in the props' own
// coordinates, grip at column 24 row 15, and `arc` gives the arm's frames (the
// middle one is the still pose); `flip` mirrors the prop about its grip.
// `ground` paints beside the cat and `sky` in the free top-right corner, both
// only when sitting.
type CatKit = {
  hat: Fill
  chest: Fill
  hold: (draw: (f: Fill) => void, arc: readonly Paw[], flip?: boolean) => void
  ground: Fill
  sky: Fill
}

type CatCostume = (k: CatKit, t: string) => void
const CATS: Record<string, CatCostume> = {
  main: () => {},
  // A glass dome over head and ears on a collar whose lights blink; a star twinkles.
  ace: (k, t) => {
    const inset = [9, 6, 5, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5]
    inset.forEach((l, y) => {
      const prev = inset[y - 1] ?? l
      const edge = y === 0 ? 29 - 2 * l : Math.max(1, prev - l)
      k.hat(l, y, edge, 1, '#E6E8EE')
      k.hat(29 - l - edge, y, edge, 1, '#E6E8EE')
      if (y > 0 && 29 - 2 * (l + edge) > 0) k.hat(l + edge, y, 29 - 2 * (l + edge), 1, 'rgba(169,214,245,.16)')
    })
    k.hat(6, 3, 1, 1, '#fff'); k.hat(5, 4, 1, 2, '#fff')
    k.hat(5, 17, 19, 1, '#C9CCD2')
    k.hat(8, 17, 1, 1, t, 'ant'); k.hat(20, 17, 1, 1, t, 'ant')
    k.chest(13, 19, 3, 2, t)
    k.sky(27, 1, 1, 3, '#F5C542', 'star'); k.sky(26, 2, 3, 1, '#F5C542', 'star')
  },
  // A tweed deerstalker between the ears, its flaps tied on top; the magnifier sweeps left to right.
  detective: (k, t) => {
    stamp(k.hat, 8, 3, ['.....d.d', '....bcbcb', '..bbcbbbcbb', '.bcbbcbcbbcb', '.ttttttttttt', 'ddddddddddddd'], { b: WOOD, c: '#A0703F', d: '#5A3519', t })
    k.hold(f => {
      stamp(f, 22, 5, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#6B6B70' })
      f(23, 6, 3, 3, 'rgba(169,214,245,.7)'); f(24, 10, 1, 5, WOOD); f(23, 6, 1, 1, '#fff', 'gl')
    }, [[2, 14], [3, 13], [4, 14]])
  },
  // A hard hat over the ear roots with a badge in the accent colour; the wrench turns about its jaw.
  engineer: (k, t) => {
    stamp(k.hat, 8, 3, ['.....yhy', '...yyyhyyy', '..yyyyhyyyy', '..yyyyhyyyy', '.yyyyyhyyyyy', 'ddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    k.hat(11, 5, 2, 2, t)
    k.hold(f => stamp(f, 22, 6, ['ss.ss', 'ss.ss', 'sssss', '.sss.', '..s..', '..s..', '..s..', '..s..', '..s..'], { s: STEEL }), [[4, 15, -0.25], [3, 14], [2, 15, 0.25]])
  },
  // A tall toque between the ears; stirs the pan round and tosses the omelette.
  chef: (k, t) => {
    stamp(k.hat, 11, 0, ['..www', '.wwgww', 'wwgwwww', 'wwwwgww', '.wgwww', '.wwwww', '.bbbbb', 'dbbbbbd'], { w: '#F4F3EE', g: '#D2D1C8', b: t, d: '#2A6CB0' })
    k.hold(f => {
      f(25, 13, 5, 1, '#5A5A58'); f(25, 12, 1, 1, '#5A5A58'); f(29, 12, 1, 1, '#5A5A58'); f(24, 14, 1, 1, '#5A5A58')
      f(26, 12, 3, 1, '#F5B731', 'egg')
    }, [[5, 17], [5, 15], [6, 16]], true)
  },
  // A racing helmet the ear tips poke out of; the checkered flag waves from side to side.
  sprinter: (k, t) => {
    stamp(k.hat, 8, 4, ['....rrwrr', '..rrrrwrrrr', '.rrrrrwrrrrr', 'rrrrrrwrrrrrr', 'kkkkkkkkkkkkk'], { r: t, w: '#F8F6F1', k: '#0F5C44' })
    k.hold(f => { f(24, 5, 1, 10, STEEL); stamp(f, 25, 5, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: '#4A4A52' }, 'flag') }, [[4, 15, 0.2], [4, 14], [6, 15, -0.2]], true)
  },
  // A pirate's hat with a band in the accent colour, a patch over one eye; the cutlass thrusts.
  scout: (k, t) => {
    stamp(k.hat, 8, 3, ['....kkkkk', '...kkkwkkk', '..kkkkkkkkk', 'k.ttttttttt.k', 'ggggggggggggg'], { k: '#55514C', w: '#F8F6F1', t, g: '#F5C542' })
    stamp(k.hat, 17, 8, ['...p', 'pppp', 'pppp', 'pppp', 'pppp', '.pp.'], { p: '#55514C' })
    k.hold(f => { f(24, 4, 1, 10, '#C9CCD2'); f(23, 14, 3, 1, WOOD) }, [[4, 16, 0.15], [3, 14], [2, 13, -0.2]])
  },
  // A beret tilted over the right ear; the brush dabs forward and back.
  designer: (k, t) => {
    stamp(k.hat, 9, 3, ['.......s', '....ppppppp', '..pphpppppppp', '.pphppppppppppp', '...ddddddddd'], { p: t, h: '#EC8FAF', s: '#9C3458', d: '#9C3458' })
    k.hold(f => brush(f, 5, t), [[3, 16, 0.1], [3, 14], [2, 12, -0.1]])
  },
  // Round glasses in the accent colour; the quill scribbles.
  writer: (k, t) => {
    const ring = ['.aaaa.', 'a....a', 'a....a', 'a....a', 'a....a', 'a....a', '.aaaa.']
    stamp(k.hat, 7, 8, ring, { a: t }); stamp(k.hat, 16, 8, ring, { a: t })
    k.hat(13, 10, 3, 1, t)
    k.hold(f => quill(f, 5, t), [[4, 15], [5, 14], [4, 14]], true)
  },
  // Safety goggles on a strap; the flask swirls and bubbles.
  tester: (k, t) => {
    k.hat(5, 10, 2, 1, '#6B6B74'); k.hat(22, 10, 2, 1, '#6B6B74')
    for (const x of EYE_X) {
      stamp(k.hat, x - 1, 8, ['aaaaaa', 'a....a', 'a....a', 'a....a', 'a....a', 'a....a', 'aaaaaa'], { a: t })
      k.hat(x, 9, 4, 5, 'rgba(169,214,245,.3)')
    }
    k.hold(f => flask(f, 5, t), [[3, 15, -0.12], [4, 14], [3, 15, 0.12]])
  },
  // A judge's wig the ears poke through, its rolls tied in the accent colour; a
  // lace jabot; the gavel taps.
  reviewer: (k, t) => {
    stamp(k.hat, 6, 4, [
      '.....wwwwwww', '...wwgwwwwwgww', '.wwwgwwwwwwwgwww', 'ww.............ww', 'gw.............wg',
      'ww.............ww', 'wg.............gw', 'ww.............ww', 'gw.............wg',
    ], { w: '#ECEAE2', g: '#BDBBB0' })
    k.hat(6, 13, 2, 1, t); k.hat(21, 13, 2, 1, t)
    stamp(k.chest, 12, 17, ['wwwww', '.wgw.', '.www.'], { w: '#ECEAE2', g: '#BDBBB0' })
    k.hold(f => gavel(f, 5, t), [[1, 12], [2, 14], [2, 16]])
  },
  // A visor whose brim juts out over the eyes; beside the cat the bars of the chart rise.
  analyst: (k, t) => {
    k.hat(7, 7, 15, 1, '#8F6210')
    k.hat(6, 8, 17, 1, t); k.hat(6, 8, 4, 1, '#E9B955')
    chart(shift(k.ground, -23), 18, t)
  },
  // A pencil in the accent colour tucked behind the right ear; the blueprint sways.
  planner: (k, t) => {
    stamp(k.hat, 13, 4, ['ettttttttwg', 'ettttttttww'], { e: '#E58FA6', t, w: '#F0D2A0', g: '#4A4A48' })
    stamp(k.hat, 16, 4, ['kkiik', 'kkiik'], CAT_MAP)
    k.hold(f => stamp(f, 22, 8, ['llllll', 'bwbbwb', 'wwwwww', 'bwbbwb', 'bwbbwb', 'wwwwww', 'bwbbwb'], { b: t, l: '#A9C0E0', w: '#DCE6F5' }), [[3, 15, -0.1], [3, 14], [2, 15, 0.1]])
  },
  // A bandana tied over the head between the ears; the knot's tails flutter.
  helper: (k, t) => {
    stamp(k.hat, 8, 4, ['.....ggg', '...gglgggg', '..ggggglggg', '.gglgggggggg', 'ddddddddddddd'], { g: t, l: '#B9B7AE', d: '#5F5E5A' })
    k.hat(7, 7, 1, 2, '#5F5E5A')
    stamp(k.hat, 4, 8, ['.gg', 'gg.', 'dg.'], { g: t, d: '#5F5E5A' }, 'tie')
  },
}

const SPARKS: readonly [x: number, y: number, plus: boolean][] = [[2, 16, true], [1, 20, false], [1, 25, true], [5, 27, false]]

const catMarkup = (role: string, pose: string, accent: string): string => {
  const isRest = pose === 'rest'
  const isRide = pose === 'ride'
  const isSit = !isRest && !isRide
  const isWork = pose === 'work'
  const tailL = newLayer()
  const bodyL = newLayer()
  const headL = newLayer()
  const frontL = newLayer()
  const tail = fillOf(tailL)
  const body = fillOf(bodyL)
  const head = fillOf(headL)
  const front = fillOf(frontL)
  const none: Fill = () => {}
  // The head's coordinates, moved into place for the curled cat.
  const hd: Fill = isRest ? (x, y, w, h, c, cls) => head(x + REST_DX, y + REST_DY, w, h, c, cls) : head
  // The tail rises on the right; riding, it starts higher, from the seat.
  const tl: Fill = isRide ? (x, y, w, h, c, cls) => tail(x, y + RIDE_DY, w, h, c, cls) : tail

  // The tail: six frames where it waves; one still frame, or a flicking tip, elsewhere.
  const isWaving = isWork || pose === 'done' || isRide
  if (isRest) {
    CURL_TIP.forEach((rows, n) => stamp(tail, 24, 24, rows, CAT_MAP, `t${n}`))
  } else {
    stamp(tl, TAIL_X, 23, isRide ? RIDE_ROOT : TAIL_ROOT, CAT_MAP)
    if (isWaving) TAIL.forEach((rows, n) => stamp(tl, TAIL_X, TAIL_Y, rows, CAT_MAP, `t${n}`))
    else if (pose === 'wait') {
      stamp(tl, TAIL_X, TAIL_Y + FLICK_ROWS, (TAIL[MID] ?? []).slice(FLICK_ROWS), CAT_MAP)
      TIP_FLICK.forEach((tip, n) => stamp(tl, TAIL_X, TAIL_Y, tip, CAT_MAP, `k${n}`))
    } else stamp(tl, TAIL_X, TAIL_Y, TAIL[MID] ?? [], CAT_MAP)
  }

  // The body.
  if (isRest) {
    stamp(body, 0, 12, CAT_CURL, CAT_MAP)
    stamp(body, 0, 25, CURL_PAWS, CAT_MAP)
    // The back rises with each breath, along with the head.
    stamp(head, 0, 12, CAT_CURL.slice(0, 3), CAT_MAP)
  } else if (isRide) {
    stamp(body, 0, 20, BRISTLES, { S: STRAW, s: STRAW_SH, b: WOOD })
    body(9, 22, 21, 1, HANDLE); body(9, 23, 21, 1, WOOD)
    stamp(body, 0, 17, CAT_RIDE, CAT_MAP)
  } else stamp(body, 0, 17, CAT_SIT, CAT_MAP)

  // The head: ears, eyes, nose, whiskers; no mouth.
  stamp(hd, 0, 1, CAT_HEAD, CAT_MAP)
  // Both eyes before either lid, so the blink covers both.
  EYE_X.forEach((x, n) => stamp(hd, x, 9, isRest ? EYE_SHUT : n ? EYE_RIGHT : EYE_LEFT, LOOK))
  if (isWork || pose === 'done') for (const x of EYE_X) stamp(hd, x, 9, EYE_SHUT, LOOK, 'bl')
  hd(14, 14, 1, 1, NOSE)
  // Two fine whiskers a side, fanning out from the cheeks.
  for (const [x, tip] of [[5, 4], [22, 24]] as const) {
    hd(x, 12, 2, 1, FUR); hd(tip, 11, 1, 1, FUR); hd(x, 14, 2, 1, FUR); hd(tip, 15, 1, 1, FUR)
  }

  // The costume, then the paws it leaves down.
  let isRaised = false
  const arms: string[] = []
  const kit: CatKit = {
    hat: hd,
    chest: isRest ? none : body,
    ground: isSit ? front : none,
    sky: isSit ? front : none,
    hold: (draw, arc, flip = false) => {
      if (!isSit) return
      isRaised = true
      const still = Math.floor(arc.length / 2)
      arc.forEach(([px, py, lean = 0], n) => {
        if (!isWork && n !== still) return
        const l = isWork ? newLayer() : frontL
        const f = fillOf(l)
        // Into the paw: mirrored if asked, tipped by `lean` row by row above the
        // grip. The prop's own motion groups give way to the arm's frames; its
        // small inner ones (a glint, the egg, the flag's cloth, bubbles) stay.
        const at: Fill = (x, y, w, h, c, cls) => {
          const inner = cls === 'it' || cls === 'pan' ? undefined : cls
          const off = (row: number): number => Math.round(lean * (15 - row))
          let r = 0
          while (r < h) {
            let run = 1
            while (r + run < h && off(y + r + run) === off(y + r)) run += 1
            f((flip ? 25 - x - w : x - 24) + px + off(y + r), y + r + py - 15, w, run, c, inner)
            r += run
          }
        }
        draw(at)
        stamp(f, 0, py, armRows(px, py), CAT_MAP)
        if (isWork) arms.push(`<g class="ct-a${n}">${emit(l, 'ct-')}</g>`)
      })
    },
  }
  const dress = CATS[role] ?? CATS.helper
  dress?.(kit, accent)
  if (isSit) {
    stamp(body, PAW_R, 26, ['ll', 'll'], CAT_MAP)
    if (!isRaised) stamp(body, PAW_L, 26, ['ll', 'll'], CAT_MAP)
  }
  if (isRide) stamp(body, 0, 22, RIDE_LEGS, CAT_MAP)

  const g = (cls: string, l: Layer, more = ''): string => `<g class="ct-${cls}">${emit(l, 'ct-')}${more}</g>`
  if (isRest) return g('bd', bodyL) + g('br', headL) + g('tail', tailL)
  const cat = g('tail', tailL) + g('bd', bodyL) + g('hd', headL) + g('fr', frontL, arms.join(''))
  if (!isRide) return cat
  const sparks = newLayer()
  const sp = fillOf(sparks)
  SPARKS.forEach(([x, y, plus], n) => {
    const cls = `s${n + 1}`
    if (plus) { sp(x, y - 1, 1, 3, SPARK, cls); sp(x - 1, y, 1, 1, SPARK, cls); sp(x + 1, y, 1, 1, SPARK, cls); sp(x, y, 1, 1, '#FFFFFF', cls) } else sp(x, y, 1, 1, SPARK, cls)
  })
  return `<g class="ct-rd">${cat}</g>${emit(sparks, 'ct-')}`
}

// The tail's frames take turns: each is shown for one sixth of the cycle by a
// stepped keyframe of its own, so one duration per pose sets the pace. Frame 3
// shows when nothing runs (planned, reduced motion).
const pct = (n: number): string => `${Math.round((n * 10000) / TAIL.length) / 100}%`
const FRAME_CSS = TAIL.map((_, n) =>
  `.ct-t${n}{animation:ct-f${n} 1s steps(1) infinite}@keyframes ct-f${n}{0%{opacity:${n ? 0 : 1}}${n ? `${pct(n)}{opacity:1}` : ''}${n < TAIL.length - 1 ? `${pct(n + 1)},100%{opacity:0}` : ''}}`).join('')
const frames = (pose: string): string => TAIL.map((_, n) => `.ct-${pose} .ct-t${n}`).join(',')

// The raised arm's three frames swing out and back (0, 1, 2, 1): each end is
// held longest and the middle passes quickly, so the motion eases in and out.
// Frame 1 is the still one (other poses, reduced motion).
const ARM_CSS = `.ct-a0,.ct-a2{opacity:0}
.ct-work .ct-a0{animation:ct-a0 1s steps(1) infinite}.ct-work .ct-a1{animation:ct-a1 1s steps(1) infinite}.ct-work .ct-a2{animation:ct-a2 1s steps(1) infinite}
@keyframes ct-a0{0%{opacity:1}35%,100%{opacity:0}}@keyframes ct-a1{0%{opacity:0}35%{opacity:1}50%{opacity:0}85%,100%{opacity:1}}@keyframes ct-a2{0%,35%{opacity:0}50%{opacity:1}85%,100%{opacity:0}}
${['writer', 'reviewer'].map(r => [0, 1, 2].map(n => `.ct-r-${r}.ct-work .ct-a${n}`).join(',')).join(',')}{animation-duration:.5s}`

// Work-loop periods divide one second, so a 1s tail cycle, 1s or .5s arm swings
// and a 1s broom bob keep in step with each other. A drawing redrawn while it runs
// sets every loop's phase by the clock (draw.ts, `loopAnchors`), so a redraw does
// not start them over. The coat is one black in light and dark mode alike.
const CAT_CSS = `<style>
.ct g{transform-box:fill-box}
.ct-k{fill:#0B0B0D}.ct-l{fill:#18181C}.ct-cl{fill:#8E7CC3}
${TAIL.map((_, n) => (n === MID ? '' : `.ct-t${n}`)).filter(Boolean).join(',')},.ct-k1,.ct-k2,.ct-bl{opacity:0}
${FRAME_CSS}
${frames('rest')},${frames('done')}{animation-duration:3s}
${ARM_CSS}
.ct-work .ct-bl{animation:ct-blink 4s steps(1) infinite}.ct-done .ct-bl{animation:ct-blink 5s steps(1) infinite -1s}
@keyframes ct-blink{0%{opacity:0}82%{opacity:1}86%{opacity:0}}
.ct-wait .ct-k0{animation:ct-k0 2.4s steps(1) infinite}.ct-wait .ct-k1{animation:ct-k1 2.4s steps(1) infinite}.ct-wait .ct-k2{animation:ct-k2 2.4s steps(1) infinite}
@keyframes ct-k0{0%{opacity:1}75%{opacity:0}92%{opacity:1}}@keyframes ct-k1{0%{opacity:0}75%{opacity:1}83%{opacity:0}}@keyframes ct-k2{0%{opacity:0}83%{opacity:1}92%{opacity:0}}
.ct-rest .ct-br{animation:ct-breathe 3s steps(1) infinite}
@keyframes ct-breathe{50%{transform:translateY(-1px)}}
.ct-ride .ct-rd{animation:ct-bob 1s steps(1) infinite}
@keyframes ct-bob{50%{transform:translateY(1px)}}
.ct-s1,.ct-s2,.ct-s3,.ct-s4{animation:ct-twinkle 1s steps(1) infinite}.ct-s2{animation-delay:-.75s}.ct-s3{animation-delay:-.5s}.ct-s4{animation-delay:-.25s}
@keyframes ct-twinkle{0%{opacity:1}25%{opacity:.35}50%,100%{opacity:0}}
.ct-r-ace.ct-work{animation:ct-float 1s ease-in-out infinite}
.ct-r-ace.ct-work .ct-ant{animation:ct-flash 1s steps(1) infinite}
.ct-r-ace.ct-work .ct-star{animation:ct-flash .5s steps(1) infinite -.25s}
@keyframes ct-float{0%,100%{transform:translateY(1px)}50%{transform:translateY(-1px)}}@keyframes ct-flash{50%{opacity:.15}}
.ct-r-detective.ct-work .ct-gl{animation:ct-flash 1s steps(1) infinite -.5s}
.ct-r-chef.ct-work .ct-egg{animation:ct-flip 1s ease-in-out infinite}
@keyframes ct-flip{30%{transform:translateY(-4px) scaleY(-1)}60%{transform:translateY(0)}}
.ct-r-sprinter.ct-work .ct-flag{transform-origin:100% 50%;animation:ct-wave .25s steps(1) infinite}
@keyframes ct-wave{50%{transform:skewY(12deg) scaleX(.85)}}
.ct-r-tester.ct-work .ct-bub{animation:ct-bub 1s linear infinite}.ct-r-tester.ct-work .ct-bu2{animation:ct-bub 1s linear infinite -.5s}
@keyframes ct-bub{0%{opacity:0;transform:translateY(2px)}40%{opacity:1}100%{opacity:0;transform:translateY(0)}}
.ct-b1,.ct-b2,.ct-b3{transform-origin:50% 100%}
.ct-r-analyst.ct-work .ct-b1{animation:ct-rise 1s steps(3) infinite}.ct-r-analyst.ct-work .ct-b2{animation:ct-rise 1s steps(5) infinite}.ct-r-analyst.ct-work .ct-b3{animation:ct-rise 1s steps(7) infinite}
@keyframes ct-rise{0%{transform:scaleY(.15)}70%,100%{transform:scaleY(1)}}
.ct-r-helper.ct-work .ct-tie{transform-origin:100% 0;animation:ct-flut .5s steps(1) infinite}
@keyframes ct-flut{50%{transform:rotate(16deg)}}${MARK_CSS('ct-')}
@media (prefers-reduced-motion: reduce){.ct,.ct *{animation:none!important}}
</style>`

// ---------------------------------------------------------------- exports

export function spriteCss(theme: ThemeName): string {
  return theme === 'cat' ? CAT_CSS : CRAB_CSS
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000)

// The body nests in one classed <g> inside the placed <g>, so CSS transforms
// never fight the placement. `mirror` flips the sprite inside its own box
// (x .. x + SPRITE_W * scale) so it faces the other way. `smile` is accepted
// for older callers and ignored: the cat has no mouth in any pose. `role` is the
// costume's sprite key; `color` the accent it wears (an agent's own colour), its
// kind's base colour when not given.
export function sprite(o: { theme: ThemeName; role: string; pose: Pose; x: number; y: number; scale?: number; mirror?: boolean; smile?: boolean; color?: string }): string {
  const isCat = o.theme === 'cat'
  const p = isCat ? 'ct-' : 'cw-'
  const role = SPRITE_ROLES.includes(o.role) ? o.role : 'helper'
  const accent = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color.trim()) ? o.color.trim() : spriteColor(role)
  const known: string = POSES.includes(o.pose) ? o.pose : 'done'
  // The crab has no broom: it rides by working.
  const pose = !isCat && known === 'ride' ? 'work' : known
  const scale = typeof o.scale === 'number' && Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1.1
  const x = Number.isFinite(o.x) ? o.x : 0
  const y = Number.isFinite(o.y) ? o.y : 0
  const isMirrored = o.mirror === true
  const place = isMirrored
    ? `translate(${num(x + SPRITE_W * scale)},${num(y)}) scale(${num(-scale)},${num(scale)})`
    : `translate(${num(x)},${num(y)}) scale(${num(scale)})`
  const inner = (isCat ? catMarkup(role, pose, accent) : crabMarkup(role, pose, accent)) + marks(p, pose, isMirrored)
  // No rendering hint for crisp edges: the desktop app runs no animation in a picture that sets one.
  return `<g transform="${place}"${pose === 'planned' ? ' opacity="0.45"' : ''}><g class="${p.slice(0, 2)} ${p}r-${role} ${p}${pose}">${inner}</g></g>`
}

export function spriteDoc(o: { theme: ThemeName; role: string; pose: Pose; scale?: number }): string {
  const scale = typeof o.scale === 'number' && Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1.1
  const w = num(SPRITE_W * scale)
  const h = num(SPRITE_H * scale)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${spriteCss(o.theme)}${sprite({ ...o, x: 0, y: 0, scale })}</svg>`
}
