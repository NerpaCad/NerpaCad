/**
 * Track tiles: 300 × 300 mm squares, white with a 20 mm black line. The line shapes are defined
 * here once and used both to draw the tile pictures and by the line sensor.
 *
 * Tile-local coordinates: origin in the tile centre, X to the right, Y up (away from the viewer
 * in the default top view), in mm, before the tile's own rotation.
 */
import type { TileKind } from '../doc/model'

export const TILE_SIZE = 300
export const LINE_WIDTH = 20
/** thickness of the tile slab */
export const TILE_THICKNESS = 0.4
export const TILE_KINDS: TileKind[] = ['straight', 'turn', 'cross']

const H = TILE_SIZE / 2
const W = LINE_WIDTH / 2

/**
 * Is this tile-local point on the black line?
 * - straight: along the tile's Y axis through the centre;
 * - cross: straight plus the same line along X;
 * - turn: a quarter circle (radius 150 around the corner (+150, −150)) joining the middle of the
 *   bottom edge to the middle of the right edge.
 */
export function onLine(kind: TileKind, x: number, y: number): boolean {
  if (Math.abs(x) > H || Math.abs(y) > H) return false
  switch (kind) {
    case 'straight':
      return Math.abs(x) <= W
    case 'cross':
      return Math.abs(x) <= W || Math.abs(y) <= W
    case 'turn':
      return Math.abs(Math.hypot(x - H, y + H) - H) <= W
  }
}

/** Draw the tile picture into a 2D canvas context of size `px` × `px` (top of the image = +Y). */
export function drawTile(g: CanvasRenderingContext2D, kind: TileKind, px: number, line = '#111111', paper = '#ffffff', border = true): void {
  const k = px / TILE_SIZE
  // tile (x, y) → canvas (u, v)
  const u = (x: number) => (x + H) * k
  const v = (y: number) => (H - y) * k
  g.fillStyle = paper
  g.fillRect(0, 0, px, px)
  g.fillStyle = line
  g.strokeStyle = line
  if (kind === 'straight' || kind === 'cross') g.fillRect(u(-W), 0, LINE_WIDTH * k, px)
  if (kind === 'cross') g.fillRect(0, v(W), px, LINE_WIDTH * k)
  if (kind === 'turn') {
    g.lineWidth = LINE_WIDTH * k
    g.beginPath()
    // centre (+H, −H) in tile coords = canvas (px, px); from the bottom edge middle to the right edge middle
    g.arc(u(H), v(-H), H * k, Math.PI, Math.PI * 1.5)
    g.stroke()
  }
  // thin border so tiles read as tiles
  if (!border) return
  g.strokeStyle = 'rgba(0,0,0,0.18)'
  g.lineWidth = Math.max(1, px / 300)
  g.strokeRect(0.5, 0.5, px - 1, px - 1)
}
