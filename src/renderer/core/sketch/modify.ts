/**
 * Trim and fillet: the two sketch edits that change existing curves.
 * Pure functions; the caller solves afterwards.
 */
import { arcAngles, endpointTangency, inSweep, type XY } from './geometry'
import { addConstraint, addPoint, deleteEntities } from './ops'
import type { SkArc, SkConstraint, SkCurve, SkLine, Sketch } from './types'
import { curvePoints, pointPos } from './types'

const TAU = Math.PI * 2
const EPS = 1e-6

// ---------------------------------------------------------------- intersections

/** Geometry of a curve for intersection tests: a segment or a circle (with the arc's sweep). */
type Shape =
  | { kind: 'seg'; a: XY; b: XY }
  | { kind: 'circ'; c: XY; r: number; sweep: [number, number] | null }

function shapeOf(s: Sketch, c: SkCurve): Shape | null {
  if (c.kind === 'line') {
    const a = pointPos(s, c.p1)
    const b = pointPos(s, c.p2)
    return a && b ? { kind: 'seg', a, b } : null
  }
  if (c.kind === 'circle') {
    const ctr = pointPos(s, c.c)
    return ctr ? { kind: 'circ', c: ctr, r: c.r, sweep: null } : null
  }
  // splines are not cut by trimming, and do not cut other curves
  if (c.kind === 'spline') return null
  const g = arcAngles(s, c)
  return g ? { kind: 'circ', c: g.c, r: g.r, sweep: [g.sa, g.ea] } : null
}

function onShape(sh: Shape, p: XY): boolean {
  if (sh.kind === 'seg') {
    const dx = sh.b[0] - sh.a[0]
    const dy = sh.b[1] - sh.a[1]
    const l2 = dx * dx + dy * dy
    const t = ((p[0] - sh.a[0]) * dx + (p[1] - sh.a[1]) * dy) / (l2 || 1)
    return t >= -EPS && t <= 1 + EPS
  }
  if (!sh.sweep) return true
  return inSweep(Math.atan2(p[1] - sh.c[1], p[0] - sh.c[0]), sh.sweep[0], sh.sweep[1])
}

/** Intersection points of two shapes (lines treated as infinite, then filtered to both shapes). */
export function intersect(a: Shape, b: Shape): XY[] {
  let pts: XY[] = []
  if (a.kind === 'seg' && b.kind === 'seg') {
    const r: XY = [a.b[0] - a.a[0], a.b[1] - a.a[1]]
    const q: XY = [b.b[0] - b.a[0], b.b[1] - b.a[1]]
    const den = r[0] * q[1] - r[1] * q[0]
    if (Math.abs(den) > 1e-12) {
      const t = ((b.a[0] - a.a[0]) * q[1] - (b.a[1] - a.a[1]) * q[0]) / den
      pts = [[a.a[0] + t * r[0], a.a[1] + t * r[1]]]
    }
  } else if (a.kind === 'circ' && b.kind === 'circ') {
    const dx = b.c[0] - a.c[0]
    const dy = b.c[1] - a.c[1]
    const d = Math.hypot(dx, dy)
    if (d > EPS && d <= a.r + b.r + EPS && d >= Math.abs(a.r - b.r) - EPS) {
      const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d)
      const h = Math.sqrt(Math.max(0, a.r * a.r - x * x))
      const mx = a.c[0] + (dx * x) / d
      const my = a.c[1] + (dy * x) / d
      pts = [
        [mx - (dy * h) / d, my + (dx * h) / d],
        [mx + (dy * h) / d, my - (dx * h) / d]
      ]
    }
  } else {
    const seg = (a.kind === 'seg' ? a : b) as Extract<Shape, { kind: 'seg' }>
    const circ = (a.kind === 'circ' ? a : b) as Extract<Shape, { kind: 'circ' }>
    const d: XY = [seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]]
    const f: XY = [seg.a[0] - circ.c[0], seg.a[1] - circ.c[1]]
    const A = d[0] * d[0] + d[1] * d[1]
    const B = 2 * (f[0] * d[0] + f[1] * d[1])
    const C = f[0] * f[0] + f[1] * f[1] - circ.r * circ.r
    const disc = B * B - 4 * A * C
    if (A > 1e-12 && disc >= -1e-9) {
      const sq = Math.sqrt(Math.max(0, disc))
      for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) pts.push([seg.a[0] + t * d[0], seg.a[1] + t * d[1]])
    }
  }
  return pts.filter((p) => onShape(a, p) && onShape(b, p))
}

