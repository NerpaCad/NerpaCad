/**
 * Light on the robotics field, as the light sensor sees it. Worked out from the sources, not from
 * the picture on screen, so a reading is exact and the same every run.
 *
 * - A source at 100 % brightness 30 cm straight in front of a sensor gives 100; the light falls
 *   off with the square of the distance.
 * - A cone lamp lights only inside its cone (with a soft edge).
 * - The sensor looks up from the robot's deck but sees all round, more in front:
 *   half the light from the side, none from straight behind.
 * - Anything solid between the source and the sensor blocks it.
 * - There is no daylight: with every lamp off the room is dark (0).
 */

export type V3 = [number, number, number]

export interface LightSource {
  /** where the light comes from, mm */
  pos: V3
  /** 0…100 % */
  brightness: number
  /** cone lamps: the beam's direction (unit vector) and cos of half the opening angle */
  dir?: V3
  cosHalf?: number
  /** size of the glowing thing (mm): an obstacle closer than this to the source does not block it */
  radius?: number
}

/** reference distance: 100 % at this many mm gives a reading of 100 */
export const LIGHT_REF_MM = 300
/** closer than this the light does not grow any more (the sensor is not a point) */
const MIN_DIST = 40

/** Something between two points? (true = blocked) */
export type Occlusion = (from: V3, to: V3, radius: number) => boolean

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])

/** How much of a cone lamp's light reaches a direction: 1 inside, 0 outside, soft at the edge. */
export function coneFactor(cosAngle: number, cosHalf: number): number {
  // the edge fades over the outer fifth of the half-angle
  const half = Math.acos(Math.max(-1, Math.min(1, cosHalf)))
  const inner = Math.cos(half * 0.8)
  if (cosAngle >= inner) return 1
  if (cosAngle <= cosHalf) return 0
  const t = (cosAngle - cosHalf) / (inner - cosHalf)
  return t * t * (3 - 2 * t)
}

/**
 * Reading of a light sensor 0…100 at `at`, whose eye looks along `axis` (unit vector).
 */
export function lightReading(at: V3, axis: V3, sources: LightSource[], blocked?: Occlusion): number {
  let sum = 0
  for (const s of sources) {
    if (!(s.brightness > 0)) continue
    const toSrc = sub(s.pos, at)
    const d = len(toSrc)
    if (d < 1e-6) {
      sum += s.brightness / 100
      continue
    }
    const u: V3 = [toSrc[0] / d, toSrc[1] / d, toSrc[2] / d]
    // the lamp's cone: the direction from the lamp to the sensor is −u
    let cone = 1
    if (s.dir && s.cosHalf !== undefined) cone = coneFactor(-dot(u, s.dir), s.cosHalf)
    if (cone <= 0) continue
    const facing = 0.5 + 0.5 * dot(u, axis)
    if (facing <= 0) continue
    if (blocked && blocked(at, s.pos, s.radius ?? 0)) continue
    const r = Math.max(MIN_DIST, d)
    sum += (s.brightness / 100) * (LIGHT_REF_MM / r) ** 2 * cone * facing
  }
  return Math.max(0, Math.min(100, Math.round(sum * 100)))
}
