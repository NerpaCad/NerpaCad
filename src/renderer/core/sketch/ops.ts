/**
 * Pure edits of a sketch. None of these run the solver; callers solve afterwards when
 * constraints may be violated.
 */
import {
  type ConstraintType,
  DIMENSIONS,
  RESERVED,
  type SkArc,
  type SkConstraint,
  type SkCurve,
  type SkLine,
  type SkPoint,
  type SkSpline,
  type Sketch,
  curvePoints
} from './types'

export type XY = [number, number]
/** Either an existing point id or a new position. */
export type PointRef = string | XY

function fresh(s: Sketch, prefix: string): [Sketch, string] {
  return [{ ...s, next: s.next + 1 }, `${prefix}${s.next}`]
}

export function addPoint(s: Sketch, at: XY): { sketch: Sketch; id: string } {
  const [s1, id] = fresh(s, 'p')
  const p: SkPoint = { id, x: at[0], y: at[1] }
  return { sketch: { ...s1, points: [...s1.points, p] }, id }
}

function usePoint(s: Sketch, ref: PointRef): { sketch: Sketch; id: string } {
  return typeof ref === 'string' ? { sketch: s, id: ref } : addPoint(s, ref)
}

function addCurve(s: Sketch, c: SkCurve): Sketch {
  return { ...s, curves: [...s.curves, c] }
}

export function addLine(s: Sketch, a: PointRef, b: PointRef, construction = false): { sketch: Sketch; id: string; p1: string; p2: string } {
  let r = usePoint(s, a)
  const p1 = r.id
  r = usePoint(r.sketch, b)
  const p2 = r.id
  const [s1, id] = fresh(r.sketch, 'l')
  const line: SkLine = { id, kind: 'line', p1, p2, ...(construction ? { construction } : {}) }
  return { sketch: addCurve(s1, line), id, p1, p2 }
}

/**
 * A smooth curve through the given points (existing ids or new positions). Returns null when
 * it would use a point twice or has too few points.
 */
export function addSpline(
  s: Sketch,
  refs: PointRef[],
  closed: boolean,
  construction = false
): { sketch: Sketch; id: string; pts: string[] } | null {
  let sk = s
  const pts: string[] = []
  for (const ref of refs) {
    const r = usePoint(sk, ref)
    sk = r.sketch
    pts.push(r.id)
  }
  if (new Set(pts).size !== pts.length || pts.length < (closed ? 3 : 2)) return null
  const [s1, id] = fresh(sk, 's')
  const c: SkSpline = { id, kind: 'spline', pts, ...(closed ? { closed: true } : {}), ...(construction ? { construction } : {}) }
  return { sketch: addCurve(s1, c), id, pts }
}

export function addCircle(s: Sketch, center: PointRef, r: number, construction = false): { sketch: Sketch; id: string; c: string } {
  const pr = usePoint(s, center)
  const [s1, id] = fresh(pr.sketch, 'c')
  return { sketch: addCurve(s1, { id, kind: 'circle', c: pr.id, r, ...(construction ? { construction } : {}) }), id, c: pr.id }
}

/**
 * Counter-clockwise arc around `center` from `start`; the end point is projected onto the
 * circle through `start`.
 */
export function addArc(
  s: Sketch,
  center: PointRef,
  start: PointRef,
  end: PointRef,
  construction = false
): { sketch: Sketch; id: string; c: string; start: string; end: string } {
  let r = usePoint(s, center)
  const c = r.id
  r = usePoint(r.sketch, start)
  const st = r.id
  const cp = pos(r.sketch, c)
  const sp = pos(r.sketch, st)
  const rad = Math.hypot(sp[0] - cp[0], sp[1] - cp[1])
  let endRef = end
  if (typeof end !== 'string') {
    const ang = Math.atan2(end[1] - cp[1], end[0] - cp[0])
    endRef = [cp[0] + rad * Math.cos(ang), cp[1] + rad * Math.sin(ang)]
  }
  r = usePoint(r.sketch, endRef)
  const en = r.id
  const [s1, id] = fresh(r.sketch, 'a')
  const arc: SkArc = { id, kind: 'arc', c, start: st, end: en, r: rad, ...(construction ? { construction } : {}) }
  return { sketch: addCurve(s1, arc), id, c, start: st, end: en }
}

