/**
 * Terrain of the robotics field: platforms, ramps and bridges on the 300 mm tile grid.
 *
 * - a platform is a solid block from the floor up to its height;
 * - a ramp is a solid wedge rising from the floor to its height along its own +Y (its "up" end);
 * - a bridge is only a deck (a slab `BRIDGE_DECK` thick) at its height, open underneath, so things
 *   can pass below it; it is meant to span between two platforms.
 *
 * Track tiles lie on these surfaces (flat on platforms and bridges, along the slope on ramps), and
 * robots and seals drive over them: they climb ramps, stop at walls, fall off edges.
 *
 * Piece-local coordinates: origin at the footprint centre on the floor, X across, Y along (a ramp
 * rises toward +Y), before the piece's own rotation around Z. Millimetres.
 */
import type { DecorKind, Surface, TerrainKind, TerrainParams, TileKind } from '../doc/model'
import { TILE_KINDS, TILE_SIZE } from './tiles'

export const TERRAIN_KINDS: TerrainKind[] = ['platform', 'ramp', 'bridge', 'ground', 'water']
/** the pieces of the «terrain» section (the landscape tiles have a section of their own) */
export const RELIEF_KINDS: TerrainKind[] = ['platform', 'ramp', 'bridge']
export const SURFACES: Surface[] = ['grass', 'sand', 'stone', 'road']
/** a landscape tile: a slab of earth this thick (less than a step: robots drive onto it) */
export const GROUND_HEIGHT = 10
/** a water tile: the bottom of its pool and the level of the water, mm */
export const WATER_FLOOR = 3
export const WATER_LEVEL = 7
/** what the landscape section offers: the four tops and water */
export type LandKind = Surface | 'water'
export const LAND_KINDS: LandKind[] = ['grass', 'sand', 'stone', 'road', 'water']
/** the flat colour of each (the panel's buttons, the piece's colour, the drag preview) */
export const LAND_COLOR: Record<LandKind, string> = {
  grass: '#69b545',
  sand: '#ecd8a0',
  stone: '#a9afb5',
  road: '#d7d8d4',
  water: '#2f8fd6'
}
/** the parameters of a landscape tile of this kind */
export const landParams = (k: LandKind): TerrainParams => (k === 'water' ? { kind: 'water', height: WATER_LEVEL } : { kind: 'ground', height: GROUND_HEIGHT, surface: k })
/** what a landscape tile is (null for the other pieces) */
export const landKindOf = (p: TerrainParams | undefined): LandKind | null =>
  p?.kind === 'water' ? 'water' : p?.kind === 'ground' ? (SURFACES.includes(p.surface as Surface) ? (p.surface as Surface) : 'grass') : null
/** is this a landscape tile (ground or water)? */
export const isLand = (k: TerrainKind | 'post') => k === 'ground' || k === 'water'
/** thickness of a bridge deck, mm */
export const BRIDGE_DECK = 15
/** heights offered, mm; the default lets the robot (58 mm) and the seal (100 mm) pass under a bridge */
export const TERRAIN_HEIGHT = 120
export const TERRAIN_MIN_HEIGHT = 30
export const TERRAIN_MAX_HEIGHT = 300
/** a step this high (mm) is simply driven over; anything higher is a wall */
export const STEP = 12
/** sticking to a surface below while driving down a ramp, mm per physics step */
const FOLLOW = 6
/** the steepest slope that can be driven up (rise per mm): about 25° */
export const CLIMB = 0.47

export const DEFAULT_TERRAIN: Record<TerrainKind, TerrainParams> = {
  platform: { kind: 'platform', height: TERRAIN_HEIGHT },
  ramp: { kind: 'ramp', height: TERRAIN_HEIGHT, length: 2 },
  bridge: { kind: 'bridge', height: TERRAIN_HEIGHT },
  ground: { kind: 'ground', height: GROUND_HEIGHT, surface: 'grass' },
  water: { kind: 'water', height: WATER_LEVEL }
}

/**
 * A piece on the field. A 'post' is not a piece of the document's terrain but something solid
 * and round standing on the field (a tree trunk, a rock — see decor.ts) that blocks the way.
 */
export interface PlacedTerrain {
  id: string
  kind: TerrainKind | 'post'
  /** a post's radius, mm */
  radius?: number
  /** what a post is (a tree, a bush, a rock) */
  decor?: DecorKind
  /** footprint centre, mm */
  x: number
  y: number
  /** rotation around Z, radians */
  angle: number
  /** top of a platform or bridge, the high end of a ramp, mm — above its base */
  height: number
  /**
   * What a platform, ramp, bridge or post stands on, mm above the floor (0: the floor; 10: a
   * landscape tile; a platform's top: built in tiers). The piece's node keeps it as its position's z.
   */
  base?: number
  /** size along its local Y, in tiles (ramps can be 1 or 2 long; the rest are 1) */
  length: number
  /** landscape tiles: the top, and the black line on a road */
  surface?: Surface
  line?: TileKind | null
}

