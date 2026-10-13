/**
 * Parametric parts for 3D printing: each kind is described by its fields (numbers, choices, text
 * or on/off), so the inspector, the file check and the geometry worker share one description.
 * Values live in `params.part` of a prim of that kind; sizes are real millimetres.
 *
 * Metric screw sizes (ISO coarse thread) are used by the bolt, the nut and the knob.
 */

export type PartType =
  | 'bolt'
  | 'nut'
  | 'jar'
  | 'rack'
  | 'wheel'
  | 'pulley'
  | 'washer'
  | 'spring'
  | 'boxLid'
  | 'hinge'
  | 'knob'
  | 'tag'

export type PartValue = number | string | boolean
export type PartValues = Record<string, PartValue>

export type Field =
  | { kind: 'num'; def: number; min: number; max: number; step: number; digits?: number; int?: boolean }
  | { kind: 'choice'; def: string; options: readonly string[] }
  | { kind: 'text'; def: string; max: number }
  | { kind: 'bool'; def: boolean }

export interface PartSpec {
  /** fields in the order the inspector shows them */
  fields: Record<string, Field>
  /** fix values that depend on each other (after each field was clamped on its own) */
  fix?: (v: PartValues) => PartValues
}

/** ISO metric coarse thread: pitch, hex width across flats, bolt head height, nut height (mm). */
export const METRIC: Record<string, { d: number; pitch: number; flats: number; head: number; nut: number }> = {
  M6: { d: 6, pitch: 1, flats: 10, head: 4, nut: 5 },
  M8: { d: 8, pitch: 1.25, flats: 13, head: 5.3, nut: 6.5 },
  M10: { d: 10, pitch: 1.5, flats: 16, head: 6.4, nut: 8 },
  M12: { d: 12, pitch: 1.75, flats: 18, head: 7.5, nut: 10 },
  M16: { d: 16, pitch: 2, flats: 24, head: 10, nut: 13 },
  M20: { d: 20, pitch: 2.5, flats: 30, head: 12.5, nut: 16 },
  M24: { d: 24, pitch: 3, flats: 36, head: 15, nut: 19 }
}
export const METRIC_SIZES = Object.keys(METRIC)

const num = (def: number, min: number, max: number, step: number, digits?: number): Field => ({ kind: 'num', def, min, max, step, digits })
const int = (def: number, min: number, max: number): Field => ({ kind: 'num', def, min, max, step: 1, digits: 0, int: true })
const choice = (def: string, options: readonly string[]): Field => ({ kind: 'choice', def, options })
const size = (def = 'M8') => choice(def, METRIC_SIZES)
/** a gap between parts that go together: printers make things a little fatter */
const clearance = (def: number) => num(def, 0, 1, 0.05, 2)

const n = (v: PartValues, k: string) => v[k] as number