export function addConstraint(
  s: Sketch,
  type: ConstraintType,
  refs: string[],
  value?: number,
  value2?: number
): { sketch: Sketch; id: string } {
  const [s1, id] = fresh(s, 'k')
  const c: SkConstraint = { id, type, refs }
  if (value !== undefined) c.value = value
  if (value2 !== undefined) c.value2 = value2
  return { sketch: { ...s1, constraints: [...s1.constraints, c] }, id }
}

/** Closed polyline through the given points (existing ids or positions); returns line ids in order. */
export function addPolyline(
  s: Sketch,
  pts: PointRef[],
  closed: boolean,
  construction = false
): { sketch: Sketch; lines: string[]; points: string[] } {
  let sk = s
  const ids: string[] = []
  for (const p of pts) {
    const r = usePoint(sk, p)
    sk = r.sketch
    ids.push(r.id)
  }
  const lines: string[] = []
  const n = closed ? ids.length : ids.length - 1
  for (let i = 0; i < n; i++) {
    const r = addLine(sk, ids[i], ids[(i + 1) % ids.length], construction)
    sk = r.sketch
    lines.push(r.id)
  }
  return { sketch: sk, lines, points: ids }
}

/**
 * Axis-aligned rectangle from two opposite corners (or, with `fromCenter`, from the center and
 * a corner). Adds horizontal/vertical constraints; a centered rectangle also gets a construction
 * diagonal whose midpoint is the center.
 */
export function addRect(
  s: Sketch,
  a: XY,
  b: XY,
  fromCenter = false,
  construction = false
): { sketch: Sketch; lines: string[]; points: string[]; center?: string } {
  let x0 = Math.min(a[0], b[0])
  let x1 = Math.max(a[0], b[0])
  let y0 = Math.min(a[1], b[1])
  let y1 = Math.max(a[1], b[1])
  if (fromCenter) {
    const dx = Math.abs(b[0] - a[0])
    const dy = Math.abs(b[1] - a[1])
    ;[x0, x1, y0, y1] = [a[0] - dx, a[0] + dx, a[1] - dy, a[1] + dy]
  }
  const poly = addPolyline(s, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true, construction)
  let sk = poly.sketch
  const [bottom, right, top, left] = poly.lines
  sk = addConstraint(sk, 'horizontal', [bottom]).sketch
  sk = addConstraint(sk, 'horizontal', [top]).sketch
  sk = addConstraint(sk, 'vertical', [left]).sketch
  sk = addConstraint(sk, 'vertical', [right]).sketch
  let center: string | undefined
  if (fromCenter) {
    const c = addPoint(sk, a)
    center = c.id
    const diag = addLine(c.sketch, poly.points[0], poly.points[2], true)
    sk = addConstraint(diag.sketch, 'midpoint', [center, diag.id]).sketch
  }
  return { sketch: sk, lines: poly.lines, points: poly.points, center }
}

/**
 * Regular polygon with `n` sides: vertices on a construction circle, all sides equal.
 * `corner` is the position of the first vertex.
 */
export function addPolygon(
  s: Sketch,
  centerRef: PointRef,
  corner: XY,
  n: number,
  construction = false
): { sketch: Sketch; lines: string[]; points: string[]; circle: string } {
  n = Math.max(3, Math.min(64, Math.round(n)))
  const center = typeof centerRef === 'string' ? pos(s, centerRef) : centerRef
  const r = Math.hypot(corner[0] - center[0], corner[1] - center[1])
  const a0 = Math.atan2(corner[1] - center[1], corner[0] - center[0])
  const pts: XY[] = []
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * 2 * Math.PI) / n
    pts.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)])
  }
  const circ = addCircle(s, centerRef, r, true)
  const poly = addPolyline(circ.sketch, pts, true, construction)
  let sk = poly.sketch
  for (const p of poly.points) sk = addConstraint(sk, 'pointOn', [p, circ.id]).sketch
  for (let i = 1; i < poly.lines.length; i++) sk = addConstraint(sk, 'equal', [poly.lines[0], poly.lines[i]]).sketch
  return { sketch: sk, lines: poly.lines, points: poly.points, circle: circ.id }
}

