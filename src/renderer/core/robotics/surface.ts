/**
 * What a hero stands on (and what is in front of it): the heroes "know" the ground under their
 * feet — grass, sand, stone, road, water, the bare floor, a platform, a ramp, a bridge, a track
 * tile, a rock, a tree or a bush (a bird perching) — or that they are in the air. The robot has
 * no such sense: it only has its sensors (its line sensor tells the surfaces apart by brightness).
 */
import { type PlacedTerrain, STEP, nearestSurface, supportHit, surfacesAt } from './terrain'
import { type PlacedTile, tileSurface } from './sensors'
import { TILE_SIZE } from './tiles'

export type SurfaceKind = 'grass' | 'sand' | 'stone' | 'road' | 'water' | 'floor' | 'platform' | 'ramp' | 'bridge' | 'track' | 'rock' | 'tree' | 'bush' | 'air'

/** in the order the block menus show them */
export const SURFACE_KINDS: SurfaceKind[] = ['grass', 'sand', 'stone', 'road', 'water', 'floor', 'platform', 'ramp', 'bridge', 'track', 'rock', 'tree', 'bush', 'air']

/** a tile counts as lying on a surface this close to it, mm */
const LEVEL = 20

/** Is a track tile (not a road's own line) lying at this point on the surface at height `z`? */
function trackAt(tiles: PlacedTile[], x: number, y: number, z: number): boolean {
  const h = TILE_SIZE / 2
  for (const t of tiles) {
    // a road's line is part of the road tile (it has its paper shade); track tiles have none
    if (t.paper !== undefined) continue
    const dx = x - t.x
    const dy = y - t.y
    const c = Math.cos(-t.angle)
    const s = Math.sin(-t.angle)
    if (Math.abs(c * dx - s * dy) > h || Math.abs(s * dx + c * dy) > h) continue
    if (Math.abs(tileSurface(t, x, y) - z) <= LEVEL) return true
  }
  return false
}

/** What a surface piece (null: the floor) is. */
function kindOf(piece: PlacedTerrain | null): SurfaceKind {
  if (!piece) return 'floor'
  switch (piece.kind) {
    case 'water':
      return 'water'
    case 'ground':
      return piece.surface ?? 'grass'
    case 'post':
      // a bird may perch on a tree or a bush
      return piece.decor === 'rock' ? 'rock' : piece.decor === 'bush' ? 'bush' : 'tree'
    default:
      return piece.kind
  }
}

/**
 * What one standing at height `z` at a floor point stands on: the highest surface within a step
 * of its feet (the one it would stand on there); with nothing that low — a wall in front — the
 * surface nearest to that height (the platform it is facing).
 */
export function surfaceAt(terrain: PlacedTerrain[], tiles: PlacedTile[], x: number, y: number, z: number): SurfaceKind {
  const hit = supportHit(terrain, x, y, z) ?? nearestSurface(terrain, x, y, z)
  if (!hit.water && trackAt(tiles, x, y, hit.z)) return 'track'
  return kindOf(hit.piece)
}

/** The topmost surface at a floor point (what a flier sees below it). */
export function topSurfaceAt(terrain: PlacedTerrain[], tiles: PlacedTile[], x: number, y: number): SurfaceKind {
  const s = surfacesAt(terrain, x, y)
  const top = s[s.length - 1] ?? { z: 0, piece: null }
  if (!top.water && trackAt(tiles, x, y, top.z)) return 'track'
  return kindOf(top.piece)
}

/** how high above the ground under it a flier counts as in the air, mm */
export const IN_AIR = STEP * 2