export const PARTS: Record<PartType, PartSpec> = {
  bolt: {
    fields: {
      size: size(),
      length: num(25, 4, 200, 1),
      head: choice('hex', ['hex', 'round', 'countersunk', 'none']),
      clearance: clearance(0.2)
    }
  },
  nut: {
    fields: {
      size: size(),
      style: choice('hex', ['hex', 'wing', 'knurled']),
      clearance: clearance(0.2)
    }
  },
  jar: {
    fields: {
      piece: choice('body', ['body', 'lid']),
      diameter: num(60, 30, 200, 5),
      height: num(60, 25, 250, 5),
      wall: num(2, 1.2, 5, 0.2, 1),
      clearance: clearance(0.4)
    },
    fix: (v) => ({ ...v, height: Math.max(n(v, 'height'), jarNeck(n(v, 'diameter')) + n(v, 'wall') * 2 + n(v, 'diameter') * 0.15 + 4) })
  },
  rack: {
    fields: {
      module: num(2, 0.5, 10, 0.5, 2),
      teeth: int(10, 2, 100),
      thickness: num(6, 1, 100, 1),
      base: num(4, 1, 50, 1)
    }
  },
  wheel: {
    fields: {
      diameter: num(60, 20, 250, 5),
      width: num(10, 3, 60, 1),
      bore: num(5, 0, 30, 0.5, 1),
      boreShape: choice('round', ['round', 'd']),
      groove: { kind: 'bool', def: true },
      holes: int(5, 0, 12)
    },
    fix: (v) => ({ ...v, bore: Math.min(n(v, 'bore'), n(v, 'diameter') * 0.4) })
  },
  pulley: {
    fields: {
      diameter: num(30, 10, 200, 1),
      belt: choice('round', ['round', 'v']),
      beltSize: num(3, 1, 12, 0.5, 1),
      bore: num(5, 0, 30, 0.5, 1),
      boreShape: choice('round', ['round', 'd'])
    },
    fix: (v) => ({ ...v, bore: Math.min(n(v, 'bore'), n(v, 'diameter') * 0.6) })
  },
  washer: {
    fields: {
      outer: num(16, 3, 250, 1),
      inner: num(8.4, 0, 240, 0.2, 1),
      height: num(2, 0.4, 150, 0.5, 1)
    },
    fix: (v) => ({ ...v, inner: Math.min(n(v, 'inner'), n(v, 'outer') - 1) })
  },
  spring: {
    fields: {
      diameter: num(20, 5, 120, 1),
      wire: num(2, 0.8, 10, 0.2, 1),
      turns: num(6, 1, 30, 0.5, 1),
      pitch: num(6, 1, 50, 0.5, 1),
      ends: { kind: 'bool', def: true }
    },
    fix: (v) => {
      const wire = Math.min(n(v, 'wire'), n(v, 'diameter') / 3)
      return { ...v, wire, pitch: Math.max(n(v, 'pitch'), wire * 1.4) }
    }
  },
  boxLid: {
    fields: {
      piece: choice('box', ['box', 'lid']),
      style: choice('cap', ['cap', 'slide']),
      width: num(60, 20, 250, 5),
      depth: num(40, 20, 250, 5),
      height: num(30, 10, 250, 5),
      wall: num(2, 1.2, 6, 0.2, 1),
      clearance: clearance(0.3)
    },
    fix: (v) => ({ ...v, height: Math.max(n(v, 'height'), n(v, 'wall') * 4 + 4) })
  },
  hinge: {
    fields: {
      length: num(40, 15, 200, 5),
      width: num(15, 8, 100, 1),
      thickness: num(3, 2, 8, 0.5, 1),
      knuckles: int(5, 3, 9),
      clearance: clearance(0.4)
    },
    // an odd number of knuckles: the outer two belong to the leaf with the pin
    fix: (v) => {
      const odd = (x: number) => (x % 2 === 0 ? x - 1 : x)
      // each knuckle at least about two and a half thicknesses long
      const most = Math.max(3, odd(Math.floor((n(v, 'length') + n(v, 'clearance')) / (2.5 * n(v, 'thickness') + n(v, 'clearance')))))
      let k = Math.round(n(v, 'knuckles'))
      if (k % 2 === 0) k += 1
      return { ...v, knuckles: Math.min(k, most) }
    }
  },
  knob: {
    fields: {
      size: size(),
      diameter: num(30, 15, 100, 1),
      height: num(14, 6, 60, 1),
      grip: choice('star', ['star', 'round']),
      lobes: int(5, 3, 12),
      clearance: clearance(0.2)
    },
    fix: (v) => {
      const m = METRIC[v.size as string]
      return { ...v, diameter: Math.max(n(v, 'diameter'), m.flats * 1.5), height: Math.max(n(v, 'height'), m.nut + 2) }
    }
  },
  tag: {
    fields: {
      text: { kind: 'text', def: 'NerpaCad', max: 24 },
      letter: num(8, 3, 40, 1),
      thickness: num(2, 0.8, 8, 0.2, 1),
      raise: num(1, 0.4, 6, 0.2, 1),
      hole: { kind: 'bool', def: true }
    }
  }
}

export const PART_TYPES = Object.keys(PARTS) as PartType[]
/** the parts already offered in the shapes panel (the rest come in later stages) */
export const READY_PARTS: PartType[] = PART_TYPES
export const isPart = (t: string): t is PartType => t in PARTS

/** Height of a jar's threaded neck (and of its lid's skirt), mm. */
export const jarNeck = (diameter: number) => Math.max(8, Math.min(16, diameter * 0.18))
/** Thread pitch of a jar, mm. */
export const jarPitch = (diameter: number) => (diameter < 80 ? 3 : 4)

/** The values of a part with every field present and within its limits. */
export function clampPart(type: PartType, raw: unknown): PartValues {
  const spec = PARTS[type]
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: PartValues = {}
  for (const [k, f] of Object.entries(spec.fields)) {
    const v = src[k]
    switch (f.kind) {
      case 'num': {
        let x = typeof v === 'number' && Number.isFinite(v) ? v : f.def
        x = Math.min(f.max, Math.max(f.min, x))
        out[k] = f.int ? Math.round(x) : x
        break
      }
      case 'choice':
        out[k] = typeof v === 'string' && f.options.includes(v) ? v : f.def
        break
      case 'text':
        out[k] = typeof v === 'string' ? v.slice(0, f.max) : f.def
        break
      case 'bool':
        out[k] = typeof v === 'boolean' ? v : f.def
        break
    }
  }
  return spec.fix ? spec.fix(out) : out
}

