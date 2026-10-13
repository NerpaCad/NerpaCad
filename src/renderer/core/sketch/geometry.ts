/** Plane geometry helpers for sketches: tessellation, distances, arcs. */
import type { SkArc, SkCurve, SkSpline, Sketch } from './types'
import { AXIS_X, AXIS_Y, ORIGIN, pointPos } from './types'

export type XY = [number, number]

const TAU = Math.PI * 2

export function arcAngles(s: Sketch, a: SkArc): { c: XY; r: number; sa: number; ea: number } | null {
  const c = pointPos(s, a.c)
  const p = pointPos(s, a.start)
  const q = pointPos(s, a.end)
  if (!c || !p || !q) return null
  const sa = Math.atan2(p[1] - c[1], p[0] - c[0])
  let ea = Math.atan2(q[1] - c[1], q[0] - c[0])
  if (ea <= sa + 1e-12) ea += TAU
  return { c, r: Math.hypot(p[0] - c[0], p[1] - c[1]), sa, ea }
}

/** Is angle `t` inside the CCW sweep sa→ea? */
export function inSweep(t: number, sa: number, ea: number): boolean {
  const span = ea - sa
  let d = (t - sa) % TAU
  if (d < 0) d += TAU
  return d <= span + 1e-9
}

/** Polyline approximating a curve (in sketch coordinates). */
export function tessellate(s: Sketch, c: SkCurve, maxSeg = 96): XY[] {
  if (c.kind === 'line') {
    const a = pointPos(s, c.p1)
    const b = pointPos(s, c.p2)
    return a && b ? [a, b] : []
  }
  if (c.kind === 'circle') {
    const ctr = pointPos(s, c.c)
    if (!ctr) return []
    const out: XY[] = []
    for (let i = 0; i <= maxSeg; i++) {
      const t = (i / maxSeg) * TAU
      out.push([ctr[0] + c.r * Math.cos(t), ctr[1] + c.r * Math.sin(t)])
    }
    return out
  }
  if (c.kind === 'spline') return splinePoints(s, c, Math.max(6, Math.round(maxSeg / 6)))
  const g = arcAngles(s, c)
  if (!g) return []
  return arcPoints(g.c, g.r, g.sa, g.ea, maxSeg)
}

/**
 * A spline as a polyline through its points: centripetal Catmull-Rom (no loops or cusps even
 * with uneven spacing). An open spline starts and ends exactly at its end points; a closed one
 * returns to its first point (which is repeated at the end of the list).
 */
export function splinePoints(s: Sketch, c: SkSpline, perSegment = 16): XY[] {
  const P = c.pts.map((id) => pointPos(s, id)).filter(Boolean) as XY[]
  return catmullRom(P, !!c.closed, perSegment)
}

export function catmullRom(P: XY[], closed: boolean, perSegment = 16): XY[] {
  const n = P.length
  if (n < 2) return [...P]
  if (n === 2 && !closed) return [P[0], P[1]]
  const at = (i: number): XY => {
    if (closed) return P[((i % n) + n) % n]
    if (i < 0) return [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]]
    if (i >= n) return [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]]
    return P[i]
  }
  const out: XY[] = [P[0]]
  const segs = closed ? n : n - 1
  const tj = (a: XY, b: XY) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t0 = 0
    const t1 = t0 + tj(p0, p1)
    const t2 = t1 + tj(p1, p2)
    const t3 = t2 + tj(p2, p3)
    for (let k = 1; k <= perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment
      const mix = (a: XY, b: XY, ta: number, tb: number): XY => {
        const u = (tb - t) / (tb - ta)
        const v = (t - ta) / (tb - ta)
        return [u * a[0] + v * b[0], u * a[1] + v * b[1]]
      }
      const a1 = mix(p0, p1, t0, t1)
      const a2 = mix(p1, p2, t1, t2)
      const a3 = mix(p2, p3, t2, t3)
      const b1 = mix(a1, a2, t0, t2)
      const b2 = mix(a2, a3, t1, t3)
      out.push(k === perSegment ? p2 : mix(b1, b2, t1, t2))
    }
  }
  return out
}

export function arcPoints(c: XY, r: number, sa: number, ea: number, maxSeg = 96): XY[] {
  const n = Math.max(2, Math.ceil((maxSeg * (ea - sa)) / TAU))
  const out: XY[] = []
  for (let i = 0; i <= n; i++) {
    const t = sa + ((ea - sa) * i) / n
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
  }
  return out
}