// ---------------------------------------------------------------- trim

/** Position of a point along a curve: 0..1 on a line, radians from the start on an arc/circle. */
function param(s: Sketch, c: SkCurve, p: XY): number {
  if (c.kind === 'line') {
    const a = pointPos(s, c.p1)!
    const b = pointPos(s, c.p2)!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)
  }
  if (c.kind === 'spline') return 0
  const ctr = pointPos(s, c.c)!
  const ang = Math.atan2(p[1] - ctr[1], p[0] - ctr[0])
  const start = c.kind === 'arc' ? arcAngles(s, c)!.sa : 0
  let u = (ang - start) % TAU
  if (u < 0) u += TAU
  return u
}

/** Constraints that stop making sense for a shortened curve (they would pull it back). */
const LENGTH_BOUND = new Set(['distance', 'distanceX', 'distanceY', 'equal', 'midpoint'])

/**
 * Remove the piece of `curveId` around `at` that lies between its nearest intersections with
 * other curves (or up to its ends). A curve that crosses nothing is deleted. New end points get
 * a point-on constraint to the curve that cut them. Returns null when nothing changes.
 */
export function trimAt(s: Sketch, curveId: string, at: XY): Sketch | null {
  const c = s.curves.find((k) => k.id === curveId)
  if (!c) return null
  // a spline is removed as a whole
  if (c.kind === 'spline') return deleteEntities(s, [c.id])
  const me = shapeOf(s, c)
  if (!me) return null
  const cuts: { u: number; p: XY; by: string }[] = []
  for (const o of s.curves) {
    if (o.id === c.id) continue
    const sh = shapeOf(s, o)
    if (!sh) continue
    for (const p of intersect(me, sh)) cuts.push({ u: param(s, c, p), p, by: o.id })
  }
  const span = c.kind === 'line' ? 1 : c.kind === 'circle' ? TAU : (() => {
    const g = arcAngles(s, c)!
    return g.ea - g.sa
  })()
  const inner = cuts
    .filter((x) => (c.kind === 'circle' ? true : x.u > EPS && x.u < span - EPS))
    .sort((a, b) => a.u - b.u)
  // merge cuts at the same place
  const uniq: typeof inner = []
  for (const x of inner) if (!uniq.length || x.u - uniq[uniq.length - 1].u > 1e-7) uniq.push(x)
  const uAt = param(s, c, at)

  if (c.kind === 'circle') {
    if (uniq.length < 2) return deleteEntities(s, [c.id])
    // the removed piece runs between the cuts around the click; keep the rest as an arc
    let hi = uniq.findIndex((x) => x.u > uAt)
    if (hi < 0) hi = 0
    const lo = (hi - 1 + uniq.length) % uniq.length
    let sk = s
    const a = addPoint(sk, uniq[hi].p)
    const b = addPoint(a.sketch, uniq[lo].p)
    sk = b.sketch
    const arc: SkArc = { id: c.id, kind: 'arc', c: c.c, start: a.id, end: b.id, r: c.r, ...(c.construction ? { construction: true } : {}) }
    sk = { ...sk, curves: sk.curves.map((k) => (k.id === c.id ? arc : k)) }
    sk = addConstraint(sk, 'pointOn', [a.id, uniq[hi].by]).sketch
    sk = addConstraint(sk, 'pointOn', [b.id, uniq[lo].by]).sketch
    return sk
  }

  const lo = [...uniq].reverse().find((x) => x.u < uAt) ?? null
  const hi = uniq.find((x) => x.u > uAt) ?? null
  if (!lo && !hi) return deleteEntities(s, [c.id])
  const endId = c.kind === 'line' ? c.p2 : c.end
  let sk = dropLengthBound(s, c.id)

  const replaceEnd = (curve: SkCurve, which: 'start' | 'end', pid: string): SkCurve => {
    if (curve.kind === 'line') return which === 'start' ? { ...curve, p1: pid } : { ...curve, p2: pid }
    if (curve.kind === 'arc') return which === 'start' ? { ...curve, start: pid } : { ...curve, end: pid }
    return curve
  }
  const setCurve = (sk2: Sketch, next: SkCurve) => ({ ...sk2, curves: sk2.curves.map((k) => (k.id === next.id ? next : k)) })

  if (!lo && hi) {
    // remove from the start to the first cut
    const p = addPoint(sk, hi.p)
    sk = setCurve(p.sketch, replaceEnd(sk.curves.find((k) => k.id === c.id)!, 'start', p.id))
    sk = addConstraint(sk, 'pointOn', [p.id, hi.by]).sketch
  } else if (lo && !hi) {
    const p = addPoint(sk, lo.p)
    sk = setCurve(p.sketch, replaceEnd(sk.curves.find((k) => k.id === c.id)!, 'end', p.id))
    sk = addConstraint(sk, 'pointOn', [p.id, lo.by]).sketch
  } else if (lo && hi) {
    // cut out the middle: the curve keeps its first part, a new curve takes the last part
    const p1 = addPoint(sk, lo.p)
    const p2 = addPoint(p1.sketch, hi.p)
    sk = p2.sketch
    const cur = sk.curves.find((k) => k.id === c.id)!
    sk = setCurve(sk, replaceEnd(cur, 'end', p1.id))
    const id = `${c.kind === 'line' ? 'l' : 'a'}${sk.next}`
    sk = { ...sk, next: sk.next + 1 }
    const piece: SkCurve =
      c.kind === 'line'
        ? ({ id, kind: 'line', p1: p2.id, p2: endId, ...(c.construction ? { construction: true } : {}) } as SkLine)
        : ({ id, kind: 'arc', c: c.c, start: p2.id, end: endId, r: c.r, ...(c.construction ? { construction: true } : {}) } as SkArc)
    sk = { ...sk, curves: [...sk.curves, piece] }
    sk = addConstraint(sk, 'pointOn', [p1.id, lo.by]).sketch
    sk = addConstraint(sk, 'pointOn', [p2.id, hi.by]).sketch
    // the two pieces stay on one line / one circle
    if (c.kind === 'line') {
      sk = addConstraint(sk, 'pointOn', [p2.id, c.id]).sketch
      const hv = s.constraints.find((k) => k.refs.length === 1 && k.refs[0] === c.id && (k.type === 'horizontal' || k.type === 'vertical'))
      sk = hv ? addConstraint(sk, hv.type, [id]).sketch : addConstraint(sk, 'parallel', [c.id, id]).sketch
    } else sk = addConstraint(sk, 'equal', [c.id, id]).sketch
  }
  return cleanupPoints(sk)
}

