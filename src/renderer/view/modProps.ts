/**
 * Field pieces from mods (relief and scenery, see `core/robotics/mods.ts`): their models loaded
 * once, stood on the floor with their footprint centred, and their triangles for the document.
 *
 * A piece on the field is a `mesh` prim: the document keeps its triangles (so the project opens
 * anywhere, and a static piece is walked over like terrain), and while the mod is installed the
 * piece is shown with the mod's own model over that mesh.
 */
import { Box3, BufferAttribute, Group, Matrix4, Mesh, type Object3D, Vector3 } from 'three'
import type { MeshData } from '../core/doc/model'
import { type PropSpec, propSpec } from '../core/robotics/mods'
import { loadPlaced, noPick } from './roboVisuals'

interface PropTemplate {
  /** the model, its footprint centred on the origin and its bottom at z = 0 */
  visual: Object3D
  mesh: MeshData
  /** its size, mm */
  size: [number, number, number]
}

const templates = new Map<string, PropTemplate | null>()
const loading = new Map<string, Promise<PropTemplate | null>>()

/** a piece with more triangles than this keeps only its outline for the walking rules */
const MAX_TRIANGLES = 200_000

/** Load a piece's model (once). Null: its files are missing or broken. */
export function loadProp(spec: PropSpec): Promise<PropTemplate | null> {
  let p = loading.get(spec.id)
  if (!p) {
    p = (async () => {
      try {
        const placed = await loadPlaced(spec.model)
        placed.updateMatrixWorld(true)
        const box = new Box3().setFromObject(placed)
        if (box.isEmpty()) throw new Error('the model is empty')
        const c = box.getCenter(new Vector3())
        const visual = new Group()
        placed.position.set(-c.x, -c.y, -box.min.z)
        visual.add(placed)
        visual.updateMatrixWorld(true)
        const t: PropTemplate = { visual, mesh: trianglesOf(visual), size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z] }
        templates.set(spec.id, t)
        return t
      } catch (e) {
        console.error(`mod ${spec.mod}: piece ${spec.id}`, e)
        templates.set(spec.id, null)
        return null
      }
    })()
    loading.set(spec.id, p)
  }
  return p
}

/** Every triangle of a model in its own frame, mm (rounded to 0.01 mm: smaller files). */
function trianglesOf(root: Object3D): MeshData {
  const vertices: number[] = []
  const triangles: number[] = []
  const v = new Vector3()
  const m = new Matrix4()
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || triangles.length / 3 >= MAX_TRIANGLES) return
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute | undefined
    if (!pos) return
    m.copy(mesh.matrixWorld)
    const base = vertices.length / 3
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      vertices.push(Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100)
    }
    const index = mesh.geometry.getIndex()
    // a mirrored part (negative scale) has its triangles turned inside out: turn them back
    const flip = m.determinant() < 0
    const count = index ? index.count : pos.count
    for (let i = 0; i + 2 < count; i += 3) {
      const a = index ? index.getX(i) : i
      const b = index ? index.getX(i + 1) : i + 1
      const c = index ? index.getX(i + 2) : i + 2
      if (flip) triangles.push(base + a, base + c, base + b)
      else triangles.push(base + a, base + b, base + c)
    }
  })
  return { vertices, triangles }
}

/** A piece's size once loaded (for the drag preview), mm. */
export const propSize = (id: string): [number, number, number] | null => templates.get(id)?.size ?? null

/** A piece's triangles for the document (loads the model first). */
export async function propMesh(id: string): Promise<MeshData | null> {
  const spec = propSpec(id)
  if (!spec) return null
  return (await loadProp(spec))?.mesh ?? null
}

/**
 * A piece's model to show over its mesh: undefined while it loads (`onLoad` is called then), null
 * when it cannot be shown (the mod is not installed or its files are broken: the plain mesh shows).
 */
export function propVisual(id: string, onLoad: () => void): Object3D | null | undefined {
  const spec = propSpec(id)
  if (!spec) return null
  if (!templates.has(id)) {
    void loadProp(spec).then(onLoad)
    return undefined
  }
  const t = templates.get(id)
  if (!t) return null
  const o = t.visual.clone()
  o.name = 'prop-visual'
  noPick(o)
  return o
}

/** Load the pieces of the installed mods (at start, so they are ready when the panel offers them). */
export function loadProps(specs: PropSpec[]): Promise<void> {
  return Promise.all(specs.map((s) => loadProp(s))).then(() => undefined)
}
