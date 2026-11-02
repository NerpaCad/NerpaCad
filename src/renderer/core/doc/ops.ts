/**
 * Pure document operations. Every function returns a new Doc and never mutates its input,
 * which is what makes snapshot-based undo cheap and safe.
 */
import { Matrix4, Quaternion, Vector3 } from 'three'
import {
  type Box,
  type Doc,
  type DocNode,
  type GroupNode,
  type Transform,
  type Vec3,
  cleanNum,
  cleanVec,
  matrixToTransform,
  newId,
  quatFromRotation,
  rotationFromQuat,
  transformMatrix,
  unionBoxes,
  boxCenter
} from './model'

export type Axis = 0 | 1 | 2
export type AlignMode = 'min' | 'center' | 'max'

const mapTop = (doc: Doc, ids: string[], fn: (n: DocNode) => DocNode): Doc => {
  const set = new Set(ids)
  let changed = false
  const nodes = doc.nodes.map((n) => {
    if (!set.has(n.id)) return n
    const r = fn(n)
    if (r !== n) changed = true
    return r
  })
  return changed ? { ...doc, nodes } : doc
}

export function addNodes(doc: Doc, nodes: DocNode[]): Doc {
  return { ...doc, nodes: [...doc.nodes, ...nodes] }
}

export function removeNodes(doc: Doc, ids: string[]): Doc {
  const set = new Set(ids)
  return pruneMeshes({ ...doc, nodes: doc.nodes.filter((n) => !set.has(n.id)) })
}

export function updateNodes(doc: Doc, ids: string[], fn: (n: DocNode) => DocNode): Doc {
  return mapTop(doc, ids, fn)
}

const sameVec = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const sameTransform = (a: Transform, b: Transform) =>
  sameVec(a.position, b.position) && sameVec(a.rotation, b.rotation) && sameVec(a.scale, b.scale)

export function setTransform(doc: Doc, id: string, t: Transform): Doc {
  return mapTop(doc, [id], (n) => (sameTransform(n.transform, t) ? n : { ...n, transform: t }))
}

export function setColor(doc: Doc, ids: string[], color: string): Doc {
  return mapTop(doc, ids, (n) => (n.color === color ? n : { ...n, color }))
}

export function setHole(doc: Doc, ids: string[], isHole: boolean): Doc {
  return mapTop(doc, ids, (n) => (n.isHole === isHole ? n : { ...n, isHole }))
}

/** Move nodes by `delta`, starting from their positions in `base` (used during drags). */
export function moveNodes(doc: Doc, ids: string[], delta: Vec3, base: Doc = doc): Doc {
  const set = new Set(ids)
  const from = new Map(base.nodes.filter((n) => set.has(n.id)).map((n) => [n.id, n]))
  return mapTop(doc, ids, (n) => {
    const b = from.get(n.id) ?? n
    const p = b.transform.position
    return {
      ...n,
      transform: {
        ...n.transform,
        position: cleanVec([p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]])
      }
    }
  })
}

const axisVector = (axis: Axis | Vec3) =>
  typeof axis === 'number'
    ? new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
    : new Vector3(...axis).normalize()

/** Rotate nodes around an axis (world X/Y/Z or any direction) through `center`, from `base`. */
export function rotateNodes(
  doc: Doc,
  ids: string[],
  axis: Axis | Vec3,
  angleDeg: number,
  center: Vec3,
  base: Doc = doc
): Doc {
  const set = new Set(ids)
  const from = new Map(base.nodes.filter((n) => set.has(n.id)).map((n) => [n.id, n]))
  const ax = axisVector(axis)
  const qa = new Quaternion().setFromAxisAngle(ax, (angleDeg * Math.PI) / 180)
  const c = new Vector3(...center)
  return mapTop(doc, ids, (n) => {
    const b = from.get(n.id) ?? n
    const q = qa.clone().multiply(quatFromRotation(b.transform.rotation))
    const p = new Vector3(...b.transform.position).sub(c).applyQuaternion(qa).add(c)
    return {
      ...n,
      transform: {
        ...b.transform,
        position: cleanVec([p.x, p.y, p.z]),
        rotation: rotationFromQuat(q)
      }
    }
  })
}