/** Footprint half-sizes (local X, local Y), mm. */
export function halfSize(t: Pick<PlacedTerrain, 'kind' | 'length' | 'radius'>): [number, number] {
  if (t.kind === 'post') return [t.radius ?? 0, t.radius ?? 0]
  return [TILE_SIZE / 2, (TILE_SIZE * (t.kind === 'ramp' ? t.length : 1)) / 2]
}

export const clampHeight = (h: number) => Math.max(TERRAIN_MIN_HEIGHT, Math.min(TERRAIN_MAX_HEIGHT, Number.isFinite(h) ? h : TERRAIN_HEIGHT))
export const clampLength = (l: number) => (l === 1 ? 1 : 2)

/** World point → piece-local (x, y). */
export function toLocal(t: PlacedTerrain, x: number, y: number): [number, number] {
  const dx = x - t.x
  const dy = y - t.y
  const c = Math.cos(-t.angle)
  const s = Math.sin(-t.angle)
  return [c * dx - s * dy, s * dx + c * dy]
}

const EDGE = 1e-6

/** Is this floor point inside the piece's footprint? */
export function covers(t: PlacedTerrain, x: number, y: number): boolean {
  if (t.kind === 'post') return Math.hypot(x - t.x, y - t.y) <= (t.radius ?? 0) + EDGE
  const [lx, ly] = toLocal(t, x, y)
  const [hx, hy] = halfSize(t)
  return Math.abs(lx) <= hx + EDGE && Math.abs(ly) <= hy + EDGE
}

/** The walkable top of the piece at a floor point (mm), or null outside its footprint. */
export function topAt(t: PlacedTerrain, x: number, y: number): number | null {
  if (t.kind === 'post') return covers(t, x, y) ? (t.base ?? 0) + t.height : null
  const [lx, ly] = toLocal(t, x, y)
  const [hx, hy] = halfSize(t)
  if (Math.abs(lx) > hx + EDGE || Math.abs(ly) > hy + EDGE) return null
  const b = t.base ?? 0
  if (t.kind === 'ramp') return b + (t.height * (Math.max(-hy, Math.min(hy, ly)) + hy)) / (2 * hy)
  return b + t.height
}

/** Where the piece is solid at a floor point: [bottom, top] in mm, or null. */
export function solidAt(t: PlacedTerrain, x: number, y: number): [number, number] | null {
  const top = topAt(t, x, y)
  if (top === null) return null
  if (t.kind === 'water') return [0, WATER_FLOOR]
  const b = t.base ?? 0
  return t.kind === 'bridge' ? [b + t.height - BRIDGE_DECK, b + t.height] : [b, top]
}

/** Slope of a ramp: how much it rises per mm along its local Y, and that direction in the world. */
export function slope(t: PlacedTerrain): { rise: number; dir: [number, number] } {
  const [, hy] = halfSize(t)
  return { rise: t.kind === 'ramp' ? t.height / (2 * hy) : 0, dir: [-Math.sin(t.angle), Math.cos(t.angle)] }
}

/**
 * The surfaces at a floor point, lowest first: the floor (unless something solid stands on it
 * there) and the top of every piece covering the point.
 */
export interface SurfaceHit {
  z: number
  piece: PlacedTerrain | null
  /** the top of water (only swimmers stay on it) */
  water?: boolean
}

export function surfacesAt(pieces: PlacedTerrain[], x: number, y: number): SurfaceHit[] {
  const solids: [number, number][] = []
  const tops: SurfaceHit[] = [{ z: 0, piece: null }]
  for (const t of pieces) {
    const s = solidAt(t, x, y)
    if (!s) continue
    solids.push(s)
    // a pool: what stands in it stands on the water (swimmers), not on its bottom
    if (t.kind === 'water') tops.push({ z: WATER_LEVEL, piece: t, water: true })
    else tops.push({ z: s[1], piece: t })
  }
  // a surface with something solid right on it (a platform on the floor or on another platform,
  // a landscape tile under a platform) is not where one stands; the very bottom edge of a ramp
  // is the floor itself
  const covered = (h: SurfaceHit) => solids.some(([a, b]) => a <= h.z + EDGE && b > h.z + EDGE)
  return tops.filter((h) => !covered(h)).sort((a, b) => a.z - b.z)
}

