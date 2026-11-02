/**
 * A static shape of the robotics field (a model brought from the 3D tab and marked «Static»): it
 * does not move, and robots and heroes go over it like over terrain — they drive or walk onto it
 * where it is low or gently sloped, stop at its sides, pass under an arch of it.
 *
 * For the walking rules the shape becomes a grid of vertical columns over its footprint: in each
 * cell, where a vertical line through the cell's middle is inside the shape — a list of
 * [bottom, top] spans (more than one under an overhang). The grid is built once per mesh and pose
 * from the triangles (each triangle marks the cells whose middles it covers, at its height there)
 * and kept in a small cache, since the field's terrain is asked for on every edit.
 */
import { Matrix4, Vector3 } from 'three'
import type { MeshData, Transform } from '../doc/model'
import { transformMatrix } from '../doc/model'

export interface SolidGrid {
  /** the corner of the grid (its lowest x and y) and the cell size, mm */
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  /** per cell (index i + j·nx): spans [bottom, top, bottom, top, …] from low to high; null: empty */
  spans: (Float32Array | null)[]
  /** the highest point and the lowest of the whole shape, mm */
  top: number
  bottom: number
  /** the triangles in world coordinates (the physics engine's fixed collider) */
  positions: Float32Array
  indices: Uint32Array
}

/** at most this many cells along a side (a big model gets bigger cells) */
const MAX_CELLS = 160
/** cells at least this size, mm */
const MIN_CELL = 3
/** crossings closer than this are one (a vertex or an edge two triangles share), mm */
const SAME = 1e-4

export function buildSolidGrid(mesh: MeshData, m: Matrix4): SolidGrid {
  const v = mesh.vertices
  const n = v.length / 3
  const pos = new Float32Array(v.length)
  const p = new Vector3()
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let top = -Infinity
  let bottom = Infinity
  for (let i = 0; i < n; i++) {
    p.set(v[3 * i], v[3 * i + 1], v[3 * i + 2]).applyMatrix4(m)
    pos[3 * i] = p.x
    pos[3 * i + 1] = p.y
    pos[3 * i + 2] = p.z
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
    top = Math.max(top, p.z)
    bottom = Math.min(bottom, p.z)
  }
  const indices = Uint32Array.from(mesh.triangles)
  const empty = (): SolidGrid => ({ x0: 0, y0: 0, cell: 1, nx: 0, ny: 0, spans: [], top: 0, bottom: 0, positions: pos, indices })
  if (!n || !Number.isFinite(x0)) return empty()
  const cell = Math.max(MIN_CELL, Math.max(x1 - x0, y1 - y0) / MAX_CELLS)
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell))
  const ny = Math.max(1, Math.ceil((y1 - y0) / cell))
  const hits: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = 3 * indices[t]
    const b = 3 * indices[t + 1]
    const c = 3 * indices[t + 2]
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    // an upright triangle has no area seen from above: the columns go past it
    if (Math.abs(d) < 1e-12) continue
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell - 0.5))
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell - 0.5))
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / cell - 0.5))
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - y0) / cell - 0.5))
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * cell
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell
        // barycentric coordinates of the cell's middle; a middle on an edge two triangles share
        // is hit by both at the same height, and the two hits are merged below
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
        const l3 = 1 - l1 - l2
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
        hits[i + j * nx].push(l1 * az + l2 * bz + l3 * cz)
      }
    }
  }
  const spans: (Float32Array | null)[] = hits.map((h) => {
    if (!h.length) return null
    h.sort((q, r) => q - r)
    const z: number[] = []
    for (const q of h) if (!z.length || q - z[z.length - 1] > SAME) z.push(q)
    // in and out of the shape in turn; a broken (not closed) mesh: one span from lowest to highest
    if (z.length % 2 || z.length < 2) return Float32Array.of(z[0], z[z.length - 1])
    return Float32Array.from(z)
  })
  return { x0, y0, cell, nx, ny, spans, top, bottom, positions: pos, indices }
}

/** The spans [bottom, top] where the shape is solid on the vertical line through (x, y). */
export function gridSpans(g: SolidGrid, x: number, y: number): [number, number][] {
  const i = Math.floor((x - g.x0) / g.cell)
  const j = Math.floor((y - g.y0) / g.cell)
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return []
  const s = g.spans[i + j * g.nx]
  if (!s) return []
  const out: [number, number][] = []
  for (let k = 0; k + 1 < s.length; k += 2) if (s[k + 1] - s[k] > 0.01) out.push([s[k], s[k + 1]])
  return out
}

const cache = new Map<string, SolidGrid>()
const CACHE = 24

/** The grid of a mesh at a pose (cached: the same mesh at the same place is built once). */
export function solidGridOf(meshId: string, mesh: MeshData, t: Transform): SolidGrid {
  const key = `${meshId}|${t.position.join(',')}|${t.rotation.join(',')}|${t.scale.join(',')}`
  let g = cache.get(key)
  if (g) {
    cache.delete(key)
    cache.set(key, g)
    return g
  }
  g = buildSolidGrid(mesh, transformMatrix(t))
  cache.set(key, g)
  while (cache.size > CACHE) cache.delete(cache.keys().next().value as string)
  return g
}