/**
 * Mirror nodes across the plane with normal `axis` (world X/Y/Z or any direction) through `center`.
 * With reflection F and M = T·R·S: F·R·S = (F·R·Fj)·(Fj·S), where Fj flips the node's local axis j
 * most aligned with the normal. F·R·Fj is a proper rotation and Fj·S just negates scale[j], so the
 * result is exact without matrix decomposition.
 */
export function mirrorNodes(doc: Doc, ids: string[], axis: Axis | Vec3, center: Vec3): Doc {
  const nrm = axisVector(axis)
  const f = new Matrix4().set(
    1 - 2 * nrm.x * nrm.x, -2 * nrm.x * nrm.y, -2 * nrm.x * nrm.z, 0,
    -2 * nrm.y * nrm.x, 1 - 2 * nrm.y * nrm.y, -2 * nrm.y * nrm.z, 0,
    -2 * nrm.z * nrm.x, -2 * nrm.z * nrm.y, 1 - 2 * nrm.z * nrm.z, 0,
    0, 0, 0, 1
  )
  const c = new Vector3(...center)
  return mapTop(doc, ids, (n) => {
    const t = n.transform
    const rq = quatFromRotation(t.rotation)
    const local = nrm.clone().applyQuaternion(rq.clone().invert())
    const la = [Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)]
    const j = la[0] >= la[1] && la[0] >= la[2] ? 0 : la[1] >= la[2] ? 1 : 2
    const fj = new Matrix4().makeScale(j === 0 ? -1 : 1, j === 1 ? -1 : 1, j === 2 ? -1 : 1)
    const r = new Matrix4().makeRotationFromQuaternion(rq)
    const r2 = f.clone().multiply(r).multiply(fj)
    const q = new Quaternion().setFromRotationMatrix(r2)
    const p = new Vector3(...t.position).sub(c).applyMatrix4(f).add(c)
    const pos: Vec3 = [p.x, p.y, p.z]
    const scale = [...t.scale] as Vec3
    scale[j] = -scale[j]
    return {
      ...n,
      transform: { position: cleanVec(pos), rotation: rotationFromQuat(q), scale }
    }
  })
}

/**
 * Align each node's box to the selection box (or to the box of the reference node `key`) along an
 * axis. `boxes` are in the frame whose world axis directions are `dirs` (the world by default, or
 * the workplane).
 */
export function alignNodes(
  doc: Doc,
  ids: string[],
  axis: Axis,
  mode: AlignMode,
  boxes: Record<string, Box>,
  dirs: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  key: string | null = null
): Doc {
  const all = key && boxes[key] ? boxes[key] : unionBoxes(ids.map((id) => boxes[id]).filter(Boolean))
  if (!all) return doc
  const target =
    mode === 'min' ? all.min[axis] : mode === 'max' ? all.max[axis] : boxCenter(all)[axis]
  return mapTop(doc, ids, (n) => {
    const b = boxes[n.id]
    if (!b) return n
    const cur = mode === 'min' ? b.min[axis] : mode === 'max' ? b.max[axis] : boxCenter(b)[axis]
    const d = target - cur
    if (Math.abs(d) < 1e-9) return n
    const dir = dirs[axis]
    const p = n.transform.position
    const pos = cleanVec([p[0] + d * dir[0], p[1] + d * dir[1], p[2] + d * dir[2]])
    return { ...n, transform: { ...n.transform, position: pos } }
  })
}

/**
 * Put the lowest point of each node on the workplane. `boxes` are in workplane coordinates
 * and `normal` is the workplane normal in world space (ground: +Z).
 */
