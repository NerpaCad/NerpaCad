/**
 * Spur gear outline: involute teeth (pressure angle 20°), standard proportions.
 * All sizes in mm. Pure 2D maths, used by the geometry worker and by the tests.
 */

export interface GearParams {
  /** number of teeth, 6…80 */
  teeth: number
  /** module m: tooth size; pitch diameter = m · teeth */
  module: number
  /** thickness along Z */
  thickness: number
  /** hole for the shaft (0 = none) */
  bore: number
}

export const GEAR_DEFAULTS: GearParams = { teeth: 16, module: 2, thickness: 6, bore: 5 }
export const GEAR_LIMITS = {
  teeth: [6, 80],
  module: [0.3, 10],
  thickness: [0.5, 200],
  bore: [0, 500]
} as const

const PRESSURE = (20 * Math.PI) / 180

/** Pitch diameter: two gears mesh when their centers are (d1 + d2) / 2 apart. */
export const pitchDiameter = (g: GearParams) => g.module * g.teeth
export const outerDiameter = (g: GearParams) => g.module * (g.teeth + 2)
export const rootDiameter = (g: GearParams) => g.module * (g.teeth - 2.5)

const inv = (a: number) => Math.tan(a) - a

export function clampGear(g: Partial<GearParams>): GearParams {
  const c = (v: number | undefined, [lo, hi]: readonly [number, number], d: number) =>
    Math.min(hi, Math.max(lo, Number.isFinite(v) ? (v as number) : d))
  const teeth = Math.round(c(g.teeth, GEAR_LIMITS.teeth, GEAR_DEFAULTS.teeth))
  const module = c(g.module, GEAR_LIMITS.module, GEAR_DEFAULTS.module)
  const thickness = c(g.thickness, GEAR_LIMITS.thickness, GEAR_DEFAULTS.thickness)
  // the hole must leave a ring of material inside the teeth
  const maxBore = Math.max(0, rootDiameter({ teeth, module, thickness, bore: 0 }) * 0.8)
  const bore = Math.min(maxBore, c(g.bore, GEAR_LIMITS.bore, GEAR_DEFAULTS.bore))
  return { teeth, module, thickness, bore }
}

/** The outline, counter-clockwise, centered on the origin. */
export function gearOutline(g: GearParams, flankSteps = 8): [number, number][] {
  const z = g.teeth
  const rp = (g.module * z) / 2
  const rb = rp * Math.cos(PRESSURE)
  const ra = rp + g.module
  const rf = Math.max(rp - 1.25 * g.module, g.module * 0.5)
  const half = Math.PI / (2 * z) + inv(PRESSURE) // half tooth angle measured at the base circle
  // angle of the flank from the tooth's middle at radius r
  const flank = (r: number) => (r <= rb ? half : half - inv(Math.acos(rb / r)))
  const tipHalf = Math.max(flank(ra), 0.02 / z)
  const pts: [number, number][] = []
  const at = (r: number, a: number) => pts.push([r * Math.cos(a), r * Math.sin(a)])
  const r0 = Math.max(rf, Math.min(rb, ra))
  const pitch = (2 * Math.PI) / z
  for (let i = 0; i < z; i++) {
    const c = i * pitch
    // right flank (clockwise side) from the root up to the tip
    at(rf, c - flank(r0))
    for (let k = 0; k <= flankSteps; k++) {
      const r = r0 + ((ra - r0) * k) / flankSteps
      at(r, c - Math.max(flank(r), tipHalf))
    }
    // the top land
    at(ra, c)
    // left flank back down
    for (let k = flankSteps; k >= 0; k--) {
      const r = r0 + ((ra - r0) * k) / flankSteps
      at(r, c + Math.max(flank(r), tipHalf))
    }
    at(rf, c + flank(r0))
    // the root between this tooth and the next
    const a0 = c + flank(r0)
    const a1 = c + pitch - flank(r0)
    for (let k = 1; k < 4; k++) at(rf, a0 + ((a1 - a0) * k) / 4)
  }
  // drop points that coincide (the flank starts where the root radius meets the base circle)
  return pts.filter((p, i) => {
    const q = pts[(i + pts.length - 1) % pts.length]
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6
  })
}

/** A circle as a polygon, clockwise (a hole). */
export function boreOutline(g: GearParams, segments = 32): [number, number][] {
  const r = g.bore / 2
  const pts: [number, number][] = []
  for (let i = 0; i < segments; i++) {
    const a = (-2 * Math.PI * i) / segments
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return pts
}