export function segmentProject(p: XY, a: XY, b: XY, infinite = false): { d: number; q: XY } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0
  if (!infinite) t = Math.max(0, Math.min(1, t))
  const q: XY = [a[0] + t * dx, a[1] + t * dy]
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q }
}

/** Distance from `p` to a curve (or an axis) and the nearest point on it. */
export function curveDistance(s: Sketch, id: string, p: XY): { d: number; q: XY } | null {
  if (id === AXIS_X) return { d: Math.abs(p[1]), q: [p[0], 0] }
  if (id === AXIS_Y) return { d: Math.abs(p[0]), q: [0, p[1]] }
  const c = s.curves.find((k) => k.id === id)
  if (!c) return null
  if (c.kind === 'line') {
    const a = pointPos(s, c.p1)
    const b = pointPos(s, c.p2)
    return a && b ? segmentProject(p, a, b) : null
  }
  if (c.kind === 'circle') {
    const ctr = pointPos(s, c.c)
    if (!ctr) return null
    return onCircle(p, ctr, c.r)
  }
  if (c.kind === 'spline') {
    const poly = splinePoints(s, c)
    let best: { d: number; q: XY } | null = null
    for (let i = 0; i + 1 < poly.length; i++) {
      const r = segmentProject(p, poly[i], poly[i + 1])
      if (!best || r.d < best.d) best = r
    }
    return best
  }
  const g = arcAngles(s, c)
  if (!g) return null
  const t = Math.atan2(p[1] - g.c[1], p[0] - g.c[0])
  if (inSweep(t, g.sa, g.ea)) return onCircle(p, g.c, g.r)
  const ends: XY[] = [
    [g.c[0] + g.r * Math.cos(g.sa), g.c[1] + g.r * Math.sin(g.sa)],
    [g.c[0] + g.r * Math.cos(g.ea), g.c[1] + g.r * Math.sin(g.ea)]
  ]
  const d0 = Math.hypot(p[0] - ends[0][0], p[1] - ends[0][1])
  const d1 = Math.hypot(p[0] - ends[1][0], p[1] - ends[1][1])
  return d0 < d1 ? { d: d0, q: ends[0] } : { d: d1, q: ends[1] }
}

function onCircle(p: XY, c: XY, r: number): { d: number; q: XY } {
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  const l = Math.hypot(dx, dy)
  const q: XY = l > 1e-12 ? [c[0] + (dx / l) * r, c[1] + (dy / l) * r] : [c[0] + r, c[1]]
  return { d: Math.abs(l - r), q }
}

/** Center and radius of the circle through three points (null when they are in a line). */
export function circleThrough(a: XY, b: XY, c: XY): { c: XY; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-9) return null
  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  return { c: [x, y], r: Math.hypot(a[0] - x, a[1] - y) }
}

/** All point ids including the origin, with positions. */
export function allPoints(s: Sketch): { id: string; p: XY }[] {
  return [{ id: ORIGIN, p: [0, 0] as XY }, ...s.points.map((q) => ({ id: q.id, p: [q.x, q.y] as XY }))]
}

/** Direction a curve runs in at one of its points (lines: p1 → p2; arcs/circles: counter-clockwise). */
function tangentDir(s: Sketch, id: string, at: XY): XY | null {
  const c = s.curves.find((k) => k.id === id)
  if (!c) return null
  if (c.kind === 'line') {
    const a = pointPos(s, c.p1)
    const b = pointPos(s, c.p2)
    return a && b ? [b[0] - a[0], b[1] - a[1]] : null
  }
  if (c.kind === 'spline') return null
  const ctr = pointPos(s, c.c)
  return ctr ? [-(at[1] - ctr[1]), at[0] - ctr[0]] : null
}

/**
 * When two curves meet at a shared end point, tangency is enforced at that point (a line merely
 * touching the circle would be ill-conditioned there). Returns the point and the angle between
 * the curves' directions to keep: 0 or 180 degrees, whichever is closer now.
 */
export function endpointTangency(s: Sketch, a: string, b: string): { p: string; angle: number } | null {
  const ends = (id: string) => {
    const c = s.curves.find((k) => k.id === id)
    if (!c) return []
    return c.kind === 'line' ? [c.p1, c.p2] : c.kind === 'arc' ? [c.start, c.end] : []
  }
  const eb = ends(b)
  const p = ends(a).find((x) => eb.includes(x))
  if (!p) return null
  const at = pointPos(s, p)!
  const da = tangentDir(s, a, at)
  const db = tangentDir(s, b, at)
  if (!da || !db) return null
  const dot = da[0] * db[0] + da[1] * db[1]
  return { p, angle: dot >= 0 ? 0 : 180 }
}