export function dropToWorkplane(
  doc: Doc,
  ids: string[],
  boxes: Record<string, Box>,
  normal: Vec3 = [0, 0, 1]
): Doc {
  return mapTop(doc, ids, (n) => {
    const b = boxes[n.id]
    if (!b || Math.abs(b.min[2]) < 1e-9) return n
    const h = -b.min[2]
    const p = n.transform.position
    const pos = cleanVec([p[0] + h * normal[0], p[1] + h * normal[1], p[2] + h * normal[2]])
    return { ...n, transform: { ...n.transform, position: pos } }
  })
}

function cloneWithNewIds(n: DocNode): DocNode {
  if (n.kind === 'group') {
    return { ...n, id: newId(), children: n.children.map(cloneWithNewIds) }
  }
  return { ...n, id: newId(), params: { ...n.params } }
}

export function duplicateNodes(
  doc: Doc,
  ids: string[],
  offset: Vec3 = [0, 0, 0]
): { doc: Doc; ids: string[] } {
  const set = new Set(ids)
  const copies = doc.nodes
    .filter((n) => set.has(n.id))
    .map((n) => {
      const c = cloneWithNewIds(n)
      const p = c.transform.position
      c.transform = {
        ...c.transform,
        position: cleanVec([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]])
      }
      return c
    })
  return { doc: addNodes(doc, copies), ids: copies.map((c) => c.id) }
}

/**
 * Repeat a duplicate like Tinkercad: `from[i]` was copied to `to[i]` and the copy was then moved,
 * turned or resized. The new copies get the same change once more, applied to `to` — so pressing
 * Ctrl+D again lays out a row, a circle or a growing series. Returns null when a node is gone.
 */
export function duplicateRepeat(doc: Doc, from: string[], to: string[]): { doc: Doc; ids: string[] } | null {
  if (from.length !== to.length || from.length === 0) return null
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const copies: DocNode[] = []
  for (let i = 0; i < from.length; i++) {
    const a = byId.get(from[i])
    const b = byId.get(to[i])
    if (!a || !b) return null
    // the change from the original to its copy, in world space: delta = B · A⁻¹
    const A = transformMatrix(a.transform)
    const B = transformMatrix(b.transform)
    const delta = B.clone().multiply(A.clone().invert())
    const c = cloneWithNewIds(b)
    c.transform = matrixToTransform(delta.multiply(B))
    copies.push(c)
  }
  return { doc: addNodes(doc, copies), ids: copies.map((c) => c.id) }
}

/** Paste nodes (from clipboard) with fresh ids. Meshes they reference are merged in. */
export function pasteNodes(
  doc: Doc,
  nodes: DocNode[],
  meshes: Doc['meshes'],
  offset: Vec3
): { doc: Doc; ids: string[] } {
  const copies = nodes.map((n) => {
    const c = cloneWithNewIds(n)
    const p = c.transform.position
    c.transform = {
      ...c.transform,
      position: cleanVec([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]])
    }
    return c
  })
  return {
    doc: { ...doc, nodes: [...doc.nodes, ...copies], meshes: { ...meshes, ...doc.meshes } },
    ids: copies.map((c) => c.id)
  }
}

/**
 * Group top-level nodes. The group frame sits at `pivot` (normally the bottom-center of the
 * selection's world box) with no rotation and unit scale, so children just shift by -pivot.
 */
export function groupNodes(
  doc: Doc,
  ids: string[],
  pivot: Vec3,
  name: string
): { doc: Doc; id: string } | null {
  const set = new Set(ids)
  const members = doc.nodes.filter((n) => set.has(n.id))
  if (members.length < 2) return null
  const children = members.map((n) => ({
    ...n,
    transform: {
      ...n.transform,
      position: cleanVec([
        n.transform.position[0] - pivot[0],
        n.transform.position[1] - pivot[1],
        n.transform.position[2] - pivot[2]
      ])
    }
  }))
  const firstSolid = members.find((n) => !n.isHole)
  const group: GroupNode = {
    id: newId(),
    kind: 'group',
    name,
    color: (firstSolid ?? members[0]).color,
    isHole: !firstSolid,
    transform: { position: cleanVec(pivot), rotation: [0, 0, 0], scale: [1, 1, 1] },
    children
  }
  const firstIdx = doc.nodes.findIndex((n) => set.has(n.id))
  const rest = doc.nodes.filter((n) => !set.has(n.id))
  const insertAt = doc.nodes.slice(0, firstIdx).filter((n) => !set.has(n.id)).length
  rest.splice(insertAt, 0, group)
  return { doc: { ...doc, nodes: rest }, id: group.id }
}