/** Replace every use of point `drop` with `keep` and remove `drop`. Degenerate curves and constraints go away. */
export function mergePoints(s: Sketch, keep: string, drop: string): Sketch {
  if (keep === drop) return s
  const sub = (id: string) => (id === drop ? keep : id)
  const curves: SkCurve[] = []
  const gone = new Set<string>()
  for (const c of s.curves) {
    let n: SkCurve
    if (c.kind === 'line') n = { ...c, p1: sub(c.p1), p2: sub(c.p2) }
    else if (c.kind === 'circle') n = { ...c, c: sub(c.c) }
    else if (c.kind === 'spline') {
      // a spline survives merges of its own points: neighbours collapse, ends meeting close it
      let pts = c.pts.map(sub).filter((p, i, a) => i === 0 || p !== a[i - 1])
      let closed = !!c.closed
      if (pts.length > 2 && pts[0] === pts[pts.length - 1]) {
        pts = pts.slice(0, -1)
        closed = true
      }
      if (new Set(pts).size < pts.length || pts.length < (closed ? 3 : 2)) {
        gone.add(c.id)
        continue
      }
      curves.push({ ...c, pts, ...(closed ? { closed: true } : {}) })
      continue
    } else n = { ...c, c: sub(c.c), start: sub(c.start), end: sub(c.end) }
    const pts = curvePoints(n)
    if (new Set(pts).size < pts.length) gone.add(c.id)
    else curves.push(n)
  }
  const constraints = s.constraints
    .map((c) => ({ ...c, refs: c.refs.map(sub) }))
    .filter((c) => !c.refs.some((r) => gone.has(r)))
    .filter((c) => !(c.type === 'coincident' && c.refs[0] === c.refs[1]))
    .filter((c) => !(c.refs.length === 2 && c.refs[0] === c.refs[1] && ['horizontal', 'vertical', 'distance', 'distanceX', 'distanceY'].includes(c.type)))
  return prune({ ...s, points: s.points.filter((p) => p.id !== drop), curves, constraints })
}

/**
 * Delete points, curves and constraints. Deleting a point deletes the curves using it; deleting
 * a curve also deletes its points that nothing else uses. Constraints that refer to anything
 * deleted go too. The origin and axes cannot be deleted.
 */
export function deleteEntities(s: Sketch, ids: Iterable<string>): Sketch {
  const del = new Set([...ids].filter((id) => !RESERVED.has(id)))
  const delPoints = new Set(s.points.filter((p) => del.has(p.id)).map((p) => p.id))
  const curves = s.curves.filter((c) => !del.has(c.id) && !curvePoints(c).some((p) => delPoints.has(p)))
  const removedCurves = s.curves.filter((c) => !curves.includes(c))
  const used = new Set(curves.flatMap(curvePoints))
  // points of removed curves disappear unless another curve still uses them
  const orphan = new Set(removedCurves.flatMap(curvePoints).filter((p) => !used.has(p)))
  const points = s.points.filter((p) => !delPoints.has(p.id) && !orphan.has(p.id))
  const alive = new Set([...points.map((p) => p.id), ...curves.map((c) => c.id), ...RESERVED])
  const constraints = s.constraints.filter((c) => !del.has(c.id) && c.refs.every((r) => alive.has(r)))
  return { ...s, points, curves, constraints }
}

/** Remove constraints that refer to missing entities. */
function prune(s: Sketch): Sketch {
  const alive = new Set([...s.points.map((p) => p.id), ...s.curves.map((c) => c.id), ...RESERVED])
  return { ...s, constraints: s.constraints.filter((c) => c.refs.every((r) => alive.has(r))) }
}

