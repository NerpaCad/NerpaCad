/**
 * Draws many copies of the same thing at once (instancing). Landscape tiles and scenery are
 * built from a handful of shared geometries and materials; drawn one by one a 20 × 20 field with
 * trees takes thousands of draw calls. Here every (geometry, material) pair becomes one
 * InstancedMesh holding all its copies, and the copies' own meshes are hidden (they stay in the
 * scene graph: their nodes are still picked, selected and outlined as before).
 */
import { type Material, type Object3D, Group, InstancedMesh, Matrix4, Mesh } from 'three'

interface Batch {
  mesh: InstancedMesh
  used: boolean
}

export class Batcher {
  /** goes into the scene next to the nodes */
  readonly group = new Group()
  private batches = new Map<string, Batch>()
  private readonly inv = new Matrix4()
  private readonly m = new Matrix4()

  constructor() {
    this.group.name = 'batches'
  }

  /**
   * Draw the meshes under `visuals` instanced (their own meshes are hidden). Called after every
   * change of the scene; `visuals` that are not visible are left out.
   */
  rebuild(visuals: Object3D[]): void {
    const groups = new Map<string, { geo: Mesh['geometry']; mat: Material | Material[]; src: Mesh; matrices: Matrix4[] }>()
    this.group.updateWorldMatrix(true, false)
    this.inv.copy(this.group.matrixWorld).invert()
    for (const v of visuals) {
      let shown = true
      for (let o: Object3D | null = v; o; o = o.parent) if (!o.visible) shown = false
      v.updateWorldMatrix(true, true)
      v.traverse((o) => {
        if (!(o instanceof Mesh) || o instanceof InstancedMesh) return
        o.visible = false
        if (!shown) return
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        const key = `${o.geometry.uuid}|${mats.map((m) => m.uuid).join(',')}|${o.renderOrder}`
        let g = groups.get(key)
        if (!g) groups.set(key, (g = { geo: o.geometry, mat: o.material, src: o, matrices: [] }))
        g.matrices.push(this.m.multiplyMatrices(this.inv, o.matrixWorld).clone())
      })
    }
    for (const b of this.batches.values()) b.used = false
    for (const [key, g] of groups) {
      let b = this.batches.get(key)
      if (b && b.mesh.instanceMatrix.count < g.matrices.length) {
        this.drop(key, b)
        b = undefined
      }
      if (!b) {
        // some room to grow, so painting a few more tiles does not make a new one each time
        const mesh = new InstancedMesh(g.geo, g.mat, Math.ceil(g.matrices.length * 1.25) + 8)
        mesh.name = 'batch'
        mesh.renderOrder = g.src.renderOrder
        mesh.castShadow = g.src.castShadow
        mesh.receiveShadow = g.src.receiveShadow
        // never in the way of the mouse: the nodes themselves are picked
        mesh.raycast = () => undefined
        b = { mesh, used: true }
        this.batches.set(key, b)
        this.group.add(mesh)
      }
      b.used = true
      g.matrices.forEach((m, i) => b!.mesh.setMatrixAt(i, m))
      b.mesh.count = g.matrices.length
      b.mesh.instanceMatrix.needsUpdate = true
      b.mesh.computeBoundingSphere()
    }
    for (const [key, b] of this.batches) if (!b.used) this.drop(key, b)
  }

  /** How many instanced meshes there are (tests). */
  get size(): number {
    return this.batches.size
  }

  private drop(key: string, b: Batch): void {
    this.group.remove(b.mesh)
    // the geometry and materials are shared and kept; only the instance buffers go
    b.mesh.dispose()
    this.batches.delete(key)
  }
}
