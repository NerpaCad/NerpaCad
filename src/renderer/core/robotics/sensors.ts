/**
 * Line sensor. It looks at a small round patch of floor and reports how light it is:
 * 0 = black, 100 = white. Half on the line gives about 50, so the value changes smoothly across
 * the line's edge, like a real reflectance sensor.
 */
import type { Surface, TileKind } from '../doc/model'
import { TILE_SIZE, onLine } from './tiles'
import { type PlacedTerrain, topAt } from './terrain'

/** A tile on the floor: centre (mm) and rotation around Z (radians). */
export interface PlacedTile {
  kind: TileKind
  x: number
  y: number
  angle: number
  /** the surface it lies on: a flat height (mm, 0 = the floor) … */
  z?: number
  /** … or a ramp (the tile follows its slope; seen from above it keeps its square) */
  ramp?: PlacedTerrain
  /** how light it is off the line, 0…1 (1: white paper; a road is a little darker) */
  paper?: number
}

/** Height of a tile's surface at a floor point. */
export function tileSurface(t: PlacedTile, x: number, y: number): number {
  if (t.ramp) return topAt(t.ramp, x, y) ?? t.z ?? 0
  return t.z ?? 0
}

/** a tile counts as "under" a sensor when its surface is this close to the ground the sensor sees, mm */
const LEVEL = 20

/** sample points in a unit disc: the centre and two rings */
const SAMPLES: [number, number][] = (() => {
  const out: [number, number][] = [[0, 0]]
  for (let i = 0; i < 6; i++) out.push([0.5 * Math.cos((i * Math.PI) / 3), 0.5 * Math.sin((i * Math.PI) / 3)])
  for (let i = 0; i < 12; i++) out.push([Math.cos(((i + 0.5) * Math.PI) / 6), Math.sin(((i + 0.5) * Math.PI) / 6)])
  return out
})()

/**
 * Is the floor black at this world point? Later tiles lie on top of earlier ones. With `ground`
 * (the height of the surface the sensor looks at) only tiles on that level count: a line on a
 * bridge is not seen from under it.
 */
export function blackAt(tiles: PlacedTile[], x: number, y: number, ground?: number): boolean {
  return lightAt(tiles, x, y, ground) === 0
}

/** How light the top tile at this point is (0 on its line, its paper elsewhere), or null: no tile there. */
export function lightAt(tiles: PlacedTile[], x: number, y: number, ground?: number): number | null {
  const h = TILE_SIZE / 2
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i]
    const dx = x - t.x
    const dy = y - t.y
    if (Math.abs(dx) > h * 1.5 || Math.abs(dy) > h * 1.5) continue
    const c = Math.cos(-t.angle)
    const s = Math.sin(-t.angle)
    const lx = c * dx - s * dy
    const ly = s * dx + c * dy
    if (Math.abs(lx) > h || Math.abs(ly) > h) continue
    if (ground !== undefined && Math.abs(tileSurface(t, x, y) - ground) > LEVEL) continue
    return onLine(t.kind, lx, ly) ? 0 : (t.paper ?? 1)
  }
  return null
}

/** Sensor reading 0 (black) … 100 (white) for a patch of radius `spot` mm around (x, y). */
export function lineSensor(
  tiles: PlacedTile[],
  x: number,
  y: number,
  spot: number,
  ground?: number,
  /** how light the ground is where no tile lies (grass, sand, water…), 0…1; white without it */
  shade?: (x: number, y: number) => number
): number {
  let sum = 0
  for (const [u, v] of SAMPLES) {
    const px = x + u * spot
    const py = y + v * spot
    sum += lightAt(tiles, px, py, ground) ?? shade?.(px, py) ?? 1
  }
  return Math.round((100 * sum) / SAMPLES.length)
}

/** How light each landscape top looks to a line sensor (0 black … 1 white). */
export const SURFACE_LIGHT: Record<Surface | 'water', number> = { grass: 0.62, sand: 0.86, stone: 0.68, road: 0.9, water: 0.2 }