/** Flip construction on the given curves (all become construction unless all already are). */
export function toggleConstruction(s: Sketch, ids: Iterable<string>): Sketch {
  const set = new Set(ids)
  const targets = s.curves.filter((c) => set.has(c.id))
  if (!targets.length) return s
  const on = !targets.every((c) => c.construction)
  return {
    ...s,
    curves: s.curves.map((c) => {
      if (!set.has(c.id)) return c
      const { construction: _, ...rest } = c
      return on ? { ...rest, construction: true } : rest
    })
  }
}

/** Set a dimension's value. Lengths and radii must stay positive; signed X/Y distances and angles may be anything finite. */
export function setDimension(s: Sketch, id: string, value: number): Sketch {
  if (!Number.isFinite(value)) return s
  const c = s.constraints.find((c) => c.id === id)
  if (!c || !DIMENSIONS.has(c.type)) return s
  const positive = c.type === 'distance' || c.type === 'radius' || c.type === 'diameter'
  if (positive && value <= 0) return s
  if (c.value === value) return s
  return { ...s, constraints: s.constraints.map((k) => (k.id === id ? { ...k, value } : k)) }
}

/** Move points by a delta (no solving) — e.g. to follow a translated plane. */
export function translatePoints(s: Sketch, ids: Iterable<string>, d: XY): Sketch {
  const set = new Set(ids)
  return { ...s, points: s.points.map((p) => (set.has(p.id) ? { ...p, x: p.x + d[0], y: p.y + d[1] } : p)) }
}

export function pos(s: Sketch, id: string): XY {
  if (id === 'O') return [0, 0]
  const p = s.points.find((p) => p.id === id)
  if (!p) throw new Error(`no point ${id}`)
  return [p.x, p.y]
}

/** Current value a dimension would have for the geometry as drawn (to create it without moving anything). */
export function measure(s: Sketch, type: ConstraintType, refs: string[]): number | null {
  const kinds = refs.map((id) => (id === 'O' || s.points.some((p) => p.id === id) ? 'point' : s.curves.find((c) => c.id === id)?.kind))
  const lineEnds = (id: string): [XY, XY] | null => {
    if (id === 'AX') return [[0, 0], [1, 0]]
    if (id === 'AY') return [[0, 0], [0, 1]]
    const c = s.curves.find((c) => c.id === id)
    return c && c.kind === 'line' ? [pos(s, c.p1), pos(s, c.p2)] : null
  }
  const two = (): [XY, XY] | null => {
    if (refs.length === 1 && kinds[0] === 'line') return lineEnds(refs[0])
    if (refs.length === 2 && kinds[0] === 'point' && kinds[1] === 'point') return [pos(s, refs[0]), pos(s, refs[1])]
    return null
  }
  const round = (v: number) => Math.round(v * 1000) / 1000
  switch (type) {
    case 'distance': {
      const t = two()
      if (t) return round(Math.hypot(t[1][0] - t[0][0], t[1][1] - t[0][1]))
      if (kinds[0] === 'point' && kinds[1] === 'line') {
        const l = lineEnds(refs[1])
        if (!l) return null
        const p = pos(s, refs[0])
        const [a, b] = l
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        return round(Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len)
      }
      return null
    }
    case 'distanceX':
    case 'distanceY': {
      const t = two()
      const i = type === 'distanceX' ? 0 : 1
      return t ? round(t[1][i] - t[0][i]) : null
    }
    case 'radius':
    case 'diameter': {
      const c = s.curves.find((c) => c.id === refs[0])
      if (!c || c.kind === 'line' || c.kind === 'spline') return null
      return round(type === 'radius' ? c.r : c.r * 2)
    }
    case 'angle': {
      const a = lineEnds(refs[0])
      const b = lineEnds(refs[1])
      if (!a || !b) return null
      const ang = (l: [XY, XY]) => Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0])
      let d = ((ang(b) - ang(a)) * 180) / Math.PI
      while (d > 180) d -= 360
      while (d <= -180) d += 360
      return round(d)
    }
    default:
      return null
  }
}