/** The highest surface at a floor point (0 on the bare floor). */
export function topSurface(pieces: PlacedTerrain[], x: number, y: number): number {
  const s = surfacesAt(pieces, x, y)
  return s.length ? s[s.length - 1].z : 0
}

/** The surface at a floor point nearest to height `z` (where a thing at that height stands). */
export function nearestSurface(pieces: PlacedTerrain[], x: number, y: number, z: number): SurfaceHit {
  const s = surfacesAt(pieces, x, y)
  if (!s.length) return { z: 0, piece: null }
  let best = s[0]
  for (const q of s) if (Math.abs(q.z - z) < Math.abs(best.z - z)) best = q
  return best
}

/**
 * What something standing at height `z` finds under a floor point: the highest surface it can
 * reach (at most a step up). Null when nothing is below reach (it would be standing in a wall).
 */
export function supportAt(pieces: PlacedTerrain[], x: number, y: number, z: number): number | null {
  return supportHit(pieces, x, y, z)?.z ?? null
}

/** Like supportAt, with what the surface is (water or not). */
export function supportHit(pieces: PlacedTerrain[], x: number, y: number, z: number): SurfaceHit | null {
  let best: SurfaceHit | null = null
  for (const q of surfacesAt(pieces, x, y)) if (q.z <= z + STEP && (best === null || q.z > best.z)) best = q
  return best
}

/** Would something standing at height `z` be in water at this floor point? */
export const wetAt = (pieces: PlacedTerrain[], x: number, y: number, z: number) => !!supportHit(pieces, x, y, z)?.water

/**
 * Is something solid in the way at a floor point for a body from `z + STEP` up to `z + height`?
 * `reach` raises the lower limit (a point further from the body's middle may be higher on a slope).
 */
export function wallAt(pieces: PlacedTerrain[], x: number, y: number, z: number, height: number, reach = 0): boolean {
  const lo = z + STEP + reach
  const hi = z + height
  for (const t of pieces) {
    const s = solidAt(t, x, y)
    if (s && s[1] > lo + EDGE && s[0] < hi - EDGE) return true
  }
  return false
}

/** Where a round body stands and how it leans: its height and its pitch/roll (radians). */
export interface Stance {
  z: number
  pitch: number
  roll: number
  /** it would drive into a wall there */
  blocked: boolean
  /** the ground is more than a step below: it falls */
  falling: boolean
  /** it stands (floats) on water */
  wet?: boolean
}

/**
 * A round body (radius `r`, height `h`) standing at (x, y) facing `theta`, coming from height `z`:
 * is the way free, where does it stand, how does it lean. `centerX` shifts the body's middle
 * forward of (x, y) (a robot's wheels are not under its middle).
 */
export function stance(
  pieces: PlacedTerrain[],
  x: number,
  y: number,
  theta: number,
  z: number,
  r: number,
  h: number,
  centerX = 0,
  prev?: { x: number; y: number; theta: number },
  swim = false
): Stance {
  const frame = (px: number, py: number, th: number) => {
    const c = Math.cos(th)
    const s = Math.sin(th)
    return (fx: number, fy: number): [number, number] => [px + c * fx - s * fy, py + s * fx + c * fy]
  }
  const at = frame(x, y, theta)
  const before = prev ? frame(prev.x, prev.y, prev.theta) : null
  if (pieces.length === 0) return { z: 0, pitch: 0, roll: 0, blocked: false, falling: z > STEP }
  const [mx, my] = at(0, 0)
  const ground = supportAt(pieces, mx, my, z)
  if (ground === null) return { z, pitch: 0, roll: 0, blocked: true, falling: false }
  // one who cannot swim never stands in water (put there by "go to" or in the editor, it stays put)
  if (!swim && wetAt(pieces, mx, my, z)) return { z, pitch: 0, roll: 0, blocked: true, falling: false }
  // the rim: nothing solid may come in the way of the body; on a slope a rim point may be as
  // much higher as a climbable slope rises over its distance from the middle. Only walls a rim
  // point runs into count: one it already touched before this move (falling past an edge, turning
  // beside the platform it fell off) does not hold it
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    const fx = centerX + r * 0.92 * Math.cos(a)
    const fy = r * 0.92 * Math.sin(a)
    const reach = CLIMB * Math.hypot(fx, fy)
    const [px, py] = at(fx, fy)
    // water is a wall too for those who cannot swim
    const hit = (qx: number, qy: number) => wallAt(pieces, qx, qy, z, h, reach) || (!swim && wetAt(pieces, qx, qy, z + reach))
    if (!hit(px, py)) continue
    if (before) {
      const [qx, qy] = before(fx, fy)
      if (hit(qx, qy)) continue
    }
    return { z, pitch: 0, roll: 0, blocked: true, falling: false }
  }
  // how it leans: the ground ahead/behind and left/right
  const d = r * 0.7
  const g = (fx: number, fy: number) => {
    const [px, py] = at(fx, fy)
    return supportAt(pieces, px, py, ground + CLIMB * Math.hypot(fx, fy)) ?? ground
  }
  const front = g(d, 0)
  const back = g(-d, 0)
  const left = g(0, d)
  const right = g(0, -d)
  const lean = (a: number, b: number) => {
    const v = Math.atan2(a - b, 2 * d)
    return Math.abs(v) < 0.7 ? v : 0
  }
  const falling = ground < z - FOLLOW
  const wet = !!supportHit(pieces, mx, my, z)?.water
  return { z: ground, pitch: lean(front, back), roll: lean(left, right), blocked: false, falling, wet }
}

