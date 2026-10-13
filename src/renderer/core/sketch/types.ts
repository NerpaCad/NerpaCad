/**
 * 2D sketch model (sketch plane coordinates, mm).
 *
 * Curves share point ids instead of owning their endpoints: a closed rectangle is 4 points
 * and 4 lines, with no coincidence constraints needed. Every id (points, curves,
 * constraints) is unique within a sketch.
 *
 * The sketch always has an implicit, fixed origin and two axes that constraints may refer to:
 * point `O` (0,0) and the construction lines `AX` (X axis) and `AY` (Y axis).
 */

export interface SkPoint {
  id: string
  x: number
  y: number
}

interface CurveBase {
  id: string
  /** construction (helper) geometry: drawn dashed, not part of the profile */
  construction?: boolean
}

export interface SkLine extends CurveBase {
  kind: 'line'
  p1: string
  p2: string
}

export interface SkCircle extends CurveBase {
  kind: 'circle'
  c: string
  r: number
}

/** Counter-clockwise arc from `start` to `end` around `c`. */
export interface SkArc extends CurveBase {
  kind: 'arc'
  c: string
  start: string
  end: string
  r: number
}

/**
 * A smooth curve through its points (a centripetal Catmull-Rom spline). The first and the last
 * point are its ends and can be shared with other curves; a closed spline goes round back to
 * its first point. The points in between are free for the solver: the spline itself adds no
 * equations, so constraints only apply to its points.
 */
export interface SkSpline extends CurveBase {
  kind: 'spline'
  pts: string[]
  closed?: boolean
}

export type SkCurve = SkLine | SkCircle | SkArc | SkSpline

/**
 * Constraint kinds and what `refs` hold (p = point, l = line, c = circle, a = arc):
 * - coincident   [p, p]
 * - horizontal   [l] | [p, p]         vertical  [l] | [p, p]
 * - parallel     [l, l]               perpendicular [l, l]
 * - equal        [l, l] (length) | [c|a, c|a] (radius)
 * - tangent      [l, c|a] | [c|a, c|a]
 * - pointOn      [p, l|c|a]
 * - midpoint     [p, l]
 * - symmetric    [p, p, l] | [p, p, p]
 * - lock         [p]          value = x, value2 = y
 * - distance     [l] | [p, p] | [p, l]   value = mm
 * - distanceX    [l] | [p, p]  value = x2 − x1 (signed mm)
 * - distanceY    [l] | [p, p]  value = y2 − y1
 * - radius       [c|a]  value = mm        diameter [c|a]
 * - angle        [l, l]  value = degrees, from the first line's direction to the second's
 */
export type ConstraintType =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent'
  | 'pointOn'
  | 'midpoint'
  | 'symmetric'
  | 'lock'
  | 'distance'
  | 'distanceX'
  | 'distanceY'
  | 'radius'
  | 'diameter'
  | 'angle'

export interface SkConstraint {
  id: string
  type: ConstraintType
  refs: string[]
  value?: number
  value2?: number
  /**
   * Where a dimension is drawn, once the user has moved it (relative to what it measures, so it
   * follows the geometry; sketch mm and radians). Without it the dimension sits in its default
   * place. Lengths [offset to the side, position along 0…1]; distanceX/Y [offset from the first
   * point, position along]; point–line distance [position along, offset to the side];
   * radius/diameter [direction, distance beyond the curve]; angle [radius of the arc].
   */
  place?: number[]
}

export interface Sketch {
  points: SkPoint[]
  curves: SkCurve[]
  constraints: SkConstraint[]
  /** counter for new ids */
  next: number
}

export const ORIGIN = 'O'
export const AXIS_X = 'AX'
export const AXIS_Y = 'AY'
export const RESERVED = new Set([ORIGIN, AXIS_X, AXIS_Y])

/** Constraint types that carry a number the user can edit (dimensions). */
export const DIMENSIONS: ReadonlySet<ConstraintType> = new Set([
  'distance',
  'distanceX',
  'distanceY',
  'radius',
  'diameter',
  'angle'
])

export const emptySketch = (): Sketch => ({ points: [], curves: [], constraints: [], next: 1 })

/** Ids of the points a curve uses. */
export function curvePoints(c: SkCurve): string[] {
  if (c.kind === 'line') return [c.p1, c.p2]
  if (c.kind === 'circle') return [c.c]
  if (c.kind === 'spline') return [...c.pts]
  return [c.c, c.start, c.end]
}

/** What an id refers to, including the implicit origin and axes. */
export type EntityKind = 'point' | 'line' | 'circle' | 'arc' | 'spline' | 'constraint'

export function kindOf(s: Sketch, id: string): EntityKind | null {
  if (id === ORIGIN) return 'point'
  if (id === AXIS_X || id === AXIS_Y) return 'line'
  if (s.points.some((p) => p.id === id)) return 'point'
  const c = s.curves.find((c) => c.id === id)
  if (c) return c.kind
  if (s.constraints.some((c) => c.id === id)) return 'constraint'
  return null
}

export function pointPos(s: Sketch, id: string): [number, number] | null {
  if (id === ORIGIN) return [0, 0]
  const p = s.points.find((p) => p.id === id)
  return p ? [p.x, p.y] : null
}

/** The two ends of an open curve (lines, arcs, open splines): where it can join other curves. */
export function curveEnds(c: SkCurve): [string, string] | null {
  if (c.kind === 'line') return [c.p1, c.p2]
  if (c.kind === 'arc') return [c.start, c.end]
  if (c.kind === 'spline' && !c.closed && c.pts.length >= 2) return [c.pts[0], c.pts[c.pts.length - 1]]
  return null
}
