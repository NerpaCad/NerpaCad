/** Editing the robotics field over its terrain: things put down stand on the highest surface there. */
import type { Doc, DocNode, PrimNode } from '../doc/model'
import { updateNodes } from '../doc/ops'
import { isStaticShape, terrainOf } from './world'
import { GROUND_HEIGHT, type PlacedTerrain, RELIEF_KINDS, footprintPoints, nearestSurface, placedTerrain, snapTerrain, topAt, topSurface, turnedCentre } from './terrain'
import { TILE_SIZE } from './tiles'

/** Things that stand on the ground (lamps hang in the air; terrain stands on the floor). */
const stands = (n: DocNode) => n.kind === 'prim' && ['tile', 'robot', 'nerpa', 'decor'].includes(n.prim)
const standsOrShape = (n: DocNode) => stands(n) || (n.kind !== 'prim' ? true : !['light', 'terrain'].includes(n.prim))

/** A platform, ramp or bridge (built on what is under it; landscape tiles are the floor itself). */
const isRelief = (n: DocNode): n is PrimNode => n.kind === 'prim' && n.prim === 'terrain' && RELIEF_KINDS.includes(n.params.terrain?.kind ?? 'platform')
const pieceOf = (n: PrimNode, z = n.transform.position[2]): PlacedTerrain =>
  placedTerrain(n.id, n.params.terrain, n.transform.position[0], n.transform.position[1], (n.transform.rotation[2] * Math.PI) / 180, z)
const withZ = (n: DocNode, z: number): DocNode =>
  Math.abs(n.transform.position[2] - z) < 1e-6 ? n : { ...n, transform: { ...n.transform, position: [n.transform.position[0], n.transform.position[1], z] } }
/** relief nodes from the bottom tier up */
const byLevel = (a: DocNode, b: DocNode) => a.transform.position[2] - b.transform.position[2]

/**
 * The field as relief is built on it: every landscape tile — water too — is ground of the same
 * height, so a ramp, platform or bridge stands as high on a pond as on the grass next to it.
 */
const asBuiltOn = (terrain: PlacedTerrain[]): PlacedTerrain[] =>
  terrain.map((t) => (t.kind === 'water' ? { ...t, kind: 'ground', height: GROUND_HEIGHT } : t))

/** The highest surface under any of a piece's cells: what a new piece is built on. */
function highestUnder(terrain: PlacedTerrain[], t: PlacedTerrain): number {
  const on = asBuiltOn(terrain)
  return Math.max(0, ...footprintPoints(t).map(([x, y]) => topSurface(on, x, y)))
}

/** The surface under a piece's cells nearest to height `z` (a moved piece keeps its tier). */
function nearestUnder(terrain: PlacedTerrain[], t: PlacedTerrain, z: number): number {
  const on = asBuiltOn(terrain)
  return Math.max(0, ...footprintPoints(t).map(([x, y]) => nearestSurface(on, x, y, z).z))
}

/**
 * Put `ids` on the terrain under their position (terrain they are not part of). New things
 * (no `base`) go on the highest surface there. Things moved from where they were in `base` keep to
 * their level: on the surface nearest to the height they had (a robot dragged along the floor
 * under a bridge stays on the floor, one dragged from a platform onto a bridge goes onto it); what
 * was resting on something else (a box on a box) keeps its height. Without terrain nothing changes.
 */
export function standOnTerrain(d: Doc, ids: string[], base?: Doc): Doc {
  const moving = new Set(ids)
  const fixedTerrain = (doc: Doc) => terrainOf({ ...doc, nodes: doc.nodes.filter((n) => !moving.has(n.id)) })
  const terrain = fixedTerrain(d)
  const before = base ? fixedTerrain(base) : []
  // platforms, ramps and bridges first, from the bottom tier up: each is built on what is under it
  // (a new one on the highest surface, a moved one on the surface nearest to its tier)
  const relief = d.nodes.filter((n) => moving.has(n.id) && isRelief(n)).sort(byLevel) as PrimNode[]
  if (relief.length) {
    const placed = new Map<string, number>()
    for (const n of relief) {
      const old = base?.nodes.find((o) => o.id === n.id)
      const t = pieceOf(n, 0)
      const z = old ? nearestUnder(terrain, t, old.transform.position[2]) : highestUnder(terrain, t)
      placed.set(n.id, z)
      terrain.push(pieceOf(n, z))
    }
    d = updateNodes(d, [...placed.keys()], (n) => withZ(n, placed.get(n.id)!))
  }
  if (!terrain.length && !before.length) return d
  return updateNodes(d, ids, (n) => {
    if (!standsOrShape(n)) return n
    const [x, y, z] = n.transform.position
    const old = base?.nodes.find((o) => o.id === n.id)
    let top: number
    if (old) {
      const [ox, oy, oz] = old.transform.position
      if (Math.abs(nearestSurface(before, ox, oy, oz).z - oz) > 1) return n
      top = nearestSurface(terrain, x, y, oz).z
    } else top = topSurface(terrain, x, y)
    return top === z ? n : { ...n, transform: { ...n.transform, position: [x, y, top] } }
  })
}

/** The highest surface of the field at a floor point, mm. */
export const surfaceOf = (d: Doc, x: number, y: number): number => topSurface(terrainOf(d), x, y)

/** what the field's surfaces are made of: terrain pieces and static shapes */
const terrainNodes = (d: Doc) => d.nodes.filter((n) => (n.kind === 'prim' && n.prim === 'terrain') || isStaticShape(d, n))