function dropLengthBound(s: Sketch, curveId: string): Sketch {
  return { ...s, constraints: s.constraints.filter((k) => !(k.refs.includes(curveId) && LENGTH_BOUND.has(k.type))) }
}

/** Remove points no curve uses and no constraint needs (left over after trimming). */
function cleanupPoints(s: Sketch): Sketch {
  const used = new Set(s.curves.flatMap(curvePoints))
  const orphan = s.points.filter((p) => !used.has(p.id) && !s.constraints.some((k) => k.refs.includes(p.id)))
  return orphan.length ? deleteEntities(s, orphan.map((p) => p.id)) : s
}

// ---------------------------------------------------------------- fillet

/**
 * Round the corner where exactly two lines meet at `pointId` with an arc of radius `r`.
 * The corner point stays as a helper point on both lines, so dimensions measured to the corner
 * keep working; line lengths measured before become distances from that corner.
 */
export function filletCorner(s: Sketch, pointId: string, r: number): { sketch: Sketch; arc: string } | null {
  if (!(r > 0)) return null
  const lines = s.curves.filter((c): c is SkLine => c.kind === 'line' && (c.p1 === pointId || c.p2 === pointId))
  const all = s.curves.filter((c) => curvePoints(c).includes(pointId))
  if (lines.length !== 2 || all.length !== 2) return null
  const P = pointPos(s, pointId)
  if (!P) return null
  const far = (l: SkLine) => (l.p1 === pointId ? l.p2 : l.p1)
  const A = pointPos(s, far(lines[0]))!
  const B = pointPos(s, far(lines[1]))!
  const la = Math.hypot(A[0] - P[0], A[1] - P[1])
  const lb = Math.hypot(B[0] - P[0], B[1] - P[1])
  if (la < EPS || lb < EPS) return null
  const u: XY = [(A[0] - P[0]) / la, (A[1] - P[1]) / la]
  const v: XY = [(B[0] - P[0]) / lb, (B[1] - P[1]) / lb]
  const cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))
  const theta = Math.acos(cos)
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null // straight or folded back
  const d = r / Math.tan(theta / 2)
  if (d >= la - EPS || d >= lb - EPS) return null // does not fit
  const T1: XY = [P[0] + u[0] * d, P[1] + u[1] * d]
  const T2: XY = [P[0] + v[0] * d, P[1] + v[1] * d]
  const bis: XY = [u[0] + v[0], u[1] + v[1]]
  const bl = Math.hypot(bis[0], bis[1])
  const h = r / Math.sin(theta / 2)
  const C: XY = [P[0] + (bis[0] / bl) * h, P[1] + (bis[1] / bl) * h]

  let sk = s
  const t1 = addPoint(sk, T1)
  const t2 = addPoint(t1.sketch, T2)
  const cp = addPoint(t2.sketch, C)
  sk = cp.sketch
  // the arc runs counter-clockwise the short way between the tangent points
  const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0])
  let a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0])
  if (a2 <= a1) a2 += TAU
  const [st, en] = a2 - a1 <= Math.PI ? [t1.id, t2.id] : [t2.id, t1.id]
  const arcId = `a${sk.next}`
  sk = { ...sk, next: sk.next + 1 }
  const construction = lines[0].construction && lines[1].construction ? { construction: true } : {}
  const arc: SkArc = { id: arcId, kind: 'arc', c: cp.id, start: st, end: en, r, ...construction }
  // lines now end at the tangent points
  const moved = (l: SkLine, tp: string): SkLine => (l.p1 === pointId ? { ...l, p1: tp } : { ...l, p2: tp })
  sk = {
    ...sk,
    curves: [...sk.curves.map((c) => (c.id === lines[0].id ? moved(lines[0], t1.id) : c.id === lines[1].id ? moved(lines[1], t2.id) : c)), arc]
  }
  // line lengths become corner-to-end distances; other length ties no longer apply
  sk = {
    ...sk,
    constraints: sk.constraints
      .map((k): SkConstraint | null => {
        const li = lines.findIndex((l) => k.refs.length === 1 && k.refs[0] === l.id)
        if (li >= 0 && (k.type === 'distance' || k.type === 'distanceX' || k.type === 'distanceY')) {
          const l = lines[li]
          return { ...k, refs: [l.p1, l.p2] }
        }
        if (lines.some((l) => k.refs.includes(l.id)) && (k.type === 'equal' || k.type === 'midpoint')) return null
        return k
      })
      .filter((k): k is SkConstraint => k !== null)
  }
  sk = addConstraint(sk, 'pointOn', [pointId, lines[0].id]).sketch
  sk = addConstraint(sk, 'pointOn', [pointId, lines[1].id]).sketch
  for (const l of lines) {
    const at = endpointTangency(sk, l.id, arcId)
    sk = addConstraint(sk, 'tangent', [l.id, arcId], undefined, at?.angle).sketch
  }
  sk = addConstraint(sk, 'radius', [arcId], r).sketch
  return { sketch: sk, arc: arcId }
}