export const partDefaults = (type: PartType) => clampPart(type, {})

/** Parts made of two pieces printed separately (a jar and its lid, a box and its lid). */
export function pieceField(type: PartType): { key: string; second: string } | null {
  if (type === 'jar') return { key: 'piece', second: 'lid' }
  if (type === 'boxLid') return { key: 'piece', second: 'lid' }
  return null
}

const r2 = (x: number) => String(Math.round(x * 100) / 100)

/** A note under a part's fields (message key and its numbers), or null. */
export function partInfo(type: PartType, v: PartValues): { key: string; vars: Record<string, string> } | null {
  const m = typeof v.size === 'string' ? METRIC[v.size] : undefined
  switch (type) {
    case 'bolt':
      return { key: 'part.bolt.info', vars: { p: r2(m!.pitch), s: r2(m!.flats) } }
    case 'nut':
      return { key: 'part.nut.info', vars: { p: r2(m!.pitch), s: r2(m!.flats), h: r2(m!.nut) } }
    case 'jar':
      return { key: 'part.jar.info', vars: { p: r2(jarPitch(n(v, 'diameter'))) } }
    case 'rack':
      return { key: 'part.rack.info', vars: { l: r2(n(v, 'teeth') * Math.PI * n(v, 'module')), m: r2(n(v, 'module')) } }
    case 'wheel':
      return { key: 'part.wheel.info', vars: {} }
    case 'pulley':
      return { key: v.belt === 'v' ? 'part.pulley.infoV' : 'part.pulley.info', vars: { s: r2(n(v, 'beltSize')) } }
    case 'spring':
      return { key: 'part.spring.info', vars: { h: r2(n(v, 'turns') * n(v, 'pitch')) } }
    case 'boxLid':
      return { key: v.style === 'slide' ? 'part.boxLid.infoSlide' : 'part.boxLid.info', vars: {} }
    case 'hinge':
      return { key: 'part.hinge.info', vars: {} }
    case 'knob':
      return { key: 'part.knob.info', vars: { s: v.size as string } }
    case 'tag':
      return { key: 'part.tag.info', vars: {} }
    default:
      return null
  }
}

/**
 * Roughly what a new part covers on the plane around its origin: [minX, maxX, minY, maxY] in mm,
 * including the second piece of a two-piece part (placed to the right of the first).
 */
export function partArea(type: PartType, v: PartValues = partDefaults(type)): [number, number, number, number] {
  const m = typeof v.size === 'string' ? METRIC[v.size] : METRIC.M8
  let hx = 12
  let hy = 12
  switch (type) {
    case 'bolt':
      hx = hy = Math.max(m.flats * 0.6, m.d)
      break
    case 'nut':
      hx = v.style === 'wing' ? m.d * 2.2 : m.flats * 0.6
      hy = v.style === 'wing' ? m.d : m.flats * 0.6
      break
    case 'jar':
      hx = hy = n(v, 'diameter') / 2
      break
    case 'rack':
      hx = (n(v, 'teeth') * Math.PI * n(v, 'module')) / 2
      hy = (n(v, 'base') + 2.25 * n(v, 'module')) / 2
      break
    case 'wheel':
      hx = hy = n(v, 'diameter') / 2
      break
    case 'pulley':
      hx = hy = n(v, 'diameter') / 2 + n(v, 'beltSize')
      break
    case 'washer':
      hx = hy = n(v, 'outer') / 2
      break
    case 'spring':
      hx = hy = n(v, 'diameter') / 2
      break
    case 'boxLid':
      hx = n(v, 'width') / 2
      hy = n(v, 'depth') / 2
      break
    case 'hinge':
      hx = n(v, 'length') / 2
      hy = n(v, 'width') + n(v, 'thickness')
      break
    case 'knob':
      hx = hy = n(v, 'diameter') / 2
      break
    case 'tag':
      hx = (String(v.text).length * n(v, 'letter') * 0.75) / 2 + n(v, 'letter') * 1.5
      hy = n(v, 'letter') * 1.2
      break
  }
  const second = pieceField(type) ? 2 * hx + 10 : 0
  return [-hx, hx + second, -hy, hy]
}
