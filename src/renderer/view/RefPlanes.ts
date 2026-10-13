import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Vector3
} from 'three'

export type RefPlaneId = 'zy' | 'zx'

/** Colours by the axis the plane is perpendicular to: X is red, Y is green (as on the axes). */
const COLOR: Record<RefPlaneId, string> = { zy: '#e5484d', zx: '#2fb36b' }

/**
 * The two vertical reference planes through the origin: ZY (x = 0) and ZX (y = 0).
 * Hidden by default. They are drawn only; picking them (for sketches) is done by the viewport
 * against `mesh(id)`, and nothing else in the scene is hidden behind them.
 */
export class RefPlanes {
  readonly root = new Group()
  private planes = new Map<RefPlaneId, Group>()
  private meshes = new Map<RefPlaneId, Mesh>()

  /** `half` is half the width along the ground, `height` how far up the plane reaches. */
  constructor(half = 100, height = 150) {
    this.root.name = 'ref-planes'
    for (const id of ['zy', 'zx'] as RefPlaneId[]) {
      // corners in the plane's own 2D coordinates (u along the ground, v up)
      const at = (u: number, v: number) => (id === 'zy' ? new Vector3(0, u, v) : new Vector3(u, 0, v))
      const g = new Group()
      g.name = `ref-plane-${id}`
      const quad = new BufferGeometry()
      const c = [at(-half, 0), at(half, 0), at(half, height), at(-half, height)]
      quad.setAttribute('position', new Float32BufferAttribute(c.flatMap((p) => [p.x, p.y, p.z]), 3))
      quad.setIndex([0, 1, 2, 0, 2, 3])
      const mesh = new Mesh(
        quad,
        new MeshBasicMaterial({ color: COLOR[id], transparent: true, opacity: 0.07, side: DoubleSide, depthWrite: false })
      )
      mesh.renderOrder = -1
      g.add(mesh)
      this.meshes.set(id, mesh)
      // a 10 mm grid and a stronger border
      const pts: number[] = []
      const seg = (a: Vector3, b: Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
      for (let u = -half + 10; u < half; u += 10) seg(at(u, 0), at(u, height))
      for (let v = 10; v < height; v += 10) seg(at(-half, v), at(half, v))
      const grid = new BufferGeometry()
      grid.setAttribute('position', new Float32BufferAttribute(pts, 3))
      g.add(new LineSegments(grid, new LineBasicMaterial({ color: COLOR[id], transparent: true, opacity: 0.18, depthWrite: false })))
      const edge: number[] = []
      for (let i = 0; i < 4; i++) {
        const a = c[i]
        const b = c[(i + 1) % 4]
        edge.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
      const border = new BufferGeometry()
      border.setAttribute('position', new Float32BufferAttribute(edge, 3))
      g.add(new LineSegments(border, new LineBasicMaterial({ color: COLOR[id], transparent: true, opacity: 0.7 })))
      g.add(label(id.toUpperCase(), COLOR[id], at(id === 'zy' ? -(half - 14) : half - 14, 40)))
      g.visible = false
      this.planes.set(id, g)
      this.root.add(g)
    }
  }

  setVisible(id: RefPlaneId, on: boolean): void {
    this.planes.get(id)!.visible = on
  }

  isVisible(id: RefPlaneId): boolean {
    return this.planes.get(id)!.visible
  }

  /** The surface to hit when the user clicks a plane. */
  mesh(id: RefPlaneId): Mesh {
    return this.meshes.get(id)!
  }
}

/** A small text sprite that always faces the camera. */
function label(text: string, color: string, at: Vector3): Sprite {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d')!
  g.font = 'bold 40px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = color
  g.fillText(text, 64, 34)
  const s = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false }))
  s.scale.set(16, 8, 1)
  s.position.copy(at)
  return s
}
