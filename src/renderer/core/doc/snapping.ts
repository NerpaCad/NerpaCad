/**
 * Smart guides: while moving shapes in the workplane, their left/center/right (and
 * front/center/back) lines stick to the same lines of other shapes when close enough.
 * Everything here is in workplane X/Y coordinates.
 */

export interface Box2 {
  min: [number, number]
  max: [number, number]
}

/** A guide line at `value` on axis `axis` (0 = a line of constant X), spanning `from`..`to` on the other axis. */
export interface Guide {
  axis: 0 | 1
  value: number
  from: number
  to: number
}

const lines = (b: Box2, k: 0 | 1) => [b.min[k], (b.min[k] + b.max[k]) / 2, b.max[k]]

/**
 * Adjust `delta` so the moving box lines up with the nearest line of another box, per axis,
 * when within `tol`. Axes with no match keep `fallback(delta)` (grid snapping).
 * Returns the final delta and the guides to draw.
 */
export function snapToGuides(
  moving: Box2,
  others: Box2[],
  delta: [number, number],
  tol: number,
  fallback: (v: number) => number = (v) => v
): { delta: [number, number]; guides: Guide[]; snapped: [boolean, boolean] } {
  const out: [number, number] = [fallback(delta[0]), fallback(delta[1])]
  const snapped: [boolean, boolean] = [false, false]
  for (const k of [0, 1] as const) {
    let best = tol
    let fix: number | null = null
    const mine = lines(moving, k).map((v) => v + delta[k])
    for (const o of others) {
      for (const target of lines(o, k)) {
        for (const m of mine) {
          const d = Math.abs(target - m)
          if (d < best - 1e-9) {
            best = d
            fix = target - m
          }
        }
      }
    }
    if (fix !== null) {
      out[k] = delta[k] + fix
      snapped[k] = true
    }
  }

  // guides for every exact alignment after snapping
  const guides: Guide[] = []
  const moved: Box2 = {
    min: [moving.min[0] + out[0], moving.min[1] + out[1]],
    max: [moving.max[0] + out[0], moving.max[1] + out[1]]
  }
  for (const k of [0, 1] as const) {
    if (!snapped[k]) continue
    const o = k === 0 ? 1 : 0
    for (const m of lines(moved, k)) {
      for (const other of others) {
        if (lines(other, k).some((v) => Math.abs(v - m) < 1e-6)) {
          guides.push({
            axis: k,
            value: m,
            from: Math.min(moved.min[o], other.min[o]),
            to: Math.max(moved.max[o], other.max[o])
          })
        }
      }
    }
  }
  return { delta: out, guides, snapped }
}
