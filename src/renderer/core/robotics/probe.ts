/**
 * Questions the sensors ask about solid things on the field: how far along a ray is the nearest
 * one (ultrasonic, light blocking) and does anything overlap a small box (touch button). During a
 * run the physics engine answers them; while nothing runs, the 3D view does.
 */
import type { V3 } from './lighting'

export interface Probe {
  /**
   * Distance (mm) along the unit direction `dir` from `from` to the first solid thing, or null
   * when there is none within `max`. The object `exclude` (a node id) is ignored.
   */
  ray(from: V3, dir: V3, max: number, exclude?: string): number | null
  /**
   * Does anything except `exclude` overlap the box (centre, half sizes, turned by `yaw` around Z
   * and tipped nose-up by `pitch`)? `only` limits it to some objects (by node id).
   */
  touching(center: V3, half: V3, yaw: number, exclude?: string, only?: (id: string) => boolean, pitch?: number): boolean
}

/** Something between two points, for the light sensor: a ray query that stops short of the source. */
export function occlusionFrom(probe: Probe, exclude?: string) {
  return (from: V3, to: V3, radius: number): boolean => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as V3
    const dist = Math.hypot(d[0], d[1], d[2])
    if (dist < 1e-6) return false
    const reach = dist - radius - 2
    if (reach <= 0) return false
    const hit = probe.ray(from, [d[0] / dist, d[1] / dist, d[2] / dist], reach, exclude)
    return hit !== null
  }
}
