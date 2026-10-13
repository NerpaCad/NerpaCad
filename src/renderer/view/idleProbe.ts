/**
 * Answers to the sensors' questions while nothing runs, from the 3D view (the physics engine only
 * exists during a run): rays against the shapes' meshes, boxes against their bounds. Lamps are
 * not solid, and neither are tiles.
 */
import { Box3, Mesh, Raycaster, Vector3 } from 'three'
import type { Doc } from '../core/doc/model'
import type { Probe } from '../core/robotics/probe'
import type { V3 } from '../core/robotics/lighting'
import type { ShapeSpot } from '../core/robotics/world'
import type { SceneSync } from './SceneSync'

const NOT_SOLID = new Set(['tile', 'light'])

export class ViewProbe implements Probe {
  private raycaster = new Raycaster()
  private solid: { id: string; mesh: Mesh }[] = []

  constructor(
    private sync: SceneSync,
    private doc: Doc
  ) {
    for (const n of doc.nodes) {
      if (n.isHole || (n.kind === 'prim' && NOT_SOLID.has(n.prim))) continue
      const obj = sync.objects.get(n.id)
      if (obj?.mesh) {
        obj.updateWorldMatrix(true, true)
        this.solid.push({ id: n.id, mesh: obj.mesh })
      }
    }
  }

  ray(from: V3, dir: V3, max: number, exclude?: string): number | null {
    this.raycaster.set(new Vector3(...from), new Vector3(...dir))
    this.raycaster.far = max
    let best: number | null = null
    for (const s of this.solid) {
      if (s.id === exclude) continue
      const hit = this.raycaster.intersectObject(s.mesh, false)[0]
      if (hit && (best === null || hit.distance < best)) best = hit.distance
    }
    return best
  }

  touching(center: V3, half: V3, yaw: number, exclude?: string, only?: (id: string) => boolean, _pitch?: number): boolean {
    // the turned box's bounds against each object's bounds: close enough while editing
    const c = Math.abs(Math.cos(yaw))
    const s = Math.abs(Math.sin(yaw))
    const hx = c * half[0] + s * half[1]
    const hy = s * half[0] + c * half[1]
    const box = new Box3(new Vector3(center[0] - hx, center[1] - hy, center[2] - half[2]), new Vector3(center[0] + hx, center[1] + hy, center[2] + half[2]))
    for (const o of this.solid) {
      if (o.id === exclude || (only && !only(o.id))) continue
      const b = this.sync.worldBox(o.id)
      if (b && box.intersectsBox(new Box3(new Vector3(...b.min), new Vector3(...b.max)))) return true
    }
    return false
  }

  /** The shapes (not robots or seals) where they stand. */
  shapes(): ShapeSpot[] {
    const out: ShapeSpot[] = []
    for (const n of this.doc.nodes) {
      if (n.isHole || (n.kind === 'prim' && ['tile', 'light', 'robot', 'nerpa'].includes(n.prim))) continue
      const b = this.sync.worldBox(n.id)
      if (!b) continue
      const pos: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
      const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2
      out.push({ id: n.id, pos, radius, glow: n.material === 'glow' })
    }
    return out
  }
}