/**
 * True when a matrix can't be written as position·rotation·scale — e.g. a group stretched
 * along X after one of its children was rotated. Ungrouping it would change the shape.
 */
export function hasShear(m: Matrix4): boolean {
  const back = transformMatrix(matrixToTransform(m)).elements
  const e = m.elements
  const scale = Math.max(1, ...[0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => Math.abs(e[i])))
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].some((i) => Math.abs(back[i] - e[i]) > 1e-4 * scale)
}

/** Would ungrouping this group distort any child? */
export function ungroupWouldDistort(doc: Doc, id: string): boolean {
  const g = doc.nodes.find((n) => n.id === id)
  if (!g || g.kind !== 'group') return false
  const gm = transformMatrix(g.transform)
  return g.children.some((c) => hasShear(gm.clone().multiply(transformMatrix(c.transform))))
}

/** Replace a group by its children, baking the group transform into each child. */
export function ungroupNode(doc: Doc, id: string): { doc: Doc; ids: string[] } | null {
  const idx = doc.nodes.findIndex((n) => n.id === id)
  const g = doc.nodes[idx]
  if (!g || g.kind !== 'group') return null
  const gm = transformMatrix(g.transform)
  const children = g.children.map((c) => {
    const m = gm.clone().multiply(transformMatrix(c.transform))
    const t = matrixToTransform(m)
    // decompose() returns positive scale + an improper "rotation" when mirrored; keep the sign.
    const det = m.determinant()
    if (det < 0 && t.scale.every((s) => s > 0)) {
      return { ...c, transform: fixMirrored(m) }
    }
    return { ...c, transform: t }
  })
  const nodes = [...doc.nodes]
  nodes.splice(idx, 1, ...children)
  return { doc: { ...doc, nodes }, ids: children.map((c) => c.id) }
}

/** Decompose a matrix with negative determinant as rotation · scale with one negative axis. */
function fixMirrored(m: Matrix4): Transform {
  const flipped = m.clone().multiply(new Matrix4().makeScale(-1, 1, 1))
  const t = matrixToTransform(flipped)
  return { ...t, scale: [-t.scale[0], t.scale[1], t.scale[2]] }
}

/** Set a node's size along its local axes, given its unscaled geometry box. Keeps the min corner. */
export function sizeToScale(localBox: Box, size: Vec3, current: Vec3): Vec3 {
  return [0, 1, 2].map((k) => {
    const ext = localBox.max[k] - localBox.min[k]
    if (ext < 1e-9) return current[k]
    const s = Math.max(size[k], 0.01) / ext
    return cleanNum(current[k] < 0 ? -s : s)
  }) as Vec3
}

/** Remove imported meshes no longer referenced by any node of either scene. */
export function pruneMeshes(doc: Doc): Doc {
  const keys = Object.keys(doc.meshes)
  if (keys.length === 0) return doc
  const used = new Set<string>()
  const walk = (ns: DocNode[]) =>
    ns.forEach((n) => {
      if (n.kind === 'group') walk(n.children)
      else if (n.params.meshId) used.add(n.params.meshId)
    })
  walk(doc.nodes)
  walk(doc.parked)
  if (keys.every((k) => used.has(k))) return doc
  const meshes: Doc['meshes'] = {}
  for (const k of keys) if (used.has(k)) meshes[k] = doc.meshes[k]
  return { ...doc, meshes }
}