/** Pieces from the parameters stored on nodes. */
export function placedTerrain(id: string, p: TerrainParams | undefined, x: number, y: number, angle: number, base = 0): PlacedTerrain {
  const q = { ...DEFAULT_TERRAIN[p?.kind ?? 'platform'], ...(p ?? {}) }
  if (q.kind === 'ground') {
    const surface = SURFACES.includes(q.surface as Surface) ? q.surface : 'grass'
    const line = surface === 'road' && TILE_KINDS.includes(q.line as TileKind) ? (q.line as TileKind) : null
    return { id, kind: 'ground', x, y, angle, height: GROUND_HEIGHT, length: 1, surface, line }
  }
  if (q.kind === 'water') return { id, kind: 'water', x, y, angle, height: WATER_LEVEL, length: 1 }
  return {
    id,
    kind: q.kind,
    x,
    y,
    angle,
    height: clampHeight(q.height),
    length: q.kind === 'ramp' ? clampLength(q.length ?? 2) : 1,
    base: Number.isFinite(base) && base > 0 ? base : 0
  }
}

/**
 * Points of a piece's footprint that what it stands on is looked up at: the middle of each of its
 * cells (a long ramp has two).
 */
export function footprintPoints(t: Pick<PlacedTerrain, 'kind' | 'x' | 'y' | 'angle' | 'length'>): [number, number][] {
  if (t.kind !== 'ramp' || t.length !== 2) return [[t.x, t.y]]
  const d = TILE_SIZE / 2
  const dx = -Math.sin(t.angle) * d
  const dy = Math.cos(t.angle) * d
  return [
    [t.x - dx, t.y - dy],
    [t.x + dx, t.y + dy]
  ]
}

/** The parameters a piece is stored with: landscape tiles keep their top and line, the rest their height (and a ramp its length). */
export function normTerrain(p: TerrainParams): TerrainParams {
  const t = placedTerrain('', p, 0, 0, 0)
  if (t.kind === 'ground') return { kind: 'ground', height: GROUND_HEIGHT, surface: t.surface, ...(t.line ? { line: t.line } : {}) }
  if (t.kind === 'water') return { kind: 'water', height: WATER_LEVEL }
  return { kind: t.kind as TerrainKind, height: t.height, ...(t.kind === 'ramp' ? { length: t.length } : {}) }
}

/**
 * Snap a piece's centre to the tile grid: its footprint covers whole cells. `angle` in radians
 * (multiples of 90°); a ramp two tiles long has its centre on a cell edge along its length.
 */
export function snapTerrain(x: number, y: number, angle: number, length: number): [number, number] {
  const cell = (v: number) => Math.floor(v / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2
  const edge = (v: number) => Math.round(v / TILE_SIZE) * TILE_SIZE
  if (length !== 2) return [cell(x), cell(y)]
  const alongY = Math.abs(Math.cos(angle)) > 0.5
  return alongY ? [cell(x), edge(y)] : [edge(x), cell(y)]
}

/**
 * Where a piece's centre goes when it is turned from `from` to `to` (radians): a two-tile ramp
 * turns around its high cell (so turning it four times brings it back); the rest stay put.
 */
export function turnedCentre(x: number, y: number, from: number, to: number, length: number): [number, number] {
  if (length !== 2) return snapTerrain(x, y, to, length)
  const off = TILE_SIZE / 2
  const hx = x - Math.sin(from) * off
  const hy = y + Math.cos(from) * off
  return snapTerrain(hx + Math.sin(to) * off, hy - Math.cos(to) * off, to, length)
}
