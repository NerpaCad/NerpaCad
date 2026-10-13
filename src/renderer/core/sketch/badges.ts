/**
 * How the small constraint badges of a sketch are grouped, so that a busy drawing stays readable:
 *
 * - a regular polygon (its corners on a helper circle, all its sides equal) shows one badge for
 *   all those constraints instead of two per corner;
 * - lines (or circles and arcs) made equal show one "=" each, numbered by group when there are
 *   several groups, instead of a pile of badges on the line they were all made equal to;
 * - a tangent between two curves that meet shows one badge where they meet.
 *
 * Pure functions on the sketch model; the sketch editor turns the result into screen positions.
 */
import { type Sketch, curveEnds } from './types'

export interface PolygonGroup {
  /** the helper circle the corners are on */
  circle: string
  /** every constraint the badge stands for (corners on the circle, sides equal) */
  ids: string[]
}

export interface EqualMember {
  /** the line, circle or arc */
  entity: string
  /** the equal constraint its badge selects */
  constraint: string
  /** group number, from 1 (0 when there is only one group: no number is shown) */
  group: number
}

export interface BadgeGroups {
  polygons: PolygonGroup[]
  equal: EqualMember[]
  /** constraints shown by a group badge, not by badges of their own */
  grouped: Set<string>
  /** tangent constraint → the point where its two curves meet */
  tangentAt: Map<string, string>
}

class Sets {
  private up = new Map<string, string>()
  find(a: string): string {
    let r = a
    while (this.up.has(r) && this.up.get(r) !== r) r = this.up.get(r)!
    this.up.set(a, r)
    return r
  }
  join(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.up.set(ra, rb)
  }
}

export function badgeGroups(s: Sketch): BadgeGroups {
  const grouped = new Set<string>()
  const curve = new Map(s.curves.map((c) => [c.id, c]))

  // ---- regular polygons
  const polygons: PolygonGroup[] = []
  for (const circ of s.curves) {
    if (circ.kind !== 'circle' || !circ.construction) continue
    const on = new Map<string, string>()
    for (const c of s.constraints) if (c.type === 'pointOn' && c.refs[1] === circ.id && !on.has(c.refs[0])) on.set(c.refs[0], c.id)
    if (on.size < 3) continue
    const sides = s.curves.filter((c) => c.kind === 'line' && on.has(c.p1) && on.has(c.p2))
    if (sides.length !== on.size) continue
    // a single closed loop through all the corners
    const degree = new Map<string, number>()
    for (const l of sides) if (l.kind === 'line') for (const p of [l.p1, l.p2]) degree.set(p, (degree.get(p) ?? 0) + 1)
    if ([...on.keys()].some((p) => degree.get(p) !== 2)) continue
    const loop = new Sets()
    for (const l of sides) if (l.kind === 'line') loop.join(l.p1, l.p2)
    const corners = [...on.keys()]
    if (corners.some((p) => loop.find(p) !== loop.find(corners[0]))) continue
    // all sides equal to each other
    const ids = new Set(sides.map((l) => l.id))
    const eq = s.constraints.filter((c) => c.type === 'equal' && ids.has(c.refs[0]) && ids.has(c.refs[1]))
    const same = new Sets()
    for (const c of eq) same.join(c.refs[0], c.refs[1])
    const first = sides[0].id
    if (sides.some((l) => same.find(l.id) !== same.find(first))) continue
    const all = [...on.values(), ...eq.map((c) => c.id)]
    all.forEach((id) => grouped.add(id))
    polygons.push({ circle: circ.id, ids: all })
  }

  // ---- equal groups (what is left after the polygons)
  const sets = new Sets()
  const firstOf = new Map<string, string>()
  for (const c of s.constraints) {
    if (c.type !== 'equal' || grouped.has(c.id)) continue
    sets.join(c.refs[0], c.refs[1])
    for (const e of c.refs) if (!firstOf.has(e)) firstOf.set(e, c.id)
  }
  const roots = [...new Set([...firstOf.keys()].map((e) => sets.find(e)))]
  const number = new Map(roots.map((r, i) => [r, roots.length > 1 ? i + 1 : 0]))
  const equal: EqualMember[] = [...firstOf].map(([entity, constraint]) => ({ entity, constraint, group: number.get(sets.find(entity))! }))
  for (const c of s.constraints) if (c.type === 'equal' && !grouped.has(c.id)) grouped.add(c.id)

  // ---- tangents between curves that meet
  const tangentAt = new Map<string, string>()
  for (const c of s.constraints) {
    if (c.type !== 'tangent') continue
    const a = curve.get(c.refs[0])
    const b = curve.get(c.refs[1])
    const ea = a && curveEnds(a)
    const eb = b && curveEnds(b)
    const at = ea && eb ? ea.find((p) => eb.includes(p)) : undefined
    if (at) tangentAt.set(c.id, at)
  }

  return { polygons, equal, grouped, tangentAt }
}

// ---------------------------------------------------------------- placing badges on screen

export interface BadgeRequest {
  /** where the badge would like to be (screen px, its centre) */
  x: number
  y: number
  /** a direction to slide along first when that spot is taken (e.g. along its line) */
  dx?: number
  dy?: number
}

export interface Box {
  x: number
  y: number
  /** half width and half height */
  hw: number
  hh: number
}

export const BADGE = 19
const GAP = 2

const hit = (a: Box, b: Box) => Math.abs(a.x - b.x) < a.hw + b.hw + GAP && Math.abs(a.y - b.y) < a.hh + b.hh + GAP

/**
 * Put badges where they want to be, or as near as possible without covering each other or the
 * `taken` boxes (dimension numbers, points). Returns the centre of each badge, in request order.
 */
export function placeBadges(requests: BadgeRequest[], taken: Box[]): { x: number; y: number }[] {
  const placed: Box[] = [...taken]
  const step = BADGE + GAP
  const half = BADGE / 2
  return requests.map((r) => {
    const cands: [number, number][] = [[r.x, r.y]]
    const dl = Math.hypot(r.dx ?? 0, r.dy ?? 0)
    if (dl > 1e-9) {
      const ux = (r.dx ?? 0) / dl
      const uy = (r.dy ?? 0) / dl
      for (let k = 1; k <= 4; k++) for (const sg of [1, -1]) cands.push([r.x + ux * step * k * sg, r.y + uy * step * k * sg])
    }
    for (let ring = 1; ring <= 5; ring++) {
      const n = 8 * ring
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        cands.push([r.x + Math.cos(a) * step * ring, r.y + Math.sin(a) * step * ring])
      }
    }
    const free = cands.find(([x, y]) => !placed.some((b) => hit(b, { x, y, hw: half, hh: half }))) ?? cands[0]
    placed.push({ x: free[0], y: free[1], hw: half, hh: half })
    return { x: free[0], y: free[1] }
  })
}