/**
 * After terrain changed (a piece added, moved, turned, made taller, removed), whatever stood on
 * the field stays on its surface: on the piece it stood on (following its new height or slope)
 * while that piece is still under it, otherwise on the surface nearest to where it was. Things
 * that were not standing on a surface (a box on another box) are left alone.
 * Returns `next` itself when no terrain changed.
 */
export function settleOnTerrain(prev: Doc, next: Doc): Doc {
  const a = terrainNodes(prev)
  const b = terrainNodes(next)
  if (a.length === b.length && a.every((n, i) => n === b[i])) return next
  next = settleTiers(prev, next)
  const was0 = terrainOf(prev)
  const now0 = terrainOf(next)
  const ids = next.nodes.filter((n) => standsOrShape(n)).map((n) => n.id)
  if (!ids.length) return next
  return updateNodes(next, ids, (n) => {
    const [x, y, z] = n.transform.position
    // a static shape stands on the rest, not on itself
    const own = (list: PlacedTerrain[]) => (n.fixed ? list.filter((t) => t.id !== n.id) : list)
    const before = own(was0)
    const after = own(now0)
    const stood = nearestSurface(before, x, y, z)
    // something resting on something else (a box on a box) is left where it is
    if (Math.abs(stood.z - z) > 1) return n
    const was = stood.piece
    const same = was && after.find((t) => t.id === was.id)
    const on = same ? topAt(same, x, y) : null
    const top = on ?? nearestSurface(after, x, y, z).z
    return Math.abs(top - z) < 1e-6 ? n : { ...n, transform: { ...n.transform, position: [x, y, top] } }
  })
}

/**
 * Pieces built on other pieces follow them, tier by tier from the bottom: a platform on a platform
 * that was made taller goes up with it, one whose support was taken away comes down onto what is
 * under it now. A piece that was not standing on anything it could find is left where it is.
 */
function settleTiers(prev: Doc, next: Doc): Doc {
  const relief = next.nodes.filter(isRelief).sort(byLevel) as PrimNode[]
  if (!relief.length) return next
  const reliefIds = new Set(relief.map((n) => n.id))
  // the landscape (the floor itself) does not move; the relief is laid on it tier by tier
  const land = asBuiltOn(terrainOf({ ...next, nodes: next.nodes.filter((n) => !reliefIds.has(n.id)) }))
  const before = asBuiltOn(terrainOf(prev))
  const placed: PlacedTerrain[] = [...land]
  const out = new Map<string, number>()
  for (const n of relief) {
    const z = n.transform.position[2]
    const t = pieceOf(n, 0)
    const others = before.filter((p) => p.id !== n.id)
    let nz = z
    // on the floor or on the landscape (a piece built on a pond before it counted as ground stood
    // a little lower): laid on the landscape again; higher up it follows what it stood on
    if (z > GROUND_HEIGHT + 1) {
      // what it stood on before, cell by cell; where that piece is still there, on its new top
      const stood = footprintPoints(t).map(([x, y]) => ({ x, y, hit: nearestSurface(others, x, y, z) }))
      if (stood.some((s) => Math.abs(s.hit.z - z) <= 1)) {
        nz = Math.max(
          0,
          ...stood.map(({ x, y, hit }) => {
            const same = hit.piece && Math.abs(hit.z - z) <= 1 ? placed.find((p) => p.id === hit.piece!.id) : undefined
            return (same && topAt(same, x, y)) ?? nearestSurface(placed, x, y, z).z
          })
        )
      }
    } else {
      // on the floor: a landscape tile laid under it later lifts it onto the tile, one taken away
      // lets it down
      nz = Math.max(0, ...footprintPoints(t).map(([x, y]) => nearestSurface(placed, x, y, z).z))
    }
    if (Math.abs(nz - z) > 1e-6) out.set(n.id, nz)
    placed.push(pieceOf(n, nz))
  }
  return out.size ? updateNodes(next, [...out.keys()], (n) => withZ(n, out.get(n.id)!)) : next
}

/**
 * After terrain pieces were turned: each stays on the grid. Turned on its own, a two-tile ramp
 * swings around its high cell. Turned together around `pivot` (several things at once), each piece
 * goes around the pivot with the rest: its high cell (the middle of a one-tile piece) is carried
 * around, and the piece is laid from there.
 */
export function turnTerrainPieces(before: Doc, d: Doc, ids: string[], pivot?: [number, number]): Doc {
  const rad = (v: number) => (v * Math.PI) / 180
  return updateNodes(d, ids, (n) => {
    const old = before.nodes.find((x) => x.id === n.id)
    if (n.kind !== 'prim' || n.prim !== 'terrain' || !old) return n
    const len = n.params.terrain?.kind === 'ramp' ? (n.params.terrain.length ?? 2) : 1
    const from = rad(old.transform.rotation[2])
    const to = rad(n.transform.rotation[2])
    const [x, y] = old.transform.position
    let c: [number, number]
    if (!pivot) c = turnedCentre(x, y, from, to, len)
    else {
      const off = len === 2 ? TILE_SIZE / 2 : 0
      const hx = x - Math.sin(from) * off - pivot[0]
      const hy = y + Math.cos(from) * off - pivot[1]
      const a = to - from
      const nx = pivot[0] + Math.cos(a) * hx - Math.sin(a) * hy
      const ny = pivot[1] + Math.sin(a) * hx + Math.cos(a) * hy
      c = snapTerrain(nx + Math.sin(to) * off, ny - Math.cos(to) * off, to, len)
    }
    return { ...n, transform: { ...n.transform, position: [c[0], c[1], n.transform.position[2]] } }
  })
}
