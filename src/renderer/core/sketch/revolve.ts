/**
 * Revolving a sketch profile around an axis (the sketch's X or Y axis, or one of its lines).
 *
 * manifold-3d revolves a 2D cross-section around its own Y axis and makes that the Z axis of
 * the result; a partial turn sweeps from +X toward +Y. So the profile is rewritten in axis
 * coordinates (v = distance from the axis, u = position along it), revolved, and the result is
 * placed back into the sketch frame so that a partial turn comes up out of the sketch plane
 * (toward +Z, the side the camera looks from while sketching).
 */
import type { XY } from './geometry'
import type { Sketch } from './types'
import { AXIS_X, AXIS_Y, pointPos } from './types'

export interface RevolveSetup {
  /** the profile in axis coordinates (x = distance from the axis, y = along the axis) */
  loops: XY[][]
  /** 4×4 column-major matrix from revolve space into the sketch frame */
  matrix: number[]
  /** part of the profile lies on the other side of the axis (that part is ignored) */
  crosses: boolean
}

/** End points of the axis: the sketch axes or a line of the sketch. */
export function axisLine(s: Sketch, axis: string): [XY, XY] | null {
  if (axis === AXIS_X) return [[0, 0], [1, 0]]
  if (axis === AXIS_Y) return [[0, 0], [0, 1]]
  const c = s.curves.find((k) => k.id === axis)
  if (!c || c.kind !== 'line') return null
  const a = pointPos(s, c.p1)
  const b = pointPos(s, c.p2)
  if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) return null
  return [a, b]
}

export function revolveSetup(s: Sketch, profile: XY[][], axis: string): RevolveSetup | null {
  const line = axisLine(s, axis)
  if (!line || profile.length === 0) return null
  const [A, B] = line
  const len = Math.hypot(B[0] - A[0], B[1] - A[1])
  let d: XY = [(B[0] - A[0]) / len, (B[1] - A[1]) / len]
  // n = Z × d: with it, (n, Z, d) is right-handed, so revolve space maps without mirroring
  let n: XY = [-d[1], d[0]]
  const side = (p: XY) => (p[0] - A[0]) * n[0] + (p[1] - A[1]) * n[1]
  // put the profile on the +v side (weighted by how far out it is)
  let sum = 0
  for (const l of profile) for (const p of l) sum += side(p)
  if (sum < 0) {
    d = [-d[0], -d[1]]
    n = [-n[0], -n[1]]
  }
  const eps = 1e-6
  let minV = Infinity
  const loops = profile.map((l) =>
    l.map((p): XY => {
      const q: XY = [p[0] - A[0], p[1] - A[1]]
      const v = q[0] * n[0] + q[1] * n[1]
      minV = Math.min(minV, v)
      return [v, q[0] * d[0] + q[1] * d[1]]
    })
  )
  // columns: revolve X → n, revolve Y → sketch Z, revolve Z → d; then move to A
  const matrix = [n[0], n[1], 0, 0, 0, 0, 1, 0, d[0], d[1], 0, 0, A[0], A[1], 0, 1]
  return { loops, matrix, crosses: minV < -eps }
}
