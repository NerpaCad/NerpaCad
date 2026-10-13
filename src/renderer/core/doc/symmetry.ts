/**
 * Symmetry mode of the 3D scene. While it is on for the ZY plane (x → −x) and/or the ZX plane
 * (y → −y), every shape has linked mirror twins: whatever is done to the shape or to a twin is
 * mirrored to the others. Turning the mode off leaves the twins as ordinary shapes.
 *
 * Twins are ordinary nodes with `mirrorOf = { id, m }` and a derived id (`<id>~x`), so the same
 * twin keeps its id across edits, undo and saving. `syncSymmetry` brings a document in line after
 * any change: it is run by the store on every commit and on every step of a drag.
 */
import type { Doc, DocNode, Transform, Vec3 } from './model'
import { cleanNum, findNode } from './model'

/** x: mirrored across ZY, y: across ZX, xy: both (a half turn about Z). */
export type MirrorKind = 'x' | 'y' | 'xy'

export interface Symmetry {
  /** mirror across the ZY plane (x → −x) */
  x?: boolean
  /** mirror across the ZX plane (y → −y) */
  y?: boolean
}

export const twinId = (id: string, m: MirrorKind) => `${id}~${m}`

/** How close to a plane (mm) a shape's center counts as lying on it: such a shape has no twin. */
const ON_PLANE = 1e-3

/** Which twins a shape at this place needs. */
function kindsFor(sym: Symmetry, t: Transform): MirrorKind[] {
  const offX = Math.abs(t.position[0]) > ON_PLANE
  const offY = Math.abs(t.position[1]) > ON_PLANE
  const out: MirrorKind[] = []
  if (sym.x && offX) out.push('x')
  if (sym.y && offY) out.push('y')
  if (sym.x && sym.y && offX && offY) out.push('xy')
  return out
}

export const symmetryOn = (d: Doc) => !!(d.symmetry?.x || d.symmetry?.y)

const neg = (v: number) => cleanNum(-v)

/** The mirror image of a transform (exact, and applying it twice gives the original back). */
export function mirrorTransform(t: Transform, m: MirrorKind): Transform {
  const [x, y, z] = t.position
  const [a, b, c] = t.rotation
  const [sx, sy, sz] = t.scale
  if (m === 'x') return { position: [neg(x), y, z], rotation: [a, neg(b), neg(c)], scale: [neg(sx), sy, sz] }
  if (m === 'y') return { position: [x, neg(y), z], rotation: [neg(a), b, neg(c)], scale: [sx, neg(sy), sz] }
  return { position: [neg(x), neg(y), z], rotation: [neg(a), neg(b), c], scale: [neg(sx), neg(sy), sz] as Vec3 }
}

/** A copy of a subtree with derived ids (children of a twin group get `<id>~x` too). */
function renamed(n: DocNode, m: MirrorKind): DocNode {
  const { mirrorOf: _t, noMirror: _n, ...rest } = n
  if (n.kind === 'group') return { ...(rest as DocNode), id: twinId(n.id, m), children: n.children.map((c) => renamed(c, m)) } as DocNode
  return { ...(rest as DocNode), id: twinId(n.id, m) }
}

/** The twin a shape should have. */
function makeTwin(orig: DocNode, m: MirrorKind): DocNode {
  const base = renamed(orig, m)
  return { ...base, name: `${orig.name} ⇋`, transform: mirrorTransform(orig.transform, m), mirrorOf: { id: orig.id, m } }
}

/** The shape as its twin says it should be (an edit made on the twin goes back to the shape). */
function fromTwin(twin: DocNode, orig: DocNode, m: MirrorKind): DocNode {
  const strip = (n: DocNode, id: string): DocNode => {
    const { mirrorOf: _t, ...rest } = n
    if (n.kind === 'group' && orig.kind === 'group') {
      // children of the twin carry derived ids: map them back
      const kids = (n as typeof orig).children.map((c) => strip(c, c.id.replace(new RegExp(`~${m}$`), '')))
      return { ...(rest as DocNode), id, children: kids } as DocNode
    }
    return { ...(rest as DocNode), id }
  }
  const back = strip(twin, orig.id)
  return {
    ...back,
    name: orig.name,
    ...(orig.noMirror ? { noMirror: true } : {}),
    transform: mirrorTransform(twin.transform, m)
  } as DocNode
}

