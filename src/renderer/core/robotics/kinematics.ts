/** Differential drive: two wheels on one axle, the robot turns by driving them at different speeds. */

export interface Pose {
  /** position on the floor, mm */
  x: number
  y: number
  /** heading, radians (0 = facing world +X, counter-clockwise positive) */
  theta: number
}

/** Motor power (−100…100 %) to wheel ground speed (mm/s). */
export const wheelSpeed = (power: number, maxSpeed: number): number =>
  (Math.max(-100, Math.min(100, power)) / 100) * maxSpeed

/**
 * Move for `dt` seconds with the left/right wheel ground speeds `vl`, `vr` (mm/s). Exact for
 * constant speeds: the robot follows a circular arc (or a straight line, or spins in place).
 */
export function drive(p: Pose, vl: number, vr: number, track: number, dt: number): Pose {
  const v = (vl + vr) / 2
  const w = (vr - vl) / track
  if (Math.abs(w) < 1e-9) {
    return { x: p.x + v * Math.cos(p.theta) * dt, y: p.y + v * Math.sin(p.theta) * dt, theta: p.theta }
  }
  const th = p.theta + w * dt
  const r = v / w
  return {
    x: p.x + r * (Math.sin(th) - Math.sin(p.theta)),
    y: p.y - r * (Math.cos(th) - Math.cos(p.theta)),
    theta: th
  }
}

/** Robot-frame point → world floor point. */
export function toWorld(p: Pose, lx: number, ly: number): [number, number] {
  const c = Math.cos(p.theta)
  const s = Math.sin(p.theta)
  return [p.x + c * lx - s * ly, p.y + s * lx + c * ly]
}
