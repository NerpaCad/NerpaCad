/**
 * Which pins are electrically the same point ("nets"): wires, the strips inside a breadboard and
 * a board's joined pins, and the legs of parts pushed into breadboard holes.
 */
import type { Circuit, Part } from './model'
import { SPECS, hasLegs, pinPos } from './parts'

export const pinKey = (part: string, pin: string) => `${part}:${pin}`

/** Union–find over pin keys. */
export class Nets {
  private parent = new Map<string, string>()
  find(k: string): string {
    let p = this.parent.get(k) ?? k
    if (p !== k) {
      p = this.find(p)
      this.parent.set(k, p)
    }
    return p
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  same(a: string, b: string): boolean {
    return this.find(a) === this.find(b)
  }
}

/** a leg counts as in a hole this close to its centre, mm (everything sits on a 1.27 mm grid) */
const IN_HOLE = 0.35
/** while dragging, a leg this close to a hole is pulled into it, mm */
export const HOLE_PULL = 2

const cell = (x: number, y: number) => `${Math.round(x / 1.27)},${Math.round(y / 1.27)}`

/** Every breadboard hole by grid cell: [board id, pin id, x, y]. */
function holeIndex(parts: Part[], skip?: Set<string>): Map<string, [string, string, number, number]> {
  const out = new Map<string, [string, string, number, number]>()
  for (const b of parts) {
    if (b.kind !== 'breadboard' || skip?.has(b.id)) continue
    for (const pin of SPECS.breadboard.pins) {
      const p = pinPos(b, pin.id)!
      const k = cell(p[0], p[1])
      if (!out.has(k)) out.set(k, [b.id, pin.id, p[0], p[1]])
    }
  }
  return out
}

const contactCache = new WeakMap<Circuit, [string, string][]>()

/** Legs pushed into breadboard holes: [leg key, hole key]. (Circuits are immutable: cached per object.) */
export function contacts(c: Circuit): [string, string][] {
  let r = contactCache.get(c)
  if (!r) {
    r = findContacts(c)
    contactCache.set(c, r)
  }
  return r
}

function findContacts(c: Circuit): [string, string][] {
  const holes = holeIndex(c.parts)
  if (!holes.size) return []
  const out: [string, string][] = []
  for (const part of c.parts) {
    if (!hasLegs(part.kind)) continue
    for (const pin of SPECS[part.kind].pins) {
      const p = pinPos(part, pin.id)!
      const h = holes.get(cell(p[0], p[1]))
      if (h && Math.hypot(h[2] - p[0], h[3] - p[1]) < IN_HOLE) out.push([pinKey(part.id, pin.id), pinKey(h[0], h[1])])
    }
  }
  return out
}

/** The nets of a circuit. */
export function circuitNets(c: Circuit): Nets {
  const nets = new Nets()
  for (const p of c.parts) {
    for (const group of SPECS[p.kind].bus ?? []) for (let i = 1; i < group.length; i++) nets.union(pinKey(p.id, group[0]), pinKey(p.id, group[i]))
  }
  for (const w of c.wires) nets.union(pinKey(w.a.part, w.a.pin), pinKey(w.b.part, w.b.pin))
  for (const [leg, hole] of contacts(c)) nets.union(leg, hole)
  return nets
}

/**
 * While parts are dragged: how far to shift them so that the legs nearest to a hole of another
 * breadboard drop right into it (like a magnet). Null when no leg is near a hole.
 */
export function holeSnap(parts: Part[], moving: Set<string>): [number, number] | null {
  const holes = holeIndex(parts, moving)
  if (!holes.size) return null
  let best: { d: number; dx: number; dy: number } | null = null
  for (const part of parts) {
    if (!moving.has(part.id) || !hasLegs(part.kind)) continue
    for (const pin of SPECS[part.kind].pins) {
      const p = pinPos(part, pin.id)!
      const i = Math.round(p[0] / 1.27)
      const j = Math.round(p[1] / 1.27)
      // the hole may be up to one grid step off in any direction
      for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          const h = holes.get(`${i + di},${j + dj}`)
          if (!h) continue
          const d = Math.hypot(h[2] - p[0], h[3] - p[1])
          if (d <= HOLE_PULL && (!best || d < best.d)) best = { d, dx: h[2] - p[0], dy: h[3] - p[1] }
        }
      }
    }
  }
  return best && best.d > 1e-6 ? [best.dx, best.dy] : best ? [0, 0] : null
}

/** Ids of the parts whose legs are in the holes of the given breadboards (they move with them). */
export function partsOnBoards(c: Circuit, boards: Set<string>): Set<string> {
  const out = new Set<string>()
  for (const [leg, hole] of contacts(c)) if (boards.has(hole.split(':')[0])) out.add(leg.split(':')[0])
  return out
}