const same = (a: DocNode, b: DocNode) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Remove the twin marks: twins become ordinary shapes (the mode was turned off). */
export function stripSymmetry(d: Doc): Doc {
  if (!d.nodes.some((n) => n.mirrorOf || n.noMirror)) return d
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      if (!n.mirrorOf && !n.noMirror) return n
      const { mirrorOf: _t, noMirror: _n, ...rest } = n
      return rest as DocNode
    })
  }
}

/**
 * Bring the twins in line with the shapes. `ref` is the document before the change (the start
 * of a drag while dragging): what differs from it tells whether a shape or its twin was edited.
 */
export function syncSymmetry(ref: Doc, next: Doc): Doc {
  if (next.scene !== 'model') return next
  const sym = next.symmetry ?? {}
  if (!sym.x && !sym.y) return stripSymmetry(next)

  const refTop = new Map(ref.nodes.map((n) => [n.id, n]))
  const top = new Map(next.nodes.map((n) => [n.id, n]))
  const nestedIn = (id: string) => !top.has(id) && !!findNode(next.nodes, id)
  const dropped = new Set<string>()
  const unlinked = new Set<string>()
  const isTwinOk = (n: DocNode) => !!n.mirrorOf && n.id === twinId(n.mirrorOf.id, n.mirrorOf.m)

  // 1. twins that are gone: deleted → delete the shape too; put into a group → the link breaks
  for (const [id, old] of refTop) {
    if (!old.mirrorOf || top.has(id)) continue
    const orig = old.mirrorOf.id
    if (!top.has(orig)) continue
    if (nestedIn(id)) unlinked.add(orig)
    else dropped.add(orig)
  }
  // 2. shapes that are gone (deleted, or put into a group) take their twins with them: a group
  // gets twins of its own, which already hold the mirrored parts
  const orphans = new Set<string>()
  for (const n of next.nodes) {
    if (!n.mirrorOf || !isTwinOk(n)) continue
    if (top.has(n.mirrorOf.id) && !dropped.has(n.mirrorOf.id)) continue
    dropped.add(n.id)
  }

  const out: DocNode[] = []
  const twinsOf = new Map<string, Map<MirrorKind, DocNode>>()
  const plain = (n: DocNode): DocNode => {
    const { mirrorOf: _t, ...rest } = n
    return rest as DocNode
  }
  for (const n of next.nodes) {
    if (dropped.has(n.id)) continue
    if (n.mirrorOf) {
      if (orphans.has(n.id) || !isTwinOk(n)) {
        out.push(plain(n)) // a copy of a twin, or a twin whose shape went into a group
        continue
      }
      const m = twinsOf.get(n.mirrorOf.id) ?? new Map()
      m.set(n.mirrorOf.m, n)
      twinsOf.set(n.mirrorOf.id, m)
      continue // placed next to their shape below
    }
    out.push(unlinked.has(n.id) && !n.noMirror ? { ...n, noMirror: true } : n)
  }

  // 3. every shape gets the twins it needs; an edited twin first carries its edit to the shape
  const result: DocNode[] = []
  for (let n of out) {
    result.push(n)
    if (n.mirrorOf || n.noMirror) continue
    const have = twinsOf.get(n.id) ?? new Map<MirrorKind, DocNode>()
    const origEdited = refTop.get(n.id) !== n
    if (!origEdited) {
      for (const [m, tw] of have) {
        if (refTop.get(tw.id) !== tw && kindsFor(sym, n.transform).includes(m)) {
          n = fromTwin(tw, n, m)
          result[result.length - 1] = n
          break
        }
      }
    }
    for (const m of kindsFor(sym, n.transform)) {
      const old = have.get(m)
      const want = makeTwin(n, m)
      result.push(old && same(old, want) ? old : want)
    }
    // twins that are no longer needed (the shape moved onto the plane, a plane was turned off)
    for (const [m, tw] of have) {
      if (kindsFor(sym, n.transform).includes(m)) continue
      const planeOff = (m === 'x' && !sym.x) || (m === 'y' && !sym.y) || (m === 'xy' && !(sym.x && sym.y))
      if (planeOff) result.push(plain(tw))
    }
  }
  const changed = result.length !== next.nodes.length || result.some((n, i) => n !== next.nodes[i])
  return changed ? { ...next, nodes: result } : next
}
