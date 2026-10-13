/**
 * Laying landscape tiles: one per grid cell. Painting a cell lays a tile there, or changes the
 * one that is there (grass to water and so on); erasing takes it away. Cells under a platform,
 * ramp or bridge are left alone (what the piece stands on stays as it is).
 */
import type { Doc, PrimNode } from '../doc/model'
import { addNodes, removeNodes, updateNodes } from '../doc/ops'
import { terrainNode } from './demo'
import { LAND_COLOR, type LandKind, RELIEF_KINDS, covers, isLand, landKindOf, landParams, normTerrain, placedTerrain, snapTerrain } from './terrain'
import { TILE_SIZE } from './tiles'

/** The landscape tile on the cell of a floor point, if any. */
export function landAt(doc: Doc, x: number, y: number): PrimNode | null {
  const [cx, cy] = snapTerrain(x, y, 0, 1)
  for (const n of doc.nodes) {
    if (n.kind !== 'prim' || n.prim !== 'terrain' || !n.params.terrain || !isLand(n.params.terrain.kind)) continue
    const [px, py] = n.transform.position
    if (Math.abs(px - cx) < 1 && Math.abs(py - cy) < 1) return n
  }
  return null
}

/** Is the cell of this floor point under a platform, ramp or bridge? */
function underRelief(doc: Doc, x: number, y: number): boolean {
  const [cx, cy] = snapTerrain(x, y, 0, 1)
  return doc.nodes.some((n) => {
    if (n.kind !== 'prim' || n.prim !== 'terrain' || !n.params.terrain || !RELIEF_KINDS.includes(n.params.terrain.kind)) return false
    const t = placedTerrain(n.id, n.params.terrain, n.transform.position[0], n.transform.position[1], (n.transform.rotation[2] * Math.PI) / 180)
    return covers(t, cx, cy)
  })
}

/**
 * Lay (or change) a landscape tile of `kind` on the cell of a floor point, or with `kind` null take
 * the tile there away. `name` names a new tile. Returns the same document when nothing changes,
 * and the id of the tile laid or changed.
 */
export function paintLand(
  doc: Doc,
  x: number,
  y: number,
  kind: LandKind | null,
  name: () => string,
  /** the word a tile's name starts with («Трава 3»): a changed tile with such a name is renamed */
  label?: (k: LandKind) => string
): { doc: Doc; id: string | null } {
  const here = landAt(doc, x, y)
  if (underRelief(doc, x, y)) return { doc, id: here?.id ?? null }
  if (kind === null) return here ? { doc: removeNodes(doc, [here.id]), id: null } : { doc, id: null }
  if (here) return { doc: changeLand(doc, here.id, kind, label), id: here.id }
  const [cx, cy] = snapTerrain(x, y, 0, 1)
  const p = landParams(kind)
  const n = terrainNode(p.kind, cx, cy, 0, name(), p)
  return { doc: addNodes(doc, [n]), id: n.id }
}

/**
 * Make landscape tile `id` another kind (a road keeps its line while it stays a road; a tile named
 * after its kind, «Трава 3», is renamed). Returns the same document when nothing changes.
 */
export function changeLand(doc: Doc, id: string, kind: LandKind, label?: (k: LandKind) => string): Doc {
  const here = doc.nodes.find((n) => n.id === id)
  if (!here || here.kind !== 'prim' || !here.params.terrain || !isLand(here.params.terrain.kind)) return doc
  if (landKindOf(here.params.terrain) === kind) return doc
  const cur = here.params.terrain
  const old = label?.(landKindOf(cur)!)
  const name = old && here.name.startsWith(old) ? label!(kind) + here.name.slice(old.length) : here.name
  const terrain = normTerrain({ ...landParams(kind), line: cur.line })
  return updateNodes(doc, [id], (n) => (n.kind === 'prim' ? { ...n, name, color: LAND_COLOR[kind], params: { ...n.params, terrain } } : n))
}

/**
 * One landscape tile per cell: when an edit puts a tile on a cell that already has one (a copy
 * made in place, a tile pasted or dragged onto another), the tile that came or moved there stays
 * and the one that was there goes. Returns `next` itself when nothing has to go.
 */
export function oneLandPerCell(prev: Doc, next: Doc): Doc {
  const cells = new Map<string, PrimNode[]>()
  let crowded = false
  for (const n of next.nodes) {
    if (n.kind !== 'prim' || n.prim !== 'terrain' || !n.params.terrain || !isLand(n.params.terrain.kind)) continue
    const key = cellAt(n.transform.position[0], n.transform.position[1]).join(',')
    const list = cells.get(key)
    if (list) {
      list.push(n)
      crowded = true
    } else cells.set(key, [n])
  }
  if (!crowded) return next
  const old = new Map(prev.nodes.map((n) => [n.id, n]))
  const drop = new Set<string>()
  for (const list of cells.values()) {
    if (list.length < 2) continue
    // the newest arrival: a node that is new or was changed by this edit (the last such one)
    const came = list.filter((n) => old.get(n.id) !== n)
    const keep = came.length ? came[came.length - 1] : list[list.length - 1]
    for (const n of list) if (n !== keep) drop.add(n.id)
  }
  return { ...next, nodes: next.nodes.filter((n) => !drop.has(n.id)) }
}

