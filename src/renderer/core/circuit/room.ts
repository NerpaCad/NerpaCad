/**
 * The room around the circuit: the sensors take their readings from it, not from sliders on the
 * parts. The table is the board's plane (mm, y down).
 *
 * - Light (lux): the room's own light, plus lamps on the table and the circuit's LEDs, each
 *   fading with distance.
 * - Temperature (°C): the room's, plus heat sources (a mug of hot tea) close by.
 * - What is in front of a sensor: boxes and hands on the table, along the way the sensor looks.
 */
import { DEFAULT_ROOM, type Circuit, type Part, type Room, type RoomItem, type RoomItemKind } from './model'
import { SENSOR_EYE, rotatePoint } from './parts'

export const roomOf = (c: Circuit): Room => c.room ?? DEFAULT_ROOM

/** How big each thing is on the table: a box's half sizes, or a round thing's radius, mm. */
export const ITEM_SIZE: Record<RoomItemKind, { hw: number; hh: number; round: boolean }> = {
  box: { hw: 40, hh: 25, round: false },
  hand: { hw: 35, hh: 35, round: true },
  lamp: { hw: 18, hh: 18, round: true },
  heater: { hw: 20, hh: 20, round: true }
}

/** the room's light: night, dim, lit, day (lux) — the panel's stops */
export const ROOM_LIGHT_RANGE: [number, number] = [0, 1000]
export const ROOM_TEMP_RANGE: [number, number] = [-10, 40]

/**
 * A lamp on the table: this bright right under it (lux), half that at LAMP_REACH mm, and nothing
 * beyond LAMP_RANGE mm — the light falls off as the 3D view draws it (its pool of light on the table).
 */
const LAMP_LUX = 2000
const LAMP_REACH = 60
export const LAMP_RANGE = 250
/** an LED at full brightness touching the sensor, lux; half that at LED_REACH mm */
const LED_LUX = 400
const LED_REACH = 8
/** a heat source: this much warmer right at it (°C), falling e-fold every HEAT_REACH mm */
const HEAT = 45
const HEAT_REACH = 25

/** A light source on the table (a lit LED): where and how bright 0…1. */
export interface Glow {
  x: number
  y: number
  brightness: number
}

/** Distance from a point to the edge of an item (0 inside it). */
function distTo(it: RoomItem, x: number, y: number): number {
  const s = ITEM_SIZE[it.kind]
  if (s.round) return Math.max(0, Math.hypot(x - it.x, y - it.y) - s.hw)
  const dx = Math.max(0, Math.abs(x - it.x) - s.hw)
  const dy = Math.max(0, Math.abs(y - it.y) - s.hh)
  return Math.hypot(dx, dy)
}

/** Light at a point of the table, lux. */
export function lightAt(room: Room, x: number, y: number, glows: Glow[] = []): number {
  let lux = Math.max(0, room.light)
  for (const it of room.items) {
    if (it.kind !== 'lamp' || !it.on) continue
    const d = Math.hypot(x - it.x, y - it.y)
    // the same soft edge as a three.js light with a range: (1 − (d/R)⁴)², clamped
    const edge = Math.max(0, 1 - (d / LAMP_RANGE) ** 4) ** 2
    lux += ((LAMP_LUX * LAMP_REACH ** 2) / (d * d + LAMP_REACH ** 2)) * edge
  }
  for (const g of glows) {
    if (g.brightness <= 0) continue
    const d = Math.hypot(x - g.x, y - g.y)
    lux += (g.brightness * LED_LUX * LED_REACH ** 2) / (d * d + LED_REACH ** 2)
  }
  return lux
}

/** Temperature at a point of the table, °C. */
export function tempAt(room: Room, x: number, y: number): number {
  let t = room.temp
  for (const it of room.items) if (it.kind === 'heater') t += HEAT * Math.exp(-distTo(it, x, y) / HEAT_REACH)
  return t
}

/** A photoresistor's resistance in this light, ohms (about 10 kΩ at 10 lux, 1 kΩ in a lit room). */
export function ldrOhms(lux: number): number {
  const r = 10_000 * Math.pow(Math.max(0.05, lux) / 10, -0.7)
  return Math.max(100, Math.min(1_000_000, r))
}

/** Where a sensor part looks from (table mm) and which way (a unit vector). */
export function eyeOf(p: Part): { x: number; y: number; dx: number; dy: number } | null {
  const e = SENSOR_EYE[p.kind]
  if (!e) return null
  const [ex, ey] = rotatePoint(e.x, e.y, p.rot)
  const [dx, dy] = rotatePoint(0, -1, p.rot)
  return { x: p.x + ex, y: p.y + ey, dx, dy }
}

/** How far along a ray from (x, y) in direction (dx, dy) it meets the item, or null. */
function rayHit(it: RoomItem, x: number, y: number, dx: number, dy: number): number | null {
  const s = ITEM_SIZE[it.kind]
  if (s.round) {
    // |p + t·d − c| = r
    const fx = x - it.x
    const fy = y - it.y
    const b = fx * dx + fy * dy
    const c = fx * fx + fy * fy - s.hw * s.hw
    const disc = b * b - c
    if (disc < 0) return null
    const t = -b - Math.sqrt(disc)
    return t >= 0 ? t : c <= 0 ? 0 : null
  }
  // slab test against the box
  let t0 = -Infinity
  let t1 = Infinity
  for (const [o, d, lo, hi] of [
    [x, dx, it.x - s.hw, it.x + s.hw],
    [y, dy, it.y - s.hh, it.y + s.hh]
  ] as [number, number, number, number][]) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    const a = (lo - o) / d
    const b = (hi - o) / d
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  if (t1 < Math.max(t0, 0)) return null
  return Math.max(0, t0)
}

/**
 * The nearest box or hand in front of a sensor within `halfDeg` of the way it looks, mm, or null
 * when nothing is closer than `max`.
 */
export function distanceAhead(room: Room, p: Part, max: number, halfDeg: number): number | null {
  const eye = eyeOf(p)
  if (!eye) return null
  let best: number | null = null
  const rays = 9
  for (let i = 0; i < rays; i++) {
    const a = ((-halfDeg + (2 * halfDeg * i) / (rays - 1)) * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const dx = eye.dx * c - eye.dy * s
    const dy = eye.dx * s + eye.dy * c
    for (const it of room.items) {
      if (it.kind !== 'box' && it.kind !== 'hand') continue
      const t = rayHit(it, eye.x, eye.y, dx, dy)
      if (t !== null && t <= max && (best === null || t < best)) best = t
    }
  }
  return best
}

/** Is a point within a sensor's field of view (`halfDeg` either side, up to `max` mm)? */
export function inView(p: Part, x: number, y: number, max: number, halfDeg: number): boolean {
  const eye = eyeOf(p)
  if (!eye) return false
  const vx = x - eye.x
  const vy = y - eye.y
  const d = Math.hypot(vx, vy)
  if (d > max) return false
  if (d < 1e-9) return true
  return (vx * eye.dx + vy * eye.dy) / d >= Math.cos((halfDeg * Math.PI) / 180)
}
