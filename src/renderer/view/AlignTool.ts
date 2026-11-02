/**
 * The align tool (Tinkercad style): with two or more shapes selected, dots appear on three lines
 * along the edges of their box — for each axis one at the low side, the middle and the high side.
 * Pointing at a dot shows where the shapes would go; clicking it lines them up there. A shape of
 * the selection clicked first becomes the reference: the dots follow its box and it stays put.
 *
 * Everything is laid out in workplane coordinates (`plane` maps them to the world), sized in
 * screen pixels and drawn over the scene.
 */
import {
  BufferGeometry,
  type Camera,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  type Raycaster,
  Vector3
} from 'three'
import type { Box } from '../core/doc/model'
import type { AlignMode, Axis } from '../core/doc/ops'
import { THEME } from './theme'
import { rimFor, worldPerPixel } from './Gizmo'

export interface AlignDot {
  axis: Axis
  mode: AlignMode
}

const MODES: AlignMode[] = ['min', 'center', 'max']
/** dot radius and how far outside the box the dot lines run, in screen pixels */
const DOT = 6.5
const OUTSIDE = 26

interface DotObj {
  spec: AlignDot
  obj: Group
  fill: MeshBasicMaterial
  pick: Mesh
}

const drawOnTop = (o: Object3D, order: number) => {
  o.traverse((c) => {
    c.renderOrder = order
    const m = (c as Mesh).material as MeshBasicMaterial | undefined
    if (m) {
      m.depthTest = false
      m.depthWrite = false
      m.transparent = true
    }
  })
}

export class AlignTool {
  readonly root = new Group()
  private dots: DotObj[] = []
  private hovered: DotObj | null = null
  private lines: LineSegments
  private frame: LineSegments
  private lineMat = new LineBasicMaterial({ color: '#8a93a6' })
  private frameMat = new LineBasicMaterial({ color: THEME.select })
  private box: Box | null = null
  private plane: Matrix4 | null = null
  private key = false
  private showZ = true

  constructor() {
    this.root.name = 'align-tool'
    this.root.visible = false
    const disc = new CircleGeometry(1, 28)
    for (const axis of [0, 1, 2] as const)
      for (const mode of MODES) {
        const fill = new MeshBasicMaterial({ color: THEME.handleOutline })
        const rim = new Mesh(disc, new MeshBasicMaterial({ color: rimFor(THEME.handleOutline) }))
        rim.scale.setScalar(1.32)
        const dot = new Mesh(disc, fill)
        const obj = new Group()
        obj.add(rim, dot)
        drawOnTop(obj, 1001)
        rim.renderOrder = 1000
        obj.userData.align = { axis, mode }
        dot.userData.align = obj.userData.align
        // a bigger invisible disc is what the mouse hits
        const pick = new Mesh(disc, new MeshBasicMaterial({ visible: false }))
        pick.scale.setScalar(1.8)
        pick.userData.align = obj.userData.align
        obj.add(pick)
        this.dots.push({ spec: { axis, mode }, obj, fill, pick })
        this.root.add(obj)
      }
    this.lines = new LineSegments(new BufferGeometry(), this.lineMat)
    this.frame = new LineSegments(new BufferGeometry(), this.frameMat)
    drawOnTop(this.lines, 999)
    drawOnTop(this.frame, 999)
    this.root.add(this.lines, this.frame)
  }

  /** Re-read the colours after a theme change. */
  applyTheme(): void {
    for (const d of this.dots) (d.obj.children[0] as Mesh<BufferGeometry, MeshBasicMaterial>).material.color.set(rimFor(THEME.handleOutline))
    this.recolor()
  }

  /**
   * Show the dots round `box` (workplane coordinates); `key`: it is the reference shape's box.
   * `z`: offer the height too (not on the robotics field, where things stand on the ground).
   */
  setTarget(box: Box | null, plane: Matrix4, key = false, z = true): void {
    this.box = box
    this.plane = plane
    this.key = key
    this.showZ = z
    this.root.visible = !!box
    if (!box) this.hovered = null
    this.recolor()
  }

