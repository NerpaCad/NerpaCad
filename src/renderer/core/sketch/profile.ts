/**
 * From a sketch to the outline that gets extruded: closed regions bounded by the sketch's
 * (non-construction) lines, arcs and circles.
 *
 * Curves meet at shared points, so the drawing is a planar graph. Loose ends are pruned, then
 * every bounded face of the graph is traced (keeping the face on the left, so faces come out
 * counter-clockwise). The faces are filled with the even-odd rule: a region inside another
 * becomes a hole, neighbouring regions just add up.
 */
import { arcAngles, arcPoints, splinePoints, tessellate, type XY } from './geometry'
import type { Sketch } from './types'
import { curveEnds, pointPos } from './types'

export interface Profile {
  /** closed outlines (counter-clockwise), for an even-odd fill */
  loops: XY[][]
  /** curves with a loose end (not part of any closed outline) */
  open: string[]
  /** curves that cross another curve without a shared point */
  crossing: string[]
}

interface Edge {
  id: string
  a: string
  b: string
  pts: XY[]
}

interface Half {
  edge: Edge
  from: string
  to: string
  pts: XY[]
  angle: number
  twin?: Half
  seen?: boolean
}

export function signedArea(poly: XY[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export function buildProfile(s: Sketch, segments = 64): Profile {
  const loops: XY[][] = []
  const edges: Edge[] = []
  for (const c of s.curves) {
    if (c.construction) continue
    if (c.kind === 'circle') {
      const pts = tessellate(s, c, segments)
      if (pts.length > 3 && c.r > 1e-9) loops.push(pts.slice(0, -1))
      continue
    }
    if (c.kind === 'line') {
      const a = pointPos(s, c.p1)
      const b = pointPos(s, c.p2)
      if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) continue
      edges.push({ id: c.id, a: c.p1, b: c.p2, pts: [a, b] })
      continue
    }
    if (c.kind === 'spline') {
      const pts = splinePoints(s, c, Math.max(8, Math.round(segments / 4)))
      if (c.closed) {
        const ring = pts.slice(0, -1)
        if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-9) loops.push(signedArea(ring) > 0 ? ring : ring.reverse())
      } else if (pts.length >= 2) edges.push({ id: c.id, a: c.pts[0], b: c.pts[c.pts.length - 1], pts })
      continue
    }
    const g = arcAngles(s, c)
    if (!g || g.r < 1e-9) continue
    edges.push({ id: c.id, a: c.start, b: c.end, pts: arcPoints(g.c, g.r, g.sa, g.ea, segments) })
  }

  // prune loose ends: an edge with an endpoint no other edge touches can't bound a region
  const open: string[] = []
  let live = edges
  for (;;) {
    const deg = new Map<string, number>()
    for (const e of live) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1)
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1)
    }
    const dead = live.filter((e) => deg.get(e.a) === 1 || deg.get(e.b) === 1)
    if (!dead.length) break
    open.push(...dead.map((e) => e.id))
    live = live.filter((e) => !dead.includes(e))
  }

  // half-edges, sorted counter-clockwise around each point
  const out = new Map<string, Half[]>()
  const halves: Half[] = []
  const dirAngle = (pts: XY[]) => Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])
  for (const e of live) {
    const fwd: Half = { edge: e, from: e.a, to: e.b, pts: e.pts, angle: dirAngle(e.pts) }
    const rev = [...e.pts].reverse()
    const back: Half = { edge: e, from: e.b, to: e.a, pts: rev, angle: dirAngle(rev) }
    fwd.twin = back
    back.twin = fwd
    halves.push(fwd, back)
    for (const h of [fwd, back]) {
      const list = out.get(h.from) ?? []
      list.push(h)
      out.set(h.from, list)
    }
  }
  for (const list of out.values()) list.sort((p, q) => p.angle - q.angle)

  // trace faces: after arriving at a point, leave by the edge just clockwise of the way back
  for (const start of halves) {
    if (start.seen) continue
    const poly: XY[] = []
    let h: Half | undefined = start
    let guard = 0
    while (h && !h.seen && guard++ < 100000) {
      h.seen = true
      poly.push(...h.pts.slice(0, -1))
      const list: Half[] = out.get(h.to)!
      const i: number = list.indexOf(h.twin!)
      h = list[(i - 1 + list.length) % list.length]
    }
    if (poly.length >= 3 && signedArea(poly) > 1e-9) loops.push(poly)
  }

  return { loops, open: [...new Set(open)], crossing: crossings(s, segments) }
}

/** Curves that intersect another curve somewhere other than at a shared point. */
function crossings(s: Sketch, segments: number): string[] {
  const curves = s.curves.filter((c) => !c.construction)
  const polys = curves.map((c) => tessellate(s, c, Math.max(24, segments / 2)))
  const pts = (i: number): string[] => curveEnds(curves[i]) ?? []
  const hits = new Set<string>()
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const common = pts(i).filter((p) => pts(j).includes(p))
      const commonPos = common.map((p) => pointPos(s, p)!).filter(Boolean)
      if (polyCross(polys[i], polys[j], commonPos)) {
        hits.add(curves[i].id)
        hits.add(curves[j].id)
      }
    }
  }
  return [...hits]
}

function polyCross(a: XY[], b: XY[], ignore: XY[]): boolean {
  const near = (p: XY) => ignore.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4)
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const x = segIntersect(a[i], a[i + 1], b[j], b[j + 1])
      if (x && !near(x)) return true
    }
  }
  return false
}

function segIntersect(p: XY, p2: XY, q: XY, q2: XY): XY | null {
  const r: XY = [p2[0] - p[0], p2[1] - p[1]]
  const s: XY = [q2[0] - q[0], q2[1] - q[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-12) return null
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
  const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den
  const e = 1e-9
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null
  return [p[0] + t * r[0], p[1] + t * r[1]]
}