// ---------------------------------------------------------------- many cells at once

/** A grid cell by its indices (cell i spans i·TILE_SIZE … (i+1)·TILE_SIZE). */
export type Cell = [number, number]
export const cellAt = (x: number, y: number): Cell => [Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)]
const centre = (c: number) => c * TILE_SIZE + TILE_SIZE / 2
/** a rectangle or a line covers at most this many cells along a side (a slip of the mouse far away) */
export const MAX_SPAN = 40

const clampSpan = (a: Cell, b: Cell): Cell => [
  a[0] + Math.max(-MAX_SPAN + 1, Math.min(MAX_SPAN - 1, b[0] - a[0])),
  a[1] + Math.max(-MAX_SPAN + 1, Math.min(MAX_SPAN - 1, b[1] - a[1]))
]

/** Every cell of the rectangle with corners `a` and `b`. */
export function rectCells(a: Cell, to: Cell): Cell[] {
  const b = clampSpan(a, to)
  const out: Cell[] = []
  for (let i = Math.min(a[0], b[0]); i <= Math.max(a[0], b[0]); i++)
    for (let j = Math.min(a[1], b[1]); j <= Math.max(a[1], b[1]); j++) out.push([i, j])
  return out
}

/**
 * The cells of a straight line from `a` to `b`, each step to a side neighbour (never only
 * corner to corner), so a road drawn slantwise has no gaps.
 */
export function lineCells(a: Cell, to: Cell): Cell[] {
  const b = clampSpan(a, to)
  const dx = Math.abs(b[0] - a[0])
  const dy = Math.abs(b[1] - a[1])
  const sx = b[0] > a[0] ? 1 : -1
  const sy = b[1] > a[1] ? 1 : -1
  let [x, y] = a
  let err = dx - dy
  const out: Cell[] = [[x, y]]
  while (x !== b[0] || y !== b[1]) {
    if (2 * err > -dy) {
      err -= dy
      x += sx
    } else {
      err += dx
      y += sy
    }
    out.push([x, y])
  }
  return out
}

/**
 * Paint (or with `kind` null erase) many cells in one go — like `paintLand` cell by cell, but
 * the document is looked through once. `name(k)` names the k-th new tile.
 */
export function paintCells(doc: Doc, cells: Cell[], kind: LandKind | null, name: (k: number) => string, label?: (k: LandKind) => string): Doc {
  const land = new Map<string, PrimNode>()
  const relief: ReturnType<typeof placedTerrain>[] = []
  for (const n of doc.nodes) {
    if (n.kind !== 'prim' || n.prim !== 'terrain' || !n.params.terrain) continue
    const [px, py] = n.transform.position
    if (isLand(n.params.terrain.kind)) land.set(cellAt(px, py).join(','), n)
    else if (RELIEF_KINDS.includes(n.params.terrain.kind)) relief.push(placedTerrain(n.id, n.params.terrain, px, py, (n.transform.rotation[2] * Math.PI) / 180))
  }
  const remove = new Set<string>()
  const change = new Map<string, PrimNode>()
  const add: PrimNode[] = []
  const seen = new Set<string>()
  for (const c of cells) {
    const key = c.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    const here = land.get(key)
    // a platform, ramp or bridge stands here: its ground stays as it is
    if (relief.some((t) => covers(t, centre(c[0]), centre(c[1])))) continue
    if (kind === null) {
      if (here) remove.add(here.id)
      continue
    }
    if (here) {
      if (landKindOf(here.params.terrain) === kind) continue
      const cur = here.params.terrain!
      const was = landKindOf(cur)!
      const old = label?.(was)
      change.set(here.id, {
        ...here,
        name: old && here.name.startsWith(old) ? label!(kind) + here.name.slice(old.length) : here.name,
        color: LAND_COLOR[kind],
        params: { ...here.params, terrain: normTerrain({ ...landParams(kind), line: cur.line }) }
      })
      continue
    }
    const x = centre(c[0])
    const y = centre(c[1])
    const p = landParams(kind)
    add.push(terrainNode(p.kind, x, y, 0, name(add.length), p))
  }
  if (!remove.size && !change.size && !add.length) return doc
  let nodes = doc.nodes.filter((n) => !remove.has(n.id)).map((n) => change.get(n.id) ?? n)
  if (add.length) nodes = [...nodes, ...add]
  return { ...doc, nodes }
}