  get active(): boolean {
    return this.root.visible
  }

  setHover(spec: AlignDot | null): boolean {
    const h = spec ? (this.dots.find((d) => d.spec.axis === spec.axis && d.spec.mode === spec.mode) ?? null) : null
    if (h === this.hovered) return false
    this.hovered = h
    this.recolor()
    return true
  }

  get hover(): AlignDot | null {
    return this.hovered?.spec ?? null
  }

  private recolor(): void {
    for (const d of this.dots) d.fill.color.set(d === this.hovered ? THEME.handleHot : THEME.handleOutline)
    this.frameMat.color.set(this.key ? THEME.handleHot : THEME.select)
  }

  pick(ray: Raycaster): AlignDot | null {
    if (!this.root.visible) return null
    // the dots move with the camera every frame: their matrices must be current for the ray
    this.root.updateMatrixWorld(true)
    const hit = ray.intersectObjects(
      this.dots.filter((d) => d.obj.visible).map((d) => d.pick),
      false
    )[0]
    return hit ? (hit.object.userData.align as AlignDot) : null
  }

  /** Where a dot is, in workplane coordinates (for the tests and for screen positions). */
  dotLocal(spec: AlignDot): Vector3 | null {
    const d = this.dots.find((x) => x.spec.axis === spec.axis && x.spec.mode === spec.mode)
    return d && d.obj.visible ? d.obj.userData.local : null
  }

  /** Lay the dots, their lines and the frame out for the camera (every frame). */
  update(camera: Camera, viewportHeight: number): void {
    const b = this.box
    const P = this.plane
    if (!b || !P || !this.root.visible || viewportHeight <= 0) return
    const toWorld = (p: Vector3) => p.clone().applyMatrix4(P)
    const camQ = camera.getWorldQuaternion(new Quaternion())
    const cam = camera.getWorldPosition(new Vector3()).applyMatrix4(P.clone().invert())
    const c = new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    const k = worldPerPixel(camera, toWorld(c), viewportHeight)
    const out = OUTSIDE * k
    // the lines run along the box edges on the side facing the camera, just outside it
    const nearY = cam.y < c.y ? b.min[1] - out : b.max[1] + out
    const nearX = cam.x < c.x ? b.min[0] - out : b.max[0] + out
    // the height line stands at the box's far corner, clear of the X and Y lines
    const farY = cam.y < c.y ? b.max[1] + out : b.min[1] - out
    const farX = cam.x < c.x ? b.max[0] + out : b.min[0] - out
    const at = (axis: Axis, v: number): Vector3 =>
      axis === 0 ? new Vector3(v, nearY, b.min[2]) : axis === 1 ? new Vector3(nearX, v, b.min[2]) : new Vector3(farX, farY, v)
    const value = (axis: Axis, mode: AlignMode) => (mode === 'min' ? b.min[axis] : mode === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2)
    const seg: number[] = []
    for (const d of this.dots) {
      const show = d.spec.axis !== 2 || this.showZ
      d.obj.visible = show
      if (!show) continue
      const local = at(d.spec.axis, value(d.spec.axis, d.spec.mode))
      d.obj.userData.local = local
      const w = toWorld(local)
      d.obj.position.copy(w)
      d.obj.quaternion.copy(camQ)
      d.obj.scale.setScalar(DOT * worldPerPixel(camera, w, viewportHeight))
    }
    for (const axis of (this.showZ ? [0, 1, 2] : [0, 1]) as Axis[]) {
      const a = toWorld(at(axis, b.min[axis]))
      const z = toWorld(at(axis, b.max[axis]))
      seg.push(a.x, a.y, a.z, z.x, z.y, z.z)
    }
    this.lines.geometry.dispose()
    this.lines.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(seg, 3))
    // the box the shapes are lined up with
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      toWorld(new Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]))
    )
    const edges = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7]
    const fr: number[] = []
    for (const i of edges) fr.push(corners[i].x, corners[i].y, corners[i].z)
    this.frame.geometry.dispose()
    this.frame.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(fr, 3))
  }
}
